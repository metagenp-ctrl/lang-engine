// ===========================================
// MetaGen Pro - Module Loader
// ===========================================
// Original monolithic app.js has been split into
// focused module files for maintainability.
// Each module is loaded in the correct dependency order.
// ===========================================

(function loadModules() {
    const modules = [
        'modules/core-init.js',        // Firebase config, auth, db globals, saveUserProfile, initFirebase
        'modules/ui-utils.js',          // Loading state, FAQ modal, accordion
        'modules/admin.js',             // Admin dashboard, user management, gift credits
        'modules/trial-welcome.js',     // Welcome Power-Pack, trial UI, visibility helpers
        'modules/auth.js',              // Login, signup, Google OAuth, profile, logout, hero landing
        'modules/dom-init.js',          // DOMContentLoaded block: file upload, processing, metadata, export, FTP
        'modules/feedback.js',          // Feedback modal, star rating, email sending
        'modules/advanced-features.js', // Trending topics, niche research, theme, translation, AI model
        'modules/misc-utils.js',        // SEO info, cookie consent, usage tracking, view toggle, similarity, language, payment
        'modules/image-tools.js',       // AI Healing, Sales Prediction, Smart Folder Watcher
        'modules/session-history.js',   // IndexedDB session, metadata history, workspace restore
        'modules/bg-removal-seofix.js', // Background removal (ClipDrop), SEO auto-fix handler
        'modules/streak-presets.js'     // Daily Streak, Keyword Presets, Review stats
    ];

    // Determine the base URL for module files
    const scripts = document.getElementsByTagName('script');
    let baseUrl = '';
    for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src || '';
        if (src.includes('app.js')) {
            baseUrl = src.substring(0, src.lastIndexOf('/') + 1);
            break;
        }
    }

    // Load each module sequentially — wait for onload before loading the next
    function loadNext(index) {
        if (index >= modules.length) return;
        const script = document.createElement('script');
        script.src = baseUrl + modules[index];
        script.onload = function () { loadNext(index + 1); };
        script.onerror = function () {
            console.error('Failed to load module: ' + modules[index]);
            loadNext(index + 1);
        };
        document.head.appendChild(script);
    }
    loadNext(0);
})();
