
        // ===========================================
        // SECTION 8: PDF.js Worker Init
        // ===========================================
        window.addEventListener('load', function () {
            if (typeof pdfjsLib !== 'undefined') {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }
        });

        // ===========================================
        // SECTION 9: EmailJS Init
        // ===========================================
        (function () {
            emailjs.init("k8DHHjzVzM5RV2tZz");
        })();

        // ===========================================
        // SECTION 10: Paddle/Auth/Payment Logic
        // ===========================================
        // ১. পডেল (Paddle) ডাইনামিক লোড ফাংশন
        function loadPaddle() {
            if (window.paddleLoaded) return Promise.resolve();

            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
                script.async = true;
                script.onload = () => {
                    window.paddleLoaded = true;
                    Paddle.Environment.set("production");
                    Paddle.Initialize({
                        token: "live_e3be7b1a8417bf8d1991eb5aec5"
                    });
                    console.log("Paddle Initialized.");
                    resolve();
                };
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        // ২. মেইন পেমেন্ট হ্যান্ডেলার (Monthly vs Yearly + Agency + Credit Packs)
        // পেমেন্ট হ্যান্ডেলার ফাংশন (USD/INR এবং Monthly/Yearly অনুযায়ী Price ID নির্বাচন করবে)
        async function handlePayment(planType) {
            // কারেন্সি টগল এখন একটি 'select' এলিমেন্ট
            const currencyToggle = document.getElementById('currencyToggle');
            const pricingToggle = document.getElementById('pricingToggle');

            const currency = currencyToggle ? currencyToggle.value : 'usd'; // 'usd', 'inr', বা 'bdt'
            const isYearly = pricingToggle ? pricingToggle.checked : false;
            const period = isYearly ? 'yearly' : 'monthly';

            const priceMap = {
                'pro': {
                    'usd': { monthly: 'pri_01kqfns94nxjkkx13fev08r17y', yearly: 'pri_01kqfmww2dq13cfgp8f31wjj0w' },
                    'inr': { monthly: 'pri_01kwss5rmspb1m7p3a91bypvjk', yearly: 'pri_01kwtvm621ew05cf7sh9hpb9xb' },
                    'bdt': { monthly: 'pri_pro_bdt_m', yearly: 'pri_pro_bdt_y' }
                },
                'premium': {
                    'usd': { monthly: 'pri_01kqfnkzh5r1sns8qk6nw055vc', yearly: 'pri_01kq7jac3fw4q51j18426yzqr0' },
                    'inr': { monthly: 'pri_01kwtvbwqbkvky6femj18rne6t', yearly: 'pri_01kwtvgpvxea75qhr48fzhwm66' },
                    'bdt': { monthly: 'pri_prem_bdt_m', yearly: 'pri_prem_bdt_y' }
                },
                'agency': {
                    'usd': { monthly: 'pri_01krqxzwcg75487rs8zjhrzran', yearly: 'pri_ag_usd_y' },
                    'inr': { monthly: 'pri_01kwtvyd8a9xz8238ch7nt69n0', yearly: 'pri_ag_inr_y' },
                    'bdt': { monthly: 'pri_ag_bdt_m', yearly: 'pri_ag_bdt_y' }
                },
                'starter': { // আপনার HTML এ আইডি 'starter' হলে এখানেও 'starter' রাখুন
                    'usd': 'pri_01krqybgp7ds4e3vs0amd0mgw6',
                    'inr': 'pri_st_inr',
                    'bdt': 'pri_st_bdt'
                },
                'power': {
                    'usd': 'pri_01krqyfxsvb8c82ntrtmg14137',
                    'inr': 'pri_pw_inr',
                    'bdt': 'pri_pw_bdt'
                }
            };

            const plan = priceMap[planType];
            if (!plan) {
                console.error(`Plan not found: ${planType}`);
                return;
            }

            // সঠিক Price ID নির্ধারণ
            let targetPriceId;
            if (planType === 'starter' || planType === 'power') {
                targetPriceId = plan[currency];
            } else {
                targetPriceId = plan[currency][period];
            }

            if (!targetPriceId || targetPriceId.includes('id_here')) {
                alert("Price ID configuration is missing for this selection.");
                return;
            }

            console.log("Launching Paddle with ID:", targetPriceId);
            await openPaddleCheckout(targetPriceId);
        }

        // ৩. চেকআউট খোলার ফাংশন
        async function openPaddleCheckout(planPriceId) {
            if (!planPriceId) {
                alert("Price ID missing!");
                return;
            }

            // ইউজার লগইন চেক (Firebase)
            const user = auth.currentUser;
            if (!user) {
                alert("Please login first to upgrade your plan.");
                document.getElementById('loginModal').classList.remove('hidden');
                return;
            }

            const userEmail = user.email;

            try {
                await loadPaddle(); // নিশ্চিত করা যে Paddle লোড হয়েছে
                Paddle.Checkout.open({
                    items: [{ priceId: planPriceId, quantity: 1 }],
                    customer: { email: userEmail }, // ইউজারের ইমেল অটো-ফিল হবে
                    customData: { user_email: userEmail },
                    settings: {
                        successUrl: "https://www.aimetagenpro.com/p/payment-success.html",
                        displayMode: "overlay",
                        theme: "dark"
                    }
                });
            } catch (error) {
                console.error("Paddle loading failed:", error);
                alert("Payment system is currently unavailable. Please try again.");
            }
        }

        // ৩. পারফরম্যান্স বুস্টার: অদরকারি স্ক্রিপ্ট ডিলে লোড
        async function loadNonCriticalScripts() {
            console.log("Optimizing Page: Loading heavy assets...");

            // Paddle লোড করা
            loadPaddle().catch(e => console.log("Paddle delay load failed"));

            // EmailJS Initialize করা
            if (typeof emailjs !== "undefined") {
                emailjs.init("k8DHHjzVzM5RV2tZz");
                console.log("EmailJS Initialized.");
            }

            // Vanta Animation (শুধুমাত্র ডেস্কটপে পারফরম্যান্স ঠিক রাখতে)
            if (window.innerWidth > 768 && typeof initHeroAnimation === "function") {
                initHeroAnimation();
                console.log("Hero Animation Started.");
            }
        }

        // পেজ লোড হওয়ার ৪.৫ সেকেন্ড পর রান হবে
        window.addEventListener('load', function () {
            setTimeout(() => {
                if ('requestIdleCallback' in window) {
                    requestIdleCallback(loadNonCriticalScripts);
                } else {
                    loadNonCriticalScripts();
                }
            }, 4500);
        });

        async function openBroadcastModal() {
            const user = auth.currentUser;
            const ADMIN_EMAILS = ['metagenp@gmail.com', 'pradipgraphic@gmail.com', 'support@aimetagenpro.com', 'pradipcob84@gmail.com'];

            if (!user || !ADMIN_EMAILS.includes(user.email)) {
                alert("Only admins can send broadcasts.");
                return;
            }

            document.getElementById('adminBroadcastModal').style.display = 'flex';
        }

        async function sendBroadcast() {
            const subject = document.getElementById('broadcastSubject').value.trim();
            const message = document.getElementById('broadcastMessage').value.trim();
            const sendBtn = document.getElementById('sendBroadcastBtn');

            if (!subject || !message) {
                alert("Please enter both subject and message.");
                return;
            }

            if (!confirm("Are you sure you want to send this email to ALL users? This action cannot be undone.")) {
                return;
            }

            const user = auth.currentUser;
            if (!user) return;

            sendBtn.disabled = true;
            sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

            try {
                const idToken = await user.getIdToken();
                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/admin/broadcast/send', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ subject, html: message })
                });

                const data = await res.json();

                if (data.success) {
                    alert(`Broadcast sent successfully to ${data.count} users in ${data.batches} batches.`);
                    document.getElementById('adminBroadcastModal').style.display = 'none';
                    document.getElementById('broadcastSubject').value = '';
                    document.getElementById('broadcastMessage').value = '';
                } else {
                    throw new Error(data.error || "Failed to send broadcast");
                }
            } catch (err) {
                console.error("Broadcast error:", err);
                alert("Error sending broadcast: " + err.message);
            } finally {
                sendBtn.disabled = false;
                sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send to All Users';
            }
        }
        // =====================================================
        // ========== AI IMAGE HEALING (ClipDrop) ==============
        // =====================================================
        let healingOriginalImage = null;
        let healingOriginalFile = null;
        let healingMaskHistory = [];
        let healingIsDrawing = false;

        function loadHealingImage(event) {
            const file = event.target.files[0];
            if (!file) return;
            _initHealingCanvas(file);
        }

        function handleHealingDrop(event) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.style.borderColor = 'var(--border-color)';
            const file = event.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) _initHealingCanvas(file);
        }

        function _initHealingCanvas(file, regions = null) {
            healingOriginalFile = file;
            const img = new Image();
            img.onload = function () {
                healingOriginalImage = img;
                const canvas = document.getElementById('healingCanvas');
                const ctx = canvas.getContext('2d');
                let w = img.width, h = img.height;
                const maxDim = 500;
                if (w > maxDim || h > maxDim) {
                    if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
                    else { w = Math.round(w * maxDim / h); h = maxDim; }
                }
                canvas.width = w;
                canvas.height = h;
                canvas.dataset.originalWidth = w;
                canvas.dataset.originalHeight = h;
                canvas.style.width = w + 'px';
                canvas.style.height = h + 'px';
                ctx.drawImage(img, 0, 0, w, h);
                healingMaskHistory = [ctx.getImageData(0, 0, w, h)];

                if (regions && Array.isArray(regions)) {
                    ctx.fillStyle = '#FF0000'; // মাস্কের লাল রং
                    ctx.globalAlpha = 0.5;      // অর্ধ-স্বচ্ছতা

                    regions.forEach(reg => {
                        if (!Array.isArray(reg) || reg.length < 4) return;

                        const x1 = (reg[0] / 100) * w;
                        const y1 = (reg[1] / 100) * h;
                        const x2 = (reg[2] / 100) * w;
                        const y2 = (reg[3] / 100) * h;

                        const boxW = x2 - x1;
                        const boxH = y2 - y1;

                        // Prevent masking the entire image for global issues
                        if (boxW >= w * 0.95 && boxH >= h * 0.95) {
                            return;
                        }

                        ctx.fillRect(x1, y1, boxW, boxH);
                    });
                    ctx.globalAlpha = 1.0; // আলফা রিস্টোর করুন

                    healingMaskHistory.push(ctx.getImageData(0, 0, w, h));
                }

                document.getElementById('healingUploadArea').style.display = 'none';
                document.getElementById('healingWorkspace').style.display = 'block';
                document.getElementById('healingResultContainer').style.display = 'none';
                document.getElementById('healingDownloadBtn').style.display = 'none';
                document.getElementById('healingError').style.display = 'none';
                _initHealingDrawing(canvas);
            };
            img.src = URL.createObjectURL(file);
        }

        function _initHealingDrawing(canvas) {
            const ctx = canvas.getContext('2d');
            const brushInput = document.getElementById('healingBrushSize');
            const brushLabel = document.getElementById('healingBrushSizeVal');
            brushInput.oninput = () => { brushLabel.textContent = brushInput.value; };
            function getPos(e) {
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                if (e.touches) return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
                return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
            }
            function drawBrush(pos) {
                const r = parseInt(brushInput.value);
                ctx.globalAlpha = 0.5;
                ctx.fillStyle = '#FF0000';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }
            canvas.onmousedown = (e) => { healingIsDrawing = true; drawBrush(getPos(e)); };
            canvas.onmousemove = (e) => { if (healingIsDrawing) drawBrush(getPos(e)); };
            canvas.onmouseup = () => { if (healingIsDrawing) { healingIsDrawing = false; healingMaskHistory.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); } };
            canvas.onmouseleave = () => { if (healingIsDrawing) { healingIsDrawing = false; healingMaskHistory.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); } };
            canvas.ontouchstart = (e) => { e.preventDefault(); healingIsDrawing = true; drawBrush(getPos(e)); };
            canvas.ontouchmove = (e) => { e.preventDefault(); if (healingIsDrawing) drawBrush(getPos(e)); };
            canvas.ontouchend = () => { if (healingIsDrawing) { healingIsDrawing = false; healingMaskHistory.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); } };
        }

        async function autoDetectWatermarks() {
            if (!healingOriginalFile) {
                const el = document.getElementById('healingError');
                el.textContent = 'Please load an image first!';
                el.style.display = 'block';
                return;
            }
            const errEl = document.getElementById('healingError');
            const loadingEl = document.getElementById('healingLoading');
            const autoBtn = document.getElementById('healingAutoDetectBtn') || document.querySelector('.orange-button');
            const origText = autoBtn ? autoBtn.innerHTML : 'Auto Detect';

            errEl.style.display = 'none';
            loadingEl.style.display = 'block';
            loadingEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AI is scanning for watermarks & logos...';

            if (autoBtn) {
                autoBtn.disabled = true;
                autoBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...';
            }

            try {
                const user = firebase.auth().currentUser;
                if (!user) throw new Error('Please login first');
                const idToken = await user.getIdToken();

                // Get base64 data of current image
                const base64Data = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const img = new Image();
                        img.onload = () => {
                            let w = img.width, h = img.height;
                            const MAX_DIM = 1024;
                            if (w > MAX_DIM || h > MAX_DIM) {
                                if (w > h) { h *= MAX_DIM / w; w = MAX_DIM; }
                                else { w *= MAX_DIM / h; h = MAX_DIM; }
                            }
                            const canvas = document.createElement('canvas');
                            canvas.width = w; canvas.height = h;
                            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                            resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
                        };
                        img.src = e.target.result;
                    };
                    reader.readAsDataURL(healingOriginalFile);
                });

                // 🔥 HIGHLY OPTIMIZED PROMPT FOR LOGO + TEXT GROUPING
                const visionPrompt = `Analyze this image and detect ANY watermarks, logos, copyright text, or brand names (like "Let's Enhance.io"). 
        CRITICAL INSTRUCTION: If a logo has an icon/graphic AND text next to it, you MUST group them together into ONE single large bounding box that covers BOTH the icon and the entire text completely.
        Return ONLY a valid JSON object:
        {
          "issues": [
            {
              "type": "watermark",
              "regions": [[xmin, ymin, xmax, ymax]]
            }
          ]
        }
        The "regions" array must contain coordinates [xmin, ymin, xmax, ymax] as PERCENTAGES (0 to 100). Make the boxes generous. If nothing is found, return {"issues": []}. Return RAW JSON ONLY.`;

                const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
                const response = await fetch(proxyUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        action: "qualityCheck",
                        prompt: visionPrompt,
                        image: base64Data,
                        mimeType: "image/jpeg",
                        email: user.email || "unknown",
                        provider: "gemini"
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || 'Failed to detect watermarks');
                }

                const data = await response.json();
                let resStr = data.text || data.metadata || (data.candidates && data.candidates[0].content.parts[0].text) || "";
                resStr = resStr.replace(/```json/g, '').replace(/```/g, '').trim();
                const results = JSON.parse(resStr);

                const issues = results.issues || [];
                let regions = [];
                issues.forEach(issue => {
                    if (issue.regions && Array.isArray(issue.regions)) {
                        regions = regions.concat(issue.regions);
                    }
                });

                if (regions.length === 0) {
                    errEl.textContent = 'No watermarks detected! You can manually paint over it with the brush.';
                    errEl.style.display = 'block';
                    errEl.style.color = '#F59E0B';
                } else {
                    const canvas = document.getElementById('healingCanvas');
                    const ctx = canvas.getContext('2d');
                    const w = canvas.width;
                    const h = canvas.height;

                    ctx.fillStyle = '#FF0000';
                    ctx.globalAlpha = 0.5;

                    regions.forEach(reg => {
                        if (!Array.isArray(reg) || reg.length < 4) return;

                        const x1 = (reg[0] / 100) * w;
                        const y1 = (reg[1] / 100) * h;
                        const x2 = (reg[2] / 100) * w;
                        const y2 = (reg[3] / 100) * h;

                        let boxW = x2 - x1;
                        let boxH = y2 - y1;

                        if (boxW >= w * 0.95 && boxH >= h * 0.95) return;

                        // 🔥 MASSIVE PADDING TO COVER ENTIRE LOGO AND TEXT
                        let padX = boxW * 0.35; // 35% extra width
                        let padY = boxH * 0.45; // 45% extra height

                        // Force minimum mask size for very thin/small detections
                        if (boxW < w * 0.15) padX += w * 0.08;
                        if (boxH < h * 0.12) padY += h * 0.06;

                        const finalX = Math.max(0, x1 - padX);
                        const finalY = Math.max(0, y1 - padY);
                        const finalW = Math.min(w - finalX, boxW + (padX * 2));
                        const finalH = Math.min(h - finalY, boxH + (padY * 2));

                        ctx.fillRect(finalX, finalY, finalW, finalH);
                    });

                    ctx.globalAlpha = 1.0;
                    healingMaskHistory.push(ctx.getImageData(0, 0, w, h));

                    loadingEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing watermark...';
                    await processHealing();
                }

            } catch (err) {
                console.error("Auto detect error:", err);
                errEl.textContent = "AI missed it. Please use the manual brush tool.";
                errEl.style.display = 'block';
                errEl.style.color = '#EF4444';
            } finally {
                loadingEl.style.display = 'none';
                if (autoBtn) {
                    autoBtn.disabled = false;
                    autoBtn.innerHTML = origText;
                }
            }
        }

        function clearHealingMask() {
            const canvas = document.getElementById('healingCanvas');
            const ctx = canvas.getContext('2d');
            ctx.drawImage(healingOriginalImage, 0, 0, canvas.width, canvas.height);
            healingMaskHistory = [ctx.getImageData(0, 0, canvas.width, canvas.height)];
        }

        function undoHealingMask() {
            if (healingMaskHistory.length <= 1) return;
            healingMaskHistory.pop();
            const canvas = document.getElementById('healingCanvas');
            const ctx = canvas.getContext('2d');
            ctx.putImageData(healingMaskHistory[healingMaskHistory.length - 1], 0, 0);
        }

        function changeHealingImage() {
            document.getElementById('healingWorkspace').style.display = 'none';
            document.getElementById('healingUploadArea').style.display = 'block';
            document.getElementById('healingFileInput').value = '';
            healingOriginalImage = null;
            healingOriginalFile = null;
            healingMaskHistory = [];
            if (typeof window.resetHealingZoom === 'function') {
                window.resetHealingZoom();
            }
        }

        function _generateMaskFromCanvas() {
            const canvas = document.getElementById('healingCanvas');
            const ctx = canvas.getContext('2d');
            const origData = healingMaskHistory[0].data;
            const currentData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = canvas.width;
            maskCanvas.height = canvas.height;
            const maskCtx = maskCanvas.getContext('2d');
            const maskImgData = maskCtx.createImageData(canvas.width, canvas.height);
            for (let i = 0; i < origData.length; i += 4) {
                const diff = Math.abs(currentData[i] - origData[i]) + Math.abs(currentData[i + 1] - origData[i + 1]) + Math.abs(currentData[i + 2] - origData[i + 2]);
                if (diff > 30) {
                    maskImgData.data[i] = 255; maskImgData.data[i + 1] = 255; maskImgData.data[i + 2] = 255; maskImgData.data[i + 3] = 255;
                } else {
                    maskImgData.data[i] = 0; maskImgData.data[i + 1] = 0; maskImgData.data[i + 2] = 0; maskImgData.data[i + 3] = 255;
                }
            }
            maskCtx.putImageData(maskImgData, 0, 0);
            return maskCanvas;
        }

        async function processHealing() {
            if (!healingOriginalFile || healingMaskHistory.length <= 1) {
                const el = document.getElementById('healingError');
                el.textContent = 'Please paint over the area you want to remove first!';
                el.style.display = 'block';
                return;
            }
            const errEl = document.getElementById('healingError');
            const loadingEl = document.getElementById('healingLoading');
            const processBtn = document.getElementById('healingProcessBtn');
            const downloadBtn = document.getElementById('healingDownloadBtn');
            const resultContainer = document.getElementById('healingResultContainer');
            errEl.style.display = 'none';
            loadingEl.style.display = 'block';
            processBtn.disabled = true;
            resultContainer.style.display = 'none';
            downloadBtn.style.display = 'none';
            try {
                const user = firebase.auth().currentUser;
                if (!user) throw new Error('Please login first');
                const idToken = await user.getIdToken();
                const maskCanvas = _generateMaskFromCanvas();

                // Keep original image dimensions
                const origW = healingOriginalImage.naturalWidth || healingOriginalImage.width;
                const origH = healingOriginalImage.naturalHeight || healingOriginalImage.height;

                // Scale mask back up to original size
                const fullMaskCanvas = document.createElement('canvas');
                fullMaskCanvas.width = origW;
                fullMaskCanvas.height = origH;
                const fullMaskCtx = fullMaskCanvas.getContext('2d');
                fullMaskCtx.imageSmoothingEnabled = false; // Important for hard edges
                fullMaskCtx.drawImage(maskCanvas, 0, 0, origW, origH);

                // Draw original unscaled image to a canvas
                const fullImgCanvas = document.createElement('canvas');
                fullImgCanvas.width = origW;
                fullImgCanvas.height = origH;
                fullImgCanvas.getContext('2d').drawImage(healingOriginalImage, 0, 0, origW, origH);

                const imageBlob = await new Promise(r => fullImgCanvas.toBlob(r, 'image/png'));
                const maskBlob = await new Promise(r => fullMaskCanvas.toBlob(r, 'image/png'));
                const formData = new FormData();
                formData.append('image_file', imageBlob, 'image.png');
                formData.append('mask_file', maskBlob, 'mask.png');
                const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/clipdrop/cleanup', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + idToken },
                    body: formData
                });
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || 'Healing failed (' + response.status + ')');
                }
                const blob = await response.blob();
                document.getElementById('healingResultImg').src = URL.createObjectURL(blob);
                resultContainer.style.display = 'block';
                downloadBtn.style.display = 'flex';
            } catch (err) {
                errEl.textContent = err.message;
                errEl.style.display = 'block';
            } finally {
                loadingEl.style.display = 'none';
                processBtn.disabled = false;
            }
        }

        // --- 🤖 AUTO WATERMARK/TEXT REMOVAL FUNCTION ---
        async function processAutoTextRemoval() {
            if (!healingOriginalFile) {
                const el = document.getElementById('healingError');
                el.textContent = 'Please load an image first!';
                el.style.display = 'block';
                return;
            }
            const errEl = document.getElementById('healingError');
            const loadingEl = document.getElementById('healingLoading');
            const processBtn = document.getElementById('healingProcessBtn');
            const autoBtn = document.getElementById('healingAutoTextBtn');
            const noiseBlurBtn = document.getElementById('healingNoiseBlurBtn');
            const downloadBtn = document.getElementById('healingDownloadBtn');
            const resultContainer = document.getElementById('healingResultContainer');

            errEl.style.display = 'none';
            loadingEl.style.display = 'block';
            loadingEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Auto-detecting & removing watermarks...';
            processBtn.disabled = true;
            if (autoBtn) autoBtn.disabled = true;
            if (noiseBlurBtn) noiseBlurBtn.disabled = true;
            resultContainer.style.display = 'none';
            downloadBtn.style.display = 'none';

            try {
                const user = firebase.auth().currentUser;
                if (!user) throw new Error('Please login first');
                const idToken = await user.getIdToken();

                const origW = healingOriginalImage.naturalWidth || healingOriginalImage.width;
                const origH = healingOriginalImage.naturalHeight || healingOriginalImage.height;

                // মূল ইমেজের রেজোলিউশন বজায় রাখতে ক্যানভাস অঙ্কন
                const fullImgCanvas = document.createElement('canvas');
                fullImgCanvas.width = origW;
                fullImgCanvas.height = origH;
                fullImgCanvas.getContext('2d').drawImage(healingOriginalImage, 0, 0, origW, origH);

                const imageBlob = await new Promise(r => fullImgCanvas.toBlob(r, 'image/jpeg', 0.9));
                const formData = new FormData();
                formData.append('image_file', imageBlob, 'image.jpg');

                // আমাদের নতুন তৈরি করা ক্লাউডফ্লেয়ার ওয়ার্কার এন্ডপয়েন্টে কল করা
                const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/clipdrop/remove-text', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + idToken },
                    body: formData
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || 'Auto watermark removal failed (' + response.status + ')');
                }

                const blob = await response.blob();
                document.getElementById('healingResultImg').src = URL.createObjectURL(blob);
                resultContainer.style.display = 'block';
                downloadBtn.style.display = 'flex';

            } catch (err) {
                errEl.textContent = err.message;
                errEl.style.display = 'block';
            } finally {
                loadingEl.style.display = 'none';
                processBtn.disabled = false;
                if (autoBtn) autoBtn.disabled = false;
                if (noiseBlurBtn) noiseBlurBtn.disabled = false;
                // লোডিং টেক্সটকে ডিফল্ট অবস্থায় ফিরিয়ে আনা
                loadingEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AI is healing your image...';
            }
        }

        // --- 🔍 AI IMAGE HEALING ZOOM ENGINE ---
        window.healingZoomLevel = 100; // ডিফল্ট জুম ১০০%

        window.adjustHealingZoom = function (amount) {
            const canvas = document.getElementById('healingCanvas');
            const zoomLabel = document.getElementById('healingZoomVal');
            if (!canvas || !zoomLabel) return;

            // জুম রেঞ্জ ১০০% থেকে ৪০০% এর মধ্যে সীমাবদ্ধ
            window.healingZoomLevel = Math.max(100, Math.min(400, window.healingZoomLevel + amount));
            zoomLabel.textContent = window.healingZoomLevel + '%';

            const scale = window.healingZoomLevel / 100;

            // অরিজিনাল ক্যানভাস সাইজ রিড করে বড় করা
            const originalW = canvas.dataset.originalWidth ? parseFloat(canvas.dataset.originalWidth) : canvas.width;
            const originalH = canvas.dataset.originalHeight ? parseFloat(canvas.dataset.originalHeight) : canvas.height;

            canvas.style.width = (originalW * scale) + 'px';
            canvas.style.height = (originalH * scale) + 'px';
        };

        window.resetHealingZoom = function () {
            const canvas = document.getElementById('healingCanvas');
            const zoomLabel = document.getElementById('healingZoomVal');
            if (!canvas || !zoomLabel) return;

            window.healingZoomLevel = 100;
            zoomLabel.textContent = '100%';

            const originalW = canvas.dataset.originalWidth ? parseFloat(canvas.dataset.originalWidth) : canvas.width;
            const originalH = canvas.dataset.originalHeight ? parseFloat(canvas.dataset.originalHeight) : canvas.height;

            canvas.style.width = originalW + 'px';
            canvas.style.height = originalH + 'px';
        };

        function downloadHealedImage() {
            const img = document.getElementById('healingResultImg');
            if (!img.src) return;
            const a = document.createElement('a');
            a.href = img.src;
            a.download = 'healed_' + (healingOriginalFile ? healingOriginalFile.name : 'image.png');
            a.click();
        }

        async function processNoiseBlurFix() {
            if (!healingOriginalFile) {
                const el = document.getElementById('healingError');
                el.textContent = 'Please load an image first!';
                el.style.display = 'block';
                return;
            }
            const errEl = document.getElementById('healingError');
            const loadingEl = document.getElementById('healingLoading');
            const processBtn = document.getElementById('healingProcessBtn');
            const noiseBlurBtn = document.getElementById('healingNoiseBlurBtn');
            const downloadBtn = document.getElementById('healingDownloadBtn');
            const resultContainer = document.getElementById('healingResultContainer');

            errEl.style.display = 'none';
            loadingEl.style.display = 'block';
            loadingEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enhancing & Denoising Subject...';
            processBtn.disabled = true;
            if (noiseBlurBtn) noiseBlurBtn.disabled = true;
            resultContainer.style.display = 'none';
            downloadBtn.style.display = 'none';

            try {
                const user = firebase.auth().currentUser;
                if (!user) throw new Error('Please login first');
                const idToken = await user.getIdToken();

                const origW = healingOriginalImage.naturalWidth || healingOriginalImage.width;
                const origH = healingOriginalImage.naturalHeight || healingOriginalImage.height;

                // Draw original unscaled image to a canvas without masks
                const fullImgCanvas = document.createElement('canvas');
                fullImgCanvas.width = origW;
                fullImgCanvas.height = origH;
                fullImgCanvas.getContext('2d').drawImage(healingOriginalImage, 0, 0, origW, origH);

                const imageBlob = await new Promise(r => fullImgCanvas.toBlob(r, 'image/jpeg', 0.9));
                const formData = new FormData();
                formData.append('image_file', imageBlob, 'image.jpg');
                // Target width for smoothing without massive scale-up to keep API happy
                let targetW = origW * 2;
                let targetH = origH * 2;
                if (targetW > 4096 || targetH > 4096) {
                    const scale = 4096 / Math.max(targetW, targetH);
                    targetW = Math.round(targetW * scale);
                    targetH = Math.round(targetH * scale);
                }

                formData.append('target_width', String(targetW));
                formData.append('target_height', String(targetH));

                const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/clipdrop/upscale', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + idToken },
                    body: formData
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || 'Enhancement failed (' + response.status + ')');
                }

                const blob = await response.blob();
                document.getElementById('healingResultImg').src = URL.createObjectURL(blob);
                resultContainer.style.display = 'block';
                downloadBtn.style.display = 'flex';
                loadingEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            } catch (err) {
                errEl.textContent = err.message;
                errEl.style.display = 'block';
                loadingEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            } finally {
                loadingEl.style.display = 'none';
                processBtn.disabled = false;
                if (noiseBlurBtn) noiseBlurBtn.disabled = false;
            }
        }

        // =====================================================
        // ========== SALES PREDICTION (AI Vision) =============
        // =====================================================
        let salesCurrentFile = null;
        let salesCurrentBase64 = null;
        let salesBatchFiles = [];

        function loadSalesImage(event) {
            const files = event.target.files;
            if (!files || files.length === 0) return;
            if (files.length === 1) {
                _initSalesPreview(files[0]);
            } else {
                _initSalesBatchPreview(files);
            }
        }

        function handleSalesDrop(event) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.style.borderColor = 'var(--border-color)';
            const files = event.dataTransfer.files;
            if (!files || files.length === 0) return;

            // Filter only images
            const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
            if (imageFiles.length === 0) return;

            if (imageFiles.length === 1) {
                _initSalesPreview(imageFiles[0]);
            } else {
                _initSalesBatchPreview(imageFiles);
            }
        }

        function _initSalesPreview(file) {
            salesCurrentFile = file;
            const reader = new FileReader();
            reader.onload = function (e) {
                salesCurrentBase64 = e.target.result.split(',')[1];
                document.getElementById('salesPreviewImg').src = e.target.result;
                document.getElementById('salesUploadArea').style.display = 'none';
                document.getElementById('salesWorkspace').style.display = 'block';
                document.getElementById('salesBatchWorkspace').style.display = 'none';
                document.getElementById('salesResultPanel').style.display = 'none';
                document.getElementById('salesError').style.display = 'none';

                const scanOverlay = document.getElementById('salesScanOverlay');
                if (scanOverlay) scanOverlay.style.display = 'none';
            };
            reader.readAsDataURL(file);
        }

        function _initSalesBatchPreview(files) {
            document.getElementById('salesUploadArea').style.display = 'none';
            document.getElementById('salesWorkspace').style.display = 'none';
            document.getElementById('salesBatchWorkspace').style.display = 'block';

            const grid = document.getElementById('salesBatchGrid');
            grid.innerHTML = '';
            salesBatchFiles = [];

            document.getElementById('salesBatchCount').textContent = '0/' + files.length;
            document.getElementById('salesAnalyzeBatchBtn').disabled = false;

            Array.from(files).forEach((file, index) => {
                const id = 'sales_batch_' + index;
                const batchItem = { file: file, base64: null, status: 'pending', id: id };
                salesBatchFiles.push(batchItem);

                const reader = new FileReader();
                reader.onload = function (e) {
                    batchItem.base64 = e.target.result.split(',')[1];
                    const imgData = e.target.result;

                    const card = document.createElement('div');
                    card.id = id;
                    card.style = 'display:flex; background:var(--bg-input); border:1px solid var(--border-color); border-radius:12px; overflow:hidden; min-height:120px;';
                    card.innerHTML = `
                        <div style="width:120px; min-width:120px; background:var(--bg-tertiary); display:flex; align-items:center; justify-content:center; border-right:1px solid var(--border-color); position:relative; overflow:hidden;">
                       <img loading='lazy' src="${imgData}" style="max-width:100%; max-height:120px; object-fit:contain; position:relative; z-index:1;" />
                          <div id="${id}_scanOverlay" class="sales-scan-overlay" style="display:none; z-index:2;">
                             <div class="sales-scan-line"></div>
                          </div>
                        </div>
                        <div style="flex:1; padding:12px 16px; display:flex; flex-direction:column; justify-content:center;">
                            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                                <span style="font-weight:600; color:var(--text-primary); font-size:0.9em; word-break:break-all;">${file.name}</span>
                                <span id="${id}_status" style="font-size:0.8em; padding:2px 8px; border-radius:12px; background:rgba(139,92,246,0.1); color:#8B5CF6;">Pending</span>
                            </div>
                            <div id="${id}_result" style="display:none; flex-direction:column; gap:8px;">
                                <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:0.85em;">
                                    <span style="background:rgba(16,185,129,0.1); color:#10B981; padding:2px 8px; border-radius:4px;">Prob: <span id="${id}_prob" style="font-weight:bold;">--</span></span>
                                    <span style="background:rgba(245,158,11,0.1); color:#F59E0B; padding:2px 8px; border-radius:4px;">Demand: <span id="${id}_demand" style="font-weight:bold;">--</span></span>
                                    <span style="background:rgba(239,68,68,0.1); color:#EF4444; padding:2px 8px; border-radius:4px;">Comp: <span id="${id}_comp" style="font-weight:bold;">--</span></span>
                                    <span style="background:rgba(59,130,246,0.1); color:#3B82F6; padding:2px 8px; border-radius:4px;">Trend: <span id="${id}_trend" style="font-weight:bold;">--</span></span>
                                </div>
                                <div style="font-size:0.8em; color:var(--text-secondary); margin-top:4px;">
                                    <div><strong>Platforms:</strong> <span id="${id}_platforms">--</span></div>
                                    <div style="margin-top:4px;"><strong>Strengths:</strong> <span id="${id}_strengths">--</span></div>
                                </div>
                            </div>
                            <div id="${id}_error" style="display:none; color:#EF4444; font-size:0.85em; margin-top:8px;"></div>
                        </div>
                    `;
                    grid.appendChild(card);
                };
                reader.readAsDataURL(file);
            });
        }

        function changeSalesImage() {
            document.getElementById('salesWorkspace').style.display = 'none';
            document.getElementById('salesBatchWorkspace').style.display = 'none';
            document.getElementById('salesUploadArea').style.display = 'block';
            document.getElementById('salesFileInput').value = '';
            salesCurrentFile = null;
            salesCurrentBase64 = null;
            salesBatchFiles = [];
        }

        async function analyzeSalesPotential() {
            if (!salesCurrentFile || !salesCurrentBase64) return;
            const loadingEl = document.getElementById('salesLoading');
            const errEl = document.getElementById('salesError');
            const resultPanel = document.getElementById('salesResultPanel');
            const analyzeBtn = document.getElementById('salesAnalyzeBtn');
            const scanOverlay = document.getElementById('salesScanOverlay');
            errEl.style.display = 'none';
            loadingEl.style.display = 'block';
            resultPanel.style.display = 'none';
            analyzeBtn.disabled = true;

            if (scanOverlay) scanOverlay.style.display = 'block';

            try {
                const user = firebase.auth().currentUser;
                if (!user) throw new Error('Please login first');
                const idToken = await user.getIdToken();
                const prompt = 'You are a stock photography market analyst AI. Analyze this image and predict its commercial potential on stock photography platforms. Return ONLY a valid JSON object with these fields: {"salesProbability": (number 0-100), "demandLevel": ("high"/"medium"/"low"), "trendingScore": (number 0-100), "bestPlatforms": ["list of 2-4 platforms"], "bestCategories": ["list of 3-5 categories"], "strengths": ["list of 2-4 strengths"], "weaknesses": ["list of 1-3 weaknesses"], "tips": ["list of 2-4 improvement tips"], "estimatedMonthlyDownloads": "range like 5-15", "competitionLevel": ("high"/"medium"/"low")}. Be realistic. Consider composition, lighting, subject, commercial appeal, uniqueness, and current trends. Return ONLY valid JSON.';
                const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                    body: JSON.stringify({ action: 'sales-prediction', image: salesCurrentBase64, mimeType: salesCurrentFile.type, prompt: prompt, email: user.email || '', provider: 'groq' })
                });
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || 'Analysis failed (' + response.status + ')');
                }
                const data = await response.json();
                let text = data.text || '';
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (!jsonMatch) throw new Error('Invalid AI response format');
                const result = JSON.parse(jsonMatch[0]);
                _renderSalesPrediction(result);
                resultPanel.style.display = 'block';
            } catch (err) {
                errEl.textContent = err.message;
                errEl.style.display = 'block';
            } finally {
                loadingEl.style.display = 'none';
                analyzeBtn.disabled = false;
                if (scanOverlay) scanOverlay.style.display = 'none';
            }
        }

        function _renderSalesPrediction(data) {
            const prob = Math.min(100, Math.max(0, data.salesProbability || 0));
            const gv = document.getElementById('salesGaugeValue');
            gv.textContent = prob + '%';
            gv.style.color = prob >= 70 ? '#10B981' : prob >= 40 ? '#F59E0B' : '#EF4444';
            setTimeout(() => { document.getElementById('salesGaugeFill').style.width = prob + '%'; }, 100);

            const demandEl = document.getElementById('salesDemandBadge');
            const demand = (data.demandLevel || 'medium').toLowerCase();
            demandEl.textContent = demand === 'high' ? '🟢 High' : demand === 'medium' ? '🟡 Medium' : '🔴 Low';
            demandEl.style.color = demand === 'high' ? '#10B981' : demand === 'medium' ? '#F59E0B' : '#EF4444';

            const compEl = document.getElementById('salesCompetitionBadge');
            const comp = (data.competitionLevel || 'medium').toLowerCase();
            compEl.textContent = comp === 'high' ? '🔴 High' : comp === 'medium' ? '🟡 Medium' : '🟢 Low';
            compEl.style.color = comp === 'high' ? '#EF4444' : comp === 'medium' ? '#F59E0B' : '#10B981';

            document.getElementById('salesTrendingScore').textContent = (data.trendingScore || 0) + '/100';
            document.getElementById('salesEstDownloads').textContent = data.estimatedMonthlyDownloads || '—';

            document.getElementById('salesPlatforms').innerHTML = (data.bestPlatforms || []).map(p =>
                '<span style="background:rgba(59,130,246,0.15);color:#3B82F6;padding:4px 10px;border-radius:20px;font-size:0.85em;font-weight:600;">' + p + '</span>'
            ).join('');

            document.getElementById('salesCategories').innerHTML = (data.bestCategories || []).map(c =>
                '<span style="background:rgba(139,92,246,0.15);color:#8B5CF6;padding:4px 10px;border-radius:20px;font-size:0.85em;font-weight:600;">' + c + '</span>'
            ).join('');

            document.getElementById('salesStrengths').innerHTML = (data.strengths || []).map(s =>
                '<li style="padding:4px 0;border-bottom:1px solid rgba(16,185,129,0.1);">✅ ' + s + '</li>'
            ).join('');

            document.getElementById('salesTips').innerHTML = (data.tips || []).map(t =>
                '<li style="padding:4px 0;border-bottom:1px solid rgba(249,115,22,0.1);">💡 ' + t + '</li>'
            ).join('');
        }

        async function analyzeSalesBatch() {
            if (salesBatchFiles.length === 0) return;
            const analyzeBtn = document.getElementById('salesAnalyzeBatchBtn');
            analyzeBtn.disabled = true;

            const user = firebase.auth().currentUser;
            if (!user) {
                alert('Please login first');
                analyzeBtn.disabled = false;
                return;
            }
            const idToken = await user.getIdToken();
            const prompt = 'You are a stock photography market analyst AI. Analyze this image and predict its commercial potential on stock photography platforms. Return ONLY a valid JSON object with these fields: {"salesProbability": (number 0-100), "demandLevel": ("high"/"medium"/"low"), "trendingScore": (number 0-100), "bestPlatforms": ["list of 2-4 platforms"], "bestCategories": ["list of 3-5 categories"], "strengths": ["list of 2-4 strengths"], "weaknesses": ["list of 1-3 weaknesses"], "tips": ["list of 2-4 improvement tips"], "estimatedMonthlyDownloads": "range like 5-15", "competitionLevel": ("high"/"medium"/"low")}. Be realistic. Consider composition, lighting, subject, commercial appeal, uniqueness, and current trends. Return ONLY valid JSON.';

            let count = 0;
            // Update initial count for already processed ones just in case
            count = salesBatchFiles.filter(item => item.status === 'success').length;

            for (const item of salesBatchFiles) {
                if (item.status === 'success') {
                    continue; // Skip already successful ones
                }

                const statusEl = document.getElementById(item.id + '_status');
                const errEl = document.getElementById(item.id + '_error');
                const resEl = document.getElementById(item.id + '_result');
                const scanOverlay = document.getElementById(item.id + '_scanOverlay');

                statusEl.textContent = 'Processing...';
                statusEl.style.background = 'rgba(59,130,246,0.1)';
                statusEl.style.color = '#3B82F6';
                errEl.style.display = 'none';

                if (scanOverlay) scanOverlay.style.display = 'block';

                try {
                    while (!item.base64) {
                        await new Promise(r => setTimeout(r, 100)); // wait for base64 if still reading
                    }

                    const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                        body: JSON.stringify({ action: 'sales-prediction', image: item.base64, mimeType: item.file.type, prompt: prompt, email: user.email || '', provider: 'groq' })
                    });

                    if (!response.ok) {
                        const errData = await response.json().catch(() => ({}));
                        throw new Error(errData.error || 'Request Failed');
                    }

                    const data = await response.json();
                    let text = data.text || '';
                    const jsonMatch = text.match(/\{[\s\S]*\}/);
                    if (!jsonMatch) throw new Error('Invalid AI response format');
                    const result = JSON.parse(jsonMatch[0]);

                    // Render
                    resEl.style.display = 'flex';
                    document.getElementById(item.id + '_prob').textContent = result.salesProbability + '%';
                    document.getElementById(item.id + '_demand').textContent = (result.demandLevel || '').toUpperCase();
                    document.getElementById(item.id + '_comp').textContent = (result.competitionLevel || '').toUpperCase();
                    document.getElementById(item.id + '_trend').textContent = result.trendingScore;
                    document.getElementById(item.id + '_platforms').textContent = (result.bestPlatforms || []).join(', ');
                    document.getElementById(item.id + '_strengths').textContent = (result.strengths || []).join(', ');

                    item.status = 'success';
                    statusEl.textContent = 'Done';
                    statusEl.style.background = 'rgba(16,185,129,0.1)';
                    statusEl.style.color = '#10B981';
                    count++;
                    document.getElementById('salesBatchCount').textContent = count + '/' + salesBatchFiles.length;

                } catch (err) {
                    item.status = 'error';
                    statusEl.textContent = 'Error';
                    statusEl.style.background = 'rgba(239,68,68,0.1)';
                    statusEl.style.color = '#EF4444';
                    errEl.textContent = err.message;
                    errEl.style.display = 'block';
                } finally {
                    if (scanOverlay) scanOverlay.style.display = 'none';
                }
            }

            analyzeBtn.disabled = false;
        }


        window.sendToHealing = function (cardId, issueIdx = null) {
            const fileData = uploadedFilesData.find(f => f.id === cardId);
            if (!fileData) {
                alert("Image data not found!");
                return;
            }

            const healingModeBtn = document.querySelector('.mode-button[data-section="healing"]');
            if (healingModeBtn) {
                healingModeBtn.click();
            }

            const fileToProcess = fileData.previewFile || fileData.fileObject;

            const badge = document.getElementById(`quality-badge-${cardId}`);
            let regions = [];
            if (badge && badge.dataset.results) {
                try {
                    const results = JSON.parse(badge.dataset.results);
                    const issues = results.issues || [];
                    if (issueIdx !== null && issues[issueIdx]) {
                        if (issues[issueIdx].regions) {
                            regions = issues[issueIdx].regions;
                        }
                    } else {
                        issues.forEach(issue => {
                            if (issue.regions && Array.isArray(issue.regions)) {
                                regions = regions.concat(issue.regions);
                            }
                        });
                    }
                } catch (e) {
                    console.error("Error reading regions:", e);
                }
            }

            if (typeof _initHealingCanvas === 'function') {
                _initHealingCanvas(fileToProcess, regions);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                console.error("Healing function not found!");
            }
        };

        // --- Dynamic Real-time AI Trend Forecasting ---
