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

    // 1. First, scroll down the page to trigger any lazy-loaded elements (like GitHub's contribution graph)
    await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: `
        new Promise((resolve) => {
          let totalHeight = 0;
          let distance = 600;
          let scrolls = 0;
          let timer = setInterval(() => {
            window.scrollBy(0, distance);
            totalHeight += distance;
            scrolls++;
            if (totalHeight >= document.documentElement.scrollHeight || scrolls > 40) {
              clearInterval(timer);
              window.scrollTo(0, 0);
              setTimeout(resolve, 800); // Wait for the page to stabilize after returning to top
            }
          }, 100);
        })
      `,
      awaitPromise: true
    });

    // 2. Now get accurate page metrics AFTER all content has loaded
    const runtimeResult = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: "JSON.stringify({ devicePixelRatio: window.devicePixelRatio, width: Math.max(document.documentElement.clientWidth, document.documentElement.scrollWidth, window.innerWidth), height: Math.max(document.body.scrollHeight, document.body.offsetHeight, document.documentElement.clientHeight, document.documentElement.scrollHeight, document.documentElement.offsetHeight) })",
      returnByValue: true
    });
    const pageMetrics = JSON.parse(runtimeResult.result.value);
    
    // We use max of clientWidth and scrollWidth to guarantee horizontal overflow is captured
    const width = pageMetrics.width;
    const height = pageMetrics.height;
    const devicePixelRatio = pageMetrics.devicePixelRatio || 1;

    // 3. Override device metrics to match the exact full page dimensions
    await chrome.debugger.sendCommand(target, "Emulation.setDeviceMetricsOverride", {
      mobile: false,
      width: width,
      height: height,
      deviceScaleFactor: devicePixelRatio,
      screenOrientation: { angle: 0, type: "portraitPrimary" }
    });

    // Wait a brief moment for the browser to re-paint the extended viewport
    await new Promise(resolve => setTimeout(resolve, 500));

    // Capture screenshot natively
    const captureResult = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true
    });

    const dataUrl = `data:image/png;base64,${captureResult.data}`;

    // Store raw screenshot and open output page
    await chrome.storage.local.set({ screenshotData: dataUrl });
    await chrome.tabs.create({ url: chrome.runtime.getURL("output.html") });

  } catch (err) {
    console.error("Screenshot capture failed:", err);
  } finally {
    // Cleanup state
    try {
      await chrome.debugger.sendCommand(target, "Emulation.clearDeviceMetricsOverride");
    } catch (e) {
      // Ignored if not attached
    }
    try {
      await chrome.debugger.detach(target);
    } catch (e) {
      // Ignored if already detached
    }
  }
});