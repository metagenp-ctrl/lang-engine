        // Check if user is already logged in
        async function checkAuthState() {
            if (!auth) return;
            try {
                const user = auth.currentUser;

                if (user) {
                    const displayName = user.displayName || user.email.split('@')[0];
                    const avatarUrl = user.photoURL;
                    showMainApp(user.email, displayName, avatarUrl);
                } else {
                    hideLoadingState();
                    showMainApp();

                    if (sessionStorage.getItem('show_login_on_reload') === 'true') {
                        sessionStorage.removeItem('show_login_on_reload');
                        showLoginModal();
                    }
                }
            } catch (err) {
                console.error('Auth check error:', err);
                hideLoadingState();
                showMainApp();
            }
        }

        function showLoginModal() {
            // Open the login modal as an overlay without hiding the main app
            document.getElementById('loginModal').classList.remove('hidden');
            // Keep app visible so user can still interact or see background
        }

        // Helper function to generate Gravatar URL from email
        function getGravatarUrl(email) {
            const hash = CryptoJS.MD5(email.trim().toLowerCase()).toString();
            return `https://www.gravatar.com/avatar/${hash}?s=96&amp;d=identicon`;
        }

        // Update header profile button with avatar image or initial letter
        function updateHeaderProfileImage(email, displayName, avatarUrl) {
            const avatarImg = document.getElementById('profileAvatarSmallImg');
            const avatarInitial = document.getElementById('profileAvatarSmallInitial');
            const avatarDefault = document.getElementById('profileAvatarSmallDefault');

            const firstName = displayName || email.split('@')[0];
            const initial = firstName.charAt(0).toUpperCase();

            // FIX: Use Google avatarUrl if available, otherwise use Gravatar
            let finalSrc;
            if (avatarUrl) {
                finalSrc = avatarUrl;
            } else {
                finalSrc = getGravatarUrl(email);
            }

            // Set image source
            avatarImg.src = finalSrc;

            // Hide default icon, show image
            avatarDefault.style.display = 'none';
            avatarImg.style.display = 'block';
            avatarInitial.style.display = 'none';

            // If image fails to load (broken link), show initial letter instead
            avatarImg.onerror = function () {
                avatarImg.style.display = 'none';
                avatarInitial.textContent = initial;
                avatarInitial.style.display = 'block';
            };
        }
        // Reset header profile button to default icon
        function resetHeaderProfileImage() {
            const avatarImg = document.getElementById('profileAvatarSmallImg');
            const avatarInitial = document.getElementById('profileAvatarSmallInitial');
            const avatarDefault = document.getElementById('profileAvatarSmallDefault');

            avatarImg.style.display = 'none';
            avatarInitial.style.display = 'none';
            avatarDefault.style.display = 'block';
        }

       async function showMainApp(email, displayName, avatarUrl) {
            if (typeof hideLoadingState === 'function') hideLoadingState();
           
            const loginModal = document.getElementById('loginModal');
            if (loginModal) loginModal.classList.add('hidden');

            const appContainer = document.querySelector('.app-container');
            if (appContainer) appContainer.style.display = 'flex';

            const usageIndicator = document.getElementById('headerUsageLimit');

            // Show header profile icon always so user can open login/profile
            try { document.getElementById('profileHeaderBtn').style.display = 'flex'; } catch (e) { }

            const btnFreeTrial = document.getElementById('heroBtnFreeTrial');
            const btnTryFree = document.getElementById('heroBtnTryFree');
            const btnBuyPkg = document.getElementById('heroBtnBuyPkg');

            if (email) {
                if (btnFreeTrial) btnFreeTrial.style.display = 'none';
                if (btnTryFree) btnTryFree.style.display = '';
                if (btnBuyPkg) btnBuyPkg.style.display = '';

                // --- NEW: Record Referral if exists ---
                const referrerEmailStored = localStorage.getItem('metagen_referrer');
                if (referrerEmailStored) {
                    try {
                        const referrerEmail = referrerEmailStored.toLowerCase();
                        const currentUserEmail = email.toLowerCase();

                        if (referrerEmail !== currentUserEmail) {

                            const userRef = db.collection('users').doc(currentUserEmail);
                            const userDoc = await userRef.get();

                            if (!userDoc.exists || !userDoc.data().referred_by) {

                                const refDoc = db.collection('users').doc(referrerEmail);
                                await refDoc.set({
                                    referral_bonus: firebase.firestore.FieldValue.increment(50)
                                }, { merge: true });

                                await userRef.set({
                                    referred_by: referrerEmail
                                }, { merge: true });

                                console.log("Referral bonus +50 awarded to:", referrerEmail);
                            }
                        }
                        localStorage.removeItem('metagen_referrer');

                    } catch (e) {
                        console.error("Referral processing failed:", e);
                        localStorage.removeItem('metagen_referrer');
                    }
                }

                document.getElementById('userProfile').classList.add('visible');
                document.getElementById('userEmail').textContent = `👤 ${email}`;
                // Set header profile button image with name
                const name = displayName || email.split('@')[0];
                // FIX: Pass avatarUrl to the update function
                updateHeaderProfileImage(email, name, avatarUrl);

                // Fetch user usage details from backend (independent of usageIndicator DOM presence)
                const usage = await getMetadataUsage(email);

                // Store in global state
                window.userUsageData = {
                    count: usage.count,
                    limit: usage.limit,
                    monthlyLimit: usage.monthlyLimit,
                    monthlyCount: usage.monthlyCount,
                    baseLimit: usage.baseLimit || (usage.plan === 'premium' ? 3000 : (usage.plan === 'pro' ? 2000 : 120)),
                    referralBonus: usage.referralBonus || 0,
                    plan: usage.plan,
                    hasClaimedShareBonus: usage.hasClaimedShareBonus || false,
                    trialCreditsTotal: usage.trialCreditsTotal || 0,
                    trialCreditsUsed: usage.trialCreditsUsed || 0,
                    trialActive: usage.trialActive || false,
                    giftCredits: usage.giftCredits || 0,
                    email: email
                };

                // Welcome Power-Pack: Sync trial state
                if (usage.trialCreditsTotal !== undefined) {
                    window.trialPowerPack = {
                        total: usage.trialCreditsTotal || 0,
                        used: usage.trialCreditsUsed || 0,
                        active: usage.trialActive || false,
                        isNew: false // If coming from metadata usage, it's not the initial "new" trigger
                    };
                }

                // 📊 Initialize and show usage indicator if DOM element exists
                if (usageIndicator) {
                    usageIndicator.style.display = 'flex';
                    try { updateUsageUI(); } catch (e) { console.warn('Usage UI update failed:', e); }
                }

                try {
                    let currentPlan = usage.plan ? usage.plan.toLowerCase() : 'free';
                    let isStreakPromoShown = localStorage.getItem('streakPromoShown');

                    if (currentPlan === 'free' && !isStreakPromoShown) {
                        console.log("⏳ Streak Modal will open in 3.5 seconds...");
                        setTimeout(() => {
                            const streakModal = document.getElementById('streakInfoModal');
                            if (streakModal) {
                                streakModal.style.display = 'flex';
                                localStorage.setItem('streakPromoShown', 'true'); // মার্ক করা হলো
                                console.log("✅ Streak Modal Opened!");
                            } else {
                                console.error("❌ ERROR: 'streakInfoModal' HTML element not found!");
                            }
                        }, 3500);
                    } else {
                        console.log(`⏩ Streak Modal Skipped. Plan: ${currentPlan}, Already Shown: ${!!isStreakPromoShown}`);
                    }
                } catch (err) {
                    console.error("Streak Promo Error:", err);
                }

                // Trigger Admin Gift Box Check
                if (usage.giftCredits && usage.giftCredits > 0) {
                    setTimeout(() => {
                        const gm = document.getElementById('adminGiftBoxModal');
                        if (gm) {
                            document.getElementById('adminGiftValue').textContent = usage.giftCredits;
                            window.userUsageData.giftCredits = usage.giftCredits; // Ensure stored locally for claim
                            gm.style.display = 'flex';
                        }
                    }, 1200);
                }
            } else {
                // Not logged in: hide the small user-profile panel
                document.getElementById('userProfile').classList.remove('visible');
                document.getElementById('userEmail').textContent = '';
                // Reset header profile button
                resetHeaderProfileImage();

                if (btnFreeTrial) btnFreeTrial.style.display = '';
                if (btnTryFree) btnTryFree.style.display = 'none';
                if (btnBuyPkg) btnBuyPkg.style.display = 'none';

                // 📊 Hide usage indicator
                if (usageIndicator) usageIndicator.style.display = 'none';
                if (window.userUsageData) window.userUsageData.email = null;
            }
        }

        // --- NEW: Referral & Sharing Logic ---
        async function handleToolShare() {
            const btn = document.getElementById('referralBtn');
            const originalContent = btn.innerHTML;

            const userEmail = (window.userUsageData && window.userUsageData.email) || (auth && auth.currentUser ? auth.currentUser.email : null);

            if (!userEmail) {
                alert("Please login first to generate your referral link.");
                document.getElementById('loginModal').classList.remove('hidden');
                return;
            }

            try {
                // ১. রেফারেল লিঙ্ক তৈরি
                const encodedEmail = btoa(userEmail);
                const referralUrl = `${window.location.origin}${window.location.pathname}?ref=${encodedEmail}`;
                const shareData = {
                    title: 'MetaGen Pro - AI Metadata Generator',
                    text: 'I use MetaGen Pro to generate SEO-friendly metadata for my stock photos. It is super fast and easy!',
                    url: referralUrl
                };

                // ২. শেয়ার মেথড (মোবাইল হলে শেয়ার মেনু খুলবে, পিসি হলে কাস্টম মোডাল আসবে)
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                if (isMobile && navigator.share && navigator.canShare && navigator.canShare(shareData)) {
                    await navigator.share(shareData);
                } else {
                    openDesktopShareModal(referralUrl, shareData.text);
                }

                // ৩. ইউআই আপডেট (লিঙ্ক কপি হওয়া বোঝানোর জন্য)
                btn.innerHTML = '<i class="fas fa-check"></i> Link Copied!';
                btn.style.background = '#10B981';

                setTimeout(() => {
                    btn.innerHTML = originalContent;
                    btn.style.background = '';
                }, 3000);

            } catch (err) {
                console.error("Sharing failed:", err);
            }
        }

        // --- Desktop Custom Share Modal Helpers ---
        function openDesktopShareModal(url, text) {
            // Close the profile modal and backdrop to ensure no overlay conflict
            const profileModal = document.getElementById('profileModal');
            if (profileModal) profileModal.classList.add('hidden');
            const profileBackdrop = document.getElementById('profileModalBackdrop');
            if (profileBackdrop) profileBackdrop.classList.add('hidden');

            // Delay showing the modal to decouple from the current click event cycle.
            // Without this, the click event bubbles to window and global click-outside
            // handlers (e.g., for seoInfoModal, manualPaymentModal) detect the click on
            // the newly visible overlay and may interfere with display.
            setTimeout(() => {
                const modal = document.getElementById('customShareModal');
                modal.style.display = 'flex';

                document.getElementById('shareLinkInput').value = url;

                const encodedUrl = encodeURIComponent(url);
                const encodedText = encodeURIComponent(text);

                document.getElementById('shareFb').href = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
                document.getElementById('shareTw').href = `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`;
                document.getElementById('shareWa').href = `https://api.whatsapp.com/send?text=${encodedText}%20${encodedUrl}`;
                document.getElementById('shareLi').href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
            }, 50);
        }

        async function copyShareUrl() {
            const input = document.getElementById('shareLinkInput');
            input.select();
            input.setSelectionRange(0, 99999);
            try {
                await navigator.clipboard.writeText(input.value);
                const btn = document.getElementById('copyShareLinkBtn');
                const origHtml = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> Copied';
                btn.style.background = '#10B981';
                setTimeout(() => {
                    btn.innerHTML = origHtml;
                    btn.style.background = 'var(--accent-blue)';
                }, 2000);
            } catch (e) {
                console.error('Copy failed');
            }
        }

        // --- NEW: Capture Referral from URL ---
        window.addEventListener('DOMContentLoaded', () => {
            const urlParams = new URLSearchParams(window.location.search);
            const ref = urlParams.get('ref');
            if (ref) {
                try {
                    const referrerEmail = atob(ref);
                    // Basic email validation check
                    if (referrerEmail.includes('@')) {
                        localStorage.setItem('metagen_referrer', referrerEmail);
                        console.log("Referral captured from:", referrerEmail);
                    }
                } catch (e) {
                    console.error("Invalid referral code");
                }
            }
        });

        function updateUsageUI(count, limit, plan, monthlyLimit, monthlyCount, referralBonus, baseLimit) {
            if (!window.userUsageData) {
                window.userUsageData = { count: 0, limit: 10, plan: 'free', monthlyLimit: 120, monthlyCount: 0, referralBonus: 0, baseLimit: 120, trialCreditsTotal: 0, trialCreditsUsed: 0, trialActive: false };
            }

            if (count !== undefined && typeof count !== 'object') window.userUsageData.count = count;
            if (limit !== undefined) window.userUsageData.limit = limit;
            if (plan !== undefined) window.userUsageData.plan = plan;
            if (monthlyLimit !== undefined) window.userUsageData.monthlyLimit = monthlyLimit;
            if (monthlyCount !== undefined) window.userUsageData.monthlyCount = monthlyCount;
            if (referralBonus !== undefined) window.userUsageData.referralBonus = referralBonus;
            if (baseLimit !== undefined) window.userUsageData.baseLimit = baseLimit;

            // Handle optional data object for bulk updates (when called with object as first arg)
            const extra = (typeof count === 'object' && count !== null) ? count : {};
            const fields = ['purchasedCredits', 'purchasedCreditsUsed', 'teamId', 'teamRole', 'trialCreditsTotal', 'trialCreditsUsed', 'trialActive', 'count', 'limit', 'plan', 'monthlyLimit', 'monthlyCount', 'referralBonus', 'baseLimit'];
            fields.forEach(f => { if (extra[f] !== undefined) window.userUsageData[f] = extra[f]; });

            const u = window.userUsageData;

            // Calculate Total Monthly Limit: Base + Bonus
            const currentBase = u.baseLimit || (u.plan === 'premium' ? 3000 : (u.plan === 'pro' ? 2000 : 120));
            const currentBonus = u.referralBonus || 0;
            const totalMonthlyLimit = currentBase + currentBonus;
            const currentMonthlyCount = u.monthlyCount || 0;

            const usageCountEl = document.getElementById('usageCount');
            const profileUsageCountEl = document.getElementById('profileUsageCount');
            const profileUsageFill = document.getElementById('profileUsageFill');

            // Header UI: Monthly Usage / Total Monthly Limit
            if (usageCountEl) {
                usageCountEl.textContent = `${currentMonthlyCount}/${totalMonthlyLimit}`;
            }

            // Profile Modal: Daily Usage / Daily Limit
            if (profileUsageCountEl) {
                profileUsageCountEl.textContent = `${u.count || 0}/${u.limit || 25}`;
            }

            if (profileUsageFill) {
                const pct = totalMonthlyLimit > 0 ? Math.min((currentMonthlyCount / totalMonthlyLimit) * 100, 100) : 0;
                profileUsageFill.style.width = `${pct}%`;
                if (pct > 90) profileUsageFill.style.background = '#EF4444';
                else profileUsageFill.style.background = '#3B82F6';
            }

            // --- New: Purchased Credits & Team UI ---
            const pcSection = document.getElementById('purchasedCreditsSection');
            const pcCountEl = document.getElementById('purchasedCreditsCount');
            if (pcSection && pcCountEl && u.purchasedCredits > 0) {
                pcSection.style.display = 'block';
                pcCountEl.textContent = `${u.purchasedCreditsUsed || 0}/${u.purchasedCredits}`;
            }

            const teamSection = document.getElementById('teamActionSection');
            if (teamSection) {
                // Show Manage Team button if user has an agency plan or is already in a team they own (or simply have agency plan)
                teamSection.style.display = (u.plan === 'agency' || u.teamId) ? 'block' : 'none';
            }

            // --- API Access Header Button (Pro/Premium/Agency only) ---
            const apiBtn = document.getElementById('apiHeaderBtn');
            if (apiBtn) {
                const isPaidPlan = (u.plan === 'pro' || u.plan === 'premium' || u.plan === 'agency');
                apiBtn.style.display = isPaidPlan ? 'block' : 'none';
            }

            updateVisibility();
        }

        // Set dynamic greeting based on time of day
        (function setTimeGreeting() {
            const greetingSpan = document.querySelector('#loginModeText span');
            if (greetingSpan) {
                const hour = new Date().getHours();
                if (hour < 12) greetingSpan.textContent = 'Good Morning';
                else if (hour < 18) greetingSpan.textContent = 'Good Afternoon';
                else greetingSpan.textContent = 'Good Evening';
            }
        })();

        // Toggle between Login and Signup
        window.toggleSignupMode = function () {
            const loginForm = document.getElementById('loginFormContainer');
            const signupForm = document.getElementById('signupFormContainer');

            if (loginForm.style.display === 'none') {
                // Show login
                loginForm.style.display = 'block';
                signupForm.style.display = 'none';
            } else {
                // Show signup
                loginForm.style.display = 'none';
                signupForm.style.display = 'block';
            }

            // Clear errors
            clearErrors();
        };

        // Email/Password Login
        window.handleLogin = async function (event) {
            event.preventDefault();
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;

            if (!email || !password) {
                showError('Please enter email and password');
                return;
            }

            const btn = event.target.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.innerHTML = '<span style="animation: spin 1s linear infinite;">⌛</span> Logging in...';

            try {
                const userCredential = await auth.signInWithEmailAndPassword(email, password);
                const user = userCredential.user;

                showSuccess('Logged in successfully! ✓');
                const displayName = user.displayName || user.email.split('@')[0];
                const avatarUrl = user.photoURL;

                setTimeout(() => {
                    showMainApp(user.email, displayName, avatarUrl);
                }, 500);
            } catch (error) {
                if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                    showError("ইমেল বা পাসওয়ার্ড ভুল। আবার চেষ্টা করুন।");
                } else {
                    showError(error.message || "Login failed");
                }
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Continue with Email';
            }
        };

        // Email/Password Signup
        window.handleSignup = async function (event) {
            event.preventDefault();

            const email = document.getElementById('signupEmail').value.trim();
            const password = document.getElementById('signupPassword').value;
            const confirmPassword = document.getElementById('signupConfirmPassword').value;

            if (!email || !password || !confirmPassword) {
                showError('Please fill in all fields');
                return;
            }

            if (password !== confirmPassword) {
                showError('Passwords do not match');
                return;
            }

            if (password.length < 6) {
                showError('Password must be at least 6 characters');
                return;
            }

            const btn = event.target.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.innerHTML = '<span style="animation: spin 1s linear infinite;">⌛</span> Creating account...';

            try {
                await auth.createUserWithEmailAndPassword(email, password);

                showSuccess('Account created! Please login.');
                setTimeout(() => {
                    window.toggleSignupMode();
                    document.getElementById('loginForm').reset();
                    document.getElementById('signupForm').reset();
                }, 2000);
            } catch (error) {
                showError(error.message || 'Sign up failed');
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Create Account';
            }
        };

        // Google OAuth Login
        window.handleGoogleLogin = async function (event) {
            if (event) event.preventDefault();
            const btn = (event && event.target) ? event.target.closest('.google-button') : document.querySelector('.google-button');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span style="animation: spin 1s linear infinite;">⌛</span> Redirecting to Google...';
            }

            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                await auth.signInWithPopup(provider);
                window.location.reload();
            } catch (error) {
                showError(error.message || 'Google login failed');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span style="margin-right: 10px;">🔐</span> Continue with Google';
                }
            }
        };

        function showError(message) {
            const errorDiv = document.getElementById('loginError');
            errorDiv.textContent = '❌ ' + message;
            errorDiv.classList.add('show');
        }

        function showSuccess(message) {
            const successDiv = document.getElementById('loginSuccess');
            successDiv.textContent = '✅ ' + message;
            successDiv.classList.add('show');
        }

        function clearErrors() {
            document.getElementById('loginError').classList.remove('show');
            document.getElementById('loginSuccess').classList.remove('show');
        }

        // Profile Modal Functions
        window.openProfileModal = function () {
            const user = firebase.auth().currentUser;

            if (user && user.email) {
                const loginModal = document.getElementById('loginModal');
                if (loginModal) loginModal.classList.add('hidden');


                const profileModal = document.getElementById('profileModal');
                if (profileModal) profileModal.classList.remove('hidden');

                document.getElementById('profileName').textContent = user.displayName || user.email.split('@')[0];
                document.getElementById('profileEmailText').textContent = user.email;

                const avatarImg = document.getElementById('profileAvatarImg');
                if (avatarImg) {
                    avatarImg.src = user.photoURL || getGravatarUrl(user.email);
                    avatarImg.style.display = 'block';
                }

                const defaultIcon = document.getElementById('profileAvatarDefault');
                if (defaultIcon) defaultIcon.style.display = 'none';

                fetchAndRefreshUsage(user.email);

            } else {
                showLoginModal();
            }
        };

        async function fetchAndRefreshUsage(email) {
            try {
                const usage = await getMetadataUsage(email);
                window.userUsageData = { ...usage, email: email };

                if (typeof updateUsageUI === 'function') {
                    updateUsageUI();
                }
            } catch (e) {
                console.warn("Background data sync failed:", e);
            }
        }

        window.closeProfileModal = function () {
            document.getElementById('profileModal').classList.add('hidden');
        };

        window.openRestApiModal = function () {
            closeProfileModal(); // close profile modal if open
            document.getElementById('restApiModal').classList.remove('hidden');
            document.getElementById('restApiModalBackdrop').classList.remove('hidden');
        };

        window.closeRestApiModal = function () {
            document.getElementById('restApiModal').classList.add('hidden');
            document.getElementById('restApiModalBackdrop').classList.add('hidden');
        };

        // --- API Key Management Functions ---
        async function _callApiKeyEndpoint(action) {
            const user = auth.currentUser;
            if (!user) { alert('Please login first.'); return; }
            const btn = document.getElementById(action === 'regenerate' ? 'regenerateApiKeyBtn' : 'generateApiKeyBtn');
            const origText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            try {
                const idToken = await user.getIdToken();
                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/user/api-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                    body: JSON.stringify(action === 'regenerate' ? { action: 'regenerate' } : {})
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed');
                document.getElementById('apiKeyValue').value = data.apiKey;
                document.getElementById('apiKeyDisplay').style.display = 'block';
                document.getElementById('generateApiKeyBtn').style.display = 'none';
                document.getElementById('regenerateApiKeyBtn').style.display = 'inline-flex';
            } catch (err) {
                alert('API Key Error: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = origText;
            }
        }

        window.handleGenerateApiKey = function () { _callApiKeyEndpoint('generate'); };
        window.handleRegenerateApiKey = function () {
            if (confirm('Regenerating will invalidate your current API key. Continue?')) {
                _callApiKeyEndpoint('regenerate');
            }
        };
        window.copyApiKey = function () {
            const input = document.getElementById('apiKeyValue');
            input.select();
            navigator.clipboard.writeText(input.value).then(() => {
                const btn = document.getElementById('copyApiKeyBtn');
                const orig = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i>';
                btn.style.background = '#10B981';
                setTimeout(() => { btn.innerHTML = orig; btn.style.background = '#8B5CF6'; }, 1500);
            });
        };

        // Switch Account
        window.switchAccount = async function () {
            // Close profile modal and show login modal
            closeProfileModal();
            document.getElementById('loginModal').classList.remove('hidden');
        };

        // Logout
        window.handleLogout = async function () {
            if (confirm('Are you sure you want to logout?')) {
                await auth.signOut();
                if (document.getElementById('loginForm')) document.getElementById('loginForm').reset();
                if (document.getElementById('signupForm')) document.getElementById('signupForm').reset();
                closeProfileModal();

                localStorage.removeItem('metagen_referrer');
                sessionStorage.setItem('show_login_on_reload', 'true');

                window.location.reload();
            }
        };

        // --- Team Management Functions ---
        window.openTeamManagement = async function () {
            const user = auth.currentUser;
            if (!user) return;

            // Close profile modal
            closeProfileModal();

            // Show modal and backdrop
            document.getElementById('teamManagementModal').classList.remove('hidden');
            document.getElementById('teamModalBackdrop').classList.remove('hidden');

            await loadTeamInfo();
        };

        window.closeTeamManagement = function () {
            document.getElementById('teamManagementModal').classList.add('hidden');
            document.getElementById('teamModalBackdrop').classList.add('hidden');
        };

        async function loadTeamInfo() {
            const user = auth.currentUser;
            if (!user) return;

            const noTeamView = document.getElementById('noTeamView');
            const hasTeamView = document.getElementById('hasTeamView');
            const loadError = document.getElementById('teamLoadError');

            // Reset views
            noTeamView.style.display = 'none';
            hasTeamView.style.display = 'none';
            loadError.style.display = 'none';

            try {
                const idToken = await user.getIdToken();
                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/team/info', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + idToken }
                });

                let data = null;
                const contentType = res.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    data = await res.json().catch(() => null);
                }

                if (!res.ok) {
                    throw new Error((data && data.error) ? data.error : 'Failed to fetch team info');
                }

                // সার্ভার যদি জানায় যে ইউজারের টিম নেই (hasTeam: false)
                if (data && data.hasTeam === false) {
                    noTeamView.style.display = 'block';
                    return;
                }

                renderTeamUI(data);
                hasTeamView.style.display = 'block';

            } catch (err) {
                console.error('Team Info Error:', err);
                loadError.style.display = 'block';
            }
        }

        function renderTeamUI(data) {
            const user = auth.currentUser;
            const isOwner = user && data.owner === user.email;

            document.getElementById('displayTeamName').textContent = data.teamName || 'Your Agency';
            document.getElementById('teamMonthlyUsage').textContent = `${data.teamMonthlyUsage || 0} / ${data.monthlyLimit || 10000}`;
            document.getElementById('teamMemberCount').textContent = `${data.members.length} / ${data.maxMembers}`;

            const roleBadge = document.getElementById('userTeamRoleBadge');
            if (roleBadge) {
                roleBadge.textContent = isOwner ? 'Admin' : 'Editor';
                roleBadge.className = 'member-role-badge ' + (isOwner ? 'role-owner' : 'role-member');
            }

            // Show/Hide invite section
            const inviteSec = document.getElementById('inviteSection');
            if (inviteSec) inviteSec.style.display = isOwner ? 'flex' : 'none';

            // Render member list
            const listBody = document.getElementById('teamMemberListBody');
            if (listBody) {
                listBody.innerHTML = '';
                data.members.forEach(memberEmail => {
                    const row = document.createElement('tr');
                    const role = memberEmail === data.owner ? 'Admin' : 'Editor';
                    const roleClass = memberEmail === data.owner ? 'role-owner' : 'role-member';

                    row.innerHTML = `
                        <td>${memberEmail} ${user && memberEmail === user.email ? '<strong>(You)</strong>' : ''}</td>
                        <td><span class="member-role-badge ${roleClass}">${role}</span></td>
                        <td style="text-align: right;">
                            ${(isOwner && memberEmail !== data.owner) ? `<button class="remove-member-btn" onclick="handleRemoveMember('${memberEmail}')" title="Remove Member"><i class="fas fa-trash-alt"></i></button>` : ''}
                        </td>
                    `;
                    listBody.appendChild(row);
                });
            }
        }

        window.handleCreateTeam = async function () {
            const teamName = document.getElementById('newTeamName').value.trim();
            if (!teamName) { alert('Please enter a team name.'); return; }

            const btn = document.getElementById('createTeamBtn');
            const orig = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

            try {
                const idToken = await auth.currentUser.getIdToken();
                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/team/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                    body: JSON.stringify({ teamName })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to create team');

                alert('Team created successfully!');
                await loadTeamInfo();
                if (typeof fetchAndRefreshUsage === 'function') fetchAndRefreshUsage(auth.currentUser.email);

            } catch (err) {
                alert('Error: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = orig;
            }
        };

        window.handleInviteMember = async function () {
            const email = document.getElementById('inviteEmail').value.trim();
            if (!email) { alert('Please enter an email.'); return; }

            const btn = document.getElementById('inviteBtn');
            const orig = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            try {
                const idToken = await auth.currentUser.getIdToken();
                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/team/invite', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                    body: JSON.stringify({ memberEmail: email })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to invite member');

                alert('Member invited successfully!');
                document.getElementById('inviteEmail').value = '';
                await loadTeamInfo();

            } catch (err) {
                alert('Error: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = orig;
            }
        };

        window.handleRemoveMember = async function (email) {
            if (!confirm(`Are you sure you want to remove ${email} from the team?`)) return;

            try {
                const idToken = await auth.currentUser.getIdToken();
                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/team/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
                    body: JSON.stringify({ memberEmail: email })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to remove member');

                alert('Member removed successfully.');
                await loadTeamInfo();

            } catch (err) {
                alert('Error: ' + err.message);
            }
        };

        // Login Modal Close Function
        window.closeLoginModal = function () {
            const modal = document.getElementById('loginModal');
            if (modal) {
                modal.classList.add('hidden');
            }
            if (window.pendingProcessAll) {
                window.pendingProcessAll = false;
                const btn = document.getElementById('processAllButton');
                if (btn) btn.disabled = false;
            }
        };

        function scrollToPricing() {
            const sidebar = document.getElementById('appSidebar');
            if (window.innerWidth <= 700) {
                sidebar.classList.remove('visible');
            }

            const pricingSection = document.getElementById('pricing');
            const toolWrapper = document.getElementById('toolSectionWrapper');

            if (toolWrapper && toolWrapper.classList.contains('active')) {
                pricingSection.style.display = 'block';
            }

            pricingSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // ========== HERO LANDING PAGE LOGIC ==========
        function showToolSection() {
            const heroSection = document.getElementById('heroLandingSection');
            const toolWrapper = document.getElementById('toolSectionWrapper');
            if (heroSection) {
                heroSection.style.display = 'none';
                if (heroVanta) {
                    heroVanta.destroy();
                    heroVanta = null;
                }
            }
            if (toolWrapper) {
                toolWrapper.classList.add('active');
            }
            // Show sidebar and restore main-panel margin
            document.body.classList.remove('landing-mode');
            // Scroll to top smoothly
            window.scrollTo({ top: 0, behavior: 'smooth' });

            // Trigger tour if not shown before
            if (!localStorage.getItem('tourShown')) {
                setTimeout(() => {
                    if (typeof startMetaGenTour === 'function') {
                        startMetaGenTour();
                        localStorage.setItem('tourShown', 'true');
                    }
                }, 1000);
            }
        }

        // Hero Drop Zone Logic
        document.addEventListener('DOMContentLoaded', function () {
            const heroDropZone = document.getElementById('heroDropZone');
            const heroFileInput = document.getElementById('heroFileInput');

            if (heroDropZone) {
                // Click on circle to open file picker
                heroDropZone.addEventListener('click', function () {
                    if (heroFileInput) heroFileInput.click();
                });

                // Drag events
                heroDropZone.addEventListener('dragenter', function (e) {
                    e.preventDefault();
                    heroDropZone.classList.add('dragover');
                });
                heroDropZone.addEventListener('dragover', function (e) {
                    e.preventDefault();
                    heroDropZone.classList.add('dragover');
                });
                heroDropZone.addEventListener('dragleave', function (e) {
                    e.preventDefault();
                    heroDropZone.classList.remove('dragover');
                });
                heroDropZone.addEventListener('drop', function (e) {
                    e.preventDefault();
                    heroDropZone.classList.remove('dragover');
                    const files = e.dataTransfer.files;
                    if (files.length > 0) {
                        showToolSection();
                        // Pass files to the existing dropZone handler
                        setTimeout(function () {
                            const dropZone = document.getElementById('dropZone');
                            if (dropZone) {
                                const dropEvent = new DragEvent('drop', {
                                    dataTransfer: e.dataTransfer,
                                    bubbles: true
                                });
                                dropZone.dispatchEvent(dropEvent);
                            }
                        }, 300);
                    }
                });
            }

            // Hero file input change - when user selects files via file picker
            if (heroFileInput) {
                heroFileInput.addEventListener('change', function (e) {
                    if (e.target.files && e.target.files.length > 0) {
                        showToolSection();
                        // forward files to the existing jpgPngInput
                        setTimeout(function () {
                            const existingInput = document.getElementById('jpgPngInput');
                            if (existingInput) {
                                // Create a new DataTransfer to set files
                                const dt = new DataTransfer();
                                for (let i = 0; i < e.target.files.length; i++) {
                                    dt.items.add(e.target.files[i]);
                                }
                                existingInput.files = dt.files;
                                existingInput.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }, 300);
                    }
                });
            }
        });
        // ========== END HERO LANDING PAGE LOGIC ==========

        // Initialize when page loads
        window.addEventListener('load', function () {
            checkAuthState();
        });
