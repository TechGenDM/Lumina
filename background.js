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

    // 1. Identify the main scrolling element (window or internal scroll container like Notion/SPAs)
    //    and scroll it progressively to trigger lazy loading / virtualization.
    await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: `
        (async function() {
          function getScroller() {
            // Check if document or body is the primary scroller
            if (document.documentElement.scrollHeight > window.innerHeight + 60) {
              return { el: document.documentElement, isWindow: true };
            }
            if (document.body && document.body.scrollHeight > window.innerHeight + 60) {
              return { el: document.body, isWindow: true };
            }

            // Look for known SPA / Notion / App scroll containers
            const knownSelectors = [
              '.notion-scroller',
              '.notion-frame',
              '[class*="notion-scroller"]',
              '[class*="notion-page-content"]',
              'main',
              '[role="main"]',
              '#app',
              '#root',
              '.scroll-container'
            ];
            for (const sel of knownSelectors) {
              const el = document.querySelector(sel);
              if (el && el.scrollHeight > el.clientHeight + 60) {
                return { el, isWindow: false };
              }
            }

            // Fallback: search for any element with overflow: auto/scroll and the largest scrollable distance
            const all = Array.from(document.querySelectorAll('*'));
            let best = null;
            let maxScroll = 0;
            for (const el of all) {
              const style = window.getComputedStyle(el);
              const isScrollable = ['auto', 'scroll'].includes(style.overflowY) || ['auto', 'scroll'].includes(style.overflow);
              const scrollDiff = el.scrollHeight - el.clientHeight;
              if (isScrollable && scrollDiff > 60 && el.clientHeight > 150 && el.clientWidth > 200) {
                if (scrollDiff > maxScroll) {
                  maxScroll = scrollDiff;
                  best = el;
                }
              }
            }

            if (best) {
              return { el: best, isWindow: false };
            }

            return { el: document.documentElement, isWindow: true };
          }

          const { el: scroller, isWindow } = getScroller();
          window.__lumina_scroller = isWindow ? null : scroller;

          // Scroll progressively to bottom so all virtual/lazy elements render
          await new Promise((resolve) => {
            let scrolls = 0;
            const distance = 500;
            const maxScrolls = 150;
            const timer = setInterval(() => {
              if (isWindow) {
                window.scrollBy(0, distance);
              } else {
                scroller.scrollTop += distance;
              }
              scrolls++;

              const maxScrollHeight = isWindow ? document.documentElement.scrollHeight : scroller.scrollHeight;
              const currentPos = isWindow 
                ? (window.scrollY + window.innerHeight) 
                : (scroller.scrollTop + scroller.clientHeight);

              if (currentPos >= maxScrollHeight - 10 || scrolls >= maxScrolls) {
                clearInterval(timer);
                if (isWindow) {
                  window.scrollTo(0, 0);
                } else {
                  scroller.scrollTop = 0;
                }
                setTimeout(resolve, 800);
              }
            }, 80);
          });

          return true;
        })()
      `,
      awaitPromise: true
    });

    // 2. If it's an internal scroller (e.g. Notion), temporarily unlock heights & overflow
    //    so the full content naturally expands in document layout for CDP capture.
    const runtimeResult = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: `
        (function() {
          const scroller = window.__lumina_scroller;
          window.__lumina_restorers = [];

          if (scroller && scroller !== document.documentElement && scroller !== document.body) {
            let curr = scroller;
            while (curr && curr !== document.documentElement) {
              const prevStyle = curr.getAttribute('style') || '';
              window.__lumina_restorers.push({ el: curr, prevStyle });

              curr.style.setProperty('height', 'auto', 'important');
              curr.style.setProperty('max-height', 'none', 'important');
              curr.style.setProperty('overflow', 'visible', 'important');
              curr.style.setProperty('overflow-y', 'visible', 'important');
              curr.style.setProperty('overflow-x', 'visible', 'important');
              curr = curr.parentElement;
            }
            if (document.body) {
              const prevBodyStyle = document.body.getAttribute('style') || '';
              window.__lumina_restorers.push({ el: document.body, prevStyle: prevBodyStyle });
              document.body.style.setProperty('height', 'auto', 'important');
              document.body.style.setProperty('overflow', 'visible', 'important');
            }
            const prevDocStyle = document.documentElement.getAttribute('style') || '';
            window.__lumina_restorers.push({ el: document.documentElement, prevStyle: prevDocStyle });
            document.documentElement.style.setProperty('height', 'auto', 'important');
            document.documentElement.style.setProperty('overflow', 'visible', 'important');
          }

          // Force reflow
          void document.documentElement.offsetHeight;

          const docEl = document.documentElement;
          const docBody = document.body;

          const width = Math.max(
            docEl.clientWidth,
            docEl.scrollWidth,
            docBody ? docBody.scrollWidth : 0,
            window.innerWidth
          );

          const height = Math.max(
            docEl.clientHeight,
            docEl.scrollHeight,
            docBody ? docBody.scrollHeight : 0,
            docBody ? docBody.offsetHeight : 0,
            docEl.offsetHeight
          );

          return JSON.stringify({
            devicePixelRatio: window.devicePixelRatio || 1,
            viewportWidth: Math.max(docEl.clientWidth, window.innerWidth),
            viewportHeight: window.innerHeight,
            fullWidth: width,
            fullHeight: height
          });
        })()
      `,
      returnByValue: true
    });

    const metrics = JSON.parse(runtimeResult.result.value);
    const viewportWidth = metrics.viewportWidth;
    const viewportHeight = metrics.viewportHeight;
    const fullWidth = Math.max(metrics.fullWidth, viewportWidth);
    const fullHeight = Math.max(metrics.fullHeight, viewportHeight);
    const dpr = metrics.devicePixelRatio || 1;

    // 3. Set device metrics override for full width while keeping viewport height natural
    await chrome.debugger.sendCommand(target, "Emulation.setDeviceMetricsOverride", {
      mobile: false,
      width: fullWidth,
      height: viewportHeight,
      deviceScaleFactor: dpr,
      screenOrientation: { angle: 0, type: "portraitPrimary" }
    });

    // Give browser time to repaint
    await new Promise(resolve => setTimeout(resolve, 500));

    // 4. Capture full page using captureBeyondViewport with exact clip rectangle
    const captureResult = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: fullWidth,
        height: fullHeight,
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
    // 5. Restore modified DOM styles back to original state
    try {
      await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression: `
          (function() {
            if (window.__lumina_restorers) {
              for (const item of window.__lumina_restorers) {
                if (item.prevStyle) {
                  item.el.setAttribute('style', item.prevStyle);
                } else {
                  item.el.removeAttribute('style');
                }
              }
              delete window.__lumina_restorers;
            }
            delete window.__lumina_scroller;
          })()
        `
      });
    } catch (e) { /* ignored */ }

    try {
      await chrome.debugger.sendCommand(target, "Emulation.clearDeviceMetricsOverride");
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