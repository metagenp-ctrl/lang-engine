        // ========== TRENDING TOPICS FUNCTIONALITY (AI-POWERED) ==========
        async function fetchTrendingTopicsFromAI(retry = false) {
            const loadingDiv = document.getElementById('trendingLoading');
            const topicsList = document.getElementById('trendingTopicsList');
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const date = new Date();
            const currentMonth = monthNames[date.getMonth()];
            const currentYear = date.getFullYear();

            // Cache Key
            const cacheKey = `trending_topics_${currentMonth}_${currentYear}`;
            const cachedData = localStorage.getItem(cacheKey);

            // Use Cache if available and not retrying
            if (!retry && cachedData) {
                try {
                    const parsedData = JSON.parse(cachedData);
                    // 24 hours expiry check (optional, but good practice)
                    if (Date.now() - parsedData.timestamp < 24 * 60 * 60 * 1000) {
                        renderTrendingTopics(parsedData.topics);
                        return;
                    }
                } catch (e) {
                    console.error("Cache parse error", e);
                }
            }

            // UI Loading State
            if (loadingDiv) loadingDiv.style.display = 'block';
            if (topicsList) topicsList.style.opacity = '0.5';

            try {
                // --- PLAN CHECK LOGIC (Firebase) ---
                let isPaidPlan = false;
                let currentPlan = 'free';
                let userEmail = 'unknown';
                let accessToken = '';

                if (auth && auth.currentUser) {
                    try {
                        const user = auth.currentUser;
                        if (user) {
                            userEmail = user.email;
                            accessToken = await user.getIdToken();

                            // Check if we have plan in global state or fetch it
                            currentPlan = window.userUsageData?.plan || 'free';
                            const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                            const profileData = profileDoc.exists ? profileDoc.data() : null;
                            currentPlan = (profileData?.plan || 'free').toLowerCase();
                            isPaidPlan = (currentPlan === 'pro' || currentPlan === 'premium' || currentPlan === 'agency');
                        }
                    } catch (e) {
                        console.warn('Plan check failed for trending:', e);
                    }
                }

                const prompt = `Generate 15 trending stock photography keywords for ${currentMonth} ${currentYear}. Return ONLY a comma-separated list of keywords. No numbers, no markdown.`;
                let topics = [];
                let generatedText = "";

                // ================= ALL USERS LOGIC (Server-Side Only) =================
                const proxyUrl = `https://metagen-pro-api.metagenp.workers.dev/generate`;

                const response = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({
                        action: 'trending',
                        prompt: prompt,
                        email: userEmail,
                        deviceInfo: navigator.userAgent
                    })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || "Trending API Error");

                /* Free Action - No local increment */

                // Handle different possible response structures from Edge Function
                generatedText = data.text || data.metadata || (data.choices && data.choices[0].message.content) || (data.candidates && data.candidates[0].content.parts[0].text) || "";

                if (!generatedText) throw new Error("No output generated");

                // Clean and Filter Topics
                topics = generatedText.split(',').map(t => t.trim().replace(/^['"-]+|['"-]+$/g, ''));
                topics = topics.filter(t => t && t.length < 30 && t.length > 2 && !t.includes('*') && !t.includes(':')).slice(0, 15);

                if (topics.length > 0) {
                    // Save to Cache
                    localStorage.setItem(cacheKey, JSON.stringify({
                        topics: topics,
                        timestamp: Date.now()
                    }));
                    renderTrendingTopics(topics);
                } else {
                    throw new Error("No valid topics parsed");
                }

            } catch (error) {
                console.error("Error fetching trends:", error);

                let shortError = "Error";
                if (error && error.message) {
                    shortError = error.message.substring(0, 25);
                    if (error.message.includes('API key not valid') || error.message.includes('key not found')) shortError = "Invalid API Key";
                    if (error.message.includes('expired')) shortError = "API Key Expired";
                    if (error.message.includes('Failed to fetch')) shortError = "Network Error";
                }

                renderTrendingTopics(["Error: " + shortError, "Click to Refresh"]);
            } finally {
                if (loadingDiv) loadingDiv.style.display = 'none';
                if (topicsList) topicsList.style.opacity = '1';
            }
        }

        function renderTrendingTopics(topics) {
            const topicsList = document.getElementById('trendingTopicsList');
            if (topicsList) {
                topicsList.innerHTML = topics.map(topic =>
                    `<span class="meta-keyword-pill" onclick="navigator.clipboard.writeText('${topic}'); this.style.backgroundColor='#F97316'; setTimeout(()=>this.style.backgroundColor='var(--bg-tertiary)', 300);" style="background: var(--bg-tertiary); padding: 4px 8px; border-radius: 12px; font-size: 0.85em; color: var(--text-primary); border: 1px solid var(--border-color); cursor: pointer; user-select: none; transition: background-color 0.2s;">${topic}</span>`
                ).join('');
            }
        }

        function initTrendingTopics() {
            const date = new Date();
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const monthSpan = document.getElementById('trendingMonth');

            if (monthSpan) monthSpan.textContent = monthNames[date.getMonth()];

            // Initial Fetch (Cached or Fresh)
            fetchTrendingTopicsFromAI();

            // Refresh Button Listener
            const refreshBtn = document.getElementById('refreshTrendingBtn');
            if (refreshBtn) {
                refreshBtn.onclick = (e) => {
                    e.stopPropagation(); // Prevent collapsing

                    // Add rotation animation
                    refreshBtn.style.transform = 'rotate(180deg)';
                    setTimeout(() => refreshBtn.style.transform = 'rotate(0deg)', 500);

                    fetchTrendingTopicsFromAI(true); // Force refresh
                };
            }
        }

        // Initialize on load
        initTrendingTopics();

        // ========== THEME TOGGLE FUNCTIONALITY ==========

        let heroVanta = null;

        function initHeroAnimation() {
            try {
                if (typeof VANTA === 'undefined' || !VANTA.NET) {
                    setTimeout(initHeroAnimation, 500);
                    return;
                }
                const heroSection = document.getElementById('heroLandingSection');
                const bgElement = document.getElementById('hero-vanta-bg');
                if (!heroSection || !bgElement || heroSection.style.display === 'none') return;

                const isLight = document.body.classList.contains('light-mode');

                heroVanta = VANTA.NET({
                    el: "#hero-vanta-bg",
                    mouseControls: true,
                    touchControls: true,
                    gyroControls: false,
                    minHeight: 200.00,
                    minWidth: 200.00,
                    scale: 1.00,
                    scaleMobile: 1.00,
                    color: isLight ? 0x3b82f6 : 0xf97316,
                    backgroundColor: isLight ? 0xf8fafc : 0x161b22,
                    points: 8.00,
                    maxDistance: 15.00,
                    spacing: 15.00,
                    showDots: true
                });
            } catch (err) {
                console.error("Vanta initialization failed:", err);
            }
        }

        function updateHeroAnimationTheme() {
            if (!heroVanta) {
                initHeroAnimation();
                return;
            }
            const isLight = document.body.classList.contains('light-mode');
            heroVanta.setOptions({
                color: isLight ? 0x3b82f6 : 0xf97316,
                backgroundColor: isLight ? 0xf8fafc : 0x161b22
            });
        }

        // Initialize theme on page load
        function initializeTheme() {
            let savedTheme = localStorage.getItem('theme');
            const themeIcon = document.getElementById('themeIcon');

            // If user hasn't manually set a theme, detect browser/system preference
            if (!savedTheme) {
                if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                    savedTheme = 'light';
                } else {
                    savedTheme = 'dark';
                }
            }

            // Apply the theme
            if (savedTheme === 'light') {
                document.body.classList.add('light-mode');
                if (themeIcon) themeIcon.textContent = '☀️';
            } else {
                document.body.classList.remove('light-mode');
                if (themeIcon) themeIcon.textContent = '🌙';
            }

            // Initialize Animation
            initHeroAnimation();
        }

        // Auto-switch theme if system preference changes (and user hasn't explicitly set one)
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
                if (!localStorage.getItem('theme')) {
                    const themeIcon = document.getElementById('themeIcon');
                    if (e.matches) {
                        document.body.classList.add('light-mode');
                        if (themeIcon) themeIcon.textContent = '☀️';
                    } else {
                        document.body.classList.remove('light-mode');
                        if (themeIcon) themeIcon.textContent = '🌙';
                    }
                    updateHeroAnimationTheme();
                }
            });
        }

        // Toggle theme function
        function toggleTheme() {
            const body = document.body;
            const themeIcon = document.getElementById('themeIcon');
            const isLightMode = body.classList.toggle('light-mode');

            // Update icon
            if (themeIcon) {
                themeIcon.textContent = isLightMode ? '☀️' : '🌙';
            }

            // Save preference to localStorage
            localStorage.setItem('theme', isLightMode ? 'light' : 'dark');

            // Update Animation Theme
            updateHeroAnimationTheme();
        }

        // Add event listener to theme toggle button
        const themeToggleBtn = document.getElementById('themeToggleBtn');
        if (themeToggleBtn) {
            themeToggleBtn.addEventListener('click', toggleTheme);
        }

        // Initialize theme on page load
        initializeTheme();

        function quickNiche(cat, mkt) {
            document.getElementById('nicheCategory').value = cat;
            document.getElementById('nicheMarket').value = mkt;
            document.getElementById('generateNicheBtn').click();
        }


        // ===========================================
        // SECTION 2: Niche Research & Translation Logic
        // ===========================================
        // ==========================================
        // 🔮 NICHE RESEARCH & TRANSLATION LOGIC
        // ==========================================

        document.addEventListener('DOMContentLoaded', () => {

            // --- COPYRIGHT TOGGLE RESTRICTION ---
            const copyrightToggle = document.getElementById('copyrightToggle');
            if (copyrightToggle) {
                copyrightToggle.addEventListener('change', async function (e) {
                    if (this.checked) {
                        this.disabled = true; // Temporary disable while checking

                        const user = auth.currentUser;
                        let currentPlan = 'free';

                        if (user) {
                            try {
                                const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                                const profileData = profileDoc.exists ? profileDoc.data() : null;
                                currentPlan = (profileData?.plan || 'free').toLowerCase();
                            } catch (err) {
                                console.warn("Plan check error", err);
                            }
                        }

                        this.disabled = false;

                        if (currentPlan !== 'pro' && currentPlan !== 'premium' && currentPlan !== 'agency') {
                            this.checked = false;
                            alert("Copyright/Trademark Check is a PRO/PREMIUM feature. Please upgrade your plan to use this feature.");
                            if (typeof openUpgradeModal === 'function') openUpgradeModal('pro');
                        }
                    }
                });
            }

            // --- 1. Mode Switching Logic ---
            const modeButtons = document.querySelectorAll('.mode-button');
            const nicheSection = document.getElementById('nicheResearchSection');
            const uploadSection = document.querySelector('.file-upload-section');
            const processingArea = document.querySelector('.file-processing-area');
            const platformSelection = document.querySelector('.platform-selection-header');
            const platformUploadSection = document.getElementById('platformUploadSection');

            modeButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const section = btn.getAttribute('data-section');

                    if (section === 'healing' || section === 'sales-prediction') {
                        const currentPlan = window.userUsageData?.plan || 'free';
                        if (currentPlan.toLowerCase() !== 'pro' && currentPlan.toLowerCase() !== 'premium' && currentPlan.toLowerCase() !== 'agency') {
                            if (typeof openUpgradeModal === 'function') openUpgradeModal('pro');
                            return;
                        }
                    }

                    // Update Active State
                    modeButtons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    const calendarSection = document.getElementById('stockCalendarSection');
                    const healingSec = document.getElementById('imageHealingSection');
                    const salesPredSec = document.getElementById('salesPredictionSection');

                    // Hide healing & sales prediction in all cases first
                    if (healingSec) healingSec.style.display = 'none';
                    if (salesPredSec) salesPredSec.style.display = 'none';

                    if (section === 'calendar') {
                        // Show Calendar, Hide others
                        if (calendarSection) {
                            calendarSection.style.display = 'block';
                            initStockCalendar(); // Initialize data
                        }
                        if (nicheSection) nicheSection.style.display = 'none';
                        if (uploadSection) uploadSection.style.display = 'none';
                        if (processingArea) processingArea.style.display = 'none';
                        if (platformSelection) platformSelection.style.display = 'none';
                        if (platformUploadSection) platformUploadSection.style.display = 'none';

                        document.body.classList.remove('mode-metadata', 'mode-image-prompt', 'mode-niche', 'mode-healing', 'mode-sales-prediction');
                        document.body.classList.add('mode-calendar');
                    } else if (section === 'niche') {
                        // Show Niche, Hide others
                        if (calendarSection) calendarSection.style.display = 'none';
                        if (nicheSection) nicheSection.style.display = 'block';
                        if (uploadSection) uploadSection.style.display = 'none';
                        if (processingArea) processingArea.style.display = 'none';
                        if (platformSelection) platformSelection.style.display = 'none';
                        if (platformUploadSection) platformUploadSection.style.display = 'none';

                        document.body.classList.remove('mode-metadata', 'mode-image-prompt', 'mode-calendar', 'mode-healing', 'mode-sales-prediction');
                        document.body.classList.add('mode-niche');
                    } else if (section === 'healing') {
                        // Show Healing, Hide others
                        if (calendarSection) calendarSection.style.display = 'none';
                        if (nicheSection) nicheSection.style.display = 'none';
                        if (healingSec) healingSec.style.display = 'block';
                        if (uploadSection) uploadSection.style.display = 'none';
                        if (processingArea) processingArea.style.display = 'none';
                        if (platformSelection) platformSelection.style.display = 'none';
                        if (platformUploadSection) platformUploadSection.style.display = 'none';

                        document.body.classList.remove('mode-metadata', 'mode-image-prompt', 'mode-niche', 'mode-calendar', 'mode-sales-prediction');
                        document.body.classList.add('mode-healing');
                    } else if (section === 'sales-prediction') {
                        // Show Sales Prediction, Hide others
                        if (calendarSection) calendarSection.style.display = 'none';
                        if (nicheSection) nicheSection.style.display = 'none';
                        if (salesPredSec) salesPredSec.style.display = 'block';
                        if (uploadSection) uploadSection.style.display = 'none';
                        if (processingArea) processingArea.style.display = 'none';
                        if (platformSelection) platformSelection.style.display = 'none';
                        if (platformUploadSection) platformUploadSection.style.display = 'none';

                        document.body.classList.remove('mode-metadata', 'mode-image-prompt', 'mode-niche', 'mode-calendar', 'mode-healing');
                        document.body.classList.add('mode-sales-prediction');

                    } else if (section === 'bg-remove') {
                        if (calendarSection) calendarSection.style.display = 'none';
                        if (nicheSection) nicheSection.style.display = 'none';
                        if (healingSec) healingSec.style.display = 'none';
                        if (salesPredSec) salesPredSec.style.display = 'none';
                        if (uploadSection) uploadSection.style.display = 'none';
                        if (processingArea) processingArea.style.display = 'none';
                        if (platformSelection) platformSelection.style.display = 'none';
                        if (platformUploadSection) platformUploadSection.style.display = 'none';

                        document.getElementById('bgRemovalSection').style.display = 'block';
                        document.body.className = 'mode-bg-remove';
                    } else {
                        // Hide Niche & Calendar, Show others
                        if (calendarSection) calendarSection.style.display = 'none';
                        if (nicheSection) nicheSection.style.display = 'none';

                        // We need to restore visibility if we switched away from niche
                        // Existing logic might not auto-show these if they were hidden by us
                        if (uploadSection && uploadedFilesData.length === 0) uploadSection.style.display = 'flex'; // Only show if no files? Or always check state

                        // Determine if we need to show processing area
                        if (processingArea) processingArea.style.display = 'block';
                        if (platformSelection) platformSelection.style.display = 'flex'; // Restore

                        // Let existing class logic work (Meta vs Prompt)
                        document.body.classList.remove('mode-niche', 'mode-healing', 'mode-sales-prediction');
                        if (section === 'meta') {
                            document.body.classList.add('mode-metadata');
                            document.body.classList.remove('mode-image-prompt');
                        } else if (section === 'prompt') {
                            document.body.classList.add('mode-image-prompt');
                            document.body.classList.remove('mode-metadata');
                        }
                    }
                });
            });

            function initStockCalendar() {
                const container = document.getElementById('calendarCardsContainer');
                if (!container) return;
                container.innerHTML = '';

                const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                const data = [
                    { target: 'April/May', shoot: ['Easter Holidays', 'Spring Festivals', 'Outdoor Fitness'], themes: ['Wellness', 'New Beginnings', 'Renewable Energy'] },
                    { target: 'May/June', shoot: ['Mother\'s Day', 'Graduation Parties', 'Late Spring Travel'], themes: ['Family Bonds', 'Education', 'Sustainable Living'] },
                    { target: 'June/July', shoot: ['Father\'s Day', 'Summer Vacation', 'Wedding Season'], themes: ['Relationships', 'Freedom', 'Local Tourism'] },
                    { target: 'September', shoot: ['Back to School', 'Autumn Landscapes', 'Early Halloween'], themes: ['Discovery', 'Change', 'Cyber Security'] },
                    { target: 'December', shoot: ['Winter Holidays (Last Chance)', 'Black Friday Tech', 'Family Gatherings'], themes: ['Gratitude', 'Celebration', 'Remote Work'] },
                    { target: 'Jan 2027', shoot: ['New Year 2027', 'Valentine\'s Day', 'Winter Sports'], themes: ['Future Vision', 'Love', 'Efficiency'] },
                    { target: 'December (Prep)', shoot: ['Christmas (July Prep)', 'Winter Fashion', 'Indoor Living'], themes: ['Cozy Home', 'Craftsmanship', 'Mental Health'] },
                    { target: 'Sept/Oct', shoot: ['Southern Hemisphere Spring', 'Education Trends', 'Finance/Tax'], themes: ['Growth', 'Knowledge', 'Cryptocurrency'] },
                    { target: 'Mar/Apr', shoot: ['Lunar New Year', 'Easter (Early Prep)', 'Spring Cleaning'], themes: ['Heritage', 'Hope', 'Clean Tech'] },
                    { target: 'July 2027', shoot: ['Summer 2027 Prep', 'Beach & Travel', 'Health & Biotech'], themes: ['Vitality', 'Innovation', 'Diversity'] },
                    { target: 'Oct/Nov', shoot: ['Graduation (Southern)', 'Autumn Trends', 'Industrial Tech'], themes: ['Success', 'Structure', 'AI Ethics'] },
                    { target: 'Feb 2027', shoot: ['Valentine\'s (Last Chance)', 'New Year Resolutions', 'Tech Expo'], themes: ['Focus', 'Connectivity', 'Modern Art'] }
                ];

                const currentMonthIdx = new Date().getMonth();

                // Show current month and next 5 months
                for (let i = 0; i < 6; i++) {
                    const idx = (currentMonthIdx + i) % 12;
                    const mData = data[idx];
                    const card = document.createElement('div');
                    card.className = 'calendar-card';
                    card.innerHTML = `
                    <div class="calendar-month-badge">${months[idx]}</div>
                    <div style="font-size: 0.8em; color: var(--accent-orange); font-weight: bold; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                        <i class="fas fa-bullseye"></i> Preparing for: ${mData.target}
                    </div>
                    <h3><i class="fas fa-camera"></i> Time to Shoot</h3>
                    <ul class="shoot-list">
                        ${mData.shoot.map(item => `<li class="shoot-item"><i class="fas fa-check-circle"></i> ${item}</li>`).join('')}
                    </ul>
                    <h3 style="margin-top:20px; color: var(--accent-blue);"><i class="fas fa-lightbulb"></i> Trending Themes</h3>
                    <ul class="shoot-list">
                        ${mData.themes.map(item => `<li class="shoot-item"><i class="fas fa-star" style="color:#eab308"></i> ${item}</li>`).join('')}
                    </ul>
                `;
                    container.appendChild(card);
                }
            }

            // --- 3. Niche Research Logic (FIXED) ---
            const generateNicheBtn = document.getElementById('generateNicheReportBtn');
            if (generateNicheBtn) {
                generateNicheBtn.addEventListener('click', async function () {
                    const user = auth.currentUser;

                    if (!user) {
                        document.getElementById('loginModal').classList.remove('hidden');
                    } else {
                        analyzeNicheTrends();
                    }
                });
            }
            async function analyzeNicheTrends() {
                const category = document.getElementById('nicheCategory').value;
                const market = document.getElementById('nicheMarket').value;
                const resultsDiv = document.getElementById('nicheResults');
                const loadingDiv = document.getElementById('nicheLoading');

                // --- 📊 Credit Check ---
                // Credit check handled server-side

                // UI State
                loadingDiv.style.display = 'block';
                resultsDiv.style.display = 'none';
                generateNicheBtn.disabled = true;
                generateNicheBtn.innerHTML = '<i class="icon-spinner"></i> ' + getTrans('analyzing');

                try {
                    // --- PLAN CHECK LOGIC (Firebase) ---
                    const user = auth.currentUser;
                    let isPaidPlan = false;
                    let dbPlan = "";
                    let accessToken = "";
                    if (user) {
                        try {
                            accessToken = await user.getIdToken();
                            const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                            const profileData = profileDoc.exists ? profileDoc.data() : null;
                            dbPlan = (profileData?.plan || '').toLowerCase();
                            isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
                        } catch (e) { console.warn('Plan check failed:', e); }
                    }

                    // Construct Prompt (Advanced for Pro/Premium, Basic for Free)
                    const date = new Date();
                    const monthInfo = date.toLocaleString('default', { month: 'long', year: 'numeric' });
                    let prompt;

                    if (isPaidPlan) {
                        // ========== ADVANCED PROMPT FOR PRO & PREMIUM ==========
                        prompt = `You are an expert stock photography market analyst. Generate 10 highly specific, high-potential "Niche Concepts" for the category: "${category}" focusing on the market: "${market}" for ${monthInfo}.

CRITICAL: You MUST return a valid JSON OBJECT. The root of the JSON must be an object with a key named "niches" which contains the array of concepts.
Do not include any conversational text, explanations, or markdown code blocks.

For each niche, provide ALL of the following fields:
- "title": A catchy, specific niche title
- "description": Detailed description of the niche opportunity (2-3 sentences)
- "keywords": Array of 15+ highly specific, SEO-optimized keywords for this niche
- "trend_reason": Why this niche is trending right now (reference current events, seasons, cultural moments)
- "demand_level": One of "🔥 Very High", "📈 High", "📊 Medium"
- "competition": One of "Low", "Medium", "High" with brief explanation
- "monetization_tips": 2-3 specific tips on how to maximize earnings from this niche
- "seasonal_relevance": When this niche peaks in demand (specific months/seasons)
- "content_angle": Specific creative direction or unique angle to differentiate from competitors
- "suggested_platforms": Array of best platforms to sell this content ["Shutterstock", "Adobe Stock", "Magnific", etc.]

Format Example:
{
  "niches": [
    {
      "title": "...",
      "description": "...",
      "keywords": ["...", "...", "..."],
      "trend_reason": "...",
      "demand_level": "🔥 Very High",
      "competition": "Low - few contributors covering this angle",
      "monetization_tips": "...",
      "seasonal_relevance": "...",
      "content_angle": "...",
      "suggested_platforms": ["Shutterstock", "Adobe Stock"]
    }
  ]
}`;
                    } else {
                        // ========== BASIC PROMPT FOR FREE USERS ==========
                        prompt = `Generate 6 specific, high-potential "Niche Concepts" for the category: "${category}" focusing on the market: "${market}".
                
                  CRITICAL: You MUST return a valid JSON OBJECT. The root of the JSON must be an object with a key named "niches" which contains the array of concepts.
                   Do not include any conversational text, explanations, or markdown code blocks.
                
                      Format Example:
                       {
                       "niches": [
                         {
                         "title": "...",
                         "description": "...",
                         "keywords": ["...", "..."],
                         "trend_reason": "..."
                        }
                      ]
                    }`;
                    }

                    const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";

                    const response = await fetch(proxyUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${accessToken}`
                        },
                        body: JSON.stringify({
                            action: "nicheResearch",
                            prompt: prompt,
                            email: user?.email || "guest",
                            deviceInfo: navigator.userAgent
                        })
                    });

                    const data = await response.json();
                    if (!response.ok) {
                        if (response.status === 429) {
                            showLimitModal(data.error);
                            throw new Error("Daily limit reached");
                        }
                        throw new Error(data.error || "Proxy Research Error");
                    }

                    /* logActivity is now handled server-side */

                    jsonString = data.text || data.metadata || JSON.stringify(data);

                    // --- ROBUST JSON CLEANING & PARSING (FIXED) ---

                    // 1. Remove Markdown code blocks
                    jsonString = jsonString.replace(/```json\s*|```/gi, '').trim();

                    // 2. Extract only the JSON Array part [...]
                    const start = jsonString.indexOf('[');
                    const end = jsonString.lastIndexOf(']');

                    if (start !== -1 && end !== -1) {
                        jsonString = jsonString.substring(start, end + 1);
                    } else {
                        // Sometimes AI returns an object {"niches": [...]} instead of array
                        const startObj = jsonString.indexOf('{');
                        const endObj = jsonString.lastIndexOf('}');
                        if (startObj !== -1 && endObj !== -1) {
                            jsonString = jsonString.substring(startObj, endObj + 1);
                        }
                    }

                    // 3. Robust JSON Cleaning (Strip unescaped quotes and newlines)
                    // First, fix double quotes inside values (approximation)
                    // If a " is followed by something that looks like it's NOT a key or end of property, it might be an internal quote
                    // But standard approach is to replace raw control chars first
                    jsonString = jsonString.replace(/[\x00-\x1F\x7F-\x9F]/g, " ");

                    let niches;
                    try {
                        niches = JSON.parse(jsonString);
                    } catch (e) {
                        console.error("First Parse Failed, attempting manual fix:", e);
                        // Fallback: Try to fix common trailing comma issue and escaped characters
                        jsonString = jsonString.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                        // Try to handle raw newlines that might have survived
                        jsonString = jsonString.replace(/\n/g, ' ').replace(/\n/g, ' ');

                        try {
                            niches = JSON.parse(jsonString);
                        } catch (e2) {
                            console.error("Second Parse Failed, trying very aggressive cleaning.");
                            // Aggressive: Remove anything that's not standard JSON structural chars or valid content
                            // (Riskier but better than failing completely)
                            try {
                                // Try to find the first { and last } again just in case
                                const s = jsonString.indexOf('{');
                                const e = jsonString.lastIndexOf('}');
                                if (s !== -1 && e !== -1) {
                                    niches = JSON.parse(jsonString.substring(s, e + 1));
                                } else { throw e2; }
                            } catch (e3) { throw e3; }
                        }
                    }

                    // Ensure niches is an array
                    if (!Array.isArray(niches)) {
                        if (niches.niches && Array.isArray(niches.niches)) {
                            niches = niches.niches;
                        } else if (niches.results && Array.isArray(niches.results)) {
                            niches = niches.results;
                        } else if (niches.data && Array.isArray(niches.data)) {
                            niches = niches.data;
                        } else {
                            // Single object wrap
                            niches = [niches];
                        }
                    }

                    // Final validation
                    if (!niches || !Array.isArray(niches)) {
                        throw new Error("Invalid response format from AI. Expected a JSON array.");
                    }



                    // Render Results
                    renderNicheResults(niches);

                    /* logActivity is now handled server-side */

                } catch (error) {
                    console.error("Niche Analysis Error:", error);

                    resultsDiv.innerHTML = `<div style="grid-column: 1/-1; color: #EF4444; text-align: center; padding: 20px; background: rgba(239,68,68,0.1); border-radius:8px;">
                        <i class="fas fa-exclamation-triangle"></i> Error: ${error.message} <br>
                        <small style="color: #94A3B8;">Try again or switch AI provider.</small>

                    </div>`;
                    resultsDiv.style.display = 'grid'; // Show error box
                } finally {
                    loadingDiv.style.display = 'none';
                    resultsDiv.style.display = 'grid';
                    generateNicheBtn.disabled = false;
                    generateNicheBtn.innerHTML = '<i class="fas fa-magic"></i> ' + getTrans('analyze_trends');
                }
            }

            // --- Quick Niche Shortcut (for Quick Suggestions buttons) ---
            window.quickNiche = async function (category, market) {
                const catSelect = document.getElementById('nicheCategory');
                const mktSelect = document.getElementById('nicheMarket');
                if (catSelect) catSelect.value = category;
                if (mktSelect) mktSelect.value = market;

                // Same auth check as the main button
                const user = auth.currentUser;
                if (!user) {
                    document.getElementById('loginModal').classList.remove('hidden');
                    return;
                }
                analyzeNicheTrends();
            };
            function renderNicheResults(niches) {
                const container = document.getElementById('nicheResults');

                if (!niches || !Array.isArray(niches)) {
                    console.error("Invalid niches data passed to render:", niches);
                    container.innerHTML = '<div style="color: #EF4444; grid-column: 1/-1; text-align: center;">Unable to display results due to invalid format.</div>';
                    return;
                }

                container.innerHTML = niches.map(n => {
                    const keywords = Array.isArray(n.keywords) ? n.keywords : (n.keywords ? n.keywords.split(',').map(k => k.trim()) : []);
                    const hasAdvanced = !!(n.demand_level || n.competition || n.monetization_tips);
                    const competitionText = n.competition || 'LOW COMPETITION';
                    const competitionColor = (competitionText.toLowerCase().includes('high')) ? '#EF4444' : (competitionText.toLowerCase().includes('medium') ? '#F59E0B' : '#2bed7c');

                    return `
            <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 12px; min-height: 320px;">
                <div style="display:flex; justify-content: space-between; align-items: flex-start;">
                    <h3 style="color: #F97316; margin: 0; font-size: 0.95em; line-height: 1.3;">${n.title || 'Untitled Concept'}</h3>
                    <span style="background: var(--bg-input); color: ${competitionColor}; padding: 2px 8px; border-radius: 4px; font-size: 0.7em; font-weight: bold; white-space: nowrap; margin-left: 10px;">${hasAdvanced ? (n.demand_level || '📊 Medium') : 'LOW COMPETITION'}</span>
                </div>

                <p style="color: var(--text-primary); font-size: 0.85em; flex-grow: 0; margin: 0;">${n.description || 'No description provided.'}</p>
                
                ${hasAdvanced ? `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div style="background: rgba(59,130,246,0.06); padding: 8px 10px; border-radius: 6px; border-left: 3px solid #3B82F6;">
                        <span style="font-size: 0.65em; color: #3B82F6; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Competition</span>
                        <p style="font-size: 0.8em; color: var(--text-primary); margin: 4px 0 0; line-height: 1.3;">${n.competition || 'N/A'}</p>
                    </div>
                    <div style="background: rgba(16,185,129,0.06); padding: 8px 10px; border-radius: 6px; border-left: 3px solid #10B981;">
                        <span style="font-size: 0.65em; color: #10B981; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Seasonal</span>
                        <p style="font-size: 0.8em; color: var(--text-primary); margin: 4px 0 0; line-height: 1.3;">${n.seasonal_relevance || 'Year-round'}</p>
                    </div>
                </div>
                ` : ''}

                <div style="background: var(--bg-input); padding: 10px; border-radius: 8px; border-left: 4px solid #3B82F6;">
                    <span style="font-size: 0.75em; color: #2573f7; display: block; margin-bottom: 4px; font-weight: bold; letter-spacing: 0.5px;">PRO TIP / WHY TRENDING</span>
                    <span style="font-size: 0.85em;color: var(--text-primary); line-height: 1.4;">${n.trend_reason || 'Highly searched on Shutterstock & Adobe Stock.'}</span>
                </div>

                ${hasAdvanced && n.monetization_tips ? `
                <div style="background: rgba(249,115,22,0.06); padding: 10px; border-radius: 8px; border-left: 4px solid #F97316;">
                    <span style="font-size: 0.75em; color: #F97316; display: block; margin-bottom: 4px; font-weight: bold; letter-spacing: 0.5px;">💰 MONETIZATION TIPS</span>
                    <span style="font-size: 0.82em; color: var(--text-primary); line-height: 1.4;">${n.monetization_tips}</span>
                </div>
                ` : ''}

                ${hasAdvanced && n.content_angle ? `
                <div style="background: rgba(139,92,246,0.06); padding: 10px; border-radius: 8px; border-left: 4px solid #8B5CF6;">
                    <span style="font-size: 0.75em; color: #8B5CF6; display: block; margin-bottom: 4px; font-weight: bold; letter-spacing: 0.5px;">🎯 CONTENT ANGLE</span>
                    <span style="font-size: 0.82em; color: var(--text-primary); line-height: 1.4;">${n.content_angle}</span>
                </div>
                ` : ''}
                
                <div style="margin-top: 5px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <p style="font-size: 0.75em; color: var(--text-primary); margin: 0; font-weight: 600;">Recommended Keywords:</p>
            <button onclick="copyKeywordsOnly(event, '${keywords.join(', ').replace(/'/g, "\\'")}')" 
               style="background: rgba(59, 130, 246, 0.1); border: 1px solid #3B82F6; color: #3B82F6; cursor: pointer; font-size: 0.7em; padding: 4px 10px; border-radius: 4px; display: flex; align-items: center; gap: 4px;">
                   <i class="fas fa-copy"></i> ${getTrans('copy_tag')}
            </button>
        </div>

                <div style="display:flex; flex-wrap:wrap; gap:5px;">
                   ${keywords.map(k => `<span style="background: var(--bg-input); color: var(--text-primary); padding: 3px 8px; border-radius: 4px; font-size: 0.7em; border: 1px solid #334155;">${k}</span>`).join('')}
                </div>
             </div>

                ${hasAdvanced && n.suggested_platforms ? `
                <div style="display:flex; flex-wrap:wrap; gap:5px; margin-top: 2px;">
                    <span style="font-size: 0.7em; color: var(--text-muted); font-weight: 600;">Platforms:</span>
                    ${(Array.isArray(n.suggested_platforms) ? n.suggested_platforms : []).map(p => `<span style="background: rgba(59,130,246,0.1); color: #3B82F6; padding: 2px 8px; border-radius: 10px; font-size: 0.65em; font-weight: 600;">${p}</span>`).join('')}
                </div>
                ` : ''}
    
              <button class="action-button blue-button" style="margin-top: 10px; width: 100%; justify-content: center; font-size: 0.85em; padding: 10px;" onclick="copyNicheIdea('${(n.title || "").replace(/'/g, "\\'")}', '${(n.description || "").replace(/'/g, "\\'")}')">
                 <i class="fas fa-copy" style="margin-right: 8px;"></i> ${getTrans('copy_idea')}
            </button>
            </div>
        `;
                }).join('');
            }
            window.copyNicheIdea = function (title, desc) {
                const text = `Title: ${title}\nDescription: ${desc}`;
                navigator.clipboard.writeText(text);
                alert("Niche idea copied!");
            }
        });

        // Function to copy only the keywords
        function copyKeywordsOnly(keywordString) {
            if (!keywordString) return;

            navigator.clipboard.writeText(keywordString).then(() => {
                const btn = event.currentTarget;
                const originalText = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                btn.style.color = '#10b981';
                btn.style.borderColor = '#10b981';

                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.color = '#3B82F6';
                    btn.style.borderColor = '#3B82F6';
                }, 2000);
            }).catch(err => {
                console.error('Copy failed: ', err);
            });
        }

        window.copyKeywordsOnly = function (event, keywordString) {
            if (!keywordString) return;

            navigator.clipboard.writeText(keywordString).then(() => {
                const btn = event.currentTarget;
                const originalContent = btn.innerHTML;

                btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                btn.style.color = '#10b981';
                btn.style.borderColor = '#10b981';
                btn.style.background = 'rgba(16, 185, 129, 0.1)';

                setTimeout(() => {
                    btn.innerHTML = originalContent;
                    btn.style.color = '#3B82F6';
                    btn.style.borderColor = '#3B82F6';
                    btn.style.background = 'rgba(59, 130, 246, 0.1)';
                }, 2000);
            }).catch(err => {
                const textArea = document.createElement("textarea");
                textArea.value = keywordString;
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand('copy');
                    alert('Keywords Copied!');
                } catch (err) {
                    console.error('Unable to copy', err);
                }
                document.body.removeChild(textArea);
            });
        };

        // --- Niche Tab Navigation Logic ---
        window.switchNicheTab = function (tabId) {
            // Update buttons
            const navButtons = document.querySelectorAll('.niche-tab-btn');
            navButtons.forEach(btn => btn.classList.remove('active'));
            document.querySelector(`.niche-tab-btn[data-niche-tab="${tabId}"]`).classList.add('active');

            // Update content panels
            const tabContents = document.querySelectorAll('.niche-tab-content');
            tabContents.forEach(content => content.classList.remove('active'));
            
            if (tabId === 'trends') {
                document.getElementById('nicheTabTrends').classList.add('active');
            } else if (tabId === 'spy') {
                document.getElementById('nicheTabSpy').classList.add('active');
                checkSpyDailyLimit();
            }
        };

        // Spy Daily Limit Tracking for Free Users
        function checkSpyDailyLimit() {
            const user = auth.currentUser;
            let isPaidPlan = false;
            if (user) {
                const dbPlan = (window.userUsageData?.plan || '').toLowerCase();
                isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
            }

            const counterEl = document.getElementById('spyUsageText');
            if (!counterEl) return;

            if (isPaidPlan) {
                counterEl.innerHTML = 'Unlimited';
                counterEl.parentElement.style.color = '#10B981';
                counterEl.parentElement.style.background = 'rgba(16,185,129,0.1)';
                counterEl.parentElement.style.borderColor = 'rgba(16,185,129,0.2)';
            } else {
                const today = new Date().toISOString().split('T')[0];
                let spyUsage = JSON.parse(localStorage.getItem('metagen_spy_usage') || '{}');
                
                if (spyUsage.date !== today) {
                    spyUsage = { date: today, count: 0 };
                    localStorage.setItem('metagen_spy_usage', JSON.stringify(spyUsage));
                }
                
                const remaining = Math.max(0, 2 - spyUsage.count);
                counterEl.innerHTML = `${remaining}/2 remaining`;
                if (remaining === 0) {
                    counterEl.parentElement.style.color = '#EF4444';
                    counterEl.parentElement.style.background = 'rgba(239,68,68,0.1)';
                    counterEl.parentElement.style.borderColor = 'rgba(239,68,68,0.2)';
                }
            }
        }

        function incrementSpyUsage() {
            const user = auth.currentUser;
            let isPaidPlan = false;
            if (user) {
                const dbPlan = (window.userUsageData?.plan || '').toLowerCase();
                isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
            }

            if (!isPaidPlan) {
                const today = new Date().toISOString().split('T')[0];
                let spyUsage = JSON.parse(localStorage.getItem('metagen_spy_usage') || '{}');
                if (spyUsage.date !== today) {
                    spyUsage = { date: today, count: 0 };
                }
                spyUsage.count += 1;
                localStorage.setItem('metagen_spy_usage', JSON.stringify(spyUsage));
                checkSpyDailyLimit();
            } else {
                if (window.userUsageData) {
                    window.userUsageData.monthlyCount = (window.userUsageData.monthlyCount || 0) + 1;
                    if (typeof updateUsageUI === 'function') updateUsageUI();
                }
            }
        }

        function canUseSpyFeature() {
            const user = auth.currentUser;
            let isPaidPlan = false;
            let hasCredits = false;
            if (user) {
                const dbPlan = (window.userUsageData?.plan || '').toLowerCase();
                isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
                
                if (isPaidPlan) {
                    const u = window.userUsageData || {};
                    const currentBase = u.baseLimit || (dbPlan === 'premium' ? 3000 : (dbPlan === 'pro' ? 2000 : 120));
                    const totalMonthlyLimit = currentBase + (u.referralBonus || 0);
                    const currentMonthlyCount = u.monthlyCount || 0;
                    
                    if (currentMonthlyCount < totalMonthlyLimit || (u.purchasedCredits && (u.purchasedCreditsUsed || 0) < u.purchasedCredits)) {
                        hasCredits = true;
                    }
                }
            }

            if (isPaidPlan) return hasCredits;

            const today = new Date().toISOString().split('T')[0];
            let spyUsage = JSON.parse(localStorage.getItem('metagen_spy_usage') || '{}');
            if (spyUsage.date !== today) return true;
            
            return spyUsage.count < 2;
        }

        // --- Competitor Spy Logic ---
        window.analyzeCompetitorAsset = async function () {
            const urlInput = document.getElementById('spyUrlInput').value.trim();
            if (!urlInput) {
                alert("Please enter a valid Shutterstock or Adobe Stock URL/Asset ID.");
                return;
            }

            const user = auth.currentUser;
            if (!user) {
                document.getElementById('loginModal').classList.remove('hidden');
                return;
            }

            if (!canUseSpyFeature()) {
                const dbPlan = (window.userUsageData?.plan || '').toLowerCase();
                const isPaid = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
                if (isPaid) {
                    if (typeof showCustomAlert === 'function') showCustomAlert("Credit limit reached. Please purchase more credits or wait for monthly reset.", "warning");
                    else alert("Credit limit reached. Please purchase more credits.");
                } else {
                    if (typeof showCustomAlert === 'function') showCustomAlert("Daily limit reached (2/2). Upgrade to Pro for unlimited competitor analysis.", "warning");
                    else alert("Daily limit reached (2/2). Upgrade to Pro for unlimited competitor analysis.");
                }
                return;
            }

            // Determine platform and ID
            let platform = "Unknown";
            let assetId = urlInput;
            
            if (urlInput.toLowerCase().includes('shutterstock.com')) {
                platform = "Shutterstock";
                const match = urlInput.match(/(?:image(?:-photo|-vector|-illustration)?\/).*?-(\d+)/) || urlInput.match(/-(\d+)\/?$/);
                if (match) assetId = match[1];
            } else if (urlInput.toLowerCase().includes('stock.adobe.com')) {
                platform = "Adobe Stock";
                const match = urlInput.match(/(?:images\/.*?\/|stock-photo\/.*?\/|(?:\?|&)k=)?(\d+)/);
                if (match) assetId = match[1];
            } else if (!isNaN(urlInput) && urlInput.length > 5) {
                // If just numbers, assume based on length (Shutterstock usually longer, Adobe usually ~9 digits, but not strict)
                platform = "General Stock";
            }

            document.getElementById('spyEmptyState').style.display = 'none';
            document.getElementById('spyResultsContainer').style.display = 'none';
            document.getElementById('spyLoading').style.display = 'block';
            document.getElementById('spyAnalyzeBtn').disabled = true;

            try {
                let accessToken = await user.getIdToken();
                
                const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
                
                // We ask the AI to perform a reverse analysis based on the platform and ID
                const prompt = `Act as an expert stock photography SEO analyst. I am providing you with a ${platform} asset URL/ID: "${urlInput}".
                
