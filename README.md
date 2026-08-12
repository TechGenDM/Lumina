# 📸 Lumina

A sleek, professional Chrome extension built on Manifest V3 that captures high-fidelity full-page screenshots seamlessly. Bypassing standard viewport limitations, this tool natively captures the entire document from top to bottom, handling lazy-loaded content, and serves it to you in a stunning, premium interface.

## ✨ Features

- **Full-Page Fidelity**: Captures the entire scrolling page accurately without stitching errors or cut-offs.
- **Lazy-Load Support**: Automatically scrolls through the page behind the scenes to trigger and capture lazy-loaded images and dynamic content before snapping.
- **Premium User Interface**: Features a beautiful "Mac-Style Minimalist" preview canvas with frosted glass toolbars, diffused drop shadows, and fluid animations.
- **True Dark Mode**: Seamlessly toggle between an airy light mode and a premium true-black dark mode aesthetic.
- **Versatile Exports**: Download your captures as a crisp PNG image, export them to a high-quality PDF document, or copy them directly to your clipboard with one click.
- **100% Local**: No external servers, APIs, or trackers. Everything happens natively on your device ensuring total privacy.

---

## 🚀 Installation Guide

Since this is a custom-built Chrome extension, you can easily install it on any laptop or desktop running Google Chrome, Microsoft Edge, Brave, or any Chromium-based browser.

1. **Download the Extension:**
   - Clone or download this entire folder to a safe location on your computer (e.g., your Documents folder).

2. **Open the Extensions Page:**
   - Open your browser and type `chrome://extensions/` into the URL address bar and hit **Enter**.

3. **Enable Developer Mode:**
   - In the top right corner of the Extensions page, you will see a toggle switch labeled **Developer mode**. Turn this **ON**.

4. **Load the Extension:**
   - Click the new **Load unpacked** button that appears in the top left.
   - Navigate to the folder you downloaded in Step 1, select the `FullPageScreenshot` folder (the one containing `manifest.json`), and click **Select/Open**.

5. **Pin the Extension (Recommended):**
   - Click the "Puzzle Piece" icon in your browser toolbar (top right).
   - Find "Pro Full-Page Screenshot" and click the **Pin** icon next to it for easy access.

---

## 🛠️ How to Use

1. Navigate to any web page you want to capture.
2. Click the glowing **Pro Capture icon** in your browser toolbar.
3. Wait a brief moment. You may see the page quickly scroll down to load all content.
4. A new tab will automatically open displaying the **Premium Output Preview**.
5. From the toolbar, you can:
   - 🌓 **Toggle Dark Mode**
   - 📋 **Copy to Clipboard**
   - 🖼️ **Save as PNG**
   - 📄 **Export as PDF**
6. Use the floating zoom controls at the bottom to inspect the high-resolution capture!

---

## 👨‍💻 Tech Stack
- **Manifest V3** compliant.
- **Chrome Debugger API** for protocol-level rendering and viewport emulation.
- **jsPDF** for client-side PDF document generation.
- Vanilla HTML/CSS/JS (Zero framework overhead for maximum performance).
