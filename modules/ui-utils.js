
        // Loading State Management
        function showLoadingState() {
            // Show initial loading overlay (independent of login modal)
            const init = document.getElementById('initialLoading');
            if (init) init.classList.remove('hidden');
            // hide login/signup forms while loading
            const lf = document.getElementById('loginFormContainer'); if (lf) lf.style.display = 'none';
            const sf = document.getElementById('signupFormContainer'); if (sf) sf.style.display = 'none';

            clearTimeout(window._loadingFailSafe);
            window._loadingFailSafe = setTimeout(hideLoadingState, 1500);
        }

        function hideLoadingState() {
            const init = document.getElementById('initialLoading');
            if (init) init.classList.add('hidden');
    
            sessionStorage.setItem('metagen_loaded_once', 'true');

            const lf = document.getElementById('loginFormContainer'); if (lf) lf.style.display = 'block';
            const sf = document.getElementById('signupFormContainer'); if (sf) sf.style.display = 'none';
            clearTimeout(window._loadingFailSafe);
        }

        /* FAQ modal open/close handlers with focus trap and backdrop click */
        function openFaqModal() {
            const m = document.getElementById('faqModal');
            if (!m) return;
            m.style.display = 'flex';
            // prevent background scroll
            document.documentElement.style.overflow = 'hidden';
            document.body.style.overflow = 'hidden';
            // focus first interactive element
            const closeBtn = document.getElementById('closeFaqModal');
            if (closeBtn) closeBtn.focus();
            // add keyboard trap
            document.addEventListener('keydown', _faqKeyHandler);
        }

        function closeFaqModal() {
            const m = document.getElementById('faqModal');
            if (!m) return;
            m.style.display = 'none';
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
            document.removeEventListener('keydown', _faqKeyHandler);
        }

        // Trap Tab focus inside modal and handle Escape
        function _faqKeyHandler(e) {
            const modal = document.getElementById('faqModal');
            if (!modal || modal.style.display !== 'flex') return;
            if (e.key === 'Escape') { e.preventDefault(); closeFaqModal(); return; }
            if (e.key !== 'Tab') return;
            const focusable = modal.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])');
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
            else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
        }

        // Close handlers: close button and overlay/backdrop click
        (function () {
            const closeFaq = document.getElementById('closeFaqModal');
            if (closeFaq) closeFaq.addEventListener('click', closeFaqModal);
            const faqOverlay = document.getElementById('faqModal');
            if (faqOverlay) faqOverlay.addEventListener('click', function (e) { if (e.target === faqOverlay) closeFaqModal(); });
            const closePolicy = document.getElementById('closePolicyModal');
            if (closePolicy) closePolicy.addEventListener('click', function () { const pm = document.getElementById('policyModal'); if (pm) pm.style.display = 'none'; });
        })();

        // Accordion behavior
        (function () {
            function togglePanel(btn) {
                const expanded = btn.getAttribute('aria-expanded') === 'true';
                const panelId = btn.getAttribute('aria-controls');
                const panel = document.getElementById(panelId);
                if (!panel) return;
                if (expanded) { btn.setAttribute('aria-expanded', 'false'); panel.style.maxHeight = null; btn.querySelector('.faq-caret').style.transform = ''; }
                else { btn.setAttribute('aria-expanded', 'true'); panel.style.maxHeight = panel.scrollHeight + 'px'; btn.querySelector('.faq-caret').style.transform = 'rotate(90deg)'; }
            }
            const toggles = document.querySelectorAll('.faq-toggle');
            toggles.forEach(btn => {
                btn.addEventListener('click', function () { togglePanel(btn); });
                btn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(btn); } });
            });
        })();

