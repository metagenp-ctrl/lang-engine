// MetaGen Pro - Keyword AI Tools
document.addEventListener('DOMContentLoaded', function () {

    const previewContainer = document.getElementById('filePreviewContainer');
    const processAllButton = document.getElementById('processAllButton');
    const processAllPromptsButton = document.getElementById('processAllPromptsButton');
    const exportButton = document.getElementById('exportButton');
    const embedMetadataButton = document.getElementById('embedMetadataButton');
    const clearAllButton = document.getElementById('clearAllButton');
    if (!window.uploadedFilesData) window.uploadedFilesData = [];
    const uploadedFilesData = window.uploadedFilesData;


    const modeButtons = document.querySelectorAll('.mode-button');
    const metaSection = document.querySelector('.file-upload-section');
    const processingArea = document.querySelector('.file-processing-area');
    const dalleSection = document.querySelector('.dalle-image-gen-section');
    const toolWrapper = document.getElementById('toolSectionWrapper');
    const uploadSection = document.getElementById('tour-upload-section');
    const tourPlatformSection = document.getElementById('tour-platform-section');

    // Dedicated Admin Button Handler
    const adminSidebarBtn = document.getElementById('adminSidebarBtn');
    if (adminSidebarBtn) {
        adminSidebarBtn.addEventListener('click', function (e) {
            e.preventDefault();
            // Hide upload section explicitly
            if (uploadSection) uploadSection.style.display = 'none';
            if (tourPlatformSection) tourPlatformSection.style.display = 'none';
        });
    }

    document.body.classList.add('mode-metadata');

    modeButtons.forEach(btn => {
        btn.onclick = function () {
            const section = this.getAttribute('data-section');

            if (section === 'healing') {
                const currentPlan = window.userUsageData?.plan || 'free';
                if (currentPlan.toLowerCase() !== 'pro' && currentPlan.toLowerCase() !== 'premium' && currentPlan.toLowerCase() !== 'agency') {
                    alert("Upgrade to PRO/PREMIUM plan. healing features are for pro & premium users only.");
                    if (typeof scrollToPricing === 'function') scrollToPricing();
                    return;
                }
            }

            if (section === 'sales-prediction') {
                const currentPlan = window.userUsageData?.plan || 'free';
                if (currentPlan.toLowerCase() !== 'pro' && currentPlan.toLowerCase() !== 'premium' && currentPlan.toLowerCase() !== 'agency') {
                    alert("Upgrade to PRO/PREMIUM plan. sales-prediction features are for pro & premium users only.");
                    if (typeof scrollToPricing === 'function') scrollToPricing();
                    return;
                }
            }

            if (section === 'bg-remove') {
                const currentPlan = window.userUsageData?.plan || 'free';
                if (currentPlan.toLowerCase() !== 'pro' && currentPlan.toLowerCase() !== 'premium' && currentPlan.toLowerCase() !== 'agency') {
                    alert("Upgrade to PRO/PREMIUM plan. Remove Background feature is for pro & premium users only.");
                    if (typeof scrollToPricing === 'function') scrollToPricing();
                    return;
                }
            }

            modeButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            document.body.classList.remove('mode-metadata', 'mode-image-prompt', 'mode-dalle', 'mode-niche', 'mode-calendar', 'mode-admin', 'mode-healing', 'mode-sales-prediction');

            // Hide all sections first
            if (metaSection) metaSection.style.display = 'none';
            if (processingArea) processingArea.style.display = 'none';
            if (dalleSection) dalleSection.style.display = 'none';
            if (uploadSection) uploadSection.style.display = 'none';
            if (tourPlatformSection) tourPlatformSection.style.display = 'none';

            const calendarSection = document.getElementById('stockCalendarSection');
            const nicheSection = document.getElementById('nicheResearchSection');
            const adminSection = document.getElementById('adminDashboardSection');
            const healingSection = document.getElementById('imageHealingSection');
            const salesPredSection = document.getElementById('salesPredictionSection');
            const bgRemovalSection = document.getElementById('bgRemovalSection');

            if (calendarSection) calendarSection.style.display = 'none';
            if (nicheSection) nicheSection.style.display = 'none';
            if (adminSection) adminSection.style.display = 'none';
            if (healingSection) healingSection.style.display = 'none';
            if (salesPredSection) salesPredSection.style.display = 'none';
            if (bgRemovalSection) bgRemovalSection.style.display = 'none';

            if (section === 'meta') {
                document.body.classList.add('mode-metadata');
                if (metaSection) metaSection.style.display = 'flex';
                if (processingArea) processingArea.style.display = 'flex';
            } else if (section === 'prompt') {
                document.body.classList.add('mode-image-prompt');
                if (metaSection) metaSection.style.display = 'flex';
                if (processingArea) processingArea.style.display = 'flex';
            } else if (section === 'dalle') {
                document.body.classList.add('mode-dalle');
                if (dalleSection) dalleSection.style.display = 'block';
            } else if (section === 'niche') {
                document.body.classList.add('mode-niche');
                if (nicheSection) nicheSection.style.display = 'block';
                if (calendarSection) {
                    calendarSection.style.display = 'block';
                    if (typeof initStockCalendar === 'function') initStockCalendar();
                }

                // NEW: Trigger Live Trend Forecaster on Tab Open
                if (typeof loadRealTimeTrends === 'function') {
                    loadRealTimeTrends();
                }
            } else if (section === 'healing') {
                document.body.classList.add('mode-healing');
                if (healingSection) healingSection.style.display = 'block';
            } else if (section === 'sales-prediction') {
                document.body.classList.add('mode-sales-prediction');
                if (salesPredSection) salesPredSection.style.display = 'block';
            } else if (section === 'admin') {
                document.body.classList.add('mode-admin');
                if (toolWrapper) {
                    toolWrapper.style.display = 'block';
                    toolWrapper.classList.add('active');
                }
                if (adminSection) {
                    adminSection.style.display = 'block';
                    loadAdminDashboardData();
                }
                // Ensure upload sections are hidden for admin mode
                if (uploadSection) uploadSection.style.display = 'none';
                if (tourPlatformSection) tourPlatformSection.style.display = 'none';
            }

            if (section === 'meta' || section === 'prompt') {
                if (tourPlatformSection) tourPlatformSection.style.display = 'flex';
                if (uploadSection) uploadSection.style.display = 'flex';
            }

            // Manage hero section visibility
            if (section !== 'meta' && section !== 'prompt' && section !== 'dalle' && section !== 'niche' && section !== 'calendar' && section !== 'admin') {
                // Probably landing page
            } else {
                const heroSection = document.getElementById('heroLandingSection');
                if (heroSection) heroSection.style.display = 'none';
            }

            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });

            if (window.innerWidth <= 700) {
                const sidebar = document.getElementById('appSidebar');
                const body = document.body;
                if (sidebar) sidebar.classList.remove('visible');
                body.classList.remove('sidebar-hidden');
            }
        };
    });


    window.generatePromptForImage = async function (imageFile) {
        const selectedProvider = document.getElementById('aiProviderSelect')?.value || 'groq';

        const base64Image = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = error => reject(error);
            reader.readAsDataURL(imageFile);
        });

        // --- 📊 Credit Check ---
        if (window.userUsageData && window.userUsageData.count >= window.userUsageData.limit) {
            showLimitModal();
            return;
        }

        const user = auth.currentUser;

        let isPaidPlan = false;
        let dbPlan = "";
        if (user) {
            try {
                const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                const profileData = profileDoc.exists ? profileDoc.data() : null;
                dbPlan = (profileData?.plan || '').toLowerCase();
                isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
            } catch (e) { console.warn('Plan check failed:', e); }
        }

        let apiKey = null;
        const promptInstruction = `Analyze the provided image as a forensic graphic designer. Reverse-engineer it into three different highly detailed text-to-image prompts (optimized for Midjourney v6 / DALL-E 3).

CRITICAL INSTRUCTIONS FOR ALL PROMPTS:
- Text & Typography: Read the exact text. If letters have custom stylization (e.g., an 'E' made only of three horizontal bars without a vertical stem, or specific letters in different colors), describe that exact custom typography in detail.
- Geometry & Strokes: Differentiate between solid filled shapes and outlined shapes with negative space. Note if lines are disconnected, curved, sharp, or tapered.
- Layout: Describe the exact placement of the icon relative to the text.

The three styles MUST be:
1. realistic: A highly detailed, EXACT descriptive replica of the uploaded image. If the image is a flat vector logo, describe it EXACTLY as a flat vector logo on a solid clean background with crisp, sharp edges. Describe the exact geometric shapes (e.g., 'upper wings formed by two disconnected curved orange strokes leaving negative space inside', 'lower wing is a black outline resembling a leaf with a small inner stroke'). Describe the exact text and its unique font modifications. Do NOT add 3D, mockup, or realistic photo elements.
2. illustration: Transform the image into an artistic digital illustration while maintaining the exact original subject, text, and composition. Describe it using terms like digital painting, cel-shaded, or stylized vector art.
3. 3d: Transform the image into a modern 3D render. Maintain the exact original subject and text, but add 3D elements like Unreal Engine 5, ray tracing, soft studio lighting, and 3D textures (e.g., matte plastic, glossy acrylic).

Provide ONLY the raw JSON object, exactly like this format. Do not use markdown blocks (\`\`\`json):
{
  "realistic": "[your forensic, extremely detailed descriptive prompt here]",
  "illustration": "[your vivid illustration prompt here]",
  "3d": "[your 3D render prompt here]"
}`;

        // ================= server-side PROXY LOGIC =================
        let proxyUrl = "";
        if (dbPlan === 'pro') {
            proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
        } else if (dbPlan === 'premium') {
            proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
        } else {
            proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
        }

        try {
            const response = await fetch(proxyUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${user ? await user.getIdToken() : ""}`
                },
                body: JSON.stringify({
                    action: "generatePrompt",
                    base64Image: base64Image,
                    image: base64Image,
                    mimeType: imageFile.type,
                    prompt: promptInstruction,
                    provider: selectedProvider,
                    email: user?.email || "unknown",
                    deviceInfo: navigator.userAgent,
                    plan: "pro" // Tell edge function this is a paid user - bypass trial limits
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(`Proxy API Error: ${data.error || response.statusText}`);
            }

            let generatedText = "";
            if (data.metadata) {
                generatedText = typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata);
            } else if (selectedProvider === 'gemini' && data.candidates) {
                generatedText = data.candidates[0].content.parts[0].text;
            } else if (data.choices) {
                generatedText = data.choices[0].message.content;
            } else if (data.text) {
                generatedText = data.text;
            } else {
                generatedText = JSON.stringify(data);
            }

            // Strip typical markdown wrapper from proxy if present
            const finalPrompt = generatedText.replace(/^```[a-z]*\s*|\s*```$/gi, '').trim();

            return finalPrompt;

        } catch (error) {
            console.error("Proxy Prompt Gen Error:", error);
            throw error;
        }
    }
    window.switchPromptStyle = function (cardId, style) {
        const card = document.getElementById(cardId);
        if (!card) return;

        // Deactivate all tabs
        const tabs = card.querySelectorAll('.prompt-tab-btn');
        tabs.forEach(tab => {
            if (tab.dataset.style === style) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Hide all style contents
        const contents = card.querySelectorAll('.prompt-style-content');
        contents.forEach(content => {
            if (content.id === `prompt-${style}-${cardId}`) {
                content.style.display = 'block';
                content.classList.add('active');
            } else {
                content.style.display = 'none';
                content.classList.remove('active');
            }
        });
    };

    window.copyPromptFromCard = function (button) {
        const container = button.closest('.prompt-result-container');
        const activeContent = container.querySelector('.prompt-style-content.active') || container.querySelector('.prompt-text');
        const text = activeContent ? activeContent.textContent : '';

        navigator.clipboard.writeText(text).then(() => {
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="icon-check"></i> Copied!';
            setTimeout(() => { button.innerHTML = originalText; }, 1500);
        });
    };

    window.copyAllPromptsFromCard = function (cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;

        const realistic = card.querySelector(`#prompt-realistic-${cardId}`)?.textContent || '';
        const illustration = card.querySelector(`#prompt-illustration-${cardId}`)?.textContent || '';
        const cgi3d = card.querySelector(`#prompt-3d-${cardId}`)?.textContent || '';

        const combinedText = `--- REALISTIC STYLE ---\n${realistic}\n\n--- ILLUSTRATION STYLE ---\n${illustration}\n\n--- 3D RENDER STYLE ---\n${cgi3d}`;

        navigator.clipboard.writeText(combinedText).then(() => {
            const button = card.querySelector('.action-button.purple-button');
            if (button) {
                const originalText = button.innerHTML;
                button.innerHTML = '<i class="icon-check"></i> Copied All!';
                setTimeout(() => { button.innerHTML = originalText; }, 1500);
            }
        });
    };

    window.downloadPromptFromCard = function (button) {
        const container = button.closest('.prompt-result-container');
        const activeContent = container.querySelector('.prompt-style-content.active') || container.querySelector('.prompt-text');
        const text = activeContent ? activeContent.textContent : '';

        const card = button.closest('.file-preview-card');
        const filename = card.querySelector('.card-filename').textContent.replace(/\.[^/.]+$/, "") + '_prompt.txt';
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };



    const generateDalleBtn = document.getElementById('generateDalleBtn');
    const dallePrompt = document.getElementById('dallePrompt');
    const dalleModel = document.getElementById('dalleModel');
    const dalleSteps = document.getElementById('dalleSteps');
    const dalleVariation = document.getElementById('dalleVariation');
    const dalleLoading = document.getElementById('dalleLoading');
    const dalleImagePreview = document.getElementById('dalleImagePreview');
    const dalleError = document.getElementById('dalleError');

    window.generateDalleImage = async function (prompt, model, steps, n) {
        const apiKey = localStorage.getItem('togetherApiKey');
        if (!apiKey) throw new Error('Hugging Face API Key not set.');

        const response = await fetch('https://api.together.xyz/inference', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                prompt: prompt,
                n: n,
                steps: steps
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error?.message || 'Failed to generate image');
        }
        if (!data.output || !Array.isArray(data.output.choices)) throw new Error('No image generated.');
        return data.output.choices.map(choice => `data:image/png;base64,${choice.image_base64}`);
    }

    if (generateDalleBtn) {
        generateDalleBtn.onclick = async function (event) {
            event.preventDefault();
            dalleImagePreview.innerHTML = '';
            dalleError.style.display = 'none';
            dalleLoading.style.display = 'block';
            generateDalleBtn.disabled = true;
            try {
                const prompt = dallePrompt.value.trim();
                const model = dalleModel.value;
                const steps = parseInt(dalleSteps.value) || 16;
                const n = parseInt(dalleVariation.value) || 1;
                if (!prompt) throw new Error('Please enter a prompt.');

                await new Promise(res => setTimeout(res, 1500));
                const urls = Array(n).fill(`https://placehold.co/220x220/1E293B/fff?text=AI+Image`);

                dalleImagePreview.innerHTML = urls.map((url, idx) => `
                <div class="dalle-image-card">
                    <img src="${url}" alt="Generated Image ${idx + 1}" class="dalle-image" />
                    <div class="dalle-image-actions">
                        <button class="action-button green-button" style="margin-top:10px;" onclick="addDalleImageToGrid('${url.replace(/'/g, '\\\'')}', 'AI Generated Image')">Add to Grid</button>
                        <a href="${url}" download="generated-image-${idx + 1}.png" class="action-button blue-button" style="margin-top:10px;margin-left:8px;">Download</a>
                    </div>
                </div>
            `).join('');

            } catch (err) {
                dalleError.textContent = err.message;
                dalleError.style.display = 'block';
            } finally {
                dalleLoading.style.display = 'none';
                generateDalleBtn.disabled = false;
            }
        };
    }
    window.addDalleImageToGrid = function (url, filename) {
        fetch(url)
            .then(res => res.blob())
            .then(blob => {
                const file = new File([blob], filename + '.png', { type: blob.type });
                file.isAiGenerated = true;
                handleFiles([file]);
            });
    };
    const closeDalleSectionBtn = document.getElementById('closeDalleSectionBtn');
    if (closeDalleSectionBtn) {
        closeDalleSectionBtn.onclick = function () {
            document.querySelector('[data-section="meta"]').click();
        };
    }
    // Keyword Management Functions
    window.updateKeywordsDisplay = function (cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;

        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData || !fileData.keywords) return;

        const keywordsContainer = card.querySelector('.meta-keywords');
        if (!keywordsContainer) return;

        const keywords = Array.isArray(fileData.keywords) ? fileData.keywords.filter(k => k && k.trim()) : fileData.keywords.split(',').filter(k => k.trim());

        keywordsContainer.innerHTML = keywords.map((k, index) => {
            const kw = k.trim();
            if (!kw) return '';
            const wordCount = kw.split(/\s+/).length;

            // Determine badge color (Word Count)
            let badgeHtml = wordCount === 1 ? `<span class="demand-badge demand-risky">🟢</span>` :
                (wordCount === 2 ? `<span class="demand-badge demand-med">🟡</span>` :
                    `<span class="demand-badge demand-high">🔵</span>`);

            // Get Score (New)
            const score = (fileData.keywordScores && fileData.keywordScores[kw.toLowerCase()]) || 0;
            let scoreHtml = '';
            if (score > 0) {
                // Color coding for score
                let scoreColor = '#94A3B8'; // default grey
                if (score >= 80) scoreColor = '#10B981'; // green
                else if (score >= 50) scoreColor = '#FBBF24'; // yellow
                else if (score > 0) scoreColor = '#EF4444'; // red

                scoreHtml = `<span class="keyword-score" style="font-size: 0.85em; margin-left: 5px; font-weight:bold; color: ${scoreColor};" title="Stock Value/Relevance: ${score}">${score}</span>`;
            }

            // 3. Return arranged structure: [Badge] [Keyword] [Score] [Close Button]
            return `<span class="meta-keyword-pill draggable" 
                                  draggable="true"
                                  data-index="${index}"
                                  data-card-id="${cardId}"
                                  ondragstart="handleDragStart(event)"
                                  ondragend="handleDragEnd(event)"
                                  ondragover="handleDragOver(event)"
                                  ondrop="handleDrop(event)"
                                  onclick="handleKeywordClick(event, '${kw.replace(/'/g, "\\'")}', '${cardId}')"
                                  style="display: inline-flex; align-items: center; gap: 2px;">
                                  ${badgeHtml}
                                  <span class="keyword-text">${kw}</span>
                                  ${scoreHtml}
                                  <button class="keyword-remove-btn" 
                                          onclick="event.stopPropagation(); removeKeyword('${cardId}', ${index});" 
                                          onmousedown="event.stopPropagation();"
                                          title="Remove"
                                          style="margin-left: 6px;">×</button>
                             </span>`;
        }).join('');

        // Update Count
        const keywordCountElem = document.getElementById(`keyword-count-${card.id}`);
        if (keywordCountElem) {
            const count = keywords.length;
            keywordCountElem.textContent = `(${count})`;
        }

        // Update SEO Score whenever display updates (implies data change)
        if (typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
            const score = calculateSeoScore(fileData);
            updateSeoMeter(cardId, score);
        }
    };

    window.removeKeyword = function (cardId, index) {
        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData || !fileData.keywords) return;

        // Robust handling for Array or String
        let keywords = Array.isArray(fileData.keywords)
            ? fileData.keywords
            : fileData.keywords.split(',').map(k => k.trim()).filter(k => k);

        if (index >= 0 && index < keywords.length) {
            keywords.splice(index, 1);
            fileData.keywords = keywords.join(', ');
            updateKeywordsDisplay(cardId);

            // Explicitly update count with visual feedback
            const countElem = document.getElementById(`keyword-count-${cardId}`);
            if (countElem) {
                countElem.textContent = `(${keywords.length})`;
                countElem.style.color = '#EF4444';
                countElem.style.fontWeight = 'bold';
                countElem.style.transition = 'color 0.3s ease';
                setTimeout(() => {
                    countElem.style.color = '';
                    countElem.style.fontWeight = '';
                }, 800);
            }
        }
    };

    window.addKeyword = function (cardId) {
        const input = document.getElementById(`keyword-input-${cardId}`);
        if (!input || !input.value.trim()) return;

        const newKeyword = input.value.trim().toLowerCase(); // Enforce lowercase
        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData) return;

        // Robust handling for Array or String
        let keywords = [];
        if (fileData.keywords) {
            keywords = Array.isArray(fileData.keywords)
                ? fileData.keywords
                : fileData.keywords.split(',').map(k => k.trim()).filter(k => k);
        }

        // Avoid duplicates
        if (!keywords.includes(newKeyword)) {
            keywords.push(newKeyword);
            fileData.keywords = keywords.join(', ');

            // Assign default "manual" score (e.g., 100 or a special indicator)
            if (!fileData.keywordScores) fileData.keywordScores = {};
            fileData.keywordScores[newKeyword] = 100; // Assume manually added keywords are high value

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

            input.value = ''; // Clear input
        } else {
            alert('Keyword already exists!');
        }
    };

    // ===== DRAG-AND-DROP KEYWORD REORDERING =====

    let draggedElement = null;
    let draggedIndex = null;
    let draggedCardId = null;

    window.handleDragStart = function (event) {

        const currentPlan = window.userUsageData?.plan || 'free';
        if (currentPlan === 'free') {
            event.preventDefault();
            alert("Drag & Drop Keyword Reordering is a PRO feature. Please upgrade your plan to arrange keywords for better SEO.");
            openUpgradeModal('pro');
            return;
        }

        draggedElement = event.target;
        draggedIndex = parseInt(draggedElement.dataset.index);
        draggedCardId = draggedElement.dataset.cardId;

        // Add visual class
        draggedElement.classList.add('dragging');

        // Set drag data
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/html', draggedElement.innerHTML);

        // Add class to keywords container
        const keywordsContainer = draggedElement.closest('.meta-keywords');
        if (keywordsContainer) {
            keywordsContainer.classList.add('drag-active');
        }
    };

    window.handleDragEnd = function (event) {
        // Remove visual classes
        if (draggedElement) {
            draggedElement.classList.remove('dragging');
        }

        // Remove all drag-over classes
        document.querySelectorAll('.meta-keyword-pill.drag-over').forEach(pill => {
            pill.classList.remove('drag-over');
        });

        // Remove drag-active class from container
        const keywordsContainer = event.target.closest('.meta-keywords');
        if (keywordsContainer) {
            keywordsContainer.classList.add('drag-active');
        }

        // Reset drag state
        draggedElement = null;
        draggedIndex = null;
        draggedCardId = null;
    };

    window.handleDragOver = function (event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';

        const target = event.target.closest('.meta-keyword-pill');
        if (!target || target === draggedElement) return;

        // Remove drag-over class from all pills
        document.querySelectorAll('.meta-keyword-pill.drag-over').forEach(pill => {
            if (pill !== target) {
                pill.classList.remove('drag-over');
            }
        });

        // Add drag-over class to current target
        target.classList.add('drag-over');
    };

    window.handleDrop = function (event) {
        event.preventDefault();
        event.stopPropagation();

        const target = event.target.closest('.meta-keyword-pill');
        if (!target || target === draggedElement) return;

        const targetIndex = parseInt(target.dataset.index);
        const targetCardId = target.dataset.cardId;

        // Make sure we're in the same card
        if (targetCardId !== draggedCardId) return;

        // Remove drag-over class
        target.classList.remove('drag-over');

        // Reorder keywords
        reorderKeywordsManual(draggedCardId, draggedIndex, targetIndex);
    };

    // Helper function to reorder keywords in the data array (Renamed to avoid conflict)
    function reorderKeywordsManual(cardId, fromIndex, toIndex) {
        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData || !fileData.keywords) return;

        // Split keywords into array (Robust handling)
        let keywords = Array.isArray(fileData.keywords)
            ? fileData.keywords
            : fileData.keywords.split(',').map(k => k.trim()).filter(k => k);

        // Validate indices
        if (fromIndex < 0 || fromIndex >= keywords.length || toIndex < 0 || toIndex >= keywords.length) {
            return;
        }

        // If same position, do nothing
        if (fromIndex === toIndex) return;

        // Move the keyword from source to destination
        const [movedKeyword] = keywords.splice(fromIndex, 1);
        keywords.splice(toIndex, 0, movedKeyword);

        // Update the file data
        fileData.keywords = keywords.join(', ');

        // Update the display
        updateKeywordsDisplay(cardId);

        // Optional: Show a subtle success indicator
        const card = document.getElementById(cardId);
        if (card) {
            const keywordCountElem = document.getElementById(`keyword-count-${cardId}`);
            if (keywordCountElem) {
                // Flash the count to indicate change
                keywordCountElem.style.color = '#F97316';
                setTimeout(() => {
                    keywordCountElem.style.color = '';
                }, 500);
            }
        }
    }

    window.updateTitle = function (element) {
        const card = element.closest('.file-preview-card');
        if (!card) return;
        const cardId = card.id;

        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData) return;

        fileData.title = element.innerText.trim();

        // Update Count
        const count = fileData.title.split(/\s+/).filter(w => w.length > 0).length;
        const countElem = document.getElementById(`title-count-${card.id}`);
        if (countElem) countElem.textContent = `(${count})`;

        // Show/hide clarity check button based on content
        const clarityBtn = document.getElementById(`check-clarity-btn-${cardId}`);
        if (clarityBtn) {
            if (fileData.title.length > 0) {
                clarityBtn.style.display = 'inline-flex';
            } else {
                clarityBtn.style.display = 'none';
            }
        }

        // Update SEO Score
        if (typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
            const score = calculateSeoScore(fileData);
            updateSeoMeter(cardId, score);
        }
    };

    window.fixSpamWithAI = async function (cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;

        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData) return;

        const warningBanner = card.querySelector('.spam-shield-warning');
        let originalBtnHtml = '';
        if (warningBanner) {
            const btn = warningBanner.querySelector('button');
            if (btn) {
                originalBtnHtml = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fixing...';
                btn.disabled = true;
            }
        }

        let authHeaders = {};
        const user = auth.currentUser;
        let accessToken = "";
        if (user) {
            try {
                accessToken = await user.getIdToken();
                authHeaders["Authorization"] = `Bearer ${accessToken}`;
            } catch (e) {
                console.warn("Could not get ID token:", e);
            }
        }

        // Gather existing data
        const currentTitle = fileData.title || "";
        const currentKeywords = fileData.keywords || "";

        // Gather conflicting titles from other files to avoid them
        const otherProcessed = uploadedFilesData.filter(f => f.id !== cardId && f.title && f.title !== 'Error');
        const avoidTitles = otherProcessed.map(f => f.title).join(" || ");

        const promptText = `You are a professional stock photography SEO expert. 
                The following metadata is triggering a "Duplicate/Spam" warning because it is too similar to other images in the same batch.
                
                Current Title: "${currentTitle}"
                Current Keywords: "${currentKeywords}"
                Other titles to strictly AVOID copying: "${avoidTitles.substring(0, 400)}"
                
                TASK:
                1. Rewrite the Title to be completely unique, engaging, and SEO-friendly (10-20 words). Do not use the exact same sentence structure as before.
                2. Shuffle the keywords, replace generic ones with highly specific synonyms, and return 35-45 keywords.
                
                Return ONLY valid JSON in this exact format:
                {"title": "New Unique Title", "keywords": "keyword1, keyword2, keyword3, ..."}
                Do not include markdown blocks.`;

        try {
            const response = await fetch("https://metagen-pro-api.metagenp.workers.dev/generate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeaders
                },
                body: JSON.stringify({
                    action: "generate", // Using generic generation action
                    prompt: promptText,
                    provider: document.getElementById('aiProviderSelect')?.value || 'groq',
                    email: user?.email || "unknown",
                    deviceInfo: navigator.userAgent
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();

            let generatedText = data.text || data.metadata || (data.choices && data.choices[0].message.content) || (data.candidates && data.candidates[0].content.parts[0].text) || "";

            // Clean JSON
            let cleanedJsonString = generatedText.replace(/^```json\s*|```$/g, '').trim();
            const jsonStart = cleanedJsonString.indexOf('{');
            const jsonEnd = cleanedJsonString.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                cleanedJsonString = cleanedJsonString.substring(jsonStart, jsonEnd + 1);
            }

            const fixedData = JSON.parse(cleanedJsonString);

            // Update UI and Data
            if (fixedData.title) {
                fileData.title = fixedData.title;
                const titleEl = card.querySelector('.meta-title');
                if (titleEl) {
                    titleEl.textContent = fixedData.title;
                    updateTitle(titleEl);
                }
            }

            if (fixedData.keywords) {
                fileData.keywords = Array.isArray(fixedData.keywords) ? fixedData.keywords.join(', ') : fixedData.keywords;

                // Reset keyword scores for new keywords
                fileData.keywordScores = {};
                fileData.keywords.split(',').forEach(k => {
                    fileData.keywordScores[k.trim().toLowerCase()] = 100;
                });

                updateKeywordsDisplay(cardId);
            }

            // Remove the warning banner if fixed successfully
            if (warningBanner) {
                warningBanner.remove();
            }

            // Optional: Re-check spam just in case (Will recreate banner if still spam)
            checkSpamDuplicates(fileData, card, true);

        } catch (error) {
            console.error("AI Spam Fix Error:", error);
            alert("Failed to fix spam metadata: " + error.message);
            if (warningBanner) {
                const btn = warningBanner.querySelector('button');
                if (btn) {
                    btn.innerHTML = originalBtnHtml;
                    btn.disabled = false;
                }
            }
        }
    };

    window.fixTitleWithAI = async function (cardId) {
        let currentPlan = 'free';
        if (window.userUsageData && window.userUsageData.plan) {
            currentPlan = window.userUsageData.plan.toLowerCase();
        }
        const user = auth.currentUser;
        if (user && currentPlan === 'free') {
            try {
                const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                const profileData = profileDoc.exists ? profileDoc.data() : null;
                if (profileData && profileData.plan) {
                    currentPlan = profileData.plan.toLowerCase();
                }
            } catch (e) {
                console.warn('Plan check failed:', e);
            }
        }
        const isPaidPlan = (currentPlan === 'pro' || currentPlan === 'premium' || currentPlan === 'agency');

        if (!isPaidPlan) {
            alert("Upgrade to PRO/PREMIUM plan. AI Fix function are for pro & premium users only.");
            if (typeof scrollToPricing === 'function') {
                scrollToPricing();
            }
            return;
        }
        const card = document.getElementById(cardId);
        if (!card) return;

        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData) return;

        const titleText = (fileData.title || "").trim();
        if (!titleText) {
            alert("Please generate a title first.");
            return;
        }

        const fixBtn = document.getElementById(`clarity-fix-btn-${cardId}`);
        const originalHtml = fixBtn ? fixBtn.innerHTML : '';
        if (fixBtn) fixBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fixing...';

        let authHeaders = {};
        if (user) {
            try {
                const token = await user.getIdToken();
                authHeaders["Authorization"] = `Bearer ${token}`;
            } catch (e) {
                console.warn("Could not get ID token:", e);
            }
        }

        try {
            const response = await fetch("https://metagen-pro-api.metagenp.workers.dev/api/fix-title-clarity", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeaders
                },
                body: JSON.stringify({ title: titleText })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.fixedTitle) {
                fileData.title = data.fixedTitle;
                const titleEl = card.querySelector('.meta-title');
                if (titleEl) {
                    titleEl.textContent = data.fixedTitle;
                    updateTitle(titleEl);
                }
                // Re-run the clarity check to show updated scores
                await checkTitleClarity(cardId);
            }
        } catch (error) {
            console.error("AI Fix Error:", error);
            alert("Failed to fix title: " + error.message);
        } finally {
            if (fixBtn) fixBtn.innerHTML = originalHtml;
        }
    };

    window.checkTitleClarity = async function (cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;

        const fileData = uploadedFilesData.find(f => f.id === cardId);
        if (!fileData) return;

        const titleText = (fileData.title || "").trim();
        if (!titleText) {
            alert("Please write or generate a title first.");
            return;
        }

        const container = document.getElementById(`clarity-checker-container-${cardId}`);
        const grammarValue = document.getElementById(`clarity-grammar-value-${cardId}`);
        const grammarBar = document.getElementById(`clarity-grammar-bar-${cardId}`);
        const appealValue = document.getElementById(`clarity-appeal-value-${cardId}`);
        const appealBar = document.getElementById(`clarity-appeal-bar-${cardId}`);
        const feedbackEl = document.getElementById(`clarity-feedback-${cardId}`);
        const suggestionsEl = document.getElementById(`clarity-suggestions-${cardId}`);
        const lockOverlay = document.getElementById(`clarity-lock-overlay-${cardId}`);

        if (container) {
            container.style.display = 'block';
        }

        // Temporary loading state
        if (grammarValue) grammarValue.textContent = "...";
        if (grammarBar) {
            grammarBar.style.width = "20%";
            grammarBar.className = "clarity-progress-fill medium";
        }
        if (appealValue) appealValue.textContent = "...";
        if (appealBar) {
            appealBar.style.width = "20%";
            appealBar.className = "clarity-progress-fill medium";
        }
        if (feedbackEl) feedbackEl.innerHTML = '<span style="color: var(--text-secondary);"><i class="fas fa-spinner fa-spin"></i> Analyzing title quality...</span>';
        if (suggestionsEl) suggestionsEl.innerHTML = "";
        if (lockOverlay) lockOverlay.style.display = 'none';

        let authHeaders = {};
        const user = auth.currentUser;
        if (user) {
            try {
                const token = await user.getIdToken();
                authHeaders["Authorization"] = `Bearer ${token}`;
            } catch (e) {
                console.warn("Could not get ID token:", e);
            }
        }

        try {
            const response = await fetch("https://metagen-pro-api.metagenp.workers.dev/api/check-title-clarity", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeaders
                },
                body: JSON.stringify({ title: titleText })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();

            const gScore = parseInt(data.grammarScore) || 0;
            const aScore = parseInt(data.appealScore) || 0;

            if (grammarValue) grammarValue.textContent = `${gScore}%`;
            if (grammarBar) {
                grammarBar.style.width = `${gScore}%`;
                grammarBar.className = "clarity-progress-fill " + (gScore >= 80 ? "excellent" : gScore >= 50 ? "medium" : "low");
            }

            if (appealValue) appealValue.textContent = `${aScore}%`;
            if (appealBar) {
                appealBar.style.width = `${aScore}%`;
                appealBar.className = "clarity-progress-fill " + (aScore >= 80 ? "excellent" : aScore >= 50 ? "medium" : "low");
            }

            if (feedbackEl) {
                feedbackEl.textContent = data.grammarFeedback || "";
            }

            if (suggestionsEl) {
                suggestionsEl.innerHTML = "";
                const suggestions = data.appealSuggestions || [];
                suggestions.forEach(s => {
                    if (!s || s.trim().toLowerCase() === "locked") return;
                    const li = document.createElement("li");
                    li.textContent = s;
                    suggestionsEl.appendChild(li);
                });
            }

            // Check user tier
            let dbPlan = "free";
            if (user) {
                try {
                    const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                    const profileData = profileDoc.exists ? profileDoc.data() : null;
                    dbPlan = (profileData?.plan || '').toLowerCase();
                } catch (e) { console.warn('Plan check failed:', e); }
            }
            if (dbPlan !== 'pro' && dbPlan !== 'premium' && dbPlan !== 'agency') dbPlan = 'free';
            const isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');

            if (!isPaidPlan) {
                if (lockOverlay) lockOverlay.style.display = 'flex';
                if (feedbackEl) feedbackEl.style.filter = 'blur(4px)';
                if (suggestionsEl) suggestionsEl.style.filter = 'blur(4px)';
            } else {
                if (lockOverlay) lockOverlay.style.display = 'none';
                if (feedbackEl) feedbackEl.style.filter = 'none';
                if (suggestionsEl) suggestionsEl.style.filter = 'none';
            }

        } catch (error) {
            console.error("Clarity Check Error:", error);
            if (feedbackEl) {
                feedbackEl.innerHTML = `<span style="color: #EF4444;">Error: ${error.message}</span>`;
            }
            if (grammarValue) grammarValue.textContent = "0%";
            if (grammarBar) grammarBar.style.width = "0%";
            if (appealValue) appealValue.textContent = "0%";
            if (appealBar) appealBar.style.width = "0%";
        }
    };

    // Override copyToClipboard to handle removal of delete buttons
    window.copyToClipboard = function (button, type) {
        const card = button.closest('.file-preview-card');
        let text = '';

        if (type === 'title') {
            text = card.querySelector('.meta-title').textContent;
        } else if (type === 'description') {
            text = card.querySelector('.meta-description').textContent;
        } else if (type === 'style') {
            text = card.querySelector('.meta-style-container').textContent.trim();
        } else if (type === 'mood') {
            text = card.querySelector('.meta-mood-container').textContent.trim();
        } else if (type === 'keywords') {
            const pillContainer = card.querySelector('.meta-keywords');
            if (!pillContainer) return;

            // Clone pills to handle removal of badges and buttons
            text = Array.from(pillContainer.querySelectorAll('.meta-keyword-pill')).map(pill => {
                const clone = pill.cloneNode(true);

                const badge = clone.querySelector('.demand-badge');
                if (badge) badge.remove();

                const scoreSpan = clone.querySelector('.keyword-score');
                if (scoreSpan) scoreSpan.remove();

                const removeBtn = clone.querySelector('.keyword-remove-btn');
                if (removeBtn) removeBtn.remove();

                return clone.textContent.trim();
            }).filter(t => t).join(', ');
        }

        if (text) navigator.clipboard.writeText(text).then(() => {
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="icon-check"></i>Copied!';
            setTimeout(() => { button.innerHTML = originalText; }, 1500);
        });
    };
});