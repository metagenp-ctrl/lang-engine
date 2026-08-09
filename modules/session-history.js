        // ====== INDEXEDDB SESSION LOGIC ======
        window.SessionDB = {
            dbName: 'MetaGenPro_SessionDB',
            dbVersion: 2,
            storeName: 'activeSession',

            async getDB() {
                return new Promise((resolve, reject) => {
                    const req = indexedDB.open(this.dbName, this.dbVersion);
                    req.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains(this.storeName)) {
                            db.createObjectStore(this.storeName, { keyPath: 'id' });
                        }
                        if (!db.objectStoreNames.contains('metadataHistory')) {
                            db.createObjectStore('metadataHistory', { keyPath: 'id' });
                        }
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            },

            async saveCurrentSession() {
                try {
                    const db = await this.getDB();
                    const tx = db.transaction([this.storeName, 'metadataHistory'], 'readwrite');
                    const store = tx.objectStore(this.storeName);
                    const histStore = tx.objectStore('metadataHistory');
                    await new Promise((resolve) => {
                        const clearReq = store.clear();
                        clearReq.onsuccess = resolve;
                    });

                    if (!window.uploadedFilesData || window.uploadedFilesData.length === 0) return;
                    for (let data of window.uploadedFilesData) {
                        store.put({
                            id: data.id,
                            name: data.name,
                            fileObject: data.fileObject,
                            previewFile: data.previewFile,
                            title: data.title || '',
                            description: data.description || '',
                            keywords: data.keywords || '',
                            category: data.category || '',
                            status: data.status || '',
                            salesProbability: data.salesProbability,
                            demandLevel: data.demandLevel,
                            competitionLevel: data.competitionLevel,
                            trendingScore: data.trendingScore,
                            bestPlatforms: data.bestPlatforms,
                            strengths: data.strengths
                        });

                        if (data.title && data.title !== 'Error' && data.status === 'success') {
                            const size = data.fileObject ? data.fileObject.size : 0;
                            const histId = encodeURIComponent(data.name) + '_' + size;

                            // Get stored thumbnail or capture if missing
                            let thumb = data.thumbnail;
                            if (!thumb && typeof captureThumbnail === 'function') {
                                thumb = captureThumbnail(data.id, 100);
                            }

                            histStore.put({
                                id: histId,
                                name: data.name,
                                title: data.title,
                                description: data.description || '',
                                keywords: data.keywords || '',
                                thumbnail: thumb, // Save the base64 thumbnail
                                timestamp: Date.now()
                            });
                        }
                    }
                } catch (e) {
                    console.warn("Could not save session to IndexedDB:", e);
                }
            },

            async loadMetadataHistory() {
                return new Promise(async (resolve) => {
                    try {
                        const db = await this.getDB();
                        const tx = db.transaction('metadataHistory', 'readonly');
                        const store = tx.objectStore('metadataHistory');
                        const req = store.getAll();
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => resolve([]);
                    } catch (e) {
                        resolve([]);
                    }
                });
            },

            async clearSession() {
                try {
                    const db = await this.getDB();
                    const tx = db.transaction(this.storeName, 'readwrite');
                    const store = tx.objectStore(this.storeName);
                    store.clear();
                } catch (e) { }
            },

            async loadSession() {
                return new Promise(async (resolve) => {
                    try {
                        const db = await this.getDB();
                        const tx = db.transaction(this.storeName, 'readonly');
                        const store = tx.objectStore(this.storeName);
                        const req = store.getAll();
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => resolve([]);
                    } catch (e) {
                        resolve([]);
                    }
                });
            }
        };

        window.scheduleSessionSave = function () {
            if (window._sessionSaveTimer) clearTimeout(window._sessionSaveTimer);
            window._sessionSaveTimer = setTimeout(() => {
                if (typeof window.SessionDB !== 'undefined') window.SessionDB.saveCurrentSession();
            }, 1000);
        };

        window.addEventListener('load', async () => {
            // Restore from IndexedDB
            const savedData = await window.SessionDB.loadSession();
            if (savedData && savedData.length > 0) {
                if (confirm(`We found ${savedData.length} images and metadata from the previous session. Do you want to restore the previous files and metadata?`)) {
                    // Start restoration
                    const fileList = savedData.map(d => d.fileObject).filter(f => f != null && typeof f === 'object');
                    if (fileList.length > 0) {
                        if (typeof window.handleFiles === 'function') await window.handleFiles(fileList);

                        // Wait briefly for DOM to render the new cards
                        setTimeout(() => {
                            savedData.forEach((d, index) => {
                                const newlyAdded = window.uploadedFilesData[index];
                                if (newlyAdded) {
                                    newlyAdded.title = d.title;
                                    newlyAdded.description = d.description;
                                    newlyAdded.keywords = d.keywords;
                                    newlyAdded.status = d.status;
                                    newlyAdded.salesProbability = d.salesProbability;
                                    newlyAdded.demandLevel = d.demandLevel;
                                    newlyAdded.competitionLevel = d.competitionLevel;
                                    newlyAdded.trendingScore = d.trendingScore;
                                    newlyAdded.bestPlatforms = d.bestPlatforms;
                                    newlyAdded.strengths = d.strengths;
                                    newlyAdded.category = d.category;

                                    // Update DOM
                                    const cardDOM = document.getElementById(newlyAdded.id);
                                    if (cardDOM) {
                                        const metaContainer = document.getElementById('meta-' + newlyAdded.id);
                                        if (metaContainer) metaContainer.style.display = 'block';

                                        const metaCol = cardDOM.querySelector('.card-meta-col');
                                        if (metaCol) metaCol.style.display = 'flex';

                                        const tEl = cardDOM.querySelector('.meta-title');
                                        if (tEl && d.title) {
                                            tEl.textContent = d.title;
                                            const clarityBtn = document.getElementById(`check-clarity-btn-${newlyAdded.id}`);
                                            if (clarityBtn) clarityBtn.style.display = 'inline-flex';
                                        }

                                        const dEl = cardDOM.querySelector('.meta-description');
                                        const dSection = document.getElementById('desc-section-' + newlyAdded.id);
                                        if (dEl && d.description) {
                                            if (dSection) dSection.style.display = 'block';
                                            dEl.textContent = d.description;
                                        }

                                        // Restore Category
                                        const aiCategorySelect = document.getElementById(`ai-category-${newlyAdded.id}`);
                                        if (aiCategorySelect && d.category) {
                                            aiCategorySelect.value = d.category;
                                        }

                                        if (d.keywords && typeof window.updateKeywordsDisplay === 'function') {
                                            window.updateKeywordsDisplay(newlyAdded.id);
                                        } else {
                                            const kwEl = cardDOM.querySelector('.meta-keywords');
                                            if (kwEl && d.keywords) {
                                                kwEl.innerHTML = '';
                                                d.keywords.split(',').forEach(k => {
                                                    if (!k.trim()) return;
                                                    const s = document.createElement('span');
                                                    s.className = 'meta-keyword';
                                                    s.textContent = k.trim();
                                                    kwEl.appendChild(s);
                                                });
                                            }
                                        }

                                        if (d.status === 'success') {
                                            const statusEl = document.getElementById('status-' + newlyAdded.id);
                                            if (statusEl) {
                                                statusEl.textContent = 'Generated';
                                                statusEl.style.color = '#10B981';
                                                statusEl.style.background = 'rgba(16,185,129,0.1)';
                                            }

                                            // Restore SEO Meter
                                            if (typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
                                                const seoScore = calculateSeoScore(d);
                                                updateSeoMeter(newlyAdded.id, seoScore);
                                            }

                                            cardDOM.style.borderColor = "#10B981";
                                            cardDOM.classList.add('metadata-generated', 'generated');

                                            // Disable processing state if any
                                            cardDOM.classList.remove('processing');
                                            const spinner = cardDOM.querySelector('.loading-spinner');
                                            if (spinner) spinner.style.display = 'none';
                                        }
                                    }
                                }
                            });
                        }, 1200);
                    }
                } else {
                    window.SessionDB.clearSession();
                }
            }

            // Setup MutationObserver to save on changes dynamically
            setTimeout(() => {
                const container = document.getElementById('filePreviewContainer');
                if (container) {
                    const observer = new MutationObserver(() => {
                        window.scheduleSessionSave();
                    });
                    observer.observe(container, { childList: true, subtree: true, characterData: true, attributes: true });
                }
            }, 1000);
        });

        // --- SECURE METADATA HISTORY PLATFORM ENGINE ---
        window.cachedHistory = [];

        // কপি লজিক (উইন্ডো স্কোপ)
        window.copyHistoryField = function (btn, encodedItem, field) {
            try {
                const item = JSON.parse(decodeURIComponent(encodedItem));
                let text = item[field] || '';

                if (field === 'keywords' && Array.isArray(text)) {
                    text = text.join(', ');
                }

                navigator.clipboard.writeText(text);

                const originalHTML = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> Copied';
                btn.style.background = 'rgba(16, 185, 129, 0.15)';
                btn.style.color = '#10B981';

                setTimeout(() => {
                    btn.innerHTML = originalHTML;
                    btn.style.background = '';
                    btn.style.color = '';
                }, 1500);
            } catch (err) {
                console.error("Copy failed:", err);
            }
        };

        // সিএসভি এক্সপোর্ট লজিক (উইন্ডো স্কোপ)
        window.exportHistoryCsv = async function () {
            try {
                if (typeof window.SessionDB === 'undefined') {
                    alert("Session database is not initialized.");
                    return;
                }
                const allHistory = await window.SessionDB.loadMetadataHistory();
                if (!allHistory || allHistory.length === 0) {
                    alert("No history found to export.");
                    return;
                }

                allHistory.sort((a, b) => b.timestamp - a.timestamp);

                let csvContent = "Filename,Title,Description,Keywords,Timestamp\n";
                allHistory.forEach(item => {
                    const name = (item.name || "").replace(/"/g, '""');
                    const title = (item.title || "").replace(/"/g, '""');
                    const desc = (item.description || "").replace(/"/g, '""');
                    const keywords = (item.keywords || "").replace(/"/g, '""');
                    const dateStr = new Date(item.timestamp).toLocaleString().replace(/"/g, '""');

                    csvContent += `"${name}","${title}","${desc}","${keywords}","${dateStr}"\n`;
                });

                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.setAttribute("download", `metagen_history_export_${Date.now()}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } catch (e) {
                console.error("Export History Error:", e);
                alert("Export failed: " + e.message);
            }
        };

        // হিস্ট্রি ক্লিয়ার লজিক (উইন্ডো স্কোপ)
        window.clearAllHistory = async function () {
            if (!confirm("Are you sure you want to permanently delete your entire metadata history? This cannot be undone.")) return;
            try {
                if (typeof window.SessionDB === 'undefined') {
                    alert("Session database is not initialized.");
                    return;
                }
                const db = await window.SessionDB.getDB();
                const tx = db.transaction('metadataHistory', 'readwrite');
                const store = tx.objectStore('metadataHistory');
                const req = store.clear();
                req.onsuccess = () => {
                    alert("History cleared successfully!");
                    window.openMetadataHistoryModal();
                };
                req.onerror = () => {
                    alert("Failed to clear history.");
                };
            } catch (e) {
                console.error(e);
            }
        };

        window.deleteHistoryItem = async function (histId) {
            if (!confirm("Are you sure you want to delete this item from your history?")) return;
            try {
                if (typeof window.SessionDB === 'undefined') {
                    alert("Session database is not initialized.");
                    return;
                }
                const db = await window.SessionDB.getDB();
                const tx = db.transaction('metadataHistory', 'readwrite');
                const store = tx.objectStore('metadataHistory');
                const req = store.delete(histId);
                req.onsuccess = () => {
                    // সফলভাবে ডিলিট হলে মোডাল রিফ্রেশ করবে
                    window.openMetadataHistoryModal();
                };
                req.onerror = () => {
                    alert("Failed to delete the history item.");
                };
            } catch (e) {
                console.error("Delete History Item Error:", e);
            }
        };

        // মোডাল ওপেন লজিক
        window.openMetadataHistoryModal = async function () {
            const modal = document.getElementById('metadataHistoryModal');
            const list = document.getElementById('metadataHistoryList');
            const upsell = document.getElementById('metadataHistoryUpsell');
            const limitText = document.getElementById('metadataHistoryTierLimitText');
            const searchInput = document.getElementById('historySearchInput');

            if (searchInput) searchInput.value = '';
            modal.style.display = 'flex';
            list.innerHTML = '<div style="text-align: center; margin-top: 40px; color: var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Fetching history database...</div>';

            try {
                let currentPlan = 'free';
                if (window.userUsageData) {
                    const rawPlan = String(window.userUsageData.plan || '').toLowerCase();
                    if (rawPlan.includes('premium') || window.userUsageData.limit >= 100) currentPlan = 'premium';
                    else if (rawPlan.includes('pro')) currentPlan = 'pro';
                }

                let limitMs = 24 * 60 * 60 * 1000;
                if (currentPlan === 'pro') limitMs = 30 * 24 * 60 * 60 * 1000;
                if (currentPlan === 'premium') limitMs = Infinity;

                if (currentPlan === 'free') limitText.textContent = "Free tier is limited to last 24hrs history.";
                else if (currentPlan === 'pro') limitText.textContent = "Pro tier is limited to last 30 days history.";

                const allHistory = typeof window.SessionDB !== 'undefined' ? await window.SessionDB.loadMetadataHistory() : [];
                allHistory.sort((a, b) => b.timestamp - a.timestamp);
                window.cachedHistory = allHistory;

                let visibleItems = [];
                let hasHiddenBlocks = false;

                allHistory.forEach(item => {
                    const age = Date.now() - (item.timestamp || 0);
                    if (age <= limitMs) {
                        visibleItems.push(item);
                    } else {
                        hasHiddenBlocks = true;
                    }
                });

                window.renderHistoryItems(visibleItems);

                if (hasHiddenBlocks && currentPlan !== 'premium') {
                    upsell.style.display = 'block';
                } else {
                    upsell.style.display = 'none';
                }

            } catch (e) {
                list.innerHTML = '<div style="color:#EF4444; text-align:center;"><i class="fas fa-exclamation-triangle"></i> Error loading history.</div>';
                console.error(e);
            }
        };

        // হিস্ট্রি আইটেম রেন্ডার লজিক
        window.renderHistoryItems = function (items) {
            const list = document.getElementById('metadataHistoryList');
            if (!list) return;

            if (items.length === 0) {
                list.innerHTML = '<div style="text-align: center; margin-top: 40px; color: var(--text-muted);"><i class="fas fa-folder-open"></i> No matching history records found.</div>';
                return;
            }

            let html = `
            <style>
                .hist-card {
                    display: flex; gap: 16px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; align-items: flex-start; transition: transform 0.2s, box-shadow 0.2s; box-shadow: var(--shadow-sm);
                }
                .hist-thumb {
                    width: 100px; height: 100px; background: var(--bg-input); border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid var(--border-color);
                }
                .hist-content {
                    flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between; min-width: 0;
                }
                .hist-actions {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                    border-top: 1px solid rgba(255,255,255,0.05);
                    padding-top: 10px;
                    justify-content: flex-start;
                }
                .hist-actions > button {
                    flex: 1 1 auto;
                    min-width: 70px;
                    padding: 6px 8px;
                    font-size: 0.75em;
                    font-weight: 600;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: 0.2s;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 5px;
                    white-space: nowrap;
                }
                @media (max-width: 600px) {
                    .hist-card {
                        flex-direction: column;
                        align-items: center;
                        text-align: center;
                    }
                    .hist-thumb {
                        width: 100%;
                        height: 160px;
                    }
                    .hist-content {
                        width: 100%;
                    }
                    .hist-actions {
                        justify-content: center;
                    }
                }
            </style>
            `;

            items.forEach(item => {
                let dateStr = 'Unknown Date';
                if (item.timestamp) {
                    try {
                        const d = new Date(item.timestamp);
                        if (!isNaN(d.getTime())) {
                            dateStr = d.toLocaleString();
                        }
                    } catch (e) { }
                }

                // Handle keywords if it is an array or string
                let kwString = '';
                if (typeof item.keywords === 'string') {
                    kwString = item.keywords;
                } else if (Array.isArray(item.keywords)) {
                    kwString = item.keywords.join(', ');
                }

                const safeItemString = encodeURIComponent(JSON.stringify({
                    ...item,
                    keywords: kwString // Normalize keywords inside safe item string
                }));

                const kwArray = kwString.split(',').map(k => k.trim()).filter(Boolean);

                html += `
                    <div class="hist-card">
                        <!-- Thumbnail -->
                        <div class="hist-thumb">
                            ${item.thumbnail ? `<img src="${item.thumbnail}" style="width: 100%; height: 100%; object-fit: cover;" alt="thumb" />` : '<i class="fas fa-file-image" style="font-size: 2em; color: var(--text-muted);"></i>'}
                        </div>
                        <!-- Metadata Column -->
                        <div class="hist-content">
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 10px; flex-wrap: wrap;">
                                    <span style="font-size: 0.8em; color: var(--text-muted); font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;" title="${item.name}">${item.name}</span>
                                    <span style="font-size: 0.75em; color: var(--text-muted); white-space: nowrap;">${dateStr}</span>
                                </div>
                                <div style="font-weight: 700; font-size: 1.05em; color: var(--text-primary); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.title}">${item.title || 'Untitled'}</div>
                                <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${item.description}">${item.description || 'No description available'}</div>
                            </div>
                            <!-- Tags & Actions -->
                            <div>
                                <div style="font-size: 0.8em; color: var(--accent-orange); display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; max-height: 40px; overflow: hidden; justify-content: inherit;">
                                    ${kwArray.slice(0, 8).map(k => `<span style="background: var(--bg-input); padding: 2px 6px; border-radius: 4px; font-size: 0.85em; border: 1px solid rgba(255,255,255,0.05);">${k}</span>`).join('')}
                                    ${kwArray.length > 8 ? `<span style="font-size:0.8em; color: var(--text-muted); align-self: center;">+${kwArray.length - 8} more</span>` : ''}
                                </div>
                                <div class="hist-actions">
                                    <button class="action-button" onclick="window.copyHistoryField(this, '${safeItemString}', 'title')" style="background: rgba(139, 92, 246, 0.1); color: #8B5CF6;"><i class="fas fa-copy"></i> Title</button>
                                    <button class="action-button" onclick="window.copyHistoryField(this, '${safeItemString}', 'description')" style="background: rgba(139, 92, 246, 0.1); color: #8B5CF6;"><i class="fas fa-copy"></i> Desc</button>
                                    <button class="action-button" onclick="window.copyHistoryField(this, '${safeItemString}', 'keywords')" style="background: rgba(139, 92, 246, 0.1); color: #8B5CF6;"><i class="fas fa-copy"></i> Keywords</button>
                                    <button class="action-button" onclick="window.restoreHistoryItemToGrid('${safeItemString}')" style="background: rgba(16, 185, 129, 0.15); color: #10B981;"><i class="fas fa-plus-circle"></i> Load</button>
                                    <button class="action-button" onclick="window.deleteHistoryItem('${(item.id || '').replace(/'/g, "\\'")}')" style="background: rgba(239, 68, 68, 0.1); color: #EF4444;"><i class="fas fa-trash-alt"></i> Delete</button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
            list.innerHTML = html;
        };

        // মোডাল ক্লোজ
        window.closeMetadataHistoryModal = function () {
            document.getElementById('metadataHistoryModal').style.display = 'none';
        };

        // --- 🩹 OPTIMIZED WORKSPACE RESTORE ENGINE ---
        window.updateDescription = function (element) {
            const card = element.closest('.file-preview-card');
            if (!card) return;
            const cardId = card.id;

            const fileData = uploadedFilesData.find(f => f.id === cardId);
            if (!fileData) return;

            fileData.description = element.innerText.trim();

            // Update Count
            const count = fileData.description.split(/\s+/).filter(w => w.length > 0).length;
            const countElem = document.getElementById(`desc-count-${card.id}`);
            if (countElem) countElem.textContent = `(${count})`;

            // Update SEO Score
            if (typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
                const score = calculateSeoScore(fileData);
                updateSeoMeter(cardId, score);
            }
        };

        window.restoreHistoryItemToGrid = function (encodedItem) {
            try {
                const item = JSON.parse(decodeURIComponent(encodedItem));
                if (!item) return;

                const previewContainer = document.getElementById('filePreviewContainer');
                if (!previewContainer) {
                    alert("Preview container not found.");
                    return;
                }

                // ডুপ্লিকেট এড়াতে ফাইলটি অলরেডি গ্রিডে সক্রিয় আছে কি না চেক করুন
                let existing = window.uploadedFilesData.find(f => f.name === item.name);

                if (existing) {
                    existing.title = item.title;
                    existing.description = item.description;
                    existing.keywords = item.keywords;
                    existing.status = 'success';

                    // সরাসরি চলমান DOM উপাদান আপডেট করুন
                    const cardDOM = document.getElementById(existing.id);
                    if (cardDOM) {
                        const metaCol = cardDOM.querySelector('.card-meta-col');
                        if (metaCol) metaCol.style.display = 'flex';
                        const tEl = cardDOM.querySelector('.meta-title');
                        if (tEl) tEl.textContent = item.title;
                        const dEl = cardDOM.querySelector('.meta-description');
                        const dSection = document.getElementById('desc-section-' + existing.id);
                        if (dEl) {
                            if (dSection) dSection.style.display = item.description ? 'block' : 'none';
                            dEl.textContent = item.description;
                        }
                        if (typeof window.updateKeywordsDisplay === 'function') {
                            window.updateKeywordsDisplay(existing.id);
                        }
                        cardDOM.style.borderColor = "#10B981";
                        cardDOM.classList.add('metadata-generated');
                        cardDOM.classList.remove('processing');

                        const titleCountElem = document.getElementById(`title-count-${existing.id}`);
                        if (titleCountElem && item.title) {
                            const count = item.title.split(/\s+/).filter(w => w.length > 0).length;
                            titleCountElem.textContent = `(${count})`;
                        }

                        const descCountElem = document.getElementById(`desc-count-${existing.id}`);
                        if (descCountElem && item.description) {
                            const count = item.description.split(/\s+/).filter(w => w.length > 0).length;
                            descCountElem.textContent = `(${count})`;
                        }
                    }
                    alert(`Metadata updated for active file: ${item.name}`);
                } else {
                    // একটি ভার্চুয়াল ফাইল অবজেক্ট তৈরি করুন
                    const mockFile = new File([""], item.name, { type: "image/jpeg" });
                    const cardId = 'file-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);

                    const fileData = {
                        id: cardId,
                        name: item.name,
                        fileObject: mockFile,
                        title: item.title,
                        description: item.description,
                        keywords: item.keywords,
                        status: 'success',
                        thumbnail: item.thumbnail
                    };

                    window.uploadedFilesData.push(fileData);

                    // সরাসরি মেমরি থাম্বনেইল ব্যবহার করে নতুন DOM কার্ড তৈরি করুন
                    const card = document.createElement('div');
                    card.className = 'file-preview-card metadata-generated success';
                    card.id = cardId;
                    card.style.borderColor = "#10B981";

                    const placeholderSrc = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48L3N2Zz4=`;
                    const finalImgSrc = item.thumbnail || placeholderSrc;

                    card.innerHTML = `
                        <div class="card-image-col">
                            <div class="card-checkbox-container">
                                <input type="checkbox" class="bulk-checkbox" data-file-id="${cardId}" onchange="window.handleCheckboxChange()">
                            </div>
                            <div class="card-image-actions">
                                <button class="card-image-action-btn regenerate" title="Regenerate" onclick="regenerateMetadata(this)"><span style="font-size:1.1em;">&#x21bb;</span></button>
                                <button class="card-image-action-btn close" title="Close" onclick="closeCard(this)"><span style="font-size:1.1em;">&#x2716;</span></button>
                            </div>
                            <img loading='lazy' src="${finalImgSrc}" alt="${item.name}" class="thumbnail-medium" style="position: relative; overflow: hidden; border-radius: 12px; width: 100%; height: auto; aspect-ratio: 1; object-fit: cover;">
                            
                            <div class="image-properties-overlay">
                                <div class="prop-row"><span class="prop-label">Name:</span><span class="prop-value">${item.name}</span></div>
                                <div class="prop-row"><span class="prop-label">Size:</span><span class="prop-value">Restored</span></div>
                                <div class="prop-row"><span class="prop-label">Dims:</span><span class="prop-value">Restored</span></div>
                            </div>

                            <!-- SEO Score Meter -->
                            <div class="seo-meter-container" id="seo-meter-${cardId}" style="display:none;">
                                <div class="locked-overlay" id="seo-lock-${cardId}" style="display:none;" onclick="showProUpgradeAlert()">
                                    <div class="lock-icon" title="Pro Feature">🔒</div>
                                </div>
                                <div class="seo-score-header">
                                    <span><span data-i18n="seo_score">SEO Score</span><button class="seo-info-icon" onclick="openSeoInfoModal()" title="Learn how to improve SEO Score">i</button></span>
                                    <span class="seo-badge excellent" id="seo-badge-${cardId}">0 / 100 🟢 Excellent</span>
                                </div>
                                <div class="seo-progress-bg">
                                    <div class="seo-progress-fill excellent" id="seo-progress-${cardId}" style="width: 0%;"></div>
                                </div>
                                <div class="seo-suggestions" id="seo-suggestions-${cardId}" style="color:var(--text-muted); font-size:0.75em; margin-top:8px; display:none; flex-direction:column; gap:4px; padding:6px; border-radius:4px; background:var(--bg-tertiary); border: 1px dashed var(--border-color);"></div>
                            </div>

                            <div class="card-filename" style="display:none;">${item.name}</div>
                        </div>
                        <div class="card-meta-col" style="display: flex;">
                            <div class="meta-translation-controls" style="margin-bottom: 15px; padding: 6px; background: var(--bg-input); border-radius: 6px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; gap: 10px; align-items: center;">
                                    <span style="font-size: 0.7em; color: var(--text-muted);"><i class="fas fa-language"></i> <span data-i18n="translate">Translate</span>:</span>
                                    <select id="translate-lang-${cardId}" style="padding: 4px 8px; border-radius: 4px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color);">
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
                                    <button class="action-button blue-button" style="padding: 4px 12px; font-size: 0.65em; white-space: nowrap; flex-shrink: 0;" onclick="translateMetadata('${cardId}')"><span data-i18n="go">Go</span></button>
                                </div>
                            </div>
                            <div class="meta-section">
                                <div class="meta-section-label"><span><span data-i18n="label_title">Title</span> <span id="title-count-${cardId}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'title')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                                <div class="meta-title" contenteditable="true" oninput="window.updateTitle(this)">${item.title || ''}</div>
                            </div>
                            <div class="meta-section" id="desc-section-${cardId}" style="${item.description ? 'display: block;' : 'display: none;'}">
                                <div class="meta-section-label"><span><span data-i18n="label_desc">Description</span> <span id="desc-count-${cardId}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'description')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                                <div class="meta-description" contenteditable="true" oninput="window.updateDescription(this)">${item.description || ''}</div>
                            </div>
                            <div class="meta-section">
                                <div class="meta-section-label"><span><span data-i18n="label_keywords">Keywords</span> <span id="keyword-count-${cardId}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'keywords')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                                <div class="meta-keywords"></div>
                                <div class="keyword-add-container">
                                    <input type="text" class="keyword-add-input" data-i18n="placeholder_add_kw" placeholder="Add keyword..." id="keyword-input-${cardId}" onkeypress="if(event.key === 'Enter') addKeyword('${cardId}')">
                                    <button class="keyword-add-btn" style='white-space: nowrap; flex-shrink: 0;' onclick="addKeyword('${cardId}')">+ <span data-i18n="btn_add">Add</span></button>
                                </div>
                                <div class="keyword-preset-container" style="margin-top: 8px; display: flex; gap: 8px; align-items: center;">
                                    <select class="preset-select-dropdown" data-card-id="${cardId}" onchange="window.applyPresetToCard('${cardId}', this.value)" style="flex: 1; padding: 4px 8px; border-radius: 4px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); font-size: 0.72em;">
                                        <option value="">📁 Apply Preset/Templates...</option>
                                    </select>
                                    <button class="action-button blue-button" onclick="window.savePresetFromCard('${cardId}')" title="Save current keywords as preset template" style="padding: 4px 8px; font-size: 0.72em; margin-top: 0; white-space: nowrap; flex-shrink: 0;">
                                        <i class="fas fa-save"></i> Save Preset
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;

                    previewContainer.appendChild(card);

                    // ওয়ার্ড কাউন্টার মান সেট
                    const titleCountElem = document.getElementById(`title-count-${cardId}`);
                    if (titleCountElem && item.title) {
                        const count = item.title.split(/\s+/).filter(w => w.length > 0).length;
                        titleCountElem.textContent = `(${count})`;
                    }

                    const descCountElem = document.getElementById(`desc-count-${cardId}`);
                    if (descCountElem && item.description) {
                        const count = item.description.split(/\s+/).filter(w => w.length > 0).length;
                        descCountElem.textContent = `(${count})`;
                    }

                    // কিওয়ার্ড পিলগুলো তৈরি করুন
                    if (typeof window.updateKeywordsDisplay === 'function') {
                        window.updateKeywordsDisplay(cardId);
                    }

                    // এসইও স্কোর আপডেট
                    if (typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
                        const seoScore = calculateSeoScore(fileData);
                        updateSeoMeter(cardId, seoScore);
                    }

                    alert(`Restored ${item.name} into the active workspace.`);
                }

                window.closeMetadataHistoryModal();

                // আপলোড এরিয়া হাইড করুন এবং প্রসেসিং এরিয়া দেখান
                const uploadSection = document.querySelector('.file-upload-section');
                const addMoreBtn = document.getElementById('addMoreFilesButton');
                const processingArea = document.querySelector('.file-processing-area');
                if (uploadSection) uploadSection.style.display = 'none';
                if (addMoreBtn) addMoreBtn.style.display = 'inline-flex';
                if (processingArea) processingArea.style.display = 'block';

                // বাটন অ্যাক্টিভেশন স্ট্যাটাস আপডেট
                if (typeof updateAllButtonStates === 'function') {
                    updateAllButtonStates();
                }

            } catch (err) {
                console.error("Restore failed:", err);
                alert("Could not restore item to workspace.");
            }
        };

