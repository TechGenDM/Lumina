document.addEventListener('DOMContentLoaded', async () => {
    const previewImg = document.getElementById('screenshot-preview');
    const previewWrapper = document.querySelector('.preview-wrapper');
    const previewContainer = document.querySelector('.preview-container');
    const loadingText = document.getElementById('loading');
    const btnPng = document.getElementById('download-png');
    const btnPdf = document.getElementById('download-pdf');
    const btnCopy = document.getElementById('copy-clipboard');
    const metaInfo = document.getElementById('meta-info');
    const zoomControls = document.querySelector('.zoom-controls');
    
    // Zoom Elements
    const btnZoomIn = document.getElementById('zoom-in');
    const btnZoomOut = document.getElementById('zoom-out');
    const btnZoomReset = document.getElementById('zoom-reset');
    const zoomLevelText = document.getElementById('zoom-level-text');

    // Dark Mode Elements
    const btnDarkMode = document.getElementById('toggle-dark-mode');
    const moonIcon = document.getElementById('moon-icon');
    const sunIcon = document.getElementById('sun-icon');

    // Initialize Dark Mode
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.body.classList.add('dark-mode');
        moonIcon.style.display = 'none';
        sunIcon.style.display = 'block';
    }

    btnDarkMode.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        
        if (isDark) {
            localStorage.setItem('theme', 'dark');
            moonIcon.style.display = 'none';
            sunIcon.style.display = 'block';
        } else {
            localStorage.setItem('theme', 'light');
            moonIcon.style.display = 'block';
            sunIcon.style.display = 'none';
        }
    });

    let imageDataUrl = null;
    let imageMeta = null;
    let currentZoom = 1;
    let originalWidth = 0;

    // Plain-language explanations for the error codes sent by background.js
    const ERROR_MESSAGES = {
        restricted: ['This page can\'t be captured', 'Chrome doesn\'t let extensions capture its own pages (like chrome:// pages, the New Tab page or the Chrome Web Store). Open a normal website and click the Lumina icon again.'],
        file: ['Lumina needs permission for local files', 'To capture a file:// page, open chrome://extensions, click Details on Lumina and turn on "Allow access to file URLs". Then try again.'],
        pdf: ['PDF files can\'t be captured', 'Chrome\'s built-in PDF viewer can\'t be captured as a full page. Use the viewer\'s own download or print button instead.'],
        busy: ['Another tool is already attached to this tab', 'Close DevTools or any other extension that is debugging this tab, then click the Lumina icon again.'],
        cancelled: ['Capture was cancelled', 'The capture stopped before it finished, usually because the tab was closed or "Cancel" was clicked on Chrome\'s debugging bar. Click the Lumina icon to try again.'],
        'too-large': ['This page is too large to capture', 'The screenshot was too big to hand over to the viewer. Try a shorter page.'],
        failed: ['Capture failed', 'Something went wrong while capturing this page. Reload the page, wait for it to finish loading and try again. If it keeps happening, use the report button in the top right.']
    };

    function showMessage(title, detail) {
        loadingText.textContent = '';
        const h = document.createElement('p');
        h.className = 'state-title';
        h.textContent = title;
        loadingText.appendChild(h);
        if (detail) {
            const d = document.createElement('p');
            d.className = 'state-detail';
            d.textContent = detail;
            loadingText.appendChild(d);
        }
    }

    function setActionsEnabled(enabled) {
        [btnPng, btnPdf, btnCopy, document.getElementById('edit-btn')].forEach(btn => {
            if (btn) btn.disabled = !enabled;
        });
    }

    // "My Page Title" -> "Lumina_My-Page-Title_2026-01-31_14-05-09"
    function buildFileBase() {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
        const title = ((imageMeta && imageMeta.title) || '')
            .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
        return title ? `Lumina_${title}_${stamp}` : `Lumina_${stamp}`;
    }

    setActionsEnabled(false);
    const errorCode = new URLSearchParams(window.location.search).get('error');

    if (errorCode) {
        const [title, detail] = ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.failed;
        showMessage(title, detail);
    } else try {
        // Fetch screenshot from storage
        const data = await chrome.storage.local.get(['screenshotData', 'screenshotMeta']);

        if (data.screenshotData) {
            imageDataUrl = data.screenshotData;
            imageMeta = data.screenshotMeta || null;

            previewImg.onerror = () => {
                imageDataUrl = null;
                showMessage('Failed to load screenshot', 'The captured image could not be displayed. Please capture the page again.');
            };

            previewImg.onload = () => {
                setActionsEnabled(true);

                const notice = document.getElementById('capture-notice');
                if (notice && imageMeta && (imageMeta.truncated || imageMeta.downscaled)) {
                    notice.textContent = imageMeta.truncated
                        ? 'This page is longer than Chrome can capture in one image (16,384 px), so the bottom was cut off.'
                        : 'This page is very long, so it was captured at standard (1x) resolution to fit in one image.';
                    notice.style.display = 'block';
                }

                const loadingUI = document.getElementById('loading');
                loadingUI.style.opacity = '0';
                setTimeout(() => { loadingUI.style.display = 'none'; }, 300);
                
                previewWrapper.style.display = 'inline-block';
                // Trigger reflow for CSS transition
                void previewWrapper.offsetWidth;
                previewWrapper.classList.add('loaded');
                
                zoomControls.style.display = 'flex';
                
                originalWidth = previewImg.naturalWidth;
                
                // Set meta info
                metaInfo.textContent = `${previewImg.naturalWidth} × ${previewImg.naturalHeight} px`;
                metaInfo.style.display = 'block';

                // Initial Zoom: Fit to screen width if larger
                const containerWidth = previewContainer.clientWidth - 80; // 40px padding each side
                if (originalWidth > containerWidth) {
                    currentZoom = containerWidth / originalWidth;
                } else {
                    currentZoom = 1;
                }
                updateZoom();
            };

            // Set image source (after the handlers are attached) and wait for it to load
            previewImg.src = imageDataUrl;

            // Clear from storage immediately: the screenshot now only lives in this tab's memory
            await chrome.storage.local.remove(['screenshotData', 'screenshotMeta']);
        } else {
            showMessage('No screenshot here', 'Screenshots are kept only while this tab is open, so nothing is left after a reload. Go to the page you want and click the Lumina icon to capture it again.');
        }
    } catch (error) {
        console.error('Error loading screenshot:', error);
        showMessage('Failed to load screenshot', 'Please capture the page again.');
    }

    // --- ZOOM LOGIC ---
    function updateZoom() {
        if (currentZoom < 0.1) currentZoom = 0.1;
        if (currentZoom > 5) currentZoom = 5;
        
        // Directly resize the image element instead of using CSS transform.
        // This forces the wrapper to adapt to the new size and ensures native scrollbars work flawlessly.
        const newWidth = Math.round(originalWidth * currentZoom);
        previewImg.style.width = `${newWidth}px`;
        previewImg.style.height = 'auto';
        
        zoomLevelText.textContent = `${Math.round(currentZoom * 100)}%`;
    }

    btnZoomIn.addEventListener('click', () => {
        currentZoom += 0.1;
        updateZoom();
    });

    btnZoomOut.addEventListener('click', () => {
        currentZoom -= 0.1;
        updateZoom();
    });

    btnZoomReset.addEventListener('click', () => {
        const containerWidth = previewContainer.clientWidth - 80;
        if (originalWidth > containerWidth) {
            currentZoom = containerWidth / originalWidth;
        } else {
            currentZoom = 1;
        }
        updateZoom();
    });

    // --- ACTIONS ---

    // Download PNG Action
    btnPng.addEventListener('click', async () => {
        if (!imageDataUrl) return;
        try {
            // A blob: URL is used because very large data: URLs can fail in the downloads API
            const blob = await (await fetch(imageDataUrl)).blob();
            const blobUrl = URL.createObjectURL(blob);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
            await chrome.downloads.download({
                url: blobUrl,
                filename: `${buildFileBase()}.png`,
                saveAs: true
            });
        } catch (err) {
            // "Save As" dialog dismissed by the user is not an error worth reporting
            if (!/cancel/i.test(String(err && err.message))) {
                console.error('Failed to save PNG:', err);
                alert('Could not save the image. Please try again.');
            }
        }
    });

    // Copy to Clipboard Action
    btnCopy.addEventListener('click', async () => {
        if (!imageDataUrl) return;
        
        try {
            // Fetch the data URL and convert to blob
            const res = await fetch(imageDataUrl);
            const blob = await res.blob();
            
            await navigator.clipboard.write([
                new ClipboardItem({
                    [blob.type]: blob
                })
            ]);
            
            const originalText = btnCopy.innerHTML;
            btnCopy.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg> Copied!`;
            btnCopy.classList.add('btn-success');
            btnCopy.classList.remove('btn-secondary');
            
            setTimeout(() => {
                btnCopy.innerHTML = originalText;
                btnCopy.classList.remove('btn-success');
                btnCopy.classList.add('btn-secondary');
            }, 2000);
            
        } catch (err) {
            console.error('Failed to copy: ', err);
            alert('Could not copy the image to the clipboard. Very large screenshots may be too big to copy. Try Save PNG instead.');
        }
    });

    // Export PDF Action
    btnPdf.addEventListener('click', () => {
        if (!imageDataUrl || !window.jspdf) {
            alert('jsPDF library not found or image not loaded');
            return;
        }
        
        const originalText = btnPdf.innerHTML;
        btnPdf.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></div> Processing...`;
        btnPdf.style.pointerEvents = 'none';

        // Allow UI to update before blocking the thread with heavy canvas processing
        setTimeout(() => {
            try {
                const { jsPDF } = window.jspdf;
                
                const width = previewImg.naturalWidth;
                const height = previewImg.naturalHeight;
                
                let finalDataUrl = imageDataUrl;
                let imageFormat = 'PNG';
                
                try {
                    // Convert PNG to JPEG to avoid jsPDF glitches with transparency and large PNG compression
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    
                    // Fill white background to replace transparency
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(previewImg, 0, 0);
                    
                    const jpegData = canvas.toDataURL('image/jpeg', 0.95);
                    if (jpegData.length > 50) { // Verify it's a valid data URL
                        finalDataUrl = jpegData;
                        imageFormat = 'JPEG';
                    }
                } catch (canvasErr) {
                    console.warn("Canvas JPEG conversion failed, falling back to PNG:", canvasErr);
                }
                
                const orientation = width > height ? 'l' : 'p';

                // A PDF page cannot be larger than 14,400 pt (jsPDF's "px" unit is 0.75 pt).
                // Bigger images are fitted onto a smaller page; no pixels are thrown away.
                const maxPagePx = 14400 / 0.75;
                const fit = Math.min(1, maxPagePx / Math.max(width, height));
                const pageW = width * fit;
                const pageH = height * fit;

                const doc = new jsPDF({
                    orientation: orientation,
                    unit: 'px',
                    format: [pageW, pageH],
                    compress: true
                });

                doc.addImage(finalDataUrl, imageFormat, 0, 0, pageW, pageH);
                doc.save(`${buildFileBase()}.pdf`);
            } catch (err) {
                console.error("PDF generation failed:", err);
                alert("An error occurred while generating the PDF.");
            } finally {
                btnPdf.innerHTML = originalText;
                btnPdf.style.pointerEvents = 'auto';
            }
        }, 50);
    });

    // Edit Action
    const btnEdit = document.getElementById('edit-btn');
    if (btnEdit) {
        btnEdit.addEventListener('click', async () => {
            if (imageDataUrl) {
                // Save the image back to storage so the editor can load it (the editor deletes it again)
                try {
                    await chrome.storage.local.set({ screenshotData: imageDataUrl, screenshotMeta: imageMeta || {} });
                    window.location.href = 'editor.html';
                } catch (err) {
                    console.error('Failed to open editor:', err);
                    alert('Could not open the editor. Please try again.');
                }
            }
        });
    }

    // --- REPORT ISSUE MODAL LOGIC (EmailJS Integration) ---
    // Nothing below runs until the user clicks "Send report".
    // These EmailJS IDs are public by design (EmailJS public key, not the private key).
    const EMAILJS_CONFIG = {
        serviceId: 'service_12guf7m',
        templateId: 'template_6ewzxm6',
        publicKey: 'ols5C-n3p1zJL6m63',
        recipientEmail: 'devasishmishra74@gmail.com'
    };

    const btnReportIssue = document.getElementById('report-issue-btn');
    const reportModal = document.getElementById('report-modal');
    const cancelReport = document.getElementById('cancel-report');
    const sendReport = document.getElementById('send-report');
    const issueDescription = document.getElementById('issue-description');
    const reportUserEmail = document.getElementById('report-user-email');
    const reportStatus = document.getElementById('report-status');

    if (btnReportIssue) {
        btnReportIssue.addEventListener('click', () => {
            reportModal.style.display = 'flex';
            if (reportStatus) {
                reportStatus.textContent = '';
                reportStatus.className = 'report-status-msg';
            }
            // Small delay to allow display:flex to apply before adding transition class
            setTimeout(() => {
                reportModal.classList.add('show');
                if (issueDescription) issueDescription.focus();
            }, 10);
        });
    }

    function closeReportModal() {
        reportModal.classList.remove('show');
        setTimeout(() => {
            reportModal.style.display = 'none';
            if (issueDescription) issueDescription.value = '';
            if (reportUserEmail) reportUserEmail.value = '';
            if (reportStatus) {
                reportStatus.textContent = '';
                reportStatus.className = 'report-status-msg';
            }
        }, 200);
    }

    if (cancelReport) {
        cancelReport.addEventListener('click', closeReportModal);
    }

    if (reportModal) {
        reportModal.addEventListener('click', (e) => {
            if (e.target === reportModal) {
                closeReportModal();
            }
        });
    }

    if (sendReport) {
        sendReport.addEventListener('click', async () => {
            const description = issueDescription.value.trim();
            const userEmail = reportUserEmail ? reportUserEmail.value.trim() : '';

            if (!description) {
                if (reportStatus) {
                    reportStatus.textContent = 'Please enter a description before sending.';
                    reportStatus.className = 'report-status-msg error';
                }
                issueDescription.focus();
                return;
            }

            if (userEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
                if (reportStatus) {
                    reportStatus.textContent = 'That email address doesn\'t look right. Fix it or leave it empty.';
                    reportStatus.className = 'report-status-msg error';
                }
                reportUserEmail.focus();
                return;
            }

            // If sending fails, offer a pre-filled email link instead
            const showMailFallback = (prefix) => {
                const mailSubject = encodeURIComponent('Lumina Issue Report');
                const mailBody = encodeURIComponent(`Issue:\n${description}\n\nBrowser: ${navigator.userAgent}\nTime: ${new Date().toLocaleString()}`);
                const mailtoLink = `mailto:${EMAILJS_CONFIG.recipientEmail}?subject=${mailSubject}&body=${mailBody}`;
                if (reportStatus) {
                    reportStatus.textContent = prefix + ' ';
                    const link = document.createElement('a');
                    link.href = mailtoLink;
                    link.textContent = 'Click here to email us directly instead.';
                    link.style.cssText = 'color:#4fc3f7;text-decoration:underline;';
                    reportStatus.appendChild(link);
                    reportStatus.className = 'report-status-msg error';
                }
                sendReport.disabled = false;
                sendReport.innerHTML = originalBtnText;
            };

            // UI Sending State
            const originalBtnText = sendReport.innerHTML;
            sendReport.disabled = true;
            sendReport.innerHTML = '<span style="display:inline-block;animation:mac-spin 1s linear infinite;margin-right:6px;">↻</span> Sending...';
            if (reportStatus) {
                reportStatus.textContent = 'Sending report...';
                reportStatus.className = 'report-status-msg';
            }

            try {
                // Direct EmailJS REST API Call (Manifest V3 compliant, zero external scripts required)
                const payload = {
                    service_id: EMAILJS_CONFIG.serviceId,
                    template_id: EMAILJS_CONFIG.templateId,
                    user_id: EMAILJS_CONFIG.publicKey,
                    template_params: {
                        message: description,
                        user_email: userEmail || 'Anonymous User',
                        reply_to: userEmail || 'noreply@lumina.local',
                        to_email: EMAILJS_CONFIG.recipientEmail,
                        browser_info: navigator.userAgent,
                        timestamp: new Date().toLocaleString()
                    }
                };

                const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    if (reportStatus) {
                        reportStatus.textContent = '✓ Report sent successfully! Thank you.';
                        reportStatus.className = 'report-status-msg success';
                    }
                    sendReport.innerHTML = '✓ Sent!';
                    setTimeout(() => {
                        closeReportModal();
                        sendReport.disabled = false;
                        sendReport.innerHTML = originalBtnText;
                    }, 1800);
                } else {
                    console.error('EmailJS error:', response.status, await response.text());
                    showMailFallback('Service temporarily unavailable.');
                }
            } catch (err) {
                console.error('Network error sending report:', err);
                showMailFallback('Network error.');
            }
        });
    }
});
