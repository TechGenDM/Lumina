# Lumina Privacy Policy

**Effective Date:** November 15, 2026

## 1. Summary
Lumina captures full-page screenshots and lets you annotate and export them. Capturing, cropping, blurring, annotating and exporting all happen **locally on your device**.

Lumina sends data over the internet in **one situation only**: when you fill in the "Report an Issue" form and click **Send report** (see section 4). Your screenshots and the pages you capture are never sent anywhere.

Lumina has no accounts, no analytics, no advertising and no tracking.

## 2. Data Handled on Your Device
- **Screenshots.** When you click the Lumina icon, the image of the current page is created on your device. To hand it from the capture step to the viewer tab, it is placed in the extension's local storage for a moment and **deleted as soon as the viewer (or editor) has loaded it**. After that it exists only in the memory of that tab and is gone when you close or reload the tab, unless you save it yourself.
- **Page address and title.** The address (URL) and title of the captured page are stored together with the screenshot, for the same short time, so the editor can show where the capture came from and suggest a file name. They are deleted together with the screenshot and never leave your device.
- **Theme preference.** Your light/dark mode choice is saved in the browser's local storage for the extension.

None of this information is transmitted to the developer or to any third party.

## 3. Chrome Extension Permissions Explained
- **`activeTab`**: gives Lumina temporary access to the tab you are on, only when you click the extension icon, so it can read that page's address and title and capture it.
- **`debugger`**: used only at the moment you click the icon, to ask Chrome to render the whole page (including the part below the visible area) into one image. Lumina attaches to the current tab, takes the screenshot and detaches immediately. It does not read or change page content beyond what is needed to scroll and measure the page.
- **`downloads`**: lets you save your PNG files to your computer with a "Save As" dialog.
- **`storage` / `unlimitedStorage`**: used to pass the screenshot from the capture step to the viewer and editor. Full-page screenshots are often larger than Chrome's default storage limit, which is why `unlimitedStorage` is needed. The data is deleted right after it is read (see section 2).

Lumina does not request access to any websites ("host permissions").

## 4. "Report an Issue" Feature
This feature is optional. Nothing is sent until you click **Send report**. When you do, the following is sent:
- the message you typed;
- your email address, **only if you choose to enter one** (so the developer can reply);
- your browser's user-agent string (browser and operating system version), to help reproduce the problem;
- the date and time of the report.

The report is transmitted over HTTPS through [EmailJS](https://www.emailjs.com/), a third-party email delivery service, which forwards it to the developer's email inbox. EmailJS processes the report on the developer's behalf under its own [privacy policy](https://www.emailjs.com/legal/privacy-policy/).

This information is used **only to provide support and fix bugs**. It is not sold, not used for advertising, and not shared with anyone else. Screenshots, page addresses and page content are never included in a report. To have a report you sent deleted, contact the developer at the address below.

## 5. Third Parties and Limited Use
EmailJS (section 4) is the only third-party service Lumina communicates with. The extension contains no analytics, trackers, advertising or remotely loaded code.

Lumina's use of information complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## 6. Changes to This Policy
If this policy changes, the updated version will be published at this address with a new effective date.

## 7. Contact
If you have any questions or concerns about this Privacy Policy, please contact the developer at:
**devasishmishra74@gmail.com**
