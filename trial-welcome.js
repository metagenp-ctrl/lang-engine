
        // --- Welcome Power-Pack: Global Trial State & Functions ---
        window.trialPowerPack = { total: 0, used: 0, active: false, isNew: false };

        function closeGiftBoxModal() {
            const gm = document.getElementById('giftBoxModal');
            if (gm) gm.style.display = 'none';
            sessionStorage.setItem('giftBoxShown', 'true');
        }

        function updateTrialProgressUI() {
            const t = window.trialPowerPack;
            const sidebar = document.getElementById('trialProgressSidebar');
            const plan = (window.userUsageData?.plan || 'free').toLowerCase();

            if (!sidebar || plan !== 'free' || t.total <= 0 || t.used >= t.total) {
                if (sidebar) sidebar.style.display = 'none';
                updateTrialBadges(false); 
                return;
            }

            const remaining = Math.max(0, t.total - t.used);
            sidebar.style.display = 'block';

            const label = document.getElementById('trialCountLabel');
            if (label) label.textContent = remaining + '/' + t.total + ' left';

            const fill = document.getElementById('trialProgressFill');
            if (fill) {
                const pct = (remaining / t.total) * 100;
                fill.style.width = pct + '%';
                if (pct <= 20) fill.style.background = 'linear-gradient(90deg,#EF4444,#F97316)';
                else if (pct <= 60) fill.style.background = 'linear-gradient(90deg,#F59E0B,#F97316)';
                else fill.style.background = 'linear-gradient(90deg,#10B981,#3B82F6)';
            }

            const hint = document.getElementById('trialProgressHint');
            if (hint) {
                if (remaining <= 2) hint.textContent = '🔥 Almost done! Use wisely!';
                else hint.textContent = '✨ Pro features unlocked!';
            }

            // Update trial badges on Pro features
            updateTrialBadges(t.active && remaining > 0);
        }

        function updateTrialBadges(isTrialActive) {
            const proButtons = ['embedMetadataButton', 'translateAllBtn'];
            proButtons.forEach(id => {
                const btn = document.getElementById(id);
                if (!btn) return;
                let badge = btn.querySelector('.trial-badge-tag');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'trial-badge-tag';
                    btn.appendChild(badge);
                }
                if (isTrialActive) {
                    badge.className = 'trial-badge-tag trial-badge-active';
                    badge.textContent = '✨ Trial';
                } else {
                    badge.className = 'trial-badge-tag trial-badge-locked';
                    badge.textContent = '🔒 Pro';
                }
            });
        }

        function showTrialTip(used, total) {
            const remaining = total - used;
            let msg = '';
            if (used === 1) msg = '⚡ Great start! Did you know? Pro users sell 3x more by using our SEO Meter!';
            else if (used === 2) msg = '🎯 ' + remaining + ' credits left — Tip: Embed metadata to boost your stock image acceptance rate!';
            else if (used === 3) msg = '🔥 Only ' + remaining + ' left! Pro members never worry about stock rejections.';
            else if (used === 4) msg = '⏰ Last credit! Upgrade to keep your SEO scores high forever!';
            else if (used >= total) msg = '🏁 Trial complete! You optimized ' + total + ' images like a Pro — Upgrade for unlimited access!';
            else msg = '✨ ' + remaining + ' Pro credits remaining';

            const existing = document.querySelectorAll('.trial-toast');
            existing.forEach(e => e.remove());

            const toast = document.createElement('div');
            toast.className = 'trial-toast';
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4200);
        }

        function checkTrialEnded() {
            const t = window.trialPowerPack;
            if (t.total > 0 && t.used >= t.total && !sessionStorage.getItem('trialEndedShown')) {
                sessionStorage.setItem('trialEndedShown', 'true');
                const sc = document.getElementById('trialSummaryCount');
                if (sc) sc.textContent = t.total;
                setTimeout(() => {
                    const m = document.getElementById('trialEndedModal');
                    if (m) m.style.display = 'flex';
                }, 1500);
            }
        }



        // New Helper to hide/show API Key buttons for Paid Users
        function updateVisibility() {
            const plan = (window.userUsageData?.plan || 'free').toLowerCase();
            const t = window.trialPowerPack || {};
            const isTrialActive = plan === 'free' && t.active && t.total > 0 && t.used < t.total;

            // শুধু অপ্রয়োজনীয় এলিমেন্টগুলো ধরুন
            const apiKeyButtons = document.querySelector('.api-key-buttons');
            const trialContainer = document.getElementById('trialStatusContainer');

            if (plan === 'pro' || plan === 'premium' || plan === 'agency' || isTrialActive) {
                // প্রো বা প্রিমিয়াম হলে শুধু এপিআই কি সেকশন লুকাবেন (ট্রান্সলেশন নয়)
                if (apiKeyButtons) apiKeyButtons.style.display = 'none';
                if (trialContainer) trialContainer.style.display = 'none';
                if (batchTranslateButton) batchTranslateButton.style.display = 'none';

                // প্রো ফিচারগুলো আনলক করুন
                document.querySelectorAll('.pro-feature-locked').forEach(el => {
                    el.classList.remove('pro-feature-locked');
                    const overlay = el.querySelector('.locked-overlay');
                    if (overlay) overlay.style.display = 'none';
                });
            } else {
                // ফ্রি ইউজার হলে দেখান
                if (apiKeyButtons) apiKeyButtons.style.display = 'flex';
                if (translateAllBtn) translateAllBtn.style.display = 'none';

            }
            // Update Power-Pack sidebar progress
            if (typeof updateTrialProgressUI === 'function') updateTrialProgressUI();
        }

        // fetchTrialCredits removed — trial state is now synced via getMetadataUsage and /user/sync
