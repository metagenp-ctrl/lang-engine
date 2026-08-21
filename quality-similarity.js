// MetaGen Pro - Quality & Similarity Module
document.addEventListener('DOMContentLoaded', function () {

    const previewContainer = document.getElementById('filePreviewContainer');
    const processAllButton = document.getElementById('processAllButton');
    const processAllPromptsButton = document.getElementById('processAllPromptsButton');
    const exportButton = document.getElementById('exportButton');
    const embedMetadataButton = document.getElementById('embedMetadataButton');
    const clearAllButton = document.getElementById('clearAllButton');
    if (!window.uploadedFilesData) window.uploadedFilesData = [];
    const uploadedFilesData = window.uploadedFilesData;

    // --- COPYRIGHT CHECKER FUNCTION (UPDATED FOR LLAMA 4 & PIXTRAL) ---
    window.checkCopyrightAndTrademark = async function (file, cardId) {
        const statusEl = document.getElementById(`copyright-status-${cardId}`);
        if (!statusEl) return;

        const badge = statusEl.querySelector('.copyright-badge');
        if (!badge) return;

        try {
            // 1. Check User Plan & Get Token
            const user = auth.currentUser;

            let currentPlan = 'free';


            if (user) {

                try {
                    const profileDoc = await db.collection('users').doc(user.email).get();
                    const profileData = profileDoc.exists ? profileDoc.data() : null;
                    currentPlan = (profileData?.plan || 'free').toLowerCase();
                } catch (e) { console.warn('Plan check failed:', e); }
            }

            // Stop processing if Free user (Backup check)
            if (currentPlan !== 'pro' && currentPlan !== 'premium' && currentPlan !== 'agency') {
                badge.className = 'copyright-badge copyright-warning';
                badge.innerHTML = '⚠️ Pro/Premium Only';
                return;
            }

            // 2. Resize Image & Convert to Base64 (To prevent 429 Token Limit Error)
            const MAX_DIMENSION = 800;
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        let width = img.width;
                        let height = img.height;

                        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                            if (width > height) {
                                height *= MAX_DIMENSION / width;
                                width = MAX_DIMENSION;
                            } else {
                                width *= MAX_DIMENSION / height;
                                height = MAX_DIMENSION;
                            }
                        }

                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);

                        // Convert to optimized JPEG
                        resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
                    };
                    img.onerror = reject;
                    img.src = e.target.result;
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const mimeType = "image/jpeg";

            const promptInstruction = `Act as a Trademark and Copyright Compliance Officer. 
                    Analyze this image strictly for:
                    1. Matches to Famous Logos (e.g., Nike Swoosh, Apple logo, McDonald's arches, Adidas stripes) - LOOK FOR SHAPES!
                    2. Specific Trademarked Characters (e.g., Mickey Mouse, Marvel superheroes)
                    3. Famous Brands/Text
                    4. WATERMARKS, TEXT OVERLAYS, SIGNATURES, or COPYRIGHT TOKENS (e.g., 'PixelPerfect', '@ArtistName', '© 2024')
        
                    CRITICAL: Even if it's just a simple shape (like a checkmark/swoosh), if it resembles a famous logo (like Nike), you MUST FLAG IT.
                    If ANY textual watermark or potential brand element is visible, FLAG IT.

                    Return strictly JSON: 
                    {"status": "warning", "detected": ["List items"]} OR {"status": "safe", "detected":[]}`;

            // 3. Set Proxy URL based on plan
            const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
            const accessToken = user ? await user.getIdToken() : "";

            // 4. Call Cloudflare Worker
            const response = await fetch(proxyUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    action: "copyrightCheck", // Action name for backend routing
                    prompt: promptInstruction,
                    image: base64Data,
                    mimeType: mimeType,
                    email: user?.email || "unknown"
                })
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 429) {
                    showLimitModal(data.error);
                    throw new Error("Daily limit reached");
                }
                throw new Error(`Edge API Error: ${data.error || response.statusText}`);
            }

            // 5. Parse response from Edge Function
            let jsonString = data.text || data.metadata || (data.choices && data.choices[0].message.content) || (data.candidates && data.candidates[0].content.parts[0].text) || "";

            // Clean JSON formatting
            jsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
            let result = JSON.parse(jsonString);

            if (result.status === 'safe') {
                badge.className = 'copyright-badge copyright-safe';
                badge.innerHTML = '✅ Copyright Safe';
            } else {
                badge.className = 'copyright-badge copyright-warning';
                badge.innerHTML = `⚠️ ${result.detected.join(', ') || 'Trademark Detected'} <br>
                        <button class="action-button green-button" style="margin-top:8px; width:100%; font-size:0.75em; padding:5px; border-radius:6px; cursor:pointer;" 
                        onclick="sendToHealing('${cardId}')">🩹 Heal with AI</button>`;
                const card = document.getElementById(cardId);
                if (card) card.style.borderColor = '#EF4444';
            }
        } catch (error) {
            console.error("Copyright Check Error:", error);
            badge.className = 'copyright-badge copyright-warning';
            badge.innerHTML = `⚠️ Check Failed: ${error.message}`;
        }
    }

    // --- AI IMAGE QUALITY & ARTIFACT CHECKER (PRO/PREMIUM ONLY) ---
    window.checkImageQuality = async function (fileData) {
        const cardId = fileData.id;
        const badge = document.getElementById(`quality-badge-${cardId}`);
        const reportBox = document.getElementById(`quality-report-${cardId}`);

        const scanOverlay = document.getElementById(`qualityScanOverlay-${cardId}`);

        if (!badge) return;

        try {
            // 1. Check User Plan & Get Token
            const user = auth.currentUser;

            let currentPlan = 'free';
            let accessToken = '';

            if (user) {
                accessToken = await user.getIdToken();
                try {
                    const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                    const profileData = profileDoc.exists ? profileDoc.data() : null;
                    currentPlan = (profileData?.plan || 'free').toLowerCase();
                } catch (e) { console.warn('Plan check failed', e); }
            }

            // Update UI to "Checking"
            const container = document.getElementById(`quality-status-container-${cardId}`);
            if (container) container.style.display = 'block';

            badge.className = 'quality-status-badge checking';
            badge.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';

            if (scanOverlay) scanOverlay.style.display = 'block';

            if (reportBox) {
                reportBox.style.display = 'block';
                reportBox.innerHTML = '<div class="quality-report-header">Analyzing Technical Quality...</div><div class="image-spinner" style="display:block; margin: 10px auto;"></div>';
            }

            // 2. Prepare Image (Resize if needed)
            const imageToProcess = fileData.previewFile || fileData.fileObject;
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const MAX_DIM = 1024;
                        let w = img.width, h = img.height;
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
                reader.readAsDataURL(imageToProcess);
            });

            // 3. Call Cloudflare Worker
            const qualityPrompt = `You are an expert image quality analyst for stock photography platforms. Analyze this image for technical quality issues. Check for: blur, noise/grain, compression artifacts, color banding, chromatic aberration, over/under exposure, AI-generated artifacts (extra fingers, distorted text, unnatural patterns), watermarks, logos. Return ONLY valid JSON in this exact format: {"overall_score": <0-100>, "issues": [{"type": "<issue name>", "description": "<brief description>", "severity": "<high|medium|low>", "regions": [[xmin, ymin, xmax, ymax]]}]}. If no issues found, return {"overall_score": 95, "issues": []}. The "regions" array must contain coordinate arrays [xmin, ymin, xmax, ymax] normalized from 0 to 100 indicating where each technical issue is visually located on the image. Be strict but fair.`;
            const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
            const response = await fetch(proxyUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    action: "qualityCheck",
                    prompt: qualityPrompt,
                    image: base64Data,
                    mimeType: "image/jpeg",
                    email: user?.email || "unknown"
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "API Error");

            // 4. Parse Results
            let resStr = data.text || "";
            resStr = resStr.replace(/```json/gi, '').replace(/```/g, '').trim();
            const jsonStart = resStr.indexOf('{');
            const jsonEnd = resStr.lastIndexOf('}');

            if (jsonStart !== -1 && jsonEnd !== -1) {
                resStr = resStr.substring(jsonStart, jsonEnd + 1);
            }

            let results;
            try {
                results = JSON.parse(resStr);
            } catch (parseErr) {
                console.error("Quality Check JSON Parse Error:", parseErr, "Raw Text:", resStr);
                throw new Error("AI returned invalid JSON. Please try again.");
            }

            // 5. Update UI
            updateQualityUI(cardId, results);
            return results;

        } catch (error) {
            console.error("Quality Check Error:", error);
            badge.className = 'quality-status-badge danger';
            badge.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Check Failed: ${error.message}`;
            if (reportBox) reportBox.innerHTML = `<div class="quality-report-header" style="color: #EF4444;">Error: ${error.message}</div>`;
            return null;
        } finally {
            if (scanOverlay) scanOverlay.style.display = 'none';
        }
    };

    window.checkImageQualityFromBtn = async function (cardId) {
        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData) return;
        await checkImageQuality(fileData);
    };

    window.batchQualityCheck = async function () {
        const selectedCardIds = typeof window.getSelectedCards === 'function' ? window.getSelectedCards() : [];
        const filesToProcess = selectedCardIds.length > 0
            ? uploadedFilesData.filter(f => selectedCardIds.includes(f.id))
            : uploadedFilesData;

        if (filesToProcess.length === 0) {
            alert("No images to check.");
            return;
        }

        const btn = document.getElementById('batchQualityCheckButton');
        const originalHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Batch Checking...';

        showBatchProgress('quality'); // stage 'quality' will use default/prompt icon for now

        let count = 0;
        for (const fileData of filesToProcess) {
            count++;
            updateBatchProgress(count, filesToProcess.length, fileData.name, 'quality');
            await checkImageQuality(fileData);
            // Minimal delay to avoid overwhelming the concurrent request limit
            await new Promise(r => setTimeout(r, 800));
        }

        btn.disabled = false;
        btn.innerHTML = originalHTML;
        hideBatchProgress(true);
        alert(`Batch Quality Check Complete for ${filesToProcess.length} images.`);
    };

    window.updateQualityUI = function (cardId, results) {
        const badge = document.getElementById(`quality-badge-${cardId}`);
        if (!badge) return;

        // Save results to the badge for re-clicking
        badge.dataset.results = JSON.stringify(results);
        badge.style.cursor = 'pointer';
        badge.title = 'View Report';
        badge.onclick = () => showQualityModal(cardId, results);

        const score = results.overall_score || 0;
        const issues = results.issues || [];

        // Set Badge State
        if (score >= 80) {
            badge.className = 'quality-status-badge safe';
            badge.innerHTML = '<i class="fas fa-check-circle"></i> Quality: Safe';
        } else if (score >= 50) {
            badge.className = 'quality-status-badge warning';
            const issueSummary = issues.map(i => i.type).join(', ');
            badge.innerHTML = `<i class="fas fa-exclamation-circle"></i> Quality: Warning (${issueSummary})`;
        } else {
            badge.className = 'quality-status-badge danger';
            badge.innerHTML = '<i class="fas fa-times-circle"></i> Quality: Issues';
        }

        // Show the modal automatically after check
        showQualityModal(cardId, results);
    }

    window.showQualityModal = function (cardId, results) {
        const modal = document.getElementById('qualityResultModal');
        const body = document.getElementById('qualityModalBody');
        if (!modal || !body) return;

        // Increase modal width for heatmap
        const modalContent = modal.querySelector('.modal-content');
        if (modalContent) modalContent.style.maxWidth = '850px';

        const score = results.overall_score || 0;
        const issues = results.issues || [];

        const card = document.getElementById(cardId);
        const thumbnail = card ? card.querySelector('.thumbnail-medium') : null;
        const imgSrc = thumbnail ? thumbnail.src : '';

        let reportHtml = `
                    <div style="display: flex; gap: 30px; flex-wrap: wrap;">
                        <!-- Left: Visual Analysis / Heatmap -->
                        <div style="flex: 1; min-width: 300px;">
                            <div style="font-weight: 800; margin-bottom: 15px; color: var(--text-primary); display: flex; align-items: center; gap: 10px; font-size: 1.1em;">
                                <i class="fas fa-eye" style="color: var(--accent-blue);"></i> Visual Artifact Map
                            </div>
                            <div style="position: relative; background: #000; border-radius: 16px; overflow: hidden; border: 1px solid var(--border-color); box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
                                <img id="quality-heatmap-img" src="${imgSrc}" style="width: 100%; display: block; opacity: 0.8;">
                                <canvas id="quality-heatmap-canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"></canvas>
                            </div>
                            <div style="margin-top: 15px; display: flex; gap: 15px; font-size: 0.85em; font-weight: 600;">
                                <div style="display: flex; align-items: center; gap: 6px;"><span style="width: 12px; height: 12px; background: rgba(239, 68, 68, 0.6); border-radius: 3px;"></span> High Severity</div>
                                <div style="display: flex; align-items: center; gap: 6px;"><span style="width: 12px; height: 12px; background: rgba(245, 158, 11, 0.6); border-radius: 3px;"></span> Medium/Low</div>
                            </div>
                        </div>

                        <!-- Right: Report Details -->
                        <div style="flex: 1.2; min-width: 300px;">
                            <div style="text-align: left; margin-bottom: 25px;">
                                <div style="font-size: 1.8em; font-weight: 800; color: var(--text-primary); margin-bottom: 4px; letter-spacing: -0.5px;">Technical Report</div>
                                <div style="color: var(--text-muted); font-size: 0.9em; font-weight: 500;">AI-Powered Quality Assessment</div>
                            </div>
                            
                            <div style="background: var(--bg-input); border-radius: 20px; padding: 20px; margin-bottom: 25px; border: 1px solid var(--border-color);">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                    <span style="font-weight: 700; color: var(--text-secondary);">Quality Score</span>
                                    <div style="font-size: 1.6em; font-weight: 900; color: ${score >= 80 ? '#10B981' : (score >= 50 ? '#F59E0B' : '#EF4444')}">${score}<span style="font-size: 0.6em; opacity: 0.7;">/100</span></div>
                                </div>
                                <div style="height: 10px; width: 100%; background: rgba(0,0,0,0.1); border-radius: 5px; overflow: hidden;">
                                    <div style="height: 100%; width: ${score}%; background: linear-gradient(90deg, ${score >= 80 ? '#10B981, #059669' : (score >= 50 ? '#F59E0B, #D97706' : '#EF4444, #DC2626')}); border-radius: 5px;"></div>
                                </div>
                            </div>

                            <div id="quality-issues-list">`;

        if (issues.length > 0) {
            issues.forEach((issue, idx) => {
                const icon = issue.severity === 'high' ? 'fa-exclamation-triangle' : 'fa-info-circle';
                const color = issue.severity === 'high' ? '#EF4444' : '#F59E0B';
                const bg = issue.severity === 'high' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(245, 158, 11, 0.05)';

                const clickCheck = `if((window.userUsageData?.plan || 'free').toLowerCase() === 'free') { alert('Upgrade to PRO/PREMIUM plan. Image quality check features are for pro & premium users only.'); if (typeof scrollToPricing === 'function') scrollToPricing(); return; }`;
                const fixButton = `
                          <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
                             <button class="ai-fix-btn" style="padding: 6px 14px; background: rgba(37, 99, 235, 0.1); border: 1px solid rgba(37, 99, 235, 0.3); color: #2563EB; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.85em; transition: 0.2s;" onclick="${clickCheck} fixImageArtifact('${cardId}', '${issue.type.replace(/'/g, "\\'")}')">
                                <i class="fas fa-magic"></i> AI Fix
                             </button>
                             <button class="ai-heal-btn" style="padding: 6px 14px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #10B981; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.85em; transition: 0.2s;" onclick="${clickCheck} document.getElementById('qualityResultModal').style.display='none'; sendToHealing('${cardId}', ${idx})">
                                <i class="fas fa-eraser"></i> Remove & Heal
                             </button>
                             <button class="ai-denoise-btn" style="padding: 6px 14px; background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); color: #8B5CF6; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.85em; transition: 0.2s;" onclick="${clickCheck} document.getElementById('qualityResultModal').style.display='none'; sendToHealing('${cardId}', ${idx})">
                                <i class="fas fa-wand-magic-sparkles"></i> Fix Noise & Blur
                             </button>
                          </div>
                        `;

                reportHtml += `<div class="issue-item" data-index="${idx}" style="background: ${bg}; border-radius: 12px; padding: 15px; margin-bottom: 12px; border: 1px solid ${color}33; display: flex; gap: 15px; align-items: flex-start; transition: 0.2s;">
                                           <div style="background: ${color}22; padding: 8px; border-radius: 10px;">
                                               <i class="fas ${icon}" style="color: ${color}; font-size: 1.1em;"></i>
                                           </div>
                                           <div style="flex: 1;">
                                               <div style="font-weight: 800; color: var(--text-primary); margin-bottom: 2px; font-size: 1em;">${issue.type}</div>
                                               <div style="font-size: 0.85em; color: var(--text-muted); line-height: 1.4;">${issue.description}</div>
                                               ${fixButton}
                                           </div>
                                       </div>`;
            });
        } else {
            reportHtml += `<div style="text-align: center; padding: 30px 15px; background: rgba(16, 185, 129, 0.05); border-radius: 20px; border: 2px dashed rgba(16, 185, 129, 0.2);">
                                       <i class="fas fa-check-circle" style="color: #10B981; font-size: 2.5em; margin-bottom: 15px;"></i>
                                       <div style="color: #10B981; font-weight: 800; font-size: 1.2em; margin-bottom: 5px;">Perfect Quality!</div>
                                       <div style="color: var(--text-muted); font-size: 0.9em;">No technical issues detected.</div>
                                   </div>`;
        }

        reportHtml += `</div></div></div>`;

        body.innerHTML = reportHtml;
        modal.style.display = 'flex';

        // Initialize Heatmap after modal is visible
        setTimeout(() => {
            drawQualityHeatmap(results);
        }, 100);
    }

    window.drawQualityHeatmap = function (results) {
        const canvas = document.getElementById('quality-heatmap-canvas');
        const img = document.getElementById('quality-heatmap-img');
        if (!canvas || !img) return;

        const render = () => {
            const ctx = canvas.getContext('2d');
            canvas.width = img.clientWidth || img.naturalWidth || 500;
            canvas.height = img.clientHeight || img.naturalHeight || 350;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const issues = results.issues || [];
            issues.forEach(issue => {
                const regions = issue.regions || [];
                const color = issue.severity === 'high' ? '239, 68, 68' : '245, 158, 11';

                regions.forEach(reg => {
                    if (!Array.isArray(reg) || reg.length < 4) return;

                    const x = (reg[0] / 100) * canvas.width;
                    const y = (reg[1] / 100) * canvas.height;
                    const w = ((reg[2] - reg[0]) / 100) * canvas.width;
                    const h = ((reg[3] - reg[1]) / 100) * canvas.height;

                    // Draw a soft glowing rectangle or circle
                    const gradient = ctx.createRadialGradient(
                        x + w / 2, y + h / 2, 0,
                        x + w / 2, y + h / 2, Math.max(Math.abs(w), Math.abs(h)) / 1.5
                    );
                    gradient.addColorStop(0, `rgba(${color}, 0.6)`);
                    gradient.addColorStop(1, `rgba(${color}, 0)`);

                    ctx.fillStyle = gradient;
                    ctx.beginPath();
                    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 1.2, Math.abs(h) / 1.2, 0, 0, Math.PI * 2);
                    ctx.fill();

                    // Inner stronger indicator
                    ctx.strokeStyle = `rgba(${color}, 0.8)`;
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 5]);
                    ctx.strokeRect(x, y, w, h);
                });
            });
        }

        if (img.complete) {
            render();
        } else {
            img.onload = render;
        }
    }

    window.fixImageArtifact = async function (cardId, issueType) {
        const modal = document.getElementById('qualityResultModal');
        if (modal) modal.style.display = 'none';

        const card = document.getElementById(cardId);
        const img = card ? card.querySelector('.thumbnail-medium') : null;
        if (!img) return;

        img.classList.add('image-card-fixing');

        // Show notification
        const notify = document.createElement('div');
        notify.style = "position: fixed; top: 20px; right: 20px; background: #10B981; color: white; padding: 12px 24px; border-radius: 12px; z-index: 10000; box-shadow: 0 10px 30px rgba(0,0,0,0.3); font-weight: 700; display: flex; align-items: center; gap: 10px; animation: popIn 0.3s ease-out;";
        notify.innerHTML = `<i class="fas fa-magic fa-spin"></i> AI is fixing ${issueType}...`;
        document.body.appendChild(notify);

        try {
            // Small delay to show off the cool animation
            await new Promise(r => setTimeout(r, 1500));

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            // Apply filters for enhancement
            const issueLower = issueType.toLowerCase();
            let needsCustomSharpen = false;

            if (issueLower.includes('saturate') || issueLower.includes('saturation') || issueLower.includes('over-saturated') || issueLower.includes('color')) {
                // Correct over-saturation by reducing saturation levels
                ctx.filter = 'saturate(0.7) contrast(1.05)';
            } else if (issueLower.includes('over-exposure') || issueLower.includes('overexposure') || issueLower.includes('overexposed') || issueLower.includes('blown highlights') || issueLower.includes('too bright')) {
                // Correct over-exposure: reduce brightness, balance contrast and saturation
                ctx.filter = 'brightness(0.82) contrast(1.12) saturate(0.95)';
            } else if (issueLower.includes('under-exposure') || issueLower.includes('underexposure') || issueLower.includes('underexposed') || issueLower.includes('dark')) {
                // Correct under-exposure: lift brightness, adjust contrast
                ctx.filter = 'brightness(1.25) contrast(1.08) saturate(1.05)';
            } else if (issueLower.includes('exposure') || issueLower.includes('light')) {
                // Generic exposure adjustment
                ctx.filter = 'brightness(0.9) contrast(1.1)';
            } else if (issueLower.includes('blur') || issueLower.includes('sharpness') || issueLower.includes('focus')) {
                // Apply basic adjustment, then trigger custom sharpening convolution
                ctx.filter = 'contrast(1.1) brightness(1.02)';
                needsCustomSharpen = true;
            } else if (issueLower.includes('noise') || issueLower.includes('grain')) {
                // Subtle blur followed by contrast boost to reduce grain
                ctx.filter = 'blur(0.5px) contrast(1.12) saturate(1.05)';
            } else if (issueLower.includes('compression') || issueLower.includes('jpeg')) {
                // Smooth out blocks slightly
                ctx.filter = 'blur(0.4px) contrast(1.1) saturate(1.05)';
            } else if (issueLower.includes('banding')) {
                // Blend bands slightly
                ctx.filter = 'blur(0.3px) saturate(1.15) contrast(1.05)';
            } else if (issueLower.includes('aberration') || issueLower.includes('fringe')) {
                // Desaturate slightly to reduce color fringing impact
                ctx.filter = 'saturate(0.9) contrast(1.1)';
            } else {
                // General enhancement for AI artifacts, watermarks, etc.
                ctx.filter = 'contrast(1.1) saturate(1.1)';
            }

            ctx.drawImage(img, 0, 0);

            // Perform high-speed custom 3x3 Laplacian sharpening for blur issues
            if (needsCustomSharpen) {
                try {
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const d = imgData.data;
                    const comp = new Uint8ClampedArray(d);
                    const strength = 0.65; // Adjust sharpening effect strength (0.0 to 1.0)
                    const w = canvas.width;

                    for (let i = w * 4; i < d.length - w * 4; i += 4) {
                        // Skip edge pixels to avoid out-of-bounds errors
                        if (i % (w * 4) === 0 || (i + 4) % (w * 4) === 0) continue;

                        const r = comp[i] * 5 - (comp[i - 4] + comp[i + 4] + comp[i - w * 4] + comp[i + w * 4]);
                        const g = comp[i + 1] * 5 - (comp[i - 3] + comp[i + 5] + comp[i + 1 - w * 4] + comp[i + 1 + w * 4]);
                        const b = comp[i + 2] * 5 - (comp[i - 2] + comp[i + 6] + comp[i + 2 - w * 4] + comp[i + 2 + w * 4]);

                        d[i] = comp[i] + (r - comp[i]) * strength;
                        d[i + 1] = comp[i + 1] + (g - comp[i + 1]) * strength;
                        d[i + 2] = comp[i + 2] + (b - comp[i + 2]) * strength;
                    }
                    ctx.putImageData(imgData, 0, 0);
                } catch (e) {
                    console.error("Custom sharpening convolution failed:", e);
                }
            }

            const fixedDataUrl = canvas.toDataURL('image/jpeg', 0.95);
            img.src = fixedDataUrl;

            // Update local file data
            const fileData = uploadedFilesData.find(f => f.id === cardId);
            if (fileData) {
                const blob = await (await fetch(fixedDataUrl)).blob();
                fileData.previewFile = new File([blob], fileData.name, { type: 'image/jpeg' });
                // If it's a standard image, update base file too
                if (!fileData.isAiFile) fileData.fileObject = fileData.previewFile;
            }

            notify.innerHTML = `<i class="fas fa-check-circle"></i> ${issueType} Optimized Successfully!`;
            setTimeout(() => notify.style.opacity = '0', 2000);
            setTimeout(() => notify.remove(), 2500);

            // Re-run quality check to show improvement
            setTimeout(() => {
                checkImageQualityFromBtn(cardId);
            }, 500);

        } catch (error) {
            console.error("Enhancement failed:", error);
            notify.style.background = "#EF4444";
            notify.innerHTML = `<i class="fas fa-exclamation-circle"></i> Failed to fix artifacts.`;
            setTimeout(() => notify.remove(), 3000);
        } finally {
            img.classList.remove('image-card-fixing');
        }
    };
    // JS - Spam Shield Detection Logic (Pro Feature)
    window.checkSpamDuplicates = function (currentFileData, cardElement, isPaidPlan) {
        if (!currentFileData.title || !currentFileData.keywords) return;

        // Exclude current file from check
        const otherProcessed = uploadedFilesData.filter(f => f.id !== currentFileData.id && f.title && f.keywords && f.title !== 'Error' && f.title !== '');
        if (otherProcessed.length === 0) return;

        let maxTitleSimilarity = 0;
        let maxKeywordOverlap = 0;
        let titleMatchNames = [];
        let keywordMatchNames = [];

        // Helper to calculate jaccard similarity for words
        const getWords = str => str.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
        const currentTitleWords = new Set(getWords(currentFileData.title));
        const currentKeywordsArr = currentFileData.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
        const currentKeywords = new Set(currentKeywordsArr);

        otherProcessed.forEach(other => {
            // Check Title
            const otherTitleWords = new Set(getWords(other.title));
            let titleIntersect = Array.from(currentTitleWords).filter(w => otherTitleWords.has(w)).length;
            let titleUnion = new Set([...currentTitleWords, ...otherTitleWords]).size;
            let titleSim = titleUnion === 0 ? 0 : Math.round((titleIntersect / titleUnion) * 100);

            if (titleSim > 70) {
                maxTitleSimilarity = Math.max(maxTitleSimilarity, titleSim);
                titleMatchNames.push(other.name);
            }

            // Check Keywords
            const otherKeywords = new Set(other.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0));
            let kwIntersect = Array.from(currentKeywords).filter(w => otherKeywords.has(w)).length;
            let kwSim = currentKeywords.size === 0 ? 0 : Math.round((kwIntersect / currentKeywords.size) * 100);

            if (kwSim > 80) {
                maxKeywordOverlap = Math.max(maxKeywordOverlap, kwSim);
                keywordMatchNames.push(other.name);
            }
        });

        if (maxTitleSimilarity > 70 || maxKeywordOverlap > 80) {
            let riskLevel = 'low';
            if (maxKeywordOverlap > 90 || maxTitleSimilarity > 85) riskLevel = 'high';
            else if (maxKeywordOverlap > 80 || maxTitleSimilarity > 70) riskLevel = 'medium';

            // Remove existing spam-shield-warning if any
            const existingWarning = cardElement.querySelector('.spam-shield-warning');
            if (existingWarning) existingWarning.remove();

            const warningBanner = document.createElement('div');
            warningBanner.className = 'spam-shield-warning';

            if (!isPaidPlan) {
                warningBanner.classList.add('pro-feature-locked');
                warningBanner.innerHTML = `<div class="locked-overlay" onclick="typeof showProUpgradeAlert === 'function' ? showProUpgradeAlert() : alert('Please upgrade to Pro')"><div class="lock-icon" title="Pro Feature">🔒</div></div><div class="spam-badge ${riskLevel}">⚠️ Spam Risk Detected</div><div class="spam-details">Upgrade to PRO to view duplicate filenames and analysis details.</div>`;
            } else {
                let detailsHtml = '';
                // unique files only
                titleMatchNames = [...new Set(titleMatchNames)];
                keywordMatchNames = [...new Set(keywordMatchNames)];

                if (maxTitleSimilarity > 70) {
                    detailsHtml += `<div><strong>${typeof getTrans === 'function' ? getTrans('spam_duplicate_title') || 'Duplicate title detected with:' : 'Duplicate title detected with:'}</strong> ${titleMatchNames.slice(0, 2).join(', ')}${titleMatchNames.length > 2 ? ' +' + (titleMatchNames.length - 2) + ' more' : ''} (${maxTitleSimilarity}%)</div>`;
                }
                if (maxKeywordOverlap > 80) {
                    detailsHtml += `<div><strong>${typeof getTrans === 'function' ? getTrans('spam_keyword_overlap') || 'Keyword overlap detected:' : 'Keyword overlap detected:'}</strong> ${keywordMatchNames.slice(0, 2).join(', ')}${keywordMatchNames.length > 2 ? ' +' + (keywordMatchNames.length - 2) + ' more' : ''} (${maxKeywordOverlap}%)</div>`;
                }

                const riskText = riskLevel === 'high' ? 'spam_risk_high' : (riskLevel === 'medium' ? 'spam_risk_medium' : 'spam_risk_low');

                // --- AI FIX BUTTON ---
                const fixBtnHtml = `<button class="action-button blue-button" style="margin-top: 10px; padding: 4px 10px; font-size: 0.85em; width: fit-content;" onclick="fixSpamWithAI('${currentFileData.id}')"><i class="fas fa-magic"></i> AI Fix</button>`;

                warningBanner.innerHTML = `<div class="spam-badge ${riskLevel}">⚠️ ${typeof getTrans === 'function' ? getTrans(riskText) || riskText : riskText}</div><div class="spam-details">${detailsHtml}<div style="margin-top:4px; font-style:italic;">💡 ${typeof getTrans === 'function' ? getTrans('spam_suggestion') || 'Suggestion: Make title/keywords more unique.' : 'Suggestion: Make title/keywords more unique.'}</div>${fixBtnHtml}</div>`;
            }

            const metaCol = cardElement.querySelector('.card-meta-col');
            if (metaCol) {
                metaCol.insertBefore(warningBanner, metaCol.firstChild);
            }
        }
    }
});
