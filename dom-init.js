// MetaGen Pro - DOM Init Module
document.addEventListener('DOMContentLoaded', function () {
    if (typeof showLoadingState === 'function') showLoadingState();
    // --- NEW: Sidebar Toggle Logic ---
    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    const sidebar = document.getElementById('appSidebar');
    const body = document.body;

    sidebarToggleBtn.addEventListener('click', () => {
        // For larger screens, toggle a class on the body
        // For larger screens, toggle a class on the body
        if (window.innerWidth > 768) {
            body.classList.toggle('sidebar-hidden');
        } else {
            // For smaller screens, toggle a 'visible' class on the sidebar for overlay effect
            sidebar.classList.toggle('visible');
        }
    });

    // Hide sidebar on click outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            if (sidebar.classList.contains('visible') && !sidebar.contains(e.target) && !sidebarToggleBtn.contains(e.target) && !e.target.closest('.sidebar-toggle-btn')) {
                sidebar.classList.remove('visible');
            }
        }
    });


    // Initialize collapsible sections
    const collapsibleHeaders = document.querySelectorAll('.collapsible-header');
    collapsibleHeaders.forEach(header => {
        const content = header.nextElementSibling;
        if (content && content.classList.contains('collapsible-content')) {
            content.style.display = 'none';
            content.style.maxHeight = '0';
            header.classList.remove('open');
        }
        header.addEventListener('click', function () {
            const content = this.nextElementSibling;
            if (content && content.classList.contains('collapsible-content')) {
                this.classList.toggle('open');
                if (this.classList.contains('open')) {
                    content.style.display = 'block';
                    requestAnimationFrame(() => {
                        content.style.maxHeight = content.scrollHeight + 'px';
                    });
                } else {
                    content.style.maxHeight = '0';
                    content.addEventListener('transitionend', function handler() {
                        if (!header.classList.contains('open')) {
                            content.style.display = 'none';
                        }
                        content.removeEventListener('transitionend', handler);
                    });
                }
            }
        });
    });

    // Sliders value update
    const sliders = document.querySelectorAll('.slider-group input[type="range"]');
    sliders.forEach(slider => {
        const valueSpan = document.getElementById(slider.id + 'Value');
        if (valueSpan) {
            slider.addEventListener('input', function () { valueSpan.textContent = this.value; });
        }
    });

    // --- BUTTONS & GLOBALS ---
    const jpgPngButton = document.getElementById('jpgPngUploadButton');
    const jpgPngInput = document.getElementById('jpgPngInput');
    const svgEpsButton = document.getElementById('svgEpsUploadButton');
    const svgEpsInput = document.getElementById('svgEpsInput');
    const videoButton = document.getElementById('videoUploadButton');
    const videoInput = document.getElementById('videoInput');
    const previewContainer = document.getElementById('filePreviewContainer');
    const processAllButton = document.getElementById('processAllButton');
    const processAllPromptsButton = document.getElementById('processAllPromptsButton');
    const exportButton = document.getElementById('exportButton');
    const embedMetadataButton = document.getElementById('embedMetadataButton');
    const clearAllButton = document.getElementById('clearAllButton');

    window.showProUpgradeAlert = function () {
        alert("Upgrade to Pro to unlock SEO Score & Rejection Predictor.");
        if (typeof scrollToPricing === 'function') scrollToPricing();
    };

    function setupModal(buttonId, modalId, saveButtonId, inputId, storageKey, closeButtonId) {

        const modal = document.getElementById(modalId);
        if (!modal) return;
        const button = document.getElementById(buttonId);
        const saveButton = document.getElementById(saveButtonId);
        const input = document.getElementById(inputId);
        const closeButton = closeButtonId ? document.getElementById(closeButtonId) : modal.querySelector('.close-button');
        if (button) button.onclick = () => {
            if (input) input.value = localStorage.getItem(storageKey) || '';
            modal.style.display = 'flex';
        };
        if (saveButton) saveButton.onclick = () => {
            if (input && input.value.trim()) {
                localStorage.setItem(storageKey, input.value.trim());
                alert('API Key saved successfully!');
                modal.style.display = 'none';
            } else {
                alert('Please enter a valid API key.');
            }
        };
        if (closeButton) closeButton.onclick = () => { modal.style.display = 'none'; };
        window.addEventListener('click', (event) => { if (event.target === modal) modal.style.display = 'none'; });
    }

    setupModal('convertapiKeyButton', 'convertapi-key-modal', 'saveConvertapiKeyButton', 'convertapiKeyInput', 'convertApiKey', null);

    // --- CUSTOM PROMPT TOGGLE ---
    const toggleCustomPrompt = document.getElementById('toggleCustomPrompt');
    const customPromptSection = document.getElementById('customPromptSection');
    if (toggleCustomPrompt && customPromptSection) {
        toggleCustomPrompt.addEventListener('change', function () {
            customPromptSection.style.display = this.checked ? 'block' : 'none';
        });
    }

    // --- [UPDATED] PLATFORM BUTTONS LOGIC (Single Selection) ---
    const platformContainer = document.querySelector('.platform-toggle-group');
    if (platformContainer) {
        const platformButtons = platformContainer.querySelectorAll('.platform-button');
        platformContainer.addEventListener('click', function (e) {
            const clickedButton = e.target.closest('.platform-button');
            if (!clickedButton) return;

            // ১. সব বাটন থেকে active ক্লাস রিমুভ করে ক্লিক করা বাটনে যোগ করা
            platformButtons.forEach(btn => btn.classList.remove('active'));
            clickedButton.classList.add('active');

            const selectedPlatform = clickedButton.dataset.platform;

            // ২. Shutterstock Category প্যানেল কন্ট্রোল (যদি থাকে)
            const sstCatPanel = document.getElementById('shutterstockCategoryPanel');
            if (sstCatPanel) {
                sstCatPanel.style.display = (selectedPlatform === 'shutterstock') ? 'block' : 'none';
            }

            // ৩. রেজাল্ট কার্ডের ভেতরকার Adobe Category সেকশন কন্ট্রোল
            // আমরা রেজাল্ট কার্ডের সেই সেকশনটিতে 'adobe-only-section' ক্লাস ব্যবহার করব
            const allAdobeSections = document.querySelectorAll('.adobe-only-section');
            allAdobeSections.forEach(section => {
                if (selectedPlatform === 'adobe') {
                    section.style.display = 'block'; // Adobe Stock সিলেক্ট করলে দেখাবে
                } else {
                    section.style.display = 'none'; // অন্যথায় লুকাবে
                }
            });

            // ৪. Affiliate CTA — প্ল্যাটফর্ম অনুসারে সাইনআপ রেফারেল দেখানো
            const affCta = document.getElementById('platformAffiliateCta');
            const affText = document.getElementById('affiliateCtaText');
            const affLink = document.getElementById('affiliateCtaLink');
            const affiliateMap = {
                'shutterstock': { text: 'Not a Shutterstock contributor yet? Sign up & start earning up to 40% per download!', url: 'https://submit.shutterstock.com/?ref=YOUR_SHUTTERSTOCK_REF', btn: 'Join Shutterstock →' },
                'adobe': { text: 'Not registered on Adobe Stock? Join as a contributor & earn 33% commission!', url: 'https://contributor.stock.adobe.com/?ref=YOUR_ADOBE_REF', btn: 'Join Adobe Stock →' },
                'vecteezy': { text: 'Want to sell on Vecteezy? Become a contributor & reach millions of buyers!', url: 'https://www.vecteezy.com/contributors?ref=YOUR_VECTEEZY_REF', btn: 'Join Vecteezy →' },
                'pond5': { text: 'Sell your photos & videos on Pond5! Join one of the largest media marketplaces.', url: 'https://www.pond5.com/sell-media?ref=YOUR_POND5_REF', btn: 'Join Pond5 →' },
                '123RF': { text: 'Become a 123RF contributor and monetize your creative work worldwide!', url: 'https://www.123rf.com/contributors/?ref=YOUR_123RF_REF', btn: 'Join 123RF →' },
                'Magnific': { text: 'Start selling on Magnific and reach a growing creative community!', url: 'https://contributor.magnific.com?utm_campaign=pradipcob84&utm_medium=referral-content&utm_source=referral', btn: 'Join Magnific →' }
            };
            if (affCta && affiliateMap[selectedPlatform]) {
                const aff = affiliateMap[selectedPlatform];
                affText.textContent = aff.text;
                affLink.href = aff.url;
                affLink.textContent = aff.btn;
                affCta.style.display = 'flex';
            } else if (affCta) {
                affCta.style.display = 'none';
            }
        });
    }



    const style = document.createElement('style');
    style.textContent = `
    .icon-copy:before { content: "📋"; }
    .icon-check:before { content: "✓"; }
    .icon-download:before { content: "⬇"; }
    .icon-embed:before { content: "📥"; }
    .icon-error:before { content: "✕"; }
    .icon-process:before { content: "⚙️"; }
    .icon-export-csv:before { content: "📄"; }
    .icon-info:before { content: "ℹ️"; }
    .icon-clear:before { content: "🗑️"; }
    .icon-api-key:before { content: "🔑"; }
    .icon-metadata:before { content: "📝"; margin-right: 5px; }
    .icon-image-to-prompt:before { content: "🖼️"; margin-right: 5px; }
    .icon-dalle:before { content: "✨"; margin-right: 5px; }
    .icon-dropdown-arrow:before { content: "▼"; display: inline-block; transition: transform 0.3s; margin-left: 10px; margin-top: 8px; }
    .collapsible-header.open .icon-dropdown-arrow:before { transform: rotate(180deg); }
    .icon-spinner:before { content: "𖤓"; animation: spin 1s linear infinite; display: inline-block; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    /* Export Dropdown Styles */
    .export-dropdown {
        position: relative;
        display: inline-block;
    }

    .export-dropdown-content {
        display: none;
        position: absolute;
        right: 0;
        background-color: var(--bg-tertiary);
        min-width: 160px;
        box-shadow: 0 8px 16px 0 rgba(0,0,0,0.2);
        z-index: 1;
        border-radius: 8px;
        border: 1px solid var(--border-color);
        overflow: hidden;
    }

    .export-dropdown-content a {
        color: var(--text-primary);
        padding: 12px 16px;
        text-decoration: none;
        display: block;
        font-size: 0.9em;
        transition: background-color 0.2s;
    }

    .export-dropdown-content a:hover {
        background-color: var(--bg-input);
        color: var(--accent-orange);
    }

    .export-dropdown.show .export-dropdown-content {
        display: block;
    }

    .login-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        display: flex;
        z-index: 9999;
        overflow: hidden;
    }

    .login-modal.hidden {
        display: none;
    }

    .login-split-layout {
        display: flex;
        width: 100%;
        height: 100%;
    }

    /* Left Pane */
    .login-left-pane {
        position: relative;
        width: 50%;
        background: linear-gradient(135deg, #7B2FF2 0%, #9B59B6 25%, #2196F3 50%, #00BCD4 75%, #7B2FF2 100%);
        background-size: 400% 400%;
        animation: loginGradientShift 12s ease infinite;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        padding: 40px;
    }

    @keyframes loginGradientShift {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
    }

    /* Floating Bubbles */
    .login-bubble {
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(4px);
    }

    .login-bubble-1 {
        width: 200px; height: 200px;
        top: -40px; left: -40px;
        animation: loginBubbleFloat1 8s ease-in-out infinite;
    }
    .login-bubble-2 {
        width: 120px; height: 120px;
        top: 30%; right: -20px;
        background: rgba(255, 255, 255, 0.1);
        animation: loginBubbleFloat2 10s ease-in-out infinite;
    }
    .login-bubble-3 {
        width: 80px; height: 80px;
        bottom: 20%; left: 15%;
        background: rgba(255, 255, 255, 0.12);
        animation: loginBubbleFloat3 7s ease-in-out infinite;
    }
    .login-bubble-4 {
        width: 300px; height: 300px;
        bottom: -80px; right: -60px;
        background: rgba(255, 255, 255, 0.05);
        animation: loginBubbleFloat4 14s ease-in-out infinite;
    }
    .login-bubble-5 {
        width: 50px; height: 50px;
        top: 55%; left: 50%;
        background: rgba(255, 255, 255, 0.15);
        animation: loginBubbleFloat5 6s ease-in-out infinite;
    }
    .login-bubble-6 {
        width: 160px; height: 160px;
        top: 10%; left: 60%;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        animation: loginBubbleFloat6 11s ease-in-out infinite;
    }

    @keyframes loginBubbleFloat1 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50% { transform: translate(30px, 40px) scale(1.1); }
    }
    @keyframes loginBubbleFloat2 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50% { transform: translate(-25px, 30px) scale(0.9); }
    }
    @keyframes loginBubbleFloat3 {
        0%, 100% { transform: translate(0, 0); }
        50% { transform: translate(20px, -25px); }
    }
    @keyframes loginBubbleFloat4 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50% { transform: translate(-40px, -30px) scale(1.05); }
    }
    @keyframes loginBubbleFloat5 {
        0%, 100% { transform: translate(0, 0); }
        50% { transform: translate(-15px, 20px); }
    }
    @keyframes loginBubbleFloat6 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50% { transform: translate(20px, -35px) scale(1.08); }
    }

    /* Left pane content */
    .login-left-content {
        position: relative;
        z-index: 2;
        color: #fff;
        max-width: 420px;
        animation: loginSlideInLeft 0.6s ease-out;
    }

    @keyframes loginSlideInLeft {
        from { opacity: 0; transform: translateX(-30px); }
        to { opacity: 1; transform: translateX(0); }
    }

    .login-left-logo {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 30px;
    }

    .login-logo-icon {
        font-size: 1.6em;
        filter: drop-shadow(0 0 6px rgba(255,255,255,0.4));
    }

    .login-logo-text {
        font-size: 1.2em;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    .login-left-title {
        font-size: 2.5em;
        font-weight: 800;
        line-height: 1.1;
        margin: 0 0 12px 0;
        text-shadow: 0 4px 20px rgba(0,0,0,0.15);
        color: #fff;
    }

    .login-left-subtitle {
        font-size: 1.1em;
        opacity: 0.85;
        margin: 0 0 35px 0;
        letter-spacing: 0.03em;
        color: aquamarine;
    }

    .login-features-list {
        display: flex;
        flex-direction: column;
        gap: 18px;
        margin-bottom: 40px;
    }

    .login-feature-item {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 14px 16px;
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        transition: transform 0.2s ease, background 0.2s ease;
    }

    .login-feature-item:hover {
        transform: translateX(6px);
        background: rgba(255, 255, 255, 0.16);
    }

    .login-feature-icon {
        font-size: 1.5em;
        flex-shrink: 0;
        margin-top: 2px;
    }

    .login-feature-item strong {
        font-size: 0.95em;
        display: block;
        margin-bottom: 3px;
    }

    .login-feature-item p {
        font-size: 0.82em;
        margin: 0;
        opacity: 0.8;
        line-height: 1.4;
    }

    .login-left-footer {
        font-size: 0.85em;
        opacity: 0.6;
        letter-spacing: 0.12em;
        text-transform: uppercase;
    }

    /* Right Pane */
    .login-right-pane {
        width: 50%;
        background: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        padding: 40px;
        overflow-y: auto;
    }

    .login-close-btn {
        position: absolute;
        top: 18px;
        right: 22px;
        background: none;
        border: none;
        font-size: 1.8em;
        color: #999;
        cursor: pointer;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.2s;
        z-index: 10;
    }

    .login-close-btn:hover {
        background: #f0f0f0;
        color: #333;
    }

    .login-container {
        max-width: 380px;
        width: 100%;
        animation: loginSlideInRight 0.6s ease-out;
    }

    @keyframes loginSlideInRight {
        from { opacity: 0; transform: translateX(30px); }
        to { opacity: 1; transform: translateX(0); }
    }

    .login-header {
        margin-bottom: 8px;
    }

    .login-greeting {
        font-size: 1.6em;
        font-weight: 700;
        color: #1a1a2e;
        margin: 0 0 2px 0;
    }

    .login-time-greeting {
        font-size: 1.1em;
        color: #7B2FF2;
        font-weight: 500;
        margin: 0 0 20px 0;
    }

    .login-form-title {
        font-size: 1.05em;
        color: #333;
        margin: 0 0 25px 0;
        font-weight: 500;
    }

    .login-form-group {
        margin-bottom: 20px;
    }

    .login-form-group label {
        display: block;
        color: #666;
        font-weight: 500;
        margin-bottom: 6px;
        font-size: 0.88em;
        letter-spacing: 0.02em;
    }

    .login-form-group input {
        width: 100%;
        padding: 10px 2px;
        background: transparent;
        border: none;
        border-bottom: 2px solid #e0e0e0;
        color: #1a1a2e;
        font-size: 0.95em;
        box-sizing: border-box;
        transition: border-color 0.3s ease;
        outline: none;
        border-radius: 0;
    }

    .login-form-group input:focus {
        border-bottom-color: #7B2FF2;
    }

    .login-form-group input::placeholder {
        color: #bbb;
    }

    .login-options-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 22px;
        font-size: 0.82em;
    }

    .login-remember {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #666;
        cursor: pointer;
    }

    .login-remember input[type="checkbox"] {
        width: 15px;
        height: 15px;
        accent-color: #7B2FF2;
        cursor: pointer;
    }

    .login-forgot {
        color: #7B2FF2;
        text-decoration: none;
        font-weight: 500;
        transition: color 0.2s;
    }

    .login-forgot:hover {
        color: #5a1fbf;
        text-decoration: underline;
    }

    .login-button {
        width: 100%;
        padding: 13px 16px;
        border: none;
        border-radius: 6px;
        font-weight: 700;
        font-size: 0.95em;
        cursor: pointer;
        transition: all 0.3s ease;
        text-align: center;
        letter-spacing: 0.08em;
    }

    .login-button.primary {
        background: linear-gradient(135deg, #7B2FF2 0%, #2196F3 100%);
        color: white;
        box-shadow: 0 4px 15px rgba(123, 47, 242, 0.3);
    }

    .login-button.primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 22px rgba(123, 47, 242, 0.45);
    }

    .login-button.primary:active {
        transform: translateY(0);
    }

    .login-button.google-button {
        background: #fff;
        color: #333;
        border: 1.5px solid #e0e0e0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        font-weight: 600;
        letter-spacing: 0.02em;
    }

    .login-button.google-button:hover {
        background: #f7f7f7;
        transform: translateY(-1px);
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
    }

    .login-divider {
        display: flex;
        align-items: center;
        margin: 22px 0;
        gap: 12px;
    }

    .login-divider-line {
        flex: 1;
        height: 1px;
        background: #e0e0e0;
    }

    .login-divider span {
        color: #aaa;
        font-size: 0.8em;
        font-weight: 500;
        letter-spacing: 0.05em;
    }

    .login-toggle {
        text-align: center;
        margin-top: 20px;
        color: #888;
        font-size: 0.9em;
    }

    .login-toggle a {
        color: #7B2FF2;
        cursor: pointer;
        text-decoration: none;
        font-weight: 600;
    }

    .login-toggle a:hover {
        text-decoration: underline;
    }

    .login-error {
        background: #fef2f2;
        border: 1px solid #fca5a5;
        color: #b91c1c;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 18px;
        font-size: 0.88em;
        display: none;
    }

    .login-error.show {
        display: block;
    }

    .login-success {
        background: #f0fdf4;
        border: 1px solid #86efac;
        color: #166534;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 18px;
        font-size: 0.88em;
        display: none;
    }

    .login-success.show {
        display: block;
    }

    /* Responsive: Stack on mobile */
    @media (max-width: 768px) {
        .login-split-layout {
            flex-direction: column;
        }
        .login-left-pane {
            width: 100%;
            min-height: 220px;
            padding: 30px 24px;
        }
        .login-left-title {
            font-size: 2em;
        }
        .login-features-list {
            display: none;
        }
        .login-right-pane {
            width: 100%;
            flex: 1;
            padding: 30px 24px;
        }
    }

    .user-profile {
        position: fixed;
        top: 70px;
        right: 20px;
        display: none;
        align-items: center;
        gap: 15px;
        z-index: 1000;
    }

    .user-profile.visible {
        display: flex;
    }

    .user-email {
        color: #E2E8F0;
        font-size: 0.9em;
        background: #1E293B;
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid #334155;
    }

    .logout-btn {
        background: #EF4444;
        color: white;
        border: none;
        padding: 8px 14px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 0.85em;
        transition: background 0.2s;
        display: none; /* Hidden - removed from header */
    }

    .logout-btn:hover {
        background: #DC2626;
    }

        /* Profile Header Button */
        .profile-header-btn {
            background: none;
            border: 1.5px solid #334155;
            color: #F8FAFC;
            border-radius: 8px;
            cursor: pointer;
            padding: 4px 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            width: 38px;
            height: 34px;
        }

        .profile-avatar-small {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #7C7CED 0%, #5B5BED 100%);
            color: white;
            font-weight: 600;
            font-size: 0.9em;
            overflow: hidden;
        }

        .profile-header-btn:hover {
            background-color: #334155;
            border-color: #F97316;
            color: #F97316;
            transform: scale(1.05);
        }

        /* Profile Modal Styles */
        .profile-modal {
            position: fixed;
            top: 65px;
            right: 20px;
            background: var(--bg-modal);
            border-radius: 12px;
            box-shadow: 0 8px 32px var(--shadow-md);
            border: 1.5px solid var(--border-color);
            width: 350px;
            max-width: 90vw;
            z-index: 2000;
            display: flex;
            flex-direction: column;
            animation: slideDown 0.3s ease-out;
        }

        .profile-modal.hidden {
            display: none;
        }

        @keyframes slideDown {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .profile-modal-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 1999;
        }

        .profile-modal-backdrop.hidden {
            display: none;
        }

    .profile-modal-close {
        position: absolute;
        top: 12px;
        right: 12px;
        background: none;
        border: none;
        color: #94A3B8;
        font-size: 1.6em;
        cursor: pointer;
        transition: color 0.2s ease;
        padding: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
    }

    .profile-modal-close:hover {
        color: #F97316;
    }

    .profile-modal-body {
        padding: 28px 20px 20px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        position: relative;
        overflow-y: auto;
        height: 580px;
    }

    .profile-avatar-section {
        margin-bottom: 4px;
    }

    .profile-avatar {
        width: 96px;
        height: 96px;
        background: linear-gradient(135deg, #7C7CED 0%, #5B5BED 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        box-shadow: 0 4px 16px rgba(123, 124, 237, 0.4);
        position: relative;
        overflow: hidden;
    }

    .profile-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .profile-avatar svg {
        color: white;
    }

    .profile-user-info {
        text-align: center;
        width: 100%;
    }

    .profile-user-info h2 {
        color: var(--text-primary);
        margin: 0 0 4px 0;
        font-size: 1.1em;
        font-weight: 600;
    }

    .profile-user-info p {
        color: var(--text-secondary);
        margin: 0;
        font-size: 0.85em;
    }

    .profile-divider {
        width: calc(100% + 40px);
        height: 1px;
        background: var(--border-color);
        margin: 0 -20px;
    }

    .profile-actions {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    .profile-action-btn {
        width: 100%;
        padding: 12px 16px;
        background: none;
        border: none;
        border-bottom: 1px solid var(--border-color);
        color: var(--text-secondary);
        font-weight: 500;
        font-size: 0.9em;
        cursor: pointer;
        transition: background 0.2s ease;
        display: flex;
        align-items: center;
        gap: 12px;
        text-align: left;
    }

    .profile-action-btn:last-child {
        border-bottom: none;
    }

    .profile-action-btn:hover {
        background: var(--bg-tertiary);
    }

    .profile-action-btn span:first-child {
        font-size: 1.2em;
    }

    .profile-footer {
        width: 100%;
        text-align: center;
        padding-top: 12px;
        color: #64748B;
        font-size: 0.75em;
    }

    .profile-footer a {
        color: #64748B;
        text-decoration: none;
        transition: color 0.2s ease;
    }

    .profile-footer a:hover {
        color: #94A3B8;
    }

    .profile-dot {
        margin: 0 4px;
    }        @media (max-width: 600px) {
            .profile-modal {
                width: calc(100vw - 40px);
                right: 20px;
            }
        }
`;
    document.head.appendChild(style);
});
