// Lumina - background service worker.
// Captures a full-page screenshot of the active tab through the Chrome
// DevTools Protocol (chrome.debugger) when the toolbar icon is clicked.

// @dev-only-start (this block is removed from the store build by build.js)
try { importScripts("dev-reloader.js"); } catch (e) { /* not a dev checkout */ }
// @dev-only-end

const MAX_TEXTURE_PX = 16384; // Chrome's hard limit for one screenshot surface
const capturingTabs = new Set();

// A screenshot left behind by a crashed or closed session should not stay in storage.
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.remove(["screenshotData", "screenshotMeta"]);
});

function isRestrictedUrl(url) {
  if (!url) return true; // no URL = a page activeTab cannot reach
  return /^(chrome|chrome-extension|chrome-untrusted|chrome-error|chrome-search|devtools|edge|brave|about|view-source):/i.test(url) ||
    /^https:\/\/chromewebstore\.google\.com\//i.test(url) ||
    /^https:\/\/chrome\.google\.com\/webstore/i.test(url);
}

// Turns a thrown error into one of the short codes output.js knows how to explain.
function errorCodeFor(err, url) {
  if (err && err.luminaCode) return err.luminaCode;
  const msg = String((err && err.message) || err || "");
  if (/^file:/i.test(url || "") && /cannot access|permission/i.test(msg)) return "file";
  if (/already attached/i.test(msg)) return "busy";
  if (/not attached|detached|target closed|no tab with/i.test(msg)) return "cancelled";
  if (/cannot access|cannot attach/i.test(msg)) return "restricted";
  if (/quota/i.test(msg)) return "too-large";
  return "failed";
}

function luminaError(code) {
  const e = new Error(code);
  e.luminaCode = code;
  return e;
}

async function showError(code) {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL("output.html") + "?error=" + encodeURIComponent(code) });
  } catch (e) { /* nothing more we can do */ }
}

async function setBadge(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: "#0071e3", tabId });
    await chrome.action.setBadgeText({ text, tabId });
  } catch (e) { /* tab may be gone */ }
}

chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab.id;
  const url = tab.url || "";

  if (isRestrictedUrl(url)) {
    await showError("restricted");
    return;
  }
  if (capturingTabs.has(tabId)) return; // a capture of this tab is already running
  capturingTabs.add(tabId);

  const target = { tabId };
  let attached = false;

  try {
    await setBadge(tabId, "...");
    await chrome.debugger.attach(target, "1.3");
    attached = true;

    // Enable Page and Runtime domains
    await chrome.debugger.sendCommand(target, "Page.enable");
    await chrome.debugger.sendCommand(target, "Runtime.enable");

    // 1. Robust scroller detection and progressive scroll to trigger lazy loading / virtualization.
    //    We track the maximum scrollHeight seen, because virtual lists (Notion) might unmount blocks and shrink.
    const runtimeResult1 = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: `
        (async function() {
          function getScroller() {
            // Check known SPA / Notion containers first for strict matching
            const knownSelectors = [
              '.notion-scroller',
              '.notion-frame',
              '.notion-app-inner',
              '[class*="notion-scroller"]',
              '[class*="notion-page-content"]',
              'main',
              '#app',
              '#root',
              '.scroll-container'
            ];
            
            for (const sel of knownSelectors) {
              const el = document.querySelector(sel);
              if (el) {
                if (el.scrollHeight > el.clientHeight + 60) return { el, isWindow: false };
                const children = el.querySelectorAll('*');
                for (const child of children) {
                  if (child.scrollHeight > child.clientHeight + 60) {
                     const style = window.getComputedStyle(child);
                     if (['auto', 'scroll', 'overlay'].includes(style.overflowY) || ['auto', 'scroll', 'overlay'].includes(style.overflow)) {
                       return { el: child, isWindow: false };
                     }
                  }
                }
              }
            }

            // Generic fallback: score elements by their scrollable area
            const all = Array.from(document.querySelectorAll('*'));
            let bestEl = null;
            let maxDiff = 0;

            for (const el of all) {
              if (el.clientHeight < 150 || el.clientWidth < 200) continue;
              const diff = el.scrollHeight - el.clientHeight;
              if (diff > 60) {
                const style = window.getComputedStyle(el);
                const hasScroll = ['auto', 'scroll', 'overlay'].includes(style.overflowY) || 
                                  ['auto', 'scroll', 'overlay'].includes(style.overflow);
                const coverage = (el.clientWidth / window.innerWidth) * (el.clientHeight / window.innerHeight);
                const score = (hasScroll ? diff * 10 : diff) * coverage;
                if (score > maxDiff) {
                  maxDiff = score;
                  bestEl = el;
                }
              }
            }

            // Check standard window scrolling
            const winDiff = document.documentElement.scrollHeight - window.innerHeight;
            const winStyle = window.getComputedStyle(document.documentElement);
            const bodyStyle = document.body ? window.getComputedStyle(document.body) : null;
            
            let windowCanScroll = true;
            if (winStyle.overflow === 'hidden' || winStyle.overflowY === 'hidden') windowCanScroll = false;
            if (bodyStyle && (bodyStyle.overflow === 'hidden' || bodyStyle.overflowY === 'hidden')) windowCanScroll = false;

            const winScore = (windowCanScroll && winDiff > 60) ? winDiff * 10 : 0;

            if (bestEl && maxDiff > winScore) {
              return { el: bestEl, isWindow: false };
            }

            return { el: document.documentElement, isWindow: true };
          }

          if (document.contentType === 'application/pdf') return JSON.stringify({ unsupported: 'pdf' });

          const { el: scroller, isWindow } = getScroller();
          window.__lumina_scroller = isWindow ? null : scroller;
          // Remember where the user was so the page can be put back afterwards
          window.__lumina_restore = { x: window.scrollX, y: window.scrollY, top: isWindow ? 0 : scroller.scrollTop };

          const nonScrollerHeight = isWindow ? 0 : Math.max(0, window.innerHeight - scroller.clientHeight);
          let maxSeenHeight = isWindow ? document.documentElement.scrollHeight : scroller.scrollHeight;

          // Scroll progressively to bottom so all virtual/lazy elements render
          await new Promise((resolve) => {
            let scrolls = 0;
            const timer = setInterval(() => {
              if (isWindow) {
                window.scrollBy(0, 500);
                const currentHeight = document.documentElement.scrollHeight;
                if (currentHeight > maxSeenHeight) maxSeenHeight = currentHeight;
                
                if (window.scrollY + window.innerHeight >= currentHeight - 10 || scrolls >= 150) {
                  clearInterval(timer);
                  window.scrollTo(0, 0);
                  setTimeout(resolve, 800);
                }
              } else {
                scroller.scrollTop += 500;
                const currentHeight = scroller.scrollHeight;
                if (currentHeight > maxSeenHeight) maxSeenHeight = currentHeight;

                if (scroller.scrollTop + scroller.clientHeight >= currentHeight - 10 || scrolls >= 150) {
                  clearInterval(timer);
                  // For SPAs, we don't scroll back to top yet. The upcoming viewport expansion will naturally eliminate the scrollbar.
                  setTimeout(resolve, 500);
                }
              }
              scrolls++;
            }, 80);
          });

          // Ensure any natively lazy-loaded images start loading immediately
          document.querySelectorAll('img[loading="lazy"]').forEach(img => img.setAttribute('loading', 'eager'));

          return JSON.stringify({
            isWindow,
            maxSeenHeight,
            nonScrollerHeight,
            scrollerScrollWidth: isWindow ? 0 : scroller.scrollWidth,
            docScrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1
          });
        })()
      `,
      awaitPromise: true
    });

    if (runtimeResult1.exceptionDetails || !runtimeResult1.result || typeof runtimeResult1.result.value !== "string") {
      throw luminaError("failed"); // the page was not ready or blocked the measuring script
    }
    const metrics1 = JSON.parse(runtimeResult1.result.value);
    if (metrics1.unsupported) throw luminaError(metrics1.unsupported);

    const isWindow = metrics1.isWindow;
    const dpr = metrics1.devicePixelRatio || 1;

    // 2. Calculate Viewport Override dimensions
    let overrideWidth = Math.max(metrics1.docScrollWidth, metrics1.scrollerScrollWidth, metrics1.viewportWidth);

    // For standard websites, keep viewport normal (to not break 100vh elements).
    // For SPAs, expand viewport to the maximum height encountered during scroll.
    let overrideHeight = isWindow
      ? metrics1.viewportHeight
      : (metrics1.maxSeenHeight + metrics1.nonScrollerHeight);

    // Chrome cannot capture more than 16384 physical pixels in either dimension.
    // On a retina screen (DPR 2) that is only 8192 CSS px, so for long pages we
    // capture at 1x instead: a little less sharp, but the whole page fits.
    const expectedHeight = isWindow ? metrics1.maxSeenHeight : overrideHeight;
    let captureScale = dpr;
    let downscaled = false;
    if (dpr > 1 && Math.max(expectedHeight, overrideWidth) * dpr > MAX_TEXTURE_PX) {
      captureScale = 1;
      downscaled = true;
    }
    const maxLogicalDimension = Math.floor(MAX_TEXTURE_PX / captureScale);
    let truncated = false;

    // Safety cap to prevent browser out-of-memory crashes on infinite scroll pages
    if (overrideHeight > maxLogicalDimension) { overrideHeight = maxLogicalDimension; truncated = true; }
    if (overrideWidth > maxLogicalDimension) { overrideWidth = maxLogicalDimension; truncated = true; }

    // 3. Set device metrics override
    await chrome.debugger.sendCommand(target, "Emulation.setDeviceMetricsOverride", {
      mobile: false,
      width: overrideWidth,
      height: overrideHeight,
      deviceScaleFactor: captureScale,
      screenOrientation: { angle: 0, type: "portraitPrimary" }
    });

    // Give browser time to apply the new viewport and SPA to render all un-virtualized blocks
    const waitTime = isWindow ? 800 : 1500;
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // 4. Re-measure the final document height after viewport change
    const runtimeResult2 = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: `
        JSON.stringify({
          finalWidth: Math.max(
            document.documentElement.scrollWidth, 
            window.innerWidth, 
            window.__lumina_scroller ? window.__lumina_scroller.scrollWidth : 0
          ),
          finalHeight: ${isWindow} ? Math.max(
            document.documentElement.scrollHeight, 
            document.documentElement.offsetHeight
          ) : 0
        })
      `,
      returnByValue: true
    });
    
    const metrics2 = JSON.parse(runtimeResult2.result.value);
    
    let clipHeight = isWindow ? metrics2.finalHeight : overrideHeight;
    let clipWidth = Math.max(metrics2.finalWidth, overrideWidth);
    
    // Apply final safety caps to the clip rectangle as well
    if (clipHeight > maxLogicalDimension) { clipHeight = maxLogicalDimension; truncated = true; }
    if (clipWidth > maxLogicalDimension) { clipWidth = maxLogicalDimension; truncated = true; }

    // 5. Capture full page using captureBeyondViewport with exact clip rectangle
    const captureResult = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: clipWidth,
        height: clipHeight,
        scale: 1
      }
    });

    if (!captureResult || !captureResult.data) throw luminaError("failed");
    const dataUrl = `data:image/png;base64,${captureResult.data}`;

    // Hand the screenshot to the viewer page. Both keys are deleted again as
    // soon as the viewer has read them.
    await chrome.storage.local.set({
      screenshotData: dataUrl,
      screenshotMeta: {
        url,
        title: tab.title || "",
        capturedAt: Date.now(),
        truncated,
        downscaled
      }
    });
    await chrome.tabs.create({ url: chrome.runtime.getURL("output.html") });

  } catch (err) {
    console.error("Screenshot capture failed:", err);
    try {
      await chrome.storage.local.remove(["screenshotData", "screenshotMeta"]);
    } catch (e) { /* ignored */ }
    await showError(errorCodeFor(err, url));
  } finally {
    // Always put the page back the way it was and release the debugger, even after an error.
    if (attached) {
      try {
        await chrome.debugger.sendCommand(target, "Emulation.clearDeviceMetricsOverride");
      } catch (e) { /* ignored */ }
      try {
        await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
          expression: `(function () {
            var r = window.__lumina_restore, s = window.__lumina_scroller;
            if (r) { if (s) s.scrollTop = r.top; window.scrollTo(r.x, r.y); }
            delete window.__lumina_scroller;
            delete window.__lumina_restore;
          })()`
        });
      } catch (e) { /* ignored */ }
      try {
        await chrome.debugger.detach(target);
      } catch (e) { /* ignored */ }
    }
    capturingTabs.delete(tabId);
    await setBadge(tabId, "");
  }
});