While you cannot scrape the live URL, use your extensive training data of stock photography patterns to reverse-engineer and estimate the metadata, ranking, and top converting keywords for an asset that fits this context.

CRITICAL: Return ONLY a valid JSON object. No markdown, no explanations.

JSON Structure Requirements:
{
  "asset_title": "Estimated descriptive title of the asset (10-15 words)",
  "category": "Main category (e.g., Business, Nature, Tech)",
  "estimated_rank_score": "A number between 75 and 99 indicating SEO strength",
  "keywords": [
    {
      "term": "keyword or phrase",
      "search_volume": "High/Medium/Low",
      "relevance_score": number between 1-100
    }
  ] (Provide exactly 25 top-converting keywords),
  "outrank_suggestion": "A strategic tip on how to create content that outperforms this asset (e.g., better lighting, new angle, trend integration). (2-3 sentences max)"
}`;

                const response = await fetch(proxyUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({
                        action: "competitorSpy", // Handled by Groq in worker
                        prompt: prompt,
                        email: user.email,
                        deviceInfo: navigator.userAgent,
                        assetUrl: urlInput,
                        platform: platform
                    })
                });

                const data = await response.json();
                if (!response.ok) {
                    if (response.status === 429 || data.error?.includes('limit')) {
                        showLimitModal(data.error);
                        throw new Error("Credit limit reached. Please upgrade to continue using this Pro feature.");
                    }
                    throw new Error(data.error || "Analysis failed.");
                }

                // Increment usage for free users upon success
                incrementSpyUsage();

                // Clean and parse JSON
                let jsonString = data.text || JSON.stringify(data);
                jsonString = jsonString.replace(/```json\s*|```/gi, '').trim();
                
                const startObj = jsonString.indexOf('{');
                const endObj = jsonString.lastIndexOf('}');
                if (startObj !== -1 && endObj !== -1) {
                    jsonString = jsonString.substring(startObj, endObj + 1);
                }

                let spyData;
                try {
                    spyData = JSON.parse(jsonString);
                } catch (e) {
                    throw new Error("Failed to parse analysis data from AI.");
                }

                // Check Pro status for displaying advanced metrics
                let isPaidPlan = false;
                if (user) {
                    const dbPlan = (window.userUsageData?.plan || '').toLowerCase();
                    isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
                }

                renderCompetitorResults(spyData, urlInput, platform, assetId, isPaidPlan);

            } catch (error) {
                console.error("Competitor Spy Error:", error);
                document.getElementById('spyLoading').style.display = 'none';
                document.getElementById('spyEmptyState').style.display = 'block';
                
                if (error.message.includes('Credit') || error.message.includes('limit')) {
                    // Handled by modal
                } else if (typeof showCustomAlert === 'function') {
                    showCustomAlert(`Error analyzing asset: ${error.message}`, 'error');
                } else {
                    alert(`Error analyzing asset: ${error.message}`);
                }
            } finally {
                document.getElementById('spyAnalyzeBtn').disabled = false;
            }
        };

        function renderCompetitorResults(data, url, platform, assetId, isPaidPlan) {
            const container = document.getElementById('spyResultsContainer');
            
            const keywordsList = Array.isArray(data.keywords) ? data.keywords : [];
            const plainKeywordsArray = keywordsList.map(k => typeof k === 'string' ? k : k.term);
            const plainKeywordsString = plainKeywordsArray.join(', ');
            const escapedKeywordsStr = plainKeywordsString.replace(/'/g, "\\'");
            
            // Format keywords HTML with volume indicators (locked for free users)
            const keywordsHtml = keywordsList.map(k => {
                const term = typeof k === 'string' ? k : k.term;
                const vol = typeof k === 'string' ? 'Medium' : (k.search_volume || 'Medium');
                
                if (isPaidPlan) {
                    let volColor = vol.toLowerCase() === 'high' ? '#10B981' : (vol.toLowerCase() === 'low' ? '#94A3B8' : '#F59E0B');
                    return `<span class="spy-keyword-tag">${term} <span class="spy-keyword-vol" style="color:${volColor}; background:${volColor}20;">${vol} Vol</span></span>`;
                } else {
                    return `<span class="spy-keyword-tag">${term} <span class="spy-pro-lock" onclick="scrollToPricing()" title="Upgrade to Pro to see Search Volume"><i class="fas fa-lock"></i> PRO</span></span>`;
                }
            }).join('');

            // AI Prompt Generator Area
            const promptGeneratorHtml = `
                <div class="spy-prompt-panel">
                    <h4 style="margin: 0 0 10px 0; color: #8B5CF6; font-size: 1.1em; display:flex; align-items:center; gap:8px;">
                        <i class="fas fa-magic"></i> 1-Click Reverse Prompt
                    </h4>
                    <p style="color: var(--text-muted); font-size: 0.85em; margin: 0 0 15px 0;">Generate a high-quality AI image prompt based on this asset's keywords and category to create a competing image.</p>
                    
                    <div class="spy-param-grid">
                        <div>
                            <label>AI Platform</label>
                            <select id="spyPromptPlatform">
                                <option value="Midjourney">Midjourney</option>
                                <option value="Stable Diffusion">Stable Diffusion</option>
                                <option value="DALL-E 3">DALL-E 3</option>
                            </select>
                        </div>
                        <div>
                            <label>Lighting Style</label>
                            <select id="spyPromptLighting">
                                <option value="Cinematic lighting, volumetric rays">Cinematic</option>
                                <option value="Studio lighting, soft shadows">Studio</option>
                                <option value="Natural sunlight, golden hour">Golden Hour</option>
                                <option value="Dramatic lighting, high contrast">Dramatic</option>
                            </select>
                        </div>
                        <div>
                            <label>Camera Angle</label>
                            <select id="spyPromptAngle">
                                <option value="Eye-level shot, professional composition">Eye-level</option>
                                <option value="Overhead shot, flat lay">Overhead</option>
                                <option value="Close-up macro shot, shallow depth of field">Close-up</option>
                                <option value="Wide angle shot, expansive view">Wide Angle</option>
                            </select>
                        </div>
                    </div>
                    
                    <div style="margin-top: 16px; text-align: right;">
                        <button class="action-button" onclick="window.generateSpyPrompt('${escapedKeywordsStr}')" style="padding: 8px 20px; background: #8B5CF6; border: none; color: white; border-radius: 8px; font-weight: 600; font-size: 0.85em; cursor: pointer;">
                            <i class="fas fa-bolt"></i> Generate Prompt
                        </button>
                    </div>
                    
                    <div id="spyPromptOutputBox" style="display:none;">
                        <div class="spy-prompt-output" id="spyPromptText"></div>
                        <button onclick="window.copySpyPrompt()" style="margin-top: 8px; background: rgba(139,92,246,0.1); border: 1px solid #8B5CF6; color: #8B5CF6; padding: 6px 12px; border-radius: 6px; font-size: 0.8em; cursor: pointer; float: right;">
                            <i class="fas fa-copy"></i> Copy Prompt
                        </button>
                        <div style="clear:both;"></div>
                    </div>
                </div>
            `;

            container.innerHTML = `
                <div class="spy-result-card" style="border-top: 4px solid #8B5CF6;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 20px; flex-wrap:wrap; gap:10px;">
                        <div>
                            <span style="background: rgba(139,92,246,0.1); color: #8B5CF6; padding: 4px 10px; border-radius: 6px; font-size: 0.75em; font-weight: 700; text-transform: uppercase;">
                                <i class="fas fa-satellite-dish"></i> ${platform} Analysis
                            </span>
                            <h3 style="color: var(--text-primary); margin: 10px 0 5px 0; font-size: 1.2em;">${data.asset_title || 'Analyzed Asset'}</h3>
                            <div style="color: var(--text-muted); font-size: 0.85em;">
                                <i class="fas fa-folder"></i> Category: ${data.category || 'General'}
                                <span style="margin:0 8px;">|</span>
                                <i class="fas fa-fingerprint"></i> ID: ${assetId}
                            </div>
                        </div>
                        
                        <div class="spy-metric-grid" style="grid-template-columns: 1fr;">
                            <div class="spy-metric-item" style="border-color: #8B5CF6; background: rgba(139,92,246,0.05);">
                                <span class="spy-metric-value" style="color: #8B5CF6;">${data.estimated_rank_score || '85'}</span>
                                <span class="spy-metric-label">Est. Rank Score</span>
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin-top: 20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
                            <h4 style="margin:0; color: var(--text-primary); font-size: 0.95em;">
                                <i class="fas fa-key" style="color: #F97316;"></i> Top Converting Keywords (${keywordsList.length})
                            </h4>
                            <div style="display:flex; gap:8px;">
                                <button onclick="window.copyKeywordsOnly(event, '${escapedKeywordsStr}')" style="background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-primary); padding: 5px 12px; border-radius: 6px; font-size: 0.8em; cursor: pointer;">
                                    <i class="fas fa-copy"></i> Copy
                                </button>
                                <button onclick="window.saveSpyKeywordsAsPreset('${escapedKeywordsStr}', '${(data.asset_title || '').replace(/'/g, "\\'")}')" style="background: rgba(249,115,22,0.1); border: 1px solid #F97316; color: #F97316; padding: 5px 12px; border-radius: 6px; font-size: 0.8em; cursor: pointer; font-weight: 600;">
                                    <i class="fas fa-save"></i> Save Preset
                                </button>
                            </div>
                        </div>
                        
                        <div style="display:flex; flex-wrap:wrap; gap:8px; background: rgba(0,0,0,0.1); padding: 15px; border-radius: 10px; border: 1px solid var(--border-light);">
                            ${keywordsHtml}
                        </div>
                    </div>
                    ${isPaidPlan ? `
                        <div style="margin-top: 20px; background: rgba(16, 185, 129, 0.05); border-left: 4px solid #10B981; padding: 15px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
                            <h4 style="margin:0 0 8px 0; color: #10B981; font-size: 1em;"><i class="fas fa-lightbulb"></i> AI Out-Rank Suggestion</h4>
                            <p style="margin:0; font-size: 0.9em; color: var(--text-primary); line-height: 1.5;">${data.outrank_suggestion || 'Improve the lighting, framing, or add a unique modern element to stand out against this asset.'}</p>
                        </div>
                        ${promptGeneratorHtml}
                    ` : `
                        <div class="spy-prompt-panel" style="text-align: center; padding: 30px 20px;">
                            <i class="fas fa-lock" style="font-size: 2em; color: var(--text-muted); margin-bottom: 10px;"></i>
                            <h4 style="margin: 0 0 10px 0; color: var(--text-primary);">AI Out-Rank Suggestion & Prompt Generator</h4>
                            <p style="color: var(--text-muted); font-size: 0.85em; margin: 0 auto 15px auto; max-width: 400px;">
                                Upgrade to unlock AI strategies to out-compete this asset and generate Midjourney, Stable Diffusion, and DALL-E prompts.
                            </p>
                            <button onclick="scrollToPricing()" style="background: linear-gradient(90deg, #F97316, #ea580c); border: none; color: white; padding: 8px 20px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.85em;">
                                Upgrade to Pro to Unlock
                            </button>
                        </div>
                    `}
                </div>
            `;
            
            document.getElementById('spyLoading').style.display = 'none';
            container.style.display = 'block';
        };

        window.saveSpyKeywordsAsPreset = function (keywordStr, title) {
            const keywords = keywordStr.split(',').map(k => k.trim()).filter(Boolean);
            if (keywords.length === 0) return;
            
            const presetName = prompt('Enter a name for this keyword preset:', title ? `Spy: ${title.substring(0, 20)}...` : 'Spy Keywords');
            if (!presetName || !presetName.trim()) return;

            let presets = [];
            try { presets = JSON.parse(localStorage.getItem('metagen_keyword_presets')) || []; } catch(e) {}
            
            presets.push({ name: presetName.trim(), keywords: keywords });
            localStorage.setItem('metagen_keyword_presets', JSON.stringify(presets));
            
            // Re-render sidebar if the function exists
            if (typeof window.savePresetFromCard !== 'undefined') {
                // We just force a refresh of the presets list and dropdowns using the existing system logic
                // Since renderSidebarPresets is private to the IIFE, we just rely on reloading or the next save
                if (typeof showCustomAlert === 'function') showCustomAlert(`✅ Preset "${presetName.trim()}" saved to Sidebar!`, 'success');
                else alert(`Preset saved! Check your Keyword Presets panel.`);
                
                // Hack to trigger refresh if possible
                const pList = document.getElementById('sidebarPresetsList');
                if (pList) {
                    pList.innerHTML = '<div style="font-size:0.8em; color:var(--text-muted); text-align:center; padding:10px;">Presets updated. Please refresh page to see in sidebar.</div>';
                }
            } else {
                alert("Preset saved!");
            }
        };

        window.generateSpyPrompt = async function(keywordsStr) {
            const platform = document.getElementById('spyPromptPlatform').value;
            const lighting = document.getElementById('spyPromptLighting').value;
            const angle = document.getElementById('spyPromptAngle').value;
            
            const btn = event.currentTarget;
            const originalBtnText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
            btn.disabled = true;
            
            const outputBox = document.getElementById('spyPromptOutputBox');
            const outputText = document.getElementById('spyPromptText');
            
            try {
                const user = auth.currentUser;
                let accessToken = await user.getIdToken();
                const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
                
                const prompt = `Create a highly detailed, professional AI image generation prompt for ${platform}.
