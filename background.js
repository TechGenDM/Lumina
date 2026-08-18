chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab.id;

  const url = tab.url || "";
  if (url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:") || url.startsWith("chrome-extension://")) {
    console.error("Cannot capture restricted browser pages.");
    return;
  }

  const target = { tabId };

  try {
    await chrome.debugger.attach(target, "1.3");

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

          const { el: scroller, isWindow } = getScroller();
          window.__lumina_scroller = isWindow ? null : scroller;

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

    const metrics1 = JSON.parse(runtimeResult1.result.value);
    const isWindow = metrics1.isWindow;
    const dpr = metrics1.devicePixelRatio || 1;

    // 2. Calculate Viewport Override dimensions
    let overrideWidth = Math.max(metrics1.docScrollWidth, metrics1.scrollerScrollWidth, metrics1.viewportWidth);
    
    // For standard websites, keep viewport normal (to not break 100vh elements).
    // For SPAs, expand viewport to the maximum height encountered during scroll.
    let overrideHeight = isWindow 
      ? metrics1.viewportHeight 
      : (metrics1.maxSeenHeight + metrics1.nonScrollerHeight);
      
    // Chrome has a hard physical texture limit of 16384px in either dimension.
    // On retina screens (DPR = 2), the logical limit is 8192px!
    const maxLogicalDimension = Math.floor(16384 / dpr);
    
    // Safety cap to prevent browser out-of-memory crashes on infinite scroll pages
    if (overrideHeight > maxLogicalDimension) overrideHeight = maxLogicalDimension;
    if (overrideWidth > maxLogicalDimension) overrideWidth = maxLogicalDimension;

    // 3. Set device metrics override
    await chrome.debugger.sendCommand(target, "Emulation.setDeviceMetricsOverride", {
      mobile: false,
      width: overrideWidth,
      height: overrideHeight,
      deviceScaleFactor: dpr,
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
    if (clipHeight > maxLogicalDimension) clipHeight = maxLogicalDimension;
    if (clipWidth > maxLogicalDimension) clipWidth = maxLogicalDimension;

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

    const dataUrl = `data:image/png;base64,${captureResult.data}`;

    // Store raw screenshot and open output page
    await chrome.storage.local.set({ screenshotData: dataUrl });
    await chrome.tabs.create({ url: chrome.runtime.getURL("output.html") });

  } catch (err) {
    console.error("Screenshot capture failed:", err);
  } finally {
    try {
      await chrome.debugger.sendCommand(target, "Emulation.clearDeviceMetricsOverride");
    } catch (e) { /* ignored */ }
    try {
      await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression: "delete window.__lumina_scroller;"
      });
    } catch (e) { /* ignored */ }
    try {
      await chrome.debugger.detach(target);
    } catch (e) { /* ignored */ }
  }
});

// --- DEVELOPMENT AUTO-RELOADER ---
// Automatically connects to local watch server if running (npm run dev)
(function initDevReloader() {
  async function pollForChanges() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const res = await fetch("http://localhost:8890/poll", {
        cache: "no-store",
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (data && data.reload) {
        chrome.runtime.reload();
        return;
      }
      // Long-poll completed without change, poll again
      pollForChanges();
    } catch (e) {
      // Dev server is offline, retry periodically in the background
      setTimeout(pollForChanges, 3000);
    }
  }

  pollForChanges();
})();