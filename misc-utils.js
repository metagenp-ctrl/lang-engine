        // AI Model Selection Logic
        function selectAiModel(value, label) {
            const hiddenInput = document.getElementById('aiProviderSelect');
            hiddenInput.value = value;

            const headerLabel = document.getElementById('selectedAiLabel');
            headerLabel.textContent = label;

            const allOptions = document.querySelectorAll('.ai-option-item');
            allOptions.forEach(opt => opt.classList.remove('selected'));

            event.currentTarget.classList.add('selected');

            const header = document.getElementById('aiProviderHeader');
            const content = document.getElementById('aiProviderOptions');

            header.classList.remove('open');
            content.style.maxHeight = '0';
            setTimeout(() => {
                content.style.display = 'none';
            }, 300);
        }

        // SEO Info Modal Functions
        function openSeoInfoModal() {
            const modal = document.getElementById('seoInfoModal');
            modal.style.display = 'flex';
        }

        function closeSeoInfoModal() {
            const modal = document.getElementById('seoInfoModal');
            modal.style.display = 'none';
        }

        // Close modal when clicking outside of it
        window.addEventListener('click', function (event) {
            const modal = document.getElementById('seoInfoModal');
            if (event.target === modal) {
                closeSeoInfoModal();
            }
        });
        // Open Rejection Info Modal
        function openRejectionInfoModal() {
            const modal = document.getElementById('rejectionInfoModal');
            if (modal) {
                modal.style.display = 'flex';
            }
        }

        // Cookie Consent Logic
        window.acceptCookies = function () {
            localStorage.setItem('cookieConsent', 'true');
            document.getElementById('cookieBanner').style.display = 'none';
        }

        window.addEventListener('load', function () {
            if (!localStorage.getItem('cookieConsent')) {
                document.getElementById('cookieBanner').style.display = 'flex';
            }
        });

        async function getMetadataUsage(emailInput) {
            try {
                if (!emailInput) return { count: 0, limit: 10, monthlyCount: 0, monthlyLimit: 120, plan: 'free', referralBonus: 0 };

                const cleanEmail = String(emailInput).trim().toLowerCase();
                const rawEmail = String(emailInput).trim();

                // --- ১. কল টু ক্লাউডফ্লেয়ার ওয়ার্কার ---
                try {
                    const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/user/usage', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: cleanEmail })
                    });

                    if (response.ok) {
                        const status = await response.json();
                        console.log("Usage from worker:", status.plan, `${status.count}/${status.monthlyLimit}`);
                        return {
                            count: status.count || 0,
                            limit: status.limit || 10,
                            monthlyCount: status.monthlyCount || 0,
                            monthlyLimit: status.monthlyLimit || 120,
                            baseLimit: status.baseLimit || (status.plan === 'premium' ? 3000 : (status.plan === 'pro' ? 2000 : 120)),
                            referralBonus: status.referralBonus || 0,
                            plan: status.plan || 'free',
                            hasClaimedShareBonus: status.hasClaimedShareBonus || false,
                            trialCreditsTotal: status.trialCreditsTotal || 0,
                            trialCreditsUsed: status.trialCreditsUsed || 0,
                            trialActive: status.trialActive || false,
                            purchasedCredits: status.purchasedCredits || 0,
                            purchasedCreditsUsed: status.purchasedCreditsUsed || 0,
                            teamId: status.teamId || '',
                            teamRole: status.teamRole || '',
                            giftCredits: status.giftCredits || 0
                        };
                    }
                } catch (e) { console.warn("Worker fetch failed, falling back to Firebase:", e); }

                // --- ২. ফায়ারবেস ফলব্যাক (Robust Check) ---
                const variants = [...new Set([cleanEmail, rawEmail])];
                let profile = null;

                for (const variant of variants) {
                    const pDoc = await db.collection('users').doc(variant).get();
                    if (pDoc.exists) {
                        const data = pDoc.data();
                        // লজিক: যদি একাধিক প্রোফাইল থাকে, তবে বড় লিমিট বা পেইড প্ল্যানওয়ালা প্রোফাইলটি বেছে নেবে
                        const pLimit = Number(data.monthlyLimit || data.monthly_limit || data.limit || 0);
                        const pPlan = String(data.plan || "").toLowerCase();
                        if (!profile || pPlan !== 'free' || pLimit > (Number(profile.monthlyLimit || profile.limit || 0))) {
                            profile = data;
                        }
                    }
                }

                let plan = 'free';
                if (profile) {
                    const rawP = String(profile.plan || "").toLowerCase();
                    let userLimitVal = Number(profile.monthlyLimit || profile.monthly_limit || 0);

                    if (rawP.includes('agency') || userLimitVal >= 10000) {
                        plan = 'agency';
                    } else if (rawP.includes('premium') || userLimitVal >= 3000) {
                        plan = 'premium';
                    } else if (rawP.includes('pro') || userLimitVal >= 2000) {
                        plan = 'pro';
                    } else {
                        plan = 'free';
                    }
                }

                const monthlyLimit = (plan === 'agency') ? 10000 : (plan === 'premium') ? 3000 : (plan === 'pro' ? 2000 : 120);
                const dailyCap = (plan === 'agency') ? 500 : (plan === 'premium') ? 100 : (plan === 'pro' ? 70 : 20);

                // --- ৩. অ্যাক্টিভিটি গণনা (বাকি কোড অপরিবর্তিত) ---
                let dailyCount = 0;
                try {
                    const now = new Date().toISOString().split('T')[0];
                    const activitySnapshot = await db.collection('activities')
                        .where('user_email', '==', cleanEmail)
                        .where('email_day', '==', `${cleanEmail}_${now}`)
                        .get();
                    dailyCount = activitySnapshot.size;
                } catch (e) { console.warn("Fallback counting failed:", e); }

                return {
                    count: dailyCount,
                    limit: dailyCap,
                    monthlyCount: dailyCount,
                    monthlyLimit: monthlyLimit,
                    plan: plan,
                    referralBonus: Number(profile?.referral_bonus || 0),
                    hasClaimedShareBonus: profile?.has_claimed_share_bonus || false,
                    giftCredits: Number(profile?.gift_credits || 0)
                };
            } catch (err) {
                console.error("Usage fetch Error:", err);
                return { count: 0, limit: 10, monthlyCount: 0, monthlyLimit: 120, plan: 'free', referralBonus: 0 };
            }
        }

        async function logActivity(actionName, detailsInfo) {
            try {
                const user = auth.currentUser;
                if (user) {
                    const cleanEmail = user.email.toLowerCase();

                    // 1. Update local state first for instant UI response
                    if (window.userUsageData) {
                        try {
                            if (window.userUsageData.count !== undefined) window.userUsageData.count++;
                            if (window.userUsageData.monthlyCount !== undefined) window.userUsageData.monthlyCount++;
                            updateUsageUI();
                        } catch (e) { console.warn("Local update failed:", e); }
                    }

                    // 2. Sync to Worker (Single Source of Truth)
                    fetch('https://metagen-pro-api.metagenp.workers.dev/user/log', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email: cleanEmail,
                            action: actionName,
                            deviceInfo: navigator.userAgent
                        })
                    }).catch(e => console.warn("Worker logging failed, but count was updated locally:", e));

                    console.log("Activity Synced:", actionName);
                }
            } catch (err) {
                console.error("Log error:", err);
            }
        }
        // Removed duplicate handlePayment function. Real one is near line 21311.

        window.showLimitModal = function (customMsg) {
            const modal = document.getElementById('limitReachedModal');
            const msgEl = document.getElementById('limitModalMessage');
            if (msgEl && customMsg) {
                msgEl.innerHTML = customMsg;
            }
            const loginBtn = document.getElementById('limitLoginBtn');
            if (loginBtn) {
                loginBtn.style.display = auth.currentUser ? 'none' : 'flex';
            }
            if (modal) {
                modal.style.display = 'flex';
            }
        };

        function toggleMainTools() {
            const wrapper = document.getElementById('mainToolsWrapper');
            const arrow = document.getElementById('mainToolsArrow');

            const currentDisplay = window.getComputedStyle(wrapper).display;

            if (currentDisplay === 'none') {
                wrapper.style.display = 'block';
                if (arrow) arrow.style.transform = 'rotate(180deg)';
            } else {
                wrapper.style.display = 'none';
                if (arrow) arrow.style.transform = 'rotate(0deg)';
            }
        }
        // Function to Open API Key Modal (Deprecated)
        async function openApiModal() {
            alert("API Keys are no longer needed!\n\nAll AI requests are now handled securely on our servers for all plans.");
        }
        // 2. ConvertAPI Modal Function
        function openConvertApiModal() {
            const modal = document.getElementById('convertapi-key-modal');
            if (!modal) {
                console.error("ConvertAPI Modal div not found!");
                return;
            }

            // Load saved key
            const savedKey = localStorage.getItem('convertApiKey') || '';
            const inputField = document.getElementById('convertapiKeyInput');

            if (inputField) {
                inputField.value = savedKey;
            }

            // Show the modal
            modal.style.display = 'flex';
        }

        // 3. Save Logic for ConvertAPI (Manually binding onClick)
        document.addEventListener('DOMContentLoaded', function () {
            const saveConvertBtn = document.getElementById('saveConvertapiKeyButton');
            if (saveConvertBtn) {
                saveConvertBtn.onclick = function () {
                    const input = document.getElementById('convertapiKeyInput');
                    if (input && input.value.trim()) {
                        localStorage.setItem('convertApiKey', input.value.trim());
                        alert('ConvertAPI Key saved successfully!');
                        document.getElementById('convertapi-key-modal').style.display = 'none';
                    } else {
                        alert('Please enter a valid API key.');
                    }
                };
            }
        });

        // --- VIEW TOGGLE LOGIC ---

        const previewContainer = document.getElementById('filePreviewContainer');
        const gridViewBtn = document.getElementById('gridViewBtn');
        const listViewBtn = document.getElementById('listViewBtn');

        // 1. Switch to Grid View
        function setGridView() {
            if (!previewContainer) return;
            previewContainer.classList.remove('list-view');

            gridViewBtn.classList.add('active');
            listViewBtn.classList.remove('active');

            localStorage.setItem('metagen_view_pref', 'grid');
        }

        // 2. Switch to List View
        function setListView() {
            if (!previewContainer) return;
            previewContainer.classList.add('list-view');


            listViewBtn.classList.add('active');
            gridViewBtn.classList.remove('active');

            localStorage.setItem('metagen_view_pref', 'list');
        }

        document.addEventListener('DOMContentLoaded', () => {
            const savedView = localStorage.getItem('metagen_view_pref');

            if (savedView === 'list') {
                setListView();
            } else {
                setGridView();
            }
        });

        // --- SIMILARITY CHECKER LOGIC (PREMIUM) ---

                 document.getElementById('checkSimilarityButton').onclick = async function () {
            if (window.uploadedFilesData.length < 2) {
                alert("Upload at least 2 images to check similarity.");
                return;
            }

            const btn = this;
            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';

            // ১. প্রতিটি ইমেজের ২৫৬-বিট dHash জেনারেট করা
            const fileHashes = [];
            for (const fileData of window.uploadedFilesData) {
                try {
                    const hash = await getImageFingerprint(fileData.id);
                    if (hash) {
                        fileHashes.push({ id: fileData.id, name: fileData.name, hash: hash });
                    }
                } catch (e) { 
                    console.error("Hash failed for", fileData.name, e); 
                }
            }

            // ২. পূর্বের সিমিলারিটি ওয়ার্নিং ব্যাজগুলো রিমুভ করা
            document.querySelectorAll('.similarity-warning, .similarity-badge').forEach(el => el.remove());

            // ৩. ওয়েব ওয়ার্কার দিয়ে হাই-স্পিড Hamming Distance ও Match % বের করা
            const workerCode = `
                function calculateHammingDistance(hash1, hash2) {
                    let distance = 0;
                    for (let i = 0; i < hash1.length; i++) {
                        if (hash1[i] !== hash2[i]) distance++;
                    }
                    return distance;
                }
                
                self.onmessage = function(e) {
                    const fileHashes = e.data;
                    const similarities = [];
                    for (let i = 0; i < fileHashes.length; i++) {
                        for (let j = i + 1; j < fileHashes.length; j++) {
                            const hash1 = fileHashes[i].hash;
                            const hash2 = fileHashes[j].hash;
                            
                            if (!hash1 || !hash2 || hash1.length !== hash2.length) continue;
                            
                            const distance = calculateHammingDistance(hash1, hash2);
                            // ২৫৬-বিট ডিফারেন্স থেকে পার্সেন্টেজ হিসাব
                            const matchPercent = Math.round((1 - (distance / 256)) * 100);
                            
                            // ৭০% বা তার বেশি মিল থাকলে সেটিকে ওয়ার্নিং হিসেবে ধরা হবে
                            if (matchPercent >= 70) {
                                similarities.push({
                                    targetId: fileHashes[j].id,
                                    sourceName: fileHashes[i].name,
                                    targetName: fileHashes[j].name,
                                    matchPercent: matchPercent
                                });
                            }
                        }
                    }
                    self.postMessage(similarities);
                };
            `;
            
            const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(workerBlob);
            const worker = new Worker(workerUrl);

            worker.onmessage = (e) => {
                const similarities = e.data;
                let similarFound = 0;

                // একই ইমেজের একাধিক ম্যাচ থাকলে সর্বোচ্চ ম্যাচ পার্সেন্টেজটি ফিল্টার করা
                const bestMatches = {};
                similarities.forEach(sim => {
                    if (!bestMatches[sim.targetId] || bestMatches[sim.targetId].matchPercent < sim.matchPercent) {
                        bestMatches[sim.targetId] = sim;
                    }
                });

                Object.values(bestMatches).forEach(sim => {
                    markAsSimilar(sim.targetId, sim.sourceName, sim.matchPercent);
                    similarFound++;
                });

                btn.disabled = false;
                btn.innerHTML = originalHTML;

                if (similarFound > 0) {
                    alert("Found " + similarFound + " highly similar images or templates! Highlighted images might be rejected as spam/duplicates by stock agencies.");
                } else {
                    alert("Excellent! No significant structural similarity or template duplication detected in your batch.");
                }

                worker.terminate();
                URL.revokeObjectURL(workerUrl);
            };

            worker.onerror = (err) => {
                console.error("Similarity Checker Worker Error:", err);
                btn.disabled = false;
                btn.innerHTML = originalHTML;
                alert("An error occurred during similarity checking.");
                worker.terminate();
                URL.revokeObjectURL(workerUrl);
            };

            worker.postMessage(fileHashes);
        };

        // ২৫৬-বিট ডিফারেন্স হ্যাশ (dHash) জেনারেটর (SVG ও ট্রান্সপারেন্সি সাপোর্টেড)
        async function getImageFingerprint(cardId) {
            return new Promise(async (resolve) => {
                const img = document.querySelector("#" + cardId + " .thumbnail-medium");
                if (!img) {
                    resolve("");
                    return;
                }

                // ১. ইমেজটি সম্পূর্ণ লোড হওয়া পর্যন্ত অপেক্ষা করা (অ্যাসিনক্রোনাস রেন্ডারিং নিশ্চিত করতে)
                if (!img.complete || img.naturalWidth === 0) {
                    await new Promise((res) => {
                        img.onload = res;
                        img.onerror = res;
                        setTimeout(res, 1200); // ১.২ সেকেন্ড ব্যাকআপ সেফটি টাইমাউট
                    });
                }

                // ২. ব্রাউজার মেমোরিতে ইমেজ ডিকোড করা
                if (typeof img.decode === 'function') {
                    try {
                        await img.decode();
                    } catch (e) {
                        console.warn("Image decode failed, trying standard draw", e);
                    }
                }

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // স্ট্রাকচারাল প্যাটার্ন চেক করার জন্য ১৭x১৬ গ্রিড সাইজ
                canvas.width = 17;
                canvas.height = 16;

                // ৩. সলিড সাদা ব্যাকগ্রাউন্ড ফিল করা (ট্রান্সপারেন্ট ব্যাকগ্রাউন্ডের কালো পিক্সেল সমস্যা দূর করতে)
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 17, 16);

                // ৪. ক্যানভাসে ইমেজ ড্র করা
                try {
                    ctx.drawImage(img, 0, 0, 17, 16);
                } catch (err) {
                    console.error("Canvas drawImage failed for card", cardId, err);
                    resolve("");
                    return;
                }

                const imgData = ctx.getImageData(0, 0, 17, 16).data;
                const grayscale = [];

                // ৫. গ্রে-স্কেল কনভার্সন
                for (let i = 0; i < imgData.length; i += 4) {
                    const r = imgData[i];
                    const g = imgData[i + 1];
                    const b = imgData[i + 2];
                    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    grayscale.push(gray);
                }

                // ৬. অনুভূমিক বাউন্ডারি ও পিক্সেল ডিফারেন্স তুলনা (১৬x১৬ = ২৫৬ বিট dHash)
                let hash = "";
                for (let row = 0; row < 16; row++) {
                    for (let col = 0; col < 16; col++) {
                        const leftIdx = row * 17 + col;
                        const rightIdx = leftIdx + 1;
                        const left = grayscale[leftIdx];
                        const right = grayscale[rightIdx];
                        hash += (left > right) ? "1" : "0";
                    }
                }
                resolve(hash);
            });
        }

        // দুই হ্যাশের মধ্যে পার্থক্য বের করার ফাংশন
        function calculateHammingDistance(hash1, hash2) {
            let distance = 0;
            for (let i = 0; i < hash1.length; i++) {
                if (hash1[i] !== hash2[i]) distance++;
            }
            return distance;
        }

        // সিমিলার ইমেজ প্রফেশনাল ব্যাজ দিয়ে মার্ক করা
        function markAsSimilar(cardId, matchedWithName, matchPercent) {
            const card = document.getElementById(cardId);
            if (card) {
                card.classList.add('similarity-warning');
                
                // মিলের তীব্রতার ওপর ভিত্তি করে কালার ও ঝুঁকি নির্ধারণ
                let riskText = "Medium Similarity";
                let riskColor = "#F59E0B"; // কমলা রং
                
                if (matchPercent >= 80) {
                    riskText = "High Spam Risk";
                    riskColor = "#EF4444"; // লাল রং
                    card.style.borderColor = "#EF4444";
                } else {
                    card.style.borderColor = "#F59E0B";
                }

                if (!card.querySelector('.similarity-badge')) {
                    const badge = document.createElement('div');
                    badge.className = 'similarity-badge';
                    // আধুনিক ভিজ্যুয়াল ওভারলে স্টাইল
                    badge.style.cssText = 'position: absolute; bottom: 45px; color: ' + riskColor + '; padding: 20px; border-radius: 8px; font-size: 0.72em; font-weight: bold; z-index: 10; border: 1px solid ' + riskColor + '; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5); text-align: center; backdrop-filter: blur(4px); margin: -20px 0px 0px 0px; ';
                    badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + riskText + ': ' + matchPercent + '%<br><span style="font-size: 0.85em; color: #E2E8F0; font-weight: normal;">Matches: ' + matchedWithName + '</span>';
                    card.querySelector('.card-image-col').appendChild(badge);
                }
            }
        }   

        document.addEventListener('DOMContentLoaded', function () {
            const pricingToggle = document.getElementById('pricingToggle');
            const currencyToggle = document.getElementById('currencyToggle');

            const freePrice = document.getElementById('freePrice');
            const proPrice = document.getElementById('proPrice');
            const premiumPrice = document.getElementById('premiumPrice');
            const agencyPrice = document.getElementById('agencyPrice');

            const priceData = {
                free: { usd: '$0', inr: '₹0', bdt: '৳0' },
                pro: {
                    usd: { monthly: '<s>$12</s> $9', yearly: '<s>$115</s> $89' },
                    inr: { monthly: '<s>₹1,000</s> ₹750', yearly: '<s>₹10,000</s> ₹7,500' },
                    bdt: { monthly: '<s>৳1,400</s> ৳1,050', yearly: '৳14,000 ৳10,500' }
                },
                premium: {
                    usd: { monthly: '<s>$29</s> $23', yearly: '<s>$278</s> $209' },
                    inr: { monthly: '<s>₹2,500</s> ₹1,950', yearly: '<s>₹23,500</s> ₹17,500' },
                    bdt: { monthly: '<s>৳3,500</s> ৳2,700', yearly: '৳35,000 ৳26,000' }
                },
                agency: {
                    usd: { monthly: '$49', yearly: '$390' },
                    inr: { monthly: '₹4,150', yearly: '₹33,000' },
                    bdt: { monthly: '৳5,800', yearly: '৳46,000' }
                }
            };

            function updatePricing() {
                const isYearly = pricingToggle ? pricingToggle.checked : false;
                const currency = currencyToggle ? currencyToggle.value : 'usd';
                const period = isYearly ? 'yearly' : 'monthly';
                const suffix = isYearly ? '/ year' : '/ month';

                const monthlyLabel = document.getElementById('monthlyLabel');
                const yearlyLabel = document.getElementById('yearlyLabel');

                if (monthlyLabel && yearlyLabel) {
                    if (isYearly) {
                        // Yearly সিলেক্ট করা থাকলে
                        monthlyLabel.style.color = 'var(--text-muted)';
                        monthlyLabel.style.fontWeight = 'normal';

                        yearlyLabel.style.color = 'var(--text-primary)';
                        yearlyLabel.style.fontWeight = 'bold';
                    } else {
                        // Monthly সিলেক্ট করা থাকলে
                        monthlyLabel.style.color = 'var(--text-primary)';
                        monthlyLabel.style.fontWeight = 'bold';

                        yearlyLabel.style.color = 'var(--text-muted)';
                        yearlyLabel.style.fontWeight = 'normal';
                    }
                }

                // আপডেট ফাংশন
                const formatPrice = (val) => `${val}<span class="period">${suffix}</span>`;

                if (freePrice) freePrice.innerHTML = formatPrice(priceData.free[currency]);
                if (proPrice) proPrice.innerHTML = formatPrice(priceData.pro[currency][period]);
                if (premiumPrice) premiumPrice.innerHTML = formatPrice(priceData.premium[currency][period]);
                if (agencyPrice) agencyPrice.innerHTML = formatPrice(priceData.agency[currency][period]);
            }

            if (pricingToggle) pricingToggle.addEventListener('change', updatePricing);
            if (currencyToggle) currencyToggle.addEventListener('change', updatePricing);

            updatePricing();
        });


        // ===========================================
        // SECTION 3: Rejection Info Modal
        // ===========================================
        // Open Rejection Info Modal
        function openRejectionInfoModal() {
            const modal = document.getElementById('rejectionInfoModal');
            if (modal) {
                modal.style.display = 'flex';
            }
        }

        // ===========================================
        // SECTION 4: Tour Implementation
        // ===========================================
        // Tour Implementation
        function startMetaGenTour() {
            const driver = window.driver.js.driver;
            const driverObj = driver({
                showProgress: true,
                steps: [
                    {
                        element: '#tour-upload-section',
                        popover: {
                            title: 'Upload Files',
                            description: 'Drag & drop or click to upload your images/videos here. You can select multiple files.'
                        }
                    },
                    {
                        element: '#tour-platform-section',
                        popover: {
                            title: 'Select Platform',
                            description: 'Choose the stock platform you are targeting (e.g., Shutterstock, Adobe Stock) to optimize keywords and limits.'
                        }
                    },

                    {
                        element: '#processAllButton',
                        popover: {
                            title: 'Generate Metadata',
                            description: 'Click here to generate titles, descriptions, and keywords for all uploaded files automatically.'
                        }
                    },
                    {
                        element: '#embedMetadataButton',
                        popover: {
                            title: 'Embed Metadata',
                            description: 'Click here to embed metadata by automatically generating titles, descriptions, and keywords for all uploaded JPG/PNG/SVG files.'
                        }
                    },
                    {
                        element: '#exportButton',
                        popover: {
                            title: 'Export Results',
                            description: 'Once generated, you can export your metadata as a CSV or Excel file to upload to stock sites.'
                        }
                    },
                    {
                        element: '#saveToFolderButton',
                        popover: {
                            title: 'Save Embed Metadata File',
                            description: 'Click here to save the embedded metadata file which automatically writes the title, description and keywords inside all JPG/PNG/SCG files.'
                        }
                    }
                ]
            });
            driverObj.drive();
        }

        function toggleLanguageDropdown() {
            document.getElementById('languageDropdown').classList.toggle('show');
        }

        // Close dropdown when clicking outside
        window.onclick = function (event) {
            if (!event.target.matches('.language-btn') && !event.target.closest('.language-btn')) {
                var dropdowns = document.getElementsByClassName("language-dropdown");
                for (var i = 0; i < dropdowns.length; i++) {
                    var openDropdown = dropdowns[i];
                    if (openDropdown.classList.contains('show')) {
                        openDropdown.classList.remove('show');
                    }
                }
            }
        }

        function setLanguage(lang) {
            if (!translations[lang]) return;

            localStorage.setItem('selectedLanguage', lang);
            updateUI(lang);

            // Update Active State in Dropdown
            document.querySelectorAll('.language-option').forEach(opt => {
                opt.classList.remove('active');
                if (opt.getAttribute('data-lang') === lang) {
                    opt.classList.add('active');
                }
            });

            // Update Button Text
            const currentLangSpan = document.getElementById('currentLang');
            if (currentLangSpan) currentLangSpan.innerText = translations[lang].name;
        }

        function updateUI(lang, rootElement = document) {
            const t = translations[lang];


            // Recursively find elements with data-i18n
            rootElement.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                if (t && t[key]) {
                    if (el.tagName === 'INPUT' && el.getAttribute('placeholder')) {
                        el.setAttribute('placeholder', t[key]);
                    } else {
                        // Handle text nodes specifically to preserve icons
                        let textNode = Array.from(el.childNodes).find(node => node.nodeType === 3 && node.nodeValue.trim().length > 0);
                        if (textNode) {
                            textNode.nodeValue = " " + t[key] + " "; // Add spacing
                        } else {
                            el.innerText = t[key];
                        }
                    }
                }
            });

            // Handle HTML content
            rootElement.querySelectorAll('[data-i18n-html]').forEach(el => {
                const key = el.getAttribute('data-i18n-html');
                if (t && t[key]) {
                    el.innerHTML = t[key];
                }
            });
        }

        // Initialize Language on Load
        document.addEventListener('DOMContentLoaded', () => {
            if (typeof translations !== 'undefined' && translations) {
                // Add Spam Shield Translations
                if (translations['en']) {
                    translations['en']['toggle_spam_shield'] = "🛡️ Spam Shield";
                    translations['en']['spam_risk_high'] = "High Spam Risk";
                    translations['en']['spam_risk_medium'] = "Medium Spam Risk";
                    translations['en']['spam_risk_low'] = "Low Risk";
                    translations['en']['spam_duplicate_title'] = "Duplicate title detected with:";
                    translations['en']['spam_keyword_overlap'] = "Keyword overlap detected:";
                    translations['en']['spam_suggestion'] = "Change title/keywords to avoid spam flags.";
                }
                if (translations['bn']) {
                    translations['bn']['toggle_spam_shield'] = "🛡️ স্প্যাম শিল্ড";
                    translations['bn']['spam_risk_high'] = "উচ্চ স্প্যাম ঝুঁকি";
                    translations['bn']['spam_risk_medium'] = "মাঝারি স্প্যাম ঝুঁকি";
                    translations['bn']['spam_risk_low'] = "কম ঝুঁকি";
                    translations['bn']['spam_duplicate_title'] = "ডুপ্লিকেট টাইটেল পাওয়া গেছে:";
                    translations['bn']['spam_keyword_overlap'] = "কিওয়ার্ড ওভারল্যাপ সনাক্ত হয়েছে:";
                    translations['bn']['spam_suggestion'] = "স্প্যামিং এড়াতে টাইটেল/কিওয়ার্ড পরিবর্তন করুন।";
                }
            }
            const savedLang = localStorage.getItem('selectedLanguage') || 'en';
            setLanguage(savedLang);
        });

        function getTrans(key) {
            const lang = localStorage.getItem('selectedLanguage') || 'en';
            return translations[lang] && translations[lang][key] ? translations[lang][key] : translations['en'][key];
        }


        // ===========================================
        // SECTION 6: Back-to-Top Scroll Handler
        // ===========================================
        window.addEventListener('scroll', function () {
            const btn = document.getElementById('backToTop');
            if (btn) {
                if (window.scrollY > 300) {
                    btn.style.opacity = '1';
                    btn.style.visibility = 'visible';
                } else {
                    btn.style.opacity = '0';
                    btn.style.visibility = 'hidden';
                }
            }
        });


        // ===========================================
        // SECTION 7: AI Chat Widget & Payment Modal
        // ===========================================
        (function () {
            const chatToggle = document.getElementById('aiChatToggle');
            const chatWindow = document.getElementById('aiChatWindow');
            const chatClose = document.getElementById('aiChatClose');
            const chatMessages = document.getElementById('aiChatMessages');
            const chatInput = document.getElementById('aiChatInput');
            const chatSend = document.getElementById('aiChatSend');

            // Toggle chat window
            chatToggle.addEventListener('click', () => {
                chatWindow.classList.toggle('active');
                if (chatWindow.classList.contains('active')) {
                    chatInput.focus();
                    checkPremiumForWhatsapp(); // Check if premium user
                }
            });

            chatClose.addEventListener('click', () => {
                chatWindow.classList.remove('active');
            });

            // Function to verify premium status and display WhatsApp button
            async function checkPremiumForWhatsapp() {
                const waBtn = document.getElementById('premiumWhatsappBtn');
                if (!waBtn) return;

                // Fast check via global state
                if (window.userUsageData && window.userUsageData.plan === 'premium') {
                    waBtn.style.display = 'flex';
                    return;
                }

                // Fallback check via Database (Firebase)
                if (auth && auth.currentUser) {
                    try {
                        const user = auth.currentUser;
                        const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                        const profile = profileDoc.exists ? profileDoc.data() : null;

                        let isPremium = false;
                        if (profile?.plan && profile.plan.toLowerCase() === 'premium') {
                            isPremium = true;
                        } else if (!profile?.plan && profile?.limit >= 100) {
                            // Fallback: check limit field if plan field doesn't exist
                            isPremium = true;
                        }

                        if (isPremium) {
                            waBtn.style.display = 'flex';
                            if (window.userUsageData) window.userUsageData.plan = 'premium';
                            return;
                        }
                    } catch (e) {
                        console.error("WhatsApp premium check error:", e);
                    }
                }

                // Hide if not premium
                waBtn.style.display = 'none';
            }

            // Auto-resize textarea
            chatInput.addEventListener('input', function () {
                this.style.height = 'auto';
                this.style.height = (this.scrollHeight) + 'px';
            });

            // Send message on Enter (but Shift+Enter for new line)
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                }
            });

            chatSend.addEventListener('click', handleSendMessage);

            async function handleSendMessage() {
                const message = chatInput.value.trim();
                if (!message) return;

                // Add user message to UI
                addMessage(message, 'user');
                chatInput.value = '';
                chatInput.style.height = 'auto';

                // Show thinking state
                const thinkingId = 'thinking-' + Date.now();
                addMessage('<i class="fas fa-spinner fa-spin"></i> Thinking...', 'ai', thinkingId);

                try {
                    const response = await sendMessageToAI(message);
                    removeMessage(thinkingId);
                    addMessage(response, 'ai');
                } catch (error) {
                    removeMessage(thinkingId);
                    addMessage('Error: ' + error.message, 'ai');
                }
            }

            function addMessage(text, sender, id = null) {
                const msgWrapper = document.createElement('div');
                msgWrapper.className = `chat-message-wrapper ${sender}-wrapper`;
                if (id) msgWrapper.id = id;

                if (sender === 'ai') {
                    const avatar = document.createElement('div');
                    avatar.className = 'chat-avatar';
                    avatar.innerHTML = '<i class="fas fa-robot"></i>';
                    msgWrapper.appendChild(avatar);
                }

                const msgDiv = document.createElement('div');
                msgDiv.className = `chat-message message-${sender}`;

                // Simple markdown-like formatting for AI responses
                if (sender === 'ai') {
                    const formattedText = text
                        .replace(/\n/g, '<br>')
                        .replace(/`(.*?)`/g, '<code>$1</code>');
                    msgDiv.innerHTML = formattedText;
                } else {
                    msgDiv.textContent = text;
                }

                msgWrapper.appendChild(msgDiv);
                chatMessages.appendChild(msgWrapper);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

            function removeMessage(id) {
                const msg = document.getElementById(id);
                if (msg) msg.remove();
            }

            async function sendMessageToAI(userMessage) {
                let selectedProvider = document.getElementById('aiProviderSelect')?.value || 'groq';
                const systemPrompt = "You are MetaGen AI Assistant, a professional helper for the MetaGen Pro web tool. Your goal is to help users generate high-quality SEO metadata (titles, keywords, descriptions) for their stock photos. You should be helpful, concise, and professional. You can explain how to use the settings, how to generate metadata, and offer tips for stock photography success.";

                // --- PLAN CHECK LOGIC (Firebase) ---
                let isPaidPlan = false;
                let dbPlan = "free";
                let userEmail = "unknown";
                let accessToken = "";

                try {
                    const user = auth.currentUser;
                    if (user) {
                        userEmail = user.email;
                        accessToken = await user.getIdToken();

                        const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                        const profileData = profileDoc.exists ? profileDoc.data() : null;

                        dbPlan = (profileData?.plan || '').toLowerCase();
                        isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
                    }
                } catch (e) {
                    console.warn('Plan check failed for chat:', e);
                }

                // ================= ALL USERS LOGIC (Server-Side Only) =================
                const plan = (window.userUsageData?.plan || 'free').toLowerCase();
                const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";

                try {
                    const response = await fetch(proxyUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${accessToken}`
                        },
                        body: JSON.stringify({
                            action: "chat",
                            prompt: systemPrompt + "\n\nUser Question: " + userMessage,
                            provider: selectedProvider,
                            email: userEmail,
                            deviceInfo: navigator.userAgent
                        })
                    });

                    const data = await response.json();

                    if (!response.ok) throw new Error(data.error || response.statusText);

                    /* Free Action - No local increment */

                    // Update local trial count if applicable
                    if (data.newCount !== undefined && window.trialUsage) {
                        window.trialUsage.count = data.newCount;
                        if (typeof updateTrialUI === 'function') updateTrialUI();
                    }

                    let generatedText = data.text || (data.choices && data.choices[0].message.content) || (data.candidates && data.candidates[0].content.parts[0].text) || JSON.stringify(data);
                    return generatedText.replace(/^```[a - z] *\s *|\s * ```$/gi, '').trim();

                } catch (error) {
                    console.error("AI Assistant Error:", error);
                    throw error;
                }
            }


        })();


        function closeRefPopup() {
            document.getElementById('referralPopup').classList.add('hidden');
            sessionStorage.setItem('refPopupClosed', 'true');
        }

        async function checkAndShowRefPopup() {
            if (!auth) return;
            const user = auth.currentUser;
            if (!user) return;

            const usage = await getMetadataUsage(user.email);

            // Show referral popup for free users to encourage upgrade/sharing
            if (usage.plan === 'free' && !sessionStorage.getItem('refPopupClosed')) {
                setTimeout(() => {
                    const popup = document.getElementById('referralPopup');
                    if (popup) popup.classList.remove('hidden');
                }, 5000);
            }
        }

        window.addEventListener('load', checkAndShowRefPopup);

        // --- Keyword Suggestion Feature ---
        window._keywordClickInProgress = false;
        window.handleKeywordClick = async function (event, keyword, cardId) {
            event.stopPropagation();

            // Debounce: prevent rapid duplicate clicks
            if (window._keywordClickInProgress) return;
            window._keywordClickInProgress = true;
            setTimeout(() => { window._keywordClickInProgress = false; }, 2000);


            // Remove existing modal if any
            let existingModal = document.getElementById('keyword-suggestion-modal-element');
            if (existingModal) {
                existingModal.remove();
            }

            // Create new modal
            const modal = document.createElement('div');
            modal.id = 'keyword-suggestion-modal-element';
            modal.className = 'keyword-suggestion-modal';

            // Position near the clicked pill
            const rect = event.target.closest('.meta-keyword-pill').getBoundingClientRect();
            // Account for scrolling
            modal.style.top = (window.scrollY + rect.bottom + 5) + 'px';
            modal.style.left = (window.scrollX + rect.left) + 'px';

            modal.innerHTML = `
                <div class="keyword-suggestion-header">
                    <span>Suggestions for "${keyword}"</span>
                    <button class="keyword-suggestion-close" onclick="this.closest('.keyword-suggestion-modal').remove()">×</button>
                </div>
                <div class="suggestion-loading"><i class="fas fa-spinner fa-spin"></i> Generating...</div>
                <div class="keyword-suggestion-list" id="suggestion-list-${cardId}"></div>
            `;

            document.body.appendChild(modal);
            modal.style.display = 'flex';

            // Close when clicking outside
            setTimeout(() => {
                document.addEventListener('click', function closeSuggestion(e) {
                    const m = document.getElementById('keyword-suggestion-modal-element');
                    if (m && !m.contains(e.target) && !e.target.closest('.meta-keyword-pill')) {
                        m.remove();
                        document.removeEventListener('click', closeSuggestion);
                    }
                });
            }, 100);

            // Generate keywords
            try {
                const suggestions = await generateKeywordSuggestions(keyword);

                // FIXED: Removed extra spaces around the ID
                const listContainer = document.getElementById(`suggestion-list-${cardId}`);
                if (!listContainer) return; // Modal was closed

                if (suggestions && suggestions.length > 0) {
                    listContainer.innerHTML = suggestions.map(s =>
                        `<span class="suggestion-pill" onclick="addSuggestedKeyword('${cardId}', '${s.replace(/'/g, "\\'")}')">+ ${s}</span>`
                    ).join('');
                } else {
                    listContainer.innerHTML = '<div class="suggestion-loading" style="color:#EF4444">No suggestions found. Please try another keyword.</div>';
                }

                const loadingIndicator = modal.querySelector('.suggestion-loading');
                if (loadingIndicator) loadingIndicator.style.display = 'none';

            } catch (error) {
                console.error("Suggestion error:", error);
                const listContainer = document.getElementById(`suggestion-list-${cardId}`);
                if (listContainer) {
                    listContainer.innerHTML = `<div class="suggestion-loading" style="color:#EF4444">Error generating keywords.</div>`;
                    const loadingIndicator = modal.querySelector('.suggestion-loading');
                    if (loadingIndicator) loadingIndicator.style.display = 'none';
                }
            }
        };

        window.addSuggestedKeyword = function (cardId, newKeyword) {
            const fileData = uploadedFilesData.find(f => f.id === cardId);
            if (!fileData) return;

            let keywords = Array.isArray(fileData.keywords)
                ? fileData.keywords
                : (fileData.keywords ? fileData.keywords.split(',').map(k => k.trim()).filter(k => k) : []);

            const cleanKeyword = newKeyword.trim().toLowerCase();

            // Check if already exists (case-insensitive)
            if (!keywords.some(k => k.toLowerCase() === cleanKeyword)) {
                keywords.push(cleanKeyword);
                fileData.keywords = keywords.join(', ');

                // Assign a default score so it renders perfectly in UI
                if (!fileData.keywordScores) fileData.keywordScores = {};
                fileData.keywordScores[cleanKeyword] = 100;

                updateKeywordsDisplay(cardId);

                // Explicitly update count with visual feedback
                const countElem = document.getElementById(`keyword-count-${cardId}`);
                if (countElem) {
                    countElem.textContent = `(${keywords.length})`;
                    countElem.style.color = '#10B981';
                    countElem.style.fontWeight = 'bold';
                    countElem.style.transition = 'color 0.3s ease';
                    setTimeout(() => {
                        countElem.style.color = '';
                        countElem.style.fontWeight = '';
                    }, 800);
                }
            } else {
                alert('Keyword already exists!');
            }

            // Close modal
            const m = document.getElementById('keyword-suggestion-modal-element');
            if (m) m.remove();
        };
        async function generateKeywordSuggestions(baseKeyword) {
            const promptText = `Generate exactly 10 highly relevant, single-word SEO keywords for stock photography related to: "${baseKeyword}". Return ONLY a JSON array of strings: ["keyword1", "keyword2", ...]`;

            // --- PLAN CHECK (Firebase) ---
            const user = auth.currentUser;
            let isPaidPlan = false;
            let dbPlan = "free";
            let accessToken = "";

            if (user) {
                try {
                    accessToken = await user.getIdToken();
                    const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                    const profileData = profileDoc.exists ? profileDoc.data() : null;

                    dbPlan = (profileData?.plan || 'free').toLowerCase();
                    isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium');
                } catch (e) { }
            }

            const selectedProvider = document.getElementById('aiProviderSelect')?.value || 'groq';
            let generatedText = "";

            const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";

            try {
                const response = await fetch(proxyUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({
                        action: "chat", // পরিবর্তন করা হয়েছে: 'generate' থেকে 'chat'
                        prompt: promptText,
                        provider: selectedProvider,
                        email: user?.email || "unknown",
                        deviceInfo: navigator.userAgent
                    })
                });

                const data = await response.json();
                if (response.ok) {
                    // 📊 Log activity and update usage
                    logActivity('Metadata Generated', {
                        action: 'Keyword Suggestions',
                        baseKeyword: baseKeyword
                    });
                    generatedText = data.text || data.metadata || (typeof data === 'string' ? data : JSON.stringify(data));
                } else {
                    console.error("Server responded with error:", data);
                    throw new Error(data.error || "Proxy error");
                }
            } catch (err) {
                throw err;
            }

            // JSON পার্সিং এবং ক্লিনিং
            try {
                let cleanedJsonString = generatedText.replace(/^\s*```json\s*|\s*```\s*$/g, '').trim();
                const jsonStart = cleanedJsonString.indexOf('[');
                const jsonEnd = cleanedJsonString.lastIndexOf(']');
                if (jsonStart !== -1 && jsonEnd !== -1) {
                    cleanedJsonString = cleanedJsonString.substring(jsonStart, jsonEnd + 1);
                    const arr = JSON.parse(cleanedJsonString);
                    if (Array.isArray(arr)) return arr.filter(w => w.toLowerCase() !== baseKeyword.toLowerCase()).slice(0, 10);
                }
            } catch (e) {
                console.warn("Could not parse suggestion JSON, using regex fallback:", e);
                const words = generatedText.match(/\b[a-zA-Z]+\b/g) || [];
                return [...new Set(words)].filter(w => w.length > 2 && w.toLowerCase() !== baseKeyword.toLowerCase()).slice(0, 10);
            }
            return [];
        }

        document.addEventListener('DOMContentLoaded', function () {
            const csvUploadButton = document.getElementById('csvUploadButton');
            const csvInput = document.getElementById('csvInput');

            if (csvUploadButton && csvInput) {
                csvUploadButton.onclick = async () => {
                    // --- ১. প্ল্যান চেক ---
                    const usage = window.userUsageData || { plan: 'free' };
                    const currentPlan = (usage.plan || 'free').toLowerCase();

                    if (currentPlan === 'free') {
                        alert("CSV Metadata Import is a PRO/PREMIUM feature. Please upgrade your plan to use this.");
                        if (typeof scrollToPricing === 'function') scrollToPricing();
                        return;
                    }

                    // প্ল্যান প্রো বা প্রিমিয়াম হলে ইনপুট ওপেন হবে
                    csvInput.click();
                };

                csvInput.onchange = function (e) {
                    const file = e.target.files[0];
                    if (!file) return;

                    const reader = new FileReader();
                    reader.onload = function (event) {
                        processMetadataCSV(event.target.result);
                        csvInput.value = ''; // রিসেট
                    };
                    reader.readAsText(file);
                };
            }
        });




        function processMetadataCSV(csvText) {
            const lines = csvText.split('\n');

            // কোটেশন মার্ক সহ কমা হ্যান্ডেল করার জন্য উন্নত স্প্লিটার
            const splitCSVRow = (row) => {
                const result = [];
                let cur = '';
                let inQuote = false;
                for (let char of row) {
                    if (char === '"') inQuote = !inQuote;
                    else if (char === ',' && !inQuote) {
                        result.push(cur.trim());
                        cur = '';
                    } else cur += char;
                }
                result.push(cur.trim());
                return result;
            };

            const headers = splitCSVRow(lines[0]).map(h => h.toLowerCase().replace(/"/g, ''));

            // কলাম ইনডেক্স খুঁজে বের করা
            const fileIdx = headers.findIndex(h => h.includes('filename') || h.includes('file name'));
            // Description এর জন্য একাধিক নাম চেক করা হচ্ছে (যাতে মিস না হয়)
            const descIdx = headers.findIndex(h => h === 'description' || h === 'caption' || h === 'abstract' || h === 'subject');
            const titleIdx = headers.findIndex(h => h.includes('title') || h.includes('headline') || h === 'name');
            const keyIdx = headers.findIndex(h => h.includes('keywords') || h.includes('tags'));

            if (fileIdx === -1) {
                alert("CSV must have a 'Filename' column to match images.");
                return;
            }

            let matchCount = 0;

            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                const row = splitCSVRow(lines[i]);

                const fileName = row[fileIdx].replace(/"/g, '');
                const title = titleIdx !== -1 ? row[titleIdx].replace(/"/g, '') : '';
                const description = descIdx !== -1 ? row[descIdx].replace(/"/g, '') : '';
                const keywords = keyIdx !== -1 ? row[keyIdx].replace(/"/g, '') : '';

                // আপলোড করা ইমেজের সাথে ফাইল নেম ম্যাচিং
                const fileData = window.uploadedFilesData.find(f => f.name === fileName);

                if (fileData) {
                    fileData.title = title;
                    fileData.description = description;
                    fileData.keywords = keywords;

                    // UI কার্ড আপডেট করা
                    const card = document.getElementById(fileData.id);
                    if (card) {
                        card.classList.add('metadata-generated');
                        const titleEl = card.querySelector('.meta-title');
                        const descEl = card.querySelector('.meta-description');
                        const metaCol = card.querySelector('.card-meta-col');
                        const descSection = document.getElementById(`desc-section-${card.id}`);

                        // টাইটেল সেট
                        if (titleEl) titleEl.innerText = title;

                        // ডেসক্রিপশন সেট (Fix: এখানে ডেসক্রিপশন বসানো হচ্ছে)
                        if (descEl) {
                            descEl.innerText = description;
                            if (description && descSection) descSection.style.display = 'block';
                        }

                        metaCol.style.display = 'flex';

                        // কীওয়ার্ড এবং কাউন্ট আপডেট
                        updateKeywordsDisplay(fileData.id);

                        // টাইটেল ও ডেসক্রিপশন কাউন্ট আপডেট
                        const tCount = card.querySelector(`#title-count-${card.id}`);
                        const dCount = card.querySelector(`#desc-count-${card.id}`);
                        if (tCount) tCount.innerText = `(${title.split(/\s+/).filter(w => w).length})`;
                        if (dCount) dCount.innerText = `(${description.split(/\s+/).filter(w => w).length})`;

                        // এসইও স্কোর আপডেট
                        const score = calculateSeoScore(fileData);
                        updateSeoMeter(fileData.id, score);
                    }
                    matchCount++;
                }
            }

            if (matchCount > 0) {
                alert(`Success! Imported metadata for ${matchCount} matching files.`);
                updateAllButtonStates(); // বাটন আপডেট
            } else {
                alert("No matching filenames found. Ensure your images are uploaded first and filenames in CSV match exactly.");
            }
        }

        // Back to Top এবং AI Assistant পজিশন কন্ট্রোল
        window.addEventListener('scroll', function () {
            const btn = document.getElementById('backToTop');
            const aiWidget = document.querySelector('.ai-chat-widget'); // AI Widget সিলেক্ট করা হলো

            if (btn) {
                if (window.scrollY > 300) {
                    // Back to Top দেখাও
                    btn.classList.add('show');
                    // AI Assistant উপরে তোলো
                    if (aiWidget) aiWidget.classList.add('move-up');
                } else {
                    // Back to Top লুকাও
                    btn.classList.remove('show');
                    // AI Assistant স্বাভাবিক পজিশনে নামাও
                    if (aiWidget) aiWidget.classList.remove('move-up');
                }
            }
        });

        function openManualPaymentModal() {
            document.getElementById('manualPaymentModal').style.display = 'flex';
        }

        function closeManualPaymentModal() {
            document.getElementById('manualPaymentModal').style.display = 'none';
        }

        function copyText(text) {
            navigator.clipboard.writeText(text);
            alert("Email copied to clipboard!");
        }

        // ক্লিক করলে মোডাল বন্ধ হওয়া
        window.addEventListener('click', function (event) {
            const modal = document.getElementById('manualPaymentModal');
            if (event.target === modal) {
                closeManualPaymentModal();
            }
        });