Use these keywords as inspiration: ${keywordsStr.substring(0, 300)}...
Incorporate these parameters:
- Lighting: ${lighting}
- Angle/Composition: ${angle}

Return ONLY the raw prompt text. No quotes, no explanations, no markdown formatting.`;

                const response = await fetch(proxyUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({
                        action: "generateImagePrompt", 
                        prompt: prompt,
                        email: user.email,
                        deviceInfo: navigator.userAgent
                    })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || "Generation failed.");

                let generatedPrompt = data.text || data.prompt || "Error generating prompt.";
                
                // Add specific platform parameters if applicable
                if (platform === "Midjourney" && !generatedPrompt.includes("--v")) {
                    generatedPrompt += " --v 6.0 --ar 16:9 --style raw";
                }
                
                outputText.innerText = generatedPrompt;
                outputBox.style.display = 'block';
                
            } catch (error) {
                console.error(error);
                outputText.innerText = "Error generating prompt: " + error.message;
                outputBox.style.display = 'block';
            } finally {
                btn.innerHTML = originalBtnText;
                btn.disabled = false;
            }
        };

        window.copySpyPrompt = function() {
            const text = document.getElementById('spyPromptText').innerText;
            navigator.clipboard.writeText(text).then(() => {
                const btn = event.currentTarget;
                const originalHTML = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                btn.style.color = '#10B981';
                btn.style.borderColor = '#10B981';
                setTimeout(() => {
                    btn.innerHTML = originalHTML;
                    btn.style.color = '#8B5CF6';
                    btn.style.borderColor = '#8B5CF6';
                }, 2000);
            });
        };

        // --- 3. Translation Logic (Global Function) ---
        window.translateMetadata = async function (cardId) {
            const card = document.getElementById(cardId);
            const langSelect = document.getElementById(`translate-lang-${cardId}`);
            const targetLang = langSelect.value;
            const langName = langSelect.options[langSelect.selectedIndex].text;

            // UI Feedback
            const btn = card.querySelector(`button[onclick="translateMetadata('${cardId}')"]`);
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="icon-spinner"></i>';
            btn.disabled = true;

            try {
                // Get current metadata
                const titleEl = card.querySelector('.meta-title');
                const descEl = card.querySelector('.meta-description');
                const keywordsEl = card.querySelector('.meta-keywords');

                // Extract clean text from pills
                const currentKeywords = Array.from(keywordsEl.querySelectorAll('.meta-keyword-pill'))
                    .map(pill => pill.cloneNode(true))
                    .map(clone => {
                        const badge = clone.querySelector('.demand-badge'); if (badge) badge.remove();
                        const removeBtn = clone.querySelector('.keyword-remove-btn'); if (removeBtn) removeBtn.remove();
                        const scoreSpan = clone.querySelector('.keyword-score'); if (scoreSpan) scoreSpan.remove();
                        return clone.textContent.trim();
                    })
                    .filter(t => t)
                    .join(', ');

                const payload = {
                    title: titleEl.textContent.trim(),
                    description: descEl.textContent.trim(),
                    keywords: currentKeywords
                };

                // --- PLAN CHECK LOGIC (Firebase) ---
                let isPaidPlan = false;
                let currentPlan = 'free';
                let userEmail = 'unknown';
                let accessToken = '';

                try {
                    const user = auth.currentUser;
                    if (user) {
                        userEmail = user.email;
                        accessToken = await user.getIdToken();
                        currentPlan = window.userUsageData?.plan || 'free';
                        isPaidPlan = (currentPlan === 'pro' || currentPlan === 'premium' || currentPlan === 'agency');
                    }
                } catch (e) {
                    console.warn('Plan check failed for translation:', e);
                }

                let jsonString = '';

                // ================= ALL USERS LOGIC (Server-Side Only) =================
                const proxyUrl = `https://metagen-pro-api.metagenp.workers.dev/generate`;

                const response = await fetch(proxyUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({
                        action: 'translate',
                        prompt: `Translate the following metadata into ${langName}. Return ONLY a valid JSON object with keys: title, description, keywords (array of strings). Do NOT add any explanation or extra text.\n\nTitle: ${payload.title}\nDescription: ${payload.description}\nKeywords: ${Array.isArray(payload.keywords) ? payload.keywords.join(', ') : payload.keywords}`,
                        email: userEmail,
                        deviceInfo: navigator.userAgent
                    })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || "Translation API Error");

                jsonString = data.text || data.metadata || JSON.stringify(data);

                // Update Trial UI if needed
                if (data.newCount !== undefined && window.trialUsage) {
                    window.trialUsage.count = data.newCount;
                    if (typeof updateTrialUI === 'function') updateTrialUI();
                }


                // --- FIX: Robust JSON Extraction & Sanitization ---
                jsonString = jsonString.replace(/```json\s*|```/g, '').trim();
                const jsonStart = jsonString.indexOf('{');
                const jsonEnd = jsonString.lastIndexOf('}');

                if (jsonStart !== -1 && jsonEnd !== -1) {
                    jsonString = jsonString.substring(jsonStart, jsonEnd + 1);
                }

                jsonString = jsonString.replace(/[\n\t]/g, ' ');

                let translated;
                try {
                    translated = JSON.parse(jsonString);
                } catch (parseErr) {
                    console.warn('Translation JSON parse failed, attempting fallback. Raw:', jsonString.substring(0, 200));
                    // Fallback: AI returned plain text — retry with stricter prompt or show error
                    throw new Error('AI returned invalid JSON. Please try again.');
                }

                // Update UI
                if (translated.title) titleEl.textContent = translated.title;
                if (translated.description) descEl.textContent = translated.description;

                const fileData = window.uploadedFilesData.find(f => f.id === cardId);
                if (fileData) {
                    if (translated.keywords) {
                        fileData.keywords = Array.isArray(translated.keywords) ? translated.keywords.join(', ') : translated.keywords;
                    }
                    if (translated.title) fileData.title = translated.title;
                    if (translated.description) fileData.description = translated.description;
                    updateKeywordsDisplay(cardId);
                }

            } catch (error) {
                console.error("Translation Error:", error);
                if (!error.message.includes("No API Key found")) {
                    alert("Translation failed (Try again): " + error.message);
                }
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
        // --- 3.1 Batch Translation Logic ---
        window.translateAllMetadata = async function () {
            const langSelect = document.getElementById('translationLanguageSelect');
            const targetLang = langSelect.value;
            const langName = langSelect.options[langSelect.selectedIndex].text;
            const btn = document.getElementById('translateAllBtn');

            if (targetLang === 'none') {
                alert("Please select a valid translation language first.");
                return;
            }

            if (uploadedFilesData.length === 0) {
                alert("No files to translate.");
                return;
            }

            // --- PLAN CHECK (Firebase) ---
            const user = auth.currentUser;
            const userEmail = user ? user.email : null;
            const currentPlan = window.userUsageData?.plan || 'free';

            if (currentPlan !== 'pro' && currentPlan !== 'premium' && currentPlan !== 'agency') {
                alert("Translate All is a Pro/Premium feature. Please upgrade your plan.");
                openUpgradeModal('pro');
                return;
            }

            // Confirm action
            if (!confirm(`Are you sure you want to translate metadata for ALL ${uploadedFilesData.length} files into ${langName}?`)) {
                return;
            }

            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="icon-spinner"></i> Translating...';
            btn.disabled = true;

            let successCount = 0;
            let failCount = 0;

            // Iterate sequentially
            for (let i = 0; i < uploadedFilesData.length; i++) {
                const fileData = uploadedFilesData[i];
                if (!fileData || !fileData.title || fileData.title === 'Error') continue;

                // Update button progress
                btn.innerHTML = `<i class="icon-spinner"></i> ${i + 1}/${uploadedFilesData.length}`;

                try {
                    const payload = {
                        title: fileData.title,
                        description: fileData.description,
                        keywords: fileData.keywords
                    };

                    const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";
                    const response = await fetch(proxyUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            'Authorization': `Bearer ${user ? await user.getIdToken() : ""}`
                        },
                        body: JSON.stringify({
                            action: 'translate',
                            prompt: `Translate the following metadata into ${langName}. Return ONLY a valid JSON object with keys: title, description, keywords (array of strings). Do NOT add any explanation or extra text.\n\nTitle: ${payload.title}\nDescription: ${payload.description}\nKeywords: ${Array.isArray(payload.keywords) ? payload.keywords.join(', ') : payload.keywords}`,
                            email: user?.email || 'unknown',
                            deviceInfo: navigator.userAgent
                        })
                    });

                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || "Translation API Error");

                    let jsonString = data.text.replace(/```json\s*|```/g, '').trim();
                    const jsonStart = jsonString.indexOf('{');
                    const jsonEnd = jsonString.lastIndexOf('}');
                    if (jsonStart !== -1 && jsonEnd !== -1) {
                        jsonString = jsonString.substring(jsonStart, jsonEnd + 1);
                    }
                    jsonString = jsonString.replace(/[\n\t]/g, ' ');

                    let translated;
                    try {
                        translated = JSON.parse(jsonString);
                    } catch (parseErr) {
                        console.warn('Batch translate JSON parse failed for ' + fileData.name + '. Raw:', jsonString.substring(0, 200));
                        throw new Error('AI returned invalid JSON');
                    }

                    // Update Data & UI
                    if (translated.title) fileData.title = translated.title;
                    if (translated.description) fileData.description = translated.description;
                    if (translated.keywords) {
                        fileData.keywords = Array.isArray(translated.keywords) ? translated.keywords.join(', ') : translated.keywords;
                    }

                    if (typeof window.updateKeywordsDisplay === 'function') {
                        window.updateKeywordsDisplay(fileData.id);
                    }

                    // 📊 Update Usage Display (Instant local update)
                    if (window.userUsageData) {
                        window.userUsageData.count++;
                        if (window.userUsageData.monthlyCount !== undefined) window.userUsageData.monthlyCount++;
                        if (typeof updateUsageUI === 'function') updateUsageUI();
                    }

                    const card = document.getElementById(fileData.id);
                    if (card) {
                        const tEl = card.querySelector('.meta-title');
                        const dEl = card.querySelector('.meta-description');
                        if (tEl && translated.title) tEl.textContent = translated.title;
                        if (dEl && translated.description) dEl.textContent = translated.description;
                    }

                    successCount++;

                } catch (e) {
                    console.error("Batch translate error for " + fileData.name, e);
                    failCount++;
                }
            }

            btn.innerHTML = originalText;
            btn.disabled = false;

            alert(`Batch Translation Complete!\nSuccess: ${successCount}\nFailed: ${failCount}`);
        };

