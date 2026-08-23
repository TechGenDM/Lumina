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
    let currentZoom = 1;
    let originalWidth = 0;
    
    try {
        // Fetch screenshot from storage
        const data = await chrome.storage.local.get('screenshotData');
        
        if (data.screenshotData) {
            imageDataUrl = data.screenshotData;
            
            // Set image source and wait for it to load
            previewImg.src = imageDataUrl;
            
            previewImg.onload = () => {
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

            // Clear from storage immediately to free memory
            await chrome.storage.local.remove('screenshotData');
        } else {
            loadingText.innerHTML = 'No screenshot found.';
        }
    } catch (error) {
        console.error('Error loading screenshot:', error);
        loadingText.innerHTML = 'Failed to load screenshot.';
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
    btnPng.addEventListener('click', () => {
        if (!imageDataUrl) return;
        chrome.downloads.download({
            url: imageDataUrl,
            filename: `screenshot_${Date.now()}.png`,
            saveAs: true
        });
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
            alert('Failed to copy to clipboard. Ensure you have given clipboard permissions.');
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
                
                const doc = new jsPDF({
                    orientation: orientation,
                    unit: 'px',
                    format: [width, height],
                    compress: true
                });
                
                doc.addImage(finalDataUrl, imageFormat, 0, 0, width, height);
                doc.save(`screenshot_${Date.now()}.pdf`);
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
                // Save the image back to storage so the editor can load it
                await chrome.storage.local.set({ screenshotData: imageDataUrl });
                window.location.href = 'editor.html';
            }
        });
    }

    // --- REPORT ISSUE MODAL LOGIC (EmailJS Integration) ---
    // Configuration for EmailJS
    const EMAILJS_CONFIG = {
        serviceId: 'service_12guf7m',        // Your Gmail Service ID from EmailJS
        templateId: 'YOUR_TEMPLATE_ID',      // Replace with your EmailJS Template ID (from Email Templates tab)
        publicKey: 'YOUR_PUBLIC_KEY',        // Replace with your EmailJS Public Key (from Account > API Keys)
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

            // Check if user still has placeholder keys
            if (EMAILJS_CONFIG.templateId === 'YOUR_TEMPLATE_ID' || EMAILJS_CONFIG.publicKey === 'YOUR_PUBLIC_KEY') {
                console.warn('EmailJS templateId or publicKey is still set to placeholder values.');
            }

            // UI Sending State
            const originalBtnText = sendReport.innerHTML;
            sendReport.disabled = true;
            sendReport.innerHTML = '<span style="display:inline-block;animation:mac-spin 1s linear infinite;margin-right:6px;">↻</span> Sending...';
            if (reportStatus) {
                reportStatus.textContent = 'Sending report directly to devasishmishra74@gmail.com...';
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
                        reportStatus.textContent = '✓ Report sent directly to devasishmishra74@gmail.com! Thank you.';
                        reportStatus.className = 'report-status-msg success';
                    }
                    sendReport.innerHTML = '✓ Sent!';
                    setTimeout(() => {
                        closeReportModal();
                        sendReport.disabled = false;
                        sendReport.innerHTML = originalBtnText;
                    }, 1800);
                } else {
                    const errText = await response.text();
                    console.error('EmailJS Error:', errText);
                    if (reportStatus) {
                        reportStatus.textContent = `Failed to send: ${errText || 'Please verify EmailJS Template ID / Public Key'}`;
                        reportStatus.className = 'report-status-msg error';
                    }
                    sendReport.disabled = false;
                    sendReport.innerHTML = originalBtnText;
                }
            } catch (err) {
                console.error('Network Error sending report:', err);
                if (reportStatus) {
                    reportStatus.textContent = 'Network error while sending report. Please try again.';
                    reportStatus.className = 'report-status-msg error';
                }
                sendReport.disabled = false;
                sendReport.innerHTML = originalBtnText;
            }
        });
    }
});
