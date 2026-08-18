// MetaGen Pro - File Handler Module
document.addEventListener('DOMContentLoaded', function () {

    const previewContainer = document.getElementById('filePreviewContainer');
    const processAllButton = document.getElementById('processAllButton');
    const processAllPromptsButton = document.getElementById('processAllPromptsButton');
    const exportButton = document.getElementById('exportButton');
    const embedMetadataButton = document.getElementById('embedMetadataButton');
    const clearAllButton = document.getElementById('clearAllButton');
    if (!window.uploadedFilesData) window.uploadedFilesData = [];
    const uploadedFilesData = window.uploadedFilesData;

    const jpgPngButton = document.getElementById('jpgPngUploadButton');
    const jpgPngInput = document.getElementById('jpgPngInput');
    const svgEpsButton = document.getElementById('svgEpsUploadButton');
    const svgEpsInput = document.getElementById('svgEpsInput');
    const videoButton = document.getElementById('videoUploadButton');
    const videoInput = document.getElementById('videoInput');
    // ==========================================
    // VECTOR CHECKLIST ANALYSIS FUNCTIONS
    // ==========================================

    window.analyzeSvgFile = async function (file) {
        try {
            const text = await file.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'image/svg+xml');

            // Check for parsing errors
            const parserError = doc.querySelector('parsererror');
            if (parserError) {
                console.warn('SVG parsing error:', parserError.textContent);
            }

            return {
                noGradientMesh: checkNoGradientMesh(doc, text),
                textOutlined: checkTextOutlined(doc, text),
                noRasterImage: checkNoRasterImage(doc),
                strokeExpanded: checkStrokeExpanded(doc, text),
                transparencyFound: checkTransparency(doc, text)
            };
        } catch (error) {
            console.error('Error analyzing SVG:', error);
            return {
                noGradientMesh: { pass: false, status: 'warning' },
                textOutlined: { pass: false, status: 'warning' },
                noRasterImage: { pass: false, status: 'warning' },
                strokeExpanded: { pass: false, status: 'warning' },
                transparencyFound: { pass: false, status: 'warning' }
            };
        }
    }

    function checkNoGradientMesh(doc, text) {
        // Check for mesh gradients (not widely supported)
        const hasMeshGradient = text.includes('<meshgradient') ||
            text.includes('mesh') ||
            doc.querySelector('meshgradient');
        return {
            pass: !hasMeshGradient,
            status: hasMeshGradient ? 'fail' : 'pass'
        };
    }

    function checkTextOutlined(doc, text) {
        // Check if there are any <text> elements (should be converted to paths)
        const textElements = doc.querySelectorAll('text');
        const hasTextTag = text.includes('<text');

        return {
            pass: textElements.length === 0 && !hasTextTag,
            status: (textElements.length > 0 || hasTextTag) ? 'fail' : 'pass'
        };
    }

    function checkNoRasterImage(doc) {
        // Check for embedded raster images
        const imageElements = doc.querySelectorAll('image');
        const hasRaster = Array.from(imageElements).some(img => {
            const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
            return href.includes('data:image') || href.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        });

        return {
            pass: !hasRaster,
            status: hasRaster ? 'fail' : 'pass'
        };
    }

    function checkStrokeExpanded(doc, text) {
        // Check if strokes are expanded to paths (no stroke attributes should remain)
        const elementsWithStroke = doc.querySelectorAll('[stroke]');
        const hasStrokeInStyle = text.includes('stroke:') || text.includes('stroke-width');

        // Allow 'none' strokes
        const hasActiveStroke = Array.from(elementsWithStroke).some(el => {
            const stroke = el.getAttribute('stroke');
            return stroke && stroke !== 'none';
        });

        return {
            pass: !hasActiveStroke && !hasStrokeInStyle,
            status: (hasActiveStroke || hasStrokeInStyle) ? 'warning' : 'pass'
        };
    }

    function checkTransparency(doc, text) {
        // Check for transparency/opacity (can cause issues on some platforms)
        const hasOpacity = text.includes('opacity') ||
            text.includes('fill-opacity') ||
            text.includes('stroke-opacity');
        const opacityElements = doc.querySelectorAll('[opacity], [fill-opacity], [stroke-opacity]');

        return {
            pass: hasOpacity || opacityElements.length > 0,
            status: (hasOpacity || opacityElements.length > 0) ? 'warning' : 'pass'
        };
    }

    window.showVectorChecklist = function (filename, results) {
        const modal = document.getElementById('vectorChecklistModal');
        const filenameDiv = document.getElementById('checklistFilename');
        const resultsDiv = document.getElementById('checklistResults');

        filenameDiv.textContent = filename;

        const checks = [
            { key: 'noGradientMesh', label: 'No gradient mesh', emoji: '🎨' },
            { key: 'textOutlined', label: 'Text outlined', emoji: '📝' },
            { key: 'noRasterImage', label: 'No raster image', emoji: '🖼️' },
            { key: 'strokeExpanded', label: 'Stroke expanded', emoji: '✏️' },
            { key: 'transparencyFound', label: 'Transparency found', emoji: '👁️' }
        ];

        resultsDiv.innerHTML = checks.map(check => {
            const result = results[check.key];
            const icon = result.status === 'pass' ? '✓' :
                result.status === 'warning' ? '⚠' : '✗';
            const statusClass = `check-${result.status}`;

            return `
                        <div class="checklist-item ${statusClass}">
                            <span class="check-icon">${icon}</span>
                            <span class="check-label">${check.emoji} ${check.label}</span>
                        </div>
                    `;
        }).join('');

        modal.style.display = 'flex';
    }

    // Checklist modal event handlers
    let pendingVectorFile = null;
    let pendingVectorFiles = [];

    const checklistContinueBtn = document.getElementById('checklistContinueBtn');
    const checklistCancelBtn = document.getElementById('checklistCancelBtn');
    const vectorChecklistModal = document.getElementById('vectorChecklistModal');

    if (checklistContinueBtn) {
        checklistContinueBtn.onclick = async () => {
            vectorChecklistModal.style.display = 'none';

            // Process all pending vector files from batch
            if (pendingVectorFiles && pendingVectorFiles.length > 0) {
                for (const { file } of pendingVectorFiles) {
                    await processVectorFile(file);
                }
                pendingVectorFiles = [];
            }
            // Fallback for single file (legacy)
            else if (pendingVectorFile) {
                await processVectorFile(pendingVectorFile);
                pendingVectorFile = null;
            }
        };
    }

    if (checklistCancelBtn) {
        checklistCancelBtn.onclick = () => {
            vectorChecklistModal.style.display = 'none';
            pendingVectorFile = null;
            pendingVectorFiles = [];
        };
    }
    // --- FILE UPLOAD BUTTONS ---
    if (jpgPngButton && jpgPngInput) jpgPngButton.onclick = () => jpgPngInput.click();
    if (svgEpsButton && svgEpsInput) svgEpsButton.onclick = () => svgEpsInput.click();
    if (videoButton && videoInput) videoButton.onclick = () => videoInput.click();

    // --- FILE INPUT CHANGE ---
    if (jpgPngInput) jpgPngInput.onchange = (e) => handleFiles(e.target.files);
    if (svgEpsInput) svgEpsInput.onchange = (e) => handleFiles(e.target.files);
    if (videoInput) videoInput.onchange = (e) => handleFiles(e.target.files);

    const folderButton = document.getElementById('folderUploadButton');
    const folderInput = document.getElementById('folderInput');

    if (folderButton && folderInput) {
        folderButton.onclick = () => folderInput.click();
        folderInput.onchange = (e) => handleFiles(e.target.files);
    }

    // --- DRAG & DROP ---
    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, preventDefaults, false));
        function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
        ['dragenter', 'dragover'].forEach(eventName => dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false));
        ['dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false));

        async function traverseFileTree(item, path = '') {
            return new Promise((resolve) => {
                if (!item) {
                    resolve([]);
                    return;
                }
                if (item.isFile) {
                    item.file((file) => {
                        // Preserve full path for FTP & processing 
                        file.customPath = path + file.name;
                        resolve([file]);
                    });
                } else if (item.isDirectory) {
                    const dirReader = item.createReader();
                    const entries = [];
                    const readEntries = () => {
                        dirReader.readEntries(async (results) => {
                            if (!results.length) {
                                let allFiles = [];
                                for (const entry of entries) {
                                    const subFiles = await traverseFileTree(entry, path + item.name + "/");
                                    allFiles.push(...subFiles);
                                }
                                resolve(allFiles);
                            } else {
                                entries.push(...results);
                                readEntries();
                            }
                        });
                    };
                    readEntries();
                } else {
                    resolve([]);
                }
            });
        }

        dropZone.addEventListener('drop', async (event) => {
            if (event.dataTransfer && event.dataTransfer.items) {
                const items = event.dataTransfer.items;
                let allFiles = [];
                const promises = [];
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                    if (entry) {
                        promises.push(traverseFileTree(entry));
                    } else if (item.kind === 'file') {
                        const file = item.getAsFile();
                        if (file) {
                            file.customPath = file.name;
                            allFiles.push(file);
                        }
                    }
                }
                if (promises.length > 0) {
                    const resolvedFiles = await Promise.all(promises);
                    for (const files of resolvedFiles) {
                        allFiles.push(...files);
                    }
                }
                if (allFiles.length > 0) {
                    handleFiles(allFiles);
                } else if (event.dataTransfer.files.length > 0) {
                    handleFiles(event.dataTransfer.files);
                }
            } else if (event.dataTransfer && event.dataTransfer.files.length) {
                handleFiles(event.dataTransfer.files);
            }
        }, false);
    }

    // --- HANDLE FILES (EPS Support Improved) ---
    function base64ToFile(base64, filename) {
        const byteString = atob(base64);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: 'image/png' });
        return new File([blob], filename, { type: 'image/png' });
    }
    window.handleFiles = async function handleFiles(files) {
        if (files.length === 0) return;

        // 🟠 IMMEDIATE UI FEEDBACK: Hide upload section and show Add More button
        const uploadSection = document.querySelector('.file-upload-section');
        const addMoreBtn = document.getElementById('addMoreFilesButton');
        const previewContainer = document.getElementById('filePreviewContainer');

        if (uploadSection) uploadSection.style.display = 'none';
        if (addMoreBtn) addMoreBtn.style.display = 'inline-flex';

        // Show a global loading state if needed, or rely on individual card spinners
        // (Individual cards have spinners by default)

        const user = auth.currentUser;

        // Get usage synchronously from global state to avoid blocking file load
        let usage = window.userUsageData || { plan: 'free', limit: 10 };
        let currentPlan = 'free';
        if (usage.plan) {
            const rawPlan = String(usage.plan).toLowerCase().trim();
            if (rawPlan.includes('premium')) currentPlan = 'premium';
            else if (rawPlan.includes('pro')) currentPlan = 'pro';
        } else if (usage.limit) {
            if (usage.limit >= 100) currentPlan = 'premium';
            else if (usage.limit >= 70) currentPlan = 'pro';
        }

        let maxFiles = 50;
        if (currentPlan === 'free') {
            maxFiles = usage.limit || 10;
        } else if (currentPlan === 'pro') {
            maxFiles = 200;
        } else if (currentPlan === 'premium') {
            maxFiles = 300;
        }

        if (files.length > maxFiles) {
            alert(`Your ${currentPlan.toUpperCase()} plan allows processing up to ${maxFiles} files at once. You selected ${files.length} files. Please reduce the number of files or upgrade.`);

            // Restore upload section if rejected
            if (uploadedFilesData.length === 0 && uploadSection) uploadSection.style.display = 'flex';
            if (addMoreBtn) addMoreBtn.style.display = 'none';
            return;
        }

        // In the background, fetch fresh usage without blocking rendering
        if (user && user.email) {
            getMetadataUsage(user.email).then(freshUsage => {
                window.userUsageData = { ...freshUsage, email: user.email };
                if (typeof updateUsageUI === 'function') {
                    updateUsageUI();
                }
            }).catch(e => console.warn("Background usage check failed:", e));
        }

        // Separate vector and non-vector files
        const vectorFiles = [];
        const normalFiles = [];

        for (const file of files) {
            const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
            const isEps = file.name.toLowerCase().endsWith('.eps');

            if (isSvg || isEps) {
                vectorFiles.push(file);
            } else {
                normalFiles.push(file);
            }
        }

        // Process vector files with batch checklist (Only if Copyright Check is Enabled)
        const copyrightToggle = document.getElementById('copyrightToggle');
        const isCopyrightCheckEnabled = copyrightToggle ? copyrightToggle.checked : false;

        if (vectorFiles.length > 0) {
            if (isCopyrightCheckEnabled) {
                await showBatchVectorChecklist(vectorFiles);
                return; // Wait for user to click Continue/Cancel
            } else {
                // Toggle OFF: Process vectors in parallel
                vectorFiles.map(file => processVectorFile(file));
            }
        }

        // Process normal files in parallel
        normalFiles.map(file => processVectorFile(file));
    }

    // Show batch checklist for multiple vector files
    async function showBatchVectorChecklist(files) {
        const analysisResults = [];

        for (const file of files) {
            const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');

            if (isSvg) {
                const results = await analyzeSvgFile(file);
                analysisResults.push({ file, results });
            } else {
                // EPS - generic warnings
                analysisResults.push({
                    file,
                    results: {
                        noGradientMesh: { pass: true, status: 'warning' },
                        textOutlined: { pass: true, status: 'warning' },
                        noRasterImage: { pass: true, status: 'warning' },
                        strokeExpanded: { pass: true, status: 'warning' },
                        transparencyFound: { pass: true, status: 'warning' }
                    }
                });
            }
        }

        displayBatchChecklist(analysisResults);
        pendingVectorFiles = analysisResults;
    }

    // Display batch checklist in modal
    function displayBatchChecklist(analysisResults) {
        const modal = document.getElementById('vectorChecklistModal');
        const titleElem = modal.querySelector('h3');
        const resultsDiv = document.getElementById('checklistResults');

        // Update title based on count
        const fileCount = analysisResults.length;
        titleElem.textContent = fileCount === 1
            ? '📋 Vector File Quality Checklist'
            : `📋 Vector Files Quality Checklist (${fileCount} files)`;

        // Generate checklist for each file
        resultsDiv.innerHTML = `
                    <div class="checklist-files-container">
                        ${analysisResults.map(({ file, results }, index) => {
            const checks = [
                { key: 'noGradientMesh', label: 'No gradient mesh', emoji: '🎨' },
                { key: 'textOutlined', label: 'Text outlined', emoji: '📝' },
                { key: 'noRasterImage', label: 'No raster image', emoji: '🖼️' },
                { key: 'strokeExpanded', label: 'Stroke expanded', emoji: '✏️' },
                { key: 'transparencyFound', label: 'Transparency found', emoji: '👁️' }
            ];

            return `
                                <div class="checklist-file-block">
                                    <div class="checklist-file-header">
                                        <span class="checklist-file-number">#${index + 1}</span>
                                        <span class="checklist-file-name">${file.name}</span>
                                    </div>
                                    <div class="checklist-results">
                                        ${checks.map(check => {
                const result = results[check.key];
                const icon = result.status === 'pass' ? '✓' :
                    result.status === 'warning' ? '⚠' : '✗';
                const statusClass = `check-${result.status}`;

                return `
                                                <div class="checklist-item ${statusClass}">
                                                    <span class="check-icon">${icon}</span>
                                                    <span class="check-label">${check.emoji} ${check.label}</span>
                                                </div>
                                            `;
            }).join('')}
                                    </div>
                                </div>
                            `;
        }).join('')}
                    </div>
                `;

        modal.style.display = 'flex';
    }


    // Extract Preview from Video file
    async function extractVideoPreview(videoFile) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.src = URL.createObjectURL(videoFile);

            video.onloadedmetadata = () => {
                const duration = (isNaN(video.duration) || !isFinite(video.duration) || video.duration === 0) ? 2 : video.duration;
                const seekTime = Math.min(1, duration * 0.1);
                video.currentTime = seekTime;
            };

            video.onseeked = () => {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                const isVertical = video.videoWidth < video.videoHeight;

                canvas.toBlob((blob) => {
                    URL.revokeObjectURL(video.src);
                    if (blob) {
                        const f = new File([blob], videoFile.name + ".jpg", { type: 'image/jpeg' });
                        f.isVertical = isVertical;
                        resolve(f);
                    } else {
                        reject(new Error("Failed to extract video frame"));
                    }
                }, 'image/jpeg', 0.9);
            };

            video.onerror = (e) => {
                URL.revokeObjectURL(video.src);
                reject(new Error("Video load error: " + (video.error ? video.error.message : 'Unknown error')));
            };
        });
    }


    // Extract Preview from AI (PDF-compatible) file
    async function extractAiPreview(aiFile) {
        // Initialize PDF.js
        const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
        if (!pdfjsLib) throw new Error("PDF.js library not loaded");

        // Ensure worker is set correctly
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        try {
            const arrayBuffer = await aiFile.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer); // FIX: Convert to Uint8Array for strict parsing

            const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);

            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            return new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        const file = new File([blob], aiFile.name.replace(/\.ai$/i, '.png'), { type: "image/png" });
                        resolve(file);
                    } else {
                        reject(new Error("Canvas to Blob conversion failed"));
                    }
                }, 'image/png');
            });
        } catch (error) {
            console.error("PDF.js extraction error:", error);
            throw new Error("Invalid PDF Structure. Falling back to server render.");
        }
    }

    // Function to upscale image using ClipDrop
    async function upscaleImageToClipDrop(cardId, file) {
        const upscaleBtn = document.getElementById(`upscale-btn-${cardId}`);
        const originalText = upscaleBtn.innerHTML;
        const spinner = document.querySelector(`#${cardId} .image-spinner`);

        try {
            upscaleBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Upscaling...';
            upscaleBtn.disabled = true;
            if (spinner) spinner.style.display = 'block';

            // Get Firebase auth token
            const user = auth.currentUser;
            if (!user) {
                alert('Please sign in to use the Upscale feature.');
                upscaleBtn.innerHTML = originalText;
                upscaleBtn.disabled = false;
                if (spinner) spinner.style.display = 'none';
                return;
            }
            const idToken = await user.getIdToken();

            // Calculate target dimensions (2x upscale, capped at 4096)
            const imgEl = document.querySelector(`#${cardId} .thumbnail-medium`);
            const origW = imgEl ? imgEl.naturalWidth : 1024;
            const origH = imgEl ? imgEl.naturalHeight : 1024;
            let targetW = origW * 2;
            let targetH = origH * 2;
            if (targetW > 4096 || targetH > 4096) {
                const scale = 4096 / Math.max(targetW, targetH);
                targetW = Math.round(targetW * scale);
                targetH = Math.round(targetH * scale);
            }

            const formData = new FormData();
            formData.append('image_file', file);
            formData.append('target_width', String(targetW));
            formData.append('target_height', String(targetH));

            const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/clipdrop/upscale', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + idToken },
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const upscaledBlob = await response.blob();

            // Create a new File object from the upscaled blob
            const upscaledFile = new File([upscaledBlob], file.name, { type: upscaledBlob.type || file.type });

            // Replace image source in UI
            const imgElement = document.querySelector(`#${cardId} .thumbnail-medium`);
            if (imgElement) {
                const url = URL.createObjectURL(upscaledFile);
                imgElement.src = url;
            }

            // Update fileObject in uploadedFilesData so Embed Metadata uses the upscaled version
            const fileDataEntry = uploadedFilesData.find(f => f.id === cardId);
            if (fileDataEntry) {
                fileDataEntry.fileObject = upscaledFile;
            }

            // Hide the button after successful upscale
            upscaleBtn.style.display = 'none';

        } catch (error) {
            console.error('Error upscaling image:', error);
            alert('Failed to upscale image. Please try again.\n' + error.message);
            upscaleBtn.innerHTML = originalText;
            upscaleBtn.disabled = false;
        } finally {
            if (spinner) spinner.style.display = 'none';
        }
    }


    // Helper to capture a small thumbnail for history
    function captureThumbnail(cardId, size = 120) {
        const img = document.querySelector(`#${cardId} .thumbnail-medium`);
        if (!img || !img.complete || img.naturalWidth === 0) return null;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Keep aspect ratio
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > h) {
            h = (h / w) * size;
            w = size;
        } else {
            w = (w / h) * size;
            h = size;
        }

        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        return canvas.toDataURL('image/jpeg', 0.7);
    }

    // Process file after checklist approval or for non-vector files
    window.processVectorFile = async function (file) {
        const card = document.createElement('div');
        card.className = 'file-preview-card';
        card.id = 'file-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
        const isEps = file.name.toLowerCase().endsWith('.eps');
        const isAi = file.name.toLowerCase().endsWith('.ai');
        const isVideo = file.type.startsWith('video/') || ['mp4', 'mov', 'avi', 'webm', 'mkv'].some(ext => file.name.toLowerCase().endsWith('.' + ext));
        const placeholderSrc = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48L3N2Zz4=`;

        const sizeStr = file.size < 1024 * 1024
            ? (file.size / 1024).toFixed(1) + ' KB'
            : (file.size / (1024 * 1024)).toFixed(1) + ' MB';

        window.processVectorFile = processVectorFile;

        card.innerHTML = `
                    <div class="card-image-col">
                        <div class="card-checkbox-container">
                            <input type="checkbox" class="bulk-checkbox" data-file-id="${card.id}" onchange="handleCheckboxChange()">
                        </div>
                        <div class="card-image-actions">
                            <button class="card-image-action-btn regenerate" title="Regenerate" onclick="regenerateMetadata(this)"><span style="font-size:1.1em;">&#x21bb;</span></button>
                            <button class="card-image-action-btn close" title="Close" onclick="closeCard(this)"><span style="font-size:1.1em;">&#x2716;</span></button>
                        </div>
                        <img loading='lazy' src="${placeholderSrc}" alt="${file.name}" class="thumbnail-medium" style="position: relative; overflow: hidden; border-radius: 12px;">

                        <!-- Quality Scan Overlay -->
                        <div id="qualityScanOverlay-${card.id}" class="sales-scan-overlay" style="display:none; z-index: 9;">
                            <div class="sales-scan-line"></div>
                        </div>
                        
                        <!-- Image Properties Overlay -->
                        <div class="image-properties-overlay">
                            <div class="prop-row"><span class="prop-label">Name:</span><span class="prop-value">${file.name}</span></div>
                            <div class="prop-row"><span class="prop-label">Size:</span><span class="prop-value">${sizeStr}</span></div>
                            <div class="prop-row"><span class="prop-label">Type:</span><span class="prop-value">${file.type || 'N/A'}</span></div>
                            <div class="prop-row"><span class="prop-label">Dims:</span><span class="prop-value" id="dims-${card.id}">...</span></div>
                        </div>

                        ${isAi ? '<div class="file-type-badge ai-badge" style="position: absolute; top: 10px; left: 10px; padding: 4px 8px; border-radius: 4px; font-size: 0.7em; font-weight: bold; background: #FF7F18; color: white;">AI</div>' : ''}
                        ${isVideo ? '<div class="file-type-badge video-badge" style="position: absolute; top: 15px; left: 46px; padding: 4px 8px; border-radius: 4px; font-size: 0.7em; font-weight: bold; background: #EF4444; color: white; z-index: 1000;">VIDEO</div>' : ''}
                        <div class="image-spinner" style="display:block;"></div>
                        
                        <!-- Copyright Status -->
                        <div id="copyright-status-${card.id}" class="copyright-status-container" style="margin-top: 2px; background: var(--bg-input); border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3); padding: 4px 12px; border-radius: 14px; text-align: center;">
                            <div class="copyright-badge copyright-checking">
                                <span class="image-spinner" style="display:inline-block; width:30px; height:30px; border-width:5px; margin:0;"></span> Checking Copyright...
                            </div>
                        </div>

                        <!-- Quality Status Badge (Bottom) -->
                        <div id="quality-status-container-${card.id}" class="quality-status-container" style="position: relative; left: 0; right: 0; width: 100%; text-align: center; z-index: 10;">
                            <div class="quality-status-badge pending" id="quality-badge-${card.id}" style="backdrop-filter: blur(25px); margin-top: 2px; background: var(--bg-input); border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 4px 15px rgba(0,0,0,0.3); padding: 5px 12px; font-size: 0.7em; color: #0eb17c; font-weight: 800;">
                                <i class="fas fa-microscope"></i> <span data-i18n="quality_pending">Quality: Pending</span>
                            </div>
                        </div>

                        <!-- SEO Score Meter -->
                        <div class="seo-meter-container" id="seo-meter-${card.id}" style="display:none;">
                            <div class="locked-overlay" id="seo-lock-${card.id}" style="display:none;" onclick="showProUpgradeAlert()">
                                <div class="lock-icon" title="Pro Feature">🔒</div>
                            </div>
                            <div class="seo-score-header">
                               <span>
                                  <span data-i18n="seo_score">SEO Score</span>
                                    <a href="https://www.aimetagenpro.com/p/seo-score.html" target="blank" class="seo-info-icon" title="Learn how to improve SEO Score">i</a>
                                  </span>
                                <span class="seo-badge excellent" id="seo-badge-${card.id}">0 / 100 🟢 Excellent</span>
                            </div>
                            <div class="seo-progress-bg">
                                <div class="seo-progress-fill excellent" id="seo-progress-${card.id}" style="width: 0%;"></div>
                            </div>
                            <div class="seo-suggestions" id="seo-suggestions-${card.id}" style="color:var(--text-muted); font-size:0.75em; margin-top:8px; display:none; flex-direction:column; gap:4px; padding:6px; border-radius:4px; background:var(--bg-tertiary); border: 1px dashed var(--border-color);"></div>
                        </div>

                        <!-- Rejection Predictor Meter -->
                        <div class="rejection-meter-container" id="rejection-meter-${card.id}" style="display:none;">
                            <div class="locked-overlay" id="rejection-lock-${card.id}" style="display:none;" onclick="showProUpgradeAlert()">
                                <div class="lock-icon" title="Pro Feature">🔒</div>
                            </div>
                            <div class="rejection-header">
                                <span><span data-i18n="rejection">Rejection Chance</span> <button class="seo-info-icon" onclick="openRejectionInfoModal()" title="How to reduce rejection chance">i</button></span>
                                <span class="rejection-badge rejection-low" id="rejection-badge-${card.id}">0%</span>
                            </div>
                            <div class="rejection-progress-bg">
                                <div class="rejection-progress-fill fill-low" id="rejection-progress-${card.id}" style="width: 0%;"></div>
                            </div>
                        </div>

                        <!-- Release Requirements Check -->
                        <div class="platform-requirements-container" id="release-req-${card.id}" style="display:none; padding-bottom:10px;">            
                             <div class="platform-req-header">
                                 <span><span>Release Requirements</span></span>
                             </div>
                             <div class="platform-req-item">
                                 <span>Model Release</span>
                                 <span class="req-status" id="req-model-${card.id}">...</span>
                             </div>
                             <div class="platform-req-item">
                                 <span>Property Release</span>
                                 <span class="req-status" id="req-property-${card.id}">...</span>
                             </div>
                             <div class="release-upload-container" id="release-upload-container-${card.id}" style="display:none; margin-top:8px; width:100%;">
                                 <button class="action-button blue-button" style="width:100%; text-align:center; padding: 6px;" onclick="document.getElementById('release-input-${card.id}').click();"><i class="fas fa-upload"></i> Upload Releases</button>
                                 <input type="file" id="release-input-${card.id}" multiple class="release-file-input" style="display:none;" onchange="handleReleaseUpload(this, '${card.id}')">
                                 <div id="release-files-list-${card.id}" style="font-size:0.75em; margin-top:5px; color: var(--accent-orange); word-break: break-all;"></div>
                             </div>
                        </div>
                        
                        <button id="upscale-btn-${card.id}" class="action-button blue-button" style="display:none; width:100%; margin-top:8px; justify-content:center; align-items:center; gap:6px;">
                            <i class="fas fa-expand-arrows-alt"></i> Upscale (Advance AI)
                        </button>

                        <div class="card-filename" style="display:none;">${file.name}</div>
                    </div>
                    <div class="card-meta-col">
                        <!-- Metadata Section -->
                        <div class="meta-translation-controls" style="margin-bottom: 15px; padding: 6px; background: var(--bg-input); border-radius: 6px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <span style="font-size: 0.7em; color: var(--text-muted);"><i class="fas fa-language"></i> <span data-i18n="translate">Translate</span>:</span>
                                <select id="translate-lang-${card.id}" style="padding: 4px 8px; border-radius: 4px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color);">
                                     <option value="en">English</option>
                                     <option value="es">Spanish</option>
                                     <option value="fr">French</option>
                                     <option value="de">German</option>
                                     <option value="ja">Japanese</option>
                                     <option value="pt">Portuguese</option>
                                     <option value="it">Italian</option>
                                     <option value="bn">Bengali</option>
                                     <option value="hi">Hindi</option>
                                     <option value="ar">Arabic</option>
                                     <option value="zh">Chinese</option>
                                     <option value="ko">Korean</option>
                                     <option value="id">Indonesian</option>
                                </select>
                                <button class="action-button blue-button" style="padding: 4px 12px; font-size: 0.65em; white-space: nowrap; flex-shrink: 0;" onclick="translateMetadata('${card.id}')"><span data-i18n="go">Go</span></button>
                            </div>
                        </div>
                        <div class="meta-section" style="position: relative;">
                            <div class="meta-section-label" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                <span>
                                    <span data-i18n="label_title">Title</span>
                                    <span id="title-count-${card.id}" class="meta-count"></span>
                                </span>
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <button class="action-button blue-button TitleBtn" id="check-clarity-btn-${card.id}" style="padding: 5px 8px; font-size: 0.72em; display: none; height: auto;" onclick="checkTitleClarity('${card.id}')">
                                        <i class="fas fa-magic" style='margin-right: 5px;'></i> Clarity
                                    </button>
                                    <button class="copy-btn" onclick="copyToClipboard(this, 'title')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button>
                                </div>
                            </div>
                            <div class="meta-title" contenteditable="true" oninput="updateTitle(this)"></div>

                            <!-- Clarity Checker Widget -->
                            <div id="clarity-checker-container-${card.id}" class="clarity-checker-container" style="display: none;">
                                <div class="clarity-scores-row">
                                    <div class="clarity-score-item">
                                        <div class="clarity-score-header">
                                            <span>Accuracy</span>
                                            <span id="clarity-grammar-value-${card.id}" class="clarity-score-value">0%</span>
                                        </div>
                                        <div class="clarity-progress-bg">
                                            <div id="clarity-grammar-bar-${card.id}" class="clarity-progress-fill" style="width: 0%;"></div>
                                        </div>
                                    </div>
                                    <div class="clarity-score-item">
                                        <div class="clarity-score-header">
                                            <span>Buyer Appeal</span>
                                            <span id="clarity-appeal-value-${card.id}" class="clarity-score-value">0%</span>
                                        </div>
                                        <div class="clarity-progress-bg">
                                            <div id="clarity-appeal-bar-${card.id}" class="clarity-progress-fill" style="width: 0%;"></div>
                                        </div>
                                    </div>
                                </div>
                                <div id="clarity-details-${card.id}" class="clarity-details">
                                    <div id="clarity-feedback-${card.id}" class="clarity-feedback"></div>
                                    <ul id="clarity-suggestions-${card.id}" class="clarity-suggestions"></ul>
                                </div>
                                <div id="clarity-lock-overlay-${card.id}" class="locked-overlay" style="display: none;" onclick="scrollToPricing(); alert('Upgrade to PRO or PREMIUM plan to unlock actionable title optimization suggestions.')">
                                    <div class="lock-icon" style="font-size: 1.25em;">🔒</div>
                                    <span style="font-size: 0.7em; font-weight: bold; color: var(--text-primary);">Unlock Pro Recommendations</span>
                                </div>
                                <div class="clarity-header-actions" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
                                    <button class="action-button blue-button TitleBtn" id="clarity-fix-btn-${card.id}" style="padding: 2px 8px; font-size: 0.72em; height: auto;" onclick="fixTitleWithAI('${card.id}')">
                                        <i class="fas fa-magic"></i> AI Fix
                                    </button>
                                    <button class="action-button" style="padding: 2px 8px; font-size: 0.72em; height: auto; background: #e12727c7; border: 1px solid rgba(255,255,255,0.2); color: #fff; cursor: pointer;" onclick="document.getElementById('clarity-checker-container-${card.id}').style.display='none'">
                                        <i class="fas fa-times"></i> Close
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="meta-section" id="desc-section-${card.id}">
                            <div class="meta-section-label"><span><span data-i18n="label_desc">Description</span> <span id="desc-count-${card.id}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'description')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                            <div class="meta-description"></div>
                        </div>
                        <div class="meta-section">
                            <div class="meta-section-label"><span><span data-i18n="label_keywords">Keywords</span> <span id="keyword-count-${card.id}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'keywords')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                            <div class="meta-keywords"></div>
                            <div class="keyword-add-container">
                                <input type="text" class="keyword-add-input" data-i18n="placeholder_add_kw" placeholder="Add keyword..." id="keyword-input-${card.id}" onkeypress="if(event.key === 'Enter') addKeyword('${card.id}')">
                                <button class="keyword-add-btn" style='white-space: nowrap; flex-shrink: 0;' onclick="addKeyword('${card.id}')">+ <span data-i18n="btn_add">Add</span></button>
                            </div>
                            <div class="keyword-preset-container" style="margin-top: 8px; display: flex; gap: 8px; align-items: center;">
                                <select class="preset-select-dropdown" data-card-id="${card.id}" onchange="window.applyPresetToCard('${card.id}', this.value)" style="flex: 1; padding: 4px 8px; border-radius: 4px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); font-size: 0.72em; width: 80%;">
                                    <option value="">📁 Apply Preset/Templates...</option>
                                </select>
                                <button class="action-button blue-button" onclick="window.savePresetFromCard('${card.id}')" title="Save current keywords as preset template" style="padding: 4px 8px; font-size: 0.72em; margin-top: 0; white-space: nowrap; flex-shrink: 0;">
                                    <i class="fas fa-save"></i> Save Preset
                                </button>
                            </div>
                        </div>
                        
                        <!-- AI Category Select (Adobe Stock) -->
                        <div class="meta-section adobe-only-section" style="display:none;"> 
                          <div class="meta-section-label">
                              <span><i class="fas fa-tags"></i> <span data-i18n="ai_category">AI Category (Adobe Stock)</span></span>
                          </div>
                             <select class="meta-category-select" id="ai-category-${card.id}">
                                <option value="">Select Category...</option>
                                <option value="Animals">Animals</option>
                                <option value="Buildings and Architecture">Buildings and Architecture</option>
                                <option value="Business">Business</option>
                                <option value="Drinks">Drinks</option>
                                <option value="Environment">Environment</option>
                                <option value="States of Mind">States of Mind</option>
                                <option value="Food">Food</option>
                                <option value="Graphic Resources">Graphic Resources</option>
                                <option value="Hobbies and Leisure">Hobbies and Leisure</option>
                                <option value="Industry">Industry</option>
                                <option value="Landscapes">Landscapes</option>
                                <option value="Lifestyle">Lifestyle</option>
                                <option value="People">People</option>
                                <option value="Plants and Flowers">Plants and Flowers</option>
                                <option value="Culture and Religion">Culture and Religion</option>
                                <option value="Science">Science</option>
                                <option value="Social Issues">Social Issues</option>
                                <option value="Sports">Sports</option>
                                <option value="Technology">Technology</option>
                                <option value="Transport">Transport</option>
                                <option value="Travel">Travel</option>
                            </select>
                        </div>
                        
                        <!-- New Style & Mood Grid -->
                        <div class="style-mood-grid">
                            <div class="meta-subsection" id="style-section-${card.id}" style="display:none;">
                                <div class="meta-section-label"><span><i class="icon-palette"></i> <span data-i18n="style">Style</span></span><button class="copy-btn mini" onclick="copyToClipboard(this, 'style')"><span data-i18n="btn_copy">Copy</span></button></div>
                                <div class="meta-style-container"></div>
                            </div>
                            <div class="meta-subsection" id="mood-section-${card.id}" style="display:none;">
                                <div class="meta-section-label"><span><i class="icon-smile"></i> <span data-i18n="mode">Mode</span></span><button class="copy-btn mini" onclick="copyToClipboard(this, 'mood')"><span data-i18n="btn_copy">Copy</span></button></div>
                                <div class="meta-mood-container"></div>
                            </div>
                        </div>

                        <button class="export-csv-btn" style="display:none;">Export CSV</button>
                        <button id="btn-eps-${card.id}" class="action-button purple-button" style="display:${((file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) && ((window.userUsageData?.plan && window.userUsageData.plan.toLowerCase().includes('premium')) || (window.userUsageData?.limit >= 100))) ? 'flex' : 'none'}; width:100%; margin-top:8px; justify-content:center; align-items:center; gap:6px;" disabled onclick="downloadAsEps('${card.id}')">
                            <i class="icon-download"></i> <span data-i18n='download'>Download</span> EPS10
                        </button>
                        <!-- Image to Prompt Section -->
                        <div class="prompt-section">
                             <div class="prompt-spinner" style="display: none;"></div>
                             <div class="prompt-result-container" style="display: none; width: 100%;">
                                 <!-- Style Tab Buttons -->
                                 <div class="prompt-tabs">
                                     <button class="prompt-tab-btn active" data-style="realistic" onclick="switchPromptStyle('${card.id}', 'realistic')">
                                         📷 <span data-i18n="style_realistic">Realistic</span>
                                     </button>
                                     <button class="prompt-tab-btn" data-style="illustration" onclick="switchPromptStyle('${card.id}', 'illustration')" style='background: #8b5cf6;'>
                                         🎨 <span data-i18n="style_illustration">Illustration</span>
                                     </button>
                                     <button class="prompt-tab-btn" data-style="3d" onclick="switchPromptStyle('${card.id}', '3d')" style='width: 100%;
    background: #f16908;'>
                                         🧊 <span data-i18n="style_3d">3D Render</span>
                                     </button>
                                 </div>
                                 
                                 <!-- Prompt Text Content Areas -->
                                 <div class="prompt-text-wrapper" style="position: relative; width: 100%;">
                                     <div class="prompt-text prompt-style-content active" id="prompt-realistic-${card.id}" style="font-size: 0.82em; line-height: 1.5; color: var(--text-secondary); max-height: 150px; overflow-y: auto; padding: 6px 4px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 6px; word-break: break-word;"></div>
                                     <div class="prompt-text prompt-style-content" id="prompt-illustration-${card.id}" style="display: none; font-size: 0.82em; line-height: 1.5; color: var(--text-secondary); max-height: 150px; overflow-y: auto; padding: 6px 4px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 6px; word-break: break-word;"></div>
                                     <div class="prompt-text prompt-style-content" id="prompt-3d-${card.id}" style="display: none; font-size: 0.82em; line-height: 1.5; color: var(--text-secondary); max-height: 150px; overflow-y: auto; padding: 6px 4px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 6px; word-break: break-word;"></div>
                                 </div>
                                 
                                 <!-- Actions -->
                                 <div class="prompt-actions-inline">
                                     <button class="action-button blue-button" onclick="copyPromptFromCard(this)"><i class="icon-copy"></i> <span data-i18n="btn_copy">Copy</span></button>
                                     <button class="action-button purple-button" onclick="copyAllPromptsFromCard('${card.id}')"><i class="icon-copy"></i> <span data-i18n="btn_copy_all">Copy All</span></button>
                                     <button class="action-button green-button" onclick="downloadPromptFromCard(this)"><i class="icon-download"></i> <span data-i18n="download">Download</span></button>
                                 </div>
                             </div>
                        </div>

                    </div>`;

        const activePlatform = document.querySelector('.platform-button.active')?.dataset.platform;
        if (activePlatform === 'adobe') {
            const adobeSec = card.querySelector('.adobe-only-section');
            if (adobeSec) adobeSec.style.display = 'block';
        }

        previewContainer.appendChild(card);
        const currentLang = localStorage.getItem('selectedLanguage') || 'en';
        if (typeof updateUI === 'function') {
            updateUI(currentLang, card);
        }

        const imgElement = card.querySelector('.thumbnail-medium');

        // NEW: Update dimensions when image loads
        if (imgElement) {
            imgElement.onload = function () {
                const width = this.naturalWidth;
                const height = this.naturalHeight;
                const dimsEl = document.getElementById(`dims-${card.id}`);
                if (dimsEl) {
                    dimsEl.textContent = `${width} x ${height}`;
                }

                // NEW: Update Video Badge for Short Videos
                const fileDataObj = uploadedFilesData.find(f => f.id === card.id);
                if (fileDataObj && fileDataObj.isVideo && (width < height || fileDataObj.isVertical)) {
                    fileDataObj.isVertical = true;
                    const videoBadge = card.querySelector('.video-badge');
                    if (videoBadge) {
                        videoBadge.textContent = "SHORT VIDEO";
                        videoBadge.style.background = "linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)";
                    }
                }

                // Capture thumbnail for history
                try {
                    if (typeof captureThumbnail === 'function') {
                        const thumb = captureThumbnail(card.id, 100);
                        if (thumb) {
                            const entry = uploadedFilesData.find(f => f.id === card.id);
                            if (entry) entry.thumbnail = thumb;
                        }
                    }
                } catch (e) { console.warn("Thumb capture failed in onload:", e); }

                // Check if dimensions are unsuitable for microstock (Pro/Premium only)
                const userPlan = (window.userUsageData?.plan || 'free').toLowerCase();
                const isProOrPremium = userPlan.includes('pro') || userPlan.includes('premium') || userPlan.includes('agency');
                if ((file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp') && (width <= 1024 || height <= 1024)) {
                    const upscaleBtn = document.getElementById(`upscale-btn-${card.id}`);
                    if (upscaleBtn) {
                        upscaleBtn.style.display = 'flex';
                        upscaleBtn.onclick = () => {
                            if (isProOrPremium) {
                                upscaleImageToClipDrop(card.id, file);
                            } else {
                                alert("Upgrade to PRO/PREMIUM plan. Upscale (Advance AI) features are for pro & premium users only.");
                                if (typeof scrollToPricing === 'function') scrollToPricing();
                            }
                        };
                    }
                }
            };
        }

        const spinner = card.querySelector('.image-spinner');

        if (isEps) {
            // --- EPS Conversion Restriction (Premium Only) ---
            const user = auth.currentUser;

            // Plan check: checks if plan includes 'premium' OR 'pro', or if limit >= 100
            const userPlan = (window.userUsageData?.plan || '').toLowerCase();
            let isProOrPremium = userPlan.includes('premium') || userPlan.includes('pro') || userPlan.includes('agency') || (window.userUsageData?.limit >= 100);

            if (!isProOrPremium) {
                alert("Direct Vector/EPS conversion is a Pro/Premium feature. Please upgrade to use this feature.");
                openUpgradeModal('pro'); // অথবা আপনার প্রয়োজন অনুযায়ী 'premium' રાખতে পারেন
                spinner.style.display = 'none';
                return;
            }

            const formData = new FormData();
            formData.append('file', file); // 'file' নামেই পাঠাতে হবে, কারণ সার্ভারে upload.single('file') দেওয়া আছে

            // আপনার নতুন Render সার্ভারে রিকোয়েস্ট পাঠানো হচ্ছে
            fetch(`https://metagen-eps-server.onrender.com/api/extract-eps`, {
                method: 'POST',
                body: formData
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        const base64Data = data.base64;
                        imgElement.src = `data:image/jpeg;base64,${base64Data}`;

                        const newFileName = file.name;

                        // Copyright চেকের জন্য JPG প্রিভিউটি মেমরিতে রাখা হচ্ছে
                        const byteString = atob(base64Data);
                        const ab = new ArrayBuffer(byteString.length);
                        const ia = new Uint8Array(ab);
                        for (let i = 0; i < byteString.length; i++) {
                            ia[i] = byteString.charCodeAt(i);
                        }
                        const blob = new Blob([ab], { type: 'image/jpeg' });
                        const jpegFile = new File([blob], newFileName + ".jpg", { type: 'image/jpeg' });

                        // === এখানেই মূল ফিক্স করা হয়েছে ===
                        uploadedFilesData.push({
                            id: card.id,
                            name: newFileName,
                            fileObject: file, // <-- [FIX] এখানে অরিজিনাল EPS ফাইলটি সেভ রাখা হলো!
                            previewFile: jpegFile, // <-- AI/Copyright এর জন্য প্রিভিউ JPG আলাদা রাখলাম!
                            isAiFile: true, // EPS-কে ভিশন API এর জন্য AI ফাইলের মতো ট্রিট করা হবে
                            title: '',
                            keywords: '',
                            description: '',
                            style: '',
                            mood: '',
                            prompt: ''
                        });
                        updateAllButtonStates();

                        // Auto-run Copyright Check if enabled
                        if (document.getElementById('copyrightToggle') && document.getElementById('copyrightToggle').checked) {
                            checkCopyrightAndTrademark(jpegFile, card.id);
                        } else {
                            const statusEl = document.getElementById(`copyright-status-${card.id}`);
                            if (statusEl) statusEl.style.display = 'none';
                        }

                    } else {
                        throw new Error(data.error || 'Conversion failed, no preview found.');
                    }
                })
                .catch(error => {
                    console.error('Error extracting EPS preview:', error);
                    // Fallback icon যদি কোনো কারণে কনভার্ট না হয়
                    imgElement.src = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSJub25lIiBzdHJva2U9IiM5NEE0QjgiIHN0cm9rZS13aWR0aD0iNCI+IDxyZWN0IHg9IjIiIHk9IjIiIHdpZHRoPSI5NiIgaGVpZHRoPSI5NiIgcng9IjgiIHJ5PSI4IiBmaWxsPSIjMUUyOTNCIi8+IDx0ZXh0IHg9IjUwIiB5PSI2MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMzYiIGZpbGw9IiM5NEE0QjgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtd2VpZ2h0PSJib2xkIj5FUFM8L3RleHQ+PC9zdmc+`;
                    alert("Failed to extract preview from EPS: " + error.message);
                })
                .finally(() => {
                    spinner.style.display = 'none';
                });

        } else if (isAi) {
            try {
                // Attempt 1: Client-side PDF.js extraction
                const previewFile = await extractAiPreview(file);
                imgElement.src = URL.createObjectURL(previewFile);
                uploadedFilesData.push({
                    id: card.id,
                    name: file.name,
                    fileObject: file,
                    previewFile: previewFile,
                    isAiFile: true,
                    title: '', keywords: '', description: '', style: '', mood: '', prompt: ''
                });

            } catch (error) {
                console.warn('Native AI preview failed. File is likely not PDF-compatible.', error);

                // সার্ভারে রিকোয়েস্ট না পাঠিয়ে সরাসরি অ্যালার্ট দিন এবং ডিফল্ট আইকন দেখান
                alert(`Could not extract preview for "${file.name}".\n\nFor visual previews, please save .ai files with the "Create PDF Compatible File" option checked in Illustrator.`);

                // Fallback generic AI icon (No server request to avoid 500 error)
                imgElement.src = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSJub25lIiBzdHJva2U9IiNGRjdGMTgiIHN0cm9rZS13aWR0aD0iNCI+IDxyZWN0IHg9IjIiIHk9IjIiIHdpZHRoPSI5NiIgaGVpZHRoPSI5NiIgcng9IjgiIHJ5PSI4IiBmaWxsPSIjMUUyOTNCIi8+IDx0ZXh0IHg9IjUwIiB5PSI2MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMzYiIGZpbGw9IiNGRjdGMTgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtd2VpZ2h0PSJib2xkIj5BSTwvdGV4dD48L3N2Zz4=`;

                uploadedFilesData.push({
                    id: card.id,
                    name: file.name,
                    fileObject: file,
                    isAiFile: true,
                    title: '', keywords: '', description: '', style: '', mood: '', prompt: ''
                });
            } finally {
                spinner.style.display = 'none';
                updateAllButtonStates();

                // Auto-run Copyright Check if enabled
                if (document.getElementById('copyrightToggle') && document.getElementById('copyrightToggle').checked) {
                    const fileDataEntry = uploadedFilesData[uploadedFilesData.length - 1];
                    // প্রিভিউ ফাইল থাকলে কপিরাইট স্ক্যান করবে, না থাকলে ওয়ার্নিং দেখাবে
                    if (fileDataEntry && fileDataEntry.previewFile) {
                        checkCopyrightAndTrademark(fileDataEntry.previewFile, card.id);
                    } else {
                        const statusEl = document.getElementById(`copyright-status-${card.id}`);
                        if (statusEl) {
                            statusEl.style.display = 'block';
                            statusEl.innerHTML = '<div class="copyright-badge copyright-warning" style="font-size:0.75em;">⚠️ Preview Unavailable for Scan</div>';
                        }
                    }
                } else {
                    const statusEl = document.getElementById(`copyright-status-${card.id}`);
                    if (statusEl) statusEl.style.display = 'none';
                }
            }
        } else if (isVideo) {
            try {
                const previewFile = await extractVideoPreview(file);
                imgElement.src = URL.createObjectURL(previewFile);
                uploadedFilesData.push({
                    id: card.id,
                    name: file.name,
                    fileObject: file,
                    previewFile: previewFile,
                    isAiFile: true,
                    isVideo: true,
                    isVertical: previewFile.isVertical,
                    title: '',
                    keywords: '',
                    description: '',
                    style: '',
                    mood: '',
                    prompt: ''
                });
            } catch (error) {
                console.error('Video preview failed:', error);
                // Fallback icon for video
                imgElement.src = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSJub25lIiBzdHJva2U9IiNFRjQ0NDQiIHN0cm9rZS13aWR0aD0iNCI+IDxyZWN0IHg9IjIiIHk9IjIiIHdpZHRoPSI5NiIgaGVpZHRoPSI5NiIgcng9IjgiIHJ5PSI4IiBmaWxsPSIjMUUyOTNCIi8+IDx0ZXh0IHg9IjUwIiB5PSI2MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiNFRjQ0NDQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtd2VpZ2h0PSJib2xkIj5WSURFTzwvdGV4dD48L3N2Zz4=`;
                uploadedFilesData.push({
                    id: card.id,
                    name: file.name,
                    fileObject: file,
                    isVideo: true,
                    isVertical: false,
                    title: '',
                    keywords: '',
                    description: '',
                    style: '',
                    mood: '',
                    prompt: ''
                });
            } finally {
                spinner.style.display = 'none';
                updateAllButtonStates();
                const statusEl = document.getElementById(`copyright-status-${card.id}`);
                if (statusEl) statusEl.style.display = 'none';
            }
        } else {
            imgElement.src = URL.createObjectURL(file);
            spinner.style.display = 'none';

            uploadedFilesData.push({
                id: card.id,
                name: file.name,
                fileObject: file,
                isAiGenerated: file.isAiGenerated || false,
                title: '',
                keywords: '',
                description: '',
                style: '',
                mood: '',
                prompt: ''
            });
            updateAllButtonStates();

            // Auto-run Copyright Check if enabled (JPG/PNG)
            if (document.getElementById('copyrightToggle') && document.getElementById('copyrightToggle').checked) {
                checkCopyrightAndTrademark(file, card.id);
            } else {
                const statusEl = document.getElementById(`copyright-status-${card.id}`);
                if (statusEl) statusEl.style.display = 'none';
            }
        }
    }

    // --- ADD MORE BUTTON LOGIC ---
    const addMoreFilesBtn = document.getElementById('addMoreFilesButton');
    if (addMoreFilesBtn) {
        addMoreFilesBtn.onclick = function () {
            const uploadSection = document.querySelector('.file-upload-section');
            if (uploadSection) {
                uploadSection.style.display = 'flex'; // Or 'block' depending on original CSS, 'flex' matches .file-upload-section CSS 
                // Optionally scroll to it
                uploadSection.scrollIntoView({ behavior: 'smooth' });
                // Hide this button again? Or keep it? User didn't specify, but usually "Add More" implies opening the dialog or showing the dropzone.
                // Showing the dropzone makes sense.
                this.style.display = 'none';
            }
        };
    }

    // --- ACTION BUTTONS ---
    if (clearAllButton) {
        clearAllButton.onclick = function () {
            uploadedFilesData.length = 0;
            previewContainer.innerHTML = '';
            updateAllButtonStates();

            if (typeof window.SessionDB !== 'undefined') window.SessionDB.clearSession();

            // Show upload section again on Clear All
            const uploadSection = document.querySelector('.file-upload-section');
            const addMoreBtn = document.getElementById('addMoreFilesButton');
            if (uploadSection) uploadSection.style.display = 'flex';
            if (addMoreBtn) addMoreBtn.style.display = 'none';
        };
    }

    // Add test metadata button functionality
    const testMetadataButton = document.getElementById('testMetadataButton');
    if (testMetadataButton) {
        testMetadataButton.onclick = testMetadataCompatibility;
    }

    // ===== BULK SELECTION FEATURE =====

    // Handle checkbox state changes
    window.handleCheckboxChange = function () {
        const checkedBoxes = document.querySelectorAll('.bulk-checkbox:checked');
        const count = checkedBoxes.length;
        const bulkActionBar = document.getElementById('bulkActionBar');
        const selectedCountEl = document.getElementById('selectedCount');

        if (count > 0) {
            bulkActionBar.style.display = 'flex';
            selectedCountEl.textContent = count;
        } else {
            bulkActionBar.style.display = 'none';
        }
    };

    // Get all selected card IDs
    function getSelectedCards() {
        const checkedBoxes = document.querySelectorAll('.bulk-checkbox:checked');
        const cardIds = [];
        checkedBoxes.forEach(checkbox => {
            cardIds.push(checkbox.dataset.fileId);
        });
        return cardIds;
    }
    window.getSelectedCards = getSelectedCards;

    // Delete selected files
    window.deleteSelectedFiles = function () {
        const selectedCardIds = getSelectedCards();

        if (selectedCardIds.length === 0) {
            alert('No files selected');
            return;
        }

        const confirmMsg = `Are you sure you want to delete ${selectedCardIds.length} selected file(s)?`;
        if (!confirm(confirmMsg)) {
            return;
        }

        selectedCardIds.forEach(cardId => {
            const card = document.getElementById(cardId);
            if (card) {
                // Remove from uploadedFilesData array
                const index = uploadedFilesData.findIndex(f => f.id === cardId);
                if (index !== -1) {
                    uploadedFilesData.splice(index, 1);
                }

                // Remove card from DOM
                card.remove();
            }
        });

        // Update UI
        handleCheckboxChange();
        updateAllButtonStates();

        // Show upload section if no files left
        if (uploadedFilesData.length === 0) {
            const uploadSection = document.querySelector('.file-upload-section');
            const addMoreBtn = document.getElementById('addMoreFilesButton');
            if (uploadSection) uploadSection.style.display = 'flex';
            if (addMoreBtn) addMoreBtn.style.display = 'none';
        }

        alert(`${selectedCardIds.length} file(s) deleted successfully`);
    };

    // Download selected files with embedded metadata
    window.downloadSelectedFiles = async function () {
        const selectedCardIds = getSelectedCards();

        if (selectedCardIds.length === 0) {
            alert('No files selected');
            return;
        }

        // Filter to get only files with metadata
        const filesToDownload = uploadedFilesData.filter(f =>
            selectedCardIds.includes(f.id) &&
            f.title &&
            f.title !== "Error" &&
            (
                (f.fileObject.type && (f.fileObject.type === 'image/jpeg' || f.fileObject.type === 'image/jpg')) ||
                (f.fileObject.type && f.fileObject.type === 'image/png') ||
                (f.name && f.name.toLowerCase().endsWith('.png')) ||
                (f.fileObject.type && f.fileObject.type === 'image/svg+xml') ||
                (f.name && f.name.toLowerCase().endsWith('.svg')) ||
                (f.name && f.name.toLowerCase().endsWith('.eps'))
            )
        );

        if (filesToDownload.length === 0) {
            alert('No selected files with metadata to download. Please generate metadata first.');
            return;
        }

        const downloadBtn = document.querySelector('.bulk-action-btn.download-btn');
        const originalHTML = downloadBtn.innerHTML;
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + getTrans('downloading');

        let downloadedCount = 0;

        for (const fileData of filesToDownload) {
            try {
                if (
                    (fileData.fileObject.type && (fileData.fileObject.type === 'image/jpeg' || fileData.fileObject.type === 'image/jpg'))
                ) {
                    await embedAndDownload(fileData);
                } else if (
                    (fileData.fileObject.type && fileData.fileObject.type === 'image/png') ||
                    (fileData.name && fileData.name.toLowerCase().endsWith('.png'))
                ) {
                    await embedPngAndDownload(fileData);
                } else if (
                    (fileData.fileObject.type && fileData.fileObject.type === 'image/svg+xml') ||
                    (fileData.name && fileData.name.toLowerCase().endsWith('.svg'))
                ) {
                    await embedSvgAndDownload(fileData);

                } else if (
                    (fileData.name && fileData.name.toLowerCase().endsWith('.eps'))
                ) {
                    await embedEpsAndDownload(fileData);
                }

                downloadedCount++;
                downloadBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${getTrans('downloading')} ${downloadedCount}/${filesToDownload.length}`;
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`Failed to download ${fileData.name}`, error);
            }
        }

        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalHTML;
        alert(`${downloadedCount} file(s) downloaded successfully`);
    };

    // Translate selected files
    window.translateSelectedFiles = async function () {
        const selectedCardIds = getSelectedCards();

        if (selectedCardIds.length === 0) {
            alert('No files selected');
            return;
        }

        // Filter to get only cards with metadata
        const cardsWithMetadata = selectedCardIds.filter(cardId => {
            const fileData = uploadedFilesData.find(f => f.id === cardId);
            return fileData && fileData.title && fileData.title !== "Error";
        });

        if (cardsWithMetadata.length === 0) {
            alert('No selected files with metadata to translate. Please generate metadata first.');
            return;
        }

        // Ask user for target language
        const targetLang = prompt(
            'Select target language:\n' +
            'es = Spanish, fr = French, de = German, ja = Japanese,\n' +
            'pt = Portuguese, it = Italian, bn = Bengali, hi = Hindi,\n' +
            'ar = Arabic, zh = Chinese, ko = Korean\n\n' +
            'Enter language code:',
            'es'
        );

        if (!targetLang || targetLang.trim() === '') {
            return;
        }

        const validLanguages = ['es', 'fr', 'de', 'ja', 'pt', 'it', 'bn', 'hi', 'ar', 'zh', 'ko'];
        if (!validLanguages.includes(targetLang.toLowerCase())) {
            alert('Invalid language code. Please try again.');
            return;
        }

        const translateBtn = document.querySelector('.bulk-action-btn.translate-btn');
        const originalHTML = translateBtn.innerHTML;
        translateBtn.disabled = true;
        translateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + getTrans('translating');

        let translatedCount = 0;

        for (const cardId of cardsWithMetadata) {

            // 🌐 Show translate progress bar
            showBatchProgress('translate');
            try {
                // Use existing translateMetadata function logic
                const card = document.getElementById(cardId);
                if (!card) continue;

                const fileData = uploadedFilesData.find(f => f.id === cardId);
                if (!fileData) continue;

                // Translate title
                if (fileData.title) {
                    const translatedTitle = await translateText(fileData.title, targetLang);
                    fileData.title = translatedTitle;
                    const titleDiv = card.querySelector('.meta-title');
                    if (titleDiv) titleDiv.textContent = translatedTitle;
                }

                // Translate description
                if (fileData.description) {
                    const translatedDesc = await translateText(fileData.description, targetLang);
                    fileData.description = translatedDesc;
                    const descDiv = card.querySelector('.meta-description');
                    if (descDiv) descDiv.textContent = translatedDesc;
                }

                // Translate keywords
                if (fileData.keywords && fileData.keywords.length > 0) {
                    const translatedKeywords = [];
                    for (const keyword of fileData.keywords) {
                        const translatedKeyword = await translateText(keyword, targetLang);
                        translatedKeywords.push(translatedKeyword);
                    }
                    fileData.keywords = translatedKeywords.join(', ');

                    // Update keywords display
                    updateKeywordsDisplay(cardId);
                }

                translatedCount++;
                translateBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Translating... ${translatedCount}/${cardsWithMetadata.length}`;
                updateBatchProgress(translatedCount, cardsWithMetadata.length, fileData ? fileData.name : cardId, 'translate');
                await new Promise(resolve => setTimeout(resolve, 800)); // Delay to avoid API rate limits
            } catch (error) {
                console.error(`Failed to translate card ${cardId}`, error);
            }
        }

        translateBtn.disabled = false;
        translateBtn.innerHTML = originalHTML;
        hideBatchProgress(true);
        alert(`${translatedCount} file(s) translated successfully to ${targetLang.toUpperCase()}`);
    };

    // Update closeCard function to handle checkbox state
    window.closeCard = function (button) {
        const card = button.closest('.file-preview-card');
        if (!card) return;

        const cardId = card.id;

        // Remove from uploadedFilesData
        const index = uploadedFilesData.findIndex(f => f.id === cardId);
        if (index !== -1) {
            uploadedFilesData.splice(index, 1);
        }

        // Remove card from DOM
        card.remove();

        // Update bulk action bar if it was checked
        handleCheckboxChange();

        // Update button states
        updateAllButtonStates();

        // Show upload section if no files left
        if (uploadedFilesData.length === 0) {
            const uploadSection = document.querySelector('.file-upload-section');
            const addMoreBtn = document.getElementById('addMoreFilesButton');
            if (uploadSection) uploadSection.style.display = 'flex';
            if (addMoreBtn) addMoreBtn.style.display = 'none';
        }
    };

    // Generate Metadata ONLY for Selected Files
    window.generateMetadataForSelected = async function () {
        const selectedCardIds = getSelectedCards();

        if (selectedCardIds.length === 0) {
            alert('No files selected');
            return;
        }

        // Filter files based on selection from the global uploadedFilesData
        const filesToProcess = uploadedFilesData.filter(f => selectedCardIds.includes(f.id));

        if (filesToProcess.length === 0) {
            alert("Selected files not found in data.");
            return;
        }

        // AI processes directly through Supabase Edge Functions. No client-side keys needed.

        // UI Feedback on the button
        const btn = document.querySelector('.bulk-action-btn.process-btn');
        const originalContent = btn.innerHTML;
        btn.disabled = true;

        // Reset Pause State
        window.isPaused = false;
        const pauseBtn = document.getElementById('pauseProcessButton');
        if (pauseBtn) {
            pauseBtn.style.display = 'inline-flex';
            pauseBtn.innerHTML = '<i class="fas fa-pause"></i> ' + (typeof getTrans === 'function' ? getTrans('pause') : 'Pause');
            pauseBtn.classList.remove('green-button');
            pauseBtn.classList.add('orange-button');
        }

        let processedCount = 0;
        let completedCount = 0;
        let errorCount = 0;
        let totalFiles = filesToProcess.length;

        // Loop through selected files
        for (const fileData of filesToProcess) {
            // Check for pause
            while (window.isPaused) {
                await new Promise(r => setTimeout(r, 200));
            }

            processedCount++;
            btn.innerHTML = `<i class="icon-spinner"></i> ${getTrans('processing')} ${processedCount}/${totalFiles}`;
            updateBatchProgress(processedCount, totalFiles, fileData.name, 'generate');

            const currentCard = document.getElementById(fileData.id);
            if (currentCard) currentCard.style.borderColor = "#F97316"; // Active color

            try {
                // Generate Metadata
                const metadata = await generateMetadata(fileData);

                // Update Data
                fileData.title = metadata.title;
                fileData.keywords = metadata.keywords;
                fileData.description = metadata.description || '';

                // Update UI specific elements if needed (usually generateMetadata handles internal UI)
                const epsBtn = document.getElementById(`btn-eps-${fileData.id}`);
                if (epsBtn) epsBtn.disabled = false;

                completedCount++;
                if (currentCard) currentCard.style.borderColor = "#10B981"; // Success color

            } catch (error) {
                console.error("Error processing file:", fileData.name, error);
                fileData.title = "Error"; // Mark as error so it can be retried later
                errorCount++;
                if (currentCard) {
                    currentCard.style.borderColor = "#EF4444"; // Error color
                    const metaTitle = currentCard.querySelector('.meta-title');
                    if (metaTitle) metaTitle.textContent = "Failed: " + error.message;
                }
            }

            // Delay for API Rate Limits on backend
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        // Finish Process
        btn.innerHTML = `<i class="fas fa-check"></i> ${getTrans('done')} (${completedCount}/${totalFiles})`;
        hideBatchProgress(errorCount === 0);

        // Hide pause button
        if (pauseBtn) pauseBtn.style.display = 'none';

        // Notification
        if (Notification.permission === "granted") {
            new Notification("Selected Batch Complete! ✅", {
                body: `Success: ${completedCount}, Failed: ${errorCount}`,
                icon: "https://cdn-icons-png.flaticon.com/512/148/148767.png"
            });
        } else {
            // Small delay to let user see the button text
            setTimeout(() => {
                alert(`Batch Generation Complete!\nSuccess: ${completedCount}\nFailed: ${errorCount}`);
            }, 500);
        }

        if (completedCount > 0 && !localStorage.getItem('feedbackSubmitted')) {
            setTimeout(() => {
                const feedbackModal = document.getElementById('feedbackModal');
                if (feedbackModal) {
                    feedbackModal.style.display = 'flex';
                }
            }, 3000);
        }

        // Reset Button after 2 seconds
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }, 2000);
    };

    // ===== TRANSLATION FEATURE =====
    // ===== BATCH PROGRESS BAR HELPERS =====
    let _bpStartTime = 0;

    const _bpStages = {
        generate: { icon: '⚙️', label: 'Generating Metadata' },
        translate: { icon: '🌐', label: 'Translating Files' },
        prompt: { icon: '✨', label: 'Processing Prompts' }
    };

    function showBatchProgress(stage) {
        const overlay = document.getElementById('batchProgressOverlay');
        const fill = document.getElementById('bpFill');
        if (!overlay) return;
        const s = _bpStages[stage] || _bpStages.generate;
        document.getElementById('bpStageIcon').textContent = s.icon;
        document.getElementById('bpStageLabel').textContent = s.label;
        document.getElementById('bpChip').textContent = '0 / 0';
        document.getElementById('bpChip').className = 'bp-chip';
        document.getElementById('bpPct').textContent = '0%';
        document.getElementById('bpPct').className = 'bp-pct';
        document.getElementById('bpEta').textContent = '';
        document.getElementById('bpFilename').innerHTML = '⏳ Initializing...';
        if (fill) { fill.style.width = '0%'; fill.className = 'batch-progress-fill running'; }
        overlay.style.display = 'block';
        // Smooth scroll to it
        overlay.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        _bpStartTime = Date.now();
    }

    function updateBatchProgress(current, total, filename, stage) {
        const overlay = document.getElementById('batchProgressOverlay');
        const fill = document.getElementById('bpFill');
        if (!overlay || overlay.style.display === 'none') return;

        const pct = total > 0 ? Math.round((current / total) * 100) : 0;

        // Fill bar
        if (fill) fill.style.width = pct + '%';

        // Chip
        const chip = document.getElementById('bpChip');
        if (chip) chip.textContent = `${current} / ${total} files`;

        // Percentage
        const pctEl = document.getElementById('bpPct');
        if (pctEl) pctEl.textContent = pct + '%';

        // ETA
        const etaEl = document.getElementById('bpEta');
        if (etaEl && current > 0) {
            const elapsed = (Date.now() - _bpStartTime) / 1000;
            const perFile = elapsed / current;
            const remaining = Math.round(perFile * (total - current));
            if (remaining > 0) {
                etaEl.textContent = remaining < 60
                    ? `~${remaining}s remaining`
                    : `~${Math.ceil(remaining / 60)}m remaining`;
            } else {
                etaEl.textContent = 'Almost done...';
            }
        }

        // Filename
        const fnEl = document.getElementById('bpFilename');
        if (fnEl && filename) {
            const s = _bpStages[stage] || _bpStages.generate;
            fnEl.innerHTML = `${s.icon} Processing: <strong>${filename}</strong>`;
        }
    }

    function hideBatchProgress(success) {
        const overlay = document.getElementById('batchProgressOverlay');
        const fill = document.getElementById('bpFill');
        if (!overlay) return;

        // Final state
        if (fill) { fill.style.width = '100%'; fill.className = 'batch-progress-fill done'; }
        const chip = document.getElementById('bpChip');
        if (chip) chip.className = 'bp-chip done';
        const pctEl = document.getElementById('bpPct');
        if (pctEl) { pctEl.textContent = '100%'; pctEl.className = 'bp-pct done'; }
        const etaEl = document.getElementById('bpEta');
        if (etaEl) etaEl.textContent = '';
        const fnEl = document.getElementById('bpFilename');
        if (fnEl) fnEl.innerHTML = success !== false
            ? '✅ All done! Results are ready below.'
            : '⚠️ Finished with some errors. Check cards above.';

        // Auto-hide after 3.5s
        setTimeout(() => {
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.style.display = 'none';
                overlay.style.opacity = '';
            }, 420);
        }, 3500);
    }
    // ===== END BATCH PROGRESS BAR HELPERS =====

    if (processAllButton) {
        // Global Pause State
        window.isPaused = false;
        window.togglePause = function () {
            window.isPaused = !window.isPaused;
            const btn = document.getElementById('pauseProcessButton');
            if (btn) {
                if (window.isPaused) {
                    btn.innerHTML = '<i class="fas fa-play"></i> ' + getTrans('resume');
                    btn.classList.add('green-button');
                    btn.classList.remove('orange-button');
                } else {
                    btn.innerHTML = '<i class="fas fa-pause"></i> ' + getTrans('pause');
                    btn.classList.remove('green-button');
                    btn.classList.add('orange-button');
                }
            }
        };

        async function processSelectedFiles() {
            // 🟠 IMMEDIATE UI FEEDBACK
            processAllButton.disabled = true;
            processAllButton.innerHTML = '<i class="icon-spinner"></i> ' + (typeof getTrans === 'function' ? getTrans('processing') : 'Processing...');
            showBatchProgress('generate');

            // 🔔 Request Notification Permission
            if (Notification.permission !== "granted") {
                Notification.requestPermission();
            }

            const selectedProvider = document.getElementById('aiProviderSelect')?.value || 'groq';
            const user = auth.currentUser;

            // Filter files to process
            const filesToProcess = uploadedFilesData.filter(f => !f.title || f.title === "");

            if (filesToProcess.length === 0) {
                alert("All files have already been processed.");
                processAllButton.disabled = false;
                processAllButton.innerHTML = '<i class="icon-process"></i> ' + (typeof getTrans === 'function' ? getTrans('process_selected') : 'Process Selected');
                hideBatchProgress();
                return;
            }

            // Check plan and usage
            let usage = { count: 0, limit: 10 };
            let isProPremium = false;
            let cachedPlan = 'free';
            let cachedToken = '';

            if (user) {
                try {
                    const [profileDoc, usageData, idToken] = await Promise.all([
                        db.collection('users').doc(user.email).get(),
                        getMetadataUsage(user.email),
                        user.getIdToken()
                    ]);

                    const profileData = profileDoc.exists ? profileDoc.data() : null;
                    const dbPlan = (profileData?.plan || '').toLowerCase();
                    isProPremium = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
                    cachedPlan = dbPlan;
                    cachedToken = idToken || '';
                    usage = usageData;
                } catch (e) {
                    console.warn('Initial data check failed', e);
                }
            } else {
                try {
                    usage = await getMetadataUsage("unknown");
                } catch (e) {
                    console.warn('Anonymous usage check failed', e);
                }
            }

            // 🛑 LIMIT CHECK
            if (usage.count + filesToProcess.length > usage.limit) {
                const remaining = usage.limit - usage.count;
                if (!user) {
                    if (remaining <= 0) {
                        showLimitModal(`Your lifetime login-free free trial has expired (3/3 images processed). Please sign in to continue & get 10 more free credits!`);
                    } else {
                        showLimitModal(`You have only <strong>${remaining}</strong> login-free trial image(s) left for this device. You selected <strong>${filesToProcess.length}</strong> images. Please reduce the number or sign in to get 10 more free credits.`);
                    }
                } else {
                    if (remaining <= 0) {
                        showLimitModal(`Your daily limit has been reached. Please try again tomorrow or upgrade.`);
                    } else {
                        showLimitModal(`You have only <strong>${remaining}</strong> images left for today. You selected <strong>${filesToProcess.length}</strong> images. Please reduce the number or upgrade to Pro.`);
                    }
                }
                processAllButton.disabled = false;
                processAllButton.innerHTML = '<i class="icon-process"></i> ' + (typeof getTrans === 'function' ? getTrans('process_selected') : 'Process Selected');
                hideBatchProgress();
                return;
            }

            // Reset pause state and show button
            window.isPaused = false;
            const pauseBtn = document.getElementById('pauseProcessButton');
            if (pauseBtn) {
                pauseBtn.style.display = 'inline-flex';
                pauseBtn.innerHTML = '<i class="fas fa-pause"></i> ' + (typeof getTrans === 'function' ? getTrans('pause') : 'Pause');
                pauseBtn.classList.remove('green-button');
                pauseBtn.classList.add('orange-button');
            }

            let totalFiles = filesToProcess.length;
            let processedCount = 0;
            let completedCount = 0;
            let errorCount = 0;

            // 🚀 SUPER FAST CONCURRENCY LOGIC (Dynamic Speed)
            // Mistral স্লো তাই একসাথে ১টি, বাকিগুলোর ক্ষেত্রে Pro হলে ৪টি, Free হলে ২টি
            let concurrencyLimit = 2; // Default for Free
            if (isProPremium) {
                concurrencyLimit = (selectedProvider === 'mistral') ? 1 : 4;
            } else {
                concurrencyLimit = (selectedProvider === 'mistral') ? 1 : 2;
            }

            // Chunking / Batching Array
            for (let i = 0; i < filesToProcess.length; i += concurrencyLimit) {
                // Pause Check
                while (window.isPaused) {
                    await new Promise(r => setTimeout(r, 200));
                }

                // Create a chunk of files
                const chunk = filesToProcess.slice(i, i + concurrencyLimit);

                // Process the chunk concurrently using Promise.all
                const chunkPromises = chunk.map(async (fileData) => {
                    const currentCard = document.getElementById(fileData.id);
                    if (currentCard) currentCard.style.borderColor = "#F97316";

                    try {
                        // 🧠 Call AI (Concurrent) — plan/token cached at batch level for speed
                        const metadata = await generateMetadata(fileData, { token: cachedToken, plan: cachedPlan });

                        // Save Data
                        fileData.title = metadata.title;
                        fileData.keywords = metadata.keywords;
                        fileData.description = metadata.description || '';

                        const epsBtn = document.getElementById(`btn-eps-${fileData.id}`);
                        if (epsBtn) epsBtn.disabled = false;

                        completedCount++;
                        if (currentCard) currentCard.style.borderColor = "#10B981"; // Success Green

                    } catch (error) {
                        console.error("Error processing file:", fileData.name, error);
                        fileData.title = "Error";
                        errorCount++;
                        if (currentCard) {
                            currentCard.style.borderColor = "#EF4444";
                            const metaTitle = currentCard.querySelector('.meta-title');
                            if (metaTitle) metaTitle.textContent = "Failed: " + error.message;
                        }
                    } finally {
                        processedCount++;
                        // Update UI per file completion
                        const overallCompleted = uploadedFilesData.filter(f => f.title && f.title !== "Error" && f.title !== "").length;
                        const overallErrors = uploadedFilesData.filter(f => f.title === "Error").length;
                        updateProcessButtonText(processedCount, totalFiles, overallCompleted, overallErrors);
                        updateBatchProgress(processedCount, totalFiles, fileData.name, 'generate');
                    }
                });

                // Wait for all 2-4 images in this chunk to finish
                await Promise.all(chunkPromises);

                // ⏱️ Delay between chunks to avoid 429 API Rate Limit
                let delayTime = isProPremium ? 800 : 2500;
                if (selectedProvider === 'mistral') delayTime = 4000;
                await new Promise(resolve => setTimeout(resolve, delayTime));
            }

            // 🏁 Finish Process
            const finalCompleted = uploadedFilesData.filter(f => f.title && f.title !== "Error" && f.title !== "").length;
            const finalErrors = uploadedFilesData.filter(f => f.title === "Error").length;

            // 🔥 Record daily streak activity
            if (finalCompleted > 0 && typeof window.recordStreakActivity === 'function') {
                window.recordStreakActivity();
            }

            updateProcessButtonText(processedCount, totalFiles, finalCompleted, finalErrors, true);
            hideBatchProgress(finalErrors === 0);

            setTimeout(() => {
                processAllButton.disabled = false;
                if (pauseBtn) pauseBtn.style.display = 'none';
            }, 1000);

            // 🔔 Completion Notification
            if (Notification.permission === "granted") {
                new Notification("Metadata Generation Complete! ✅", {
                    body: `Successful: ${finalCompleted}\nFailed: ${finalErrors}`,
                    icon: "https://cdn-icons-png.flaticon.com/512/148/148767.png"
                });
            } else {
                setTimeout(() => {
                    alert(`Batch Generation Complete!\nSuccess: ${finalCompleted}\nFailed: ${finalErrors}`);
                }, 500);
            }

            // Trigger Feedback Modal
            if (finalCompleted > 0 && !localStorage.getItem('feedbackSubmitted')) {
                setTimeout(() => {
                    const feedbackModal = document.getElementById('feedbackModal');
                    if (feedbackModal) feedbackModal.style.display = 'flex';
                }, 2500);
            }
        }


        processAllButton.onclick = async function () {
            if (this.disabled) return;

            try {
                await processSelectedFiles();
            } catch (err) {
                console.error('Processing failed:', err);
            }
        };
    }

    if (processAllPromptsButton) {
        processAllPromptsButton.onclick = async function () {
            // 🟠 IMMEDIATE UI FEEDBACK
            this.disabled = true;
            const originalContent = this.innerHTML;
            this.innerHTML = '<i class="icon-spinner"></i> ' + (typeof getTrans === 'function' ? getTrans('processing') : 'Processing...');

            // --- Check User Plan via profiles table ---
            const user = auth.currentUser;
            const planUser2 = user;

            let isProPremium2 = false;
            if (planUser2) {
                try {
                    const profileDoc2 = await db.collection('users').doc(planUser2.email).get();
                    const profileData2 = profileDoc2.exists ? profileDoc2.data() : null;
                    const dbPlan2 = (profileData2?.plan || '').toLowerCase();
                    isProPremium2 = (dbPlan2 === 'pro' || dbPlan2 === 'premium' || dbPlan2 === 'agency');
                } catch (e) { console.warn('Plan check failed', e); }
            }

            const filesToProcess = uploadedFilesData.filter(f => !f.prompt);
            if (filesToProcess.length === 0) {
                alert("All file prompts have already been generated.");
                this.disabled = false;
                this.innerHTML = originalContent;
                return;
            }

            let totalFiles = filesToProcess.length, processedCount = 0, completedCount = 0, errorCount = 0;

            for (const fileData of filesToProcess) {
                processedCount++;
                updatePromptButtonState(processedCount, totalFiles, completedCount, errorCount);
                const card = document.getElementById(fileData.id);
                const promptSection = card.querySelector('.prompt-section');
                const spinner = promptSection.querySelector('.prompt-spinner');
                const resultContainer = promptSection.querySelector('.prompt-result-container');
                const realDiv = card.querySelector(`#prompt-realistic-${fileData.id}`);
                const illDiv = card.querySelector(`#prompt-illustration-${fileData.id}`);
                const tdDiv = card.querySelector(`#prompt-3d-${fileData.id}`);

                card.classList.add('prompt-generated');
                resultContainer.style.display = 'none';
                spinner.style.display = 'block';
                /* logActivity is now handled server-side */
                try {
                    const promptResult = await generatePromptForImage(fileData.fileObject);
                    fileData.prompt = promptResult;

                    // Attempt to parse JSON response for three styles
                    let promptObj = null;
                    try {
                        const cleanedJson = promptResult.replace(/^```json\s*|\s*```$/gi, '').trim();
                        promptObj = JSON.parse(cleanedJson);
                    } catch (e) {
                        console.warn("Failed to parse prompt response as JSON. Falling back to single prompt.", e);
                    }

                    if (promptObj && promptObj.realistic && promptObj.illustration && promptObj["3d"]) {
                        realDiv.textContent = promptObj.realistic;
                        illDiv.textContent = promptObj.illustration;
                        tdDiv.textContent = promptObj["3d"];
                        realDiv.style.color = '';
                        illDiv.style.color = '';
                        tdDiv.style.color = '';
                    } else {
                        // Fallback: put raw text in Realistic, and styled variations in the others
                        realDiv.textContent = promptResult;
                        illDiv.textContent = `${promptResult} (Illustration style)`;
                        tdDiv.textContent = `${promptResult} (3D style)`;
                        realDiv.style.color = '';
                        illDiv.style.color = '';
                        tdDiv.style.color = '';
                    }

                    resultContainer.style.display = 'block';
                    completedCount++;
                } catch (error) {
                    fileData.prompt = `Error: ${error.message}`;
                    if (realDiv) {
                        realDiv.textContent = `Error: ${error.message}`;
                        realDiv.style.color = '#EF4444';
                    }
                    if (illDiv) {
                        illDiv.textContent = `Error: ${error.message}`;
                        illDiv.style.color = '#EF4444';
                    }
                    if (tdDiv) {
                        tdDiv.textContent = `Error: ${error.message}`;
                        tdDiv.style.color = '#EF4444';
                    }
                    resultContainer.style.display = 'block';
                    errorCount++;
                } finally {
                    spinner.style.display = 'none';
                    const overallCompleted = uploadedFilesData.filter(f => f.prompt && !f.prompt.startsWith("Error")).length;
                    const overallErrors = uploadedFilesData.filter(f => f.prompt && f.prompt.startsWith("Error")).length;
                    updatePromptButtonState(processedCount, totalFiles, overallCompleted, overallErrors);
                    await new Promise(resolve => setTimeout(resolve, 1100));
                }
            }
            const finalCompleted = uploadedFilesData.filter(f => f.prompt && !f.prompt.startsWith("Error")).length;
            const finalErrors = uploadedFilesData.filter(f => f.prompt && f.prompt.startsWith("Error")).length;
            updatePromptButtonState(processedCount, totalFiles, finalCompleted, finalErrors, true);
            this.disabled = false;
        };
    }

    // Toggle Dropdown Function
    window.toggleExportDropdown = function () {
        const dropdownMenu = document.getElementById('exportDropdownMenu');
        if (dropdownMenu.style.display === 'block') {
            dropdownMenu.style.display = 'none';
        } else {
            dropdownMenu.style.display = 'block';
        }
    };

    // Close dropdown when clicking outside
    window.addEventListener('click', function (event) {
        const dropdownMenu = document.getElementById('exportDropdownMenu');
        const exportBtn = document.getElementById('exportButton');
        // Check if click is outside button and menu
        if (dropdownMenu && exportBtn && !exportBtn.contains(event.target) && !dropdownMenu.contains(event.target)) {
            dropdownMenu.style.display = 'none';
        }
    });

    window.mapShutterstockToAdobe = function (shutterstockCat) {
        if (!shutterstockCat) return "Graphic Resources";
        const s = String(shutterstockCat).toLowerCase();
        if (s.includes("animal")) return "Animals";
        if (s.includes("building") || s.includes("interior")) return "Buildings and Architecture";
        if (s.includes("business")) return "Business";
        if (s.includes("drink")) return "Drinks";
        if (s.includes("nature") || s.includes("park")) return "Landscapes";
        if (s.includes("food")) return "Food";
        if (s.includes("abstract") || s.includes("art") || s.includes("background") || s.includes("texture") || s.includes("object") || s.includes("misc") || s.includes("sign") || s.includes("symbol") || s.includes("vintage")) return "Graphic Resources";
        if (s.includes("beauty") || s.includes("fashion")) return "Lifestyle";
        if (s.includes("celebrity") || s.includes("people")) return "People";
        if (s.includes("education") || s.includes("science") || s.includes("health") || s.includes("medical")) return "Science";
        if (s.includes("holiday") || s.includes("religion")) return "Culture and Religion";
        if (s.includes("industrial")) return "Industry";
        if (s.includes("sport") || s.includes("recreation")) return "Sports";
        if (s.includes("technology")) return "Technology";
        if (s.includes("transport")) return "Transport";
        return "Graphic Resources";
    };

    window.getMappedAdobeCategory = function (catName) {
        const map = {
            "Animals": "1",
            "Buildings and Architecture": "2",
            "Business": "3",
            "Drinks": "4",
            "Environment": "5",
            "States of Mind": "6",
            "Food": "7",
            "Graphic Resources": "8",
            "Hobbies and Leisure": "9",
            "Industry": "10",
            "Landscapes": "11",
            "Lifestyle": "12",
            "People": "13",
            "Plants and Flowers": "14",
            "Culture and Religion": "15",
            "Science": "16",
            "Social Issues": "17",
            "Sports": "18",
            "Technology": "19",
            "Transport": "20",
            "Travel": "21"
        };
        return map[catName] || "8";
    };

    window.exportAllCsv = function (targetPlatform) {
        const successfulFiles = uploadedFilesData.filter(f => f.title && f.title !== "Error");
        if (successfulFiles.length === 0) {
            alert("No successful metadata to export.");
            return;
        }

        let platformToUse = targetPlatform;
        if (!platformToUse) {
            const activePlatformBtn = document.querySelector('.platform-button.active');
            platformToUse = activePlatformBtn ? activePlatformBtn.dataset.platform : '';
        }

        let csvContent = '';
        let isShutterstock = (platformToUse === 'shutterstock');
        let isAdobe = (platformToUse === 'adobe');

        if (isShutterstock) {
            csvContent += "Filename,Description,Keywords,Categories,Releases\n";
            successfulFiles.forEach(fileData => {
                const title = fileData.title || "";
                const keywords = fileData.keywords || "";
                // Use AI-detected category per file
                const categoryValue = (fileData.category || "").replace(/"/g, '""');

                const fileName = fileData.name.replace(/"/g, '""');
                const descriptionAsTitle = title.replace(/"/g, '""');
                const keywordsEscaped = keywords.replace(/"/g, '""');
                const releases = (fileData.releases || []).map(r => r.name).join('; ').replace(/"/g, '""');
                csvContent += `"${fileName}","${descriptionAsTitle}","${keywordsEscaped}","${categoryValue}","${releases}"\n`;
            });
            alert("Shutterstock CSV generated! AI-detected categories are included in the 'Categories' column. Upload this CSV to Shutterstock — categories will be auto-filled!");

        } else if (isAdobe) {
            csvContent += "Filename,Title,Keywords,Category,Releases\n";
            successfulFiles.forEach(fileData => {
                const title = fileData.title || "";
                const keywords = fileData.keywords || "";

                const catSelect = document.getElementById(`ai-category-${fileData.id}`);
                const adobeCat = getMappedAdobeCategory(catSelect ? catSelect.value : (fileData.adobeCategory || ''));
                const categoryValue = adobeCat.replace(/"/g, '""');

                const fileName = fileData.name.replace(/"/g, '""');
                const descriptionAsTitle = title.replace(/"/g, '""');
                const keywordsEscaped = keywords.replace(/"/g, '""');
                const releases = (fileData.releases || []).map(r => r.name).join('; ').replace(/"/g, '""');
                csvContent += `"${fileName}","${descriptionAsTitle}","${keywordsEscaped}","${categoryValue}","${releases}"\n`;
            });
            alert("Adobe Stock CSV generated! AI-detected categories are included in the 'Category' column. Upload this CSV to Adobe Stock — categories will be auto-filled!");

        } else {
            csvContent += "Filename,Title,Keywords,Description,Category,Releases\n";
            successfulFiles.forEach(fileData => {
                const originalFileName = fileData.name.replace(/"/g, '""');
                const title = (fileData.title || "").replace(/"/g, '""');
                const keywords = (fileData.keywords || "").replace(/"/g, '""');
                const description = (fileData.description || "").replace(/"/g, '""');

                const catSelect = document.getElementById(`ai-category-${fileData.id}`);
                const adobeCat = getMappedAdobeCategory(catSelect ? catSelect.value : (fileData.adobeCategory || ''));
                const categoryValue = adobeCat.replace(/"/g, '""');
                const releases = (fileData.releases || []).map(r => r.name).join('; ').replace(/"/g, '""');

                csvContent += `"${originalFileName}","${title}","${keywords}","${description}","${categoryValue}","${releases}"\n`;
            });
        }

        const fileName = platformToUse ? `${platformToUse}_metadata.csv` : "metadata_export.csv";
        const encodedUri = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Hide dropdown
        const dm = document.getElementById('exportDropdownMenu');
        if (dm) dm.style.display = 'none';
    };

    window.exportAllExcel = async function () {
        const user = auth.currentUser;
        const userEmail = user?.email;
        let currentPlan = 'free';

        if (userEmail) {
            const usage = await getMetadataUsage(userEmail);
            currentPlan = (usage.plan || 'free').toLowerCase();
            // Sync global state
            if (window.userUsageData) window.userUsageData.plan = currentPlan;
        }

        if (currentPlan === 'free') {
            openUpgradeModal('pro');
            return;
        }

        const successfulFiles = uploadedFilesData.filter(f => f.title && f.title !== "Error");
        if (successfulFiles.length === 0) {
            alert("No successful metadata to export.");
            return;
        }

        if (typeof XLSX === 'undefined') {
            alert("Excel export library not loaded. Please refresh the page.");
            return;
        }

        const data = successfulFiles.map(fileData => {
            const catSelect = document.getElementById(`ai-category-${fileData.id}`);
            const adobeCat = getMappedAdobeCategory(catSelect ? catSelect.value : (fileData.adobeCategory || ''));
            const releases = (fileData.releases || []).map(r => r.name).join('; ');

            return {
                "File Name": fileData.name,
                "Title": fileData.title || "",
                "Description": fileData.description || "",
                "Keywords": fileData.keywords || "",
                "Shutterstock Category": fileData.category || "",
                "Adobe Category": adobeCat,
                "Releases": releases
            };
        });

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Metadata");
        XLSX.writeFile(wb, "metadata_export.xlsx");

        // Hide dropdown
        const dm = document.getElementById('exportDropdownMenu');
        if (dm) dm.style.display = 'none';
    };

    // Global Release Form Upload Handler
    window.handleReleaseUpload = function (inputElem, cardId) {
        const files = Array.from(inputElem.files);
        if (!files || files.length === 0) return;

        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (fileData) {
            fileData.releases = files;
            const listContainer = document.getElementById(`release-files-list-${cardId}`);
            if (listContainer) {
                listContainer.innerHTML = files.map(f => `<i class="fas fa-file-pdf"></i> ${f.name}`).join('<br>');
            }
        }
    };

    // Global CSV Metadata Applier Logic (Pro/Premium Only)
    // (Removed custom keyword DOM update function in favor of native window.updateKeywordsDisplay)

    // Embed Metadata restrict to Pro/Premium (Firebase)
    window.embedMetadata = async function () {
        const user = auth.currentUser;
        const userEmail = user ? user.email : null;
        let currentPlan = 'free';

        if (userEmail) {
            const usage = await getMetadataUsage(userEmail);
            currentPlan = (usage.plan || 'free').toLowerCase();
            // Sync global state
            if (window.userUsageData) window.userUsageData.plan = currentPlan;
        }

        if (currentPlan === 'free') {
            openUpgradeModal('pro');
            return;
        }
        if (typeof embedMetadataAll === 'function') {
            embedMetadataAll();
        }
    };

    // FTP Upload restrict to Premium (Firebase)
    window.openFtpUploadModal = async function () {
        const user = auth.currentUser;
        const userEmail = user ? user.email : null;
        let currentPlan = 'free';

        if (userEmail) {
            const usage = await getMetadataUsage(userEmail);
            currentPlan = (usage.plan || 'free').toLowerCase();
            // Sync global state
            if (window.userUsageData) window.userUsageData.plan = currentPlan;
        }

        if (currentPlan !== 'premium' && currentPlan !== 'agency') {
            openUpgradeModal('premium');
            return;
        }
        const modal = document.getElementById('ftpModal');
        if (modal) {
            modal.style.display = 'flex';
            if (typeof window.handleAgencyConfigChange === 'function') {
                window.handleAgencyConfigChange();
            }
        }
    };
    window.testMetadataCompatibility = function () {
        const testInfo = `
🔍 Metadata Compatibility Test Results:

✅ PNG Files:
- Title: Embedded in tEXt chunk and XMP
- Description: Embedded in tEXt chunk and XMP  
- Keywords: Embedded in tEXt chunk and XMP
- Windows Properties: Should show Title, Subject, Tags
- Adobe Stock: Should show Title and Keywords

✅ JPEG Files:
- Title: Embedded in EXIF and XMP
- Description: Embedded in EXIF and XMP
- Keywords: Embedded in EXIF and XMP
- Windows Properties: Should show Title, Subject, Tags
- Adobe Stock: Should show Title and Keywords

💡 Tips for Best Results:
1. Use descriptive titles (5-15 words)
2. Include relevant keywords (20-35 keywords)
3. Write detailed descriptions (30-50 words)
4. Test files in Windows File Properties
5. Upload to Adobe Stock to verify metadata

⚠️ Note: Some software may display metadata differently.
    `;
        alert(testInfo);
    }

    window.svgFileToPngDataUrl = async function (svgFile, width = 512, height = 512) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(svgFile);
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = "#fff";
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = (e) => {
                URL.revokeObjectURL(url);
                reject(e);
            };
            img.src = url;
        });
    };

    window.updateAllButtonStates = function () {
        updateProcessButtonText();
        updatePromptButtonState();
        checkBatchEpsButtonState();
    }

    window.updateProcessButtonText = function (processed = 0, total = 0, completed = 0, errors = 0, isComplete = false) {
        const fileCount = uploadedFilesData.length;
        const hasSuccessfulData = uploadedFilesData.some(f => f.title && f.title !== "Error");

        const hasEmbeddableFiles = uploadedFilesData.some(f =>
            f.title && f.title !== "Error" &&
            (
                f.fileObject.type === 'image/jpeg' ||
                f.fileObject.type === 'image/jpg' ||
                f.fileObject.type === 'image/png' ||
                f.fileObject.type === 'image/svg+xml' ||
                f.name.toLowerCase().endsWith('.svg') ||
                f.name.toLowerCase().endsWith('.eps')
            )
        );

        const translateAllBtn = document.getElementById('translateAllBtn');

        if (fileCount === 0) {
            processAllButton.innerHTML = '<i class="icon-process"></i> ' + getTrans('process_selected');
            processAllButton.disabled = true;
            exportButton.disabled = true;
            embedMetadataButton.disabled = true;
            return;
        }

        const unprocessedFiles = uploadedFilesData.filter(f => !f.title).length;
        processAllButton.disabled = unprocessedFiles === 0 && !isComplete;

        if (isComplete) {
            processAllButton.innerHTML = `<i class="icon-check"></i> ${getTrans('complete')}: ${completed} ${getTrans('success')}, ${errors} ${getTrans('fail')}`;
            processAllButton.style.background = errors === 0 ? 'linear-gradient(90deg, #10B981 60%, #059669 100%)' : 'linear-gradient(90deg, #F97316 60%, #ea580c 100%)';
        } else if (processed > 0) {
            processAllButton.innerHTML = `<i class="icon-spinner"></i> ${getTrans('processing')} ${processed}/${total} | ✓ ${completed} / ✕ ${errors}`;
            processAllButton.disabled = true;
        } else {
            processAllButton.innerHTML = `<i class="icon-process"></i> ${getTrans('process')} ${unprocessedFiles} ${getTrans('files')}`;
            processAllButton.style.background = 'linear-gradient(90deg, #F97316 60%, #ea580c 100%)';
        }

        exportButton.disabled = !hasSuccessfulData;

        // Enable/disable Shutterstock CSV button in platform upload section
        const sstCsvBtn = document.querySelector('.shutterstock-btn');
        if (sstCsvBtn) sstCsvBtn.disabled = !hasSuccessfulData;

        if (translateAllBtn) {
            translateAllBtn.disabled = !hasSuccessfulData;
        }

        embedMetadataButton.disabled = !hasEmbeddableFiles;

        // New Export Buttons Logic
        const saveToFolderBtn = document.getElementById('saveToFolderButton');
        const shareFilesBtn = document.getElementById('shareFilesButton');
        const uploadToDriveBtn = document.getElementById('uploadToDriveButton');
        const ftpPushBtn = document.getElementById('ftpUploadButton');

        if (saveToFolderBtn) saveToFolderBtn.disabled = !hasEmbeddableFiles;
        if (shareFilesBtn) shareFilesBtn.disabled = !hasEmbeddableFiles;
        if (uploadToDriveBtn) uploadToDriveBtn.disabled = !hasEmbeddableFiles;
        if (ftpPushBtn) ftpPushBtn.disabled = !hasEmbeddableFiles;
    }
    function updatePromptButtonState(processed = 0, total = 0, completed = 0, errors = 0, isComplete = false) {
        const fileCount = uploadedFilesData.length;
        if (fileCount === 0) {
            processAllPromptsButton.innerHTML = '<i class="icon-process"></i> Process Prompts';
            processAllPromptsButton.disabled = true;
            return;
        }

        const unprocessedFiles = uploadedFilesData.filter(f => !f.prompt).length;
        processAllPromptsButton.disabled = unprocessedFiles === 0 && !isComplete;

        if (isComplete) {
            processAllPromptsButton.innerHTML = `<i class="icon-check"></i> ${getTrans('complete')}: ${completed} ${getTrans('success')}, ${errors} ${getTrans('fail')}`;
            processAllPromptsButton.style.background = errors === 0 ? 'linear-gradient(90deg, #10B981 60%, #059669 100%)' : 'linear-gradient(90deg, #F97316 60%, #ea580c 100%)';
        } else if (processed > 0) {
            processAllPromptsButton.innerHTML = `<i class="icon-spinner"></i> ${getTrans('processing')} ${processed}/${total} | ✓ ${completed} / ✕ ${errors}`;
            processAllPromptsButton.disabled = true;
        } else {
            processAllPromptsButton.innerHTML = `<i class="icon-process"></i> ${getTrans('process')} ${unprocessedFiles} ${getTrans('prompts')}`;
        }
    }


    const PROHIBITED_WORDS = {
        shutterstock: ["exclusive", "shutterstock"],
        adobe: ["exclusive", "adobe stock", "adobe"],
        Magnific: ["premium", "exclusive", "Magnific"],
        vecteezy: ["exclusive", "vecteezy"],
    };

    // --- NEW: Export & Share Features ---

    // Helper to get a ready-to-save File object with metadata embedded
    // Helper: Escape XML characters
    function escapeXml(unsafe) {
        if (typeof unsafe !== 'string') return "";
        return unsafe.replace(/[<>&'"]/g, function (c) {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
            }
        });
    }

    window.getEmbeddedFile = async function (fileData) {
        let mimeType = fileData.fileObject.type;
        let blob;
        let filename = fileData.name;

        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
            // JPEG Embedding
            blob = await new Promise(async (resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async function (e) {
                    try {
                        let imageDataUrl = e.target.result;
                        let exifObj;
                        try {
                            exifObj = piexif.load(imageDataUrl);
                        } catch (err) {
                            imageDataUrl = await new Promise((res, rej) => {
                                const img = new Image();
                                img.onload = () => {
                                    const canvas = document.createElement('canvas');
                                    canvas.width = img.width; canvas.height = img.height;
                                    const ctx = canvas.getContext('2d');
                                    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                                    ctx.drawImage(img, 0, 0);
                                    res(canvas.toDataURL('image/jpeg', 0.95));
                                };
                                img.onerror = rej;
                                img.src = e.target.result;
                            });
                        }
                        if (!exifObj) exifObj = { "0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": null };

                        function toUTF16LE(str) {
                            const bytes = [];
                            for (let i = 0; i < str.length; i++) {
                                const code = str.charCodeAt(i);
                                bytes.push(code & 0xff);
                                bytes.push(code >> 8);
                            }
                            bytes.push(0, 0); // Null terminator
                            return bytes;
                        }

                        const keywordsString = (fileData.keywords || "").split(',').map(k => k.trim()).join(';');

                        // Explicitly DELETE conflicting ASCII tags so Windows relies on XPTitle (Unicode)
                        delete exifObj["0th"][piexif.ImageIFD.ImageDescription];
                        delete exifObj["0th"][piexif.ImageIFD.DocumentName];

                        exifObj["0th"][piexif.ImageIFD.XPSubject] = toUTF16LE(fileData.description || "");
                        exifObj["0th"][piexif.ImageIFD.XPKeywords] = toUTF16LE(keywordsString);
                        exifObj["0th"][piexif.ImageIFD.XPAuthor] = toUTF16LE("MetaGen Pro");
                        exifObj["0th"][piexif.ImageIFD.XPTitle] = toUTF16LE(fileData.title || "");

                        const exifBytes = piexif.dump(exifObj);
                        const newImageDataUrl = piexif.insert(exifBytes, imageDataUrl);

                        // 2. Construct XMP Packet
                        const keywordsArr = (fileData.keywords || "").split(',').map(k => k.trim()).filter(Boolean);
                        const titleStr = escapeXml(fileData.title || "");
                        const descStr = escapeXml(fileData.description || "");
                        const keywordsList = keywordsArr.map(k => `<rdf:li>${escapeXml(k)}</rdf:li>`).join('');

                        const xmpContent = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c138 79.159824, 2016/09/14-01:09:01">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <dc:title>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${titleStr}</rdf:li>
    </rdf:Alt>
   </dc:title>
   <dc:description>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${descStr}</rdf:li>
    </rdf:Alt>
   </dc:description>
   <dc:subject>
    <rdf:Bag>
     ${keywordsList}
    </rdf:Bag>
   </dc:subject>
   <photoshop:Headline>${titleStr}</photoshop:Headline>
   <photoshop:Description>${descStr}</photoshop:Description>
   <xmp:CreatorTool>MetaGen Pro</xmp:CreatorTool>
   <xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

                        // 3. Insert XMP into JPEG
                        function insertXmp(dataUrl, xmp) {
                            const header = "data:image/jpeg;base64,";
                            if (!dataUrl.startsWith(header)) return dataUrl;
                            const raw = atob(dataUrl.substring(header.length));
                            const len = raw.length;
                            const arr = new Uint8Array(len);
                            for (let i = 0; i < len; i++) arr[i] = raw.charCodeAt(i);

                            const packet = `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>${xmp}<?xpacket end="w"?>`;

                            // FIX: UTF-8 Encode the packet
                            let packetBytes;
                            if (typeof TextEncoder !== 'undefined') {
                                packetBytes = new TextEncoder().encode(packet);
                            } else {
                                const uriComp = encodeURIComponent(packet);
                                const bytes = [];
                                for (let i = 0; i < uriComp.length; i++) {
                                    const c = uriComp.charCodeAt(i);
                                    if (c === 37) { // %
                                        bytes.push(parseInt(uriComp.substr(i + 1, 2), 16));
                                        i += 2;
                                    } else {
                                        bytes.push(c);
                                    }
                                }
                                packetBytes = new Uint8Array(bytes);
                            }

                            const ns = "http://ns.adobe.com/xap/1.0/\0";
                            const segLen = 2 + ns.length + packetBytes.length;
                            const seg = new Uint8Array(segLen + 2);
                            seg[0] = 0xFF; seg[1] = 0xE1;
                            seg[2] = (segLen >> 8) & 0xFF; seg[3] = segLen & 0xFF;

                            let off = 4;
                            for (let i = 0; i < ns.length; i++) seg[off++] = ns.charCodeAt(i);
                            seg.set(packetBytes, off);

                            // Splice after Exif if present, else after SOI
                            let pos = 2; // After SOI
                            let finalArr = new Uint8Array(arr.length + seg.length);

                            while (pos < arr.length) {
                                if (arr[pos] === 0xFF && arr[pos + 1] === 0xE1) {
                                    // Check if Exif
                                    const sL = (arr[pos + 2] << 8) | arr[pos + 3];
                                    if (arr[pos + 4] === 0x45 && arr[pos + 5] === 0x78) { // "Ex..."
                                        pos += 2 + sL; // Skip Exif
                                        continue;
                                    }
                                }
                                break;
                            }

                            finalArr.set(arr.subarray(0, pos), 0);
                            finalArr.set(seg, pos);
                            finalArr.set(arr.subarray(pos), pos + seg.length);

                            let b = "";
                            for (let i = 0; i < finalArr.length; i++) b += String.fromCharCode(finalArr[i]);
                            return header + btoa(b);
                        }

                        const finalDataUrl = insertXmp(newImageDataUrl, xmpContent);

                        // Convert back to Blob
                        const byteString = atob(finalDataUrl.split(',')[1]);
                        const ab = new ArrayBuffer(byteString.length);
                        const ia = new Uint8Array(ab);
                        for (let i = 0; i < byteString.length; i++) {
                            ia[i] = byteString.charCodeAt(i);
                        }
                        resolve(new Blob([ab], { type: 'image/jpeg' }));
                    } catch (error) { reject(error); }
                };
                reader.onerror = reject;
                reader.readAsDataURL(fileData.fileObject);
            });
            filename = filename.replace(/(\.[\w\d_-]+)$/i, '_meta$1');

        } else if (mimeType === 'image/png' || filename.toLowerCase().endsWith('.png')) {
            // PNG Embedding
            blob = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const originalBytes = new Uint8Array(e.target.result);
                        const iendOffset = findIendChunkOffset(originalBytes);
                        if (iendOffset === -1) throw new Error("Could not find IEND chunk.");
                        const contentBeforeIEND = originalBytes.subarray(0, iendOffset);
                        const iendChunk = originalBytes.subarray(iendOffset);
                        const chunksToEmbed = [
                            createTextChunk("Title", fileData.title || ""),
                            createTextChunk("Description", fileData.description || ""),
                            createTextChunk("Keywords", fileData.keywords || ""),
                            createTextChunk("Author", "MetaGen Pro"),
                            createTextChunk("Software", "MetaGen Pro v5"),
                            createTextChunk("Copyright", "MetaGen Pro"),
                            createTextChunk("Creation Time", new Date().toISOString())
                        ];
                        const xmpChunk = createXmpChunk(fileData.title || "", fileData.description || "", fileData.keywords || "");
                        const newPngBytes = concatArrays([contentBeforeIEND, ...chunksToEmbed, xmpChunk, iendChunk]);
                        resolve(new Blob([newPngBytes], { type: 'image/png' }));
                    } catch (error) { reject(error); }
                };
                reader.onerror = reject;
                reader.readAsArrayBuffer(fileData.fileObject);
            });
            filename = filename.replace(/(\.png)$/i, '_meta$1');

        } else if (mimeType === 'image/svg+xml' || filename.toLowerCase().endsWith('.svg')) {
            // SVG Embedding
            blob = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const svgContent = e.target.result;
                        const parser = new DOMParser();
                        const xmlDoc = parser.parseFromString(svgContent, "image/svg+xml");
                        const svgRoot = xmlDoc.documentElement;

                        let titleNode = svgRoot.querySelector("title");
                        if (!titleNode) { titleNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "title"); svgRoot.insertBefore(titleNode, svgRoot.firstChild); }
                        titleNode.textContent = fileData.title || "";

                        let descNode = svgRoot.querySelector("desc");
                        if (!descNode) { descNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "desc"); svgRoot.insertBefore(descNode, titleNode.nextSibling); }
                        descNode.textContent = fileData.description || "";

                        const oldMetadata = svgRoot.querySelectorAll("metadata");
                        oldMetadata.forEach(el => el.remove());

                        let metadataNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "metadata");
                        metadataNode.id = "metagen-placeholder";
                        svgRoot.insertBefore(metadataNode, descNode.nextSibling);

                        const serializer = new XMLSerializer();
                        let svgString = serializer.serializeToString(xmlDoc);

                        const title = escapeXml(fileData.title || "");
                        const description = escapeXml(fileData.description || "");
                        const keywordsArray = (fileData.keywords || "").split(',').map(k => k.trim()).filter(Boolean);
                        const keywordsRdf = keywordsArray.map(k => `<rdf:li>${escapeXml(k)}</rdf:li>`).join('\n                                    ');

                        const xmpContent = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c138 79.159824, 2016/09/14-01:09:01"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><dc:format>image/svg+xml</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title><dc:description><rdf:Alt><rdf:li xml:lang="x-default">${description}</rdf:li></rdf:Alt></dc:description><dc:subject><rdf:Bag>${keywordsRdf}</rdf:Bag></dc:subject><photoshop:Headline>${title}</photoshop:Headline><photoshop:Description>${description}</photoshop:Description><xmp:CreatorTool>MetaGen Pro</xmp:CreatorTool><xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate></rdf:Description></rdf:RDF></x:xmpmeta>`;
                        const xmpWithPacket = `<metadata id="metagen-data"><?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>${xmpContent}<?xpacket end="w"?></metadata>`;

                        svgString = svgString.replace(/<metadata[^>]*id="metagen-placeholder"[^>]*>(.*?)<\/metadata>|<metadata[^>]*id="metagen-placeholder"[^>]*\/>/si, xmpWithPacket);
                        if (!svgString.startsWith('<?xml')) { svgString = '<?xml version="1.0" encoding="utf-8"?>\n' + svgString; }

                        resolve(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }));
                    } catch (error) { reject(error); }
                };
                reader.onerror = reject;
                reader.readAsText(fileData.fileObject);
            });
            filename = filename.replace(/(\.svg)$/i, '_meta$1');
        } else if (fileData.name && fileData.name.toLowerCase().endsWith('.eps')) {
            // --- NEW: EPS Embedding via Server ---
            blob = await new Promise(async (resolve, reject) => {
                try {
                    const formData = new FormData();
                    formData.append('file', fileData.fileObject);
                    formData.append('title', fileData.title || '');
                    formData.append('description', fileData.description || '');
                    formData.append('keywords', fileData.keywords || '');

                    const response = await fetch('https://metagen-eps-server.onrender.com/api/embed-eps', {
                        method: 'POST',
                        body: formData
                    });

                    if (!response.ok) throw new Error("Failed to embed EPS metadata on server.");

                    const epsBlob = await response.blob();
                    resolve(epsBlob);
                } catch (e) {
                    reject(e);
                }
            });
            filename = filename.replace(/(\.eps)$/i, '_meta$1');
            mimeType = "application/postscript";

        } else if (fileData.isVideo) {
            // Videos don't support direct embedding in this tool yet, return original
            return fileData.fileObject;
        } else if (fileData.isAiFile) {
            throw new Error("Direct embedding into .ai files is not supported. Please use the Copy buttons.");
        } else {
            throw new Error("Unsupported file format for embedding.");
        }

        return new File([blob], filename, { type: mimeType });
    }

    // Save to Local Folder Function
    window.saveToLocalFolder = async function () {
        const plan = (window.userUsageData?.plan || 'free').toLowerCase();
        if (plan === 'free') {
            alert("Upgrade to PRO/PREMIUM plan. Save to Folder features are for pro & premium users only.");
            if (typeof scrollToPricing === 'function') scrollToPricing();
            return;
        }

        if (!window.showDirectoryPicker) {
            alert("Your browser does not support the File System Access API. Please use Chrome, Edge, or Opera.");
            return;
        }

        // Filter files to save (eps যুক্ত করা হয়েছে)
        const filesToSave = uploadedFilesData.filter(f =>
            f.title && f.title !== "Error" &&
            (
                (f.fileObject.type && (['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'].includes(f.fileObject.type) || f.fileObject.type.startsWith('video/'))) ||
                (f.name && /\.(png|svg|jpg|jpeg|eps|mp4|mov|avi|webm|mkv)$/i.test(f.name))
            )
        );

        if (filesToSave.length === 0) {
            alert("No processable files found to save.");
            return;
        }

        try {
            // ১. [মূল ফিক্স] ফোল্ডার সিলেক্ট করার সাথেই 'readwrite' পারমিশন চেয়ে নেওয়া হচ্ছে!
            const dirHandle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });

            const btn = document.getElementById('saveToFolderButton');
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="icon-spinner"></i> ' + getTrans('saving');

            let savedCount = 0;
            for (const fileData of filesToSave) {
                try {
                    btn.innerHTML = `<i class="icon-spinner"></i> ${getTrans('saving')} ${savedCount + 1}/${filesToSave.length}`;

                    // ২. ফাইল এম্বেড করা (EPS এর ক্ষেত্রে সার্ভার থেকে হয়ে আসবে)
                    const embeddedFile = await getEmbeddedFile(fileData);

                    // ৩. ফোল্ডারে সেভ করা (এখন আর পারমিশন চাইবে না, কারণ আগেই নেওয়া হয়েছে)
                    const fileHandle = await dirHandle.getFileHandle(embeddedFile.name, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(embeddedFile);
                    await writable.close();

                    savedCount++;
                } catch (err) {
                    console.error(`Failed to save ${fileData.name}:`, err);
                }
            }

            alert(`Successfully saved ${savedCount} files to the selected folder!`);

            btn.disabled = false;
            btn.innerHTML = originalText;

        } catch (error) {
            // যদি ইউজার ফোল্ডার সিলেক্ট না করে Cancel করে দেয়, তাহলে এরর দেখাবে না
            if (error.name !== 'AbortError') {
                console.error("File System Access Error:", error);
                alert("An error occurred while saving files: " + error.message);

                // বাটন আগের অবস্থায় ফিরিয়ে আনা
                const btn = document.getElementById('saveToFolderButton');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-folder-open"></i> <span data-i18n="save_folder">Save to Folder</span>';
                }
            }
        }
    }

    // Wire up new buttons
    const saveToFolderBtn = document.getElementById('saveToFolderButton');
    if (saveToFolderBtn) {
        saveToFolderBtn.onclick = saveToLocalFolder;

        // Check support
        if (!window.showDirectoryPicker) {
            saveToFolderBtn.style.display = 'none'; // Hide if not supported
        }
    }

    const shareFilesBtn = document.getElementById('shareFilesButton');
    if (shareFilesBtn) {
        // Check support for file sharing
        if (!navigator.canShare) {
            shareFilesBtn.style.display = 'none';
        }

        shareFilesBtn.onclick = async () => {
            const filesToShare = uploadedFilesData.filter(f =>
                f.title && f.title !== "Error" &&
                (
                    (f.fileObject.type && ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'].includes(f.fileObject.type)) ||
                    (f.name && /\.(png|svg|jpg|jpeg|eps)$/i.test(f.name))
                )
            );

            if (filesToShare.length === 0) {
                alert("No processable files found to share.");
                return;
            }

            const originalText = shareFilesBtn.innerHTML;
            shareFilesBtn.disabled = true;
            shareFilesBtn.innerHTML = '<i class="icon-spinner"></i> ' + getTrans('preparing');

            try {
                const filesArray = [];
                for (const fileData of filesToShare) {
                    try {
                        const file = await getEmbeddedFile(fileData);
                        filesArray.push(file);
                    } catch (e) {
                        console.error(`Error processing ${fileData.name} for sharing:`, e);
                    }
                }

                if (filesArray.length === 0) {
                    alert("Failed to prepare files for sharing.");
                    return;
                }

                if (navigator.canShare && navigator.canShare({ files: filesArray })) {
                    await navigator.share({
                        files: filesArray,
                        title: 'MetaGen Pro Export',
                        text: 'Here are my processed files with metadata.'
                    });
                } else {
                    alert("Your browser does not support sharing these files.");
                }

            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error("Share Error:", error);
                    alert("Error sharing files: " + error.message);
                }
            } finally {
                shareFilesBtn.disabled = false;
                shareFilesBtn.innerHTML = originalText;
            }
        };
    }

    // --- Google Drive Integration ---
    const uploadToDriveBtn = document.getElementById('uploadToDriveButton');
    let tokenClient;
    let gapiInited = false;
    let gisInited = false;

    // Initialize GAPI and GSI
    function maybeInitGoogleDrive() {
        const apiKey = localStorage.getItem('googleDriveApiKey');
        const clientId = localStorage.getItem('googleDriveClientId');

        if (apiKey && clientId) {
            if (typeof gapi !== 'undefined' && !gapiInited) {
                gapi.load('client', async () => {
                    try {
                        await gapi.client.init({
                            apiKey: apiKey,
                            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
                        });
                        gapiInited = true;
                    } catch (err) {
                        console.error("GAPI Init Error:", err);
                    }
                });
            }

            if (typeof google !== 'undefined' && !gisInited) {
                tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: clientId,
                    scope: 'https://www.googleapis.com/auth/drive.file',
                    callback: (resp) => {
                        if (resp.error !== undefined) {
                            throw (resp);
                        }
                        // Token acquired, proceed to upload (handled in button click)
                    },
                });
                gisInited = true;
            }
        }
    }

    // Try to init on load if keys exist
    setTimeout(maybeInitGoogleDrive, 1000); // Give scripts time to load

    if (uploadToDriveBtn) {
        // Initial check for keys
        if (!localStorage.getItem('googleDriveApiKey') || !localStorage.getItem('googleDriveClientId')) {
            // We could hide button or show setup prompt on click. usage prompt on click is better.
        }

        uploadToDriveBtn.onclick = async () => {
            const apiKey = localStorage.getItem('googleDriveApiKey');
            const clientId = localStorage.getItem('googleDriveClientId');

            if (!apiKey || !clientId) {
                const setNow = confirm("Google Drive API Key and Client ID are missing. Would you like to set them now?\n\nYou need to create a project in Google Cloud Console, enable Drive API, and generate an API Key and OAuth Client ID.");
                if (setNow) {
                    const newClientId = prompt("Enter your Google Client ID:", clientId || "");
                    const newApiKey = prompt("Enter your Google API Key:", apiKey || "");
                    if (newClientId && newApiKey) {
                        localStorage.setItem('googleDriveClientId', newClientId);
                        localStorage.setItem('googleDriveApiKey', newApiKey);
                        attemptUpload();
                        maybeInitGoogleDrive(); // Re-init
                    }
                }
                return;
            }
            attemptUpload();
        };
    }

    async function attemptUpload() {
        maybeInitGoogleDrive(); // Ensure init

        // Wait briefly for init if needed (hacky but simple for now)
        if ((!gapiInited || !gisInited) && (typeof gapi !== 'undefined' && typeof google !== 'undefined')) {
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!gapiInited || !gisInited) {
            alert("Google Drive API failed to initialize. Please check your Console and API Keys.");
            return;
        }

        tokenClient.callback = async (resp) => {
            if (resp.error !== undefined) {
                throw (resp);
            }
            await uploadFilesToDrive();
        };

        if (gapi.client.getToken() === null) {
            // Prompt the user to select a Google Account and ask for consent to share their data
            // when establishing a new session.
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } else {
            // Skip display of account chooser and consent dialog for an existing session.
            tokenClient.requestAccessToken({ prompt: 'none' });
        }
    }

    window.uploadFilesToDrive = async function () {
        const filesToUpload = uploadedFilesData.filter(f =>
            f.title && f.title !== "Error" &&
            (
                (f.fileObject.type && (['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'].includes(f.fileObject.type) || f.fileObject.type.startsWith('video/'))) ||
                (f.name && /\.(png|svg|jpg|jpeg|eps|mp4|mov|avi|webm|mkv)$/i.test(f.name))
            )
        );

        if (filesToUpload.length === 0) {
            alert("No files to upload.");
            return;
        }

        const btn = document.getElementById('uploadToDriveButton');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="icon-spinner"></i> ' + getTrans('uploading');

        let successCount = 0;

        try {
            // Create a root folder "MetaGen Pro Exports"
            let folderId = null;
            // Check if folder exists (simple query)
            const q = "name = 'MetaGen Pro Exports' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
            const response = await gapi.client.drive.files.list({ q: q, fields: 'files(id, name)' });

            if (response.result.files && response.result.files.length > 0) {
                folderId = response.result.files[0].id;
            } else {
                // Create folder
                const fileMetadata = {
                    'name': 'MetaGen Pro Exports',
                    'mimeType': 'application/vnd.google-apps.folder'
                };
                const folder = await gapi.client.drive.files.create({
                    resource: fileMetadata,
                    fields: 'id'
                });
                folderId = folder.result.id;
            }

            for (const fileData of filesToUpload) {
                btn.innerHTML = `<i class="icon-spinner"></i> ${getTrans('uploading')} ${successCount + 1}/${filesToUpload.length}`;

                const embeddedFile = await getEmbeddedFile(fileData);

                // Prepare multipart upload
                const metadata = {
                    'name': embeddedFile.name,
                    'parents': [folderId]
                };

                const accessToken = gapi.client.getToken().access_token;
                const form = new FormData();
                form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                form.append('file', embeddedFile);

                await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                    method: 'POST',
                    headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
                    body: form
                }).then(res => {
                    if (!res.ok) throw new Error("Upload failed");
                    successCount++;
                });
            }

            alert(`Successfully uploaded ${successCount} files to 'MetaGen Pro Exports' on Google Drive!`);

        } catch (err) {
            console.error("Upload Error:", err);
            alert("Upload failed: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    window.loadFTPCredentials = function (platform) {
        const savedCreds = localStorage.getItem(`ftp_creds_${platform}`);
        if (savedCreds) {
            try {
                return JSON.parse(savedCreds);
            } catch (e) {
                console.error("Error parsing saved FTP creds for", platform);
            }
        }
        return null;
    };

    const stockAgencies = {
        'shutterstock': { name: 'Shutterstock', host: 'ftp.shutterstock.com', port: '' },
        'adobestock': { name: 'Adobe Stock', host: 'sftp.contributor.adobestock.com', port: '22' },
        'Magnific': { name: 'Magnific', host: 'contributor-ftp.magnific.com', port: '60022' },
        'vecteezy': { name: 'Vecteezy', host: 'ftp.vecteezy.com', port: '' },
        'vectorstock': { name: 'VectorStock', host: 'ftp.vectorstock.com', port: '' },
        '123rf': { name: '123RF', host: 'ftp.123rf.com', port: '' },
        'pond5': { name: 'Pond5', host: 'ftp.pond5.com', port: '' }
    };

    window.handleAgencyConfigChange = function () {
        const platform = document.getElementById('ftpPlatform').value;
        const hostInput = document.getElementById('ftpHost');
        const portInput = document.getElementById('ftpPort');
        const userInput = document.getElementById('ftpUser');
        const passInput = document.getElementById('ftpPass');

        if (platform === 'custom') {
            hostInput.placeholder = "ftp.your-site.com";
            if (portInput) portInput.value = '';
        } else {
            hostInput.placeholder = stockAgencies[platform].host;
            if (portInput) portInput.value = stockAgencies[platform].port || '';
        }

        const creds = window.loadFTPCredentials(platform);
        if (creds) {
            hostInput.value = creds.host || (platform === 'custom' ? '' : stockAgencies[platform].host);
            if (portInput) portInput.value = creds.port || (platform === 'custom' ? '' : (stockAgencies[platform].port || ''));
            userInput.value = creds.user || '';
            passInput.value = creds.pass || '';
        } else {
            hostInput.value = platform === 'custom' ? '' : stockAgencies[platform].host;
            if (portInput) portInput.value = platform === 'custom' ? '' : (stockAgencies[platform].port || '');
            userInput.value = '';
            passInput.value = '';
        }
    };

    const saveCredsBtn = document.getElementById('saveAgencyCredsBtn');
    if (saveCredsBtn) {
        saveCredsBtn.onclick = function () {
            const platform = document.getElementById('ftpPlatform').value;
            const host = document.getElementById('ftpHost').value.trim();
            const port = document.getElementById('ftpPort') ? document.getElementById('ftpPort').value.trim() : '';
            const user = document.getElementById('ftpUser').value.trim();
            const pass = document.getElementById('ftpPass').value.trim();

            if (!user || !pass) {
                alert("Please enter Username and Password.");
                return;
            }

            localStorage.setItem(`ftp_creds_${platform}`, JSON.stringify({ host, port, user, pass }));
            alert(`Credentials saved for ${platform === 'custom' ? 'Custom Site' : stockAgencies[platform].name}!`);
        };
    }

    const ftpUploadBtn = document.getElementById('ftpUploadButton');
    if (ftpUploadBtn) {
        ftpUploadBtn.onclick = () => {
            window.openFtpUploadModal();
        };
    }

    const startFtpBtn = document.getElementById('startFtpBtn');
    if (startFtpBtn) {
        startFtpBtn.onclick = async function () {
            console.log("Multi-Agency Upload Process Started...");

            const selectedAgencies = Array.from(document.querySelectorAll('.ftp-upload-checkbox:checked')).map(cb => cb.value);
            const statusDiv = document.getElementById('ftpStatus');
            const progressContainer = document.getElementById('ftpProgressContainer');
            const progressBar = document.getElementById('ftpProgressBar');
            const progressFileName = document.getElementById('ftpProgressFileName');
            const progressPercent = document.getElementById('ftpProgressPercent');

            if (selectedAgencies.length === 0) {
                alert("Please select at least one agency to upload.");
                return;
            }

            const filesToUpload = uploadedFilesData.filter(f => f.title && f.title !== "Error");
            if (filesToUpload.length === 0) {
                alert("Please process metadata for the images first!");
                return;
            }

            this.disabled = true;
            const originalBtnContent = this.innerHTML;
            progressContainer.style.display = 'block';
            statusDiv.innerHTML = `<span style="color: #F97316;">${getTrans('initializing')}...</span>`;

            let totalSuccess = 0;
            let totalFailed = 0;
            let totalFilesCount = filesToUpload.length * selectedAgencies.length;
            let currentStep = 0;

            for (const platform of selectedAgencies) {
                const creds = window.loadFTPCredentials(platform);
                if (!creds) {
                    alert(`No credentials found for ${stockAgencies[platform].name}. Please configure and save them first.`);
                    continue;
                }

                for (let i = 0; i < filesToUpload.length; i++) {
                    const fileData = filesToUpload[i];
                    currentStep++;

                    const percent = Math.round((currentStep / totalFilesCount) * 100);
                    progressBar.style.width = percent + '%';
                    progressFileName.innerText = `${stockAgencies[platform].name}: ${fileData.name}`;
                    progressPercent.innerText = percent + '%';
                    statusDiv.innerHTML = `<span style="color: #F97316;">${getTrans('uploading')} to ${stockAgencies[platform].name}...</span>`;

                    try {
                        const embeddedFile = await getEmbeddedFile(fileData);
                        const formData = new FormData();
                        formData.append('file', embeddedFile);
                        formData.append('host', creds.host.replace('sftp://', '').replace('ftp://', '').replace('ftps://', ''));
                        formData.append('port', creds.port || '');
                        formData.append('user', creds.user);
                        formData.append('pass', creds.pass);
                        const isSftp = creds.host.toLowerCase().includes('sftp') || creds.port === '60022' || creds.port === '22';
                        formData.append('protocol', isSftp ? 'sftp' : 'ftp');

                        const response = await fetch('https://metagen-eps-server.onrender.com/api/ftp-upload', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${auth.currentUser ? await auth.currentUser.getIdToken() : ""}`
                            },
                            body: formData
                        });

                        let result;
                        try {
                            result = await response.json();
                        } catch (e) { result = { success: false, error: 'Server returned invalid response' }; }

                        if (response.ok && result.success) {
                            totalSuccess++;
                            statusDiv.innerHTML = `<span style="color: #10B981;">&#10004; ${fileData.name} uploaded to ${stockAgencies[platform]?.name || platform}</span>`;
                        } else {
                            totalFailed++;
                            const errDetail = result.error || `HTTP ${response.status}`;
                            console.error(`Upload failed for ${platform} - ${fileData.name}: ${errDetail}`);
                            statusDiv.innerHTML = `<span style="color: #EF4444;">&#10008; ${fileData.name} failed: ${errDetail}</span>`;
                        }
                    } catch (err) {
                        totalFailed++;
                        console.error(`Upload error for ${platform}:`, err);
                        statusDiv.innerHTML = `<span style="color: #EF4444;">&#10008; ${fileData.name}: ${err.message}</span>`;
                    }
                }
            }

            // Final summary
            if (totalFailed > 0) {
                statusDiv.innerHTML = `<span style="color: #F59E0B; font-weight:bold;">&#9888; Upload Complete: ${totalSuccess} success, ${totalFailed} failed</span>`;
            } else {
                statusDiv.innerHTML = `<span style="color: #10B981; font-weight:bold;">&#10004; All uploads successful! Total: ${totalSuccess}</span>`;
            }
            setTimeout(() => {
                progressContainer.style.display = 'none';
                progressBar.style.width = '0%';
            }, 5000);

            // Success sound
            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                oscillator.frequency.value = 880;
                gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1);
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                oscillator.start();
                oscillator.stop(audioCtx.currentTime + 1);
            } catch (e) { }

            this.disabled = false;
            this.innerHTML = originalBtnContent;
        };
    }
});
