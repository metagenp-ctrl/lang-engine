        // =====================================================
        // ========== AI BACKGROUND REMOVAL (ClipDrop) =========
        // =====================================================
        let bgRemoveFilesData = [];

        function loadBgRemoveImages(event) {
            handleBgRemoveFiles(event.target.files);
            event.target.value = '';
        }

        function handleBgRemoveDrop(event) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.style.borderColor = 'var(--border-color)';
            handleBgRemoveFiles(event.dataTransfer.files);
        }

        function handleBgRemoveFiles(files) {
            if (!files || files.length === 0) return;

            // Plan Check
            const currentPlan = window.userUsageData?.plan?.toLowerCase() || 'free';
            if (currentPlan !== 'pro' && currentPlan !== 'premium' && currentPlan !== 'agency') {
                alert("Remove Background is a PRO/PREMIUM feature. Please upgrade your plan.");
                if (typeof scrollToPricing === 'function') scrollToPricing();
                return;
            }

            document.getElementById('bgRemoveUploadArea').style.display = 'none';
            document.getElementById('bgRemoveWorkspace').style.display = 'block';

            Array.from(files).forEach(file => {
                if (!file.type.startsWith('image/')) return;

                const id = 'bgrm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                bgRemoveFilesData.push({
                    id: id,
                    file: file,
                    processedBlob: null,
                    status: 'pending'
                });

                const reader = new FileReader();
                reader.onload = (e) => {
                    const fileData = bgRemoveFilesData.find(f => f.id === id);
                    if (fileData) {
                        fileData.originalDataUrl = e.target.result;
                        renderBgRemoveGrid();
                    }
                };
                reader.readAsDataURL(file);
            });
        }

        function renderBgRemoveGrid() {
            const grid = document.getElementById('bgRemoveGrid');
            document.getElementById('bgRemoveCount').innerText = bgRemoveFilesData.length;
            grid.innerHTML = '';

            bgRemoveFilesData.forEach(item => {
                const imgSrc = item.processedBlob ? URL.createObjectURL(item.processedBlob) : item.originalDataUrl;
                let statusHtml = '';
                if (item.status === 'processing') statusHtml = '<div style="position:absolute; top:5px; left:5px; background:rgba(0,0,0,0.6); color:white; padding:4px 8px; border-radius:6px; font-size:0.75em; font-weight:bold; z-index:5;"><i class="fas fa-spinner fa-spin"></i> Processing</div>';
                else if (item.status === 'success') statusHtml = '<div style="position:absolute; top:5px; left:5px; background:#10B981; color:white; padding:4px 8px; border-radius:6px; font-size:0.75em; font-weight:bold; z-index:5;"><i class="fas fa-check"></i> Done</div>';
                else if (item.status === 'error') statusHtml = '<div style="position:absolute; top:5px; left:5px; background:#EF4444; color:white; padding:4px 8px; border-radius:6px; font-size:0.75em; font-weight:bold; z-index:5;"><i class="fas fa-times"></i> Error</div>';

                let actionButtons = '';
                if (item.status === 'success') {
                    actionButtons = `
                <button onclick="downloadBgRemoved('${item.id}')" class="action-button green-button" style="width:100%; padding:8px; font-size:0.85em; margin-bottom:8px; display:flex; justify-content:center; gap:6px;"><i class="fas fa-download"></i> Download PNG</button>
                <button onclick="sendBgRemovedToMeta('${item.id}')" class="action-button blue-button" style="width:100%; padding:8px; font-size:0.85em; display:flex; justify-content:center; gap:6px;"><i class="fas fa-share-square"></i> Send Metadata</button>
            `;
                } else {
                    actionButtons = `<button onclick="processSingleBgRemove('${item.id}')" class="action-button orange-button" style="width:100%; padding:8px; font-size:0.85em; display:flex; justify-content:center; gap:6px;" ${item.status === 'processing' ? 'disabled' : ''}><i class="fas fa-cut"></i> Remove BG</button>`;
                }

                grid.innerHTML += `
            <div id="${item.id}" style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:12px; overflow:hidden; display:flex; flex-direction:column; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="position:relative; height:180px; background:repeating-conic-gradient(#80808033 0 25%, transparent 0 50%) 50% / 20px 20px;">
                    <button onclick="window.removeSingleBgRemoveItem('${item.id}')" title="Remove Image" style="position:absolute; top:5px; right:5px; background:rgba(239, 68, 68, 0.85); color:white; border:none; border-radius:50%; width:26px; height:26px; cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:10; transition: background 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 1)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.85)'"><i class="fas fa-times"></i></button>
                    <img src="${imgSrc}" style="width:100%; height:100%; object-fit:contain;" />
                    ${statusHtml}
                </div>
                <div style="padding:15px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
                    <div style="font-size:0.85em; font-weight:600; margin-bottom:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text-primary);" title="${item.file.name}">${item.file.name}</div>
                    <div>
                        ${actionButtons}
                    </div>
                </div>
            </div>
        `;
            });
        }

        window.removeSingleBgRemoveItem = function (id) {
            bgRemoveFilesData = bgRemoveFilesData.filter(f => f.id !== id);
            if (bgRemoveFilesData.length === 0) {
                clearBgRemoveWorkspace();
            } else {
                renderBgRemoveGrid();
            }
        };

        function clearBgRemoveWorkspace() {
            bgRemoveFilesData = [];
            document.getElementById('bgRemoveWorkspace').style.display = 'none';
            document.getElementById('bgRemoveUploadArea').style.display = 'block';
            renderBgRemoveGrid();
        }

        async function processSingleBgRemove(id) {
            const item = bgRemoveFilesData.find(f => f.id === id);
            if (!item || item.status === 'success') return;

            item.status = 'processing';
            renderBgRemoveGrid();

            try {
                const user = firebase.auth().currentUser;
                if (!user) throw new Error("Please login first");
                const idToken = await user.getIdToken();

                const formData = new FormData();
                formData.append('image_file', item.file);

                // Note: Make sure 'remove-background' endpoint is configured in your Cloudflare worker pointing to Clipdrop.
                const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/clipdrop/remove-background', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + idToken },
                    body: formData
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || 'API Error: Check Clipdrop balance or config');
                }

                const blob = await response.blob();
                item.processedBlob = blob;
                item.status = 'success';

            } catch (err) {
                console.error("BG Remove Error:", err);
                item.status = 'error';
                alert(`Failed to remove background for ${item.file.name}: ${err.message}`);
            } finally {
                renderBgRemoveGrid();
            }
        }

        async function processBgRemovalBatch() {
            const pendingItems = bgRemoveFilesData.filter(f => f.status !== 'success');
            if (pendingItems.length === 0) {
                alert("All images are already processed!");
                return;
            }

            const loadingEl = document.getElementById('bgRemoveLoading');
            const processBtn = document.getElementById('bgRemoveProcessAllBtn');

            loadingEl.style.display = 'block';
            processBtn.disabled = true;

            // Concurrent processing (2 at a time to prevent API rate limiting)
            const CONCURRENCY = 2;
            for (let i = 0; i < pendingItems.length; i += CONCURRENCY) {
                const chunk = pendingItems.slice(i, i + CONCURRENCY);
                await Promise.all(chunk.map(item => processSingleBgRemove(item.id)));
                await new Promise(r => setTimeout(r, 1000)); // Rate limit delay
            }

            loadingEl.style.display = 'none';
            processBtn.disabled = false;
            alert("Batch Background Removal Complete!");
        }

        function downloadBgRemoved(id) {
            const item = bgRemoveFilesData.find(f => f.id === id);
            if (!item || !item.processedBlob) return;

            const url = URL.createObjectURL(item.processedBlob);
            const a = document.createElement('a');
            a.href = url;
            const baseName = item.file.name.substring(0, item.file.name.lastIndexOf('.')) || item.file.name;
            a.download = baseName + '_nobg.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        function sendBgRemovedToMeta(id) {
            const item = bgRemoveFilesData.find(f => f.id === id);
            if (!item || !item.processedBlob) return;

            const baseName = item.file.name.substring(0, item.file.name.lastIndexOf('.')) || item.file.name;
            const newFile = new File([item.processedBlob], baseName + '_nobg.png', { type: 'image/png' });

            // Push directly to Metadata Generator queue
            if (typeof handleFiles === 'function') {
                handleFiles([newFile]);

                // Auto-switch to metadata section
                const metaTabBtn = document.querySelector('.mode-button[data-section="meta"]');
                if (metaTabBtn) {
                    metaTabBtn.click();
                    // Scroll top
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            }
        }



        // =============================================
        // SEO AUTO-FIX HANDLER
        // =============================================
        window.fixSeoIssue = async function (cardId, fixType) {
            const fileData = uploadedFilesData.find(f => f.id === cardId);
            if (!fileData) return;

            const card = document.getElementById(cardId);
            if (!card) return;

            let fixBtn = null;
            const suggestionsContainer = document.getElementById(`seo-suggestions-${cardId}`);
            if (suggestionsContainer) {
                const buttons = suggestionsContainer.querySelectorAll('button');
                buttons.forEach(btn => {
                    if (btn.textContent.includes('Fix') && btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(fixType)) {
                        fixBtn = btn;
                    }
                });
            }

            let originalBtnHtml = fixBtn ? fixBtn.innerHTML : '';
            if (fixBtn) {
                fixBtn.innerHTML = '⚡ Fixing...';
                fixBtn.disabled = true;
            }

            let changed = false;

            if (fixType === 'trim_title' || fixType === 'trim_desc') {
                const user = typeof auth !== 'undefined' ? auth.currentUser : null;
                let authHeaders = {};
                if (user) {
                    try {
                        const token = await user.getIdToken();
                        authHeaders["Authorization"] = `Bearer ${token}`;
                    } catch (e) {
                        console.warn("Could not get ID token:", e);
                    }
                }

                const valueToFix = fixType === 'trim_title' ? (fileData.title || '') : (fileData.description || '');

                try {
                    const response = await fetch("https://metagen-pro-api.metagenp.workers.dev/api/fix-seo-issue", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            ...authHeaders
                        },
                        body: JSON.stringify({
                            fixType: fixType,
                            text: valueToFix
                        })
                    });

                    if (!response.ok) {
                        const errData = await response.json().catch(() => ({}));
                        throw new Error(errData.error || `HTTP ${response.status}`);
                    }

                    const data = await response.json();
                    if (data.success && data.fixedText) {
                        if (fixType === 'trim_title') {
                            fileData.title = data.fixedText.trim();
                            const titleEl = card.querySelector('.meta-title');
                            if (titleEl) titleEl.textContent = fileData.title;
                            const titleCount = document.getElementById(`title-count-${cardId}`);
                            if (titleCount) {
                                const count = fileData.title.split(/\s+/).filter(w => w.length > 0).length;
                                titleCount.textContent = `(${count})`;
                            }
                            if (typeof showCustomAlert === 'function') showCustomAlert(`✨ Title optimized using AI to ${fileData.title.length} characters.`, 'success');
                        } else {
                            fileData.description = data.fixedText.trim();
                            const descEl = card.querySelector('.meta-description');
                            if (descEl) descEl.textContent = fileData.description;
                            const descCount = document.getElementById(`desc-count-${cardId}`);
                            if (descCount) {
                                const count = fileData.description.split(/\s+/).filter(w => w.length > 0).length;
                                descCount.textContent = `(${fileData.description.length})`;
                            }
                            if (typeof showCustomAlert === 'function') showCustomAlert(`✨ Description optimized using AI to ${fileData.description.length} characters.`, 'success');
                        }
                        changed = true;
                    } else {
                        throw new Error("Invalid response format");
                    }
                } catch (error) {
                    console.error("AI SEO Fix failed, falling back to smart trim:", error);
                    if (fixType === 'trim_title') {
                        let title = (fileData.title || '').trim();
                        if (title.length > 70) {
                            let trimmed = title.substring(0, 70);
                            const lastSpace = trimmed.lastIndexOf(' ');
                            if (lastSpace > 30) trimmed = trimmed.substring(0, lastSpace);
                            fileData.title = trimmed;
                            const titleEl = card.querySelector('.meta-title');
                            if (titleEl) titleEl.textContent = fileData.title;
                            const titleCount = document.getElementById(`title-count-${cardId}`);
                            if (titleCount) {
                                const count = fileData.title.split(/\s+/).filter(w => w.length > 0).length;
                                titleCount.textContent = `(${count})`;
                            }
                            changed = true;
                        }
                    } else {
                        let desc = (fileData.description || '').trim();
                        if (desc.length > 160) {
                            let trimmed = desc.substring(0, 155);
                            const lastPeriod = trimmed.lastIndexOf('.');
                            if (lastPeriod > 80) {
                                trimmed = trimmed.substring(0, lastPeriod + 1);
                            } else {
                                const lastSpace = trimmed.lastIndexOf(' ');
                                if (lastSpace > 80) trimmed = trimmed.substring(0, lastSpace);
                            }
                            fileData.description = trimmed;
                            const descEl = card.querySelector('.meta-description');
                            if (descEl) descEl.textContent = fileData.description;
                            const descCount = document.getElementById(`desc-count-${cardId}`);
                            if (descCount) descCount.textContent = `(${fileData.description.length})`;
                            changed = true;
                        }
                    }
                }
            } else {
                switch (fixType) {
                    case 'remove_duplicates': {
                        let keywords = Array.isArray(fileData.keywords)
                            ? fileData.keywords
                            : (fileData.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
                        const seen = new Set();
                        const unique = [];
                        keywords.forEach(kw => {
                            const lower = kw.toLowerCase();
                            if (!seen.has(lower)) {
                                seen.add(lower);
                                unique.push(kw);
                            }
                        });
                        const removedCount = keywords.length - unique.length;
                        if (removedCount > 0) {
                            fileData.keywords = unique;
                            if (typeof window.updateKeywordsDisplay === 'function') window.updateKeywordsDisplay(cardId);
                            changed = true;
                            if (typeof showCustomAlert === 'function') showCustomAlert(`🗑️ Removed ${removedCount} duplicate keyword(s).`, 'success');
                        }
                        break;
                    }

                    case 'fix_title_stuffing': {
                        let title = (fileData.title || '').trim();
                        const words = title.split(/\s+/);
                        const wordCount = {};
                        const cleaned = [];
                        words.forEach(w => {
                            const lower = w.toLowerCase();
                            wordCount[lower] = (wordCount[lower] || 0) + 1;
                            if (lower.length <= 3 || wordCount[lower] <= 2) {
                                cleaned.push(w);
                            }
                        });
                        const newTitle = cleaned.join(' ');
                        if (newTitle !== title) {
                            fileData.title = newTitle;
                            const titleEl = card.querySelector('.meta-title');
                            if (titleEl) titleEl.textContent = fileData.title;
                            const titleCount = document.getElementById(`title-count-${cardId}`);
                            if (titleCount) {
                                const count = fileData.title.split(/\s+/).filter(w => w.length > 0).length;
                                titleCount.textContent = `(${count})`;
                            }
                            changed = true;
                            if (typeof showCustomAlert === 'function') showCustomAlert('🧹 Removed repeated words from title.', 'success');
                        }
                        break;
                    }
                }
            }

            if (fixBtn) {
                fixBtn.innerHTML = originalBtnHtml;
                fixBtn.disabled = false;
            }

            if (changed && typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
                const newSeo = calculateSeoScore(fileData);
                updateSeoMeter(cardId, newSeo);
                if (typeof window.scheduleSessionSave === 'function') {
                    window.scheduleSessionSave();
                }
            }
        };

