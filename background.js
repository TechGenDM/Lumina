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

    // 1. Scroll through the entire page to trigger lazy-loaded elements,
    //    then scroll back to top so the page is in its normal visual state.
    await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: `
        new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 600;
          let scrolls = 0;
          const timer = setInterval(() => {
            window.scrollBy(0, distance);
            totalHeight += distance;
            scrolls++;
            if (totalHeight >= document.documentElement.scrollHeight || scrolls > 60) {
              clearInterval(timer);
              window.scrollTo(0, 0);
              // Give the page time to settle back at the top before we read metrics
              setTimeout(resolve, 1200);
            }
          }, 100);
        })
      `,
      awaitPromise: true
    });

    // 2. Read the true page dimensions at its NATURAL viewport size.
    //    We intentionally do NOT change the viewport height — doing so would
    //    cause elements that use 100vh / 100lvh / h-screen to expand and
    //    fill the whole enlarged "viewport", producing a mostly-black image.
    const runtimeResult = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: `JSON.stringify({
        devicePixelRatio: window.devicePixelRatio,
        viewportWidth:    Math.max(document.documentElement.clientWidth, window.innerWidth),
        viewportHeight:   window.innerHeight,
        scrollWidth:      Math.max(document.body.scrollWidth,  document.documentElement.scrollWidth),
        scrollHeight:     Math.max(document.body.scrollHeight, document.documentElement.scrollHeight,
                                   document.documentElement.offsetHeight)
      })`,
      returnByValue: true
    });
    const metrics = JSON.parse(runtimeResult.result.value);

    const viewportWidth = metrics.viewportWidth;
    const viewportHeight = metrics.viewportHeight;
    const fullWidth = Math.max(metrics.scrollWidth, viewportWidth);
    const fullHeight = Math.max(metrics.scrollHeight, viewportHeight);
    const dpr = metrics.devicePixelRatio || 1;

    // 3. Only override the WIDTH (to capture horizontal overflow) and keep the
    //    height equal to the real viewport height so that vh-based layouts
    //    remain correct.  captureBeyondViewport:true in step 4 handles the
    //    vertical extent.
    await chrome.debugger.sendCommand(target, "Emulation.setDeviceMetricsOverride", {
      mobile: false,
      width: fullWidth,
      height: viewportHeight,   // ← natural viewport height, NOT scrollHeight
      deviceScaleFactor: dpr,
      screenOrientation: { angle: 0, type: "portraitPrimary" }
    });

    // Give the browser a moment to repaint after the width change
    await new Promise(resolve => setTimeout(resolve, 600));

    // 4. Capture the full page by using captureBeyondViewport + an explicit
    //    clip rect.  This reaches content below the fold WITHOUT telling the
    //    page that the viewport is taller, so 100vh elements stay their
    //    normal size.
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