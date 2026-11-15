// DEV ONLY - never shipped. build.js leaves this file out of the store ZIP and
// strips the importScripts() line that loads it from background.js.
//
// Reloads the unpacked extension whenever `npm run dev` (watch.js) reports a file change.
(function initDevReloader() {
  // Store installs always have an update_url in their manifest; unpacked ones do not.
  if ("update_url" in chrome.runtime.getManifest()) return;

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
