# 📸 Lumina

A Chrome extension (Manifest V3) that captures full-page screenshots, from the top of the page to the bottom, and lets you annotate and export them. It scrolls the page first so lazy-loaded content is included, then opens the result in a clean viewer with a built-in editor.

## ✨ Features

- **Full-page capture**: captures the whole scrolling page in one image, without stitching seams.
- **Lazy-load support**: scrolls through the page first so lazy-loaded images and dynamic content are included.
- **Built-in editor**: crop, draw rectangles, ellipses, arrows and lines, write text, add numbered markers, highlight, and hide sensitive areas with blur, pixelate or solid redaction. Undo and redo are supported.
- **Exports**: save as PNG, export to PDF, or copy to the clipboard.
- **Light and dark mode**.
- **Private by design**: capturing, editing and exporting all happen on your device. No accounts, analytics or trackers. The only time anything is sent over the internet is when you choose to send an issue report (see [Privacy](#-privacy)).

### Limits to know about

- Chrome cannot capture more than 16,384 pixels in one image. Very long pages are captured at standard (1x) resolution so they fit, and pages longer than 16,384 px are cut off at that point. Lumina tells you when either happens.
- Chrome's own pages (`chrome://`, the New Tab page, the Chrome Web Store) and the built-in PDF viewer cannot be captured. Local `file://` pages need "Allow access to file URLs" turned on for Lumina in `chrome://extensions`.
- While a capture is running, Chrome shows a "Lumina started debugging this browser" bar. That is expected: the debugger API is what makes full-page capture possible. It disappears when the capture finishes.

---

## 🚀 Installation (from source)

Works in Google Chrome and other Chromium browsers (Edge, Brave).

1. **Download**: clone or download this repository.
2. **Open the Extensions page**: go to `chrome://extensions/`.
3. **Enable Developer mode**: use the toggle in the top right corner.
4. **Load the extension**: click **Load unpacked** and select the `Lumina` folder (the one that contains `manifest.json`).
5. **Pin it (recommended)**: click the puzzle-piece icon in the toolbar, find **Lumina** and click the pin.

---

## 🛠️ How to Use

1. Open the web page you want to capture.
2. Click the **Lumina** icon in the toolbar.
3. Wait a moment. The page scrolls by itself to load all content.
4. A new tab opens with the capture. From its toolbar you can:
   - 🌓 toggle dark mode
   - 📋 copy to the clipboard
   - ✏️ open the editor
   - 📄 export as PDF
   - 🖼️ save as PNG
5. Use the zoom controls at the bottom to inspect the capture.

The capture lives only in that tab. If you reload or close the tab without saving, capture the page again.

### Editor shortcuts

| Key | Tool | Key | Tool |
| --- | --- | --- | --- |
| `V` | Pointer | `P` | Pen |
| `R` | Rectangle | `H` | Highlighter |
| `C` | Ellipse | `T` | Text |
| `A` | Arrow | `N` | Number marker |
| `L` | Line | `B` | Blur |

`Cmd/Ctrl+Z` undo · `Cmd/Ctrl+Shift+Z` redo · `Cmd/Ctrl+D` duplicate · `Delete` remove · hold `Space` and drag to pan · `Ctrl` + scroll (or pinch) to zoom.

---

## 🔒 Privacy

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md). In short:

- Screenshots never leave your device.
- The optional **Report an Issue** form sends your message, your email address (only if you enter one), your browser version and the time to the developer through the [EmailJS](https://www.emailjs.com/) service, and only when you click **Send report**.

---

## 👨‍💻 Development

Requires Node.js (only for the helper scripts; the extension itself has no build step).

```bash
npm run dev     # auto-reloads the unpacked extension whenever you save a file
npm run build   # creates dist/Lumina_v<version>.zip for the Chrome Web Store
```

- `npm run dev` starts `watch.js`. The extension connects to it through `dev-reloader.js`, which is loaded only from a source checkout.
- `npm run build` copies just the runtime files into `dist/unpacked`, removes the dev-reloader hook from `background.js`, checks the result (manifest, referenced files, no remote code, no dev leftovers) and zips it. Dev files (`watch.js`, `build.js`, `dev-reloader.js`, `package.json`, docs) are never included.
- To release a new version, change `"version"` in `manifest.json` and run `npm run build` again.

### Tech stack

- **Manifest V3** service worker.
- **Chrome Debugger API** (`Page.captureScreenshot`) for full-page rendering.
- **[Fabric.js](http://fabricjs.com/) 5.3.0** (MIT) for the editor canvas, bundled locally.
- **[jsPDF](https://github.com/parallax/jsPDF) 2.5.1** (MIT) for PDF export, bundled locally. One change was made to the bundled file: the URL of an optional CDN script (`pdfobject`, used by a feature Lumina never calls) was replaced with an empty string, so the package contains no reference to remotely hosted code.
- Plain HTML/CSS/JS, no framework.