async function loadRealTimeTrends() {
    const container = document.getElementById('liveTrendsContainer');
    if (!container) return;

    // এপিআই কল করার সময় স্পিনার দেখানোর জন্য রিসেট করা
    container.innerHTML = `
        <span class="image-spinner" style="display:inline-block; width:18px; height:18px; border-width:2px; margin:0;"></span>
        <span style="color: var(--text-muted); font-size: 0.85em; margin-left: 8px;">Fetching Freepik style latest trends...</span>
    `;

    try {
        const user = auth.currentUser;
        const accessToken = user ? await user.getIdToken() : "";

        // ব্যাকএন্ড ক্লাউডফ্লেয়ার ওয়ার্কারের এপিআই এন্ডপয়েন্ট
        const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + accessToken
            },
            body: JSON.stringify({
                action: 'trending',
                prompt: 'Act as a Freepik and microstock trend analyst. Generate 40 highly specific, unique, and current commercial search trends (similar to "Punk Grunge Revival", "Digital Fatigue", "Anxiety Grounding", "Analog Hobbies"). Do NOT return generic broad terms like "business", "technology", or "sustainability". Return strictly as a comma-separated list. Do not use quotes or special characters.',
                email: user ? user.email : 'guest'
            })
        });

        if (!response.ok) throw new Error('API offline');
        const data = await response.json();

        let text = data.text || data.metadata || "";

        let trends = text.split(',')
            .map(t => t.replace(/[\n\r]/g, ' ').replace(/["']/g, '').trim())
            .filter(t => t.length > 2);

        if (trends.length === 0) throw new Error('Empty data');

        container.innerHTML = trends.map(topic => `
            <span class="meta-keyword-pill" onclick="openTrendPromptModal('${topic}')" style="background: rgba(139,92,246,0.08); border: 1px solid rgba(139,92,246,0.2); color: #8B5CF6; padding: 6px 12px; border-radius: 20px; font-size: 0.8em; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: background 0.2s;" onmouseover="this.style.background='rgba(139,92,246,0.15)'" onmouseout="this.style.background='rgba(139,92,246,0.08)'">
                <i class="fas fa-chart-line" style="font-size:0.85em;"></i> ${topic}
            </span>
        `).join('');

    } catch (e) {
        console.warn("Real-time trends API fallback triggered:", e);
        const fallbackTrends = ["Punk Grunge Revival", "Digital Fatigue", "Anxiety Grounding", "Analog Hobbies", "Corporate Memphis", "Y2K Nostalgia"];
        container.innerHTML = fallbackTrends.map(topic => `
            <span class="meta-keyword-pill" onclick="openTrendPromptModal('${topic}')" style="background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 6px 12px; border-radius: 20px; font-size: 0.8em; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;" onmouseover="this.style.borderColor='var(--accent-orange)'" onmouseout="this.style.borderColor='var(--border-color)'">
                <i class="fas fa-chart-line" style="color: var(--accent-orange); font-size:0.85em;"></i> ${topic}
            </span>
        `).join('');
    }
}

async function openTrendPromptModal(topic) {
    const modal = document.getElementById('trendPromptModal');
    const title = document.getElementById('trendPromptTitle');
    const list = document.getElementById('trendPromptList');

    title.innerHTML = '<i class="fas fa-magic"></i> Prompts for: ' + topic;
    list.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <div class="image-spinner" style="display:inline-block; width:30px; height:30px; border-width:3px; margin:0 auto 15px auto;"></div>
            <p style="color: var(--text-muted);">AI is crafting high-converting ultra-detailed prompts...</p>
        </div>
    `;

    modal.style.display = 'flex';

    try {
        const user = auth.currentUser;
        const accessToken = user ? await user.getIdToken() : "";

        const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + accessToken
            },
            body: JSON.stringify({
                action: 'trending',
                // [UPDATED] - প্রম্পটটি অত্যন্ত বিস্তারিত, লং এবং আল্ট্রা-হাই ডিটেইল প্রম্পট পাওয়ার জন্য পুনর্গঠন করা হলো
                prompt: `Act as a world-class AI Image Generation Prompt Engineer (Midjourney v6, DALL-E 3, Stable Diffusion XL). 
Generate exactly 5 ULTRA-DETAILED, COMPREHENSIVE, and HIGHLY SPECIFIC prompts for the trend concept: "${topic}".

CRITICAL REQUIREMENTS FOR EACH PROMPT:
1. Length: Each prompt MUST be at least 60-90 words long. Avoid short 2-line summaries!
2. Detailed Breakdown: You MUST include rich details about:
   - Subject & Focal Point: Highly detailed visual specs, character/object attributes, clothing, textures, expression, action.
   - Environment & Atmosphere: Intricate background elements, surroundings, mood, weather, spatial depth.
   - Cinematic Lighting & Shadow: Volumetric lighting, ray-tracing, golden hour/cinematic neon/soft shadows, reflections.
   - Photography & Technical Details: Exact camera specifications (e.g., shot on 85mm f/1.4 lens, Hasselblad H6D, macro photography, wide-angle cinematic shot, Kodak Portra 400 film grain).
   - Render & Aesthetic Polish: Masterpiece quality, photorealistic, 8k resolution, Unreal Engine 5 render style, hyper-detailed textures, vibrant color grading.

OUTPUT FORMAT REQUIREMENTS:
Return ONLY a valid JSON object containing a "prompts" array of strings. 
Example JSON structure:
{
  "prompts": [
    "A breathtaking high-fashion commercial portrait embodying '${topic}', focusing on a stylized character with intricate cyberpunk line patterns on skin, wearing reflective metallic silk garments. Set against an atmospheric foggy dystopian city backdrop illuminated by moody purple and teal neon lighting. Captured using a Hasselblad medium format camera with an 85mm f/1.2 lens, showcasing deep depth of field, natural bokeh, 8k resolution, cinematic ray-traced reflections, Unreal Engine 5 visual style, award-winning photorealism.",
    "..."
  ]
}
Strictly NO intro text, NO markdown code blocks (\`\`\`json), NO explanatory chatter. Output ONLY raw JSON.`,
                email: user ? user.email : 'guest'
            })
        });

        if (!response.ok) throw new Error('API failed');
        const data = await response.json();

        // --- 📊 Log Activity ---
        if (user) {
            logActivity('Live Trend Analysis', {
                keyword: topic,
                result: '5 Detailed Prompts Generated'
            });
        }

        let text = data.text || data.metadata || "";
        let prompts = [];

        // JSON Parsing (Robust Method)
        try {
            let cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
            let startIdx = cleanText.indexOf('{');
            let endIdx = cleanText.lastIndexOf('}');
            if (startIdx !== -1 && endIdx !== -1) {
                let parsed = JSON.parse(cleanText.substring(startIdx, endIdx + 1));
                if (parsed.prompts && Array.isArray(parsed.prompts)) {
                    prompts = parsed.prompts;
                } else if (Array.isArray(parsed)) {
                    prompts = parsed;
                }
            }
        } catch (e) {
            console.warn("Trend prompt JSON parsing failed, using regex fallback.");
        }

        // Fallback: যদি JSON পার্স করতে সমস্যা হয়
        if (!Array.isArray(prompts) || prompts.length === 0) {
            prompts = text.split(/(?:\d+\.|\n-|\n\*)/)
                .map(line => line.replace(/\*\*/g, '').trim())
                .filter(line => line.length > 30);
        }

        title.innerHTML = '<i class="fas fa-magic"></i> ' + topic + " Detailed Prompts";
        var cardsHtml = '';

        prompts.forEach(function (p, i) {
            var promptText = p.trim();
            var safeText = promptText.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            var htmlFormattedText = safeText.replace(/\n/g, '<br>');

            cardsHtml += '<div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 10px;">'
                + '<span style="font-size: 0.75em; font-weight: 700; color: var(--accent-orange); text-transform: uppercase;">Prompt ' + (i + 1) + ' (Ultra-Detailed)</span>'
                + '<p style="color: var(--text-primary); font-size: 0.88em; margin: 0; line-height: 1.6; text-align: justify;">' + htmlFormattedText + '</p>'
                + '<div style="text-align: right;">'
                + '<button onclick="copyTrendPrompt(this)" data-prompt="' + safeText + '" style="background: rgba(139,92,246,0.1); color: #8B5CF6; border: 1px solid rgba(139,92,246,0.3); padding: 6px 14px; border-radius: 6px; font-size: 0.8em; font-weight: 600; cursor: pointer; transition: all 0.2s;">'
                + '<i class="fas fa-copy"></i> Copy Prompt</button>'
                + '</div></div>';
        });

        list.innerHTML = cardsHtml;

        if (prompts.length === 0) {
            list.innerHTML = '<p style="color: var(--text-muted); text-align:center;">Could not generate prompts. Please try again.</p>';
        }
    } catch (e) {
        console.error("Trend Prompt Error:", e);
        title.innerHTML = "Error";
        list.innerHTML = '<p style="color: #EF4444; text-align:center;">Error generating prompts. Please try again.</p>';
    }
}

        function copyTrendPrompt(btn) {
            var text = btn.getAttribute('data-prompt');
            // decode HTML entities for clipboard
            var ta = document.createElement('textarea');
            ta.innerHTML = text;
            navigator.clipboard.writeText(ta.value);
            var orig = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Copied';
            setTimeout(function () { btn.innerHTML = orig; }, 2000);
        }

        function closeTrendPromptModal() {
            document.getElementById('trendPromptModal').style.display = 'none';
        }

        // --- Smart Folder Watcher Logic (Premium) ---
        document.addEventListener("DOMContentLoaded", () => {
            const smartWatcherBtn = document.getElementById('smartWatcherBtn');
            const smartWatcherPanel = document.getElementById('smartWatcherPanel');
            const stopWatcherBtn = document.getElementById('stopWatcherBtn');
            const watcherDirName = document.getElementById('watcherDirName');
            const watcherProcessedCount = document.getElementById('watcherProcessedCount');
            const watcherStatusLog = document.getElementById('watcherStatusLog');

            let watcherInterval = null;
            let processedFilesCache = new Set();
            let watcherDirHandle = null;
            let isProcessing = false;
            let processedCount = 0;

            function logWatcherMsg(msg) {
                const div = document.createElement('div');
                div.textContent = msg;
                watcherStatusLog.appendChild(div);
                watcherStatusLog.scrollTop = watcherStatusLog.scrollHeight;
            }

            async function processNewFile(fileHandle, parentDir) {
                try {
                    const file = await fileHandle.getFile();
                    const fileNameLower = file.name.toLowerCase();
                    const isSvg = fileNameLower.endsWith('.svg');
                    const isEps = fileNameLower.endsWith('.eps');
                    const isImage = fileNameLower.match(/\.(jpg|jpeg|png|webp)$/i);

                    if (!isSvg && !isEps && !isImage) return;
                    if (file.name.includes('_metagen_')) return;

                    logWatcherMsg(`Found new: ${file.name}`);

                    let base64Image = '';
                    let mimeType = file.type || 'image/jpeg';

                    if (isEps) {
                        logWatcherMsg(`Extracting preview for EPS...`);
                        const formData = new FormData();
                        formData.append('file', file);
                        const res = await fetch(`https://metagen-eps-server.onrender.com/api/extract-eps`, {
                            method: 'POST',
                            body: formData
                        });
                        const data = await res.json();
                        if (data.success) {
                            base64Image = data.base64;
                            mimeType = 'image/jpeg';
                        } else {
                            throw new Error("Failed to extract EPS preview");
                        }
                    } else if (isSvg) {
                        const pngDataUrl = await window.svgFileToPngDataUrl(file, 512, 512);
                        base64Image = pngDataUrl.split(',')[1];
                        mimeType = 'image/png';
                    } else {
                        const MAX_DIMENSION = 800;
                        base64Image = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                const img = new Image();
                                img.onload = () => {
                                    let width = img.width;
                                    let height = img.height;
                                    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                                        if (width > height) { height *= MAX_DIMENSION / width; width = MAX_DIMENSION; }
                                        else { width *= MAX_DIMENSION / height; height = MAX_DIMENSION; }
                                        const canvas = document.createElement('canvas');
                                        canvas.width = width; canvas.height = height;
                                        const ctx = canvas.getContext('2d');
                                        ctx.drawImage(img, 0, 0, width, height);
                                        resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
                                    } else {
                                        resolve(e.target.result.split(',')[1]);
                                    }
                                };
                                img.onerror = reject;
                                img.src = e.target.result;
                            };
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                        });
                    }

                    logWatcherMsg(`Generating Metadata via AI...`);
                    const plan = (window.userUsageData && window.userUsageData.plan) ? window.userUsageData.plan : 'free';
                    const email = (window.userUsageData && window.userUsageData.email) ? window.userUsageData.email : 'unknown';
                    const token = auth && auth.currentUser ? await auth.currentUser.getIdToken() : '';

                    const vectorInstruction = (isSvg || isEps) ? `\n\nIMPORTANT - VECTOR MODE:\n- This is a vector illustration or logo.\n- Keywords MUST include: "vector illustration", "eps", "svg".` : '';
                    const promptText = `Analyze this image and generate stock photography metadata. Format strictly as JSON with keys: "title", "description", "keywords".\n- Title: A stock photo title between 10 and 20 words.\n- Description: Description between 30 and 50 words.\n- Keywords: CSV string of 35 to 45 SEO-friendly keywords.${vectorInstruction}`;

                    const response = await fetch("https://metagen-pro-api.metagenp.workers.dev/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                        body: JSON.stringify({ action: "generate", image: base64Image, mimeType: mimeType, prompt: promptText, provider: 'groq', email: email, plan: plan })
                    });

                    if (!response.ok) throw new Error("API failed: " + response.statusText);
                    const data = await response.json();

                    let metadataText = "";
                    if (data.metadata) metadataText = typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata);
                    else if (data.text) metadataText = data.text;
                    else if (data.candidates && data.candidates[0].content.parts[0]) metadataText = data.candidates[0].content.parts[0].text;

                    let cleanedJsonString = metadataText.replace(/^```json\s*|```$/g, '').trim();

                    // Robust JSON Parsing
                    const jsonStart = cleanedJsonString.indexOf('{');
                    const jsonEnd = cleanedJsonString.lastIndexOf('}');
                    if (jsonStart !== -1 && jsonEnd !== -1) {
                        cleanedJsonString = cleanedJsonString.substring(jsonStart, jsonEnd + 1);
                    }

                    const parsedMetadata = JSON.parse(cleanedJsonString);

                    logWatcherMsg(`Embedding Metadata...`);
                    const outDir = await parentDir.getDirectoryHandle('MetaGen_Processed', { create: true });

                    let processedBlob;
                    let newName;

                    // FIX: AI Array দিলে সেটি সেফলি String-এ কনভার্ট করে নেওয়া হচ্ছে
                    const safeKeywordsStr = Array.isArray(parsedMetadata.keywords)
                        ? parsedMetadata.keywords.join(', ')
                        : (parsedMetadata.keywords || '');

                    if (isEps) {
                        const formData = new FormData();
                        formData.append('title', parsedMetadata.title || '');
                        formData.append('description', parsedMetadata.description || '');
                        formData.append('keywords', safeKeywordsStr); // Fixed Keywords
                        formData.append('file', file);
                        const embedRes = await fetch('https://metagen-eps-server.onrender.com/api/embed-eps', {
                            method: 'POST',
                            body: formData
                        });
                        if (!embedRes.ok) throw new Error("Failed to embed EPS metadata on server.");
                        processedBlob = await embedRes.blob();
                        newName = file.name.split('.').slice(0, -1).join('.') + '_metagen_' + Date.now() + '.eps';
                    } else if (isSvg) {
                        const svgContent = await file.text();
                        const parser = new DOMParser();
                        const xmlDoc = parser.parseFromString(svgContent, "image/svg+xml");
                        const svgRoot = xmlDoc.documentElement;

                        let titleNode = svgRoot.querySelector("title");
                        if (!titleNode) { titleNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "title"); svgRoot.insertBefore(titleNode, svgRoot.firstChild); }
                        titleNode.textContent = parsedMetadata.title || "";

                        let descNode = svgRoot.querySelector("desc");
                        if (!descNode) { descNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "desc"); svgRoot.insertBefore(descNode, titleNode.nextSibling); }
                        descNode.textContent = parsedMetadata.description || "";

                        const oldMetadata = svgRoot.querySelectorAll("metadata");
                        oldMetadata.forEach(el => el.remove());

                        let metadataNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "metadata");
                        metadataNode.id = "metagen-placeholder";
                        svgRoot.insertBefore(metadataNode, descNode.nextSibling);

                        const serializer = new XMLSerializer();
                        let svgString = serializer.serializeToString(xmlDoc);

                        const escapeXml = (str) => (str || "").replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;' }[c]));
                        const titleStr = escapeXml(parsedMetadata.title);
                        const descStr = escapeXml(parsedMetadata.description);

                        // FIX: Safe keyword string দিয়ে Array বানানো হচ্ছে
                        const keywordsArray = safeKeywordsStr.split(',').map(k => k.trim()).filter(Boolean);
                        const keywordsRdf = keywordsArray.map(k => `<rdf:li>${escapeXml(k)}</rdf:li>`).join('\n                                    ');

                        const xmpContent = `
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c138 79.159824, 2016/09/14-01:09:01">
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <rdf:Description rdf:about=""
            xmlns:dc="http://purl.org/dc/elements/1.1/"
            xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
            xmlns:xmp="http://ns.adobe.com/xap/1.0/">
            <dc:format>image/svg+xml</dc:format>
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
                    ${keywordsRdf}
                </rdf:Bag>
            </dc:subject>
            <photoshop:Headline>${titleStr}</photoshop:Headline>
            <photoshop:Description>${descStr}</photoshop:Description>
            <xmp:CreatorTool>MetaGen Pro Smart Watcher</xmp:CreatorTool>
        </rdf:Description>
    </rdf:RDF>
</x:xmpmeta>`;
                        const xmpWithPacket = `<metadata id="metagen-data"><?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>${xmpContent}<?xpacket end="w"?></metadata>`;

                        svgString = svgString.replace(/<metadata[^>]*id="metagen-placeholder"[^>]*>(.*?)<\/metadata>|<metadata[^>]*id="metagen-placeholder"[^>]*\/>/si, xmpWithPacket);
                        if (!svgString.startsWith('<?xml')) { svgString = '<?xml version="1.0" encoding="utf-8"?>\n' + svgString; }

                        processedBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
                        newName = file.name.split('.').slice(0, -1).join('.') + '_metagen_' + Date.now() + '.svg';
                    } else {
                        // Standard Image (JPEG) via Piexif
                        let originalImageDataUrl = await new Promise((resolve, reject) => {
                            const r = new FileReader();
                            r.onload = e => resolve(e.target.result);
                            r.onerror = reject;
                            r.readAsDataURL(file);
                        });

                        let exifObj;
                        try { exifObj = piexif.load(originalImageDataUrl); } catch (err) { exifObj = { "0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": null }; }
                        if (!exifObj["0th"]) exifObj["0th"] = {};

                        function toUTF16LE(str) {
                            const bytes = [];
                            for (let i = 0; i < str.length; i++) {
                                const code = str.charCodeAt(i);
                                bytes.push(code & 0xff); bytes.push(code >> 8);
                            }
                            bytes.push(0, 0); return bytes;
                        }

                        if (exifObj["0th"]) {
                            delete exifObj["0th"][piexif.ImageIFD.ImageDescription];
                            delete exifObj["0th"][piexif.ImageIFD.DocumentName];
                        }

                        exifObj["0th"][piexif.ImageIFD.XPTitle] = toUTF16LE(parsedMetadata.title || "");
                        exifObj["0th"][piexif.ImageIFD.XPSubject] = toUTF16LE(parsedMetadata.description || "");
                        exifObj["0th"][piexif.ImageIFD.XPComment] = toUTF16LE(parsedMetadata.description || "");
                        exifObj["0th"][piexif.ImageIFD.XPKeywords] = toUTF16LE(parsedMetadata.keywords || "");
                        exifObj["0th"][piexif.ImageIFD.XPAuthor] = toUTF16LE("MetaGen Pro Smart Watcher");

                        const exifBytes = piexif.dump(exifObj);
                        const newImageDataUrl = piexif.insert(exifBytes, originalImageDataUrl);

                        const byteString = atob(newImageDataUrl.split(',')[1]);
                        const ab = new ArrayBuffer(byteString.length);
                        const ia = new Uint8Array(ab);
                        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);

                        processedBlob = new Blob([ab], { type: 'image/jpeg' });
                        newName = file.name.split('.').slice(0, -1).join('.') + '_metagen_' + Date.now() + '.jpg';
                    }

                    const newFileHandle = await outDir.getFileHandle(newName, { create: true });
                    const writable = await newFileHandle.createWritable();
                    await writable.write(processedBlob);
                    await writable.close();

                    processedCount++;
                    watcherProcessedCount.textContent = processedCount;
                    logWatcherMsg(`Saved: ${newName}`);

                } catch (e) {
                    console.error("Smart Watcher error:", e);
                    logWatcherMsg("Error processing: " + (fileHandle ? fileHandle.name : "Unknown"));
                }
            }
            async function pollDirectory() {
                if (!watcherDirHandle || isProcessing) return;
                isProcessing = true;
                try {
                    for await (const entry of watcherDirHandle.values()) {
                        if (entry.kind === 'file' && entry.name.match(/\.(jpg|jpeg|png|webp|svg|eps)$/i)) {
                            if (!processedFilesCache.has(entry.name)) {
                                processedFilesCache.add(entry.name);
                                await processNewFile(entry, watcherDirHandle);
                            }
                        }
                    }
                } catch (e) {
                    logWatcherMsg("Polling error: " + e.message);
                    stopWatcher();
                }
                isProcessing = false;
            }

            async function startWatcher() {
                // Only allow Premium or Pro depending on platform config
                const plan = (window.userUsageData && window.userUsageData.plan) ? window.userUsageData.plan.toLowerCase() : 'free';
                if (plan !== 'premium' && plan !== 'pro') {
                    alert("Smart Folder Watcher is a Premium feature. Please upgrade your plan!");
                    if (typeof openPricingModal === 'function') openPricingModal();
                    return;
                }

                try {
                    watcherDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                    watcherDirName.textContent = watcherDirHandle.name;
                    smartWatcherPanel.style.display = 'block';
                    logWatcherMsg("Started watching directory...");

                    processedCount = 0;
                    watcherProcessedCount.textContent = "0";

                    // Initial scan
                    for await (const entry of watcherDirHandle.values()) {
                        if (entry.kind === 'file') {
                            processedFilesCache.add(entry.name);
                        }
                    }
                    logWatcherMsg(`Found ${processedFilesCache.size} existing files. Waiting for new files...`);

                    watcherInterval = setInterval(pollDirectory, 5000);
                } catch (err) {
                    console.warn(err);
                    if (err.name !== 'AbortError') {
                        alert("Error starting watcher: " + err.message);
                    }
                }
            }

            function stopWatcher() {
                if (watcherInterval) clearInterval(watcherInterval);
                watcherInterval = null;
                watcherDirHandle = null;
                smartWatcherPanel.style.display = 'none';
                processedFilesCache.clear();
                logWatcherMsg("Watcher stopped.");
            }

            if (smartWatcherBtn) smartWatcherBtn.addEventListener('click', startWatcher);
            if (stopWatcherBtn) stopWatcherBtn.addEventListener('click', stopWatcher);
        });

