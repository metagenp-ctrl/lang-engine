
        // =============================================
        // DAILY STREAK TRACKER SYSTEM
        // =============================================
        (function initStreakSystem() {
            const STREAK_KEY = 'metagen_streak_data';

            function getStreakData() {
                try {
                    return JSON.parse(localStorage.getItem(STREAK_KEY)) || { currentStreak: 0, lastActiveDate: null, bonusClaimed: {} };
                } catch { return { currentStreak: 0, lastActiveDate: null, bonusClaimed: {} }; }
            }

            function saveStreakData(data) {
                localStorage.setItem(STREAK_KEY, JSON.stringify(data));
            }

            function getTodayDateStr() {
                return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            }

            function getYesterdayDateStr() {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                return d.toISOString().split('T')[0];
            }

            function refreshStreakOnLoad() {
                const data = getStreakData();
                const today = getTodayDateStr();
                const yesterday = getYesterdayDateStr();

                if (data.lastActiveDate === today) {
                    // Already active today, just render
                } else if (data.lastActiveDate === yesterday) {
                    // Streak continues but not yet marked for today
                } else if (data.lastActiveDate) {
                    // Streak broken - reset
                    data.currentStreak = 0;
                    data.bonusClaimed = {};
                    saveStreakData(data);
                }
                renderStreakUI(data);
            }

            window.recordStreakActivity = function () {
                const data = getStreakData();
                const today = getTodayDateStr();

                if (data.lastActiveDate === today) return; // Already recorded today

                const yesterday = getYesterdayDateStr();
            if (data.lastActiveDate === yesterday || !data.lastActiveDate) {
                // [NEW LOGIC] ৭ দিন পূর্ণ হলে পরের দিন অটোমেটিক আবার Day 1 থেকে শুরু হবে
                if (data.currentStreak >= 7) {
                    data.currentStreak = 1;
                    data.bonusClaimed = {}; // আগের বোনাস হিস্ট্রি ক্লিয়ার করে নতুন সাইকেল শুরু
                } else {
                    data.currentStreak = (data.currentStreak || 0) + 1;
                }
            } else {
                data.currentStreak = 1; // Streak broken (গ্যাপ দিলে), start fresh
                data.bonusClaimed = {};
            }
            data.lastActiveDate = today;

                // Calculate bonus
                const bonusMap = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 10 };
                const bonus = bonusMap[data.currentStreak] || 0;
                const dayKey = 'day' + data.currentStreak;

                if (bonus > 0 && !data.bonusClaimed[dayKey]) {
                    data.bonusClaimed[dayKey] = true;

                    // 1. Update local limits immediately for UI
                    if (window.userUsageData) {
                        if (typeof window.userUsageData.limit === 'number') {
                            window.userUsageData.limit += bonus; // Increase today's working limit
                        }
                        // Increase total monthly limit locally
                        window.userUsageData.referralBonus = (window.userUsageData.referralBonus || 0) + bonus;
                        if (typeof updateUsageUI === 'function') updateUsageUI();
                    }

                    // 2. 🟢 SAVE PERMANENTLY VIA WORKER API (Secured with Auth) 🟢
                    if (typeof auth !== 'undefined' && auth.currentUser) {
                        (async () => {
                            try {
                                const idToken = await auth.currentUser.getIdToken();
                                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/user/claim-streak-bonus', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': 'Bearer ' + idToken
                                    },
                                    body: JSON.stringify({
                                        streakDay: data.currentStreak,
                                        bonus: bonus
                                    })
                                });
                                const result = await res.json();
                                if (result.success) {
                                    console.log(`Streak bonus +${bonus} permanently saved to database. Total: ${result.totalBonus}`);
                                } else {
                                    console.error("Streak bonus save failed:", result.error || result.message);
                                }
                            } catch (err) {
                                console.error("Failed to save streak bonus:", err);
                            }
                        })();
                    }

                    // 3. Show the new popup modal
                    const rewardModal = document.getElementById('streakRewardModal');
                    if (rewardModal) {
                        const daySpan = document.getElementById('streakRewardDay');
                        const amountSpan = document.getElementById('streakRewardAmount');
                        if (daySpan) daySpan.textContent = data.currentStreak;
                        if (amountSpan) amountSpan.textContent = bonus;
                        
                        rewardModal.style.display = 'flex';
                        
                        // Show confetti animation if available (from JS library)
                        if (typeof confetti === 'function') {
                            confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
                        }
                    } else {
                        // Fallback to Toast if modal HTML is missing
                        if (typeof showCustomAlert === 'function') {
                            showCustomAlert(`🔥 Streak Day ${data.currentStreak}! +${bonus} bonus credit${bonus > 1 ? 's' : ''} earned!`, 'success');
                        } else {
                            const existingToast = document.querySelector('.trial-toast');
                            if (existingToast) existingToast.remove();
                            const toast = document.createElement('div');
                            toast.className = 'trial-toast';
                            toast.innerHTML = `🔥 Streak Day ${data.currentStreak}! +${bonus} bonus credit${bonus > 1 ? 's' : ''} earned!`;
                            document.body.appendChild(toast);
                            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4200);
                        }
                    }
                }

                saveStreakData(data);
                renderStreakUI(data);
            };

            function renderStreakUI(data) {
                const streak = data.currentStreak || 0;
                const label = document.getElementById('streakCountLabel');
                const hint = document.getElementById('streakHint');
                const fill = document.getElementById('streakDotFill');

                if (label) label.textContent = streak + ' Day' + (streak !== 1 ? 's' : '');
                if (fill) fill.style.width = Math.min(streak / 7 * 90, 90) + '%';

                // Update dots
                const dots = document.querySelectorAll('.streak-dot');
                dots.forEach(dot => {
                    const day = parseInt(dot.getAttribute('data-day'));
                    if (day <= streak) {
                        dot.style.background = '#F97316';
                        dot.style.borderColor = '#F97316';
                        dot.style.color = '#fff';
                    } else {
                        dot.style.background = 'var(--bg-secondary)';
                        dot.style.borderColor = 'var(--border-color)';
                        dot.style.color = 'var(--text-muted)';
                    }
                });

                // Update hint
                if (hint) {
                    const today = getTodayDateStr();
                    if (data.lastActiveDate === today) {
                        if (streak >= 7) {
                            hint.innerHTML = '🏆 <b>Streak Master!</b> 7-day streak complete! +10 bonus credits earned!';
                            hint.style.color = '#F97316';
                        } else {
                            hint.innerHTML = `✅ Active today! Come back tomorrow for Day ${streak + 1} bonus.`;
                            hint.style.color = '#10B981';
                        }
                    } else {
                        hint.textContent = 'Process any file today to build your streak!';
                        hint.style.color = 'var(--text-muted)';
                    }
                }
            }

            // Init on page load
            refreshStreakOnLoad();
        })();


        // =============================================
        // KEYWORD PRESETS MANAGER SYSTEM
        // =============================================
        (function initPresetsSystem() {
            const PRESETS_KEY = 'metagen_keyword_presets';

            function getPresets() {
                try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || []; }
                catch { return []; }
            }

            function savePresets(presets) {
                localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
            }

            function renderSidebarPresets() {
                const presets = getPresets();
                const listEl = document.getElementById('sidebarPresetsList');
                if (!listEl) return;

                if (presets.length === 0) {
                    listEl.innerHTML = '<div style="font-size:0.75em; color:var(--text-muted); text-align:center; padding: 10px 0;">No presets saved yet.</div>';
                    return;
                }

                listEl.innerHTML = presets.map((p, i) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:var(--bg-input); border-radius:6px; border:1px solid var(--border-color);">
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:0.8em; font-weight:700; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${p.name}">${p.name}</div>
                            <div style="font-size:0.68em; color:var(--text-muted);">${p.keywords.length} keywords</div>
                        </div>
                        <button onclick="window.deletePreset(${i})" title="Delete" style="border:none; background:none; color:#EF4444; cursor:pointer; font-size:1em; padding:2px 6px;">×</button>
                    </div>
                `).join('');
            }

            function refreshAllPresetDropdowns() {
                const presets = getPresets();
                const dropdowns = document.querySelectorAll('.preset-select-dropdown');
                dropdowns.forEach(dd => {
                    const cardId = dd.getAttribute('data-card-id');
                    // Keep first option, replace rest
                    dd.innerHTML = '<option value="">📁 Apply Preset/Templates...</option>';
                    presets.forEach((p, i) => {
                        const opt = document.createElement('option');
                        opt.value = i;
                        opt.textContent = `${p.name} (${p.keywords.length} kw)`;
                        dd.appendChild(opt);
                    });
                });
            }

            // Save preset from a card's current keywords
            window.savePresetFromCard = function (cardId) {
                const fileData = (typeof uploadedFilesData !== 'undefined') ? uploadedFilesData.find(f => f.id === cardId) : null;
                if (!fileData || !fileData.keywords) {
                    if (typeof showCustomAlert === 'function') showCustomAlert('No keywords to save. Generate metadata first.', 'warning');
                    else alert('No keywords to save. Generate metadata first.');
                    return;
                }

                const keywords = Array.isArray(fileData.keywords) ? fileData.keywords.filter(k => k && k.trim()) : fileData.keywords.split(',').map(k => k.trim()).filter(Boolean);
                if (keywords.length === 0) {
                    if (typeof showCustomAlert === 'function') showCustomAlert('No keywords found on this card.', 'warning');
                    else alert('No keywords found on this card.');
                    return;
                }

                const name = prompt('Enter a name for this preset:', fileData.title || 'My Preset');
                if (!name || !name.trim()) return;

                const presets = getPresets();
                presets.push({ name: name.trim(), keywords: keywords });
                savePresets(presets);
                renderSidebarPresets();
                refreshAllPresetDropdowns();

                if (typeof showCustomAlert === 'function') showCustomAlert(`✅ Preset "${name.trim()}" saved with ${keywords.length} keywords!`, 'success');
            };

            // Apply preset to a card
            window.applyPresetToCard = function (cardId, presetIndex) {
                if (presetIndex === '' || presetIndex === null || presetIndex === undefined) return;
                const presets = getPresets();
                const preset = presets[parseInt(presetIndex)];
                if (!preset) return;

                const fileData = (typeof uploadedFilesData !== 'undefined') ? uploadedFilesData.find(f => f.id === cardId) : null;
                if (!fileData) return;

                // Merge: add preset keywords that don't already exist
                let existing = Array.isArray(fileData.keywords) ? fileData.keywords : (fileData.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
                const existingLower = new Set(existing.map(k => k.toLowerCase()));

                let addedCount = 0;
                preset.keywords.forEach(kw => {
                    if (!existingLower.has(kw.toLowerCase())) {
                        existing.push(kw);
                        existingLower.add(kw.toLowerCase());
                        addedCount++;
                    }
                });

                fileData.keywords = existing;
                if (typeof window.updateKeywordsDisplay === 'function') window.updateKeywordsDisplay(cardId);

                // Reset dropdown
                const dd = document.querySelector(`.preset-select-dropdown[data-card-id="${cardId}"]`);
                if (dd) dd.value = '';

                if (typeof showCustomAlert === 'function') showCustomAlert(`📋 Applied "${preset.name}" — ${addedCount} new keyword${addedCount !== 1 ? 's' : ''} added!`, 'success');
            };

            // Delete preset
            window.deletePreset = function (index) {
                const presets = getPresets();
                if (index < 0 || index >= presets.length) return;
                const name = presets[index].name;
                presets.splice(index, 1);
                savePresets(presets);
                renderSidebarPresets();
                refreshAllPresetDropdowns();
                if (typeof showCustomAlert === 'function') showCustomAlert(`🗑️ Preset "${name}" deleted.`, 'info');
            };

            // Create empty preset from sidebar input
            window.createKeywordPresetFromSidebar = function () {
                const input = document.getElementById('newPresetName');
                const name = input ? input.value.trim() : '';
                if (!name) {
                    if (typeof showCustomAlert === 'function') showCustomAlert('Please enter a preset name.', 'warning');
                    else alert('Please enter a preset name.');
                    return;
                }

                const keywordsStr = prompt('Enter keywords (comma-separated):');
                if (!keywordsStr || !keywordsStr.trim()) return;

                const keywords = keywordsStr.split(',').map(k => k.trim()).filter(Boolean);
                if (keywords.length === 0) return;

                const presets = getPresets();
                presets.push({ name: name, keywords: keywords });
                savePresets(presets);
                if (input) input.value = '';
                renderSidebarPresets();
                refreshAllPresetDropdowns();
                if (typeof showCustomAlert === 'function') showCustomAlert(`✅ Preset "${name}" created with ${keywords.length} keywords!`, 'success');
            };

            // Expose refresh for dynamic card creation
            window.refreshPresetDropdowns = refreshAllPresetDropdowns;

            // Init on load
            renderSidebarPresets();
            refreshAllPresetDropdowns();

            // Also refresh when new cards are created (MutationObserver)
            let _presetRefreshTimer = null;
            let _isRefreshing = false;
            const observer = new MutationObserver(() => {
                if (_isRefreshing) return; // Prevent re-entry
                clearTimeout(_presetRefreshTimer);
                _presetRefreshTimer = setTimeout(() => {
                    _isRefreshing = true;
                    observer.disconnect(); // Stop observing during refresh
                    try {
                        refreshAllPresetDropdowns();
                    } catch (e) { console.warn('Preset refresh error:', e); }
                    // Re-observe after a tick
                    setTimeout(() => {
                        const c = document.getElementById('filePreviewContainer');
                        if (c) observer.observe(c, { childList: true });
                        _isRefreshing = false;
                    }, 50);
                }, 300); // Debounce 300ms
            });
            const container = document.getElementById('filePreviewContainer');
            if (container) observer.observe(container, { childList: true });
        })();

        window.loadReviewStats = function () {
            // LocalStorage থেকে আগের রিভিউ ডেটা লোড করুন অথবা ডিফল্ট 1584 সেট করুন
            let stats = JSON.parse(localStorage.getItem('metagen_review_stats'));
            if (!stats) {
                stats = { count: 1584, totalScore: 1584 * 4.9 };
                localStorage.setItem('metagen_review_stats', JSON.stringify(stats));
            }

            let avg = (stats.totalScore / stats.count).toFixed(1);

            // 5.0 এর উপরে যেন না যায়
            if (parseFloat(avg) > 5.0) avg = "5.0";

            let avgEl = document.getElementById('reviewAvgScore');
            let countEl = document.getElementById('reviewTotalCount');

            if (avgEl) avgEl.innerText = avg;
            if (countEl) countEl.innerText = stats.count.toLocaleString();
        };

        window.openFeedbackWithRating = function (n) {
            const feedbackModal = document.getElementById('feedbackModal');
            if (feedbackModal) {
                feedbackModal.style.display = 'flex';
                if (typeof setRating === 'function') {
                    setRating(n);
                }
                const typeSelect = document.getElementById('feedbackType');
                if (typeSelect) typeSelect.value = 'General Feedback';
            }
        };

        // Star Hover Effects
        window.hoverStars = function (n) {
            const stars = document.querySelectorAll('.review-stars-interactive i');
            stars.forEach((star, index) => {
                if (index < n) {
                    star.style.color = '#F59E0B'; // Highlighted
                    star.style.transform = 'scale(1.1)';
                } else {
                    star.style.color = '#4A5568'; // Muted
                    star.style.transform = 'scale(1)';
                }
            });
        };

        window.resetHoverStars = function () {
            const stars = document.querySelectorAll('.review-stars-interactive i');
            stars.forEach(star => {
                star.style.color = '#F59E0B'; // Reset to default Yellow
                star.style.transform = 'scale(1)';
            });
        };

        document.addEventListener('DOMContentLoaded', function () {
            loadReviewStats();
        });


     
