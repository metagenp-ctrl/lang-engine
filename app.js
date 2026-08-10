

        // ===========================================
        // SECTION 1: Main App Logic
        // ===========================================
        (function () {
            const APP_STABLE_VERSION = "5.3.4"; // আগের যেকোনো ভার্সন থেকে বড় নম্বর দিন
            const currentVersion = localStorage.getItem('metagen_version');

            if (currentVersion !== APP_STABLE_VERSION) {
                localStorage.removeItem('supabase.auth.token');
                Object.keys(localStorage).forEach(key => {
                    if (key.includes('supabase')) localStorage.removeItem(key);
                });

                localStorage.setItem('metagen_version', APP_STABLE_VERSION);

                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations().then(regs => {
                        for (let reg of regs) reg.unregister();
                    });
                }

                console.log("System upgraded. Clearing legacy cache...");
                window.location.reload(true);
            }
        })();
        const firebaseConfig = {
            apiKey: "AIzaSyAXV_HbmbphGce_wbYrIuz-Yy0bZgWsebE",
            authDomain: "auth.aimetagenpro.com",
            projectId: "metagen-pro-44451",
            storageBucket: "metagen-pro-44451.firebasestorage.app",
            messagingSenderId: "77497432757",
            appId: "1:77497432757:web:1b91dd4d59ca9c9fd1dcfc",
            measurementId: "G-4JC75J3MGC"
        };

        var auth, db, authUser;

        // User Profile Save/Update Function
        async function saveUserProfile(user) {
            try {
                const rawEmail = String(user.email).trim();
                const cleanEmail = rawEmail.toLowerCase();
                const userRef = db.collection("users").doc(cleanEmail);
                let doc = await userRef.get();

                // --- 🛡️ NEW: Robust Profile Recovery & Migration ---
                if (!doc.exists && rawEmail !== cleanEmail) {
                    const legacyDoc = await db.collection("users").doc(rawEmail).get();
                    if (legacyDoc.exists) {
                        console.log("Found legacy profile. Migrating to standard lowercase ID...");
                        const legacyData = legacyDoc.data();
                        await userRef.set({
                            ...legacyData,
                            email: cleanEmail,
                            last_login: firebase.firestore.FieldValue.serverTimestamp(),
                            migration_note: "Auto-migrated to lowercase"
                        });
                        doc = await userRef.get();
                    }
                }

                if (!doc.exists) {
                    // নতুন ইউজার হলে প্রোফাইল তৈরি (+ Welcome Power-Pack trial fields)
                    await userRef.set({
                        uid: user.uid,
                        email: cleanEmail,
                        displayName: user.displayName || "",
                        photoURL: user.photoURL || "",
                        plan: 'free',
                        limit: 10,
                        count: 0,
                        lastDate: new Date().toLocaleDateString(),
                        last_login: firebase.firestore.FieldValue.serverTimestamp(),
                        created_at: firebase.firestore.FieldValue.serverTimestamp(),
                        trial_credits_total: 10,
                        trial_credits_used: 0,
                        trial_activated: true,
                        trial_activated_at: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    console.log("Firestore: New profile created with Power-Pack trial.");
                } else {
                    // পুরনো ইউজার হলে লগইন টাইম আপডেট
                    const data = doc.data();
                    const updates = {
                        lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
                        last_login: firebase.firestore.FieldValue.serverTimestamp()
                    };
                    if (!data.created_at) updates.created_at = firebase.firestore.FieldValue.serverTimestamp();
                    await userRef.update(updates);
                    console.log("Firestore: Profile updated.");
                }

                // --- Sync Metadata to Worker (+ Welcome Power-Pack trial init) ---
                try {
                    fetch('https://metagen-pro-api.metagenp.workers.dev/user/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: cleanEmail, deviceInfo: navigator.userAgent })
                    })
                        .then(res => res.json())
                        .then(data => {
                            if (data.ip) window.currentUserIP = data.ip;
                            // Welcome Power-Pack: Save trial state
                            if (data.trialCreditsTotal !== undefined) {
                                window.trialPowerPack = {
                                    total: data.trialCreditsTotal || 0,
                                    used: data.trialCreditsUsed || 0,
                                    active: data.trialActive || false,
                                    isNew: data.trialNew || false
                                };
                                if (typeof updateTrialProgressUI === 'function') updateTrialProgressUI();
                                // Show Gift Box for new trial users
                                if (data.trialNew && data.trialActive) {
                                    setTimeout(() => {
                                        const gm = document.getElementById('giftBoxModal');
                                        if (gm) gm.style.display = 'flex';
                                    }, 1500);
                                }
                            }
                        })
                        .catch(e => console.warn("Sync failed:", e));
                } catch (e) { }

            } catch (error) {
                console.error("Firestore Save Error:", error);
            }
        }

        // Wait for Firebase to load
        function initFirebase() {
            if (window.firebase) {
                if (!firebase.apps.length) {
                    firebase.initializeApp(firebaseConfig);
                }
                auth = firebase.auth();
                db = firebase.firestore();

                // --- Global Usage State ---
                window.userUsageData = {
                    count: 0,
                    limit: 10,
                    email: null,
                    plan: 'free',
                    trialCreditsTotal: 0,
                    trialCreditsUsed: 0,
                    trialActive: false
                };

                // Handle Auth State Changes
                auth.onAuthStateChanged((user) => {
                    authUser = user;

                    hideLoadingState(); 

                    if (user) {
                        saveUserProfile(user);
                    }

                    if (typeof checkAuthState === "function") {
                        checkAuthState();
                    }

                    // --- Admin Access Check ---
                    checkAdminAccess(user);

                }, (err) => {
                    authUser = null;
                    console.log("Firebase Auth Error:", err);
                    const warning = document.getElementById('networkWarning');
                    if (warning) warning.style.display = 'block';
                    hideLoadingState();
                });
            } else {
                window._fbAttempts = (window._fbAttempts || 0) + 1;
                if (window._fbAttempts > 20) { // সর্বোচ্চ ১০ সেকেন্ড অপেক্ষা করবে
                    hideLoadingState();
                    console.error("Firebase SDK failed to load.");
                    return;
                }
                setTimeout(initFirebase, 500);
            }
        }
        initFirebase();

        // --- 🛡️ Admin Dashboard Logic ---
        const ADMIN_EMAILS = ['metagenp@gmail.com', 'pradipgraphic@gmail.com'];

        function checkAdminAccess(user) {
            const adminNavLink = document.getElementById('adminNavLink');
            const adminSidebarBtn = document.getElementById('adminSidebarBtn');

            if (user && ADMIN_EMAILS.includes(user.email)) {
                if (adminNavLink) adminNavLink.style.display = 'block';
                if (adminSidebarBtn) adminSidebarBtn.style.display = 'flex';
                console.log("Admin access granted for:", user.email);
            } else {
                if (adminNavLink) adminNavLink.style.display = 'none';
                if (adminSidebarBtn) adminSidebarBtn.style.display = 'none';
            }
        }

        async function loadAdminDashboardData() {
            const btn = document.getElementById('adminRefreshBtn');
            const icon = btn ? btn.querySelector('i') : null;

            try {
                const user = auth.currentUser;
                if (!user) { alert("Please log in first."); return; }

                if (icon) icon.classList.add('fa-spin');
                if (btn) btn.disabled = true;

                const idToken = await user.getIdToken();
                const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/admin/stats', {
                    headers: { 'Authorization': 'Bearer ' + idToken }
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || `Server returned ${response.status}`);
                }

                const data = await response.json();
                window.adminFullUserList = data.users || []; // For search filtering

                // --- FIXED TOTAL MEMBERS LOGIC ---
                const stats = data.stats || {};
                const total = stats.totalUsers || 0;
                const pro = stats.proCount || 0;
                const prem = stats.premiumCount || 0;
                const agency = stats.agencyCount || 0;

                const free = stats.freeCount !== undefined ? stats.freeCount : (total - (pro + prem + agency));

                // UI Update
                document.getElementById('adminTotalUsers').innerText = total;
                document.getElementById('adminMRR').innerText = `$${stats.estimatedMRR || 0}`;
                document.getElementById('adminPlanSplit').innerText = `Agency: ${agency} | Prem: ${prem} | Pro: ${pro} | Free: ${free}`;
                document.getElementById('adminTodayDAU').innerText = stats.todayUsage > 0 ? "Active" : "Idle";
                document.getElementById('adminTodayUsage').innerText = `Total Actions: ${stats.todayUsage || 0}`;

                renderAdminUsers(window.adminFullUserList);
                renderAdminLogs(data.activities);
                console.log("Admin Dashboard data refreshed.");

            } catch (err) {
                console.error("Admin Dashboard Error:", err);
                alert("Error loading admin data: " + err.message);
            } finally {
                if (icon) icon.classList.remove('fa-spin');
                if (btn) btn.disabled = false;
            }
        }

        function renderAdminUsers(users) {
            const tbody = document.getElementById('adminUsersTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';

            users.forEach(user => {
                let plan = 'free';
                if (user?.plan) {
                    const rawPlan = String(user.plan).toLowerCase().trim();
                    if (rawPlan.includes('agency')) plan = 'agency';
                    else if (rawPlan.includes('premium')) plan = 'premium';
                    else if (rawPlan.includes('pro')) plan = 'pro';
                } else if (user?.monthlyLimit) {
                    if (user.monthlyLimit >= 10000) plan = 'agency';
                    else if (user.monthlyLimit >= 3000) plan = 'premium';
                    else if (user.monthlyLimit >= 2000) plan = 'pro';
                }
                const isBlocked = user.is_blocked === true;

                const formatDate = (dateStr) => {
                    if (!dateStr || dateStr === "Unknown" || dateStr === "N/A" || dateStr === "Never") return "Never";
                    try {
                        const d = new Date(dateStr);
                        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    } catch (e) { return dateStr; }
                };

                // একই আইপি দিয়ে অন্য কোনো ইউজার আছে কি না চেক করা (মাল্টি-অ্যাকাউন্ট ডিটেকশন)
                const otherUsersWithSameIP = users.filter(u =>
                    u.last_ip === user.last_ip &&
                    u.last_ip !== "0.0.0.0" &&
                    u.last_ip !== "Unknown" &&
                    u.last_ip !== "N/A" &&
                    u.email !== user.email
                );
                const hasMultiAccount = otherUsersWithSameIP.length > 0;

                // Device Icon
                let deviceIcon = '<i class="fas fa-desktop"></i>';
                if (user.last_device?.toLowerCase().includes('mobile')) deviceIcon = '<i class="fas fa-mobile-alt"></i>';

                const userIP = (user.last_ip && user.last_ip !== "Unknown") ? user.last_ip : "No IP";
                const countryName = (user.last_country && user.last_country !== "Unknown") ? user.last_country : "Unknown Location";

                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.03)';
                tr.style.transition = 'background 0.2s';
                tr.onmouseover = () => tr.style.background = 'rgba(255, 255, 255, 0.02)';
                tr.onmouseout = () => tr.style.background = 'transparent';

                tr.innerHTML = `
            <td style="padding: 16px 20px;">
                <div style="font-weight: 700; color: var(--text-primary); font-size: 0.95em; letter-spacing: -0.2px;">${user.email || 'N/A'}</div>
                <div style="font-size: 0.75em; color: var(--text-muted); margin-top: 4px; display: flex; align-items: center; gap: 5px;">
                    <i class="far fa-calendar-alt" style="font-size: 0.9em;"></i>
                    Joined: ${user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                </div>
            </td>
            <td style="padding: 6px 10px; min-width: 70px;">
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <select class="admin-select-pill" onchange="updateAdminUser(&apos;${user.email}&apos;, &apos;plan&apos;, this.value)">
                        <option value="free" ${plan === 'free' ? 'selected' : ''}>Free Plan</option>
                        <option value="pro" ${plan === 'pro' ? 'selected' : ''}>Pro Plan</option>
                        <option value="premium" ${plan === 'premium' ? 'selected' : ''}>Premium Plan</option>
                        <option value="agency" ${plan === 'agency' ? 'selected' : ''}>Agency / Team</option>
                    </select>
                    <div style="font-size: 0.75em; color: var(--accent-orange); font-weight: 700; display: flex; align-items: center; gap: 4px;">
                        <i class="fas fa-chart-line"></i> ${user.todayCount || 0} hits today
                    </div>
                </div>
            </td>
            <td style="padding: 16px 20px;">
                <div style="color: var(--text-primary); font-size: 0.9em; font-weight: 500;">
                    ${formatDate(user.last_login)}
                </div>
            </td>
            <td style="padding: 16px 20px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 1.6em; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">${getFlagEmoji(user.last_country)}</span>
                    <div>
                        <div style="font-weight: 700; font-size: 0.9em; color: ${hasMultiAccount ? '#EF4444' : 'var(--text-primary)'}; display: flex; align-items: center; gap: 6px;">
                            ${userIP} 
                            ${hasMultiAccount ? '<i class="fas fa-exclamation-triangle" style="font-size: 0.8em;" title="Multi-Account Detected"></i>' : ''}
                        </div>
                        <div style="font-size: 0.75em; color: var(--text-muted); display: flex; align-items: center; gap: 4px; margin-top: 2px;">
                            ${countryName} • ${deviceIcon}
                        </div>
                        ${hasMultiAccount ? `<div style="font-size: 0.65em; color: #EF4444; font-weight:800; margin-top:4px; text-transform: uppercase; letter-spacing: 0.5px;">Linked: ${otherUsersWithSameIP.length + 1} users</div>` : ''}
                    </div>
                </div>
            </td>
            <td style="padding: 12px 16px; min-width: 110px;">
                <div style="display: flex; flex-direction: column; gap: 6px; align-items: center;">
                    <div style="display: flex; align-items: center; background: rgba(16, 185, 129, 0.08); border-radius: 4px; padding: 4px 8px; border: 1px solid rgba(16, 185, 129, 0.2); white-space: nowrap;">
                        <input type="number" value="${user.customDailyLimit > 0 ? user.customDailyLimit : (user.dailyLimit || 10)}" onchange="updateAdminUser(&apos;${user.email}&apos;, &apos;daily_limit&apos;, this.value)" class="admin-input-minimal" style="width: 50px; color: #10B981;" min="1" max="9999"/>
                        <span style="font-size: 0.55em; font-weight: 800; color: #10B981; text-transform: uppercase; margin-left: 4px;">/day</span>
                    </div>
                    <div style="font-size: 0.65em; color: var(--text-muted); font-weight: 700; letter-spacing: 0.3px;">
                        ${user.customDailyLimit > 0 ? '<span style="color:#10B981;">✦ Custom</span>' : '<span style="color:var(--text-muted);">Default</span>'}
                    </div>
                    <div style="font-size: 0.6em; color: var(--text-muted);">
                        Plan: ${plan === 'agency' ? '500' : plan === 'premium' ? '100' : plan === 'pro' ? '70' : '20'}/day
                    </div>
                </div>
            </td>
            <td style="padding: 12px 16px;">
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <div style="display: flex; align-items: center; background: rgba(59, 130, 246, 0.08); border-radius: 4px; padding: 4px 8px; border: 1px solid rgba(59, 130, 246, 0.2);">
                        <input type="number" value="${user.monthlyLimit || 120}" onchange="updateAdminUser(&apos;${user.email}&apos;, &apos;monthlyLimit&apos;, this.value)" class="admin-input-minimal" style="width: 55px;"/>
                        <span style="font-size: 0.65em; font-weight: 800; color: var(--accent-blue); text-transform: uppercase; margin-left: 5px;">Base</span>
                    </div>
                    <div style="font-size: 0.7em; color: var(--text-primary); font-weight: 800; text-align: center;">
                        Total: ${(user.monthlyLimit || 120) + (user.referralBonus || 0)} cr
                    </div>
                    <div style="font-size: 0.65em; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px; text-align: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 4px;">
                        ${user.monthlyUsage || 0} USED
                    </div>
                </div>
            </td>
            <td style="padding: 12px 16px; text-align: center; min-width: 70px;">
                <div style="font-size: 1.2em; font-weight: 900; color: var(--text-primary);">${user.referralCount || 0}</div>
                <div style="display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: 6px; background: rgba(249, 115, 22, 0.08); border-radius: 8px; padding: 4px 6px; border: 1px solid rgba(249, 115, 22, 0.2);">
                    <input type="number" value="${user.referralBonus || 0}" onchange="updateAdminUser(&apos;${user.email}&apos;, &apos;referral_bonus&apos;, this.value)" class="admin-input-minimal" style="width: 45px; color: var(--accent-orange);"/>
                    <span style="font-size: 0.65em; color: var(--accent-orange); font-weight: 800;">CR</span>
                </div>
            </td>
            <td style="padding: 16px 20px;">
                <div style="display: flex; flex-direction: column; gap: 8px; align-items: stretch; min-width: 100px;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 5px; border-radius: 8px; background: ${isBlocked ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)'}; color: ${isBlocked ? '#EF4444' : '#10B981'}; font-size: 0.7em; font-weight: 800; letter-spacing: 0.5px; border: 1px solid ${isBlocked ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'};">
                        <i class="fas ${isBlocked ? 'fa-user-slash' : 'fa-user-check'}"></i>
                        ${isBlocked ? 'BLOCKED' : 'ACTIVE'}
                    </div>
                    <div style="display: flex; gap: 4px; margin-bottom: 4px;">
                        <button class="admin-action-btn" style="flex: 2; background: rgba(139,92,246,0.1); color: #8B5CF6; border-color: rgba(139,92,246,0.2);" onclick="promptGiftCredits(&apos;${user.email}&apos;)" title="Gift Action Credits">
                            <i class="fas fa-gift"></i> Gift
                        </button>
                    </div>
                    <div style="display: flex; gap: 4px;">
                        <button class="admin-action-btn ${isBlocked ? 'unblock' : 'block'}" onclick="toggleUserBlock(&apos;${user.email}&apos;, ${!isBlocked})" title="${isBlocked ? 'Unblock User' : 'Block User'}" style="flex: 1;">
                            <i class="fas ${isBlocked ? 'fa-unlock' : 'fa-ban'}"></i>
                        </button>
                        <button class="admin-action-btn delete" onclick="deleteAdminUser(&apos;${user.email}&apos;)" title="Delete User" style="flex: 1;">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
            </td>
        `;
                tbody.appendChild(tr);
            });
        }

        async function promptGiftCredits(email) {
            const amount = prompt(`How many credits do you want to gift to ${email}?`);
            if (!amount || isNaN(amount)) return;
            const parsed = parseInt(amount, 10);
            if (parsed <= 0) return;

            if (!confirm(`Are you sure you want to send a gift of ${parsed} credits to ${email}?\n\nThey will see an animated gift box on their next login!`)) return;

            try {
                const user = auth.currentUser;
                const idToken = await user.getIdToken();

                const updates = { gift_credits: parsed };

                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/admin/user/update', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + idToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ targetEmail: email, updates })
                });

                if (!res.ok) throw new Error("Failed to send gift.");

                // Check if showSuccess is defined, else use alert
                if (typeof showSuccess === 'function') {
                    showSuccess(`🎁 Sent ${parsed} credits to ${email} successfully!`);
                } else {
                    alert(`🎁 Sent ${parsed} credits to ${email} successfully!`);
                }
                loadAdminDashboardData(); // Refresh list

            } catch (err) {
                alert("Gift Error: " + err.message);
            }
        }

        async function claimAdminGift() {
            const btn = document.getElementById('adminGiftClaimBtn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Claiming...';
            }
            try {
                if (!window.userUsageData || !window.userUsageData.email) return;
                const email = window.userUsageData.email.toLowerCase();
                const giftAmount = window.userUsageData.giftCredits || 0;

                if (giftAmount > 0) {
                    // Claim gift credits securely via Worker API
                    const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/user/claim-gift-credits', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: email })
                    });
                    const result = await res.json();

                    if (result.success) {
                        window.userUsageData.referralBonus = result.totalBonus || ((window.userUsageData.referralBonus || 0) + giftAmount);
                        window.userUsageData.giftCredits = 0;
                        console.log(`Gift credits +${result.giftClaimed} claimed. Total bonus: ${result.totalBonus}`);

                        // Show confetti if available
                        if (typeof confetti === 'function') confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
                    } else {
                        console.error("Gift claim failed:", result.error || result.message);
                    }
                }
            } catch (e) {
                console.error("Gift claim failed", e);
            }

            setTimeout(() => {
                const gm = document.getElementById('adminGiftBoxModal');
                if (gm) gm.style.display = 'none';
                updateUsageUI();
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '🎁 Claim Now';
                }
            }, 1000);
        }

        async function toggleUserBlock(email, newStatus) {
            if (!confirm(`Are you sure you want to ${newStatus ? 'BLOCK' : 'UNBLOCK'} ${email}?`)) return;

            try {
                const user = auth.currentUser;
                const idToken = await user.getIdToken();
                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/admin/user/toggle-block', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + idToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ targetEmail: email, blockStatus: newStatus })
                });

                if (!res.ok) throw new Error("Failed to update block status");

                alert(`User ${newStatus ? 'blocked' : 'unblocked'} successfully.`);
                loadAdminDashboardData(); // Refresh list

            } catch (err) {
                alert("Error: " + err.message);
            }
        }

        async function updateAdminUser(email, field, value) {
            try {
                const user = auth.currentUser;
                const idToken = await user.getIdToken();

                const updates = {};
                // প্ল্যান পরিবর্তন করলে অটোমেটিক সঠিক লিমিট আপডেট করে দিবে
                if (field === 'plan') {
                    updates['plan'] = value;
                    if (value === 'agency') { updates['monthlyLimit'] = 10000; updates['limit'] = 500; }
                    else if (value === 'premium') { updates['monthlyLimit'] = 3000; updates['limit'] = 100; }
                    else if (value === 'pro') { updates['monthlyLimit'] = 2000; updates['limit'] = 70; }
                    else { updates['monthlyLimit'] = 120; updates['limit'] = 20; }
                } else {
                    updates[field] = value;
                }

                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/admin/user/update', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + idToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ targetEmail: email, updates })
                });

                if (!res.ok) throw new Error("Failed to update user data");

                showSuccess(`User ${field} updated successfully.`);
                // We don't necessarily need to reload everything if we want to be fast, 
                // but for consistency let's reload
                loadAdminDashboardData();

            } catch (err) {
                alert("Update Error: " + err.message);
            }
        }

        async function deleteAdminUser(email) {
            if (!confirm(`CRITICAL ACTION: Are you sure you want to PERMANENTLY DELETE user ${email}? This cannot be undone.`)) return;
            if (!confirm(`LAST WARNING: Really delete ${email}?`)) return;

            try {
                const user = auth.currentUser;
                const idToken = await user.getIdToken();
                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/admin/user/delete', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + idToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ targetEmail: email })
                });

                if (!res.ok) throw new Error("Failed to delete user");

                alert(`User ${email} has been deleted.`);
                loadAdminDashboardData();

            } catch (err) {
                alert("Delete Error: " + err.message);
            }
        }

        function filterAdminUsers() {
            try {
                const searchInput = document.getElementById('adminUserSearch');
                if (!searchInput) return;
                const query = searchInput.value.toLowerCase().trim();

                if (!window.adminFullUserList || !Array.isArray(window.adminFullUserList)) {
                    console.warn("Admin user list load hoyni.");
                    return;
                }

                const filtered = window.adminFullUserList.filter(u => {
                    if (!u) return false;

                    const matchesEmail = (u.email || "").toLowerCase().includes(query);

                    const matchesIP = (u.last_ip || "").toLowerCase().includes(query);

                    let matchesDate = false;
                    if (u.created_at) {
                        try {
                            const dateObj = new Date(u.created_at);
                            const joinedDate = dateObj.toLocaleDateString().toLowerCase();
                            matchesDate = joinedDate.includes(query);
                        } catch (dateErr) {
                            matchesDate = false;
                        }
                    }

                    return matchesEmail || matchesIP || matchesDate;
                });

                if (typeof renderAdminUsers === 'function') {
                    renderAdminUsers(filtered);
                }
            } catch (globalErr) {
                console.error("Filter function error:", globalErr);
            }
        }

        function getFlagEmoji(countryCode) {
            if (!countryCode || countryCode === 'Unknown' || countryCode === 'N/A') return '🌐';
            const codePoints = countryCode
                .toUpperCase()
                .split('')
                .map(char => 127397 + char.charCodeAt());
            return String.fromCodePoint(...codePoints);
        }

        function renderAdminLogs(activities) {
            const tbody = document.getElementById('adminLogsTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';

            (activities || []).forEach(act => {
                const tr = document.createElement('tr');

                const date = new Date(act.created_at);
                const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = date.toLocaleDateString();

                tr.innerHTML = `
                    <td>
                        <div style="font-weight: 700; color: var(--text-primary);">${dateStr}</div>
                        <div style="color: var(--text-muted); font-size: 0.8em;">at ${timeStr}</div>
                    </td>
                    <td><div style="font-weight: 600; color: var(--accent-blue);">${act.user_email || 'Anon'}</div></td>
                    <td>
                        <div style="color: var(--accent-orange); font-weight: 800; font-size: 0.9em; text-transform: uppercase;">${act.action || 'Unknown'}</div>
                        <div style="color: var(--text-muted); font-size: 0.8em; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${act.details || ''}">${act.details || ''}</div>
                    </td>
                    <td>
                        <div style="font-weight: 600; font-size: 0.9em;">${act.ip || 'No IP'}</div>
                        <div style="color: var(--text-muted); font-size: 0.8em; display: flex; align-items: center; gap: 5px;">
                            ${getFlagEmoji(act.country)} ${act.country || 'Unknown'}
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        function showAdminTab(tabName, btn) {
            document.querySelectorAll('.admin-tab-content').forEach(t => t.style.display = 'none');
            const targetTab = document.getElementById('admin' + tabName.charAt(0).toUpperCase() + tabName.slice(1) + 'Tab');
            if (targetTab) targetTab.style.display = 'block';

            const searchBox = document.getElementById('adminUserSearchContainer');
            if (searchBox) searchBox.style.display = (tabName === 'users') ? 'block' : 'none';

            const siblingButtons = btn.parentElement.querySelectorAll('button');
            siblingButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }

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
            hideLoadingState();
            // Hide the login modal and show main app. If email provided, treat as logged-in.
            document.getElementById('loginModal').classList.add('hidden');
            document.querySelector('.app-container').style.display = 'flex';

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

        document.addEventListener('DOMContentLoaded', function () {
            // Show loading state while auth initializes
            showLoadingState();

            
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
            window.uploadedFilesData = [];



            window.showProUpgradeAlert = function () {
                alert("Upgrade to Pro to unlock SEO Score & Rejection Predictor.");
                if (typeof scrollToPricing === 'function') scrollToPricing();
            };

            // ==========================================
            // VECTOR CHECKLIST ANALYSIS FUNCTIONS
            // ==========================================

            async function analyzeSvgFile(file) {
                try {
                    const text = await file.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(text, 'image/svg+xml');

                    // Check for parsing errors
                    const parserError = doc.querySelector('parsererror');
                    if (parserError) {
                        console.warn('SVG parsing error:', parserError.textContent);
                    }

                    return {
                        noGradientMesh: checkNoGradientMesh(doc, text),
                        textOutlined: checkTextOutlined(doc, text),
                        noRasterImage: checkNoRasterImage(doc),
                        strokeExpanded: checkStrokeExpanded(doc, text),
                        transparencyFound: checkTransparency(doc, text)
                    };
                } catch (error) {
                    console.error('Error analyzing SVG:', error);
                    return {
                        noGradientMesh: { pass: false, status: 'warning' },
                        textOutlined: { pass: false, status: 'warning' },
                        noRasterImage: { pass: false, status: 'warning' },
                        strokeExpanded: { pass: false, status: 'warning' },
                        transparencyFound: { pass: false, status: 'warning' }
                    };
                }
            }

            function checkNoGradientMesh(doc, text) {
                // Check for mesh gradients (not widely supported)
                const hasMeshGradient = text.includes('<meshgradient') ||
                    text.includes('mesh') ||
                    doc.querySelector('meshgradient');
                return {
                    pass: !hasMeshGradient,
                    status: hasMeshGradient ? 'fail' : 'pass'
                };
            }

            function checkTextOutlined(doc, text) {
                // Check if there are any <text> elements (should be converted to paths)
                const textElements = doc.querySelectorAll('text');
                const hasTextTag = text.includes('<text');

                return {
                    pass: textElements.length === 0 && !hasTextTag,
                    status: (textElements.length > 0 || hasTextTag) ? 'fail' : 'pass'
                };
            }

            function checkNoRasterImage(doc) {
                // Check for embedded raster images
                const imageElements = doc.querySelectorAll('image');
                const hasRaster = Array.from(imageElements).some(img => {
                    const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
                    return href.includes('data:image') || href.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                });

                return {
                    pass: !hasRaster,
                    status: hasRaster ? 'fail' : 'pass'
                };
            }

            function checkStrokeExpanded(doc, text) {
                // Check if strokes are expanded to paths (no stroke attributes should remain)
                const elementsWithStroke = doc.querySelectorAll('[stroke]');
                const hasStrokeInStyle = text.includes('stroke:') || text.includes('stroke-width');

                // Allow 'none' strokes
                const hasActiveStroke = Array.from(elementsWithStroke).some(el => {
                    const stroke = el.getAttribute('stroke');
                    return stroke && stroke !== 'none';
                });

                return {
                    pass: !hasActiveStroke && !hasStrokeInStyle,
                    status: (hasActiveStroke || hasStrokeInStyle) ? 'warning' : 'pass'
                };
            }

            function checkTransparency(doc, text) {
                // Check for transparency/opacity (can cause issues on some platforms)
                const hasOpacity = text.includes('opacity') ||
                    text.includes('fill-opacity') ||
                    text.includes('stroke-opacity');
                const opacityElements = doc.querySelectorAll('[opacity], [fill-opacity], [stroke-opacity]');

                return {
                    pass: hasOpacity || opacityElements.length > 0,
                    status: (hasOpacity || opacityElements.length > 0) ? 'warning' : 'pass'
                };
            }

            function showVectorChecklist(filename, results) {
                const modal = document.getElementById('vectorChecklistModal');
                const filenameDiv = document.getElementById('checklistFilename');
                const resultsDiv = document.getElementById('checklistResults');

                filenameDiv.textContent = filename;

                const checks = [
                    { key: 'noGradientMesh', label: 'No gradient mesh', emoji: '🎨' },
                    { key: 'textOutlined', label: 'Text outlined', emoji: '📝' },
                    { key: 'noRasterImage', label: 'No raster image', emoji: '🖼️' },
                    { key: 'strokeExpanded', label: 'Stroke expanded', emoji: '✏️' },
                    { key: 'transparencyFound', label: 'Transparency found', emoji: '👁️' }
                ];

                resultsDiv.innerHTML = checks.map(check => {
                    const result = results[check.key];
                    const icon = result.status === 'pass' ? '✓' :
                        result.status === 'warning' ? '⚠' : '✗';
                    const statusClass = `check-${result.status}`;

                    return `
                        <div class="checklist-item ${statusClass}">
                            <span class="check-icon">${icon}</span>
                            <span class="check-label">${check.emoji} ${check.label}</span>
                        </div>
                    `;
                }).join('');

                modal.style.display = 'flex';
            }

            // Checklist modal event handlers
            let pendingVectorFile = null;
            let pendingVectorFiles = [];

            const checklistContinueBtn = document.getElementById('checklistContinueBtn');
            const checklistCancelBtn = document.getElementById('checklistCancelBtn');
            const vectorChecklistModal = document.getElementById('vectorChecklistModal');

            if (checklistContinueBtn) {
                checklistContinueBtn.onclick = async () => {
                    vectorChecklistModal.style.display = 'none';

                    // Process all pending vector files from batch
                    if (pendingVectorFiles && pendingVectorFiles.length > 0) {
                        for (const { file } of pendingVectorFiles) {
                            await processVectorFile(file);
                        }
                        pendingVectorFiles = [];
                    }
                    // Fallback for single file (legacy)
                    else if (pendingVectorFile) {
                        await processVectorFile(pendingVectorFile);
                        pendingVectorFile = null;
                    }
                };
            }

            if (checklistCancelBtn) {
                checklistCancelBtn.onclick = () => {
                    vectorChecklistModal.style.display = 'none';
                    pendingVectorFile = null;
                    pendingVectorFiles = [];
                };
            }

            // ==========================================
            // ADOBE STOCK EPS10 GENERATOR (CLIENT-SIDE)
            // ==========================================

            class AdobeStockEpsGenerator {
                constructor(svgElement) {
                    this.svg = svgElement;
                    this.viewBox = this.getViewBox();
                    this.psCommands = [];
                    this.actualBounds = null;
                }

                getViewBox() {
                    const vb = this.svg.getAttribute('viewBox');
                    if (vb) {
                        const parts = vb.split(/\s+|,/);
                        return {
                            x: parseFloat(parts[0]) || 0,
                            y: parseFloat(parts[1]) || 0,
                            width: parseFloat(parts[2]) || 100,
                            height: parseFloat(parts[3]) || 100
                        };
                    }
                    return {
                        x: 0,
                        y: 0,
                        width: parseFloat(this.svg.getAttribute('width')) || 100,
                        height: parseFloat(this.svg.getAttribute('height')) || 100
                    };
                }

                generate() {
                    this.parseSVGPaths();
                    this.calculateActualBounds();
                    return this.buildEPS10();
                }

                calculateActualBounds() {
                    // Calculate bounding box from all paths
                    let minX = Infinity, minY = Infinity;
                    let maxX = -Infinity, maxY = -Infinity;

                    this.psCommands.forEach(({ path }) => {
                        const coords = this.extractCoordinates(path);
                        coords.forEach(({ x, y }) => {
                            minX = Math.min(minX, x);
                            minY = Math.min(minY, y);
                            maxX = Math.max(maxX, x);
                            maxY = Math.max(maxY, y);
                        });
                    });

                    // If no paths found, use viewBox
                    if (!isFinite(minX)) {
                        this.actualBounds = {
                            x: this.viewBox.x,
                            y: this.viewBox.y,
                            width: this.viewBox.width,
                            height: this.viewBox.height
                        };
                    } else {
                        // Add 5% padding for Adobe Stock requirements
                        const padding = Math.max((maxX - minX), (maxY - minY)) * 0.05;
                        this.actualBounds = {
                            x: minX - padding,
                            y: minY - padding,
                            width: (maxX - minX) + (padding * 2),
                            height: (maxY - minY) + (padding * 2)
                        };
                    }
                }

                extractCoordinates(pathData) {
                    const coords = [];
                    const commands = pathData.match(/[a-df-z][^a-df-z]*/gi) || [];

                    let currentX = 0, currentY = 0;

                    commands.forEach(cmd => {
                        const type = cmd[0];
                        const args = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));

                        switch (type.toUpperCase()) {
                            case 'M':
                            case 'L':
                                if (args.length >= 2) {
                                    currentX = type === type.toUpperCase() ? args[0] : currentX + args[0];
                                    currentY = type === type.toUpperCase() ? args[1] : currentY + args[1];
                                    coords.push({ x: currentX, y: currentY });
                                }
                                break;
                            case 'H':
                                currentX = type === 'H' ? args[0] : currentX + args[0];
                                coords.push({ x: currentX, y: currentY });
                                break;
                            case 'V':
                                currentY = type === 'V' ? args[0] : currentY + args[0];
                                coords.push({ x: currentX, y: currentY });
                                break;
                            case 'C':
                                if (args.length >= 6) {
                                    currentX = type === 'C' ? args[4] : currentX + args[4];
                                    currentY = type === 'C' ? args[5] : currentY + args[5];
                                    coords.push({ x: currentX, y: currentY });
                                }
                                break;
                        }
                    });

                    return coords;
                }

                parseSVGPaths() {
                    // Get all path elements
                    const paths = this.svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line');

                    paths.forEach(element => {
                        const pathData = this.elementToPath(element);
                        if (pathData) {
                            const fill = this.getColor(element, 'fill');
                            const stroke = this.getColor(element, 'stroke');
                            const strokeWidth = parseFloat(element.getAttribute('stroke-width')) || 1;

                            this.psCommands.push({
                                path: pathData,
                                fill: fill,
                                stroke: stroke,
                                strokeWidth: strokeWidth
                            });
                        }
                    });
                }

                elementToPath(element) {
                    const tag = element.tagName.toLowerCase();

                    if (tag === 'path') {
                        return element.getAttribute('d');
                    } else if (tag === 'rect') {
                        const x = parseFloat(element.getAttribute('x')) || 0;
                        const y = parseFloat(element.getAttribute('y')) || 0;
                        const w = parseFloat(element.getAttribute('width')) || 0;
                        const h = parseFloat(element.getAttribute('height')) || 0;
                        return `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`;
                    } else if (tag === 'circle') {
                        const cx = parseFloat(element.getAttribute('cx')) || 0;
                        const cy = parseFloat(element.getAttribute('cy')) || 0;
                        const r = parseFloat(element.getAttribute('r')) || 0;
                        // Approximate circle with bezier curves
                        const k = 0.5522847498;
                        const kappa = r * k;
                        return `M${cx - r},${cy} C${cx - r},${cy - kappa} ${cx - kappa},${cy - r} ${cx},${cy - r} C${cx + kappa},${cy - r} ${cx + r},${cy - kappa} ${cx + r},${cy} C${cx + r},${cy + kappa} ${cx + kappa},${cy + r} ${cx},${cy + r} C${cx - kappa},${cy + r} ${cx - r},${cy + kappa} ${cx - r},${cy} Z`;
                    } else if (tag === 'line') {
                        const x1 = parseFloat(element.getAttribute('x1')) || 0;
                        const y1 = parseFloat(element.getAttribute('y1')) || 0;
                        const x2 = parseFloat(element.getAttribute('x2')) || 0;
                        const y2 = parseFloat(element.getAttribute('y2')) || 0;
                        return `M${x1},${y1} L${x2},${y2}`;
                    } else if (tag === 'polygon' || tag === 'polyline') {
                        const points = element.getAttribute('points');
                        if (!points) return null;
                        const pairs = points.trim().split(/\s+|,/).filter(p => p);
                        let path = '';
                        for (let i = 0; i < pairs.length; i += 2) {
                            const x = pairs[i];
                            const y = pairs[i + 1];
                            path += (i === 0 ? `M${x},${y}` : ` L${x},${y}`);
                        }
                        if (tag === 'polygon') path += ' Z';
                        return path;
                    }

                    return null;
                }

                getColor(element, type) {
                    let color = element.getAttribute(type);
                    if (!color || color === 'none') {
                        const style = element.getAttribute('style');
                        if (style) {
                            const match = style.match(new RegExp(`${type}:\\s*([^;]+)`));
                            if (match) color = match[1].trim();
                        }
                    }

                    if (!color || color === 'none') return null;

                    // Convert hex to RGB
                    if (color.startsWith('#')) {
                        const hex = color.slice(1);
                        const r = parseInt(hex.substr(0, 2), 16) / 255;
                        const g = parseInt(hex.substr(2, 2), 16) / 255;
                        const b = parseInt(hex.substr(4, 2), 16) / 255;
                        return { r, g, b };
                    } else if (color.startsWith('rgb')) {
                        const match = color.match(/\d+/g);
                        if (match) {
                            return {
                                r: parseInt(match[0]) / 255,
                                g: parseInt(match[1]) / 255,
                                b: parseInt(match[2]) / 255
                            };
                        }
                    }

                    // Default black
                    return { r: 0, g: 0, b: 0 };
                }

                svgPathToPostScript(pathData) {
                    if (!pathData) return '';

                    let ps = '';
                    const commands = pathData.match(/[a-df-z][^a-df-z]*/gi) || [];

                    let currentX = 0, currentY = 0;
                    let startX = 0, startY = 0;

                    commands.forEach(cmd => {
                        const type = cmd[0];
                        const args = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));

                        const transformY = (y) => bounds.height - (y - bounds.y); // SVG Y-down to PS Y-up

                        switch (type.toUpperCase()) {
                            case 'M': // moveto
                                currentX = type === 'M' ? args[0] : currentX + args[0];
                                currentY = type === 'M' ? args[1] : currentY + args[1];
                                startX = currentX;
                                startY = currentY;
                                ps += `${currentX.toFixed(2)} ${transformY(currentY).toFixed(2)} moveto\n`;
                                break;

                            case 'L': // lineto
                                currentX = type === 'L' ? args[0] : currentX + args[0];
                                currentY = type === 'L' ? args[1] : currentY + args[1];
                                ps += `${currentX.toFixed(2)} ${transformY(currentY).toFixed(2)} lineto\n`;
                                break;

                            case 'H': // horizontal line
                                currentX = type === 'H' ? args[0] : currentX + args[0];
                                ps += `${currentX.toFixed(2)} ${transformY(currentY).toFixed(2)} lineto\n`;
                                break;

                            case 'V': // vertical line
                                currentY = type === 'V' ? args[0] : currentY + args[0];
                                ps += `${currentX.toFixed(2)} ${transformY(currentY).toFixed(2)} lineto\n`;
                                break;

                            case 'C': // cubic bezier
                                if (args.length >= 6) {
                                    const x1 = type === 'C' ? args[0] : currentX + args[0];
                                    const y1 = type === 'C' ? args[1] : currentY + args[1];
                                    const x2 = type === 'C' ? args[2] : currentX + args[2];
                                    const y2 = type === 'C' ? args[3] : currentY + args[3];
                                    currentX = type === 'C' ? args[4] : currentX + args[4];
                                    currentY = type === 'C' ? args[5] : currentY + args[5];
                                    ps += `${x1.toFixed(2)} ${transformY(y1).toFixed(2)} ${x2.toFixed(2)} ${transformY(y2).toFixed(2)} ${currentX.toFixed(2)} ${transformY(currentY).toFixed(2)} curveto\n`;
                                }
                                break;

                            case 'Z': // closepath
                                ps += `closepath\n`;
                                currentX = startX;
                                currentY = startY;
                                break;
                        }
                    });

                    return ps;
                }

                buildEPS10() {
                    const date = new Date().toISOString();
                    const bounds = this.actualBounds;

                    // Use actual bounds for BoundingBox
                    let eps = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 ${Math.ceil(bounds.width)} ${Math.ceil(bounds.height)}
%%HiResBoundingBox: 0.0 0.0 ${bounds.width.toFixed(4)} ${bounds.height.toFixed(4)}
%%Creator: MetaGen Pro - Adobe Stock Metadata Generator
%%Title: Vector Illustration - Adobe Stock Compatible
%%CreationDate: ${date}
%%DocumentData: Clean7Bit
%%Origin: 0 0
%%Pages: 1
%%LanguageLevel: 2
%%EndComments

%%BeginProlog
%%EndProlog

%%BeginSetup
%%EndSetup

%%Page: 1 1
gsave

% Translate to align content with artboard origin
${(-bounds.x).toFixed(2)} ${(-bounds.y).toFixed(2)} translate

`;

                    // Draw all paths
                    this.psCommands.forEach(({ path, fill, stroke, strokeWidth }) => {
                        const psPath = this.svgPathToPostScript(path, bounds);

                        if (psPath) {
                            eps += `% New path\nnewpath\n`;
                            eps += psPath;

                            if (fill) {
                                eps += `gsave\n`;
                                eps += `${fill.r.toFixed(4)} ${fill.g.toFixed(4)} ${fill.b.toFixed(4)} setrgbcolor\n`;
                                eps += `fill\n`;
                                eps += `grestore\n`;
                            }

                            if (stroke) {
                                eps += `${strokeWidth.toFixed(2)} setlinewidth\n`;
                                eps += `${stroke.r.toFixed(4)} ${stroke.g.toFixed(4)} ${stroke.b.toFixed(4)} setrgbcolor\n`;
                                eps += `stroke\n`;
                            }

                            eps += `\n`;
                        }
                    });

                    eps += `grestore
showpage

%%EOF`;

                    return eps;
                }
            }

            // Generate EPS10 from SVG file
            async function generateAdobeStockEPS10(svgFile) {
                try {
                    const text = await svgFile.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(text, 'image/svg+xml');

                    const svg = doc.documentElement;
                    const generator = new AdobeStockEpsGenerator(svg);
                    const epsContent = generator.generate();

                    return new Blob([epsContent], { type: 'application/postscript' });
                } catch (error) {
                    console.error('Error generating EPS10:', error);
                    throw error;
                }
            }

            // Download EPS10 file
            async function downloadAsEPS10(svgFile, filename) {
                try {
                    const epsBlob = await generateAdobeStockEPS10(svgFile);
                    const url = URL.createObjectURL(epsBlob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename.replace(/\.svg$/i, '') + '.eps';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    alert('Error generating EPS file: ' + error.message);
                }
            }

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


            // --- FILE UPLOAD BUTTONS ---
            if (jpgPngButton && jpgPngInput) jpgPngButton.onclick = () => jpgPngInput.click();
            if (svgEpsButton && svgEpsInput) svgEpsButton.onclick = () => svgEpsInput.click();
            if (videoButton && videoInput) videoButton.onclick = () => videoInput.click();

            // --- FILE INPUT CHANGE ---
            if (jpgPngInput) jpgPngInput.onchange = (e) => handleFiles(e.target.files);
            if (svgEpsInput) svgEpsInput.onchange = (e) => handleFiles(e.target.files);
            if (videoInput) videoInput.onchange = (e) => handleFiles(e.target.files);

            const folderButton = document.getElementById('folderUploadButton');
            const folderInput = document.getElementById('folderInput');

            if (folderButton && folderInput) {
                folderButton.onclick = () => folderInput.click();
                folderInput.onchange = (e) => handleFiles(e.target.files);
            }

            // --- DRAG & DROP ---
            const dropZone = document.getElementById('dropZone');
            if (dropZone) {
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, preventDefaults, false));
                function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
                ['dragenter', 'dragover'].forEach(eventName => dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false));
                ['dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false));

                async function traverseFileTree(item, path = '') {
                    return new Promise((resolve) => {
                        if (!item) {
                            resolve([]);
                            return;
                        }
                        if (item.isFile) {
                            item.file((file) => {
                                // Preserve full path for FTP & processing 
                                file.customPath = path + file.name;
                                resolve([file]);
                            });
                        } else if (item.isDirectory) {
                            const dirReader = item.createReader();
                            const entries = [];
                            const readEntries = () => {
                                dirReader.readEntries(async (results) => {
                                    if (!results.length) {
                                        let allFiles = [];
                                        for (const entry of entries) {
                                            const subFiles = await traverseFileTree(entry, path + item.name + "/");
                                            allFiles.push(...subFiles);
                                        }
                                        resolve(allFiles);
                                    } else {
                                        entries.push(...results);
                                        readEntries();
                                    }
                                });
                            };
                            readEntries();
                        } else {
                            resolve([]);
                        }
                    });
                }

                dropZone.addEventListener('drop', async (event) => {
                    if (event.dataTransfer && event.dataTransfer.items) {
                        const items = event.dataTransfer.items;
                        let allFiles = [];
                        const promises = [];
                        for (let i = 0; i < items.length; i++) {
                            const item = items[i];
                            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                            if (entry) {
                                promises.push(traverseFileTree(entry));
                            } else if (item.kind === 'file') {
                                const file = item.getAsFile();
                                if (file) {
                                    file.customPath = file.name;
                                    allFiles.push(file);
                                }
                            }
                        }
                        if (promises.length > 0) {
                            const resolvedFiles = await Promise.all(promises);
                            for (const files of resolvedFiles) {
                                allFiles.push(...files);
                            }
                        }
                        if (allFiles.length > 0) {
                            handleFiles(allFiles);
                        } else if (event.dataTransfer.files.length > 0) {
                            handleFiles(event.dataTransfer.files);
                        }
                    } else if (event.dataTransfer && event.dataTransfer.files.length) {
                        handleFiles(event.dataTransfer.files);
                    }
                }, false);
            }

            // --- HANDLE FILES (EPS Support Improved) ---
            function base64ToFile(base64, filename) {
                const byteString = atob(base64);
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                    ia[i] = byteString.charCodeAt(i);
                }
                const blob = new Blob([ab], { type: 'image/png' });
                return new File([blob], filename, { type: 'image/png' });
            }
            window.handleFiles = async function handleFiles(files) {
                if (files.length === 0) return;

                // 🟠 IMMEDIATE UI FEEDBACK: Hide upload section and show Add More button
                const uploadSection = document.querySelector('.file-upload-section');
                const addMoreBtn = document.getElementById('addMoreFilesButton');
                const previewContainer = document.getElementById('filePreviewContainer');

                if (uploadSection) uploadSection.style.display = 'none';
                if (addMoreBtn) addMoreBtn.style.display = 'inline-flex';

                // Show a global loading state if needed, or rely on individual card spinners
                // (Individual cards have spinners by default)

                const user = auth.currentUser;

                // Get usage synchronously from global state to avoid blocking file load
                let usage = window.userUsageData || { plan: 'free', limit: 10 };
                let currentPlan = 'free';
                if (usage.plan) {
                    const rawPlan = String(usage.plan).toLowerCase().trim();
                    if (rawPlan.includes('premium')) currentPlan = 'premium';
                    else if (rawPlan.includes('pro')) currentPlan = 'pro';
                } else if (usage.limit) {
                    if (usage.limit >= 100) currentPlan = 'premium';
                    else if (usage.limit >= 70) currentPlan = 'pro';
                }

                let maxFiles = 50;
                if (currentPlan === 'free') {
                    maxFiles = usage.limit || 10;
                } else if (currentPlan === 'pro') {
                    maxFiles = 200;
                } else if (currentPlan === 'premium') {
                    maxFiles = 300;
                }

                if (files.length > maxFiles) {
                    alert(`Your ${currentPlan.toUpperCase()} plan allows processing up to ${maxFiles} files at once. You selected ${files.length} files. Please reduce the number of files or upgrade.`);

                    // Restore upload section if rejected
                    if (uploadedFilesData.length === 0 && uploadSection) uploadSection.style.display = 'flex';
                    if (addMoreBtn) addMoreBtn.style.display = 'none';
                    return;
                }

                // In the background, fetch fresh usage without blocking rendering
                if (user && user.email) {
                    getMetadataUsage(user.email).then(freshUsage => {
                        window.userUsageData = { ...freshUsage, email: user.email };
                        if (typeof updateUsageUI === 'function') {
                            updateUsageUI();
                        }
                    }).catch(e => console.warn("Background usage check failed:", e));
                }

                // Separate vector and non-vector files
                const vectorFiles = [];
                const normalFiles = [];

                for (const file of files) {
                    const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
                    const isEps = file.name.toLowerCase().endsWith('.eps');

                    if (isSvg || isEps) {
                        vectorFiles.push(file);
                    } else {
                        normalFiles.push(file);
                    }
                }

                // Process vector files with batch checklist (Only if Copyright Check is Enabled)
                const copyrightToggle = document.getElementById('copyrightToggle');
                const isCopyrightCheckEnabled = copyrightToggle ? copyrightToggle.checked : false;

                if (vectorFiles.length > 0) {
                    if (isCopyrightCheckEnabled) {
                        await showBatchVectorChecklist(vectorFiles);
                        return; // Wait for user to click Continue/Cancel
                    } else {
                        // Toggle OFF: Process vectors in parallel
                        vectorFiles.map(file => processVectorFile(file));
                    }
                }

                // Process normal files in parallel
                normalFiles.map(file => processVectorFile(file));
            }

            // Show batch checklist for multiple vector files
            async function showBatchVectorChecklist(files) {
                const analysisResults = [];

                for (const file of files) {
                    const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');

                    if (isSvg) {
                        const results = await analyzeSvgFile(file);
                        analysisResults.push({ file, results });
                    } else {
                        // EPS - generic warnings
                        analysisResults.push({
                            file,
                            results: {
                                noGradientMesh: { pass: true, status: 'warning' },
                                textOutlined: { pass: true, status: 'warning' },
                                noRasterImage: { pass: true, status: 'warning' },
                                strokeExpanded: { pass: true, status: 'warning' },
                                transparencyFound: { pass: true, status: 'warning' }
                            }
                        });
                    }
                }

                displayBatchChecklist(analysisResults);
                pendingVectorFiles = analysisResults;
            }

            // Display batch checklist in modal
            function displayBatchChecklist(analysisResults) {
                const modal = document.getElementById('vectorChecklistModal');
                const titleElem = modal.querySelector('h3');
                const resultsDiv = document.getElementById('checklistResults');

                // Update title based on count
                const fileCount = analysisResults.length;
                titleElem.textContent = fileCount === 1
                    ? '📋 Vector File Quality Checklist'
                    : `📋 Vector Files Quality Checklist (${fileCount} files)`;

                // Generate checklist for each file
                resultsDiv.innerHTML = `
                    <div class="checklist-files-container">
                        ${analysisResults.map(({ file, results }, index) => {
                    const checks = [
                        { key: 'noGradientMesh', label: 'No gradient mesh', emoji: '🎨' },
                        { key: 'textOutlined', label: 'Text outlined', emoji: '📝' },
                        { key: 'noRasterImage', label: 'No raster image', emoji: '🖼️' },
                        { key: 'strokeExpanded', label: 'Stroke expanded', emoji: '✏️' },
                        { key: 'transparencyFound', label: 'Transparency found', emoji: '👁️' }
                    ];

                    return `
                                <div class="checklist-file-block">
                                    <div class="checklist-file-header">
                                        <span class="checklist-file-number">#${index + 1}</span>
                                        <span class="checklist-file-name">${file.name}</span>
                                    </div>
                                    <div class="checklist-results">
                                        ${checks.map(check => {
                        const result = results[check.key];
                        const icon = result.status === 'pass' ? '✓' :
                            result.status === 'warning' ? '⚠' : '✗';
                        const statusClass = `check-${result.status}`;

                        return `
                                                <div class="checklist-item ${statusClass}">
                                                    <span class="check-icon">${icon}</span>
                                                    <span class="check-label">${check.emoji} ${check.label}</span>
                                                </div>
                                            `;
                    }).join('')}
                                    </div>
                                </div>
                            `;
                }).join('')}
                    </div>
                `;

                modal.style.display = 'flex';
            }


            // Extract Preview from Video file
            async function extractVideoPreview(videoFile) {
                return new Promise((resolve, reject) => {
                    const video = document.createElement('video');
                    video.preload = 'metadata';
                    video.muted = true;
                    video.playsInline = true;
                    video.src = URL.createObjectURL(videoFile);

                    video.onloadedmetadata = () => {
                        const duration = (isNaN(video.duration) || !isFinite(video.duration) || video.duration === 0) ? 2 : video.duration;
                        const seekTime = Math.min(1, duration * 0.1);
                        video.currentTime = seekTime;
                    };

                    video.onseeked = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                        const isVertical = video.videoWidth < video.videoHeight;

                        canvas.toBlob((blob) => {
                            URL.revokeObjectURL(video.src);
                            if (blob) {
                                const f = new File([blob], videoFile.name + ".jpg", { type: 'image/jpeg' });
                                f.isVertical = isVertical;
                                resolve(f);
                            } else {
                                reject(new Error("Failed to extract video frame"));
                            }
                        }, 'image/jpeg', 0.9);
                    };

                    video.onerror = (e) => {
                        URL.revokeObjectURL(video.src);
                        reject(new Error("Video load error: " + (video.error ? video.error.message : 'Unknown error')));
                    };
                });
            }


            // Extract Preview from AI (PDF-compatible) file
            async function extractAiPreview(aiFile) {
                // Initialize PDF.js
                const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
                if (!pdfjsLib) throw new Error("PDF.js library not loaded");

                // Ensure worker is set correctly
                if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                }

                try {
                    const arrayBuffer = await aiFile.arrayBuffer();
                    const uint8Array = new Uint8Array(arrayBuffer); // FIX: Convert to Uint8Array for strict parsing
                    
                    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
                    const pdf = await loadingTask.promise;
                    const page = await pdf.getPage(1);

                    const viewport = page.getViewport({ scale: 1.5 });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    await page.render({ canvasContext: context, viewport: viewport }).promise;

                    return new Promise((resolve, reject) => {
                        canvas.toBlob((blob) => {
                            if (blob) {
                                const file = new File([blob], aiFile.name.replace(/\.ai$/i, '.png'), { type: "image/png" });
                                resolve(file);
                            } else {
                                reject(new Error("Canvas to Blob conversion failed"));
                            }
                        }, 'image/png');
                    });
                } catch (error) {
                    console.error("PDF.js extraction error:", error);
                    throw new Error("Invalid PDF Structure. Falling back to server render.");
                }
            }

            // Function to upscale image using ClipDrop
            async function upscaleImageToClipDrop(cardId, file) {
                const upscaleBtn = document.getElementById(`upscale-btn-${cardId}`);
                const originalText = upscaleBtn.innerHTML;
                const spinner = document.querySelector(`#${cardId} .image-spinner`);

                try {
                    upscaleBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Upscaling...';
                    upscaleBtn.disabled = true;
                    if (spinner) spinner.style.display = 'block';

                    // Get Firebase auth token
                    const user = auth.currentUser;
                    if (!user) {
                        alert('Please sign in to use the Upscale feature.');
                        upscaleBtn.innerHTML = originalText;
                        upscaleBtn.disabled = false;
                        if (spinner) spinner.style.display = 'none';
                        return;
                    }
                    const idToken = await user.getIdToken();

                    // Calculate target dimensions (2x upscale, capped at 4096)
                    const imgEl = document.querySelector(`#${cardId} .thumbnail-medium`);
                    const origW = imgEl ? imgEl.naturalWidth : 1024;
                    const origH = imgEl ? imgEl.naturalHeight : 1024;
                    let targetW = origW * 2;
                    let targetH = origH * 2;
                    if (targetW > 4096 || targetH > 4096) {
                        const scale = 4096 / Math.max(targetW, targetH);
                        targetW = Math.round(targetW * scale);
                        targetH = Math.round(targetH * scale);
                    }

                    const formData = new FormData();
                    formData.append('image_file', file);
                    formData.append('target_width', String(targetW));
                    formData.append('target_height', String(targetH));

                    const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/clipdrop/upscale', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + idToken },
                        body: formData
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
                    }

                    const upscaledBlob = await response.blob();

                    // Create a new File object from the upscaled blob
                    const upscaledFile = new File([upscaledBlob], file.name, { type: upscaledBlob.type || file.type });

                    // Replace image source in UI
                    const imgElement = document.querySelector(`#${cardId} .thumbnail-medium`);
                    if (imgElement) {
                        const url = URL.createObjectURL(upscaledFile);
                        imgElement.src = url;
                    }

                    // Update fileObject in uploadedFilesData so Embed Metadata uses the upscaled version
                    const fileDataEntry = uploadedFilesData.find(f => f.id === cardId);
                    if (fileDataEntry) {
                        fileDataEntry.fileObject = upscaledFile;
                    }

                    // Hide the button after successful upscale
                    upscaleBtn.style.display = 'none';

                } catch (error) {
                    console.error('Error upscaling image:', error);
                    alert('Failed to upscale image. Please try again.\n' + error.message);
                    upscaleBtn.innerHTML = originalText;
                    upscaleBtn.disabled = false;
                } finally {
                    if (spinner) spinner.style.display = 'none';
                }
            }


            // Helper to capture a small thumbnail for history
            function captureThumbnail(cardId, size = 120) {
                const img = document.querySelector(`#${cardId} .thumbnail-medium`);
                if (!img || !img.complete || img.naturalWidth === 0) return null;

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // Keep aspect ratio
                let w = img.naturalWidth;
                let h = img.naturalHeight;
                if (w > h) {
                    h = (h / w) * size;
                    w = size;
                } else {
                    w = (w / h) * size;
                    h = size;
                }

                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);
                return canvas.toDataURL('image/jpeg', 0.7);
            }

            // Process file after checklist approval or for non-vector files
            async function processVectorFile(file) {
                const card = document.createElement('div');
                card.className = 'file-preview-card';
                card.id = 'file-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
                const isEps = file.name.toLowerCase().endsWith('.eps');
                const isAi = file.name.toLowerCase().endsWith('.ai');
                const isVideo = file.type.startsWith('video/') || ['mp4', 'mov', 'avi', 'webm', 'mkv'].some(ext => file.name.toLowerCase().endsWith('.' + ext));
                const placeholderSrc = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48L3N2Zz4=`;

                const sizeStr = file.size < 1024 * 1024
                    ? (file.size / 1024).toFixed(1) + ' KB'
                    : (file.size / (1024 * 1024)).toFixed(1) + ' MB';

                window.processVectorFile = processVectorFile;

                card.innerHTML = `
                    <div class="card-image-col">
                        <div class="card-checkbox-container">
                            <input type="checkbox" class="bulk-checkbox" data-file-id="${card.id}" onchange="handleCheckboxChange()">
                        </div>
                        <div class="card-image-actions">
                            <button class="card-image-action-btn regenerate" title="Regenerate" onclick="regenerateMetadata(this)"><span style="font-size:1.1em;">&#x21bb;</span></button>
                            <button class="card-image-action-btn close" title="Close" onclick="closeCard(this)"><span style="font-size:1.1em;">&#x2716;</span></button>
                        </div>
                        <img loading='lazy' src="${placeholderSrc}" alt="${file.name}" class="thumbnail-medium" style="position: relative; overflow: hidden; border-radius: 12px;">

                        <!-- Quality Scan Overlay -->
                        <div id="qualityScanOverlay-${card.id}" class="sales-scan-overlay" style="display:none; z-index: 9;">
                            <div class="sales-scan-line"></div>
                        </div>
                        
                        <!-- Image Properties Overlay -->
                        <div class="image-properties-overlay">
                            <div class="prop-row"><span class="prop-label">Name:</span><span class="prop-value">${file.name}</span></div>
                            <div class="prop-row"><span class="prop-label">Size:</span><span class="prop-value">${sizeStr}</span></div>
                            <div class="prop-row"><span class="prop-label">Type:</span><span class="prop-value">${file.type || 'N/A'}</span></div>
                            <div class="prop-row"><span class="prop-label">Dims:</span><span class="prop-value" id="dims-${card.id}">...</span></div>
                        </div>

                        ${isAi ? '<div class="file-type-badge ai-badge" style="position: absolute; top: 10px; left: 10px; padding: 4px 8px; border-radius: 4px; font-size: 0.7em; font-weight: bold; background: #FF7F18; color: white;">AI</div>' : ''}
                        ${isVideo ? '<div class="file-type-badge video-badge" style="position: absolute; top: 15px; left: 46px; padding: 4px 8px; border-radius: 4px; font-size: 0.7em; font-weight: bold; background: #EF4444; color: white; z-index: 1000;">VIDEO</div>' : ''}
                        <div class="image-spinner" style="display:block;"></div>
                        
                        <!-- Copyright Status -->
                        <div id="copyright-status-${card.id}" class="copyright-status-container" style="margin-top: 2px; background: var(--bg-input); border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3); padding: 4px 12px; border-radius: 14px; text-align: center;">
                            <div class="copyright-badge copyright-checking">
                                <span class="image-spinner" style="display:inline-block; width:30px; height:30px; border-width:5px; margin:0;"></span> Checking Copyright...
                            </div>
                        </div>

                        <!-- Quality Status Badge (Bottom) -->
                        <div id="quality-status-container-${card.id}" class="quality-status-container" style="position: relative; left: 0; right: 0; width: 100%; text-align: center; z-index: 10;">
                            <div class="quality-status-badge pending" id="quality-badge-${card.id}" style="backdrop-filter: blur(25px); margin-top: 2px; background: var(--bg-input); border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 4px 15px rgba(0,0,0,0.3); padding: 5px 12px; font-size: 0.7em; color: #0eb17c; font-weight: 800;">
                                <i class="fas fa-microscope"></i> <span data-i18n="quality_pending">Quality: Pending</span>
                            </div>
                        </div>

                        <!-- SEO Score Meter -->
                        <div class="seo-meter-container" id="seo-meter-${card.id}" style="display:none;">
                            <div class="locked-overlay" id="seo-lock-${card.id}" style="display:none;" onclick="showProUpgradeAlert()">
                                <div class="lock-icon" title="Pro Feature">🔒</div>
                            </div>
                            <div class="seo-score-header">
                               <span>
                                  <span data-i18n="seo_score">SEO Score</span>
                                    <a href="https://www.aimetagenpro.com/p/seo-score.html" target="blank" class="seo-info-icon" title="Learn how to improve SEO Score">i</a>
                                  </span>
                                <span class="seo-badge excellent" id="seo-badge-${card.id}">0 / 100 🟢 Excellent</span>
                            </div>
                            <div class="seo-progress-bg">
                                <div class="seo-progress-fill excellent" id="seo-progress-${card.id}" style="width: 0%;"></div>
                            </div>
                            <div class="seo-suggestions" id="seo-suggestions-${card.id}" style="color:var(--text-muted); font-size:0.75em; margin-top:8px; display:none; flex-direction:column; gap:4px; padding:6px; border-radius:4px; background:var(--bg-tertiary); border: 1px dashed var(--border-color);"></div>
                        </div>

                        <!-- Rejection Predictor Meter -->
                        <div class="rejection-meter-container" id="rejection-meter-${card.id}" style="display:none;">
                            <div class="locked-overlay" id="rejection-lock-${card.id}" style="display:none;" onclick="showProUpgradeAlert()">
                                <div class="lock-icon" title="Pro Feature">🔒</div>
                            </div>
                            <div class="rejection-header">
                                <span><span data-i18n="rejection">Rejection Chance</span> <button class="seo-info-icon" onclick="openRejectionInfoModal()" title="How to reduce rejection chance">i</button></span>
                                <span class="rejection-badge rejection-low" id="rejection-badge-${card.id}">0%</span>
                            </div>
                            <div class="rejection-progress-bg">
                                <div class="rejection-progress-fill fill-low" id="rejection-progress-${card.id}" style="width: 0%;"></div>
                            </div>
                        </div>

                        <!-- Release Requirements Check -->
                        <div class="platform-requirements-container" id="release-req-${card.id}" style="display:none; padding-bottom:10px;">            
                             <div class="platform-req-header">
                                 <span><span>Release Requirements</span></span>
                             </div>
                             <div class="platform-req-item">
                                 <span>Model Release</span>
                                 <span class="req-status" id="req-model-${card.id}">...</span>
                             </div>
                             <div class="platform-req-item">
                                 <span>Property Release</span>
                                 <span class="req-status" id="req-property-${card.id}">...</span>
                             </div>
                             <div class="release-upload-container" id="release-upload-container-${card.id}" style="display:none; margin-top:8px; width:100%;">
                                 <button class="action-button blue-button" style="width:100%; text-align:center; padding: 6px;" onclick="document.getElementById('release-input-${card.id}').click();"><i class="fas fa-upload"></i> Upload Releases</button>
                                 <input type="file" id="release-input-${card.id}" multiple class="release-file-input" style="display:none;" onchange="handleReleaseUpload(this, '${card.id}')">
                                 <div id="release-files-list-${card.id}" style="font-size:0.75em; margin-top:5px; color: var(--accent-orange); word-break: break-all;"></div>
                             </div>
                        </div>
                        
                        <button id="upscale-btn-${card.id}" class="action-button blue-button" style="display:none; width:100%; margin-top:8px; justify-content:center; align-items:center; gap:6px;">
                            <i class="fas fa-expand-arrows-alt"></i> Upscale (Advance AI)
                        </button>

                        <div class="card-filename" style="display:none;">${file.name}</div>
                    </div>
                    <div class="card-meta-col">
                        <!-- Metadata Section -->
                        <div class="meta-translation-controls" style="margin-bottom: 15px; padding: 6px; background: var(--bg-input); border-radius: 6px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <span style="font-size: 0.7em; color: var(--text-muted);"><i class="fas fa-language"></i> <span data-i18n="translate">Translate</span>:</span>
                                <select id="translate-lang-${card.id}" style="padding: 4px 8px; border-radius: 4px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color);">
                                     <option value="en">English</option>
                                     <option value="es">Spanish</option>
                                     <option value="fr">French</option>
                                     <option value="de">German</option>
                                     <option value="ja">Japanese</option>
                                     <option value="pt">Portuguese</option>
                                     <option value="it">Italian</option>
                                     <option value="bn">Bengali</option>
                                     <option value="hi">Hindi</option>
                                     <option value="ar">Arabic</option>
                                     <option value="zh">Chinese</option>
                                     <option value="ko">Korean</option>
                                     <option value="id">Indonesian</option>
                                </select>
                                <button class="action-button blue-button" style="padding: 4px 12px; font-size: 0.65em; white-space: nowrap; flex-shrink: 0;" onclick="translateMetadata('${card.id}')"><span data-i18n="go">Go</span></button>
                            </div>
                        </div>
                        <div class="meta-section" style="position: relative;">
                            <div class="meta-section-label" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                <span>
                                    <span data-i18n="label_title">Title</span>
                                    <span id="title-count-${card.id}" class="meta-count"></span>
                                </span>
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <button class="action-button blue-button TitleBtn" id="check-clarity-btn-${card.id}" style="padding: 5px 8px; font-size: 0.72em; display: none; height: auto;" onclick="checkTitleClarity('${card.id}')">
                                        <i class="fas fa-magic" style='margin-right: 5px;'></i> Clarity
                                    </button>
                                    <button class="copy-btn" onclick="copyToClipboard(this, 'title')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button>
                                </div>
                            </div>
                            <div class="meta-title" contenteditable="true" oninput="updateTitle(this)"></div>

                            <!-- Clarity Checker Widget -->
                            <div id="clarity-checker-container-${card.id}" class="clarity-checker-container" style="display: none;">
                                <div class="clarity-scores-row">
                                    <div class="clarity-score-item">
                                        <div class="clarity-score-header">
                                            <span>Accuracy</span>
                                            <span id="clarity-grammar-value-${card.id}" class="clarity-score-value">0%</span>
                                        </div>
                                        <div class="clarity-progress-bg">
                                            <div id="clarity-grammar-bar-${card.id}" class="clarity-progress-fill" style="width: 0%;"></div>
                                        </div>
                                    </div>
                                    <div class="clarity-score-item">
                                        <div class="clarity-score-header">
                                            <span>Buyer Appeal</span>
                                            <span id="clarity-appeal-value-${card.id}" class="clarity-score-value">0%</span>
                                        </div>
                                        <div class="clarity-progress-bg">
                                            <div id="clarity-appeal-bar-${card.id}" class="clarity-progress-fill" style="width: 0%;"></div>
                                        </div>
                                    </div>
                                </div>
                                <div id="clarity-details-${card.id}" class="clarity-details">
                                    <div id="clarity-feedback-${card.id}" class="clarity-feedback"></div>
                                    <ul id="clarity-suggestions-${card.id}" class="clarity-suggestions"></ul>
                                </div>
                                <div id="clarity-lock-overlay-${card.id}" class="locked-overlay" style="display: none;" onclick="scrollToPricing(); alert('Upgrade to PRO or PREMIUM plan to unlock actionable title optimization suggestions.')">
                                    <div class="lock-icon" style="font-size: 1.25em;">🔒</div>
                                    <span style="font-size: 0.7em; font-weight: bold; color: var(--text-primary);">Unlock Pro Recommendations</span>
                                </div>
                                <div class="clarity-header-actions" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
                                    <button class="action-button blue-button TitleBtn" id="clarity-fix-btn-${card.id}" style="padding: 2px 8px; font-size: 0.72em; height: auto;" onclick="fixTitleWithAI('${card.id}')">
                                        <i class="fas fa-magic"></i> AI Fix
                                    </button>
                                    <button class="action-button" style="padding: 2px 8px; font-size: 0.72em; height: auto; background: #e12727c7; border: 1px solid rgba(255,255,255,0.2); color: #fff; cursor: pointer;" onclick="document.getElementById('clarity-checker-container-${card.id}').style.display='none'">
                                        <i class="fas fa-times"></i> Close
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="meta-section" id="desc-section-${card.id}">
                            <div class="meta-section-label"><span><span data-i18n="label_desc">Description</span> <span id="desc-count-${card.id}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'description')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                            <div class="meta-description"></div>
                        </div>
                        <div class="meta-section">
                            <div class="meta-section-label"><span><span data-i18n="label_keywords">Keywords</span> <span id="keyword-count-${card.id}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'keywords')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                            <div class="meta-keywords"></div>
                            <div class="keyword-add-container">
                                <input type="text" class="keyword-add-input" data-i18n="placeholder_add_kw" placeholder="Add keyword..." id="keyword-input-${card.id}" onkeypress="if(event.key === 'Enter') addKeyword('${card.id}')">
                                <button class="keyword-add-btn" style='white-space: nowrap; flex-shrink: 0;' onclick="addKeyword('${card.id}')">+ <span data-i18n="btn_add">Add</span></button>
                            </div>
                            <div class="keyword-preset-container" style="margin-top: 8px; display: flex; gap: 8px; align-items: center;">
                                <select class="preset-select-dropdown" data-card-id="${card.id}" onchange="window.applyPresetToCard('${card.id}', this.value)" style="flex: 1; padding: 4px 8px; border-radius: 4px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); font-size: 0.72em; width: 80%;">
                                    <option value="">📁 Apply Preset/Templates...</option>
                                </select>
                                <button class="action-button blue-button" onclick="window.savePresetFromCard('${card.id}')" title="Save current keywords as preset template" style="padding: 4px 8px; font-size: 0.72em; margin-top: 0; white-space: nowrap; flex-shrink: 0;">
                                    <i class="fas fa-save"></i> Save Preset
                                </button>
                            </div>
                        </div>
                        
                        <!-- AI Category Select (Adobe Stock) -->
                        <div class="meta-section adobe-only-section" style="display:none;"> 
                          <div class="meta-section-label">
                              <span><i class="fas fa-tags"></i> <span data-i18n="ai_category">AI Category (Adobe Stock)</span></span>
                          </div>
                             <select class="meta-category-select" id="ai-category-${card.id}">
                                <option value="">Select Category...</option>
                                <option value="Animals">Animals</option>
                                <option value="Buildings and Architecture">Buildings and Architecture</option>
                                <option value="Business">Business</option>
                                <option value="Drinks">Drinks</option>
                                <option value="Environment">Environment</option>
                                <option value="States of Mind">States of Mind</option>
                                <option value="Food">Food</option>
                                <option value="Graphic Resources">Graphic Resources</option>
                                <option value="Hobbies and Leisure">Hobbies and Leisure</option>
                                <option value="Industry">Industry</option>
                                <option value="Landscapes">Landscapes</option>
                                <option value="Lifestyle">Lifestyle</option>
                                <option value="People">People</option>
                                <option value="Plants and Flowers">Plants and Flowers</option>
                                <option value="Culture and Religion">Culture and Religion</option>
                                <option value="Science">Science</option>
                                <option value="Social Issues">Social Issues</option>
                                <option value="Sports">Sports</option>
                                <option value="Technology">Technology</option>
                                <option value="Transport">Transport</option>
                                <option value="Travel">Travel</option>
                            </select>
                        </div>
                        
                        <!-- New Style & Mood Grid -->
                        <div class="style-mood-grid">
                            <div class="meta-subsection" id="style-section-${card.id}" style="display:none;">
                                <div class="meta-section-label"><span><i class="icon-palette"></i> <span data-i18n="style">Style</span></span><button class="copy-btn mini" onclick="copyToClipboard(this, 'style')"><span data-i18n="btn_copy">Copy</span></button></div>
                                <div class="meta-style-container"></div>
                            </div>
                            <div class="meta-subsection" id="mood-section-${card.id}" style="display:none;">
                                <div class="meta-section-label"><span><i class="icon-smile"></i> <span data-i18n="mode">Mode</span></span><button class="copy-btn mini" onclick="copyToClipboard(this, 'mood')"><span data-i18n="btn_copy">Copy</span></button></div>
                                <div class="meta-mood-container"></div>
                            </div>
                        </div>

                        <button class="export-csv-btn" style="display:none;">Export CSV</button>
                        <button id="btn-eps-${card.id}" class="action-button purple-button" style="display:${((file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) && ((window.userUsageData?.plan && window.userUsageData.plan.toLowerCase().includes('premium')) || (window.userUsageData?.limit >= 100))) ? 'flex' : 'none'}; width:100%; margin-top:8px; justify-content:center; align-items:center; gap:6px;" disabled onclick="downloadAsEps('${card.id}')">
                            <i class="icon-download"></i> <span data-i18n='download'>Download</span> EPS10
                        </button>
                        <!-- Image to Prompt Section -->
                        <div class="prompt-section">
                             <div class="prompt-spinner" style="display: none;"></div>
                             <div class="prompt-result-container" style="display: none; width: 100%;">
                                 <!-- Style Tab Buttons -->
                                 <div class="prompt-tabs">
                                     <button class="prompt-tab-btn active" data-style="realistic" onclick="switchPromptStyle('${card.id}', 'realistic')">
                                         📷 <span data-i18n="style_realistic">Realistic</span>
                                     </button>
                                     <button class="prompt-tab-btn" data-style="illustration" onclick="switchPromptStyle('${card.id}', 'illustration')" style='background: #8b5cf6;'>
                                         🎨 <span data-i18n="style_illustration">Illustration</span>
                                     </button>
                                     <button class="prompt-tab-btn" data-style="3d" onclick="switchPromptStyle('${card.id}', '3d')" style='width: 100%;
    background: #f16908;'>
                                         🧊 <span data-i18n="style_3d">3D Render</span>
                                     </button>
                                 </div>
                                 
                                 <!-- Prompt Text Content Areas -->
                                 <div class="prompt-text-wrapper" style="position: relative; width: 100%;">
                                     <div class="prompt-text prompt-style-content active" id="prompt-realistic-${card.id}" style="font-size: 0.82em; line-height: 1.5; color: var(--text-secondary); max-height: 150px; overflow-y: auto; padding: 6px 4px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 6px; word-break: break-word;"></div>
                                     <div class="prompt-text prompt-style-content" id="prompt-illustration-${card.id}" style="display: none; font-size: 0.82em; line-height: 1.5; color: var(--text-secondary); max-height: 150px; overflow-y: auto; padding: 6px 4px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 6px; word-break: break-word;"></div>
                                     <div class="prompt-text prompt-style-content" id="prompt-3d-${card.id}" style="display: none; font-size: 0.82em; line-height: 1.5; color: var(--text-secondary); max-height: 150px; overflow-y: auto; padding: 6px 4px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 6px; word-break: break-word;"></div>
                                 </div>
                                 
                                 <!-- Actions -->
                                 <div class="prompt-actions-inline">
                                     <button class="action-button blue-button" onclick="copyPromptFromCard(this)"><i class="icon-copy"></i> <span data-i18n="btn_copy">Copy</span></button>
                                     <button class="action-button purple-button" onclick="copyAllPromptsFromCard('${card.id}')"><i class="icon-copy"></i> <span data-i18n="btn_copy_all">Copy All</span></button>
                                     <button class="action-button green-button" onclick="downloadPromptFromCard(this)"><i class="icon-download"></i> <span data-i18n="download">Download</span></button>
                                 </div>
                             </div>
                        </div>

                    </div>`;

                const activePlatform = document.querySelector('.platform-button.active')?.dataset.platform;
                if (activePlatform === 'adobe') {
                    const adobeSec = card.querySelector('.adobe-only-section');
                    if (adobeSec) adobeSec.style.display = 'block';
                }

                previewContainer.appendChild(card);
                const currentLang = localStorage.getItem('selectedLanguage') || 'en';
                if (typeof updateUI === 'function') {
                    updateUI(currentLang, card);
                }

                const imgElement = card.querySelector('.thumbnail-medium');

                // NEW: Update dimensions when image loads
                if (imgElement) {
                    imgElement.onload = function () {
                        const width = this.naturalWidth;
                        const height = this.naturalHeight;
                        const dimsEl = document.getElementById(`dims-${card.id}`);
                        if (dimsEl) {
                            dimsEl.textContent = `${width} x ${height}`;
                        }

                        // NEW: Update Video Badge for Short Videos
                        const fileDataObj = uploadedFilesData.find(f => f.id === card.id);
                        if (fileDataObj && fileDataObj.isVideo && (width < height || fileDataObj.isVertical)) {
                            fileDataObj.isVertical = true;
                            const videoBadge = card.querySelector('.video-badge');
                            if (videoBadge) {
                                videoBadge.textContent = "SHORT VIDEO";
                                videoBadge.style.background = "linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)";
                            }
                        }

                        // Capture thumbnail for history
                        try {
                            if (typeof captureThumbnail === 'function') {
                                const thumb = captureThumbnail(card.id, 100);
                                if (thumb) {
                                    const entry = uploadedFilesData.find(f => f.id === card.id);
                                    if (entry) entry.thumbnail = thumb;
                                }
                            }
                        } catch (e) { console.warn("Thumb capture failed in onload:", e); }

                        // Check if dimensions are unsuitable for microstock (Pro/Premium only)
                        const userPlan = (window.userUsageData?.plan || 'free').toLowerCase();
                        const isProOrPremium = userPlan.includes('pro') || userPlan.includes('premium') || userPlan.includes('agency');
                        if ((file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp') && (width <= 1024 || height <= 1024)) {
                            const upscaleBtn = document.getElementById(`upscale-btn-${card.id}`);
                            if (upscaleBtn) {
                                upscaleBtn.style.display = 'flex';
                                upscaleBtn.onclick = () => {
                                    if (isProOrPremium) {
                                        upscaleImageToClipDrop(card.id, file);
                                    } else {
                                        alert("Upgrade to PRO/PREMIUM plan. Upscale (Advance AI) features are for pro & premium users only.");
                                        if (typeof scrollToPricing === 'function') scrollToPricing();
                                    }
                                };
                            }
                        }
                    };
                }

                const spinner = card.querySelector('.image-spinner');

                if (isEps) {
                    // --- EPS Conversion Restriction (Premium Only) ---
                    const user = auth.currentUser;

                    // Plan check: checks if plan includes 'premium' OR 'pro', or if limit >= 100
                    const userPlan = (window.userUsageData?.plan || '').toLowerCase();
                    let isProOrPremium = userPlan.includes('premium') || userPlan.includes('pro') || userPlan.includes('agency') || (window.userUsageData?.limit >= 100);

                    if (!isProOrPremium) {
                        alert("Direct Vector/EPS conversion is a Pro/Premium feature. Please upgrade to use this feature.");
                        openUpgradeModal('pro'); // অথবা আপনার প্রয়োজন অনুযায়ী 'premium' રાખতে পারেন
                        spinner.style.display = 'none';
                        return;
                    }

                    const formData = new FormData();
                    formData.append('file', file); // 'file' নামেই পাঠাতে হবে, কারণ সার্ভারে upload.single('file') দেওয়া আছে

                    // আপনার নতুন Render সার্ভারে রিকোয়েস্ট পাঠানো হচ্ছে
                    fetch(`https://metagen-eps-server.onrender.com/api/extract-eps`, {
                        method: 'POST',
                        body: formData
                    })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                const base64Data = data.base64;
                                imgElement.src = `data:image/jpeg;base64,${base64Data}`;

                                const newFileName = file.name;

                                // Copyright চেকের জন্য JPG প্রিভিউটি মেমরিতে রাখা হচ্ছে
                                const byteString = atob(base64Data);
                                const ab = new ArrayBuffer(byteString.length);
                                const ia = new Uint8Array(ab);
                                for (let i = 0; i < byteString.length; i++) {
                                    ia[i] = byteString.charCodeAt(i);
                                }
                                const blob = new Blob([ab], { type: 'image/jpeg' });
                                const jpegFile = new File([blob], newFileName + ".jpg", { type: 'image/jpeg' });

                                // === এখানেই মূল ফিক্স করা হয়েছে ===
                                uploadedFilesData.push({
                                    id: card.id,
                                    name: newFileName,
                                    fileObject: file, // <-- [FIX] এখানে অরিজিনাল EPS ফাইলটি সেভ রাখা হলো!
                                    previewFile: jpegFile, // <-- AI/Copyright এর জন্য প্রিভিউ JPG আলাদা রাখলাম!
                                    isAiFile: true, // EPS-কে ভিশন API এর জন্য AI ফাইলের মতো ট্রিট করা হবে
                                    title: '',
                                    keywords: '',
                                    description: '',
                                    style: '',
                                    mood: '',
                                    prompt: ''
                                });
                                updateAllButtonStates();

                                // Auto-run Copyright Check if enabled
                                if (document.getElementById('copyrightToggle') && document.getElementById('copyrightToggle').checked) {
                                    checkCopyrightAndTrademark(jpegFile, card.id);
                                } else {
                                    const statusEl = document.getElementById(`copyright-status-${card.id}`);
                                    if (statusEl) statusEl.style.display = 'none';
                                }

                            } else {
                                throw new Error(data.error || 'Conversion failed, no preview found.');
                            }
                        })
                        .catch(error => {
                            console.error('Error extracting EPS preview:', error);
                            // Fallback icon যদি কোনো কারণে কনভার্ট না হয়
                            imgElement.src = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSJub25lIiBzdHJva2U9IiM5NEE0QjgiIHN0cm9rZS13aWR0aD0iNCI+IDxyZWN0IHg9IjIiIHk9IjIiIHdpZHRoPSI5NiIgaGVpZHRoPSI5NiIgcng9IjgiIHJ5PSI4IiBmaWxsPSIjMUUyOTNCIi8+IDx0ZXh0IHg9IjUwIiB5PSI2MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMzYiIGZpbGw9IiM5NEE0QjgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtd2VpZ2h0PSJib2xkIj5FUFM8L3RleHQ+PC9zdmc+`;
                            alert("Failed to extract preview from EPS: " + error.message);
                        })
                        .finally(() => {
                            spinner.style.display = 'none';
                        });

                } else if (isAi) {
                    try {
                        // Attempt 1: Client-side PDF.js extraction
                        const previewFile = await extractAiPreview(file);
                        imgElement.src = URL.createObjectURL(previewFile);
                        uploadedFilesData.push({
                            id: card.id,
                            name: file.name,
                            fileObject: file,
                            previewFile: previewFile,
                            isAiFile: true,
                            title: '', keywords: '', description: '', style: '', mood: '', prompt: ''
                        });
                        
                    } catch (error) {
                        console.warn('Native AI preview failed. File is likely not PDF-compatible.', error);
                        
                        // সার্ভারে রিকোয়েস্ট না পাঠিয়ে সরাসরি অ্যালার্ট দিন এবং ডিফল্ট আইকন দেখান
                        alert(`Could not extract preview for "${file.name}".\n\nFor visual previews, please save .ai files with the "Create PDF Compatible File" option checked in Illustrator.`);

                        // Fallback generic AI icon (No server request to avoid 500 error)
                        imgElement.src = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSJub25lIiBzdHJva2U9IiNGRjdGMTgiIHN0cm9rZS13aWR0aD0iNCI+IDxyZWN0IHg9IjIiIHk9IjIiIHdpZHRoPSI5NiIgaGVpZHRoPSI5NiIgcng9IjgiIHJ5PSI4IiBmaWxsPSIjMUUyOTNCIi8+IDx0ZXh0IHg9IjUwIiB5PSI2MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMzYiIGZpbGw9IiNGRjdGMTgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtd2VpZ2h0PSJib2xkIj5BSTwvdGV4dD48L3N2Zz4=`;
                        
                        uploadedFilesData.push({
                            id: card.id,
                            name: file.name,
                            fileObject: file,
                            isAiFile: true,
                            title: '', keywords: '', description: '', style: '', mood: '', prompt: ''
                        });
                    } finally {
                        spinner.style.display = 'none';
                        updateAllButtonStates();

                        // Auto-run Copyright Check if enabled
                        if (document.getElementById('copyrightToggle') && document.getElementById('copyrightToggle').checked) {
                            const fileDataEntry = uploadedFilesData[uploadedFilesData.length - 1];
                            // প্রিভিউ ফাইল থাকলে কপিরাইট স্ক্যান করবে, না থাকলে ওয়ার্নিং দেখাবে
                            if (fileDataEntry && fileDataEntry.previewFile) {
                                checkCopyrightAndTrademark(fileDataEntry.previewFile, card.id);
                            } else {
                                const statusEl = document.getElementById(`copyright-status-${card.id}`);
                                if (statusEl) {
                                    statusEl.style.display = 'block';
                                    statusEl.innerHTML = '<div class="copyright-badge copyright-warning" style="font-size:0.75em;">⚠️ Preview Unavailable for Scan</div>';
                                }
                            }
                        } else {
                            const statusEl = document.getElementById(`copyright-status-${card.id}`);
                            if (statusEl) statusEl.style.display = 'none';
                        }
                    }
                } else if (isVideo) {
                    try {
                        const previewFile = await extractVideoPreview(file);
                        imgElement.src = URL.createObjectURL(previewFile);
                        uploadedFilesData.push({
                            id: card.id,
                            name: file.name,
                            fileObject: file,
                            previewFile: previewFile,
                            isAiFile: true,
                            isVideo: true,
                            isVertical: previewFile.isVertical,
                            title: '',
                            keywords: '',
                            description: '',
                            style: '',
                            mood: '',
                            prompt: ''
                        });
                    } catch (error) {
                        console.error('Video preview failed:', error);
                        // Fallback icon for video
                        imgElement.src = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSJub25lIiBzdHJva2U9IiNFRjQ0NDQiIHN0cm9rZS13aWR0aD0iNCI+IDxyZWN0IHg9IjIiIHk9IjIiIHdpZHRoPSI5NiIgaGVpZHRoPSI5NiIgcng9IjgiIHJ5PSI4IiBmaWxsPSIjMUUyOTNCIi8+IDx0ZXh0IHg9IjUwIiB5PSI2MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiNFRjQ0NDQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtd2VpZ2h0PSJib2xkIj5WSURFTzwvdGV4dD48L3N2Zz4=`;
                        uploadedFilesData.push({
                            id: card.id,
                            name: file.name,
                            fileObject: file,
                            isVideo: true,
                            isVertical: false,
                            title: '',
                            keywords: '',
                            description: '',
                            style: '',
                            mood: '',
                            prompt: ''
                        });
                    } finally {
                        spinner.style.display = 'none';
                        updateAllButtonStates();
                        const statusEl = document.getElementById(`copyright-status-${card.id}`);
                        if (statusEl) statusEl.style.display = 'none';
                    }
                } else {
                    imgElement.src = URL.createObjectURL(file);
                    spinner.style.display = 'none';

                    uploadedFilesData.push({
                        id: card.id,
                        name: file.name,
                        fileObject: file,
                        isAiGenerated: file.isAiGenerated || false,
                        title: '',
                        keywords: '',
                        description: '',
                        style: '',
                        mood: '',
                        prompt: ''
                    });
                    updateAllButtonStates();

                    // Auto-run Copyright Check if enabled (JPG/PNG)
                    if (document.getElementById('copyrightToggle') && document.getElementById('copyrightToggle').checked) {
                        checkCopyrightAndTrademark(file, card.id);
                    } else {
                        const statusEl = document.getElementById(`copyright-status-${card.id}`);
                        if (statusEl) statusEl.style.display = 'none';
                    }
                }
            }

            // --- COPYRIGHT CHECKER FUNCTION (UPDATED FOR LLAMA 4 & PIXTRAL) ---
            async function checkCopyrightAndTrademark(file, cardId) {
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
                const selectedCardIds = getSelectedCards();
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

            function updateQualityUI(cardId, results) {
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

            function drawQualityHeatmap(results) {
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

            // --- ADD MORE BUTTON LOGIC ---
            const addMoreFilesBtn = document.getElementById('addMoreFilesButton');
            if (addMoreFilesBtn) {
                addMoreFilesBtn.onclick = function () {
                    const uploadSection = document.querySelector('.file-upload-section');
                    if (uploadSection) {
                        uploadSection.style.display = 'flex'; // Or 'block' depending on original CSS, 'flex' matches .file-upload-section CSS 
                        // Optionally scroll to it
                        uploadSection.scrollIntoView({ behavior: 'smooth' });
                        // Hide this button again? Or keep it? User didn't specify, but usually "Add More" implies opening the dialog or showing the dropzone.
                        // Showing the dropzone makes sense.
                        this.style.display = 'none';
                    }
                };
            }

            // --- ACTION BUTTONS ---
            if (clearAllButton) {
                clearAllButton.onclick = function () {
                    uploadedFilesData = [];
                    previewContainer.innerHTML = '';
                    updateAllButtonStates();

                    if (typeof window.SessionDB !== 'undefined') window.SessionDB.clearSession();

                    // Show upload section again on Clear All
                    const uploadSection = document.querySelector('.file-upload-section');
                    const addMoreBtn = document.getElementById('addMoreFilesButton');
                    if (uploadSection) uploadSection.style.display = 'flex';
                    if (addMoreBtn) addMoreBtn.style.display = 'none';
                };
            }

            // Add test metadata button functionality
            const testMetadataButton = document.getElementById('testMetadataButton');
            if (testMetadataButton) {
                testMetadataButton.onclick = testMetadataCompatibility;
            }

            // ===== BULK SELECTION FEATURE =====

            // Handle checkbox state changes
            window.handleCheckboxChange = function () {
                const checkedBoxes = document.querySelectorAll('.bulk-checkbox:checked');
                const count = checkedBoxes.length;
                const bulkActionBar = document.getElementById('bulkActionBar');
                const selectedCountEl = document.getElementById('selectedCount');

                if (count > 0) {
                    bulkActionBar.style.display = 'flex';
                    selectedCountEl.textContent = count;
                } else {
                    bulkActionBar.style.display = 'none';
                }
            };

            // Get all selected card IDs
            function getSelectedCards() {
                const checkedBoxes = document.querySelectorAll('.bulk-checkbox:checked');
                const cardIds = [];
                checkedBoxes.forEach(checkbox => {
                    cardIds.push(checkbox.dataset.fileId);
                });
                return cardIds;
            }

            // Delete selected files
            window.deleteSelectedFiles = function () {
                const selectedCardIds = getSelectedCards();

                if (selectedCardIds.length === 0) {
                    alert('No files selected');
                    return;
                }

                const confirmMsg = `Are you sure you want to delete ${selectedCardIds.length} selected file(s)?`;
                if (!confirm(confirmMsg)) {
                    return;
                }

                selectedCardIds.forEach(cardId => {
                    const card = document.getElementById(cardId);
                    if (card) {
                        // Remove from uploadedFilesData array
                        const index = uploadedFilesData.findIndex(f => f.id === cardId);
                        if (index !== -1) {
                            uploadedFilesData.splice(index, 1);
                        }

                        // Remove card from DOM
                        card.remove();
                    }
                });

                // Update UI
                handleCheckboxChange();
                updateAllButtonStates();

                // Show upload section if no files left
                if (uploadedFilesData.length === 0) {
                    const uploadSection = document.querySelector('.file-upload-section');
                    const addMoreBtn = document.getElementById('addMoreFilesButton');
                    if (uploadSection) uploadSection.style.display = 'flex';
                    if (addMoreBtn) addMoreBtn.style.display = 'none';
                }

                alert(`${selectedCardIds.length} file(s) deleted successfully`);
            };

            // Download selected files with embedded metadata
            window.downloadSelectedFiles = async function () {
                const selectedCardIds = getSelectedCards();

                if (selectedCardIds.length === 0) {
                    alert('No files selected');
                    return;
                }

                // Filter to get only files with metadata
                const filesToDownload = uploadedFilesData.filter(f =>
                    selectedCardIds.includes(f.id) &&
                    f.title &&
                    f.title !== "Error" &&
                    (
                        (f.fileObject.type && (f.fileObject.type === 'image/jpeg' || f.fileObject.type === 'image/jpg')) ||
                        (f.fileObject.type && f.fileObject.type === 'image/png') ||
                        (f.name && f.name.toLowerCase().endsWith('.png')) ||
                        (f.fileObject.type && f.fileObject.type === 'image/svg+xml') ||
                        (f.name && f.name.toLowerCase().endsWith('.svg')) ||
                        (f.name && f.name.toLowerCase().endsWith('.eps'))
                    )
                );

                if (filesToDownload.length === 0) {
                    alert('No selected files with metadata to download. Please generate metadata first.');
                    return;
                }

                const downloadBtn = document.querySelector('.bulk-action-btn.download-btn');
                const originalHTML = downloadBtn.innerHTML;
                downloadBtn.disabled = true;
                downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + getTrans('downloading');

                let downloadedCount = 0;

                for (const fileData of filesToDownload) {
                    try {
                        if (
                            (fileData.fileObject.type && (fileData.fileObject.type === 'image/jpeg' || fileData.fileObject.type === 'image/jpg'))
                        ) {
                            await embedAndDownload(fileData);
                        } else if (
                            (fileData.fileObject.type && fileData.fileObject.type === 'image/png') ||
                            (fileData.name && fileData.name.toLowerCase().endsWith('.png'))
                        ) {
                            await embedPngAndDownload(fileData);
                        } else if (
                            (fileData.fileObject.type && fileData.fileObject.type === 'image/svg+xml') ||
                            (fileData.name && fileData.name.toLowerCase().endsWith('.svg'))
                        ) {
                            await embedSvgAndDownload(fileData);

                        } else if (
                            (fileData.name && fileData.name.toLowerCase().endsWith('.eps'))
                        ) {
                            await embedEpsAndDownload(fileData);
                        }

                        downloadedCount++;
                        downloadBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${getTrans('downloading')} ${downloadedCount}/${filesToDownload.length}`;
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (error) {
                        console.error(`Failed to download ${fileData.name}`, error);
                    }
                }

                downloadBtn.disabled = false;
                downloadBtn.innerHTML = originalHTML;
                alert(`${downloadedCount} file(s) downloaded successfully`);
            };

            // Translate selected files
            window.translateSelectedFiles = async function () {
                const selectedCardIds = getSelectedCards();

                if (selectedCardIds.length === 0) {
                    alert('No files selected');
                    return;
                }

                // Filter to get only cards with metadata
                const cardsWithMetadata = selectedCardIds.filter(cardId => {
                    const fileData = uploadedFilesData.find(f => f.id === cardId);
                    return fileData && fileData.title && fileData.title !== "Error";
                });

                if (cardsWithMetadata.length === 0) {
                    alert('No selected files with metadata to translate. Please generate metadata first.');
                    return;
                }

                // Ask user for target language
                const targetLang = prompt(
                    'Select target language:\n' +
                    'es = Spanish, fr = French, de = German, ja = Japanese,\n' +
                    'pt = Portuguese, it = Italian, bn = Bengali, hi = Hindi,\n' +
                    'ar = Arabic, zh = Chinese, ko = Korean\n\n' +
                    'Enter language code:',
                    'es'
                );

                if (!targetLang || targetLang.trim() === '') {
                    return;
                }

                const validLanguages = ['es', 'fr', 'de', 'ja', 'pt', 'it', 'bn', 'hi', 'ar', 'zh', 'ko'];
                if (!validLanguages.includes(targetLang.toLowerCase())) {
                    alert('Invalid language code. Please try again.');
                    return;
                }

                const translateBtn = document.querySelector('.bulk-action-btn.translate-btn');
                const originalHTML = translateBtn.innerHTML;
                translateBtn.disabled = true;
                translateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + getTrans('translating');

                let translatedCount = 0;

                for (const cardId of cardsWithMetadata) {

                    // 🌐 Show translate progress bar
                    showBatchProgress('translate');
                    try {
                        // Use existing translateMetadata function logic
                        const card = document.getElementById(cardId);
                        if (!card) continue;

                        const fileData = uploadedFilesData.find(f => f.id === cardId);
                        if (!fileData) continue;

                        // Translate title
                        if (fileData.title) {
                            const translatedTitle = await translateText(fileData.title, targetLang);
                            fileData.title = translatedTitle;
                            const titleDiv = card.querySelector('.meta-title');
                            if (titleDiv) titleDiv.textContent = translatedTitle;
                        }

                        // Translate description
                        if (fileData.description) {
                            const translatedDesc = await translateText(fileData.description, targetLang);
                            fileData.description = translatedDesc;
                            const descDiv = card.querySelector('.meta-description');
                            if (descDiv) descDiv.textContent = translatedDesc;
                        }

                        // Translate keywords
                        if (fileData.keywords && fileData.keywords.length > 0) {
                            const translatedKeywords = [];
                            for (const keyword of fileData.keywords) {
                                const translatedKeyword = await translateText(keyword, targetLang);
                                translatedKeywords.push(translatedKeyword);
                            }
                            fileData.keywords = translatedKeywords.join(', ');

                            // Update keywords display
                            updateKeywordsDisplay(cardId);
                        }

                        translatedCount++;
                        translateBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Translating... ${translatedCount}/${cardsWithMetadata.length}`;
                        updateBatchProgress(translatedCount, cardsWithMetadata.length, fileData ? fileData.name : cardId, 'translate');
                        await new Promise(resolve => setTimeout(resolve, 800)); // Delay to avoid API rate limits
                    } catch (error) {
                        console.error(`Failed to translate card ${cardId}`, error);
                    }
                }

                translateBtn.disabled = false;
                translateBtn.innerHTML = originalHTML;
                hideBatchProgress(true);
                alert(`${translatedCount} file(s) translated successfully to ${targetLang.toUpperCase()}`);
            };

            // Update closeCard function to handle checkbox state
            window.closeCard = function (button) {
                const card = button.closest('.file-preview-card');
                if (!card) return;

                const cardId = card.id;

                // Remove from uploadedFilesData
                const index = uploadedFilesData.findIndex(f => f.id === cardId);
                if (index !== -1) {
                    uploadedFilesData.splice(index, 1);
                }

                // Remove card from DOM
                card.remove();

                // Update bulk action bar if it was checked
                handleCheckboxChange();

                // Update button states
                updateAllButtonStates();

                // Show upload section if no files left
                if (uploadedFilesData.length === 0) {
                    const uploadSection = document.querySelector('.file-upload-section');
                    const addMoreBtn = document.getElementById('addMoreFilesButton');
                    if (uploadSection) uploadSection.style.display = 'flex';
                    if (addMoreBtn) addMoreBtn.style.display = 'none';
                }
            };

            // Generate Metadata ONLY for Selected Files
            window.generateMetadataForSelected = async function () {
                const selectedCardIds = getSelectedCards();

                if (selectedCardIds.length === 0) {
                    alert('No files selected');
                    return;
                }

                // Filter files based on selection from the global uploadedFilesData
                const filesToProcess = uploadedFilesData.filter(f => selectedCardIds.includes(f.id));

                if (filesToProcess.length === 0) {
                    alert("Selected files not found in data.");
                    return;
                }

                // AI processes directly through Supabase Edge Functions. No client-side keys needed.

                // UI Feedback on the button
                const btn = document.querySelector('.bulk-action-btn.process-btn');
                const originalContent = btn.innerHTML;
                btn.disabled = true;

                // Reset Pause State
                window.isPaused = false;
                const pauseBtn = document.getElementById('pauseProcessButton');
                if (pauseBtn) {
                    pauseBtn.style.display = 'inline-flex';
                    pauseBtn.innerHTML = '<i class="fas fa-pause"></i> ' + (typeof getTrans === 'function' ? getTrans('pause') : 'Pause');
                    pauseBtn.classList.remove('green-button');
                    pauseBtn.classList.add('orange-button');
                }

                let processedCount = 0;
                let completedCount = 0;
                let errorCount = 0;
                let totalFiles = filesToProcess.length;

                // Loop through selected files
                for (const fileData of filesToProcess) {
                    // Check for pause
                    while (window.isPaused) {
                        await new Promise(r => setTimeout(r, 200));
                    }

                    processedCount++;
                    btn.innerHTML = `<i class="icon-spinner"></i> ${getTrans('processing')} ${processedCount}/${totalFiles}`;
                    updateBatchProgress(processedCount, totalFiles, fileData.name, 'generate');

                    const currentCard = document.getElementById(fileData.id);
                    if (currentCard) currentCard.style.borderColor = "#F97316"; // Active color

                    try {
                        // Generate Metadata
                        const metadata = await generateMetadata(fileData);

                        // Update Data
                        fileData.title = metadata.title;
                        fileData.keywords = metadata.keywords;
                        fileData.description = metadata.description || '';

                        // Update UI specific elements if needed (usually generateMetadata handles internal UI)
                        const epsBtn = document.getElementById(`btn-eps-${fileData.id}`);
                        if (epsBtn) epsBtn.disabled = false;

                        completedCount++;
                        if (currentCard) currentCard.style.borderColor = "#10B981"; // Success color

                    } catch (error) {
                        console.error("Error processing file:", fileData.name, error);
                        fileData.title = "Error"; // Mark as error so it can be retried later
                        errorCount++;
                        if (currentCard) {
                            currentCard.style.borderColor = "#EF4444"; // Error color
                            const metaTitle = currentCard.querySelector('.meta-title');
                            if (metaTitle) metaTitle.textContent = "Failed: " + error.message;
                        }
                    }

                    // Delay for API Rate Limits on backend
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }

                // Finish Process
                btn.innerHTML = `<i class="fas fa-check"></i> ${getTrans('done')} (${completedCount}/${totalFiles})`;
                hideBatchProgress(errorCount === 0);

                // Hide pause button
                if (pauseBtn) pauseBtn.style.display = 'none';

                // Notification
                if (Notification.permission === "granted") {
                    new Notification("Selected Batch Complete! ✅", {
                        body: `Success: ${completedCount}, Failed: ${errorCount}`,
                        icon: "https://cdn-icons-png.flaticon.com/512/148/148767.png"
                    });
                } else {
                    // Small delay to let user see the button text
                    setTimeout(() => {
                        alert(`Batch Generation Complete!\nSuccess: ${completedCount}\nFailed: ${errorCount}`);
                    }, 500);
                }

                if (completedCount > 0 && !localStorage.getItem('feedbackSubmitted')) {
                    setTimeout(() => {
                        const feedbackModal = document.getElementById('feedbackModal');
                        if (feedbackModal) {
                            feedbackModal.style.display = 'flex';
                        }
                    }, 3000);
                }

                // Reset Button after 2 seconds
                setTimeout(() => {
                    btn.disabled = false;
                    btn.innerHTML = originalContent;
                }, 2000);
            };

            // ===== TRANSLATION FEATURE =====

            // Translation using free MyMemory API (no API key required)
            async function translateText(text, targetLang) {
                if (!text || text.trim() === '') return text;

                try {
                    const encodedText = encodeURIComponent(text);
                    const url = `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=en|${targetLang}`;

                    const response = await fetch(url);
                    const data = await response.json();

                    if (data.responseStatus === 200 && data.responseData) {
                        return data.responseData.translatedText;
                    } else {
                        throw new Error('Translation failed');
                    }
                } catch (error) {
                    console.error('Translation error:', error);
                    return text; // Return original text if translation fails
                }
            }

            // Batch translate all processed files
            const batchTranslateButton = document.getElementById('batchTranslateButton');
            if (batchTranslateButton) {
                batchTranslateButton.onclick = async function () {
                    const targetLang = document.getElementById('translationLanguageSelect').value;

                    if (targetLang === 'none') {
                        alert('Please select a target language from the sidebar first.');
                        return;
                    }

                    // Filter files that have metadata but not yet translated
                    const filesToTranslate = uploadedFilesData.filter(f => f.title && f.title !== "Error");

                    if (filesToTranslate.length === 0) {
                        alert('No files with metadata to translate. Please generate metadata first.');
                        return;
                    }

                    this.disabled = true;
                    let processedCount = 0;
                    let successCount = 0;
                    let errorCount = 0;

                    for (const fileData of filesToTranslate) {
                        processedCount++;

                        // Update button text with progress
                        this.innerHTML = `<i class="fas fa-language"></i> Translating ${processedCount}/${filesToTranslate.length}...`;

                        try {
                            // Translate title
                            if (fileData.title) {
                                fileData.translatedTitle = await translateText(fileData.title, targetLang);
                            }

                            // Translate description
                            if (fileData.description) {
                                fileData.translatedDescription = await translateText(fileData.description, targetLang);
                            }

                            // Translate keywords (split, translate each, rejoin)
                            if (fileData.keywords) {
                                const keywordsArray = fileData.keywords.split(',').map(k => k.trim());
                                const translatedKeywordsArray = [];

                                for (const keyword of keywordsArray) {
                                    const translated = await translateText(keyword, targetLang);
                                    translatedKeywordsArray.push(translated);
                                    // Small delay to avoid rate limiting
                                    await new Promise(resolve => setTimeout(resolve, 300));
                                }

                                fileData.translatedKeywords = translatedKeywordsArray.join(', ');
                            }

                            fileData.targetLanguage = targetLang;
                            successCount++;

                            // Update the metadata card to show translated content
                            updateMetadataCardWithTranslation(fileData);

                            // 📊 Log activity and update usage
                            logActivity('Batch Translate', {
                                fileName: fileData.name,
                                targetLang: targetLang
                            });

                        } catch (error) {
                            console.error(`Translation failed for ${fileData.name}:`, error);
                            errorCount++;
                        }

                        // Delay between files to respect API rate limits
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }

                    // Reset button
                    this.disabled = false;
                    this.innerHTML = '<i class="fas fa-language"></i> ' + getTrans('batch_translate');

                    // Show completion message
                    alert(`Translation Complete!\nSuccess: ${successCount}\nFailed: ${errorCount}`);
                };
            }

            // Function to update metadata card with translated content
            function updateMetadataCardWithTranslation(fileData) {
                const card = document.getElementById(fileData.id);
                if (!card) return;

                const metaTitle = card.querySelector('.meta-title');
                const metaDescription = card.querySelector('.meta-description');
                const metaKeywords = card.querySelector('.meta-keywords');

                // Add toggle button if not already present
                let toggleBtn = card.querySelector('.translation-toggle-btn');
                if (!toggleBtn && fileData.translatedTitle) {
                    toggleBtn = document.createElement('button');
                    toggleBtn.className = 'translation-toggle-btn';
                    toggleBtn.innerHTML = '<i class="fas fa-exchange-alt"></i> ' + getTrans('view_translated');
                    toggleBtn.style.cssText = 'margin: 10px 0; padding: 5px 10px; background: linear-gradient(90deg, #8B5CF6 60%, #6D28D9 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85em;';

                    let showingTranslation = false;

                    toggleBtn.onclick = function () {
                        showingTranslation = !showingTranslation;

                        if (showingTranslation) {
                            // Show translated version
                            if (metaTitle) metaTitle.textContent = fileData.translatedTitle || fileData.title;
                            if (metaDescription) metaDescription.textContent = fileData.translatedDescription || fileData.description;
                            if (metaKeywords) metaKeywords.textContent = fileData.translatedKeywords || fileData.keywords;
                            this.innerHTML = '<i class="fas fa-exchange-alt"></i> ' + getTrans('view_original');
                        } else {
                            // Show original version
                            if (metaTitle) metaTitle.textContent = fileData.title;
                            if (metaDescription) metaDescription.textContent = fileData.description;
                            if (metaKeywords) metaKeywords.textContent = fileData.keywords;
                            this.innerHTML = '<i class="fas fa-exchange-alt"></i> ' + getTrans('view_translated');
                        }
                    };

                    // Insert toggle button after title
                    if (metaTitle && metaTitle.parentNode) {
                        metaTitle.parentNode.insertBefore(toggleBtn, metaTitle.nextSibling);
                    }
                }
            }

            // ===== BATCH PROGRESS BAR HELPERS =====
            let _bpStartTime = 0;

            const _bpStages = {
                generate: { icon: '⚙️', label: 'Generating Metadata' },
                translate: { icon: '🌐', label: 'Translating Files' },
                prompt: { icon: '✨', label: 'Processing Prompts' }
            };

            function showBatchProgress(stage) {
                const overlay = document.getElementById('batchProgressOverlay');
                const fill = document.getElementById('bpFill');
                if (!overlay) return;
                const s = _bpStages[stage] || _bpStages.generate;
                document.getElementById('bpStageIcon').textContent = s.icon;
                document.getElementById('bpStageLabel').textContent = s.label;
                document.getElementById('bpChip').textContent = '0 / 0';
                document.getElementById('bpChip').className = 'bp-chip';
                document.getElementById('bpPct').textContent = '0%';
                document.getElementById('bpPct').className = 'bp-pct';
                document.getElementById('bpEta').textContent = '';
                document.getElementById('bpFilename').innerHTML = '⏳ Initializing...';
                if (fill) { fill.style.width = '0%'; fill.className = 'batch-progress-fill running'; }
                overlay.style.display = 'block';
                // Smooth scroll to it
                overlay.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                _bpStartTime = Date.now();
            }

            function updateBatchProgress(current, total, filename, stage) {
                const overlay = document.getElementById('batchProgressOverlay');
                const fill = document.getElementById('bpFill');
                if (!overlay || overlay.style.display === 'none') return;

                const pct = total > 0 ? Math.round((current / total) * 100) : 0;

                // Fill bar
                if (fill) fill.style.width = pct + '%';

                // Chip
                const chip = document.getElementById('bpChip');
                if (chip) chip.textContent = `${current} / ${total} files`;

                // Percentage
                const pctEl = document.getElementById('bpPct');
                if (pctEl) pctEl.textContent = pct + '%';

                // ETA
                const etaEl = document.getElementById('bpEta');
                if (etaEl && current > 0) {
                    const elapsed = (Date.now() - _bpStartTime) / 1000;
                    const perFile = elapsed / current;
                    const remaining = Math.round(perFile * (total - current));
                    if (remaining > 0) {
                        etaEl.textContent = remaining < 60
                            ? `~${remaining}s remaining`
                            : `~${Math.ceil(remaining / 60)}m remaining`;
                    } else {
                        etaEl.textContent = 'Almost done...';
                    }
                }

                // Filename
                const fnEl = document.getElementById('bpFilename');
                if (fnEl && filename) {
                    const s = _bpStages[stage] || _bpStages.generate;
                    fnEl.innerHTML = `${s.icon} Processing: <strong>${filename}</strong>`;
                }
            }

            function hideBatchProgress(success) {
                const overlay = document.getElementById('batchProgressOverlay');
                const fill = document.getElementById('bpFill');
                if (!overlay) return;

                // Final state
                if (fill) { fill.style.width = '100%'; fill.className = 'batch-progress-fill done'; }
                const chip = document.getElementById('bpChip');
                if (chip) chip.className = 'bp-chip done';
                const pctEl = document.getElementById('bpPct');
                if (pctEl) { pctEl.textContent = '100%'; pctEl.className = 'bp-pct done'; }
                const etaEl = document.getElementById('bpEta');
                if (etaEl) etaEl.textContent = '';
                const fnEl = document.getElementById('bpFilename');
                if (fnEl) fnEl.innerHTML = success !== false
                    ? '✅ All done! Results are ready below.'
                    : '⚠️ Finished with some errors. Check cards above.';

                // Auto-hide after 3.5s
                setTimeout(() => {
                    overlay.style.opacity = '0';
                    setTimeout(() => {
                        overlay.style.display = 'none';
                        overlay.style.opacity = '';
                    }, 420);
                }, 3500);
            }
            // ===== END BATCH PROGRESS BAR HELPERS =====

            if (processAllButton) {
                // Global Pause State
                window.isPaused = false;
                window.togglePause = function () {
                    window.isPaused = !window.isPaused;
                    const btn = document.getElementById('pauseProcessButton');
                    if (btn) {
                        if (window.isPaused) {
                            btn.innerHTML = '<i class="fas fa-play"></i> ' + getTrans('resume');
                            btn.classList.add('green-button');
                            btn.classList.remove('orange-button');
                        } else {
                            btn.innerHTML = '<i class="fas fa-pause"></i> ' + getTrans('pause');
                            btn.classList.remove('green-button');
                            btn.classList.add('orange-button');
                        }
                    }
                };

                async function processSelectedFiles() {
                    // 🟠 IMMEDIATE UI FEEDBACK
                    processAllButton.disabled = true;
                    processAllButton.innerHTML = '<i class="icon-spinner"></i> ' + (typeof getTrans === 'function' ? getTrans('processing') : 'Processing...');
                    showBatchProgress('generate');

                    // 🔔 Request Notification Permission
                    if (Notification.permission !== "granted") {
                        Notification.requestPermission();
                    }

                    const selectedProvider = document.getElementById('aiProviderSelect')?.value || 'groq';
                    const user = auth.currentUser;

                    // Filter files to process
                    const filesToProcess = uploadedFilesData.filter(f => !f.title || f.title === "");

                    if (filesToProcess.length === 0) {
                        alert("All files have already been processed.");
                        processAllButton.disabled = false;
                        processAllButton.innerHTML = '<i class="icon-process"></i> ' + (typeof getTrans === 'function' ? getTrans('process_selected') : 'Process Selected');
                        hideBatchProgress();
                        return;
                    }

                    // Check plan and usage
                    let usage = { count: 0, limit: 10 };
                    let isProPremium = false;

                    if (user) {
                        try {
                            const [profileDoc, usageData] = await Promise.all([
                                db.collection('users').doc(user.email).get(),
                                getMetadataUsage(user.email)
                            ]);

                            const profileData = profileDoc.exists ? profileDoc.data() : null;
                            const dbPlan = (profileData?.plan || '').toLowerCase();
                            isProPremium = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
                            usage = usageData;
                        } catch (e) {
                            console.warn('Initial data check failed', e);
                        }
                    } else {
                        try {
                            usage = await getMetadataUsage("unknown");
                        } catch (e) {
                            console.warn('Anonymous usage check failed', e);
                        }
                    }

                    // 🛑 LIMIT CHECK
                    if (usage.count + filesToProcess.length > usage.limit) {
                        const remaining = usage.limit - usage.count;
                        if (!user) {
                            if (remaining <= 0) {
                                showLimitModal(`Your lifetime login-free free trial has expired (3/3 images processed). Please sign in to continue & get 10 more free credits!`);
                            } else {
                                showLimitModal(`You have only <strong>${remaining}</strong> login-free trial image(s) left for this device. You selected <strong>${filesToProcess.length}</strong> images. Please reduce the number or sign in to get 10 more free credits.`);
                            }
                        } else {
                            if (remaining <= 0) {
                                showLimitModal(`Your daily limit has been reached. Please try again tomorrow or upgrade.`);
                            } else {
                                showLimitModal(`You have only <strong>${remaining}</strong> images left for today. You selected <strong>${filesToProcess.length}</strong> images. Please reduce the number or upgrade to Pro.`);
                            }
                        }
                        processAllButton.disabled = false;
                        processAllButton.innerHTML = '<i class="icon-process"></i> ' + (typeof getTrans === 'function' ? getTrans('process_selected') : 'Process Selected');
                        hideBatchProgress();
                        return;
                    }

                    // Reset pause state and show button
                    window.isPaused = false;
                    const pauseBtn = document.getElementById('pauseProcessButton');
                    if (pauseBtn) {
                        pauseBtn.style.display = 'inline-flex';
                        pauseBtn.innerHTML = '<i class="fas fa-pause"></i> ' + (typeof getTrans === 'function' ? getTrans('pause') : 'Pause');
                        pauseBtn.classList.remove('green-button');
                        pauseBtn.classList.add('orange-button');
                    }

                    let totalFiles = filesToProcess.length;
                    let processedCount = 0;
                    let completedCount = 0;
                    let errorCount = 0;

                    // 🚀 SUPER FAST CONCURRENCY LOGIC (Dynamic Speed)
                    // Mistral স্লো তাই একসাথে ১টি, বাকিগুলোর ক্ষেত্রে Pro হলে ৪টি, Free হলে ২টি
                    let concurrencyLimit = 2; // Default for Free
                    if (isProPremium) {
                        concurrencyLimit = (selectedProvider === 'mistral') ? 1 : 4;
                    } else {
                        concurrencyLimit = (selectedProvider === 'mistral') ? 1 : 2;
                    }

                    // Chunking / Batching Array
                    for (let i = 0; i < filesToProcess.length; i += concurrencyLimit) {
                        // Pause Check
                        while (window.isPaused) {
                            await new Promise(r => setTimeout(r, 200));
                        }

                        // Create a chunk of files
                        const chunk = filesToProcess.slice(i, i + concurrencyLimit);

                        // Process the chunk concurrently using Promise.all
                        const chunkPromises = chunk.map(async (fileData) => {
                            const currentCard = document.getElementById(fileData.id);
                            if (currentCard) currentCard.style.borderColor = "#F97316";

                            try {
                                // Live Usage Check
                                const latestUsage = await getMetadataUsage(authUser?.email || "unknown");
                                if (latestUsage.count >= latestUsage.limit) {
                                    throw new Error("Daily limit reached");
                                }

                                // 🧠 Call AI (Concurrent)
                                const metadata = await generateMetadata(fileData);

                                // Save Data
                                fileData.title = metadata.title;
                                fileData.keywords = metadata.keywords;
                                fileData.description = metadata.description || '';

                                const epsBtn = document.getElementById(`btn-eps-${fileData.id}`);
                                if (epsBtn) epsBtn.disabled = false;

                                completedCount++;
                                if (currentCard) currentCard.style.borderColor = "#10B981"; // Success Green

                            } catch (error) {
                                console.error("Error processing file:", fileData.name, error);
                                fileData.title = "Error";
                                errorCount++;
                                if (currentCard) {
                                    currentCard.style.borderColor = "#EF4444";
                                    const metaTitle = currentCard.querySelector('.meta-title');
                                    if (metaTitle) metaTitle.textContent = "Failed: " + error.message;
                                }
                            } finally {
                                processedCount++;
                                // Update UI per file completion
                                const overallCompleted = uploadedFilesData.filter(f => f.title && f.title !== "Error" && f.title !== "").length;
                                const overallErrors = uploadedFilesData.filter(f => f.title === "Error").length;
                                updateProcessButtonText(processedCount, totalFiles, overallCompleted, overallErrors);
                                updateBatchProgress(processedCount, totalFiles, fileData.name, 'generate');
                            }
                        });

                        // Wait for all 2-4 images in this chunk to finish
                        await Promise.all(chunkPromises);

                        // ⏱️ Delay between chunks to avoid 429 API Rate Limit
                        let delayTime = isProPremium ? 800 : 2500;
                        if (selectedProvider === 'mistral') delayTime = 4000;
                        await new Promise(resolve => setTimeout(resolve, delayTime));
                    }

                    // 🏁 Finish Process
                    const finalCompleted = uploadedFilesData.filter(f => f.title && f.title !== "Error" && f.title !== "").length;
                    const finalErrors = uploadedFilesData.filter(f => f.title === "Error").length;

                    // 🔥 Record daily streak activity
                    if (finalCompleted > 0 && typeof window.recordStreakActivity === 'function') {
                        window.recordStreakActivity();
                    }

                    updateProcessButtonText(processedCount, totalFiles, finalCompleted, finalErrors, true);
                    hideBatchProgress(finalErrors === 0);

                    setTimeout(() => {
                        processAllButton.disabled = false;
                        if (pauseBtn) pauseBtn.style.display = 'none';
                    }, 1000);

                    // 🔔 Completion Notification
                    if (Notification.permission === "granted") {
                        new Notification("Metadata Generation Complete! ✅", {
                            body: `Successful: ${finalCompleted}\nFailed: ${finalErrors}`,
                            icon: "https://cdn-icons-png.flaticon.com/512/148/148767.png"
                        });
                    } else {
                        setTimeout(() => {
                            alert(`Batch Generation Complete!\nSuccess: ${finalCompleted}\nFailed: ${finalErrors}`);
                        }, 500);
                    }

                    // Trigger Feedback Modal
                    if (finalCompleted > 0 && !localStorage.getItem('feedbackSubmitted')) {
                        setTimeout(() => {
                            const feedbackModal = document.getElementById('feedbackModal');
                            if (feedbackModal) feedbackModal.style.display = 'flex';
                        }, 2500);
                    }
                }


                processAllButton.onclick = async function () {
                    if (this.disabled) return;

                    try {
                        await processSelectedFiles();
                    } catch (err) {
                        console.error('Processing failed:', err);
                    }
                };
            }

            if (processAllPromptsButton) {
                processAllPromptsButton.onclick = async function () {
                    // 🟠 IMMEDIATE UI FEEDBACK
                    this.disabled = true;
                    const originalContent = this.innerHTML;
                    this.innerHTML = '<i class="icon-spinner"></i> ' + (typeof getTrans === 'function' ? getTrans('processing') : 'Processing...');

                    // --- Check User Plan via profiles table ---
                    const user = auth.currentUser;
                    const planUser2 = user;

                    let isProPremium2 = false;
                    if (planUser2) {
                        try {
                            const profileDoc2 = await db.collection('users').doc(planUser2.email).get();
                            const profileData2 = profileDoc2.exists ? profileDoc2.data() : null;
                            const dbPlan2 = (profileData2?.plan || '').toLowerCase();
                            isProPremium2 = (dbPlan2 === 'pro' || dbPlan2 === 'premium' || dbPlan2 === 'agency');
                        } catch (e) { console.warn('Plan check failed', e); }
                    }

                    const filesToProcess = uploadedFilesData.filter(f => !f.prompt);
                    if (filesToProcess.length === 0) {
                        alert("All file prompts have already been generated.");
                        this.disabled = false;
                        this.innerHTML = originalContent;
                        return;
                    }

                    let totalFiles = filesToProcess.length, processedCount = 0, completedCount = 0, errorCount = 0;

                    for (const fileData of filesToProcess) {
                        processedCount++;
                        updatePromptButtonState(processedCount, totalFiles, completedCount, errorCount);
                        const card = document.getElementById(fileData.id);
                        const promptSection = card.querySelector('.prompt-section');
                        const spinner = promptSection.querySelector('.prompt-spinner');
                        const resultContainer = promptSection.querySelector('.prompt-result-container');
                        const realDiv = card.querySelector(`#prompt-realistic-${fileData.id}`);
                        const illDiv = card.querySelector(`#prompt-illustration-${fileData.id}`);
                        const tdDiv = card.querySelector(`#prompt-3d-${fileData.id}`);

                        card.classList.add('prompt-generated');
                        resultContainer.style.display = 'none';
                        spinner.style.display = 'block';
                        /* logActivity is now handled server-side */
                        try {
                            const promptResult = await generatePromptForImage(fileData.fileObject);
                            fileData.prompt = promptResult;

                            // Attempt to parse JSON response for three styles
                            let promptObj = null;
                            try {
                                const cleanedJson = promptResult.replace(/^```json\s*|\s*```$/gi, '').trim();
                                promptObj = JSON.parse(cleanedJson);
                            } catch (e) {
                                console.warn("Failed to parse prompt response as JSON. Falling back to single prompt.", e);
                            }

                            if (promptObj && promptObj.realistic && promptObj.illustration && promptObj["3d"]) {
                                realDiv.textContent = promptObj.realistic;
                                illDiv.textContent = promptObj.illustration;
                                tdDiv.textContent = promptObj["3d"];
                                realDiv.style.color = '';
                                illDiv.style.color = '';
                                tdDiv.style.color = '';
                            } else {
                                // Fallback: put raw text in Realistic, and styled variations in the others
                                realDiv.textContent = promptResult;
                                illDiv.textContent = `${promptResult} (Illustration style)`;
                                tdDiv.textContent = `${promptResult} (3D style)`;
                                realDiv.style.color = '';
                                illDiv.style.color = '';
                                tdDiv.style.color = '';
                            }

                            resultContainer.style.display = 'block';
                            completedCount++;
                        } catch (error) {
                            fileData.prompt = `Error: ${error.message}`;
                            if (realDiv) {
                                realDiv.textContent = `Error: ${error.message}`;
                                realDiv.style.color = '#EF4444';
                            }
                            if (illDiv) {
                                illDiv.textContent = `Error: ${error.message}`;
                                illDiv.style.color = '#EF4444';
                            }
                            if (tdDiv) {
                                tdDiv.textContent = `Error: ${error.message}`;
                                tdDiv.style.color = '#EF4444';
                            }
                            resultContainer.style.display = 'block';
                            errorCount++;
                        } finally {
                            spinner.style.display = 'none';
                            const overallCompleted = uploadedFilesData.filter(f => f.prompt && !f.prompt.startsWith("Error")).length;
                            const overallErrors = uploadedFilesData.filter(f => f.prompt && f.prompt.startsWith("Error")).length;
                            updatePromptButtonState(processedCount, totalFiles, overallCompleted, overallErrors);
                            await new Promise(resolve => setTimeout(resolve, 1100));
                        }
                    }
                    const finalCompleted = uploadedFilesData.filter(f => f.prompt && !f.prompt.startsWith("Error")).length;
                    const finalErrors = uploadedFilesData.filter(f => f.prompt && f.prompt.startsWith("Error")).length;
                    updatePromptButtonState(processedCount, totalFiles, finalCompleted, finalErrors, true);
                    this.disabled = false;
                };
            }

            if (embedMetadataButton) {
                embedMetadataButton.onclick = async function () {
                    const plan = (window.userUsageData?.plan || 'free').toLowerCase();
                    const trialOk = window.trialPowerPack && window.trialPowerPack.active && window.trialPowerPack.used < window.trialPowerPack.total;
                    if (plan === 'free' && !trialOk) {
                        alert("Upgrade to PRO/PREMIUM plan. Embed Metadata features are for pro & premium users only.");
                        if (typeof scrollToPricing === 'function') scrollToPricing();
                        return;
                    }
                    const filesToEmbed = uploadedFilesData.filter(f =>
                        f.title && f.title !== "Error" &&
                        (
                            (f.fileObject.type && (f.fileObject.type === 'image/jpeg' || f.fileObject.type === 'image/jpg')) ||
                            (f.fileObject.type && f.fileObject.type === 'image/png') ||
                            (f.name && f.name.toLowerCase().endsWith('.png')) ||
                            (f.fileObject.type && f.fileObject.type === 'image/svg+xml') ||
                            (f.name && f.name.toLowerCase().endsWith('.svg')) ||
                            (f.name && f.name.toLowerCase().endsWith('.eps'))
                        )
                    );

                    if (filesToEmbed.length === 0) {
                        alert("No processed JPEG, PNG, SVG, or EPS files with metadata to embed.");
                        return;
                    }

                    this.disabled = true;
                    this.innerHTML = '<i class="icon-spinner"></i> Embedding...';
                    let embeddedCount = 0;

                    for (const fileData of filesToEmbed) {
                        try {
                            if (
                                (fileData.fileObject.type && (fileData.fileObject.type === 'image/jpeg' || fileData.fileObject.type === 'image/jpg'))
                            ) {
                                await embedAndDownload(fileData);
                            } else if (
                                (fileData.fileObject.type && fileData.fileObject.type === 'image/png') ||
                                (fileData.name && fileData.name.toLowerCase().endsWith('.png'))
                            ) {
                                await embedPngAndDownload(fileData);
                            }
                            else if (
                                (fileData.fileObject.type && fileData.fileObject.type === 'image/svg+xml') ||
                                (fileData.name && fileData.name.toLowerCase().endsWith('.svg'))
                            ) {
                                await embedSvgAndDownload(fileData);
                            } else if (
                                (fileData.name && fileData.name.toLowerCase().endsWith('.eps'))
                            ) {
                                await embedEpsAndDownload(fileData);
                            }
                            else {
                                console.log(`Skipping embedding for unsupported file: ${fileData.name}`);
                                continue;
                            }

                            embeddedCount++;
                            this.innerHTML = `<i class="icon-spinner"></i> Embedding... ${embeddedCount}/${filesToEmbed.length}`;
                            await new Promise(resolve => setTimeout(resolve, 500));
                        } catch (error) {
                            console.error(`Failed to embed metadata for ${fileData.name}`, error);
                        }
                    }

                    this.innerHTML = `<i class="icon-check"></i> Embedding Complete`;
                    setTimeout(() => {
                        this.disabled = false;
                        this.innerHTML = '<i class="icon-embed"></i> ' + getTrans('embed_metadata');
                        alert(`${embeddedCount} file(s) have been downloaded with embedded metadata.`);
                    }, 2000);
                }
                    ;
            }



            // Helper to sanitize string to ASCII (remove non-ASCII characters)
            function toAscii(str) {
                // Remove any character with code > 127
                return (str || "").replace(/[^\x00-\x7F]/g, "");
            }

            // Helper function to get the correct metadata (translated or original)
            function getMetadataForExport(fileData) {
                return {
                    title: fileData.translatedTitle || fileData.title,
                    description: fileData.translatedDescription || fileData.description,
                    keywords: fileData.translatedKeywords || fileData.keywords,
                    // Keep original title as fallback for ASCII fields if needed
                    originalTitle: fileData.title
                };
            }

            function concatArrays(arrays) {
                let totalLength = 0;
                for (const arr of arrays) {
                    totalLength += arr.length;
                }
                const result = new Uint8Array(totalLength);
                let offset = 0;
                for (const arr of arrays) {
                    result.set(arr, offset);
                    offset += arr.length;
                }
                return result;
            }

            function pngCrc32(data) {
                const table = new Uint32Array(256);
                for (let i = 0; i < 256; i++) {
                    let c = i;
                    for (let k = 0; k < 8; k++) {
                        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
                    }
                    table[i] = c;
                }
                let crc = -1;
                for (let i = 0; i < data.length; i++) {
                    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
                }
                return (crc ^ -1) >>> 0;
            }

            function createTextChunk(keyword, text) {
                const keywordBytes = new TextEncoder().encode(keyword);
                // tEXt chunks must be Latin-1. Since TextEncoder produces UTF-8,
                // we sanitize input to ASCII to avoid multi-byte characters breaking parsers.
                // Full unicode is handled by XMP/iTXt.
                const safeText = toAscii(text);
                const textBytes = new TextEncoder().encode(safeText);
                const chunkType = new Uint8Array([116, 69, 88, 116]); // "tEXt"

                const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
                data.set(keywordBytes, 0);
                data.set([0], keywordBytes.length);
                data.set(textBytes, keywordBytes.length + 1);

                const lengthBytes = new Uint8Array(4);
                new DataView(lengthBytes.buffer).setUint32(0, data.length, false);

                const typeAndData = concatArrays([chunkType, data]);
                const crc = pngCrc32(typeAndData);
                const crcBytes = new Uint8Array(4);
                new DataView(crcBytes.buffer).setUint32(0, crc, false);

                return concatArrays([lengthBytes, typeAndData, crcBytes]);
            }

            function findIendChunkOffset(uint8Array) {
                let offset = 8;
                const dataView = new DataView(uint8Array.buffer);

                while (offset < uint8Array.length) {
                    if (offset + 8 > uint8Array.length) {
                        console.error(`Malformed chunk found at offset ${offset}. Not enough data.`);
                        return -1;
                    }

                    const chunkLength = dataView.getUint32(offset, false);

                    // Safety check for unreasonable chunk length
                    if (chunkLength > uint8Array.length) {
                        console.error(`Invalid chunk length ${chunkLength} at offset ${offset}`);
                        return -1;
                    }

                    const chunkTypeBytes = uint8Array.subarray(offset + 4, offset + 8);
                    const chunkType = new TextDecoder().decode(chunkTypeBytes);

                    if (chunkType === 'IEND') {
                        return offset;
                    }

                    const nextOffset = offset + 12 + chunkLength;

                    if (nextOffset > uint8Array.length) {
                        return -1;
                    }

                    offset = nextOffset;
                }
                return -1;
            }

            function createXmpChunk(title, description, keywords) {
                const xmpString = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">
      <dc:title>${title || ""}</dc:title>
      <dc:description>${description || ""}</dc:description>
      <dc:subject>
        ${keywords.split(',').map(k => k.trim()).filter(Boolean).map(k => `<rdf:li>${k}</rdf:li>`).join('\n        ')}
      </dc:subject>
      <xmp:Title>${title || ""}</xmp:Title>
      <xmp:Description>${description || ""}</xmp:Description>
      <photoshop:Headline>${title || ""}</photoshop:Headline>
      <photoshop:Description>${description || ""}</photoshop:Description>
      <photoshop:Keywords>
        ${keywords.split(',').map(k => k.trim()).filter(Boolean).map(k => `<rdf:li>${k}</rdf:li>`).join('\n        ')}
      </photoshop:Keywords>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

                const keyword = "XML:com.adobe.xmp";
                const keywordBytes = new TextEncoder().encode(keyword);
                const nullSeparator = new Uint8Array([0]);
                const compressionFlag = new Uint8Array([0]);
                const compressionMethod = new Uint8Array([0]);
                const langTag = new Uint8Array([]);
                const translatedKeyword = new Uint8Array([]);
                const xmpBytes = new TextEncoder().encode(xmpString);

                const data = concatArrays([
                    keywordBytes, nullSeparator, compressionFlag, compressionMethod, nullSeparator, nullSeparator, xmpBytes
                ]);
                const chunkType = new Uint8Array([105, 84, 88, 116]); // "iTXt"
                const lengthBytes = new Uint8Array(4);
                new DataView(lengthBytes.buffer).setUint32(0, data.length, false);
                const typeAndData = concatArrays([chunkType, data]);
                const crc = pngCrc32(typeAndData);
                const crcBytes = new Uint8Array(4);
                new DataView(crcBytes.buffer).setUint32(0, crc, false);
                return concatArrays([lengthBytes, typeAndData, crcBytes]);
            }

            async function embedPngAndDownload(fileData) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const arrayBuffer = e.target.result;
                        const metadata = getMetadataForExport(fileData);

                        const workerCode = `
                            // Helper to sanitize string to ASCII
                            function toAscii(str) {
                                return (str || "").replace(/[^\\x00-\\x7F]/g, "");
                            }

                            function concatArrays(arrays) {
                                let totalLength = 0;
                                for (const arr of arrays) {
                                    totalLength += arr.length;
                                }
                                const result = new Uint8Array(totalLength);
                                let offset = 0;
                                for (const arr of arrays) {
                                    result.set(arr, offset);
                                    offset += arr.length;
                                }
                                return result;
                            }

                            function pngCrc32(data) {
                                const table = new Uint32Array(256);
                                for (let i = 0; i < 256; i++) {
                                    let c = i;
                                    for (let k = 0; k < 8; k++) {
                                        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
                                    }
                                    table[i] = c;
                                }
                                let crc = -1;
                                for (let i = 0; i < data.length; i++) {
                                    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
                                }
                                return (crc ^ -1) >>> 0;
                            }

                            function createTextChunk(keyword, text) {
                                const keywordBytes = new TextEncoder().encode(keyword);
                                const safeText = toAscii(text);
                                const textBytes = new TextEncoder().encode(safeText);
                                const chunkType = new Uint8Array([116, 69, 88, 116]); // "tEXt"

                                const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
                                data.set(keywordBytes, 0);
                                data.set([0], keywordBytes.length);
                                data.set(textBytes, keywordBytes.length + 1);

                                const lengthBytes = new Uint8Array(4);
                                new DataView(lengthBytes.buffer).setUint32(0, data.length, false);

                                const typeAndData = concatArrays([chunkType, data]);
                                const crc = pngCrc32(typeAndData);
                                const crcBytes = new Uint8Array(4);
                                new DataView(crcBytes.buffer).setUint32(0, crc, false);

                                return concatArrays([lengthBytes, typeAndData, crcBytes]);
                            }

                            function findIendChunkOffset(uint8Array) {
                                let offset = 8;
                                const dataView = new DataView(uint8Array.buffer);

                                while (offset < uint8Array.length) {
                                    if (offset + 8 > uint8Array.length) {
                                        return -1;
                                    }

                                    const chunkLength = dataView.getUint32(offset, false);

                                    if (chunkLength > uint8Array.length) {
                                        return -1;
                                    }

                                    const chunkTypeBytes = uint8Array.subarray(offset + 4, offset + 8);
                                    const chunkType = new TextDecoder().decode(chunkTypeBytes);

                                    if (chunkType === 'IEND') {
                                        return offset;
                                    }

                                    const nextOffset = offset + 12 + chunkLength;

                                    if (nextOffset > uint8Array.length) {
                                        return -1;
                                    }

                                    offset = nextOffset;
                                }
                                return -1;
                            }

                            function createXmpChunk(title, description, keywords) {
                                const xmpString = \`<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">
      <dc:title>\${title || ""}</dc:title>
      <dc:description>\${description || ""}</dc:description>
      <dc:subject>
        \${keywords.split(',').map(k => k.trim()).filter(Boolean).map(k => \`<rdf:li>\${k}</rdf:li>\`).join('\\n        ')}
      </dc:subject>
      <xmp:Title>\${title || ""}</xmp:Title>
      <xmp:Description>\${description || ""}</xmp:Description>
      <photoshop:Headline>\${title || ""}</photoshop:Headline>
      <photoshop:Description>\${description || ""}</photoshop:Description>
      <photoshop:Keywords>
        \${keywords.split(',').map(k => k.trim()).filter(Boolean).map(k => \`<rdf:li>\${k}</rdf:li>\`).join('\\n        ')}
      </photoshop:Keywords>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>\`;

                                const keyword = "XML:com.adobe.xmp";
                                const keywordBytes = new TextEncoder().encode(keyword);
                                const nullSeparator = new Uint8Array([0]);
                                const compressionFlag = new Uint8Array([0]);
                                const compressionMethod = new Uint8Array([0]);
                                const langTag = new Uint8Array([]);
                                const translatedKeyword = new Uint8Array([]);
                                const xmpBytes = new TextEncoder().encode(xmpString);

                                const data = concatArrays([
                                    keywordBytes, nullSeparator, compressionFlag, compressionMethod, nullSeparator, nullSeparator, xmpBytes
                                ]);
                                const chunkType = new Uint8Array([105, 84, 88, 116]); // "iTXt"
                                const lengthBytes = new Uint8Array(4);
                                new DataView(lengthBytes.buffer).setUint32(0, data.length, false);
                                const typeAndData = concatArrays([chunkType, data]);
                                const crc = pngCrc32(typeAndData);
                                const crcBytes = new Uint8Array(4);
                                new DataView(crcBytes.buffer).setUint32(0, crc, false);
                                return concatArrays([lengthBytes, typeAndData, crcBytes]);
                            }

                            self.onmessage = function(e) {
                                try {
                                    const { arrayBuffer, metadata } = e.data;
                                    const originalBytes = new Uint8Array(arrayBuffer);
                                    const iendOffset = findIendChunkOffset(originalBytes);
                                    if (iendOffset === -1) {
                                        throw new Error("Could not find IEND chunk. The PNG file might be corrupt.");
                                    }
                                    const contentBeforeIEND = originalBytes.subarray(0, iendOffset);
                                    const iendChunk = originalBytes.subarray(iendOffset);
                                    
                                    const chunksToEmbed = [
                                        createTextChunk("Title", metadata.title || ""),
                                        createTextChunk("Description", metadata.description || ""),
                                        createTextChunk("Keywords", metadata.keywords || ""),
                                        createTextChunk("Author", "MetaGen Pro"),
                                        createTextChunk("Software", "MetaGen Pro v5"),
                                        createTextChunk("Subject", metadata.title || ""),
                                        createTextChunk("Comment", metadata.description || ""),
                                        createTextChunk("Copyright", "MetaGen Pro"),
                                        createTextChunk("Creation Time", new Date().toISOString())
                                    ];
                                    const xmpChunk = createXmpChunk(metadata.title || "", metadata.description || "", metadata.keywords || "");
                                    const newPngBytes = concatArrays([contentBeforeIEND, ...chunksToEmbed, xmpChunk, iendChunk]);
                                    
                                    self.postMessage({ success: true, resultBuffer: newPngBytes.buffer }, [newPngBytes.buffer]);
                                } catch (error) {
                                    self.postMessage({ success: false, error: error.message });
                                }
                            };
                        `;

                        const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
                        const workerUrl = URL.createObjectURL(workerBlob);
                        const worker = new Worker(workerUrl);

                        worker.onmessage = (e) => {
                            if (e.data.success) {
                                const blob = new Blob([e.data.resultBuffer], { type: 'image/png' });
                                const url = URL.createObjectURL(blob);
                                const link = document.createElement("a");
                                link.href = url;
                                link.download = fileData.name.replace(/(\.png)$/i, '_meta$1');
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                                URL.revokeObjectURL(url);
                                worker.terminate();
                                URL.revokeObjectURL(workerUrl);
                                resolve();
                            } else {
                                console.error("A critical error occurred during PNG embedding:", e.data.error);
                                alert(`Could not process ${fileData.name}. The file might be corrupt. Check the console for details.`);
                                worker.terminate();
                                URL.revokeObjectURL(workerUrl);
                                reject(new Error(e.data.error));
                            }
                        };

                        worker.onerror = (err) => {
                            console.error("Worker error:", err);
                            worker.terminate();
                            URL.revokeObjectURL(workerUrl);
                            reject(err);
                        };

                        worker.postMessage({ arrayBuffer, metadata }, [arrayBuffer]);
                    };
                    reader.onerror = (err) => {
                        console.error("FileReader error:", err);
                        reject(err);
                    };
                    reader.readAsArrayBuffer(fileData.fileObject);
                });
            }


            function createXmpBlock(keywordsArr) {
                const xmp = `\n<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\n  <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n    <rdf:Description rdf:about=\"\"\n      xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n      <dc:subject>\n        ${keywordsArr.map(k => `<rdf:li>${k}</rdf:li>`).join('\n')}\n      </dc:subject>\n    </rdf:Description>\n  </rdf:RDF>\n</x:xmpmeta>`;
                return xmp.trim();
            }

            function insertXmpIntoJpeg(dataUrl, xmpString) {
                const encoder = new TextEncoder();
                const xmpPacket = encoder.encode(xmpString);
                const xmpHeader = encoder.encode('http://ns.adobe.com/xap/1.0/\x00');
                const xmpLength = xmpPacket.length + xmpHeader.length + 2;
                const lengthBytes = [(xmpLength >> 8) & 0xFF, xmpLength & 0xFF];
                const xmpSegment = new Uint8Array([0xFF, 0xE1, ...lengthBytes, ...xmpHeader, ...xmpPacket]);
                const binary = atob(dataUrl.split(',')[1]);
                const head = binary.slice(0, 2); // FFD8
                const rest = binary.slice(2);
                let merged = head + String.fromCharCode(...xmpSegment) + rest;
                return dataUrl.split(',')[0] + ',' + btoa(merged);
            }


            // --- NEW: EPS Embedding Function ---
            async function embedEpsAndDownload(fileData) {
                return new Promise(async (resolve, reject) => {
                    try {
                        const card = document.getElementById(fileData.id);
                        let currentTitle = fileData.title || '';
                        let currentDesc = fileData.description || '';
                        let currentKeywords = fileData.keywords || '';

                        // DOM থেকে সর্বশেষ এডিট করা টেক্সটগুলো নেওয়া হচ্ছে
                        if (card) {
                            const titleEl = card.querySelector('.meta-title');
                            if (titleEl) currentTitle = titleEl.innerText.trim();

                            const descEl = card.querySelector('.meta-description');
                            if (descEl) currentDesc = descEl.innerText.trim();

                            const keywordsEl = card.querySelector('.meta-keywords');
                            if (keywordsEl) {
                                const pills = Array.from(keywordsEl.querySelectorAll('.meta-keyword-pill'));
                                if (pills.length > 0) {
                                    currentKeywords = pills.map(pill => {
                                        const clone = pill.cloneNode(true);
                                        const badge = clone.querySelector('.demand-badge'); if (badge) badge.remove();
                                        const removeBtn = clone.querySelector('.keyword-remove-btn'); if (removeBtn) removeBtn.remove();
                                        const scoreSpan = clone.querySelector('.keyword-score'); if (scoreSpan) scoreSpan.remove();
                                        return clone.textContent.trim();
                                    }).filter(t => t).join(', ');
                                }
                            }
                        }

                        const formData = new FormData();
                        formData.append('title', currentTitle);
                        formData.append('description', currentDesc);
                        formData.append('keywords', currentKeywords);
                        formData.append('file', fileData.fileObject); // ফাইল সবসময় শেষে থাকবে

                        // আপনার Render সার্ভারের URL
                        const response = await fetch('https://metagen-eps-server.onrender.com/api/embed-eps', {
                            method: 'POST',
                            body: formData
                        });

                        if (!response.ok) {
                            throw new Error("Failed to embed EPS metadata on server.");
                        }

                        // সার্ভার থেকে আসা এম্বেড করা EPS ফাইলটি ডাউনলোড করা
                        const blob = await response.blob();
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = fileData.name.replace(/(\.eps)$/i, '_meta$1');
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);

                        resolve();
                    } catch (error) {
                        console.error("EPS Embed Error:", error);
                        reject(error);
                    }
                });
            }
            async function embedAndDownload(fileData) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = async function (e) {
                        try {
                            let imageDataUrl = e.target.result;
                            let exifObj;
                            try {
                                exifObj = piexif.load(imageDataUrl);
                            } catch (err) {
                                imageDataUrl = await new Promise((res, rej) => {
                                    const img = new Image();
                                    img.onload = () => {
                                        const canvas = document.createElement('canvas');
                                        canvas.width = img.width; canvas.height = img.height;
                                        const ctx = canvas.getContext('2d');
                                        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                                        ctx.drawImage(img, 0, 0);
                                        res(canvas.toDataURL('image/jpeg', 0.95));
                                    };
                                    img.onerror = rej;
                                    img.src = e.target.result;
                                });
                            }
                            if (!exifObj) exifObj = { "0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": null };

                            function toUTF16LE(str) {
                                const bytes = [];
                                for (let i = 0; i < str.length; i++) {
                                    const code = str.charCodeAt(i);
                                    bytes.push(code & 0xff);
                                    bytes.push(code >> 8);
                                }
                                bytes.push(0, 0);
                                return bytes;
                            }

                            const metadata = getMetadataForExport(fileData);
                            const keywordsString = (metadata.keywords || "").split(',').map(k => k.trim()).join(';');

                            // ================= FIX START =================

                            if (exifObj["0th"]) {
                                delete exifObj["0th"][piexif.ImageIFD.ImageDescription];
                                delete exifObj["0th"][piexif.ImageIFD.DocumentName];
                            }
                            // ================= FIX END =================

                            exifObj["0th"][piexif.ImageIFD.XPTitle] = toUTF16LE(metadata.title || "");       // Title Column
                            exifObj["0th"][piexif.ImageIFD.XPSubject] = toUTF16LE(metadata.description || ""); // Subject Column
                            exifObj["0th"][piexif.ImageIFD.XPComment] = toUTF16LE(metadata.description || ""); // Comments Column
                            exifObj["0th"][piexif.ImageIFD.XPKeywords] = toUTF16LE(keywordsString);          // Tags Column
                            exifObj["0th"][piexif.ImageIFD.XPAuthor] = toUTF16LE("MetaGen Pro");             // Authors Column

                            const exifBytes = piexif.dump(exifObj);
                            const newImageDataUrl = piexif.insert(exifBytes, imageDataUrl);

                            const keywordsArr = (metadata.keywords || "").split(',').map(k => k.trim()).filter(Boolean);
                            const xmpString = createXmpBlock(keywordsArr);

                            const newImageDataUrlWithXmp = insertXmpIntoJpeg(newImageDataUrl, xmpString);

                            const link = document.createElement("a");
                            link.href = newImageDataUrlWithXmp;
                            link.download = fileData.name.replace(/(\.[\w\d_-]+)$/i, '_meta$1');
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            resolve();
                        } catch (error) { reject(error); }
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(fileData.fileObject);
                });
            }


            function escapeXml(unsafe) {
                return unsafe.replace(/[<>&'"]/g, function (c) {
                    switch (c) {
                        case '<': return '&lt;';
                        case '>': return '&gt;';
                        case '&': return '&amp;';
                        case '\'': return '&apos;';
                        case '"': return '&quot;';
                    }
                });
            }

            // ==========================================
            // EPS10 CONVERSION LOGIC (Client-Side)
            // ==========================================

            class EpsConverter {
                constructor(svgString, metadata) {
                    this.parser = new DOMParser();
                    this.doc = this.parser.parseFromString(svgString, "image/svg+xml");
                    this.metadata = metadata;
                    this.psCode = [];
                    this.width = 0;
                    this.height = 0;
                    this.boundingBox = [0, 0, 0, 0];
                    this.extractCSS(this.doc);
                }

                extractCSS(doc) {
                    this.cssRules = {};
                    const styleNodes = doc.getElementsByTagName("style");
                    for (let i = 0; i < styleNodes.length; i++) {
                        const cssText = styleNodes[i].textContent;
                        const blockRegex = /([^{]+)\s*\{\s*([^}]+)\s*\}/g;
                        let match;
                        while ((match = blockRegex.exec(cssText)) !== null) {
                            const selectors = match[1].split(',').map(s => s.trim());
                            const rulesStr = match[2];

                            const rules = {};
                            rulesStr.split(';').forEach(rule => {
                                const parts = rule.split(':');
                                if (parts.length === 2) {
                                    rules[parts[0].trim().toLowerCase()] = parts[1].trim();
                                }
                            });

                            selectors.forEach(selector => {
                                if (selector.startsWith('.')) {
                                    const className = selector.substring(1);
                                    if (!this.cssRules[className]) this.cssRules[className] = {};
                                    Object.assign(this.cssRules[className], rules);
                                }
                            });
                        }
                    }
                }

                convert() {
                    const svg = this.doc.documentElement;
                    this.width = parseFloat(svg.getAttribute("width")) || 500;
                    this.height = parseFloat(svg.getAttribute("height")) || 500;

                    // ViewBox parsing for better scaling if needed, defaulting to width/height
                    const viewBox = svg.getAttribute("viewBox");
                    if (viewBox) {
                        const vb = viewBox.split(/[\s,]+/).map(parseFloat);
                        if (vb.length === 4) {
                            // We use the viewbox to set bounds
                            this.width = vb[2];
                            this.height = vb[3];
                        }
                    }

                    // CRITICAL: EPS Header must be first
                    this.psCode.push("%!PS-Adobe-3.0 EPSF-3.0");
                    this.psCode.push(`%%BoundingBox: 0 0 ${Math.ceil(this.width)} ${Math.ceil(this.height)}`);
                    this.psCode.push(`%%HiResBoundingBox: 0 0 ${this.width} ${this.height}`);
                    this.psCode.push(`%%Creator: MetaGen Pro`);
                    this.psCode.push(`%%Title: ${this.metadata.title || 'Untitled'}`);
                    this.psCode.push(`%%CreationDate: ${new Date().toISOString()}`);
                    this.psCode.push("%%EndComments");

                    // Generate Definitions/Macros after header
                    this.generateHeader();

                    // Metadata injection
                    this.injectMetadata();

                    // Setup coordinate system: SVG (Top-Left) -> EPS (Bottom-Left)
                    this.psCode.push("gsave");
                    this.psCode.push(`0 ${this.height} translate`); // Move origin to top-left of page area
                    this.psCode.push(`1 -1 scale`); // Flip Y axis to match SVG

                    // Recursive processing
                    this.processNode(svg);

                    this.psCode.push("grestore");
                    this.psCode.push("showpage"); // Standard EPS finisher
                    this.psCode.push("%%EOF");

                    return this.psCode.join("\n");
                }

                generateHeader() {
                    // Standard dictionary setup
                    this.psCode.push("/m {moveto} bind def");
                    this.psCode.push("/l {lineto} bind def");
                    this.psCode.push("/c {curveto} bind def");
                    this.psCode.push("/z {closepath} bind def");
                    this.psCode.push("/f {fill} bind def");
                    this.psCode.push("/s {stroke} bind def");
                    this.psCode.push("/rgb {setrgbcolor} bind def");
                    this.psCode.push("/w {setlinewidth} bind def");
                }

                injectMetadata() {
                    if (!this.metadata) return;

                    const title = escapeXml(this.metadata.title || "");
                    const description = escapeXml(this.metadata.description || "");
                    const keywords = (this.metadata.keywords || "").split(',').map(k => k.trim()).filter(Boolean);
                    const keywordsRdf = keywords.map(k => `<rdf:li>${escapeXml(k)}</rdf:li>`).join('\n');

                    // Adobe XMP Standard Header/Footer
                    const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c138 79.159824, 2016/09/14-01:09:01">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <dc:format>application/postscript</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${description}</rdf:li></rdf:Alt></dc:description>
   <dc:subject><rdf:Bag>${keywordsRdf}</rdf:Bag></dc:subject>
   <photoshop:Headline>${title}</photoshop:Headline>
   <photoshop:Description>${description}</photoshop:Description>
   <xmp:CreatorTool>MetaGen Pro</xmp:CreatorTool>
   <xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

                    // Break XMP into 255-byte chunks for EPS compatibility (standard generic EPS comment injection)
                    // Simplified approach: Put it in a %XML_PACKET comments block or just standard % comments
                    // For valid EPS XMP, it's often embedded in a specific way, but standard comments are safer for a simple converter.
                    // However, to be read by Illustrator "File Info", it needs to be valid RDF in the file stream.
                    // We will dump it as a block of comments.

                    this.psCode.push("%begin_xml_packet: 1");
                    const lines = xmp.split('\n');
                    lines.forEach(line => this.psCode.push("% " + line));
                    this.psCode.push("%end_xml_packet");
                }

                getStyle(node, prop, stylesObj) {
                    // Priority:
                    // 1. Attribute directly on element (e.g. fill="red")
                    // 2. Inline style attribute (e.g. style="fill:red") - parsed into stylesObj
                    // 3. CSS Classes applied to node
                    // 4. Default

                    if (node.hasAttribute(prop)) return node.getAttribute(prop);
                    if (stylesObj && stylesObj[prop]) return stylesObj[prop];

                    const classNames = (node.getAttribute("class") || "").split(/\s+/);
                    for (const cls of classNames) {
                        if (this.cssRules && this.cssRules[cls] && this.cssRules[cls][prop]) {
                            return this.cssRules[cls][prop];
                        }
                    }

                    return null;
                }

                parseStyleAttribute(node) {
                    const styleStr = node.getAttribute("style");
                    if (!styleStr) return {};
                    const styles = {};
                    styleStr.split(';').forEach(eqn => {
                        const [key, val] = eqn.split(':');
                        if (key && val) styles[key.trim().toLowerCase()] = val.trim();
                    });
                    return styles;
                }

                processNode(node) {
                    if (node.nodeType !== 1) return; // Process only elements
                    const tagName = node.tagName.toLowerCase();

                    // SKIP definitions - they are only used when referenced
                    if (['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker'].includes(tagName)) return;

                    this.psCode.push("gsave");

                    // Handle 'use' tag specifically
                    if (tagName === 'use') {
                        this.processUse(node);
                        this.psCode.push("grestore");
                        return;
                    }

                    // Apply Transforms
                    const transform = node.getAttribute("transform");
                    if (transform) {
                        this.applyTransform(transform);
                    }

                    // Parse Styles
                    const stylesObj = this.parseStyleAttribute(node);

                    // Apply Styles (Fill/Stroke)
                    let fill = this.getStyle(node, 'fill', stylesObj);
                    let stroke = this.getStyle(node, 'stroke', stylesObj);
                    let strokeWidth = this.getStyle(node, 'stroke-width', stylesObj) || 1;

                    // Defaults
                    // If fill is not specified, SVG default is BLACK. 
                    // However, for lines/polylines without fill, we might not want black.
                    // But standard says: fill=black unless 'none'.
                    // We will respect this unless it's a line? No, line with fill black is invisible if valid.

                    if (!fill && !stroke) {
                        // If nothing specified, SVG default is black fill, no stroke.
                        if (['path', 'rect', 'circle', 'ellipse', 'polygon'].includes(tagName)) {
                            fill = '#000000';
                        }
                    }

                    // Parse Colors
                    let hasFill = (fill && fill.toLowerCase() !== "none");
                    let hasStroke = (stroke && stroke.toLowerCase() !== "none");

                    // Process Geometry
                    let pathData = "";

                    switch (tagName) {
                        case "g":
                        case "svg":
                        case "a":
                            Array.from(node.children).forEach(child => this.processNode(child));
                            break;

                        case "path":
                            pathData = node.getAttribute("d");
                            if (pathData) this.drawPath(pathData);
                            break;

                        case "rect":
                            const x = parseFloat(node.getAttribute("x")) || 0;
                            const y = parseFloat(node.getAttribute("y")) || 0;
                            const w = parseFloat(node.getAttribute("width")) || 0;
                            const h = parseFloat(node.getAttribute("height")) || 0;
                            this.drawRect(x, y, w, h);
                            break;

                        case "circle":
                            const cx = parseFloat(node.getAttribute("cx")) || 0;
                            const cy = parseFloat(node.getAttribute("cy")) || 0;
                            const r = parseFloat(node.getAttribute("r")) || 0;
                            this.drawCircle(cx, cy, r);
                            break;

                        case "ellipse":
                            const ex = parseFloat(node.getAttribute("cx")) || 0;
                            const ey = parseFloat(node.getAttribute("cy")) || 0;
                            const rx = parseFloat(node.getAttribute("rx")) || 0;
                            const ry = parseFloat(node.getAttribute("ry")) || 0;
                            this.drawEllipse(ex, ey, rx, ry);
                            break;

                        case "line":
                            const x1 = parseFloat(node.getAttribute("x1")) || 0;
                            const y1 = parseFloat(node.getAttribute("y1")) || 0;
                            const x2 = parseFloat(node.getAttribute("x2")) || 0;
                            const y2 = parseFloat(node.getAttribute("y2")) || 0;
                            this.drawLine(x1, y1, x2, y2);
                            break;

                        case "polyline":
                        case "polygon":
                            const points = node.getAttribute("points");
                            if (points) this.drawPoly(points, tagName === "polygon");
                            break;
                    }

                    // Apply Stroke/Fill Ops if path was generated
                    if (["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"].includes(tagName)) {
                        if (hasFill) {
                            this.setColor(fill);
                            if (hasStroke) {
                                this.psCode.push("gsave f grestore"); // fill then keep path for stroke
                            } else {
                                this.psCode.push("f");
                            }
                        }

                        if (hasStroke) {
                            this.setColor(stroke);
                            this.psCode.push(`${parseFloat(strokeWidth)} w`);
                            this.psCode.push("s");
                        }

                        // Clean up path if neither (rare, but good for safety)
                        if (!hasFill && !hasStroke) {
                            this.psCode.push("newpath");
                        }
                    }

                    this.psCode.push("grestore");
                }

                processUse(node) {
                    const href = node.getAttribute("href") || node.getAttribute("xlink:href");
                    if (!href || !href.startsWith('#')) return;

                    const id = href.substring(1);
                    // Use getElementById on document? 
                    // Note: 'this.doc' is the parser document.
                    const refNode = this.doc.getElementById(id);
                    if (!refNode) return;

                    // Apply 'use' specific transforms (x, y)
                    const x = parseFloat(node.getAttribute("x")) || 0;
                    const y = parseFloat(node.getAttribute("y")) || 0;
                    if (x !== 0 || y !== 0) {
                        this.psCode.push(`${x} ${y} translate`);
                    }

                    // Process the referenced node
                    // Note: 'use' can reference a 'symbol' or 'g' or shape.
                    // If it's a symbol, we might need to handle viewBox? 
                    // For now, treat as direct inclusion.

                    // We need to clone it to avoid mutating original if needed? No, treating read-only.
                    // But we MUST NOT process its ID again if recursive? 
                    // Just call processNode on it.

                    // IMPORTANT: 'use' elements can override styles?
                    // "CSS properties that are inherited are inherited from the 'use' element"
                    // We ignored inheritance above. Complex.
                    // We'll just process the referenced node geometry. 
                    this.processNode(refNode);
                }

                applyTransform(transformStr) {
                    // Basic parser for "translate(x,y)", "scale(s)", "rotate(a)"
                    // Real implementation needs full matrix multiplication support or use a library.
                    // For stock, simpler SVGs usually rely on groups.
                    // We will map SVG transform syntax to PostScript concat.

                    // Regex match all transforms
                    const regex = /(\w+)\(([^)]+)\)/g;
                    let match;
                    while ((match = regex.exec(transformStr)) !== null) {
                        const type = match[1];
                        const args = match[2].split(/[\s,]+/).map(parseFloat);

                        if (type === "translate") {
                            this.psCode.push(`${args[0]} ${args[1] || 0} translate`);
                        } else if (type === "scale") {
                            this.psCode.push(`${args[0]} ${args[1] || args[0]} scale`);
                        } else if (type === "rotate") {
                            // SVG rotate is degrees around origin (or optional cx,cy)
                            // PS rotate is degrees
                            if (args.length === 1) {
                                this.psCode.push(`${args[0]} rotate`);
                            } else if (args.length === 3) {
                                // Rotate around point: translate(cx,cy) rotate(a) translate(-cx,-cy)
                                this.psCode.push(`${args[1]} ${args[2]} translate`);
                                this.psCode.push(`${args[0]} rotate`);
                                this.psCode.push(`${-args[1]} ${-args[2]} translate`);
                            }
                        } else if (type === "matrix") {
                            // SVG: matrix(a b c d e f)
                            // PS: [a b c d e f] concat
                            if (args.length === 6) {
                                this.psCode.push(`[${args[0]} ${args[1]} ${args[2]} ${args[3]} ${args[4]} ${args[5]}] concat`);
                            }
                        }
                    }
                }

                drawPath(d) {
                    // Tokenize path data
                    const tokens = d.match(/([a-zA-Z])|([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g);
                    if (!tokens) return;

                    this.psCode.push("newpath");

                    let cx = 0, cy = 0; // Current position
                    let startX = 0, startY = 0; // Start of current subpath
                    let lastControlX = 0, lastControlY = 0; // For smooth curves (S, T)
                    let lastCmd = ''; // Track previous command for S/T control point reflection

                    let idx = 0;
                    while (idx < tokens.length) {
                        let cmd = tokens[idx++];

                        // If token is a number, assume implicit repetition of the last command
                        if (!/[a-zA-Z]/.test(cmd)) {
                            // Implicit commands are tricky. Usually, if a command expects args and we get more numbers, 
                            // it repeats. E.g., L 10 10 20 20 is L 10 10 then L 20 20.
                            // For 'M', subsequent pairs are treated as 'L'.
                            idx--; // Push back current token
                            if (lastCmd === 'M') cmd = 'L';
                            else if (lastCmd === 'm') cmd = 'l';
                            else cmd = lastCmd;
                        }

                        lastCmd = cmd;
                        const upperCmd = cmd.toUpperCase();
                        const isRel = (cmd === cmd.toLowerCase());

                        // Helper to get numbers
                        const getNums = (n) => {
                            const nums = [];
                            for (let i = 0; i < n; i++) {
                                let val = parseFloat(tokens[idx++]);
                                if (isNaN(val)) val = 0;
                                nums.push(val);
                            }
                            return nums;
                        };

                        switch (upperCmd) {
                            case 'M': {
                                const [x, y] = getNums(2);
                                cx = isRel ? cx + x : x;
                                cy = isRel ? cy + y : y;
                                startX = cx; startY = cy;
                                this.psCode.push(`${cx.toFixed(3)} ${cy.toFixed(3)} m`);
                                lastControlX = cx; lastControlY = cy;
                                break;
                            }
                            case 'L': {
                                const [x, y] = getNums(2);
                                cx = isRel ? cx + x : x;
                                cy = isRel ? cy + y : y;
                                this.psCode.push(`${cx.toFixed(3)} ${cy.toFixed(3)} l`);
                                lastControlX = cx; lastControlY = cy;
                                break;
                            }
                            case 'H': {
                                const [x] = getNums(1);
                                cx = isRel ? cx + x : x;
                                this.psCode.push(`${cx.toFixed(3)} ${cy.toFixed(3)} l`);
                                lastControlX = cx; lastControlY = cy;
                                break;
                            }
                            case 'V': {
                                const [y] = getNums(1);
                                cy = isRel ? cy + y : y;
                                this.psCode.push(`${cx.toFixed(3)} ${cy.toFixed(3)} l`);
                                lastControlX = cx; lastControlY = cy;
                                break;
                            }
                            case 'C': {
                                const [x1, y1, x2, y2, x, y] = getNums(6);
                                const absX1 = isRel ? cx + x1 : x1;
                                const absY1 = isRel ? cy + y1 : y1;
                                const absX2 = isRel ? cx + x2 : x2;
                                const absY2 = isRel ? cy + y2 : y2;
                                cx = isRel ? cx + x : x;
                                cy = isRel ? cy + y : y;
                                this.psCode.push(`${absX1.toFixed(3)} ${absY1.toFixed(3)} ${absX2.toFixed(3)} ${absY2.toFixed(3)} ${cx.toFixed(3)} ${cy.toFixed(3)} c`);
                                lastControlX = absX2; lastControlY = absY2;
                                break;
                            }
                            case 'S': {
                                // Smooth cubic: first control point is reflection of last second control point
                                const [x2, y2, x, y] = getNums(4);
                                // Reflection logic
                                let absX1 = cx, absY1 = cy;
                                if (['C', 'S'].includes(lastCmd.toUpperCase())) {
                                    absX1 = 2 * cx - lastControlX;
                                    absY1 = 2 * cy - lastControlY;
                                }

                                const absX2 = isRel ? cx + x2 : x2;
                                const absY2 = isRel ? cy + y2 : y2;
                                cx = isRel ? cx + x : x;
                                cy = isRel ? cy + y : y;

                                this.psCode.push(`${absX1.toFixed(3)} ${absY1.toFixed(3)} ${absX2.toFixed(3)} ${absY2.toFixed(3)} ${cx.toFixed(3)} ${cy.toFixed(3)} c`);
                                lastControlX = absX2; lastControlY = absY2;
                                break;
                            }
                            case 'Q': {
                                // Quadratic bezier: convert to cubic
                                // Q x1 y1 x y
                                const [x1, y1, x, y] = getNums(4);
                                const absX1 = isRel ? cx + x1 : x1;
                                const absY1 = isRel ? cy + y1 : y1;
                                const absX = isRel ? cx + x : x;
                                const absY = isRel ? cy + y : y;

                                // Degree elevation from quadratic to cubic
                                // CP1 = current + 2/3 * (Q_CP - current)
                                // CP2 = end + 2/3 * (Q_CP - end)
                                const cp1x = cx + (2 / 3) * (absX1 - cx);
                                const cp1y = cy + (2 / 3) * (absY1 - cy);
                                const cp2x = absX + (2 / 3) * (absX1 - absX);
                                const cp2y = absY + (2 / 3) * (absY1 - absY);

                                cx = absX; cy = absY;
                                this.psCode.push(`${cp1x.toFixed(3)} ${cp1y.toFixed(3)} ${cp2x.toFixed(3)} ${cp2y.toFixed(3)} ${cx.toFixed(3)} ${cy.toFixed(3)} c`);
                                lastControlX = absX1; lastControlY = absY1;
                                break;
                            }
                            case 'T': {
                                // Smooth quadratic: reflect previous control point
                                const [x, y] = getNums(2);
                                let absX1 = cx, absY1 = cy;

                                if (['Q', 'T'].includes(lastCmd.toUpperCase())) {
                                    absX1 = 2 * cx - lastControlX;
                                    absY1 = 2 * cy - lastControlY;
                                }

                                const absX = isRel ? cx + x : x;
                                const absY = isRel ? cy + y : y;

                                // Convert inferred Q control point (absX1, absY1) to C control points
                                const cp1x = cx + (2 / 3) * (absX1 - cx);
                                const cp1y = cy + (2 / 3) * (absY1 - cy);
                                const cp2x = absX + (2 / 3) * (absX1 - absX);
                                const cp2y = absY + (2 / 3) * (absY1 - absY);

                                cx = absX; cy = absY;
                                this.psCode.push(`${cp1x.toFixed(3)} ${cp1y.toFixed(3)} ${cp2x.toFixed(3)} ${cp2y.toFixed(3)} ${cx.toFixed(3)} ${cy.toFixed(3)} c`);
                                lastControlX = absX1; lastControlY = absY1;
                                break;
                            }
                            case 'A': {
                                // Arc: Hard to implement fully. Approximating with a straight line for MVP robustness.
                                // A rx ry x-axis-rotation large-arc-flag sweep-flag x y
                                const [rx, ry, rot, large, sweep, x, y] = getNums(7);
                                cx = isRel ? cx + x : x;
                                cy = isRel ? cy + y : y;
                                // Fallback: Draw line to end point
                                this.psCode.push(`${cx.toFixed(3)} ${cy.toFixed(3)} l`);
                                lastControlX = cx; lastControlY = cy;
                                break;
                            }
                            case 'Z': {
                                this.psCode.push("z");
                                cx = startX; cy = startY; // Close path returns to start
                                lastControlX = cx; lastControlY = cy;
                                break;
                            }
                            default:
                                break;
                        }
                    }
                }

                drawRect(x, y, w, h) {
                    this.psCode.push("newpath");
                    this.psCode.push(`${x} ${y} m`);
                    this.psCode.push(`${x + w} ${y} l`);
                    this.psCode.push(`${x + w} ${y + h} l`);
                    this.psCode.push(`${x} ${y + h} l`);
                    this.psCode.push("z");
                }

                drawCircle(cx, cy, r) {
                    // Constant for circle approximation with Beziers
                    const k = 0.55228475;
                    this.psCode.push("newpath");
                    this.psCode.push(`${(cx + r).toFixed(3)} ${cy.toFixed(3)} m`);
                    this.psCode.push(`${(cx + r).toFixed(3)} ${(cy + k * r).toFixed(3)} ${(cx + k * r).toFixed(3)} ${(cy + r).toFixed(3)} ${cx.toFixed(3)} ${(cy + r).toFixed(3)} c`);
                    this.psCode.push(`${(cx - k * r).toFixed(3)} ${(cy + r).toFixed(3)} ${(cx - r).toFixed(3)} ${(cy + k * r).toFixed(3)} ${(cx - r).toFixed(3)} ${cy.toFixed(3)} c`);
                    this.psCode.push(`${(cx - r).toFixed(3)} ${(cy - k * r).toFixed(3)} ${(cx - k * r).toFixed(3)} ${(cy - r).toFixed(3)} ${cx.toFixed(3)} ${(cy - r).toFixed(3)} c`);
                    this.psCode.push(`${(cx + k * r).toFixed(3)} ${(cy - r).toFixed(3)} ${(cx + r).toFixed(3)} ${(cy - k * r).toFixed(3)} ${(cx + r).toFixed(3)} ${cy.toFixed(3)} c`);
                    this.psCode.push("z");
                }

                drawEllipse(cx, cy, rx, ry) {
                    // Same as circle but with separate radii
                    const k = 0.552284749831;
                    this.psCode.push("newpath");
                    this.psCode.push(`${cx + rx} ${cy} m`);
                    this.psCode.push(`${cx + rx} ${cy + k * ry} ${cx + k * rx} ${cy + ry} ${cx} ${cy + ry} c`);
                    this.psCode.push(`${cx - k * rx} ${cy + ry} ${cx - rx} ${cy + k * ry} ${cx - rx} ${cy} c`);
                    this.psCode.push(`${cx - rx} ${cy - k * ry} ${cx - k * rx} ${cy - ry} ${cx} ${cy - ry} c`);
                    this.psCode.push(`${cx + k * rx} ${cy - ry} ${cx + rx} ${cy - k * ry} ${cx + rx} ${cy} c`);
                    this.psCode.push("z");
                }

                drawLine(x1, y1, x2, y2) {
                    this.psCode.push("newpath");
                    this.psCode.push(`${x1} ${y1} m`);
                    this.psCode.push(`${x2} ${y2} l`);
                }

                drawPoly(pointsStr, isClosed) {
                    const pts = pointsStr.trim().split(/[\s,]+/).map(parseFloat);
                    if (pts.length < 2) return;

                    this.psCode.push("newpath");
                    this.psCode.push(`${pts[0]} ${pts[1]} m`);
                    for (let i = 2; i < pts.length; i += 2) {
                        this.psCode.push(`${pts[i]} ${pts[i + 1]} l`);
                    }
                    if (isClosed) this.psCode.push("z");
                }

                setColor(colorStr) {
                    if (!colorStr) return;

                    const colors = {
                        'white': '1 1 1',
                        'black': '0 0 0',
                        'red': '1 0 0',
                        'green': '0 1 0',
                        'blue': '0 0 1',
                        'yellow': '1 1 0',
                        'cyan': '0 1 1',
                        'magenta': '1 0 1',
                        'gray': '0.5 0.5 0.5',
                        'grey': '0.5 0.5 0.5',
                        'orange': '1 0.5 0',
                        'purple': '0.5 0 0.5'
                    };

                    const c = colorStr.toLowerCase();

                    // Handle Hex
                    if (c.startsWith('#')) {
                        let hex = c.substring(1);
                        if (hex.length === 3) hex = hex.split('').map(char => char + char).join('');
                        const r = parseInt(hex.substring(0, 2), 16) / 255;
                        const g = parseInt(hex.substring(2, 4), 16) / 255;
                        const b = parseInt(hex.substring(4, 6), 16) / 255;
                        if (!isNaN(r)) this.psCode.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rgb`);
                    }
                    // Handle rgb()
                    else if (c.startsWith('rgb')) {
                        const vals = c.match(/\d+/g);
                        if (vals && vals.length >= 3) {
                            this.psCode.push(`${(vals[0] / 255).toFixed(3)} ${(vals[1] / 255).toFixed(3)} ${(vals[2] / 255).toFixed(3)} rgb`);
                        }
                    }
                    // Handle Named Colors
                    else if (colors[c]) {
                        this.psCode.push(`${colors[c]} rgb`);
                    }
                    // Default fallback
                    else {
                        this.psCode.push("0 0 0 rgb");
                    }
                }
            }

            // Helper to get EPS Blob from Server
            async function getEpsBlobForFile(fileData) {
                const card = document.getElementById(fileData.id);
                let currentTitle = fileData.title || '';
                let currentDesc = fileData.description || '';
                let currentKeywords = fileData.keywords || '';

                if (card) {
                    const titleEl = card.querySelector('.meta-title');
                    if (titleEl) currentTitle = titleEl.innerText.trim();
                    const descEl = card.querySelector('.meta-description');
                    if (descEl) currentDesc = descEl.innerText.trim();
                    const keywordsEl = card.querySelector('.meta-keywords');
                    if (keywordsEl) {
                        const pills = Array.from(keywordsEl.querySelectorAll('.meta-keyword-pill'));
                        if (pills.length > 0) {
                            currentKeywords = pills.map(pill => {
                                const clone = pill.cloneNode(true);
                                const badge = clone.querySelector('.demand-badge'); if (badge) badge.remove();
                                const removeBtn = clone.querySelector('.keyword-remove-btn'); if (removeBtn) removeBtn.remove();
                                const scoreSpan = clone.querySelector('.keyword-score'); if (scoreSpan) scoreSpan.remove();
                                return clone.textContent.trim();
                            }).filter(t => t).join(', ');
                        }
                    }
                }

                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        try {
                            const svgContent = e.target.result;
                            const metadata = {
                                title: currentTitle,
                                description: currentDesc,
                                keywords: currentKeywords
                            };

                            // Run EpsConverter directly on the main thread
                            // which automatically utilizes the browser's native DOMParser
                            const converter = new EpsConverter(svgContent, metadata);
                            const epsString = converter.convert();
                            const blob = new Blob([epsString], { type: 'application/postscript' });
                            resolve(blob);
                        } catch (error) {
                            reject(new Error("Local EPS conversion failed: " + error.message));
                        }
                    };

                    reader.onerror = () => reject(new Error("File read error"));
                    reader.readAsText(fileData.fileObject);
                });
            }

            // --- Individual EPS Download ---
            window.downloadAsEps = async function (idOrData) {
                let fileData = idOrData;
                if (typeof idOrData === 'string') {
                    fileData = uploadedFilesData.find(f => f.id === idOrData);
                }

                if (!fileData) {
                    console.error("File data not found for download.");
                    return;
                }

                const button = document.getElementById(`btn-eps-${fileData.id}`);
                const originalText = button ? button.innerHTML : '';
                if (button) {
                    button.disabled = true;
                    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Converting...';
                }

                try {
                    const blob = await getEpsBlobForFile(fileData);
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = fileData.name.replace(/(\.svg)$/i, '_meta.eps');
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("EPS Download Error:", error);
                    alert("Failed to generate EPS: " + error.message);
                } finally {
                    if (button) {
                        button.disabled = false;
                        button.innerHTML = originalText;
                    }
                }
            }


            // --- Batch Download All EPS (ZIP Packaging - Premium Only) ---
            // Uses In-line Web Worker for non-blocking ZIP generation
            window.downloadAllEps = async function () {
                const isPremium = window.userUsageData?.plan === 'premium';
                if (!isPremium) {
                    alert('Batch EPS Download is available for Premium users only.');
                    return;
                }

                const svgFiles = uploadedFilesData.filter(f => {
                    const isSvg = f.fileObject?.type === 'image/svg+xml' || f.name?.toLowerCase().endsWith('.svg');
                    const card = document.getElementById(f.id);
                    const hasMetadata = card && card.classList.contains('metadata-generated');
                    return isSvg && hasMetadata;
                });

                if (svgFiles.length === 0) {
                    alert('No SVG files with generated metadata found for EPS download.');
                    return;
                }

                const batchBtn = document.getElementById('batchDownloadEpsButton');
                const originalText = batchBtn ? batchBtn.innerHTML : '';
                if (batchBtn) {
                    batchBtn.disabled = true;
                }

                try {
                    const zipFilesArray = [];
                    let successCount = 0;
                    let failCount = 0;

                    for (let i = 0; i < svgFiles.length; i++) {
                        if (batchBtn) {
                            batchBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Converting ${i + 1}/${svgFiles.length}...`;
                        }
                        try {
                            const blob = await getEpsBlobForFile(svgFiles[i]);
                            const filename = svgFiles[i].name.replace('.svg', '.eps');
                            // Convert blob to ArrayBuffer for transferring to worker
                            const arrayBuffer = await blob.arrayBuffer();
                            zipFilesArray.push({ filename, data: arrayBuffer });
                            successCount++;
                        } catch (err) {
                            console.error(`EPS conversion failed for ${svgFiles[i].name}:`, err);
                            failCount++;
                        }
                    }

                    if (successCount > 0) {
                        if (batchBtn) batchBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Packaging ZIP...`;

                        // In-line Web Worker for ZIP generation
                        const zipWorkerCode = `
                            importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
                            self.onmessage = async function(e) {
                                try {
                                    const files = e.data.files;
                                    const zip = new JSZip();
                                    for (const file of files) {
                                        zip.file(file.filename, file.data);
                                    }
                                    const content = await zip.generateAsync(
                                        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
                                        function(meta) {
                                            self.postMessage({ type: 'progress', percent: meta.percent });
                                        }
                                    );
                                    self.postMessage({ type: 'success', blob: content });
                                } catch (err) {
                                    self.postMessage({ type: 'error', error: err.message });
                                }
                            };
                        `;
                        const zipWorkerBlob = new Blob([zipWorkerCode], { type: 'application/javascript' });
                        const zipWorkerUrl = URL.createObjectURL(zipWorkerBlob);

                        await new Promise((resolve, reject) => {
                            const worker = new Worker(zipWorkerUrl);
                            worker.onmessage = (e) => {
                                const { type, percent, blob, error } = e.data;
                                if (type === 'progress') {
                                    if (batchBtn) batchBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Packaging ZIP... ${Math.round(percent)}%`;
                                } else if (type === 'success') {
                                    const url = URL.createObjectURL(blob);
                                    const link = document.createElement("a");
                                    link.href = url;
                                    link.download = `MetaGen_EPS_Batch_${new Date().getTime()}.zip`;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                    URL.revokeObjectURL(url);
                                    worker.terminate();
                                    URL.revokeObjectURL(zipWorkerUrl);
                                    resolve();
                                } else if (type === 'error') {
                                    worker.terminate();
                                    URL.revokeObjectURL(zipWorkerUrl);
                                    reject(new Error(error));
                                }
                            };

                            worker.onerror = (err) => {
                                worker.terminate();
                                URL.revokeObjectURL(zipWorkerUrl);
                                reject(err);
                            };

                            // Transfer ArrayBuffers for zero-copy performance
                            const transferables = zipFilesArray.map(f => f.data);
                            worker.postMessage({ action: 'generateZip', files: zipFilesArray }, transferables);
                        });
                    }


                    if (failCount > 0) {
                        alert(`Batch Complete: ${successCount} succeeded, ${failCount} failed.`);
                    }

                } catch (error) {
                    console.error("Batch EPS Error:", error);
                    alert("An error occurred during batch process: " + error.message);
                } finally {
                    if (batchBtn) {
                        batchBtn.disabled = false;
                        batchBtn.innerHTML = originalText;
                    }
                }
            }

            function checkBatchEpsButtonState() {
                const batchEpsBtn = document.getElementById('batchDownloadEpsButton');
                if (!batchEpsBtn) return;

                const isPremium = window.userUsageData?.plan === 'premium';
                if (!isPremium) {
                    batchEpsBtn.style.display = 'none';
                    batchEpsBtn.disabled = true;
                    return;
                }
                // Show button for premium users
                batchEpsBtn.style.display = 'inline-flex';

                const hasSvgWithMeta = uploadedFilesData.some(f => {
                    const isSvg = f.fileObject?.type === 'image/svg+xml' || f.name?.toLowerCase().endsWith('.svg');
                    const card = document.getElementById(f.id);
                    return isSvg && card && card.classList.contains('metadata-generated');
                });

                batchEpsBtn.disabled = !hasSvgWithMeta;
            }

            async function embedSvgAndDownload(fileData) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        try {
                            const svgContent = e.target.result;
                            const parser = new DOMParser();
                            const xmlDoc = parser.parseFromString(svgContent, "image/svg+xml");

                            const svgRoot = xmlDoc.documentElement;

                            let titleNode = svgRoot.querySelector("title");
                            if (!titleNode) {
                                titleNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "title");
                                svgRoot.insertBefore(titleNode, svgRoot.firstChild);
                            }
                            titleNode.textContent = fileData.title || "";

                            let descNode = svgRoot.querySelector("desc");
                            if (!descNode) {
                                descNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "desc");
                                svgRoot.insertBefore(descNode, titleNode.nextSibling);
                            }
                            descNode.textContent = fileData.description || "";

                            const oldMetadata = svgRoot.querySelectorAll("metadata");
                            oldMetadata.forEach(el => el.remove());

                            let metadataNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "metadata");
                            metadataNode.id = "metagen-placeholder";
                            svgRoot.insertBefore(metadataNode, descNode.nextSibling);

                            const serializer = new XMLSerializer();
                            let svgString = serializer.serializeToString(xmlDoc);

                            const title = escapeXml(fileData.title || "");
                            const description = escapeXml(fileData.description || "");
                            const keywordsArray = (fileData.keywords || "").split(',').map(k => k.trim()).filter(Boolean);
                            const keywordsRdf = keywordsArray.map(k => `<rdf:li>${escapeXml(k)}</rdf:li>`).join('\n                                    ');

                            const xmpContent = `
        <x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c138 79.159824, 2016/09/14-01:09:01        ">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about=""
                    xmlns:dc="http://purl.org/dc/elements/1.1/"
                    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
                    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
                    <dc:format>image/svg+xml</dc:format>
                    <dc:title>
                        <rdf:Alt>
                            <rdf:li xml:lang="x-default">${title}</rdf:li>
                        </rdf:Alt>
                    </dc:title>
                    <dc:description>
                        <rdf:Alt>
                            <rdf:li xml:lang="x-default">${description}</rdf:li>
                        </rdf:Alt>
                    </dc:description>
                    <dc:subject>
                        <rdf:Bag>
                            ${keywordsRdf}
                        </rdf:Bag>
                    </dc:subject>
                    <photoshop:Headline>${title}</photoshop:Headline>
                    <photoshop:Description>${description}</photoshop:Description>
                    <xmp:CreatorTool>MetaGen Pro</xmp:CreatorTool>
                    <xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate>
                </rdf:Description>
            </rdf:RDF>
        </x:xmpmeta>`;

                            const xmpWithPacket = `<metadata id="metagen-data"><?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>${xmpContent}<?xpacket end="w"?></metadata>`;

                            svgString = svgString.replace(/<metadata[^>]*id="metagen-placeholder"[^>]*>(.*?)<\/metadata>|<metadata[^>]*id="metagen-placeholder"[^>]*\/>/si, xmpWithPacket);

                            if (!svgString.startsWith('<?xml')) {
                                svgString = '<?xml version="1.0" encoding="utf-8"?>\n' + svgString;
                            }

                            const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement("a");
                            link.href = url;
                            link.download = fileData.name.replace(/(\.svg)$/i, '_meta$1');
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            URL.revokeObjectURL(url);

                            resolve();

                        } catch (error) {
                            console.error("SVG Embed Error:", error);
                            alert(`Error processing SVG: ${fileData.name}`);
                            reject(error);
                        }
                    };
                    reader.onerror = (err) => reject(err);
                    reader.readAsText(fileData.fileObject);
                });
            }

            // Toggle Dropdown Function
            window.toggleExportDropdown = function () {
                const dropdownMenu = document.getElementById('exportDropdownMenu');
                if (dropdownMenu.style.display === 'block') {
                    dropdownMenu.style.display = 'none';
                } else {
                    dropdownMenu.style.display = 'block';
                }
            };

            // Close dropdown when clicking outside
            window.addEventListener('click', function (event) {
                const dropdownMenu = document.getElementById('exportDropdownMenu');
                const exportBtn = document.getElementById('exportButton');
                // Check if click is outside button and menu
                if (dropdownMenu && exportBtn && !exportBtn.contains(event.target) && !dropdownMenu.contains(event.target)) {
                    dropdownMenu.style.display = 'none';
                }
            });

            window.mapShutterstockToAdobe = function (shutterstockCat) {
                if (!shutterstockCat) return "Graphic Resources";
                const s = String(shutterstockCat).toLowerCase();
                if (s.includes("animal")) return "Animals";
                if (s.includes("building") || s.includes("interior")) return "Buildings and Architecture";
                if (s.includes("business")) return "Business";
                if (s.includes("drink")) return "Drinks";
                if (s.includes("nature") || s.includes("park")) return "Landscapes";
                if (s.includes("food")) return "Food";
                if (s.includes("abstract") || s.includes("art") || s.includes("background") || s.includes("texture") || s.includes("object") || s.includes("misc") || s.includes("sign") || s.includes("symbol") || s.includes("vintage")) return "Graphic Resources";
                if (s.includes("beauty") || s.includes("fashion")) return "Lifestyle";
                if (s.includes("celebrity") || s.includes("people")) return "People";
                if (s.includes("education") || s.includes("science") || s.includes("health") || s.includes("medical")) return "Science";
                if (s.includes("holiday") || s.includes("religion")) return "Culture and Religion";
                if (s.includes("industrial")) return "Industry";
                if (s.includes("sport") || s.includes("recreation")) return "Sports";
                if (s.includes("technology")) return "Technology";
                if (s.includes("transport")) return "Transport";
                return "Graphic Resources";
            };

            window.getMappedAdobeCategory = function (catName) {
                const map = {
                    "Animals": "1",
                    "Buildings and Architecture": "2",
                    "Business": "3",
                    "Drinks": "4",
                    "Environment": "5",
                    "States of Mind": "6",
                    "Food": "7",
                    "Graphic Resources": "8",
                    "Hobbies and Leisure": "9",
                    "Industry": "10",
                    "Landscapes": "11",
                    "Lifestyle": "12",
                    "People": "13",
                    "Plants and Flowers": "14",
                    "Culture and Religion": "15",
                    "Science": "16",
                    "Social Issues": "17",
                    "Sports": "18",
                    "Technology": "19",
                    "Transport": "20",
                    "Travel": "21"
                };
                return map[catName] || "8";
            };

            window.exportAllCsv = function (targetPlatform) {
                const successfulFiles = uploadedFilesData.filter(f => f.title && f.title !== "Error");
                if (successfulFiles.length === 0) {
                    alert("No successful metadata to export.");
                    return;
                }

                let platformToUse = targetPlatform;
                if (!platformToUse) {
                    const activePlatformBtn = document.querySelector('.platform-button.active');
                    platformToUse = activePlatformBtn ? activePlatformBtn.dataset.platform : '';
                }

                let csvContent = '';
                let isShutterstock = (platformToUse === 'shutterstock');
                let isAdobe = (platformToUse === 'adobe');

                if (isShutterstock) {
                    csvContent += "Filename,Description,Keywords,Categories,Releases\n";
                    successfulFiles.forEach(fileData => {
                        const title = fileData.title || "";
                        const keywords = fileData.keywords || "";
                        // Use AI-detected category per file
                        const categoryValue = (fileData.category || "").replace(/"/g, '""');

                        const fileName = fileData.name.replace(/"/g, '""');
                        const descriptionAsTitle = title.replace(/"/g, '""');
                        const keywordsEscaped = keywords.replace(/"/g, '""');
                        const releases = (fileData.releases || []).map(r => r.name).join('; ').replace(/"/g, '""');
                        csvContent += `"${fileName}","${descriptionAsTitle}","${keywordsEscaped}","${categoryValue}","${releases}"\n`;
                    });
                    alert("Shutterstock CSV generated! AI-detected categories are included in the 'Categories' column. Upload this CSV to Shutterstock — categories will be auto-filled!");

                } else if (isAdobe) {
                    csvContent += "Filename,Title,Keywords,Category,Releases\n";
                    successfulFiles.forEach(fileData => {
                        const title = fileData.title || "";
                        const keywords = fileData.keywords || "";

                        const catSelect = document.getElementById(`ai-category-${fileData.id}`);
                        const adobeCat = getMappedAdobeCategory(catSelect ? catSelect.value : (fileData.adobeCategory || ''));
                        const categoryValue = adobeCat.replace(/"/g, '""');

                        const fileName = fileData.name.replace(/"/g, '""');
                        const descriptionAsTitle = title.replace(/"/g, '""');
                        const keywordsEscaped = keywords.replace(/"/g, '""');
                        const releases = (fileData.releases || []).map(r => r.name).join('; ').replace(/"/g, '""');
                        csvContent += `"${fileName}","${descriptionAsTitle}","${keywordsEscaped}","${categoryValue}","${releases}"\n`;
                    });
                    alert("Adobe Stock CSV generated! AI-detected categories are included in the 'Category' column. Upload this CSV to Adobe Stock — categories will be auto-filled!");

                } else {
                    csvContent += "Filename,Title,Keywords,Description,Category,Releases\n";
                    successfulFiles.forEach(fileData => {
                        const originalFileName = fileData.name.replace(/"/g, '""');
                        const title = (fileData.title || "").replace(/"/g, '""');
                        const keywords = (fileData.keywords || "").replace(/"/g, '""');
                        const description = (fileData.description || "").replace(/"/g, '""');

                        const catSelect = document.getElementById(`ai-category-${fileData.id}`);
                        const adobeCat = getMappedAdobeCategory(catSelect ? catSelect.value : (fileData.adobeCategory || ''));
                        const categoryValue = adobeCat.replace(/"/g, '""');
                        const releases = (fileData.releases || []).map(r => r.name).join('; ').replace(/"/g, '""');

                        csvContent += `"${originalFileName}","${title}","${keywords}","${description}","${categoryValue}","${releases}"\n`;
                    });
                }

                const fileName = platformToUse ? `${platformToUse}_metadata.csv` : "metadata_export.csv";
                const encodedUri = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
                const link = document.createElement("a");
                link.setAttribute("href", encodedUri);
                link.setAttribute("download", fileName);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                // Hide dropdown
                const dm = document.getElementById('exportDropdownMenu');
                if (dm) dm.style.display = 'none';
            };

            window.exportAllExcel = async function () {
                const user = auth.currentUser;
                const userEmail = user?.email;
                let currentPlan = 'free';

                if (userEmail) {
                    const usage = await getMetadataUsage(userEmail);
                    currentPlan = (usage.plan || 'free').toLowerCase();
                    // Sync global state
                    if (window.userUsageData) window.userUsageData.plan = currentPlan;
                }

                if (currentPlan === 'free') {
                    openUpgradeModal('pro');
                    return;
                }

                const successfulFiles = uploadedFilesData.filter(f => f.title && f.title !== "Error");
                if (successfulFiles.length === 0) {
                    alert("No successful metadata to export.");
                    return;
                }

                if (typeof XLSX === 'undefined') {
                    alert("Excel export library not loaded. Please refresh the page.");
                    return;
                }

                const data = successfulFiles.map(fileData => {
                    const catSelect = document.getElementById(`ai-category-${fileData.id}`);
                    const adobeCat = getMappedAdobeCategory(catSelect ? catSelect.value : (fileData.adobeCategory || ''));
                    const releases = (fileData.releases || []).map(r => r.name).join('; ');

                    return {
                        "File Name": fileData.name,
                        "Title": fileData.title || "",
                        "Description": fileData.description || "",
                        "Keywords": fileData.keywords || "",
                        "Shutterstock Category": fileData.category || "",
                        "Adobe Category": adobeCat,
                        "Releases": releases
                    };
                });

                const ws = XLSX.utils.json_to_sheet(data);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Metadata");
                XLSX.writeFile(wb, "metadata_export.xlsx");

                // Hide dropdown
                const dm = document.getElementById('exportDropdownMenu');
                if (dm) dm.style.display = 'none';
            };

            // Global Release Form Upload Handler
            window.handleReleaseUpload = function (inputElem, cardId) {
                const files = Array.from(inputElem.files);
                if (!files || files.length === 0) return;

                const fileData = uploadedFilesData.find(f => f.id === cardId);
                if (fileData) {
                    fileData.releases = files;
                    const listContainer = document.getElementById(`release-files-list-${cardId}`);
                    if (listContainer) {
                        listContainer.innerHTML = files.map(f => `<i class="fas fa-file-pdf"></i> ${f.name}`).join('<br>');
                    }
                }
            };

            // Global CSV Metadata Applier Logic (Pro/Premium Only)
            window.applyCsvMetadata = async function (event) {
                const file = event.target.files[0];
                if (!file) return;

                // Plan Check: Restrict to Pro/Premium (Firebase)
                try {
                    const user = auth.currentUser;
                    const userEmail = user ? user.email : null;
                    let currentPlan = 'free';

                    if (userEmail) {
                        const usage = await getMetadataUsage(userEmail);
                        currentPlan = (usage.plan || 'free').toLowerCase();
                        if (window.userUsageData) window.userUsageData.plan = currentPlan;
                    }

                    if (currentPlan === 'free') {
                        event.target.value = '';
                        openUpgradeModal('pro');
                        return;
                    }
                } catch (err) {
                    console.warn('Plan check failed for CSV upload:', err);
                }

                const reader = new FileReader();
                reader.onload = function (e) {
                    const data = new Uint8Array(e.target.result);
                    let workbook;
                    try {
                        workbook = XLSX.read(data, { type: 'array' });
                        const firstSheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[firstSheetName];
                        const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

                        let appliedCount = 0;
                        json.forEach(row => {
                            // Find filename from common standard CSV headers
                            let filename = row["Filename"] || row["File Name"] || row["File"] || row["Image"] || row["Name"];
                            if (!filename) return;
                            filename = String(filename).trim();

                            const targetFileData = uploadedFilesData.find(f => {
                                if (f.name === filename) return true;
                                const fBase = f.name.substring(0, f.name.lastIndexOf('.')) || f.name;
                                const csvBase = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
                                return fBase === csvBase || fBase === filename;
                            });
                            if (targetFileData) {
                                // Extract standard metadata 
                                const title = String(row["Title"] || row["Description"] || "");
                                const desc = String(row["Description"] || row["Title"] || "");
                                const keywords = String(row["Keywords"] || row["Tags"] || "");
                                const category = String(row["Category"] || row["Categories"] || row["Shutterstock Category"] || "");
                                const releasesStr = String(row["Releases"] || "");

                                targetFileData.title = title;
                                targetFileData.description = desc;
                                targetFileData.keywords = keywords;
                                targetFileData.category = category;

                                // Set Adobe Category correctly
                                targetFileData.adobeCategory = mapShutterstockToAdobe(category);

                                // Update Card DOM if available
                                const card = document.getElementById(targetFileData.id);
                                if (card) {
                                    card.classList.remove('processing');
                                    card.classList.add('metadata-generated');

                                    const metaTitle = card.querySelector('.meta-title');
                                    if (metaTitle) metaTitle.textContent = title;

                                    const metaDesc = card.querySelector('.meta-description');
                                    if (metaDesc) metaDesc.textContent = desc;

                                    const descSection = document.getElementById(`desc-section-${card.id}`);
                                    if (descSection && desc) descSection.style.display = 'block';

                                    window.updateKeywordsDisplay(card.id);

                                    const catSelect = document.getElementById(`ai-category-${card.id}`);
                                    if (catSelect && targetFileData.adobeCategory) {
                                        catSelect.value = targetFileData.adobeCategory;
                                    }
                                }
                                appliedCount++;
                            }
                        });

                        alert(`Successfully mapped and applied metadata to ${appliedCount} image(s)!`);
                        // Update UI buttons because we now have metadata
                        if (typeof updateAllButtonStates === 'function') updateAllButtonStates();
                    } catch (error) {
                        console.error('Error parsing CSV file:', error);
                        alert("Error parsing CSV. Please ensure it's a valid CSV/Excel file.");
                    }
                };
                reader.readAsArrayBuffer(file);
                // Reset input for later reuse
                event.target.value = '';
            };

            // (Removed custom keyword DOM update function in favor of native window.updateKeywordsDisplay)

            // Embed Metadata restrict to Pro/Premium (Firebase)
            window.embedMetadata = async function () {
                const user = auth.currentUser;
                const userEmail = user ? user.email : null;
                let currentPlan = 'free';

                if (userEmail) {
                    const usage = await getMetadataUsage(userEmail);
                    currentPlan = (usage.plan || 'free').toLowerCase();
                    // Sync global state
                    if (window.userUsageData) window.userUsageData.plan = currentPlan;
                }

                if (currentPlan === 'free') {
                    openUpgradeModal('pro');
                    return;
                }
                if (typeof embedMetadataAll === 'function') {
                    embedMetadataAll();
                }
            };

            // FTP Upload restrict to Premium (Firebase)
            window.openFtpUploadModal = async function () {
                const user = auth.currentUser;
                const userEmail = user ? user.email : null;
                let currentPlan = 'free';

                if (userEmail) {
                    const usage = await getMetadataUsage(userEmail);
                    currentPlan = (usage.plan || 'free').toLowerCase();
                    // Sync global state
                    if (window.userUsageData) window.userUsageData.plan = currentPlan;
                }

                if (currentPlan !== 'premium' && currentPlan !== 'agency') {
                    openUpgradeModal('premium');
                    return;
                }
                const modal = document.getElementById('ftpModal');
                if (modal) {
                    modal.style.display = 'flex';
                    if (typeof window.handleAgencyConfigChange === 'function') {
                        window.handleAgencyConfigChange();
                    }
                }
            };
            function testMetadataCompatibility() {
                const testInfo = `
🔍 Metadata Compatibility Test Results:

✅ PNG Files:
- Title: Embedded in tEXt chunk and XMP
- Description: Embedded in tEXt chunk and XMP  
- Keywords: Embedded in tEXt chunk and XMP
- Windows Properties: Should show Title, Subject, Tags
- Adobe Stock: Should show Title and Keywords

✅ JPEG Files:
- Title: Embedded in EXIF and XMP
- Description: Embedded in EXIF and XMP
- Keywords: Embedded in EXIF and XMP
- Windows Properties: Should show Title, Subject, Tags
- Adobe Stock: Should show Title and Keywords

💡 Tips for Best Results:
1. Use descriptive titles (5-15 words)
2. Include relevant keywords (20-35 keywords)
3. Write detailed descriptions (30-50 words)
4. Test files in Windows File Properties
5. Upload to Adobe Stock to verify metadata

⚠️ Note: Some software may display metadata differently.
    `;
                alert(testInfo);
            }

            window.svgFileToPngDataUrl = async function (svgFile, width = 512, height = 512) {
                return new Promise((resolve, reject) => {
                    const url = URL.createObjectURL(svgFile);
                    const img = new Image();
                    img.onload = function () {
                        const canvas = document.createElement('canvas');
                        canvas.width = width; canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.fillStyle = "#fff";
                        ctx.fillRect(0, 0, width, height);
                        ctx.drawImage(img, 0, 0, width, height);
                        URL.revokeObjectURL(url);
                        resolve(canvas.toDataURL('image/png'));
                    };
                    img.onerror = (e) => {
                        URL.revokeObjectURL(url);
                        reject(e);
                    };
                    img.src = url;
                });
            };

            function updateAllButtonStates() {
                updateProcessButtonText();
                updatePromptButtonState();
                checkBatchEpsButtonState();
            }

            function updateProcessButtonText(processed = 0, total = 0, completed = 0, errors = 0, isComplete = false) {
                const fileCount = uploadedFilesData.length;
                const hasSuccessfulData = uploadedFilesData.some(f => f.title && f.title !== "Error");

                const hasEmbeddableFiles = uploadedFilesData.some(f =>
                    f.title && f.title !== "Error" &&
                    (
                        f.fileObject.type === 'image/jpeg' ||
                        f.fileObject.type === 'image/jpg' ||
                        f.fileObject.type === 'image/png' ||
                        f.fileObject.type === 'image/svg+xml' ||
                        f.name.toLowerCase().endsWith('.svg') ||
                        f.name.toLowerCase().endsWith('.eps')
                    )
                );

                const translateAllBtn = document.getElementById('translateAllBtn');

                if (fileCount === 0) {
                    processAllButton.innerHTML = '<i class="icon-process"></i> ' + getTrans('process_selected');
                    processAllButton.disabled = true;
                    exportButton.disabled = true;
                    embedMetadataButton.disabled = true;
                    return;
                }

                const unprocessedFiles = uploadedFilesData.filter(f => !f.title).length;
                processAllButton.disabled = unprocessedFiles === 0 && !isComplete;

                if (isComplete) {
                    processAllButton.innerHTML = `<i class="icon-check"></i> ${getTrans('complete')}: ${completed} ${getTrans('success')}, ${errors} ${getTrans('fail')}`;
                    processAllButton.style.background = errors === 0 ? 'linear-gradient(90deg, #10B981 60%, #059669 100%)' : 'linear-gradient(90deg, #F97316 60%, #ea580c 100%)';
                } else if (processed > 0) {
                    processAllButton.innerHTML = `<i class="icon-spinner"></i> ${getTrans('processing')} ${processed}/${total} | ✓ ${completed} / ✕ ${errors}`;
                    processAllButton.disabled = true;
                } else {
                    processAllButton.innerHTML = `<i class="icon-process"></i> ${getTrans('process')} ${unprocessedFiles} ${getTrans('files')}`;
                    processAllButton.style.background = 'linear-gradient(90deg, #F97316 60%, #ea580c 100%)';
                }

                exportButton.disabled = !hasSuccessfulData;

                // Enable/disable Shutterstock CSV button in platform upload section
                const sstCsvBtn = document.querySelector('.shutterstock-btn');
                if (sstCsvBtn) sstCsvBtn.disabled = !hasSuccessfulData;

                if (translateAllBtn) {
                    translateAllBtn.disabled = !hasSuccessfulData;
                }

                embedMetadataButton.disabled = !hasEmbeddableFiles;

                // New Export Buttons Logic
                const saveToFolderBtn = document.getElementById('saveToFolderButton');
                const shareFilesBtn = document.getElementById('shareFilesButton');
                const uploadToDriveBtn = document.getElementById('uploadToDriveButton');
                const ftpPushBtn = document.getElementById('ftpUploadButton');

                if (saveToFolderBtn) saveToFolderBtn.disabled = !hasEmbeddableFiles;
                if (shareFilesBtn) shareFilesBtn.disabled = !hasEmbeddableFiles;
                if (uploadToDriveBtn) uploadToDriveBtn.disabled = !hasEmbeddableFiles;
                if (ftpPushBtn) ftpPushBtn.disabled = !hasEmbeddableFiles;
            }
            function updatePromptButtonState(processed = 0, total = 0, completed = 0, errors = 0, isComplete = false) {
                const fileCount = uploadedFilesData.length;
                if (fileCount === 0) {
                    processAllPromptsButton.innerHTML = '<i class="icon-process"></i> Process Prompts';
                    processAllPromptsButton.disabled = true;
                    return;
                }

                const unprocessedFiles = uploadedFilesData.filter(f => !f.prompt).length;
                processAllPromptsButton.disabled = unprocessedFiles === 0 && !isComplete;

                if (isComplete) {
                    processAllPromptsButton.innerHTML = `<i class="icon-check"></i> ${getTrans('complete')}: ${completed} ${getTrans('success')}, ${errors} ${getTrans('fail')}`;
                    processAllPromptsButton.style.background = errors === 0 ? 'linear-gradient(90deg, #10B981 60%, #059669 100%)' : 'linear-gradient(90deg, #F97316 60%, #ea580c 100%)';
                } else if (processed > 0) {
                    processAllPromptsButton.innerHTML = `<i class="icon-spinner"></i> ${getTrans('processing')} ${processed}/${total} | ✓ ${completed} / ✕ ${errors}`;
                    processAllPromptsButton.disabled = true;
                } else {
                    processAllPromptsButton.innerHTML = `<i class="icon-process"></i> ${getTrans('process')} ${unprocessedFiles} ${getTrans('prompts')}`;
                }
            }


            const PROHIBITED_WORDS = {
                shutterstock: ["exclusive", "shutterstock"],
                adobe: ["exclusive", "adobe stock", "adobe"],
                Magnific: ["premium", "exclusive", "Magnific"],
                vecteezy: ["exclusive", "vecteezy"],
            };

            // JS - Spam Shield Detection Logic (Pro Feature)
            function checkSpamDuplicates(currentFileData, cardElement, isPaidPlan) {
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

            // JS - Updated generateMetadata Function supporting Mistral
            async function generateMetadata(fileData) {
                const card = document.getElementById(fileData.id);
                const spinner = card.querySelector('.image-spinner');
                const metaCol = card.querySelector('.card-meta-col');
                const metaTitle = card.querySelector('.meta-title');
                const metaDescription = card.querySelector('.meta-description');
                const metaKeywords = card.querySelector('.meta-keywords');
                const descSection = document.getElementById(`desc-section-${card.id}`);
                const styleSection = document.getElementById(`style-section-${card.id}`);
                const moodSection = document.getElementById(`mood-section-${card.id}`);

                // New selectors for container
                const metaStyleContainer = card.querySelector('.meta-style-container');
                const metaMoodContainer = card.querySelector('.meta-mood-container');

                card.classList.add('processing');
                spinner.style.display = 'block';
                metaCol.style.display = 'none';

                const selectedProvider = document.getElementById('aiProviderSelect')?.value || 'groq';

                const minTitle = document.getElementById('minTitleWords')?.value || 10;
                const maxTitle = document.getElementById('maxTitleWords')?.value || 20;
                const minKeywords = document.getElementById('minKeywords')?.value || 35;
                const maxKeywords = document.getElementById('maxKeywords')?.value || 45;
                const minDesc = document.getElementById('minDescWords')?.value || 30;
                const maxDesc = document.getElementById('maxDescWords')?.value || 50;

                const activePlatforms = [...document.querySelectorAll('.platform-button.active')].map(btn => btn.dataset.platform);
                const noDescriptionMode = activePlatforms.includes('adobe') || activePlatforms.includes('Magnific');
                const addSilhouette = document.getElementById('toggleSilhouette')?.checked || false;
                const vectorMode = document.getElementById('toggleVectorMode')?.checked || false;
                const addWhiteBg = document.getElementById('toggleWhiteBg')?.checked || false;
                const addTransparentBg = document.getElementById('toggleTransparentBg')?.checked || false;
                const useTrendingTags = document.getElementById('toggleTrendingTags')?.checked || false;
                const useProhibitedWordsFilter = document.getElementById('toggleProhibitedWords')?.checked || false;
                const singleWordKeywords = document.getElementById('toggleSingleWordKeywords')?.checked || false;
                const useCustomPrompt = document.getElementById('toggleCustomPrompt')?.checked || false;
                const customPromptText = document.getElementById('customPromptText')?.value?.trim() || "";
                const shouldChangeFileName = document.getElementById('toggleChangeFileName')?.checked || false;
                const useFileNameAsTitle = document.getElementById('toggleFileNameAsTitle')?.checked || false;

                let promptText;
                const isCustomTitle = useCustomPrompt && customPromptText;

                if (isCustomTitle) {
                    let jsonFields = '"keywords"';
                    let descriptionPromptSegment = '';
                    if (!noDescriptionMode) {
                        jsonFields += ', "description"';
                        descriptionPromptSegment = `\n- Description: Generate a concise description STRICTLY between ${minDesc} and ${maxDesc} words. Do not exceed this limit.`;
                    }
                    let keywordsPromptSegment = `Generate between ${minKeywords} and ${maxKeywords} SEO-friendly keywords based on the subject: "${customPromptText}". Format the output as a JSON array of objects, where each object has a "keyword" (string) and a "score" (integer 0-100 reflecting stock photo potential/relevance). Example: "keywords": [{"keyword": "sunset", "score": 95}, ...]`;
                    if (singleWordKeywords) {
                        keywordsPromptSegment = `Only generate single-word, SEO-friendly keywords (no phrases) for the subject: "${customPromptText}". Generate between ${minKeywords} and ${maxKeywords} keywords. Format as a JSON array of objects with "keyword" and "score".`;
                    }

                    // Vector Mode additions
                    let vectorModeInstructions = '';
                    if (vectorMode) {
                        vectorModeInstructions = `\n\nIMPORTANT - VECTOR MODE:\n- This is a vector illustration or logo.\n- Keywords MUST include: "vector illustration", "eps", "svg".\n- Detect and include style keywords like: "flat", "line art", "silhouette", "outline", "minimalist vector".\n- If the image has a plain background, describe it as "isolated on white background".`;
                    }

                    promptText = `Generate metadata for the subject: "${customPromptText}".\nFormat the output strictly as a JSON object with the keys: ${jsonFields}, "style", "mood", "rejection_prediction", "requires_model_release", "requires_property_release", "is_ai_generated".\n- Keywords: ${keywordsPromptSegment}${descriptionPromptSegment}\n- Style: Detect the photographic style.\n- Mood: Detect the mood of the image.${vectorModeInstructions}\n- Rejection Prediction: Analyze technical quality. Estimate the probability of likely rejection based on technical standards (0-100).\n- requires_model_release: true if the image contains recognizable people/faces, false otherwise.\n- requires_property_release: true if the image contains recognizable private properties, brands, logos, false otherwise.\n- is_ai_generated: true if AI-generated artwork, false otherwise.`;
                } else {
                    let titleAddons = [];
                    if (addSilhouette) titleAddons.push("Silhouette");
                    const titleAddonString = titleAddons.length > 0 ? ` Must include the words: "${titleAddons.join(', ')}".` : '';

                    let jsonFields = '"title", "keywords"';
                    let descriptionPromptSegment = '';
                    if (!noDescriptionMode) {
                        jsonFields += ', "description"';
                        descriptionPromptSegment = `\n- Description: Generate a detailed description STRICTLY between ${minDesc} and ${maxDesc} words. Do not exceed ${maxDesc} words.`;
                    }
                    let keywordsPromptSegment = `Generate EXACTLY between ${minKeywords} and ${maxKeywords} SEO-friendly keywords. Format the output as a JSON array of objects, where each object has a "keyword" (string) and a "score" (integer 0-100 reflecting stock photo potential).`;
                    if (singleWordKeywords) {
                        keywordsPromptSegment = `Only generate single-word, SEO-friendly keywords (no phrases). Generate EXACTLY between ${minKeywords} and ${maxKeywords} keywords. Format as a JSON array of objects with "keyword" and "score".`;
                    }

                    let vectorModeInstructions = '';
                    if (vectorMode) {
                        vectorModeInstructions = `\n\nIMPORTANT - VECTOR MODE:\n- This is a vector illustration or logo.\n- Keywords MUST include: "vector illustration", "eps", "svg".\n- Detect and include style keywords like: "flat", "line art", "silhouette", "outline", "minimalist vector".\n- If the image has a plain background, describe it as "isolated on white background".`;
                    }
                    
                    // --- 🔥 PROMPT FIX FOR CUSTOMIZATION & SEO SCORE ---
                    promptText = `Analyze this image and generate highly commercial metadata.\nFormat the output strictly as a JSON object with the keys: ${jsonFields}, "style", "mood", "rejection_prediction", "shutterstock_category", "requires_model_release", "requires_property_release", "is_ai_generated".\n- Title: Generate a highly commercial, SEO-optimized stock photo title. You MUST limit the title strictly between ${minTitle} and ${maxTitle} words. Keep it concise (Ideally 40-70 characters) to maximize SEO score. It MUST include the main subject, Action, and the detected Style and Mood. Do not use colons (:).${titleAddonString}\n- Keywords: ${keywordsPromptSegment}${descriptionPromptSegment}\n- Style: Detect the photographic style (e.g., Cinematic, Minimalist, Vintage).\n- Mood: Detect the mood of the image (e.g., Happy, Melancholic, Energetic).${vectorModeInstructions}\n- Rejection Prediction: Analyze technical quality (focus, lighting, noise, artifacts) for stock photography usage. Estimate probability of rejection (0-100) as integer in 'rejection_prediction'.\n- requires_model_release: true if the image contains recognizable people/faces, false otherwise.\n- requires_property_release: true if the image contains recognizable private properties, modern architecture, brands, logos, or artworks, false otherwise.\n- is_ai_generated: true if the image appears to be an AI-generated artwork (e.g., Midjourney, DALL-E) rather than a real photograph, false otherwise.\n- shutterstock_category: Pick the SINGLE most fitting Shutterstock category from this exact list: Abstract, Animals/Wildlife, Arts, Backgrounds/Textures, Beauty/Fashion, Buildings/Landmarks, Business/Finance, Celebrities, Education, Food and Drink, Healthcare/Medical, Holidays, Industrial, Interiors, Miscellaneous, Nature, Objects, Parks/Outdoor, People, Religion, Science, Signs/Symbols, Sports/Recreation, Technology, Transportation, Vintage. Return only the category name as a string.`;
                }

                // --- PLAN CHECK LOGIC (Firebase) ---
                const user = auth.currentUser;
                let dbPlan = "free";
                let accessToken = "";
                if (user) {
                    try {
                        accessToken = await user.getIdToken();
                        const profileDoc = await db.collection('users').doc(user.email.toLowerCase()).get();
                        const profileData = profileDoc.exists ? profileDoc.data() : null;
                        dbPlan = (profileData?.plan || '').toLowerCase();
                    } catch (e) { console.warn('Plan check failed:', e); }
                }

                if (dbPlan !== 'pro' && dbPlan !== 'premium' && dbPlan !== 'agency') dbPlan = 'free';
                const isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium' || dbPlan === 'agency');
                const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";

                // --- ADVANCED VIDEO & SHORT VIDEO PROMPT ENHANCEMENT ---
                if (fileData.isVideo) {
                    // Update main prompt context
                    promptText = promptText.replace(/Analyze this image/g, "Analyze this stock video footage (represented by a keyframe)");
                    promptText = promptText.replace(/this image/g, "this video clip");

                    const isShort = fileData.isVertical || fileData.name.toLowerCase().includes('short') || fileData.name.toLowerCase().includes('reel') || fileData.name.toLowerCase().includes('tiktok');
                    const orientationTag = isShort ? "VERTICAL (9:16) SHORT VIDEO FORMAT" : "HORIZONTAL (16:9) VIDEO FORMAT";

                    // Add advanced video-specific instructions
                    const videoInstructions = `\n\nIMPORTANT - ADVANCED VIDEO MODE (${orientationTag}):
- This is a stock video/footage clip. Analyze the keyframe to determine the action, subject, lighting, and cinematic feel.
- You MUST include general video keywords: "footage", "video", "stock footage", "motion", "clip", "b-roll".
${isShort ? '- Since this is a SHORT/VERTICAL video, heavily prioritize keywords for social media algorithms: "shorts", "reels", "tiktok", "vertical", "social media", "mobile format", "trendy".' : '- Include high-quality cinematic keywords if applicable: "cinematic", "4k", "high definition", "widescreen".'}
- The Title MUST be highly engaging, descriptive, and optimized for video buyers. Describe the motion or action vividly (e.g., "Dynamic slow motion of...", "Aerial drone footage of...", "POV shot of...").
- Keep the title SEO-friendly for video searches and ensure keywords accurately describe what is happening in the scene.`;

                    promptText += videoInstructions;
                }

                if (useTrendingTags) {
                    promptText += `\n\nIMPORTANT - TRENDING TAGS: Act as a stock photography data fetcher. Analyze current trending data for this visual category on Shutterstock and Adobe Stock. Prioritize and inject the most downloaded, highest-selling tags related to this asset strongly into the "keywords" array to maximize commercial sales.`;
                }

                // --- NEW: Advanced Metadata Prompt Enhancement (PRO/PREMIUM ONLY) ---
                if (isPaidPlan) {
                    let advancedInstructions = `\n\nIMPORTANT - ADVANCED INSIGHTS:\nAdditionally, provide the following fields in the same JSON object:\n- "commercial_use_cases": Array of 3-5 strings suggesting specific commercial uses (e.g., "website hero banner", "travel brochure").\n- "target_audience": A string describing the ideal market segment or buyer for this image.\n- "color_palette": Analyze dominant colors and provide an array of objects, e.g., [{"hex": "#FF5733", "name": "Vibrant Orange"}]. Max 4 colors.\n- "seo_title_variations": Array of 3 alternative SEO titles (strings) for A/B testing.\n- "long_tail_keywords": Array of 10 long-tail keyword phrases (strings, 3-5 words each).\n- "editorial_caption": A string containing a professional editorial caption suitable for news or publishing.\n- "trending_score": Extract an integer (0-100) reflecting how trendy or in-demand this visual subject is right now.`;

                    // Inject the new fields into the structure checking instruction
                    promptText = promptText.replace('"requires_property_release", "is_ai_generated"', '"requires_property_release", "is_ai_generated", "commercial_use_cases", "target_audience", "color_palette", "seo_title_variations", "long_tail_keywords", "editorial_caption", "trending_score"');
                    promptText += advancedInstructions;
                }


                let base64Image, mimeType;
                let fileToProcess = fileData.fileObject;

                if (fileData.isAiFile) {
                    if (fileData.previewFile) {
                        fileToProcess = fileData.previewFile;
                    } else {
                        throw new Error("AI file preview not available. Cannot analyze.");
                    }
                }

                mimeType = fileToProcess.type;

                if (mimeType === 'image/svg+xml') {
                    const pngDataUrl = await window.svgFileToPngDataUrl(fileToProcess, 512, 512);
                    base64Image = pngDataUrl.split(',')[1];
                    mimeType = 'image/png';
                } else {
                    // Resize image if needed (especially for Groq which has pixel limits)
                    // We'll use a max dimension of 2048px which is safe for most Vision APIs
                    // Resize image to 1024px for faster processing with all AI models (Gemini, Groq, Mistral)
                    const MAX_DIMENSION = 800;

                    base64Image = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            const img = new Image();
                            img.onload = () => {
                                let width = img.width;
                                let height = img.height;

                                // Resize if larger than max dimension
                                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                                    if (width > height) {
                                        height *= MAX_DIMENSION / width;
                                        width = MAX_DIMENSION;
                                    } else {
                                        width *= MAX_DIMENSION / height;
                                        height = MAX_DIMENSION;
                                    }

                                    const canvas = document.createElement('canvas');
                                    canvas.width = width;
                                    canvas.height = height;
                                    const ctx = canvas.getContext('2d');
                                    ctx.drawImage(img, 0, 0, width, height);

                                    // High quality JPEG for API
                                    resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
                                    mimeType = 'image/jpeg'; // Update mimetype to JPEG after resize
                                } else {
                                    // Use original if small enough
                                    resolve(e.target.result.split(',')[1]);
                                }
                            };
                            img.onerror = reject;
                            img.src = e.target.result;
                        };
                        reader.onerror = error => reject(error);
                        reader.readAsDataURL(fileToProcess);
                    });
                }

                let generatedText = "";
                let lastError = null;

                try {
                    // Retry configuration with Exponential Backoff
                    const maxRetries = 3;
                    let attempt = 0;
                    let fetchSuccess = false;
                    let data = null;
                    let response = null;

                    while (attempt <= maxRetries && !fetchSuccess) {
                        try {
                            response = await fetch(proxyUrl, {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    "Authorization": `Bearer ${accessToken}`
                                },
                                body: JSON.stringify({
                                    action: "generate",
                                    image: base64Image,
                                    mimeType: mimeType,
                                    prompt: promptText,
                                    provider: selectedProvider,
                                    email: user?.email || "unknown",
                                    deviceInfo: navigator.userAgent,
                                    plan: dbPlan
                                })
                            });

                            data = await response.json();

                            if (!response.ok) {
                                if (response.status === 429) {
                                    showLimitModal(data.error);
                                    throw new Error("Daily limit reached");
                                }
                                throw new Error(`API Error: ${data.error || response.statusText}`);
                            }
                            fetchSuccess = true;
                        } catch (err) {
                            lastError = err;
                            if (err.message === "Daily limit reached") {
                                break; // Stop retrying immediately on limit reach
                            }
                            attempt++;
                            if (attempt <= maxRetries) {
                                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
                                console.warn(`Generation attempt ${attempt} failed. Retrying in ${Math.round(delay)}ms... Error: ${err.message}`);
                                await new Promise(r => setTimeout(r, delay));
                            }
                        }
                    }

                    if (!fetchSuccess) {
                        throw lastError || new Error("Failed to generate AI response after multiple attempts.");
                    }

                    // Update trial UI if applicable
                    if (data && data.newCount !== undefined && window.trialUsage) {
                        window.trialUsage.count = data.newCount;
                        if (typeof updateTrialUI === 'function') updateTrialUI();
                    }

                    // Parse according to the expected proxy output
                    if (data.metadata) {
                        generatedText = typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata);
                    } else if (data.text) {
                        generatedText = data.text;
                    } else if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
                        generatedText = data.candidates[0].content.parts[0].text;
                    } else if (data.choices && data.choices[0] && data.choices[0].message) {
                        generatedText = data.choices[0].message.content;
                    } else {
                        generatedText = JSON.stringify(data);
                    }

                    // Robust JSON Parsing with Error Handling
                    let metadata;
                    try {
                        // Step 1: Remove markdown code blocks
                        let cleanedJsonString = generatedText.replace(/^```json\s*|```$/g, '').trim();

                        // Step 2: Remove any leading/trailing text that's not JSON
                        const jsonStart = cleanedJsonString.indexOf('{');
                        const jsonEnd = cleanedJsonString.lastIndexOf('}');
                        if (jsonStart !== -1 && jsonEnd !== -1) {
                            cleanedJsonString = cleanedJsonString.substring(jsonStart, jsonEnd + 1);
                        }

                        // Step 3: Try parsing
                        if (
                            !cleanedJsonString ||
                            !cleanedJsonString.trim().startsWith("{")
                        ) {
                            throw new Error("AI did not return valid JSON");
                        }

                        metadata = JSON.parse(cleanedJsonString);

                    } catch (parseError) {
                        console.error('JSON Parse Error:', parseError);
                        console.log('Raw response:', generatedText);

                        // Fallback: Try to extract JSON more aggressively
                        try {
                            let cleanedJsonString = generatedText
                                .replace(/^```json\s*/gm, '')
                                .replace(/```\s*$/gm, '')
                                .replace(/^[^{]*/, '') // Remove everything before first {
                                .replace(/[^}]*$/, ''); // Remove everything after last }

                            // Fix common JSON issues
                            cleanedJsonString = cleanedJsonString
                                .replace(/[\n\t]/g, ' ') // Replace newlines/tabs with spaces
                                .replace(/\s+/g, ' ') // Normalize whitespace
                                .replace(/,\s*}/g, '}') // Remove trailing commas
                                .replace(/,\s*]/g, ']'); // Remove trailing commas in arrays

                            metadata = JSON.parse(cleanedJsonString)

                            console.log('Successfully parsed with fallback method');

                        } catch (fallbackError) {
                            throw new Error(`Failed to parse AI response as JSON. Error: ${parseError.message}. Response: ${generatedText.substring(0, 200)}...`);
                        }
                    }

                    // Custom Title Override
                    if (isCustomTitle) { metadata.title = customPromptText; }

                    // File Name as Title Logic
                    if (useFileNameAsTitle) {
                        // Extension remove logic
                        const nameWithoutExt = fileData.name.substring(0, fileData.name.lastIndexOf('.')) || fileData.name;
                        metadata.title = nameWithoutExt;
                    }

                    // --- 🔥 FIX: STRICTLY ENFORCE CUSTOMIZATION SLIDER LIMITS ---
                    // 1. Force Trim Title if it exceeds user's Max Title Words
                    if (!isCustomTitle && metadata.title) {
                        let titleWords = metadata.title.split(/\s+/);
                        if (titleWords.length > maxTitle) {
                            metadata.title = titleWords.slice(0, maxTitle).join(' ');
                            // Remove any trailing commas or hyphens after trim
                            metadata.title = metadata.title.replace(/[, \-]+$/, '');
                        }
                    }

                    // 2. Force Trim Description if it exceeds user's Max Desc Words
                    if (metadata.description) {
                        let descWords = metadata.description.split(/\s+/);
                        if (descWords.length > maxDesc) {
                            metadata.description = descWords.slice(0, maxDesc).join(' ') + '.';
                        }
                    }
                   

                    // Title Addons
                    let finalTitle = metadata.title || "";
                    if (addWhiteBg && !finalTitle.toLowerCase().includes("white background")) finalTitle += " isolated on White Background";
                    if (addTransparentBg && !finalTitle.toLowerCase().includes("transparent background")) finalTitle += " isolated on Transparent Background";
                    metadata.title = finalTitle.replace(/,$/, '').trim();

                    // Ensure Advanced Metadata mappings
                    if (isPaidPlan) {
                        fileData.commercial_use_cases = metadata.commercial_use_cases || [];
                        fileData.target_audience = metadata.target_audience || "";
                        fileData.color_palette = metadata.color_palette || [];
                        fileData.seo_title_variations = metadata.seo_title_variations || [];
                        fileData.long_tail_keywords = metadata.long_tail_keywords || [];
                        fileData.editorial_caption = metadata.editorial_caption || "";
                        fileData.trending_score = metadata.trending_score || 0;
                    }

                    // Prohibited Words Filter
                    if (useProhibitedWordsFilter) {
                        let allProhibited = new Set();
                        activePlatforms.forEach(p => {
                            if (PROHIBITED_WORDS[p]) PROHIBITED_WORDS[p].forEach(word => allProhibited.add(word.toLowerCase()));
                        });
                        if (allProhibited.size > 0) {
                            const regex = new RegExp(`\\b(${[...allProhibited].join('|')})\\b`, 'gi');
                            if (metadata.title) metadata.title = metadata.title.replace(regex, '').replace(/\s\s+/g, ' ').trim();
                            if (metadata.keywords) {
                                const filteredKeywords = metadata.keywords.split(',').map(k => k.trim()).filter(k => !allProhibited.has(k.toLowerCase()));
                                metadata.keywords = filteredKeywords.join(', ');
                            }
                        }
                    }

                    // Change File Name
                    if (shouldChangeFileName && metadata.title) {
                        const originalExtension = fileData.name.slice(fileData.name.lastIndexOf('.'));
                        const sanitizedTitle = metadata.title.replace(/[\\/:*?"<>|]/g, '_').trim();
                        const newFileName = sanitizedTitle + originalExtension;
                        fileData.name = newFileName;
                        const cardFileNameElement = card.querySelector('.card-filename');
                        if (cardFileNameElement) cardFileNameElement.textContent = newFileName;
                    }

                    // Update fileData with generated metadata
                    fileData.title = metadata.title;

                    // Handle Keyword Scores (New Logic)
                    // --- FIXED KEYWORD PROCESSING LOGIC ---
                    if (Array.isArray(metadata.keywords)) {
                        const keywordsList = [];
                        fileData.keywordScores = {};

                        metadata.keywords.forEach(item => {
                            // Safe checking if item and keyword exist and are strings
                            if (typeof item === 'object' && item !== null && item.keyword && typeof item.keyword === 'string') {
                                const kw = item.keyword.toLowerCase().trim();
                                keywordsList.push(kw);
                                fileData.keywordScores[kw] = item.score || 0;
                            } else if (typeof item === 'string') {
                                const kw = item.toLowerCase().trim();
                                keywordsList.push(kw);
                            }
                        });
                        fileData.keywords = keywordsList.join(', ');
                        metadata.keywords = fileData.keywords;
                    } else if (typeof metadata.keywords === 'string') {
                        fileData.keywords = metadata.keywords;
                        fileData.keywordScores = {};
                    } else {
                        // Fallback if keywords are missing or invalid
                        fileData.keywords = "";
                        fileData.keywordScores = {};
                    }

                    fileData.description = metadata.description;
                    fileData.style = metadata.style;
                    fileData.mood = metadata.mood;

                    // Store AI-detected Shutterstock category
                    fileData.category = metadata.shutterstock_category || '';

                    // Map to Adobe Stock Category and update UI
                    const adobeCatName = mapShutterstockToAdobe(fileData.category);
                    fileData.adobeCategory = adobeCatName;
                    const aiCategorySelect = document.getElementById(`ai-category-${card.id}`);
                    if (aiCategorySelect) {
                        aiCategorySelect.value = adobeCatName;
                    }

                    // Update UI Elements
                    metaTitle.textContent = metadata.title;

                    // Initial Keyword Display with Remove Buttons
                    updateKeywordsDisplay(card.id);

                    if (metadata.description && !noDescriptionMode) {
                        metaDescription.textContent = metadata.description;
                        if (descSection) descSection.style.display = 'block';
                    } else {
                        metaDescription.textContent = '';
                        if (descSection) descSection.style.display = 'none';
                    }

                    if (metadata.style) {
                        // Apply badge style
                        metaStyleContainer.innerHTML = `<span class="visual-tag style-tag">${metadata.style}</span>`;
                        if (styleSection) styleSection.style.display = 'flex'; // Changed to flex for new CSS
                    } else {
                        if (styleSection) styleSection.style.display = 'none';
                    }

                    if (metadata.mood) {
                        // Apply badge style
                        metaMoodContainer.innerHTML = `<span class="visual-tag mood-tag">${metadata.mood}</span>`;
                        if (moodSection) moodSection.style.display = 'flex'; // Changed to flex
                    } else {
                        if (moodSection) moodSection.style.display = 'none';
                    }

                    // --- Render Advanced Insights Panel (PRO/PREMIUM Only) ---
                    if (isPaidPlan) {
                        let advancedPanel = card.querySelector('.advanced-insights-panel');
                        const hasAdvancedData = fileData.trending_score || fileData.commercial_use_cases?.length || fileData.target_audience || fileData.seo_title_variations?.length || fileData.long_tail_keywords?.length || fileData.editorial_caption || fileData.color_palette?.length;

                        if (hasAdvancedData) {
                            if (!advancedPanel) {
                                advancedPanel = document.createElement('div');
                                advancedPanel.className = 'advanced-insights-panel';
                                advancedPanel.innerHTML = `
                                    <div class="advanced-insights-header" onclick="const c = this.nextElementSibling; c.style.display = c.style.display === 'none' ? 'flex' : 'none'">
                                        <span><i class="fas fa-bolt"></i> Advanced Insights (Pro)</span>
                                        <i class="fas fa-chevron-down"></i>
                                    </div>
                                    <div class="advanced-insights-content" style="display: none;"></div>
                                `;
                                // Insert at the end of metaCol
                                metaCol.appendChild(advancedPanel);
                            }

                            const panelContent = advancedPanel.querySelector('.advanced-insights-content');
                            let contentHTML = '';

                            if (fileData.trending_score) {
                                contentHTML += `<div class="insight-item"><div class="insight-label"><span>📈 Trending Score</span></div><div class="insight-value"><div style="background:var(--bg-input); width:100%; height:8px; border-radius:4px; margin-top:5px; overflow:hidden;"><div style="background:linear-gradient(90deg, #8B5CF6, #EC4899); width:${fileData.trending_score}%; height:100%;"></div></div><div style="font-size:0.8em; margin-top:4px; text-align:right;">${fileData.trending_score}/100</div></div></div>`;
                            }

                            const escapeStr = (str) => (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

                            if (fileData.commercial_use_cases && fileData.commercial_use_cases.length > 0) {
                                const val = fileData.commercial_use_cases.join(', ');
                                contentHTML += `<div class="insight-item"><div class="insight-label"><span>💼 Commercial Use Cases</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeStr(val)}'); this.innerHTML='<i class=\\'icon-check\\'></i> Copied'"><i class="icon-copy"></i> Copy</button></div><div class="insight-value">${val}</div></div>`;
                            }

                            if (fileData.target_audience) {
                                contentHTML += `<div class="insight-item"><div class="insight-label"><span>🎯 Target Audience</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeStr(fileData.target_audience)}'); this.innerHTML='<i class=\\'icon-check\\'></i> Copied'"><i class="icon-copy"></i> Copy</button></div><div class="insight-value">${fileData.target_audience}</div></div>`;
                            }

                            if (fileData.seo_title_variations && fileData.seo_title_variations.length > 0) {
                                const titlesHtml = fileData.seo_title_variations.map(t => `<div style="margin-bottom:4px;">• ${t}</div>`).join('');
                                const val = fileData.seo_title_variations.join('\\n');
                                contentHTML += `<div class="insight-item"><div class="insight-label"><span>📝 A/B Title Variations</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeStr(val)}'); this.innerHTML='<i class=\\'icon-check\\'></i> Copied'"><i class="icon-copy"></i> Copy</button></div><div class="insight-value">${titlesHtml}</div></div>`;
                            }

                            if (fileData.long_tail_keywords && fileData.long_tail_keywords.length > 0) {
                                const val = fileData.long_tail_keywords.join(', ');
                                contentHTML += `<div class="insight-item"><div class="insight-label"><span>🔑 Long-tail Keywords</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeStr(val)}'); this.innerHTML='<i class=\\'icon-check\\'></i> Copied'"><i class="icon-copy"></i> Copy</button></div><div class="insight-value">${val}</div></div>`;
                            }

                            if (fileData.editorial_caption) {
                                contentHTML += `<div class="insight-item"><div class="insight-label"><span>📰 Editorial Caption</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeStr(fileData.editorial_caption)}'); this.innerHTML='<i class=\\'icon-check\\'></i> Copied'"><i class="icon-copy"></i> Copy</button></div><div class="insight-value">${fileData.editorial_caption}</div></div>`;
                            }

                            if (fileData.color_palette && fileData.color_palette.length > 0) {
                                const swatches = fileData.color_palette.map(c => `<span class="color-swatch" style="background:${c.hex || c.color};" title="${c.name || c.hex || c.color}"></span>`).join('');
                                const colorNames = fileData.color_palette.map(c => c.name || c.hex || c.color).join(', ');
                                contentHTML += `<div class="insight-item"><div class="insight-label"><span>🎨 Color Palette</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${escapeStr(colorNames)}'); this.innerHTML='<i class=\\'icon-check\\'></i> Copied'"><i class="icon-copy"></i> Copy</button></div><div class="insight-value"><div class="color-swatch-container">${swatches}</div><div style="font-size:0.85em; margin-top:5px; color:var(--text-muted);">${colorNames}</div></div></div>`;
                            }

                            panelContent.innerHTML = contentHTML;
                        }
                    }

                    // Update Rejection Predictor
                    const rejectionMeter = document.getElementById(`rejection-meter-${card.id}`);
                    if (rejectionMeter && metadata.rejection_prediction !== undefined) {
                        const rejectionScore = parseInt(metadata.rejection_prediction) || 0;
                        const rejectionBadge = document.getElementById(`rejection-badge-${card.id}`);
                        const rejectionProgress = document.getElementById(`rejection-progress-${card.id}`);

                        const rejectionLock = document.getElementById(`rejection-lock-${card.id}`);

                        rejectionMeter.style.display = 'block';

                        // Check Plan and Apply Blur
                        if (!isPaidPlan) {
                            rejectionMeter.classList.add('pro-feature-locked');
                            if (rejectionLock) rejectionLock.style.display = 'flex';
                        } else {
                            rejectionMeter.classList.remove('pro-feature-locked');
                            if (rejectionLock) rejectionLock.style.display = 'none';
                        }

                        rejectionBadge.textContent = `${rejectionScore}%`;
                        rejectionProgress.style.width = `${rejectionScore}%`;

                        // Remove old classes
                        rejectionBadge.classList.remove('rejection-low', 'rejection-medium', 'rejection-high');
                        rejectionProgress.classList.remove('fill-low', 'fill-medium', 'fill-high');

                        // Set colors based on risk
                        if (rejectionScore < 30) {
                            rejectionBadge.classList.add('rejection-low');
                            rejectionProgress.classList.add('fill-low');
                        } else if (rejectionScore < 70) {
                            rejectionBadge.classList.add('rejection-medium');
                            rejectionProgress.classList.add('fill-medium');
                        } else {
                            rejectionBadge.classList.add('rejection-high');
                            rejectionProgress.classList.add('fill-high');
                        }
                    }

                    // --- Update Platform Approval Chance ---
                    const approvalChanceContainer = document.getElementById(`approval-chance-container-${card.id}`);
                    if (approvalChanceContainer && metadata.rejection_prediction !== undefined) {
                        const rejectionScore = parseInt(metadata.rejection_prediction) || 0;
                        const approvalBase = 100 - rejectionScore;

                        // প্রতিটি প্ল্যাটফর্মের জন্য তাদের গাইডলাইন অনুযায়ী ডাইনামিক হিসাব
                        // ১. Adobe Stock (কোয়ালিটি এবং আইপি রেগুলেশনে অত্যন্ত কঠোর)
                        const adobeChance = Math.max(0, Math.min(100, Math.round(approvalBase * 0.96)));

                        // ২. Shutterstock (টাইটেল এবং মেটাডেটা কি-ওয়ার্ড স্প্যামিংয়ের ওপর ভিত্তি করে)
                        const totalKeywords = (metadata.keywords || "").split(',').length;
                        let shutterPenalty = totalKeywords < 20 ? 5 : 0;
                        const shutterChance = Math.max(0, Math.min(100, Math.round(approvalBase - shutterPenalty)));

                        // ৩. Freepik (নান্দনিক সৌন্দর্য এবং কমার্শিয়াল ডিমান্ডে অত্যন্ত কঠোর)
                        const freepikChance = Math.max(0, Math.min(100, Math.round(approvalBase * 0.92)));

                        // মোডাল প্রদর্শন
                        approvalChanceContainer.style.display = 'block';

                        // ফ্রি এবং পেইড ইউজার লক ফিচার কন্ট্রোল
                        const approvalLock = document.getElementById(`approval-lock-${card.id}`);
                        if (!isPaidPlan) {
                            approvalChanceContainer.classList.add('pro-feature-locked');
                            if (approvalLock) approvalLock.style.display = 'flex';
                        } else {
                            approvalChanceContainer.classList.remove('pro-feature-locked');
                            if (approvalLock) approvalLock.style.display = 'none';
                        }

                        // ইউআই-তে ডেটা এবং কালার সেট করা
                        const setChanceUI = (elementId, score) => {
                            const el = document.getElementById(elementId);
                            if (el) {
                                el.textContent = `${score}%`;
                                if (score >= 80) el.style.color = '#10B981'; // Green
                                else if (score >= 50) el.style.color = '#F59E0B'; // Yellow
                                else el.style.color = '#EF4444'; // Red
                            }
                        };

                        setChanceUI(`adobe-chance-${card.id}`, adobeChance);
                        setChanceUI(`shutter-chance-${card.id}`, shutterChance);
                        setChanceUI(`freepik-chance-${card.id}`, freepikChance);
                    }

                    // Update Release Predictor
                    const releaseReqContainer = document.getElementById(`release-req-${card.id}`);
                    if (releaseReqContainer && (metadata.requires_model_release !== undefined || metadata.requires_property_release !== undefined)) {
                        releaseReqContainer.style.display = 'block';

                        if (!isPaidPlan) { // যদি ইউজার ফ্রি হয়
                            releaseReqContainer.classList.add('pro-feature-locked');
                            if (!releaseReqContainer.querySelector('.locked-overlay')) {
                                const lockDiv = document.createElement('div');
                                lockDiv.className = 'locked-overlay';
                                lockDiv.innerHTML = '<div class="lock-icon" title="Pro Feature">🔒</div>';
                                lockDiv.onclick = () => showProUpgradeAlert(); // ক্লিক করলে আপগ্রেড মেসেজ দেখাবে
                                releaseReqContainer.appendChild(lockDiv);
                            }
                        } else {
                            releaseReqContainer.classList.remove('pro-feature-locked');
                            const lock = releaseReqContainer.querySelector('.locked-overlay');
                            if (lock) lock.remove();
                        }

                        const reqModel = document.getElementById(`req-model-${card.id}`);
                        const reqProperty = document.getElementById(`req-property-${card.id}`);
                        const uploadContainer = document.getElementById(`release-upload-container-${card.id}`);

                        let needsUpload = false;

                        const isAiGeneratedToggle = document.getElementById('toggleAiGenerated')?.checked || false;
                        const isAiImage = fileData.isAiGenerated ||
                            fileData.name.toLowerCase().includes('ai generated') ||
                            fileData.name.toLowerCase().includes('midjourney') ||
                            isAiGeneratedToggle ||
                            metadata.is_ai_generated === true;

                        if (metadata.requires_model_release) {
                            if (isAiImage) {
                                reqModel.innerHTML = '<span style="color:#3B82F6; font-weight:bold;">AI 🤖 (No)</span>';
                            } else {
                                reqModel.innerHTML = '<span style="color:#EF4444; font-weight:bold;">Yes ⚠️</span>';
                                needsUpload = true;
                            }
                        } else {
                            reqModel.innerHTML = '<span style="color:#10B981;">No</span>';
                        }

                        if (metadata.requires_property_release) {
                            if (isAiImage) {
                                reqProperty.innerHTML = '<span style="color:#3B82F6; font-weight:bold;">AI 🤖 (No)</span>';
                            } else {
                                reqProperty.innerHTML = '<span style="color:#EF4444; font-weight:bold;">Yes ⚠️</span>';
                                needsUpload = true;
                            }
                        } else {
                            reqProperty.innerHTML = '<span style="color:#10B981;">No</span>';
                        }

                        if (needsUpload) {
                            uploadContainer.style.display = 'block';
                        } else {
                            uploadContainer.style.display = 'none';
                        }
                    }


                    card.classList.remove('processing');
                    card.classList.add('metadata-generated');
                    spinner.style.display = 'none';
                    metaCol.style.display = 'flex';

                    // Calculate and update SEO Score Meter
                    const seoScore = calculateSeoScore(metadata);
                    updateSeoMeter(card.id, seoScore);

                    // Sort Keywords based on User Preference (High/Med/Low Weight)
                    if (metadata.keywords) {
                        metadata.keywords = reorderKeywords(metadata.keywords);
                    }

                    const isAiGeneratedToggle = document.getElementById('toggleAiGenerated')?.checked || false;

                    if (isAiGeneratedToggle) {
                        let kwArr = metadata.keywords.split(',').map(k => k.trim()).filter(Boolean);

                        kwArr = kwArr.filter(k => k.toLowerCase() !== "ai generated" && k.toLowerCase() !== "generative ai");

                        kwArr.unshift("ai generated", "generative ai");

                        metadata.keywords = kwArr.join(', ');

                        if (!fileData.keywordScores) fileData.keywordScores = {};
                        fileData.keywordScores["ai generated"] = 100;
                        fileData.keywordScores["generative ai"] = 100;
                    }

                    fileData.keywords = metadata.keywords;

                    metaTitle.textContent = metadata.title;
                    const clarityBtn = document.getElementById(`check-clarity-btn-${card.id}`);
                    if (clarityBtn && metadata.title) {
                        clarityBtn.style.display = 'inline-flex';
                    }
                    updateKeywordsDisplay(card.id);

                    // --- NEW: Update Counts ---
                    const titleCountElem = document.getElementById(`title-count-${card.id}`);
                    if (titleCountElem && metadata.title) {
                        const count = metadata.title.split(/\s+/).filter(w => w.length > 0).length;
                        titleCountElem.textContent = `(${count})`;
                    }

                    const descCountElem = document.getElementById(`desc-count-${card.id}`);
                    if (descCountElem && metadata.description) {
                        const count = metadata.description.split(/\s+/).filter(w => w.length > 0).length;
                        descCountElem.textContent = `(${count})`;
                    }

                    const keywordCountElem = document.getElementById(`keyword-count-${card.id}`);
                    if (keywordCountElem && metadata.keywords) {
                        const count = metadata.keywords.split(',').filter(k => k.trim()).length;
                        keywordCountElem.textContent = `(${count})`;
                    }

                    fileData.status = 'success';
                    if (typeof window.scheduleSessionSave === 'function') {
                        window.scheduleSessionSave();
                    }

                    // 📊 Update Usage Display (Instant local update)
                    if (window.userUsageData) {
                        window.userUsageData.count = (window.userUsageData.count || 0) + 1;
                        window.userUsageData.monthlyCount = (window.userUsageData.monthlyCount || 0) + 1;
                        try { updateUsageUI(); } catch (e) { console.warn('Usage UI update failed:', e); }
                    }

                    // --- Welcome Power-Pack: Track trial credit usage ---
                    if (window.trialPowerPack && window.trialPowerPack.active && window.trialPowerPack.used < window.trialPowerPack.total) {
                        window.trialPowerPack.used++;
                        if (typeof showTrialTip === 'function') showTrialTip(window.trialPowerPack.used, window.trialPowerPack.total);
                        if (typeof updateTrialProgressUI === 'function') updateTrialProgressUI();
                        if (window.trialPowerPack.used >= window.trialPowerPack.total) {
                            window.trialPowerPack.active = false;
                            if (typeof checkTrialEnded === 'function') checkTrialEnded();
                            if (typeof updateVisibility === 'function') updateVisibility();
                        }
                    }

                    // --- EPS Button Enabling ---
                    const epsBtn = document.getElementById(`btn-eps-${card.id}`);
                    if (epsBtn && window.userUsageData?.plan === 'premium') {
                        epsBtn.disabled = false;
                    }
                    checkBatchEpsButtonState();

                    // --- NEW: 4 Credits Warning Modal ---
                    if (window.userUsageData && window.userUsageData.limit) {
                        const remaining = window.userUsageData.limit - window.userUsageData.count;
                        if (remaining === 4 && !window.hasShownCreditWarning) {
                            window.hasShownCreditWarning = true;
                            const creditModal = document.getElementById('creditWarningModal');
                            if (creditModal) {
                                creditModal.style.display = 'flex';
                            }
                        }
                    }

                    // --- SPAM SHIELD CHECK (Pro Feature) ---
                    const spamShieldEnabled = document.getElementById('toggleSpamShield')?.checked || false;
                    if (spamShieldEnabled) {
                        checkSpamDuplicates(fileData, card, isPaidPlan);
                    }

                    return metadata;

                } catch (error) {
                    console.error("Generation Error:", error);
                    card.classList.remove('processing');
                    metaTitle.textContent = "Error";
                    metaDescription.textContent = error.message;
                    metaKeywords.innerHTML = '';
                    spinner.style.display = 'none';
                    metaCol.style.display = 'flex';
                    throw error;
                }
            }

            // SEO Score Calculation Function (Advanced)
            window.calculateSeoScore = function (metadata) {
                let score = 0;
                const maxScore = 100;
                let penalties = 0;
                let suggestions = []; // Each: { text, fixType }

                // 1. Title Length Score (Max 25)
                const title = (metadata.title || '').trim();
                const titleLength = title.length;
                if (titleLength >= 40 && titleLength <= 70) {
                    score += 25;
                } else if (titleLength >= 20 && titleLength < 40) {
                    score += 20;
                    suggestions.push({ text: "💡 Title is short (" + titleLength + " chars). Aim for 40-70 characters.", fixType: null });
                } else if (titleLength > 70 && titleLength <= 100) {
                    score += 20;
                    suggestions.push({ text: "💡 Title is too long (" + titleLength + " chars). Trim to under 70.", fixType: "trim_title" });
                } else if (titleLength > 100) {
                    score += 10;
                    suggestions.push({ text: "⚠️ Title is way too long (" + titleLength + " chars). Trim to 40-70.", fixType: "trim_title" });
                } else if (titleLength > 0) {
                    score += 10;
                    suggestions.push({ text: "⚠️ Title length is sub-optimal. Aim for 40-70 characters.", fixType: null });
                } else {
                    penalties += 10;
                    suggestions.push({ text: "❌ Missing Title.", fixType: null });
                }

                // 2. Description Length Score (Max 25)
                const desc = (metadata.description || '').trim();
                const descLength = desc.length;
                if (descLength >= 100 && descLength <= 160) {
                    score += 25;
                } else if (descLength >= 70 && descLength < 100) {
                    score += 20;
                    suggestions.push({ text: "💡 Description is short (" + descLength + " chars). Add detail (100-160 ideal).", fixType: null });
                } else if (descLength > 160 && descLength <= 250) {
                    score += 20;
                    suggestions.push({ text: "💡 Description is long (" + descLength + " chars). Trim to 100-160.", fixType: "trim_desc" });
                } else if (descLength > 250) {
                    score += 10;
                    suggestions.push({ text: "⚠️ Description is way too long (" + descLength + " chars).", fixType: "trim_desc" });
                } else if (descLength > 0) {
                    score += 10;
                    suggestions.push({ text: "⚠️ Description length is sub-optimal. Aim for 100-160.", fixType: null });
                } else {
                    penalties += 10;
                    suggestions.push({ text: "❌ Missing Description.", fixType: null });
                }

                // 3. Keyword Count & Mix Score (Max 50)
                const keywordsRaw = metadata.keywords || '';
                const keywordsArray = (typeof keywordsRaw === 'string' ? keywordsRaw : keywordsRaw.join(',')).split(',').map(k => k.trim()).filter(Boolean);
                const totalKeywords = keywordsArray.length;

                const singleWords = keywordsArray.filter(k => k.split(/\s+/).length === 1).length;
                const twoWords = keywordsArray.filter(k => k.split(/\s+/).length === 2).length;
                const multiWords = keywordsArray.filter(k => k.split(/\s+/).length >= 3).length;

                const pSingle = totalKeywords > 0 ? (singleWords / totalKeywords) * 100 : 0;
                const pTwo = totalKeywords > 0 ? (twoWords / totalKeywords) * 100 : 0;
                const pMulti = totalKeywords > 0 ? (multiWords / totalKeywords) * 100 : 0;

                if (totalKeywords >= 30) {
                    score += 20;
                } else if (totalKeywords >= 20) {
                    score += 15;
                    suggestions.push({ text: "💡 " + totalKeywords + " keywords. Aim for 30+ for max coverage.", fixType: null });
                } else if (totalKeywords >= 10) {
                    score += 10;
                    suggestions.push({ text: "⚠️ Only " + totalKeywords + " keywords. Add more to cover categories.", fixType: null });
                } else if (totalKeywords > 0) {
                    score += 5;
                    suggestions.push({ text: "⚠️ Very few keywords (" + totalKeywords + "). 25+ recommended.", fixType: null });
                } else {
                    penalties += 20;
                    suggestions.push({ text: "❌ Missing Keywords.", fixType: null });
                }

                let mixScore = 0;
                if (pSingle >= 20 && pSingle <= 50) { mixScore += 10; }
                else if (pSingle > 0 && pSingle < 80) { mixScore += 5; suggestions.push({ text: "💡 Balance single-word keywords (" + Math.round(pSingle) + "%, target 20-50%).", fixType: null }); }
                if (pTwo >= 30 && pTwo <= 60) { mixScore += 10; }
                else if (pTwo > 10) { mixScore += 5; suggestions.push({ text: "💡 Add more two-word phrases (" + Math.round(pTwo) + "% now, target 30-60%).", fixType: null }); }
                if (pMulti >= 10 && pMulti <= 40) { mixScore += 10; }
                else if (pMulti > 0 && pMulti < 60) { mixScore += 5; suggestions.push({ text: "💡 Insert 3+ word long-tail phrases (" + Math.round(pMulti) + "% now, target 10-40%).", fixType: null }); }
                score += mixScore;

                // 4. Quality Checks & Penalties
                const uniqueKeywords = new Set(keywordsArray.map(k => k.toLowerCase()));
                if (uniqueKeywords.size < totalKeywords) {
                    const duplicatesCount = totalKeywords - uniqueKeywords.size;
                    penalties += duplicatesCount * 2;
                    suggestions.push({ text: "❌ " + duplicatesCount + " duplicate keyword(s) found.", fixType: "remove_duplicates" });
                }

                if (titleLength > 0 && title.toLowerCase() === desc.toLowerCase()) {
                    penalties += 20;
                    suggestions.push({ text: "❌ Title and description are identical.", fixType: null });
                }

                const titleWords = title.toLowerCase().split(/\s+/);
                const titleWordCounts = {};
                titleWords.forEach(w => { if (w.length > 3) titleWordCounts[w] = (titleWordCounts[w] || 0) + 1; });
                if (Object.values(titleWordCounts).some(c => c > 3)) {
                    penalties += 10;
                    suggestions.push({ text: "⚠️ Keyword stuffing in title (repeated words).", fixType: "fix_title_stuffing" });
                }

                let finalScore = score - penalties;
                return {
                    score: Math.max(0, Math.min(100, finalScore)),
                    suggestions: suggestions
                };
            }

            // SEO Score Meter Update Function
            window.updateSeoMeter = function (cardId, seoData) {
                const meterContainer = document.getElementById(`seo-meter-${cardId}`);
                const badge = document.getElementById(`seo-badge-${cardId}`);
                const progressFill = document.getElementById(`seo-progress-${cardId}`);
                const suggestionsContainer = document.getElementById(`seo-suggestions-${cardId}`);

                const seoLock = document.getElementById(`seo-lock-${cardId}`);

                if (!meterContainer || !badge || !progressFill) return;

                const score = (typeof seoData === 'object' && seoData !== null) ? seoData.score : (parseInt(seoData) || 0);

                // Check Plan and Apply Blur
                const currentPlan = window.userUsageData?.plan || 'free';
                if (currentPlan === 'free') {
                    meterContainer.classList.add('pro-feature-locked');
                    if (seoLock) seoLock.style.display = 'flex';
                } else {
                    meterContainer.classList.remove('pro-feature-locked');
                    if (seoLock) seoLock.style.display = 'none';
                }

                // Determine grade and emoji
                let grade = '';
                let gradeClass = '';
                let emoji = '';

                if (score >= 80) {
                    grade = 'Excellent';
                    gradeClass = 'excellent';
                    emoji = '🟢';
                } else if (score >= 60) {
                    grade = 'Good';
                    gradeClass = 'good';
                    emoji = '🔵';
                } else if (score >= 40) {
                    grade = 'Average';
                    gradeClass = 'average';
                    emoji = '🟡';
                } else {
                    grade = 'Poor';
                    gradeClass = 'poor';
                    emoji = '🔴';
                }

                // Update badge
                badge.textContent = `${score} / 100 ${emoji} ${grade}`;
                badge.className = `seo-badge ${gradeClass}`;

                // Update progress bar
                progressFill.style.width = `${score}%`;
                progressFill.className = `seo-progress-fill ${gradeClass}`;

                // Display suggestions with Fix buttons
                if (suggestionsContainer) {
                    if (score < 100 && seoData && seoData.suggestions && seoData.suggestions.length > 0) {
                        suggestionsContainer.innerHTML = seoData.suggestions.map(s => {
                            const fixBtn = s.fixType
                                ? ` <button onclick="window.fixSeoIssue('${cardId}','${s.fixType}')" style="margin-left:6px; padding:1px 8px; font-size:0.85em; border:1px solid #10B981; background:rgba(16,185,129,0.15); color:#10B981; border-radius:4px; cursor:pointer; font-weight:700; white-space:nowrap;" onmouseover="this.style.background='#10B981';this.style.color='#fff'" onmouseout="this.style.background='rgba(16,185,129,0.15)';this.style.color='#10B981'">⚡ Fix</button>`
                                : '';
                            return `<div style="margin-bottom: 3px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap;"><span style="flex:1;">${s.text}</span>${fixBtn}</div>`;
                        }).join('');
                        suggestionsContainer.style.display = 'flex';
                    } else {
                        suggestionsContainer.innerHTML = score >= 100 ? '<div style="color:#10B981; font-weight:700;">✅ Perfect SEO! No improvements needed.</div>' : '';
                        suggestionsContainer.style.display = score >= 100 ? 'flex' : 'none';
                    }
                }

                // Show the meter
                meterContainer.style.display = 'block';
            }

            function reorderKeywords(keywordsStr) {
                if (!keywordsStr) return "";
                const keywords = keywordsStr.split(',').map(k => k.trim()).filter(Boolean);
                const uniqueKeywords = [...new Set(keywords)]; // Remove exact duplicates

                const singles = [];
                const doubles = [];
                const multis = [];

                uniqueKeywords.forEach(k => {
                    const wordCount = k.split(/\s+/).length;
                    if (wordCount === 1) singles.push(k);
                    else if (wordCount === 2) doubles.push(k);
                    else multis.push(k);
                });

                // Strategy: Top 10 Single, Top 10 Double, Top 10 Multi, then leftovers
                const sorted = [];

                // 1. First 10 High Weight (Single)
                sorted.push(...singles.slice(0, 10));

                // 2. Next 10 Medium Weight (Double)
                sorted.push(...doubles.slice(0, 10));

                // 3. Next 10 Low Weight (Multi)
                sorted.push(...multis.slice(0, 10));

                // 4. Leftovers (prioritizing Single -> Double -> Multi)
                sorted.push(...singles.slice(10));
                sorted.push(...doubles.slice(10));
                sorted.push(...multis.slice(10));

                return sorted.join(', ');
            }

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
                    text = Array.from(card.querySelectorAll('.meta-keyword-pill')).map(pill => {
                        const clone = pill.cloneNode(true);
                        const badge = clone.querySelector('.demand-badge');
                        if (badge) badge.remove();
                        return clone.textContent.trim();
                    }).join(', ');
                }

                if (text) navigator.clipboard.writeText(text).then(() => {
                    const originalText = button.innerHTML;
                    button.innerHTML = '<i class="icon-check"></i>Copied!';
                    setTimeout(() => { button.innerHTML = originalText; }, 1500);
                });
            };
            window.regenerateMetadata = async function (button) {
                const card = button.closest('.file-preview-card');
                const fileData = uploadedFilesData.find(f => f.id === card.id);
                if (!fileData) return;
                fileData.title = ''; fileData.keywords = ''; fileData.description = '';
                button.disabled = true; button.innerHTML = '<span class="icon-spinner"></span>';
                try {
                    const metadata = await generateMetadata(fileData);
                    fileData.title = metadata.title;
                    fileData.keywords = metadata.keywords;
                    fileData.description = metadata.description || '';
                } catch (error) {
                    console.error("Error regenerating metadata:", error);
                    fileData.title = "Error";
                } finally {
                    button.disabled = false;
                    button.innerHTML = '<span style="font-size:1.1em;">&#x21bb;</span>';
                    updateAllButtonStates();
                }
            };

            window.closeCard = function (button) {
                const card = button.closest('.file-preview-card');
                if (card) {
                    const idx = uploadedFilesData.findIndex(f => f.id === card.id);
                    if (idx !== -1) uploadedFilesData.splice(idx, 1);
                    card.remove();
                    updateAllButtonStates();
                }
            };

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


            async function generatePromptForImage(imageFile) {
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

            async function generateDalleImage(prompt, model, steps, n) {
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
            // --- NEW: Export & Share Features ---

            // Helper to get a ready-to-save File object with metadata embedded
            // Helper: Escape XML characters
            function escapeXml(unsafe) {
                if (typeof unsafe !== 'string') return "";
                return unsafe.replace(/[<>&'"]/g, function (c) {
                    switch (c) {
                        case '<': return '&lt;';
                        case '>': return '&gt;';
                        case '&': return '&amp;';
                        case '\'': return '&apos;';
                        case '"': return '&quot;';
                    }
                });
            }

            async function getEmbeddedFile(fileData) {
                let mimeType = fileData.fileObject.type;
                let blob;
                let filename = fileData.name;

                if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
                    // JPEG Embedding
                    blob = await new Promise(async (resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = async function (e) {
                            try {
                                let imageDataUrl = e.target.result;
                                let exifObj;
                                try {
                                    exifObj = piexif.load(imageDataUrl);
                                } catch (err) {
                                    imageDataUrl = await new Promise((res, rej) => {
                                        const img = new Image();
                                        img.onload = () => {
                                            const canvas = document.createElement('canvas');
                                            canvas.width = img.width; canvas.height = img.height;
                                            const ctx = canvas.getContext('2d');
                                            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
                                            ctx.drawImage(img, 0, 0);
                                            res(canvas.toDataURL('image/jpeg', 0.95));
                                        };
                                        img.onerror = rej;
                                        img.src = e.target.result;
                                    });
                                }
                                if (!exifObj) exifObj = { "0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": null };

                                function toUTF16LE(str) {
                                    const bytes = [];
                                    for (let i = 0; i < str.length; i++) {
                                        const code = str.charCodeAt(i);
                                        bytes.push(code & 0xff);
                                        bytes.push(code >> 8);
                                    }
                                    bytes.push(0, 0); // Null terminator
                                    return bytes;
                                }

                                const keywordsString = (fileData.keywords || "").split(',').map(k => k.trim()).join(';');

                                // Explicitly DELETE conflicting ASCII tags so Windows relies on XPTitle (Unicode)
                                delete exifObj["0th"][piexif.ImageIFD.ImageDescription];
                                delete exifObj["0th"][piexif.ImageIFD.DocumentName];

                                exifObj["0th"][piexif.ImageIFD.XPSubject] = toUTF16LE(fileData.description || "");
                                exifObj["0th"][piexif.ImageIFD.XPKeywords] = toUTF16LE(keywordsString);
                                exifObj["0th"][piexif.ImageIFD.XPAuthor] = toUTF16LE("MetaGen Pro");
                                exifObj["0th"][piexif.ImageIFD.XPTitle] = toUTF16LE(fileData.title || "");

                                const exifBytes = piexif.dump(exifObj);
                                const newImageDataUrl = piexif.insert(exifBytes, imageDataUrl);

                                // 2. Construct XMP Packet
                                const keywordsArr = (fileData.keywords || "").split(',').map(k => k.trim()).filter(Boolean);
                                const titleStr = escapeXml(fileData.title || "");
                                const descStr = escapeXml(fileData.description || "");
                                const keywordsList = keywordsArr.map(k => `<rdf:li>${escapeXml(k)}</rdf:li>`).join('');

                                const xmpContent = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c138 79.159824, 2016/09/14-01:09:01">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
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
     ${keywordsList}
    </rdf:Bag>
   </dc:subject>
   <photoshop:Headline>${titleStr}</photoshop:Headline>
   <photoshop:Description>${descStr}</photoshop:Description>
   <xmp:CreatorTool>MetaGen Pro</xmp:CreatorTool>
   <xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

                                // 3. Insert XMP into JPEG
                                function insertXmp(dataUrl, xmp) {
                                    const header = "data:image/jpeg;base64,";
                                    if (!dataUrl.startsWith(header)) return dataUrl;
                                    const raw = atob(dataUrl.substring(header.length));
                                    const len = raw.length;
                                    const arr = new Uint8Array(len);
                                    for (let i = 0; i < len; i++) arr[i] = raw.charCodeAt(i);

                                    const packet = `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>${xmp}<?xpacket end="w"?>`;

                                    // FIX: UTF-8 Encode the packet
                                    let packetBytes;
                                    if (typeof TextEncoder !== 'undefined') {
                                        packetBytes = new TextEncoder().encode(packet);
                                    } else {
                                        const uriComp = encodeURIComponent(packet);
                                        const bytes = [];
                                        for (let i = 0; i < uriComp.length; i++) {
                                            const c = uriComp.charCodeAt(i);
                                            if (c === 37) { // %
                                                bytes.push(parseInt(uriComp.substr(i + 1, 2), 16));
                                                i += 2;
                                            } else {
                                                bytes.push(c);
                                            }
                                        }
                                        packetBytes = new Uint8Array(bytes);
                                    }

                                    const ns = "http://ns.adobe.com/xap/1.0/\0";
                                    const segLen = 2 + ns.length + packetBytes.length;
                                    const seg = new Uint8Array(segLen + 2);
                                    seg[0] = 0xFF; seg[1] = 0xE1;
                                    seg[2] = (segLen >> 8) & 0xFF; seg[3] = segLen & 0xFF;

                                    let off = 4;
                                    for (let i = 0; i < ns.length; i++) seg[off++] = ns.charCodeAt(i);
                                    seg.set(packetBytes, off);

                                    // Splice after Exif if present, else after SOI
                                    let pos = 2; // After SOI
                                    let finalArr = new Uint8Array(arr.length + seg.length);

                                    while (pos < arr.length) {
                                        if (arr[pos] === 0xFF && arr[pos + 1] === 0xE1) {
                                            // Check if Exif
                                            const sL = (arr[pos + 2] << 8) | arr[pos + 3];
                                            if (arr[pos + 4] === 0x45 && arr[pos + 5] === 0x78) { // "Ex..."
                                                pos += 2 + sL; // Skip Exif
                                                continue;
                                            }
                                        }
                                        break;
                                    }

                                    finalArr.set(arr.subarray(0, pos), 0);
                                    finalArr.set(seg, pos);
                                    finalArr.set(arr.subarray(pos), pos + seg.length);

                                    let b = "";
                                    for (let i = 0; i < finalArr.length; i++) b += String.fromCharCode(finalArr[i]);
                                    return header + btoa(b);
                                }

                                const finalDataUrl = insertXmp(newImageDataUrl, xmpContent);

                                // Convert back to Blob
                                const byteString = atob(finalDataUrl.split(',')[1]);
                                const ab = new ArrayBuffer(byteString.length);
                                const ia = new Uint8Array(ab);
                                for (let i = 0; i < byteString.length; i++) {
                                    ia[i] = byteString.charCodeAt(i);
                                }
                                resolve(new Blob([ab], { type: 'image/jpeg' }));
                            } catch (error) { reject(error); }
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(fileData.fileObject);
                    });
                    filename = filename.replace(/(\.[\w\d_-]+)$/i, '_meta$1');

                } else if (mimeType === 'image/png' || filename.toLowerCase().endsWith('.png')) {
                    // PNG Embedding
                    blob = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            try {
                                const originalBytes = new Uint8Array(e.target.result);
                                const iendOffset = findIendChunkOffset(originalBytes);
                                if (iendOffset === -1) throw new Error("Could not find IEND chunk.");
                                const contentBeforeIEND = originalBytes.subarray(0, iendOffset);
                                const iendChunk = originalBytes.subarray(iendOffset);
                                const chunksToEmbed = [
                                    createTextChunk("Title", fileData.title || ""),
                                    createTextChunk("Description", fileData.description || ""),
                                    createTextChunk("Keywords", fileData.keywords || ""),
                                    createTextChunk("Author", "MetaGen Pro"),
                                    createTextChunk("Software", "MetaGen Pro v5"),
                                    createTextChunk("Copyright", "MetaGen Pro"),
                                    createTextChunk("Creation Time", new Date().toISOString())
                                ];
                                const xmpChunk = createXmpChunk(fileData.title || "", fileData.description || "", fileData.keywords || "");
                                const newPngBytes = concatArrays([contentBeforeIEND, ...chunksToEmbed, xmpChunk, iendChunk]);
                                resolve(new Blob([newPngBytes], { type: 'image/png' }));
                            } catch (error) { reject(error); }
                        };
                        reader.onerror = reject;
                        reader.readAsArrayBuffer(fileData.fileObject);
                    });
                    filename = filename.replace(/(\.png)$/i, '_meta$1');

                } else if (mimeType === 'image/svg+xml' || filename.toLowerCase().endsWith('.svg')) {
                    // SVG Embedding
                    blob = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            try {
                                const svgContent = e.target.result;
                                const parser = new DOMParser();
                                const xmlDoc = parser.parseFromString(svgContent, "image/svg+xml");
                                const svgRoot = xmlDoc.documentElement;

                                let titleNode = svgRoot.querySelector("title");
                                if (!titleNode) { titleNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "title"); svgRoot.insertBefore(titleNode, svgRoot.firstChild); }
                                titleNode.textContent = fileData.title || "";

                                let descNode = svgRoot.querySelector("desc");
                                if (!descNode) { descNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "desc"); svgRoot.insertBefore(descNode, titleNode.nextSibling); }
                                descNode.textContent = fileData.description || "";

                                const oldMetadata = svgRoot.querySelectorAll("metadata");
                                oldMetadata.forEach(el => el.remove());

                                let metadataNode = xmlDoc.createElementNS("http://www.w3.org/2000/svg", "metadata");
                                metadataNode.id = "metagen-placeholder";
                                svgRoot.insertBefore(metadataNode, descNode.nextSibling);

                                const serializer = new XMLSerializer();
                                let svgString = serializer.serializeToString(xmlDoc);

                                const title = escapeXml(fileData.title || "");
                                const description = escapeXml(fileData.description || "");
                                const keywordsArray = (fileData.keywords || "").split(',').map(k => k.trim()).filter(Boolean);
                                const keywordsRdf = keywordsArray.map(k => `<rdf:li>${escapeXml(k)}</rdf:li>`).join('\n                                    ');

                                const xmpContent = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c138 79.159824, 2016/09/14-01:09:01"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><dc:format>image/svg+xml</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title><dc:description><rdf:Alt><rdf:li xml:lang="x-default">${description}</rdf:li></rdf:Alt></dc:description><dc:subject><rdf:Bag>${keywordsRdf}</rdf:Bag></dc:subject><photoshop:Headline>${title}</photoshop:Headline><photoshop:Description>${description}</photoshop:Description><xmp:CreatorTool>MetaGen Pro</xmp:CreatorTool><xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate></rdf:Description></rdf:RDF></x:xmpmeta>`;
                                const xmpWithPacket = `<metadata id="metagen-data"><?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>${xmpContent}<?xpacket end="w"?></metadata>`;

                                svgString = svgString.replace(/<metadata[^>]*id="metagen-placeholder"[^>]*>(.*?)<\/metadata>|<metadata[^>]*id="metagen-placeholder"[^>]*\/>/si, xmpWithPacket);
                                if (!svgString.startsWith('<?xml')) { svgString = '<?xml version="1.0" encoding="utf-8"?>\n' + svgString; }

                                resolve(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }));
                            } catch (error) { reject(error); }
                        };
                        reader.onerror = reject;
                        reader.readAsText(fileData.fileObject);
                    });
                    filename = filename.replace(/(\.svg)$/i, '_meta$1');
                } else if (fileData.name && fileData.name.toLowerCase().endsWith('.eps')) {
                    // --- NEW: EPS Embedding via Server ---
                    blob = await new Promise(async (resolve, reject) => {
                        try {
                            const formData = new FormData();
                            formData.append('file', fileData.fileObject);
                            formData.append('title', fileData.title || '');
                            formData.append('description', fileData.description || '');
                            formData.append('keywords', fileData.keywords || '');

                            const response = await fetch('https://metagen-eps-server.onrender.com/api/embed-eps', {
                                method: 'POST',
                                body: formData
                            });

                            if (!response.ok) throw new Error("Failed to embed EPS metadata on server.");

                            const epsBlob = await response.blob();
                            resolve(epsBlob);
                        } catch (e) {
                            reject(e);
                        }
                    });
                    filename = filename.replace(/(\.eps)$/i, '_meta$1');
                    mimeType = "application/postscript";

                } else if (fileData.isVideo) {
                    // Videos don't support direct embedding in this tool yet, return original
                    return fileData.fileObject;
                } else if (fileData.isAiFile) {
                    throw new Error("Direct embedding into .ai files is not supported. Please use the Copy buttons.");
                } else {
                    throw new Error("Unsupported file format for embedding.");
                }

                return new File([blob], filename, { type: mimeType });
            }

            // Save to Local Folder Function
            async function saveToLocalFolder() {
                const plan = (window.userUsageData?.plan || 'free').toLowerCase();
                if (plan === 'free') {
                    alert("Upgrade to PRO/PREMIUM plan. Save to Folder features are for pro & premium users only.");
                    if (typeof scrollToPricing === 'function') scrollToPricing();
                    return;
                }

                if (!window.showDirectoryPicker) {
                    alert("Your browser does not support the File System Access API. Please use Chrome, Edge, or Opera.");
                    return;
                }

                // Filter files to save (eps যুক্ত করা হয়েছে)
                const filesToSave = uploadedFilesData.filter(f =>
                    f.title && f.title !== "Error" &&
                    (
                        (f.fileObject.type && (['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'].includes(f.fileObject.type) || f.fileObject.type.startsWith('video/'))) ||
                        (f.name && /\.(png|svg|jpg|jpeg|eps|mp4|mov|avi|webm|mkv)$/i.test(f.name))
                    )
                );

                if (filesToSave.length === 0) {
                    alert("No processable files found to save.");
                    return;
                }

                try {
                    // ১. [মূল ফিক্স] ফোল্ডার সিলেক্ট করার সাথেই 'readwrite' পারমিশন চেয়ে নেওয়া হচ্ছে!
                    const dirHandle = await window.showDirectoryPicker({
                        mode: 'readwrite'
                    });

                    const btn = document.getElementById('saveToFolderButton');
                    const originalText = btn.innerHTML;
                    btn.disabled = true;
                    btn.innerHTML = '<i class="icon-spinner"></i> ' + getTrans('saving');

                    let savedCount = 0;
                    for (const fileData of filesToSave) {
                        try {
                            btn.innerHTML = `<i class="icon-spinner"></i> ${getTrans('saving')} ${savedCount + 1}/${filesToSave.length}`;

                            // ২. ফাইল এম্বেড করা (EPS এর ক্ষেত্রে সার্ভার থেকে হয়ে আসবে)
                            const embeddedFile = await getEmbeddedFile(fileData);

                            // ৩. ফোল্ডারে সেভ করা (এখন আর পারমিশন চাইবে না, কারণ আগেই নেওয়া হয়েছে)
                            const fileHandle = await dirHandle.getFileHandle(embeddedFile.name, { create: true });
                            const writable = await fileHandle.createWritable();
                            await writable.write(embeddedFile);
                            await writable.close();

                            savedCount++;
                        } catch (err) {
                            console.error(`Failed to save ${fileData.name}:`, err);
                        }
                    }

                    alert(`Successfully saved ${savedCount} files to the selected folder!`);

                    btn.disabled = false;
                    btn.innerHTML = originalText;

                } catch (error) {
                    // যদি ইউজার ফোল্ডার সিলেক্ট না করে Cancel করে দেয়, তাহলে এরর দেখাবে না
                    if (error.name !== 'AbortError') {
                        console.error("File System Access Error:", error);
                        alert("An error occurred while saving files: " + error.message);

                        // বাটন আগের অবস্থায় ফিরিয়ে আনা
                        const btn = document.getElementById('saveToFolderButton');
                        if (btn) {
                            btn.disabled = false;
                            btn.innerHTML = '<i class="fas fa-folder-open"></i> <span data-i18n="save_folder">Save to Folder</span>';
                        }
                    }
                }
            }

            // Wire up new buttons
            const saveToFolderBtn = document.getElementById('saveToFolderButton');
            if (saveToFolderBtn) {
                saveToFolderBtn.onclick = saveToLocalFolder;

                // Check support
                if (!window.showDirectoryPicker) {
                    saveToFolderBtn.style.display = 'none'; // Hide if not supported
                }
            }

            const shareFilesBtn = document.getElementById('shareFilesButton');
            if (shareFilesBtn) {
                // Check support for file sharing
                if (!navigator.canShare) {
                    shareFilesBtn.style.display = 'none';
                }

                shareFilesBtn.onclick = async () => {
                    const filesToShare = uploadedFilesData.filter(f =>
                        f.title && f.title !== "Error" &&
                        (
                            (f.fileObject.type && ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'].includes(f.fileObject.type)) ||
                            (f.name && /\.(png|svg|jpg|jpeg|eps)$/i.test(f.name))
                        )
                    );

                    if (filesToShare.length === 0) {
                        alert("No processable files found to share.");
                        return;
                    }

                    const originalText = shareFilesBtn.innerHTML;
                    shareFilesBtn.disabled = true;
                    shareFilesBtn.innerHTML = '<i class="icon-spinner"></i> ' + getTrans('preparing');

                    try {
                        const filesArray = [];
                        for (const fileData of filesToShare) {
                            try {
                                const file = await getEmbeddedFile(fileData);
                                filesArray.push(file);
                            } catch (e) {
                                console.error(`Error processing ${fileData.name} for sharing:`, e);
                            }
                        }

                        if (filesArray.length === 0) {
                            alert("Failed to prepare files for sharing.");
                            return;
                        }

                        if (navigator.canShare && navigator.canShare({ files: filesArray })) {
                            await navigator.share({
                                files: filesArray,
                                title: 'MetaGen Pro Export',
                                text: 'Here are my processed files with metadata.'
                            });
                        } else {
                            alert("Your browser does not support sharing these files.");
                        }

                    } catch (error) {
                        if (error.name !== 'AbortError') {
                            console.error("Share Error:", error);
                            alert("Error sharing files: " + error.message);
                        }
                    } finally {
                        shareFilesBtn.disabled = false;
                        shareFilesBtn.innerHTML = originalText;
                    }
                };
            }

            // --- Google Drive Integration ---
            const uploadToDriveBtn = document.getElementById('uploadToDriveButton');
            let tokenClient;
            let gapiInited = false;
            let gisInited = false;

            // Initialize GAPI and GSI
            function maybeInitGoogleDrive() {
                const apiKey = localStorage.getItem('googleDriveApiKey');
                const clientId = localStorage.getItem('googleDriveClientId');

                if (apiKey && clientId) {
                    if (typeof gapi !== 'undefined' && !gapiInited) {
                        gapi.load('client', async () => {
                            try {
                                await gapi.client.init({
                                    apiKey: apiKey,
                                    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
                                });
                                gapiInited = true;
                            } catch (err) {
                                console.error("GAPI Init Error:", err);
                            }
                        });
                    }

                    if (typeof google !== 'undefined' && !gisInited) {
                        tokenClient = google.accounts.oauth2.initTokenClient({
                            client_id: clientId,
                            scope: 'https://www.googleapis.com/auth/drive.file',
                            callback: (resp) => {
                                if (resp.error !== undefined) {
                                    throw (resp);
                                }
                                // Token acquired, proceed to upload (handled in button click)
                            },
                        });
                        gisInited = true;
                    }
                }
            }

            // Try to init on load if keys exist
            setTimeout(maybeInitGoogleDrive, 1000); // Give scripts time to load

            if (uploadToDriveBtn) {
                // Initial check for keys
                if (!localStorage.getItem('googleDriveApiKey') || !localStorage.getItem('googleDriveClientId')) {
                    // We could hide button or show setup prompt on click. usage prompt on click is better.
                }

                uploadToDriveBtn.onclick = async () => {
                    const apiKey = localStorage.getItem('googleDriveApiKey');
                    const clientId = localStorage.getItem('googleDriveClientId');

                    if (!apiKey || !clientId) {
                        const setNow = confirm("Google Drive API Key and Client ID are missing. Would you like to set them now?\n\nYou need to create a project in Google Cloud Console, enable Drive API, and generate an API Key and OAuth Client ID.");
                        if (setNow) {
                            const newClientId = prompt("Enter your Google Client ID:", clientId || "");
                            const newApiKey = prompt("Enter your Google API Key:", apiKey || "");
                            if (newClientId && newApiKey) {
                                localStorage.setItem('googleDriveClientId', newClientId);
                                localStorage.setItem('googleDriveApiKey', newApiKey);
                                attemptUpload();
                                maybeInitGoogleDrive(); // Re-init
                            }
                        }
                        return;
                    }
                    attemptUpload();
                };
            }

            async function attemptUpload() {
                maybeInitGoogleDrive(); // Ensure init

                // Wait briefly for init if needed (hacky but simple for now)
                if ((!gapiInited || !gisInited) && (typeof gapi !== 'undefined' && typeof google !== 'undefined')) {
                    await new Promise(r => setTimeout(r, 1000));
                }

                if (!gapiInited || !gisInited) {
                    alert("Google Drive API failed to initialize. Please check your Console and API Keys.");
                    return;
                }

                tokenClient.callback = async (resp) => {
                    if (resp.error !== undefined) {
                        throw (resp);
                    }
                    await uploadFilesToDrive();
                };

                if (gapi.client.getToken() === null) {
                    // Prompt the user to select a Google Account and ask for consent to share their data
                    // when establishing a new session.
                    tokenClient.requestAccessToken({ prompt: 'consent' });
                } else {
                    // Skip display of account chooser and consent dialog for an existing session.
                    tokenClient.requestAccessToken({ prompt: 'none' });
                }
            }

            async function uploadFilesToDrive() {
                const filesToUpload = uploadedFilesData.filter(f =>
                    f.title && f.title !== "Error" &&
                    (
                        (f.fileObject.type && (['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'].includes(f.fileObject.type) || f.fileObject.type.startsWith('video/'))) ||
                        (f.name && /\.(png|svg|jpg|jpeg|eps|mp4|mov|avi|webm|mkv)$/i.test(f.name))
                    )
                );

                if (filesToUpload.length === 0) {
                    alert("No files to upload.");
                    return;
                }

                const btn = document.getElementById('uploadToDriveButton');
                const originalText = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i class="icon-spinner"></i> ' + getTrans('uploading');

                let successCount = 0;

                try {
                    // Create a root folder "MetaGen Pro Exports"
                    let folderId = null;
                    // Check if folder exists (simple query)
                    const q = "name = 'MetaGen Pro Exports' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
                    const response = await gapi.client.drive.files.list({ q: q, fields: 'files(id, name)' });

                    if (response.result.files && response.result.files.length > 0) {
                        folderId = response.result.files[0].id;
                    } else {
                        // Create folder
                        const fileMetadata = {
                            'name': 'MetaGen Pro Exports',
                            'mimeType': 'application/vnd.google-apps.folder'
                        };
                        const folder = await gapi.client.drive.files.create({
                            resource: fileMetadata,
                            fields: 'id'
                        });
                        folderId = folder.result.id;
                    }

                    for (const fileData of filesToUpload) {
                        btn.innerHTML = `<i class="icon-spinner"></i> ${getTrans('uploading')} ${successCount + 1}/${filesToUpload.length}`;

                        const embeddedFile = await getEmbeddedFile(fileData);

                        // Prepare multipart upload
                        const metadata = {
                            'name': embeddedFile.name,
                            'parents': [folderId]
                        };

                        const accessToken = gapi.client.getToken().access_token;
                        const form = new FormData();
                        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                        form.append('file', embeddedFile);

                        await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                            method: 'POST',
                            headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
                            body: form
                        }).then(res => {
                            if (!res.ok) throw new Error("Upload failed");
                            successCount++;
                        });
                    }

                    alert(`Successfully uploaded ${successCount} files to 'MetaGen Pro Exports' on Google Drive!`);

                } catch (err) {
                    console.error("Upload Error:", err);
                    alert("Upload failed: " + err.message);
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            }

            window.loadFTPCredentials = function (platform) {
                const savedCreds = localStorage.getItem(`ftp_creds_${platform}`);
                if (savedCreds) {
                    try {
                        return JSON.parse(savedCreds);
                    } catch (e) {
                        console.error("Error parsing saved FTP creds for", platform);
                    }
                }
                return null;
            };

            const stockAgencies = {
                'shutterstock': { name: 'Shutterstock', host: 'ftp.shutterstock.com', port: '' },
                'adobestock': { name: 'Adobe Stock', host: 'sftp.contributor.adobestock.com', port: '22' },
                'Magnific': { name: 'Magnific', host: 'contributor-ftp.magnific.com', port: '60022' },
                'vecteezy': { name: 'Vecteezy', host: 'ftp.vecteezy.com', port: '' },
                'vectorstock': { name: 'VectorStock', host: 'ftp.vectorstock.com', port: '' },
                '123rf': { name: '123RF', host: 'ftp.123rf.com', port: '' },
                'pond5': { name: 'Pond5', host: 'ftp.pond5.com', port: '' }
            };

            window.handleAgencyConfigChange = function () {
                const platform = document.getElementById('ftpPlatform').value;
                const hostInput = document.getElementById('ftpHost');
                const portInput = document.getElementById('ftpPort');
                const userInput = document.getElementById('ftpUser');
                const passInput = document.getElementById('ftpPass');

                if (platform === 'custom') {
                    hostInput.placeholder = "ftp.your-site.com";
                    if (portInput) portInput.value = '';
                } else {
                    hostInput.placeholder = stockAgencies[platform].host;
                    if (portInput) portInput.value = stockAgencies[platform].port || '';
                }

                const creds = window.loadFTPCredentials(platform);
                if (creds) {
                    hostInput.value = creds.host || (platform === 'custom' ? '' : stockAgencies[platform].host);
                    if (portInput) portInput.value = creds.port || (platform === 'custom' ? '' : (stockAgencies[platform].port || ''));
                    userInput.value = creds.user || '';
                    passInput.value = creds.pass || '';
                } else {
                    hostInput.value = platform === 'custom' ? '' : stockAgencies[platform].host;
                    if (portInput) portInput.value = platform === 'custom' ? '' : (stockAgencies[platform].port || '');
                    userInput.value = '';
                    passInput.value = '';
                }
            };

            const saveCredsBtn = document.getElementById('saveAgencyCredsBtn');
            if (saveCredsBtn) {
                saveCredsBtn.onclick = function () {
                    const platform = document.getElementById('ftpPlatform').value;
                    const host = document.getElementById('ftpHost').value.trim();
                    const port = document.getElementById('ftpPort') ? document.getElementById('ftpPort').value.trim() : '';
                    const user = document.getElementById('ftpUser').value.trim();
                    const pass = document.getElementById('ftpPass').value.trim();

                    if (!user || !pass) {
                        alert("Please enter Username and Password.");
                        return;
                    }

                    localStorage.setItem(`ftp_creds_${platform}`, JSON.stringify({ host, port, user, pass }));
                    alert(`Credentials saved for ${platform === 'custom' ? 'Custom Site' : stockAgencies[platform].name}!`);
                };
            }

            const ftpUploadBtn = document.getElementById('ftpUploadButton');
            if (ftpUploadBtn) {
                ftpUploadBtn.onclick = () => {
                    window.openFtpUploadModal();
                };
            }

            const startFtpBtn = document.getElementById('startFtpBtn');
            if (startFtpBtn) {
                startFtpBtn.onclick = async function () {
                    console.log("Multi-Agency Upload Process Started...");

                    const selectedAgencies = Array.from(document.querySelectorAll('.ftp-upload-checkbox:checked')).map(cb => cb.value);
                    const statusDiv = document.getElementById('ftpStatus');
                    const progressContainer = document.getElementById('ftpProgressContainer');
                    const progressBar = document.getElementById('ftpProgressBar');
                    const progressFileName = document.getElementById('ftpProgressFileName');
                    const progressPercent = document.getElementById('ftpProgressPercent');

                    if (selectedAgencies.length === 0) {
                        alert("Please select at least one agency to upload.");
                        return;
                    }

                    const filesToUpload = uploadedFilesData.filter(f => f.title && f.title !== "Error");
                    if (filesToUpload.length === 0) {
                        alert("Please process metadata for the images first!");
                        return;
                    }

                    this.disabled = true;
                    const originalBtnContent = this.innerHTML;
                    progressContainer.style.display = 'block';
                    statusDiv.innerHTML = `<span style="color: #F97316;">${getTrans('initializing')}...</span>`;

                    let totalSuccess = 0;
                    let totalFailed = 0;
                    let totalFilesCount = filesToUpload.length * selectedAgencies.length;
                    let currentStep = 0;

                    for (const platform of selectedAgencies) {
                        const creds = window.loadFTPCredentials(platform);
                        if (!creds) {
                            alert(`No credentials found for ${stockAgencies[platform].name}. Please configure and save them first.`);
                            continue;
                        }

                        for (let i = 0; i < filesToUpload.length; i++) {
                            const fileData = filesToUpload[i];
                            currentStep++;

                            const percent = Math.round((currentStep / totalFilesCount) * 100);
                            progressBar.style.width = percent + '%';
                            progressFileName.innerText = `${stockAgencies[platform].name}: ${fileData.name}`;
                            progressPercent.innerText = percent + '%';
                            statusDiv.innerHTML = `<span style="color: #F97316;">${getTrans('uploading')} to ${stockAgencies[platform].name}...</span>`;

                            try {
                                const embeddedFile = await getEmbeddedFile(fileData);
                                const formData = new FormData();
                                formData.append('file', embeddedFile);
                                formData.append('host', creds.host.replace('sftp://', '').replace('ftp://', '').replace('ftps://', ''));
                                formData.append('port', creds.port || '');
                                formData.append('user', creds.user);
                                formData.append('pass', creds.pass);
                                const isSftp = creds.host.toLowerCase().includes('sftp') || creds.port === '60022' || creds.port === '22';
                                formData.append('protocol', isSftp ? 'sftp' : 'ftp');

                                const response = await fetch('https://metagen-eps-server.onrender.com/api/ftp-upload', {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${auth.currentUser ? await auth.currentUser.getIdToken() : ""}`
                                    },
                                    body: formData
                                });

                                let result;
                                try {
                                    result = await response.json();
                                } catch (e) { result = { success: false, error: 'Server returned invalid response' }; }

                                if (response.ok && result.success) {
                                    totalSuccess++;
                                    statusDiv.innerHTML = `<span style="color: #10B981;">&#10004; ${fileData.name} uploaded to ${stockAgencies[platform]?.name || platform}</span>`;
                                } else {
                                    totalFailed++;
                                    const errDetail = result.error || `HTTP ${response.status}`;
                                    console.error(`Upload failed for ${platform} - ${fileData.name}: ${errDetail}`);
                                    statusDiv.innerHTML = `<span style="color: #EF4444;">&#10008; ${fileData.name} failed: ${errDetail}</span>`;
                                }
                            } catch (err) {
                                totalFailed++;
                                console.error(`Upload error for ${platform}:`, err);
                                statusDiv.innerHTML = `<span style="color: #EF4444;">&#10008; ${fileData.name}: ${err.message}</span>`;
                            }
                        }
                    }

                    // Final summary
                    if (totalFailed > 0) {
                        statusDiv.innerHTML = `<span style="color: #F59E0B; font-weight:bold;">&#9888; Upload Complete: ${totalSuccess} success, ${totalFailed} failed</span>`;
                    } else {
                        statusDiv.innerHTML = `<span style="color: #10B981; font-weight:bold;">&#10004; All uploads successful! Total: ${totalSuccess}</span>`;
                    }
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                        progressBar.style.width = '0%';
                    }, 5000);

                    // Success sound
                    try {
                        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                        const oscillator = audioCtx.createOscillator();
                        const gainNode = audioCtx.createGain();
                        oscillator.frequency.value = 880;
                        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1);
                        oscillator.connect(gainNode);
                        gainNode.connect(audioCtx.destination);
                        oscillator.start();
                        oscillator.stop(audioCtx.currentTime + 1);
                    } catch (e) { }

                    this.disabled = false;
                    this.innerHTML = originalBtnContent;
                };
            }
        });
        // End of DOMContentLoaded

        // Feedback Modal Logic
        const feedbackModal = document.getElementById('feedbackModal');
        const openFeedbackBtn = document.getElementById('openFeedbackBtn');
        const closeFeedbackBtn = document.getElementById('closeFeedbackBtn');
        const feedbackForm = document.getElementById('feedbackForm');

        if (openFeedbackBtn) {
            openFeedbackBtn.addEventListener('click', () => {
                feedbackModal.style.display = 'flex';
            });
        }

        if (closeFeedbackBtn) {
            closeFeedbackBtn.addEventListener('click', () => {
                feedbackModal.style.display = 'none';
            });
        }

        window.addEventListener('click', (event) => {
            if (event.target === feedbackModal) {
                feedbackModal.style.display = 'none';
            }
        });

        // Star Rating Logic
        window.setRating = function (n) {
            document.getElementById('feedbackRating').value = n;
            const stars = document.querySelectorAll('#starContainer span');
            stars.forEach((star, index) => {
                if (index < n) {
                    star.classList.add('active');
                    star.style.color = '#F59E0B'; // Gold
                } else {
                    star.classList.remove('active');
                    star.style.color = '#4A5568'; // Grey
                }
            });
        };

        // Feedback Form Submit Logic Update
        if (feedbackForm) {
            feedbackForm.addEventListener('submit', async function (e) {
                e.preventDefault();

                const submitBtn = this.querySelector('button');
                submitBtn.innerText = 'Sending...';
                submitBtn.disabled = true;

                const rating = document.getElementById('feedbackRating').value;
                const message = document.getElementById('feedbackMessage').value;
                const type = document.getElementById('feedbackType').value;

                let userName = "Guest User";
                let userEmail = "Anonymous";

                try {
                    const user = auth.currentUser;
                    if (user) {
                        userEmail = user.email;
                        userName = user.displayName || userEmail.split('@')[0];
                    }
                } catch (err) {
                    console.error("User info fetch error:", err);
                }

                const templateParams = {
                    type: type,
                    message: `User Name: ${userName}\nUser Email: ${userEmail}\nIssue Type: ${type}\nRating: ${rating} Stars\n\nUser Message:\n${message}`,
                    rating: rating,
                    from_name: userName,
                    from_email: userEmail,
                    email: userEmail,
                    reply_to: userEmail
                };

                emailjs.send('service_uhnivl8', 'template_478y5x8', templateParams)
                    .then(function () {
                        console.log("Admin email sent.");

                        if (userEmail && userEmail.includes("@")) {
                            emailjs.send('service_uhnivl8', 'template_3vqxzz2', templateParams)
                                .then(() => console.log("Auto-reply sent successfully to user."))
                                .catch((err) => console.error("Auto-reply FAILED:", err));
                        } else {
                            console.warn("Auto-reply skipped: User is Guest/Anonymous.");
                        }

                        // --- NEW: UPDATE REVIEW COUNT & RATING DYNAMICALLY ---
                        let userRating = parseInt(document.getElementById('feedbackRating').value) || 5;
                        let stats = JSON.parse(localStorage.getItem('metagen_review_stats')) || { count: 1584, totalScore: 1584 * 4.9 };

                        // Increase count and add new score
                        stats.count += 1;
                        stats.totalScore += userRating;
                        localStorage.setItem('metagen_review_stats', JSON.stringify(stats));

                        // Refresh the UI Instantly
                        if (typeof loadReviewStats === 'function') loadReviewStats();
                        // -----------------------------------------------------

                        feedbackModal.style.display = 'none';
                        const thankYouModal = document.getElementById('thankYouModal');
                        if (thankYouModal) {
                            thankYouModal.style.display = 'flex';
                        } else {
                            alert('Thank you for your feedback! ❤️');
                        }

                        localStorage.setItem('feedbackSubmitted', 'true');
                        feedbackForm.reset();
                        setRating(0);

                    }, function (error) {
                        alert('Failed to send. Please check your internet connection.');
                        console.error('Admin Email FAILED:', error);
                    })
                    .finally(() => {
                        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Feedback';
                        submitBtn.disabled = false;
                    });
            });
        }

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

        // ====== INDEXEDDB SESSION LOGIC ======
        window.SessionDB = {
            dbName: 'MetaGenPro_SessionDB',
            dbVersion: 2,
            storeName: 'activeSession',

            async getDB() {
                return new Promise((resolve, reject) => {
                    const req = indexedDB.open(this.dbName, this.dbVersion);
                    req.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains(this.storeName)) {
                            db.createObjectStore(this.storeName, { keyPath: 'id' });
                        }
                        if (!db.objectStoreNames.contains('metadataHistory')) {
                            db.createObjectStore('metadataHistory', { keyPath: 'id' });
                        }
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            },

            async saveCurrentSession() {
                try {
                    const db = await this.getDB();
                    const tx = db.transaction([this.storeName, 'metadataHistory'], 'readwrite');
                    const store = tx.objectStore(this.storeName);
                    const histStore = tx.objectStore('metadataHistory');
                    await new Promise((resolve) => {
                        const clearReq = store.clear();
                        clearReq.onsuccess = resolve;
                    });

                    if (!window.uploadedFilesData || window.uploadedFilesData.length === 0) return;
                    for (let data of window.uploadedFilesData) {
                        store.put({
                            id: data.id,
                            name: data.name,
                            fileObject: data.fileObject,
                            previewFile: data.previewFile,
                            title: data.title || '',
                            description: data.description || '',
                            keywords: data.keywords || '',
                            category: data.category || '',
                            status: data.status || '',
                            salesProbability: data.salesProbability,
                            demandLevel: data.demandLevel,
                            competitionLevel: data.competitionLevel,
                            trendingScore: data.trendingScore,
                            bestPlatforms: data.bestPlatforms,
                            strengths: data.strengths
                        });

                        if (data.title && data.title !== 'Error' && data.status === 'success') {
                            const size = data.fileObject ? data.fileObject.size : 0;
                            const histId = encodeURIComponent(data.name) + '_' + size;

                            // Get stored thumbnail or capture if missing
                            let thumb = data.thumbnail;
                            if (!thumb && typeof captureThumbnail === 'function') {
                                thumb = captureThumbnail(data.id, 100);
                            }

                            histStore.put({
                                id: histId,
                                name: data.name,
                                title: data.title,
                                description: data.description || '',
                                keywords: data.keywords || '',
                                thumbnail: thumb, // Save the base64 thumbnail
                                timestamp: Date.now()
                            });
                        }
                    }
                } catch (e) {
                    console.warn("Could not save session to IndexedDB:", e);
                }
            },

            async loadMetadataHistory() {
                return new Promise(async (resolve) => {
                    try {
                        const db = await this.getDB();
                        const tx = db.transaction('metadataHistory', 'readonly');
                        const store = tx.objectStore('metadataHistory');
                        const req = store.getAll();
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => resolve([]);
                    } catch (e) {
                        resolve([]);
                    }
                });
            },

            async clearSession() {
                try {
                    const db = await this.getDB();
                    const tx = db.transaction(this.storeName, 'readwrite');
                    const store = tx.objectStore(this.storeName);
                    store.clear();
                } catch (e) { }
            },

            async loadSession() {
                return new Promise(async (resolve) => {
                    try {
                        const db = await this.getDB();
                        const tx = db.transaction(this.storeName, 'readonly');
                        const store = tx.objectStore(this.storeName);
                        const req = store.getAll();
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => resolve([]);
                    } catch (e) {
                        resolve([]);
                    }
                });
            }
        };

        window.scheduleSessionSave = function () {
            if (window._sessionSaveTimer) clearTimeout(window._sessionSaveTimer);
            window._sessionSaveTimer = setTimeout(() => {
                if (typeof window.SessionDB !== 'undefined') window.SessionDB.saveCurrentSession();
            }, 1000);
        };

        window.addEventListener('load', async () => {
            // Restore from IndexedDB
            const savedData = await window.SessionDB.loadSession();
            if (savedData && savedData.length > 0) {
                if (confirm(`We found ${savedData.length} images and metadata from the previous session. Do you want to restore the previous files and metadata?`)) {
                    // Start restoration
                    const fileList = savedData.map(d => d.fileObject).filter(f => f != null && typeof f === 'object');
                    if (fileList.length > 0) {
                        if (typeof window.handleFiles === 'function') await window.handleFiles(fileList);

                        // Wait briefly for DOM to render the new cards
                        setTimeout(() => {
                            savedData.forEach((d, index) => {
                                const newlyAdded = window.uploadedFilesData[index];
                                if (newlyAdded) {
                                    newlyAdded.title = d.title;
                                    newlyAdded.description = d.description;
                                    newlyAdded.keywords = d.keywords;
                                    newlyAdded.status = d.status;
                                    newlyAdded.salesProbability = d.salesProbability;
                                    newlyAdded.demandLevel = d.demandLevel;
                                    newlyAdded.competitionLevel = d.competitionLevel;
                                    newlyAdded.trendingScore = d.trendingScore;
                                    newlyAdded.bestPlatforms = d.bestPlatforms;
                                    newlyAdded.strengths = d.strengths;
                                    newlyAdded.category = d.category;

                                    // Update DOM
                                    const cardDOM = document.getElementById(newlyAdded.id);
                                    if (cardDOM) {
                                        const metaContainer = document.getElementById('meta-' + newlyAdded.id);
                                        if (metaContainer) metaContainer.style.display = 'block';

                                        const metaCol = cardDOM.querySelector('.card-meta-col');
                                        if (metaCol) metaCol.style.display = 'flex';

                                        const tEl = cardDOM.querySelector('.meta-title');
                                        if (tEl && d.title) {
                                            tEl.textContent = d.title;
                                            const clarityBtn = document.getElementById(`check-clarity-btn-${newlyAdded.id}`);
                                            if (clarityBtn) clarityBtn.style.display = 'inline-flex';
                                        }

                                        const dEl = cardDOM.querySelector('.meta-description');
                                        const dSection = document.getElementById('desc-section-' + newlyAdded.id);
                                        if (dEl && d.description) {
                                            if (dSection) dSection.style.display = 'block';
                                            dEl.textContent = d.description;
                                        }

                                        // Restore Category
                                        const aiCategorySelect = document.getElementById(`ai-category-${newlyAdded.id}`);
                                        if (aiCategorySelect && d.category) {
                                            aiCategorySelect.value = d.category;
                                        }

                                        if (d.keywords && typeof window.updateKeywordsDisplay === 'function') {
                                            window.updateKeywordsDisplay(newlyAdded.id);
                                        } else {
                                            const kwEl = cardDOM.querySelector('.meta-keywords');
                                            if (kwEl && d.keywords) {
                                                kwEl.innerHTML = '';
                                                d.keywords.split(',').forEach(k => {
                                                    if (!k.trim()) return;
                                                    const s = document.createElement('span');
                                                    s.className = 'meta-keyword';
                                                    s.textContent = k.trim();
                                                    kwEl.appendChild(s);
                                                });
                                            }
                                        }

                                        if (d.status === 'success') {
                                            const statusEl = document.getElementById('status-' + newlyAdded.id);
                                            if (statusEl) {
                                                statusEl.textContent = 'Generated';
                                                statusEl.style.color = '#10B981';
                                                statusEl.style.background = 'rgba(16,185,129,0.1)';
                                            }

                                            // Restore SEO Meter
                                            if (typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
                                                const seoScore = calculateSeoScore(d);
                                                updateSeoMeter(newlyAdded.id, seoScore);
                                            }

                                            cardDOM.style.borderColor = "#10B981";
                                            cardDOM.classList.add('metadata-generated', 'generated');

                                            // Disable processing state if any
                                            cardDOM.classList.remove('processing');
                                            const spinner = cardDOM.querySelector('.loading-spinner');
                                            if (spinner) spinner.style.display = 'none';
                                        }
                                    }
                                }
                            });
                        }, 1200);
                    }
                } else {
                    window.SessionDB.clearSession();
                }
            }

            // Setup MutationObserver to save on changes dynamically
            setTimeout(() => {
                const container = document.getElementById('filePreviewContainer');
                if (container) {
                    const observer = new MutationObserver(() => {
                        window.scheduleSessionSave();
                    });
                    observer.observe(container, { childList: true, subtree: true, characterData: true, attributes: true });
                }
            }, 1000);
        });

        // --- SECURE METADATA HISTORY PLATFORM ENGINE ---
        window.cachedHistory = [];

        // কপি লজিক (উইন্ডো স্কোপ)
        window.copyHistoryField = function (btn, encodedItem, field) {
            try {
                const item = JSON.parse(decodeURIComponent(encodedItem));
                let text = item[field] || '';

                if (field === 'keywords' && Array.isArray(text)) {
                    text = text.join(', ');
                }

                navigator.clipboard.writeText(text);

                const originalHTML = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> Copied';
                btn.style.background = 'rgba(16, 185, 129, 0.15)';
                btn.style.color = '#10B981';

                setTimeout(() => {
                    btn.innerHTML = originalHTML;
                    btn.style.background = '';
                    btn.style.color = '';
                }, 1500);
            } catch (err) {
                console.error("Copy failed:", err);
            }
        };

        // সিএসভি এক্সপোর্ট লজিক (উইন্ডো স্কোপ)
        window.exportHistoryCsv = async function () {
            try {
                if (typeof window.SessionDB === 'undefined') {
                    alert("Session database is not initialized.");
                    return;
                }
                const allHistory = await window.SessionDB.loadMetadataHistory();
                if (!allHistory || allHistory.length === 0) {
                    alert("No history found to export.");
                    return;
                }

                allHistory.sort((a, b) => b.timestamp - a.timestamp);

                let csvContent = "Filename,Title,Description,Keywords,Timestamp\n";
                allHistory.forEach(item => {
                    const name = (item.name || "").replace(/"/g, '""');
                    const title = (item.title || "").replace(/"/g, '""');
                    const desc = (item.description || "").replace(/"/g, '""');
                    const keywords = (item.keywords || "").replace(/"/g, '""');
                    const dateStr = new Date(item.timestamp).toLocaleString().replace(/"/g, '""');

                    csvContent += `"${name}","${title}","${desc}","${keywords}","${dateStr}"\n`;
                });

                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.setAttribute("download", `metagen_history_export_${Date.now()}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } catch (e) {
                console.error("Export History Error:", e);
                alert("Export failed: " + e.message);
            }
        };

        // হিস্ট্রি ক্লিয়ার লজিক (উইন্ডো স্কোপ)
        window.clearAllHistory = async function () {
            if (!confirm("Are you sure you want to permanently delete your entire metadata history? This cannot be undone.")) return;
            try {
                if (typeof window.SessionDB === 'undefined') {
                    alert("Session database is not initialized.");
                    return;
                }
                const db = await window.SessionDB.getDB();
                const tx = db.transaction('metadataHistory', 'readwrite');
                const store = tx.objectStore('metadataHistory');
                const req = store.clear();
                req.onsuccess = () => {
                    alert("History cleared successfully!");
                    window.openMetadataHistoryModal();
                };
                req.onerror = () => {
                    alert("Failed to clear history.");
                };
            } catch (e) {
                console.error(e);
            }
        };

        window.deleteHistoryItem = async function (histId) {
            if (!confirm("Are you sure you want to delete this item from your history?")) return;
            try {
                if (typeof window.SessionDB === 'undefined') {
                    alert("Session database is not initialized.");
                    return;
                }
                const db = await window.SessionDB.getDB();
                const tx = db.transaction('metadataHistory', 'readwrite');
                const store = tx.objectStore('metadataHistory');
                const req = store.delete(histId);
                req.onsuccess = () => {
                    // সফলভাবে ডিলিট হলে মোডাল রিফ্রেশ করবে
                    window.openMetadataHistoryModal();
                };
                req.onerror = () => {
                    alert("Failed to delete the history item.");
                };
            } catch (e) {
                console.error("Delete History Item Error:", e);
            }
        };

        // মোডাল ওপেন লজিক
        window.openMetadataHistoryModal = async function () {
            const modal = document.getElementById('metadataHistoryModal');
            const list = document.getElementById('metadataHistoryList');
            const upsell = document.getElementById('metadataHistoryUpsell');
            const limitText = document.getElementById('metadataHistoryTierLimitText');
            const searchInput = document.getElementById('historySearchInput');

            if (searchInput) searchInput.value = '';
            modal.style.display = 'flex';
            list.innerHTML = '<div style="text-align: center; margin-top: 40px; color: var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Fetching history database...</div>';

            try {
                let currentPlan = 'free';
                if (window.userUsageData) {
                    const rawPlan = String(window.userUsageData.plan || '').toLowerCase();
                    if (rawPlan.includes('premium') || window.userUsageData.limit >= 100) currentPlan = 'premium';
                    else if (rawPlan.includes('pro')) currentPlan = 'pro';
                }

                let limitMs = 24 * 60 * 60 * 1000;
                if (currentPlan === 'pro') limitMs = 30 * 24 * 60 * 60 * 1000;
                if (currentPlan === 'premium') limitMs = Infinity;

                if (currentPlan === 'free') limitText.textContent = "Free tier is limited to last 24hrs history.";
                else if (currentPlan === 'pro') limitText.textContent = "Pro tier is limited to last 30 days history.";

                const allHistory = typeof window.SessionDB !== 'undefined' ? await window.SessionDB.loadMetadataHistory() : [];
                allHistory.sort((a, b) => b.timestamp - a.timestamp);
                window.cachedHistory = allHistory;

                let visibleItems = [];
                let hasHiddenBlocks = false;

                allHistory.forEach(item => {
                    const age = Date.now() - (item.timestamp || 0);
                    if (age <= limitMs) {
                        visibleItems.push(item);
                    } else {
                        hasHiddenBlocks = true;
                    }
                });

                window.renderHistoryItems(visibleItems);

                if (hasHiddenBlocks && currentPlan !== 'premium') {
                    upsell.style.display = 'block';
                } else {
                    upsell.style.display = 'none';
                }

            } catch (e) {
                list.innerHTML = '<div style="color:#EF4444; text-align:center;"><i class="fas fa-exclamation-triangle"></i> Error loading history.</div>';
                console.error(e);
            }
        };

        // হিস্ট্রি আইটেম রেন্ডার লজিক
        window.renderHistoryItems = function (items) {
            const list = document.getElementById('metadataHistoryList');
            if (!list) return;

            if (items.length === 0) {
                list.innerHTML = '<div style="text-align: center; margin-top: 40px; color: var(--text-muted);"><i class="fas fa-folder-open"></i> No matching history records found.</div>';
                return;
            }

            let html = `
            <style>
                .hist-card {
                    display: flex; gap: 16px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; align-items: flex-start; transition: transform 0.2s, box-shadow 0.2s; box-shadow: var(--shadow-sm);
                }
                .hist-thumb {
                    width: 100px; height: 100px; background: var(--bg-input); border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid var(--border-color);
                }
                .hist-content {
                    flex-grow: 1; display: flex; flex-direction: column; justify-content: space-between; min-width: 0;
                }
                .hist-actions {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                    border-top: 1px solid rgba(255,255,255,0.05);
                    padding-top: 10px;
                    justify-content: flex-start;
                }
                .hist-actions > button {
                    flex: 1 1 auto;
                    min-width: 70px;
                    padding: 6px 8px;
                    font-size: 0.75em;
                    font-weight: 600;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: 0.2s;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 5px;
                    white-space: nowrap;
                }
                @media (max-width: 600px) {
                    .hist-card {
                        flex-direction: column;
                        align-items: center;
                        text-align: center;
                    }
                    .hist-thumb {
                        width: 100%;
                        height: 160px;
                    }
                    .hist-content {
                        width: 100%;
                    }
                    .hist-actions {
                        justify-content: center;
                    }
                }
            </style>
            `;

            items.forEach(item => {
                let dateStr = 'Unknown Date';
                if (item.timestamp) {
                    try {
                        const d = new Date(item.timestamp);
                        if (!isNaN(d.getTime())) {
                            dateStr = d.toLocaleString();
                        }
                    } catch (e) { }
                }

                // Handle keywords if it is an array or string
                let kwString = '';
                if (typeof item.keywords === 'string') {
                    kwString = item.keywords;
                } else if (Array.isArray(item.keywords)) {
                    kwString = item.keywords.join(', ');
                }

                const safeItemString = encodeURIComponent(JSON.stringify({
                    ...item,
                    keywords: kwString // Normalize keywords inside safe item string
                }));

                const kwArray = kwString.split(',').map(k => k.trim()).filter(Boolean);

                html += `
                    <div class="hist-card">
                        <!-- Thumbnail -->
                        <div class="hist-thumb">
                            ${item.thumbnail ? `<img src="${item.thumbnail}" style="width: 100%; height: 100%; object-fit: cover;" alt="thumb" />` : '<i class="fas fa-file-image" style="font-size: 2em; color: var(--text-muted);"></i>'}
                        </div>
                        <!-- Metadata Column -->
                        <div class="hist-content">
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 10px; flex-wrap: wrap;">
                                    <span style="font-size: 0.8em; color: var(--text-muted); font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;" title="${item.name}">${item.name}</span>
                                    <span style="font-size: 0.75em; color: var(--text-muted); white-space: nowrap;">${dateStr}</span>
                                </div>
                                <div style="font-weight: 700; font-size: 1.05em; color: var(--text-primary); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.title}">${item.title || 'Untitled'}</div>
                                <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${item.description}">${item.description || 'No description available'}</div>
                            </div>
                            <!-- Tags & Actions -->
                            <div>
                                <div style="font-size: 0.8em; color: var(--accent-orange); display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; max-height: 40px; overflow: hidden; justify-content: inherit;">
                                    ${kwArray.slice(0, 8).map(k => `<span style="background: var(--bg-input); padding: 2px 6px; border-radius: 4px; font-size: 0.85em; border: 1px solid rgba(255,255,255,0.05);">${k}</span>`).join('')}
                                    ${kwArray.length > 8 ? `<span style="font-size:0.8em; color: var(--text-muted); align-self: center;">+${kwArray.length - 8} more</span>` : ''}
                                </div>
                                <div class="hist-actions">
                                    <button class="action-button" onclick="window.copyHistoryField(this, '${safeItemString}', 'title')" style="background: rgba(139, 92, 246, 0.1); color: #8B5CF6;"><i class="fas fa-copy"></i> Title</button>
                                    <button class="action-button" onclick="window.copyHistoryField(this, '${safeItemString}', 'description')" style="background: rgba(139, 92, 246, 0.1); color: #8B5CF6;"><i class="fas fa-copy"></i> Desc</button>
                                    <button class="action-button" onclick="window.copyHistoryField(this, '${safeItemString}', 'keywords')" style="background: rgba(139, 92, 246, 0.1); color: #8B5CF6;"><i class="fas fa-copy"></i> Keywords</button>
                                    <button class="action-button" onclick="window.restoreHistoryItemToGrid('${safeItemString}')" style="background: rgba(16, 185, 129, 0.15); color: #10B981;"><i class="fas fa-plus-circle"></i> Load</button>
                                    <button class="action-button" onclick="window.deleteHistoryItem('${(item.id || '').replace(/'/g, "\\'")}')" style="background: rgba(239, 68, 68, 0.1); color: #EF4444;"><i class="fas fa-trash-alt"></i> Delete</button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
            list.innerHTML = html;
        };

        // মোডাল ক্লোজ
        window.closeMetadataHistoryModal = function () {
            document.getElementById('metadataHistoryModal').style.display = 'none';
        };

        // --- 🩹 OPTIMIZED WORKSPACE RESTORE ENGINE ---
        window.updateDescription = function (element) {
            const card = element.closest('.file-preview-card');
            if (!card) return;
            const cardId = card.id;

            const fileData = uploadedFilesData.find(f => f.id === cardId);
            if (!fileData) return;

            fileData.description = element.innerText.trim();

            // Update Count
            const count = fileData.description.split(/\s+/).filter(w => w.length > 0).length;
            const countElem = document.getElementById(`desc-count-${card.id}`);
            if (countElem) countElem.textContent = `(${count})`;

            // Update SEO Score
            if (typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
                const score = calculateSeoScore(fileData);
                updateSeoMeter(cardId, score);
            }
        };

        window.restoreHistoryItemToGrid = function (encodedItem) {
            try {
                const item = JSON.parse(decodeURIComponent(encodedItem));
                if (!item) return;

                const previewContainer = document.getElementById('filePreviewContainer');
                if (!previewContainer) {
                    alert("Preview container not found.");
                    return;
                }

                // ডুপ্লিকেট এড়াতে ফাইলটি অলরেডি গ্রিডে সক্রিয় আছে কি না চেক করুন
                let existing = window.uploadedFilesData.find(f => f.name === item.name);

                if (existing) {
                    existing.title = item.title;
                    existing.description = item.description;
                    existing.keywords = item.keywords;
                    existing.status = 'success';

                    // সরাসরি চলমান DOM উপাদান আপডেট করুন
                    const cardDOM = document.getElementById(existing.id);
                    if (cardDOM) {
                        const metaCol = cardDOM.querySelector('.card-meta-col');
                        if (metaCol) metaCol.style.display = 'flex';
                        const tEl = cardDOM.querySelector('.meta-title');
                        if (tEl) tEl.textContent = item.title;
                        const dEl = cardDOM.querySelector('.meta-description');
                        const dSection = document.getElementById('desc-section-' + existing.id);
                        if (dEl) {
                            if (dSection) dSection.style.display = item.description ? 'block' : 'none';
                            dEl.textContent = item.description;
                        }
                        if (typeof window.updateKeywordsDisplay === 'function') {
                            window.updateKeywordsDisplay(existing.id);
                        }
                        cardDOM.style.borderColor = "#10B981";
                        cardDOM.classList.add('metadata-generated');
                        cardDOM.classList.remove('processing');

                        const titleCountElem = document.getElementById(`title-count-${existing.id}`);
                        if (titleCountElem && item.title) {
                            const count = item.title.split(/\s+/).filter(w => w.length > 0).length;
                            titleCountElem.textContent = `(${count})`;
                        }

                        const descCountElem = document.getElementById(`desc-count-${existing.id}`);
                        if (descCountElem && item.description) {
                            const count = item.description.split(/\s+/).filter(w => w.length > 0).length;
                            descCountElem.textContent = `(${count})`;
                        }
                    }
                    alert(`Metadata updated for active file: ${item.name}`);
                } else {
                    // একটি ভার্চুয়াল ফাইল অবজেক্ট তৈরি করুন
                    const mockFile = new File([""], item.name, { type: "image/jpeg" });
                    const cardId = 'file-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);

                    const fileData = {
                        id: cardId,
                        name: item.name,
                        fileObject: mockFile,
                        title: item.title,
                        description: item.description,
                        keywords: item.keywords,
                        status: 'success',
                        thumbnail: item.thumbnail
                    };

                    window.uploadedFilesData.push(fileData);

                    // সরাসরি মেমরি থাম্বনেইল ব্যবহার করে নতুন DOM কার্ড তৈরি করুন
                    const card = document.createElement('div');
                    card.className = 'file-preview-card metadata-generated success';
                    card.id = cardId;
                    card.style.borderColor = "#10B981";

                    const placeholderSrc = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48L3N2Zz4=`;
                    const finalImgSrc = item.thumbnail || placeholderSrc;

                    card.innerHTML = `
                        <div class="card-image-col">
                            <div class="card-checkbox-container">
                                <input type="checkbox" class="bulk-checkbox" data-file-id="${cardId}" onchange="window.handleCheckboxChange()">
                            </div>
                            <div class="card-image-actions">
                                <button class="card-image-action-btn regenerate" title="Regenerate" onclick="regenerateMetadata(this)"><span style="font-size:1.1em;">&#x21bb;</span></button>
                                <button class="card-image-action-btn close" title="Close" onclick="closeCard(this)"><span style="font-size:1.1em;">&#x2716;</span></button>
                            </div>
                            <img loading='lazy' src="${finalImgSrc}" alt="${item.name}" class="thumbnail-medium" style="position: relative; overflow: hidden; border-radius: 12px; width: 100%; height: auto; aspect-ratio: 1; object-fit: cover;">
                            
                            <div class="image-properties-overlay">
                                <div class="prop-row"><span class="prop-label">Name:</span><span class="prop-value">${item.name}</span></div>
                                <div class="prop-row"><span class="prop-label">Size:</span><span class="prop-value">Restored</span></div>
                                <div class="prop-row"><span class="prop-label">Dims:</span><span class="prop-value">Restored</span></div>
                            </div>

                            <!-- SEO Score Meter -->
                            <div class="seo-meter-container" id="seo-meter-${cardId}" style="display:none;">
                                <div class="locked-overlay" id="seo-lock-${cardId}" style="display:none;" onclick="showProUpgradeAlert()">
                                    <div class="lock-icon" title="Pro Feature">🔒</div>
                                </div>
                                <div class="seo-score-header">
                                    <span><span data-i18n="seo_score">SEO Score</span><button class="seo-info-icon" onclick="openSeoInfoModal()" title="Learn how to improve SEO Score">i</button></span>
                                    <span class="seo-badge excellent" id="seo-badge-${cardId}">0 / 100 🟢 Excellent</span>
                                </div>
                                <div class="seo-progress-bg">
                                    <div class="seo-progress-fill excellent" id="seo-progress-${cardId}" style="width: 0%;"></div>
                                </div>
                                <div class="seo-suggestions" id="seo-suggestions-${cardId}" style="color:var(--text-muted); font-size:0.75em; margin-top:8px; display:none; flex-direction:column; gap:4px; padding:6px; border-radius:4px; background:var(--bg-tertiary); border: 1px dashed var(--border-color);"></div>
                            </div>

                            <div class="card-filename" style="display:none;">${item.name}</div>
                        </div>
                        <div class="card-meta-col" style="display: flex;">
                            <div class="meta-translation-controls" style="margin-bottom: 15px; padding: 6px; background: var(--bg-input); border-radius: 6px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; gap: 10px; align-items: center;">
                                    <span style="font-size: 0.7em; color: var(--text-muted);"><i class="fas fa-language"></i> <span data-i18n="translate">Translate</span>:</span>
                                    <select id="translate-lang-${cardId}" style="padding: 4px 8px; border-radius: 4px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color);">
                                         <option value="en">English</option>
                                         <option value="es">Spanish</option>
                                         <option value="fr">French</option>
                                         <option value="de">German</option>
                                         <option value="ja">Japanese</option>
                                         <option value="pt">Portuguese</option>
                                         <option value="it">Italian</option>
                                         <option value="bn">Bengali</option>
                                         <option value="hi">Hindi</option>
                                         <option value="ar">Arabic</option>
                                         <option value="zh">Chinese</option>
                                         <option value="ko">Korean</option>
                                         <option value="id">Indonesian</option>
                                    </select>
                                    <button class="action-button blue-button" style="padding: 4px 12px; font-size: 0.65em; white-space: nowrap; flex-shrink: 0;" onclick="translateMetadata('${cardId}')"><span data-i18n="go">Go</span></button>
                                </div>
                            </div>
                            <div class="meta-section">
                                <div class="meta-section-label"><span><span data-i18n="label_title">Title</span> <span id="title-count-${cardId}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'title')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                                <div class="meta-title" contenteditable="true" oninput="window.updateTitle(this)">${item.title || ''}</div>
                            </div>
                            <div class="meta-section" id="desc-section-${cardId}" style="${item.description ? 'display: block;' : 'display: none;'}">
                                <div class="meta-section-label"><span><span data-i18n="label_desc">Description</span> <span id="desc-count-${cardId}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'description')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                                <div class="meta-description" contenteditable="true" oninput="window.updateDescription(this)">${item.description || ''}</div>
                            </div>
                            <div class="meta-section">
                                <div class="meta-section-label"><span><span data-i18n="label_keywords">Keywords</span> <span id="keyword-count-${cardId}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'keywords')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                                <div class="meta-keywords"></div>
                                <div class="keyword-add-container">
                                    <input type="text" class="keyword-add-input" data-i18n="placeholder_add_kw" placeholder="Add keyword..." id="keyword-input-${cardId}" onkeypress="if(event.key === 'Enter') addKeyword('${cardId}')">
                                    <button class="keyword-add-btn" style='white-space: nowrap; flex-shrink: 0;' onclick="addKeyword('${cardId}')">+ <span data-i18n="btn_add">Add</span></button>
                                </div>
                                <div class="keyword-preset-container" style="margin-top: 8px; display: flex; gap: 8px; align-items: center;">
                                    <select class="preset-select-dropdown" data-card-id="${cardId}" onchange="window.applyPresetToCard('${cardId}', this.value)" style="flex: 1; padding: 4px 8px; border-radius: 4px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); font-size: 0.72em;">
                                        <option value="">📁 Apply Preset/Templates...</option>
                                    </select>
                                    <button class="action-button blue-button" onclick="window.savePresetFromCard('${cardId}')" title="Save current keywords as preset template" style="padding: 4px 8px; font-size: 0.72em; margin-top: 0; white-space: nowrap; flex-shrink: 0;">
                                        <i class="fas fa-save"></i> Save Preset
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;

                    previewContainer.appendChild(card);

                    // ওয়ার্ড কাউন্টার মান সেট
                    const titleCountElem = document.getElementById(`title-count-${cardId}`);
                    if (titleCountElem && item.title) {
                        const count = item.title.split(/\s+/).filter(w => w.length > 0).length;
                        titleCountElem.textContent = `(${count})`;
                    }

                    const descCountElem = document.getElementById(`desc-count-${cardId}`);
                    if (descCountElem && item.description) {
                        const count = item.description.split(/\s+/).filter(w => w.length > 0).length;
                        descCountElem.textContent = `(${count})`;
                    }

                    // কিওয়ার্ড পিলগুলো তৈরি করুন
                    if (typeof window.updateKeywordsDisplay === 'function') {
                        window.updateKeywordsDisplay(cardId);
                    }

                    // এসইও স্কোর আপডেট
                    if (typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
                        const seoScore = calculateSeoScore(fileData);
                        updateSeoMeter(cardId, seoScore);
                    }

                    alert(`Restored ${item.name} into the active workspace.`);
                }

                window.closeMetadataHistoryModal();

                // আপলোড এরিয়া হাইড করুন এবং প্রসেসিং এরিয়া দেখান
                const uploadSection = document.querySelector('.file-upload-section');
                const addMoreBtn = document.getElementById('addMoreFilesButton');
                const processingArea = document.querySelector('.file-processing-area');
                if (uploadSection) uploadSection.style.display = 'none';
                if (addMoreBtn) addMoreBtn.style.display = 'inline-flex';
                if (processingArea) processingArea.style.display = 'block';

                // বাটন অ্যাক্টিভেশন স্ট্যাটাস আপডেট
                if (typeof updateAllButtonStates === 'function') {
                    updateAllButtonStates();
                }

            } catch (err) {
                console.error("Restore failed:", err);
                alert("Could not restore item to workspace.");
            }
        };

        // =====================================================
        // ========== AI BACKGROUND REMOVAL (ClipDrop) =========
        // =====================================================
        let bgRemoveFilesData = [];

        function loadBgRemoveImages(event) {
            handleBgRemoveFiles(event.target.files);
            event.target.value = '';
        }

        function handleBgRemoveDrop(event) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.style.borderColor = 'var(--border-color)';
            handleBgRemoveFiles(event.dataTransfer.files);
        }

        function handleBgRemoveFiles(files) {
            if (!files || files.length === 0) return;

            // Plan Check
            const currentPlan = window.userUsageData?.plan?.toLowerCase() || 'free';
            if (currentPlan !== 'pro' && currentPlan !== 'premium' && currentPlan !== 'agency') {
                alert("Remove Background is a PRO/PREMIUM feature. Please upgrade your plan.");
                if (typeof scrollToPricing === 'function') scrollToPricing();
                return;
            }

            document.getElementById('bgRemoveUploadArea').style.display = 'none';
            document.getElementById('bgRemoveWorkspace').style.display = 'block';

            Array.from(files).forEach(file => {
                if (!file.type.startsWith('image/')) return;

                const id = 'bgrm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                bgRemoveFilesData.push({
                    id: id,
                    file: file,
                    processedBlob: null,
                    status: 'pending'
                });

                const reader = new FileReader();
                reader.onload = (e) => {
                    const fileData = bgRemoveFilesData.find(f => f.id === id);
                    if (fileData) {
                        fileData.originalDataUrl = e.target.result;
                        renderBgRemoveGrid();
                    }
                };
                reader.readAsDataURL(file);
            });
        }

        function renderBgRemoveGrid() {
            const grid = document.getElementById('bgRemoveGrid');
            document.getElementById('bgRemoveCount').innerText = bgRemoveFilesData.length;
            grid.innerHTML = '';

            bgRemoveFilesData.forEach(item => {
                const imgSrc = item.processedBlob ? URL.createObjectURL(item.processedBlob) : item.originalDataUrl;
                let statusHtml = '';
                if (item.status === 'processing') statusHtml = '<div style="position:absolute; top:5px; left:5px; background:rgba(0,0,0,0.6); color:white; padding:4px 8px; border-radius:6px; font-size:0.75em; font-weight:bold; z-index:5;"><i class="fas fa-spinner fa-spin"></i> Processing</div>';
                else if (item.status === 'success') statusHtml = '<div style="position:absolute; top:5px; left:5px; background:#10B981; color:white; padding:4px 8px; border-radius:6px; font-size:0.75em; font-weight:bold; z-index:5;"><i class="fas fa-check"></i> Done</div>';
                else if (item.status === 'error') statusHtml = '<div style="position:absolute; top:5px; left:5px; background:#EF4444; color:white; padding:4px 8px; border-radius:6px; font-size:0.75em; font-weight:bold; z-index:5;"><i class="fas fa-times"></i> Error</div>';

                let actionButtons = '';
                if (item.status === 'success') {
                    actionButtons = `
                <button onclick="downloadBgRemoved('${item.id}')" class="action-button green-button" style="width:100%; padding:8px; font-size:0.85em; margin-bottom:8px; display:flex; justify-content:center; gap:6px;"><i class="fas fa-download"></i> Download PNG</button>
                <button onclick="sendBgRemovedToMeta('${item.id}')" class="action-button blue-button" style="width:100%; padding:8px; font-size:0.85em; display:flex; justify-content:center; gap:6px;"><i class="fas fa-share-square"></i> Send Metadata</button>
            `;
                } else {
                    actionButtons = `<button onclick="processSingleBgRemove('${item.id}')" class="action-button orange-button" style="width:100%; padding:8px; font-size:0.85em; display:flex; justify-content:center; gap:6px;" ${item.status === 'processing' ? 'disabled' : ''}><i class="fas fa-cut"></i> Remove BG</button>`;
                }

                grid.innerHTML += `
            <div id="${item.id}" style="background:var(--bg-input); border:1px solid var(--border-color); border-radius:12px; overflow:hidden; display:flex; flex-direction:column; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="position:relative; height:180px; background:repeating-conic-gradient(#80808033 0 25%, transparent 0 50%) 50% / 20px 20px;">
                    <button onclick="window.removeSingleBgRemoveItem('${item.id}')" title="Remove Image" style="position:absolute; top:5px; right:5px; background:rgba(239, 68, 68, 0.85); color:white; border:none; border-radius:50%; width:26px; height:26px; cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:10; transition: background 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 1)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.85)'"><i class="fas fa-times"></i></button>
                    <img src="${imgSrc}" style="width:100%; height:100%; object-fit:contain;" />
                    ${statusHtml}
                </div>
                <div style="padding:15px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
                    <div style="font-size:0.85em; font-weight:600; margin-bottom:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text-primary);" title="${item.file.name}">${item.file.name}</div>
                    <div>
                        ${actionButtons}
                    </div>
                </div>
            </div>
        `;
            });
        }

        window.removeSingleBgRemoveItem = function (id) {
            bgRemoveFilesData = bgRemoveFilesData.filter(f => f.id !== id);
            if (bgRemoveFilesData.length === 0) {
                clearBgRemoveWorkspace();
            } else {
                renderBgRemoveGrid();
            }
        };

        function clearBgRemoveWorkspace() {
            bgRemoveFilesData = [];
            document.getElementById('bgRemoveWorkspace').style.display = 'none';
            document.getElementById('bgRemoveUploadArea').style.display = 'block';
            renderBgRemoveGrid();
        }

        async function processSingleBgRemove(id) {
            const item = bgRemoveFilesData.find(f => f.id === id);
            if (!item || item.status === 'success') return;

            item.status = 'processing';
            renderBgRemoveGrid();

            try {
                const user = firebase.auth().currentUser;
                if (!user) throw new Error("Please login first");
                const idToken = await user.getIdToken();

                const formData = new FormData();
                formData.append('image_file', item.file);

                // Note: Make sure 'remove-background' endpoint is configured in your Cloudflare worker pointing to Clipdrop.
                const response = await fetch('https://metagen-pro-api.metagenp.workers.dev/clipdrop/remove-background', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + idToken },
                    body: formData
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || 'API Error: Check Clipdrop balance or config');
                }

                const blob = await response.blob();
                item.processedBlob = blob;
                item.status = 'success';

            } catch (err) {
                console.error("BG Remove Error:", err);
                item.status = 'error';
                alert(`Failed to remove background for ${item.file.name}: ${err.message}`);
            } finally {
                renderBgRemoveGrid();
            }
        }

        async function processBgRemovalBatch() {
            const pendingItems = bgRemoveFilesData.filter(f => f.status !== 'success');
            if (pendingItems.length === 0) {
                alert("All images are already processed!");
                return;
            }

            const loadingEl = document.getElementById('bgRemoveLoading');
            const processBtn = document.getElementById('bgRemoveProcessAllBtn');

            loadingEl.style.display = 'block';
            processBtn.disabled = true;

            // Concurrent processing (2 at a time to prevent API rate limiting)
            const CONCURRENCY = 2;
            for (let i = 0; i < pendingItems.length; i += CONCURRENCY) {
                const chunk = pendingItems.slice(i, i + CONCURRENCY);
                await Promise.all(chunk.map(item => processSingleBgRemove(item.id)));
                await new Promise(r => setTimeout(r, 1000)); // Rate limit delay
            }

            loadingEl.style.display = 'none';
            processBtn.disabled = false;
            alert("Batch Background Removal Complete!");
        }

        function downloadBgRemoved(id) {
            const item = bgRemoveFilesData.find(f => f.id === id);
            if (!item || !item.processedBlob) return;

            const url = URL.createObjectURL(item.processedBlob);
            const a = document.createElement('a');
            a.href = url;
            const baseName = item.file.name.substring(0, item.file.name.lastIndexOf('.')) || item.file.name;
            a.download = baseName + '_nobg.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        function sendBgRemovedToMeta(id) {
            const item = bgRemoveFilesData.find(f => f.id === id);
            if (!item || !item.processedBlob) return;

            const baseName = item.file.name.substring(0, item.file.name.lastIndexOf('.')) || item.file.name;
            const newFile = new File([item.processedBlob], baseName + '_nobg.png', { type: 'image/png' });

            // Push directly to Metadata Generator queue
            if (typeof handleFiles === 'function') {
                handleFiles([newFile]);

                // Auto-switch to metadata section
                const metaTabBtn = document.querySelector('.mode-button[data-section="meta"]');
                if (metaTabBtn) {
                    metaTabBtn.click();
                    // Scroll top
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            }
        }



        // =============================================
        // SEO AUTO-FIX HANDLER
        // =============================================
        window.fixSeoIssue = async function (cardId, fixType) {
            const fileData = uploadedFilesData.find(f => f.id === cardId);
            if (!fileData) return;

            const card = document.getElementById(cardId);
            if (!card) return;

            let fixBtn = null;
            const suggestionsContainer = document.getElementById(`seo-suggestions-${cardId}`);
            if (suggestionsContainer) {
                const buttons = suggestionsContainer.querySelectorAll('button');
                buttons.forEach(btn => {
                    if (btn.textContent.includes('Fix') && btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(fixType)) {
                        fixBtn = btn;
                    }
                });
            }

            let originalBtnHtml = fixBtn ? fixBtn.innerHTML : '';
            if (fixBtn) {
                fixBtn.innerHTML = '⚡ Fixing...';
                fixBtn.disabled = true;
            }

            let changed = false;

            if (fixType === 'trim_title' || fixType === 'trim_desc') {
                const user = typeof auth !== 'undefined' ? auth.currentUser : null;
                let authHeaders = {};
                if (user) {
                    try {
                        const token = await user.getIdToken();
                        authHeaders["Authorization"] = `Bearer ${token}`;
                    } catch (e) {
                        console.warn("Could not get ID token:", e);
                    }
                }

                const valueToFix = fixType === 'trim_title' ? (fileData.title || '') : (fileData.description || '');

                try {
                    const response = await fetch("https://metagen-pro-api.metagenp.workers.dev/api/fix-seo-issue", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            ...authHeaders
                        },
                        body: JSON.stringify({
                            fixType: fixType,
                            text: valueToFix
                        })
                    });

                    if (!response.ok) {
                        const errData = await response.json().catch(() => ({}));
                        throw new Error(errData.error || `HTTP ${response.status}`);
                    }

                    const data = await response.json();
                    if (data.success && data.fixedText) {
                        if (fixType === 'trim_title') {
                            fileData.title = data.fixedText.trim();
                            const titleEl = card.querySelector('.meta-title');
                            if (titleEl) titleEl.textContent = fileData.title;
                            const titleCount = document.getElementById(`title-count-${cardId}`);
                            if (titleCount) {
                                const count = fileData.title.split(/\s+/).filter(w => w.length > 0).length;
                                titleCount.textContent = `(${count})`;
                            }
                            if (typeof showCustomAlert === 'function') showCustomAlert(`✨ Title optimized using AI to ${fileData.title.length} characters.`, 'success');
                        } else {
                            fileData.description = data.fixedText.trim();
                            const descEl = card.querySelector('.meta-description');
                            if (descEl) descEl.textContent = fileData.description;
                            const descCount = document.getElementById(`desc-count-${cardId}`);
                            if (descCount) {
                                const count = fileData.description.split(/\s+/).filter(w => w.length > 0).length;
                                descCount.textContent = `(${fileData.description.length})`;
                            }
                            if (typeof showCustomAlert === 'function') showCustomAlert(`✨ Description optimized using AI to ${fileData.description.length} characters.`, 'success');
                        }
                        changed = true;
                    } else {
                        throw new Error("Invalid response format");
                    }
                } catch (error) {
                    console.error("AI SEO Fix failed, falling back to smart trim:", error);
                    if (fixType === 'trim_title') {
                        let title = (fileData.title || '').trim();
                        if (title.length > 70) {
                            let trimmed = title.substring(0, 70);
                            const lastSpace = trimmed.lastIndexOf(' ');
                            if (lastSpace > 30) trimmed = trimmed.substring(0, lastSpace);
                            fileData.title = trimmed;
                            const titleEl = card.querySelector('.meta-title');
                            if (titleEl) titleEl.textContent = fileData.title;
                            const titleCount = document.getElementById(`title-count-${cardId}`);
                            if (titleCount) {
                                const count = fileData.title.split(/\s+/).filter(w => w.length > 0).length;
                                titleCount.textContent = `(${count})`;
                            }
                            changed = true;
                        }
                    } else {
                        let desc = (fileData.description || '').trim();
                        if (desc.length > 160) {
                            let trimmed = desc.substring(0, 155);
                            const lastPeriod = trimmed.lastIndexOf('.');
                            if (lastPeriod > 80) {
                                trimmed = trimmed.substring(0, lastPeriod + 1);
                            } else {
                                const lastSpace = trimmed.lastIndexOf(' ');
                                if (lastSpace > 80) trimmed = trimmed.substring(0, lastSpace);
                            }
                            fileData.description = trimmed;
                            const descEl = card.querySelector('.meta-description');
                            if (descEl) descEl.textContent = fileData.description;
                            const descCount = document.getElementById(`desc-count-${cardId}`);
                            if (descCount) descCount.textContent = `(${fileData.description.length})`;
                            changed = true;
                        }
                    }
                }
            } else {
                switch (fixType) {
                    case 'remove_duplicates': {
                        let keywords = Array.isArray(fileData.keywords)
                            ? fileData.keywords
                            : (fileData.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
                        const seen = new Set();
                        const unique = [];
                        keywords.forEach(kw => {
                            const lower = kw.toLowerCase();
                            if (!seen.has(lower)) {
                                seen.add(lower);
                                unique.push(kw);
                            }
                        });
                        const removedCount = keywords.length - unique.length;
                        if (removedCount > 0) {
                            fileData.keywords = unique;
                            if (typeof window.updateKeywordsDisplay === 'function') window.updateKeywordsDisplay(cardId);
                            changed = true;
                            if (typeof showCustomAlert === 'function') showCustomAlert(`🗑️ Removed ${removedCount} duplicate keyword(s).`, 'success');
                        }
                        break;
                    }

                    case 'fix_title_stuffing': {
                        let title = (fileData.title || '').trim();
                        const words = title.split(/\s+/);
                        const wordCount = {};
                        const cleaned = [];
                        words.forEach(w => {
                            const lower = w.toLowerCase();
                            wordCount[lower] = (wordCount[lower] || 0) + 1;
                            if (lower.length <= 3 || wordCount[lower] <= 2) {
                                cleaned.push(w);
                            }
                        });
                        const newTitle = cleaned.join(' ');
                        if (newTitle !== title) {
                            fileData.title = newTitle;
                            const titleEl = card.querySelector('.meta-title');
                            if (titleEl) titleEl.textContent = fileData.title;
                            const titleCount = document.getElementById(`title-count-${cardId}`);
                            if (titleCount) {
                                const count = fileData.title.split(/\s+/).filter(w => w.length > 0).length;
                                titleCount.textContent = `(${count})`;
                            }
                            changed = true;
                            if (typeof showCustomAlert === 'function') showCustomAlert('🧹 Removed repeated words from title.', 'success');
                        }
                        break;
                    }
                }
            }

            if (fixBtn) {
                fixBtn.innerHTML = originalBtnHtml;
                fixBtn.disabled = false;
            }

            if (changed && typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
                const newSeo = calculateSeoScore(fileData);
                updateSeoMeter(cardId, newSeo);
                if (typeof window.scheduleSessionSave === 'function') {
                    window.scheduleSessionSave();
                }
            }
        };


        // =============================================
        // DAILY STREAK TRACKER SYSTEM
        // =============================================
        (function initStreakSystem() {
            const STREAK_KEY = 'metagen_streak_data';

            function getStreakData() {
                try {
                    return JSON.parse(localStorage.getItem(STREAK_KEY)) || { currentStreak: 0, lastActiveDate: null, bonusClaimed: {} };
                } catch { return { currentStreak: 0, lastActiveDate: null, bonusClaimed: {} }; }
            }

            function saveStreakData(data) {
                localStorage.setItem(STREAK_KEY, JSON.stringify(data));
            }

            function getTodayDateStr() {
                return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            }

            function getYesterdayDateStr() {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                return d.toISOString().split('T')[0];
            }

            function refreshStreakOnLoad() {
                const data = getStreakData();
                const today = getTodayDateStr();
                const yesterday = getYesterdayDateStr();

                if (data.lastActiveDate === today) {
                    // Already active today, just render
                } else if (data.lastActiveDate === yesterday) {
                    // Streak continues but not yet marked for today
                } else if (data.lastActiveDate) {
                    // Streak broken - reset
                    data.currentStreak = 0;
                    data.bonusClaimed = {};
                    saveStreakData(data);
                }
                renderStreakUI(data);
            }

            window.recordStreakActivity = function () {
                const data = getStreakData();
                const today = getTodayDateStr();

                if (data.lastActiveDate === today) return; // Already recorded today

                const yesterday = getYesterdayDateStr();
            if (data.lastActiveDate === yesterday || !data.lastActiveDate) {
                // [NEW LOGIC] ৭ দিন পূর্ণ হলে পরের দিন অটোমেটিক আবার Day 1 থেকে শুরু হবে
                if (data.currentStreak >= 7) {
                    data.currentStreak = 1;
                    data.bonusClaimed = {}; // আগের বোনাস হিস্ট্রি ক্লিয়ার করে নতুন সাইকেল শুরু
                } else {
                    data.currentStreak = (data.currentStreak || 0) + 1;
                }
            } else {
                data.currentStreak = 1; // Streak broken (গ্যাপ দিলে), start fresh
                data.bonusClaimed = {};
            }
            data.lastActiveDate = today;

                // Calculate bonus
                const bonusMap = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 10 };
                const bonus = bonusMap[data.currentStreak] || 0;
                const dayKey = 'day' + data.currentStreak;

                if (bonus > 0 && !data.bonusClaimed[dayKey]) {
                    data.bonusClaimed[dayKey] = true;

                    // 1. Update local limits immediately for UI
                    if (window.userUsageData) {
                        if (typeof window.userUsageData.limit === 'number') {
                            window.userUsageData.limit += bonus; // Increase today's working limit
                        }
                        // Increase total monthly limit locally
                        window.userUsageData.referralBonus = (window.userUsageData.referralBonus || 0) + bonus;
                        if (typeof updateUsageUI === 'function') updateUsageUI();
                    }

                    // 2. 🟢 SAVE PERMANENTLY VIA WORKER API (Secured with Auth) 🟢
                    if (typeof auth !== 'undefined' && auth.currentUser) {
                        (async () => {
                            try {
                                const idToken = await auth.currentUser.getIdToken();
                                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/user/claim-streak-bonus', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': 'Bearer ' + idToken
                                    },
                                    body: JSON.stringify({
                                        streakDay: data.currentStreak,
                                        bonus: bonus
                                    })
                                });
                                const result = await res.json();
                                if (result.success) {
                                    console.log(`Streak bonus +${bonus} permanently saved to database. Total: ${result.totalBonus}`);
                                } else {
                                    console.error("Streak bonus save failed:", result.error || result.message);
                                }
                            } catch (err) {
                                console.error("Failed to save streak bonus:", err);
                            }
                        })();
                    }

                    // 3. Show the new popup modal
                    const rewardModal = document.getElementById('streakRewardModal');
                    if (rewardModal) {
                        const daySpan = document.getElementById('streakRewardDay');
                        const amountSpan = document.getElementById('streakRewardAmount');
                        if (daySpan) daySpan.textContent = data.currentStreak;
                        if (amountSpan) amountSpan.textContent = bonus;
                        
                        rewardModal.style.display = 'flex';
                        
                        // Show confetti animation if available (from JS library)
                        if (typeof confetti === 'function') {
                            confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
                        }
                    } else {
                        // Fallback to Toast if modal HTML is missing
                        if (typeof showCustomAlert === 'function') {
                            showCustomAlert(`🔥 Streak Day ${data.currentStreak}! +${bonus} bonus credit${bonus > 1 ? 's' : ''} earned!`, 'success');
                        } else {
                            const existingToast = document.querySelector('.trial-toast');
                            if (existingToast) existingToast.remove();
                            const toast = document.createElement('div');
                            toast.className = 'trial-toast';
                            toast.innerHTML = `🔥 Streak Day ${data.currentStreak}! +${bonus} bonus credit${bonus > 1 ? 's' : ''} earned!`;
                            document.body.appendChild(toast);
                            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4200);
                        }
                    }
                }

                saveStreakData(data);
                renderStreakUI(data);
            };

            function renderStreakUI(data) {
                const streak = data.currentStreak || 0;
                const label = document.getElementById('streakCountLabel');
                const hint = document.getElementById('streakHint');
                const fill = document.getElementById('streakDotFill');

                if (label) label.textContent = streak + ' Day' + (streak !== 1 ? 's' : '');
                if (fill) fill.style.width = Math.min(streak / 7 * 90, 90) + '%';

                // Update dots
                const dots = document.querySelectorAll('.streak-dot');
                dots.forEach(dot => {
                    const day = parseInt(dot.getAttribute('data-day'));
                    if (day <= streak) {
                        dot.style.background = '#F97316';
                        dot.style.borderColor = '#F97316';
                        dot.style.color = '#fff';
                    } else {
                        dot.style.background = 'var(--bg-secondary)';
                        dot.style.borderColor = 'var(--border-color)';
                        dot.style.color = 'var(--text-muted)';
                    }
                });

                // Update hint
                if (hint) {
                    const today = getTodayDateStr();
                    if (data.lastActiveDate === today) {
                        if (streak >= 7) {
                            hint.innerHTML = '🏆 <b>Streak Master!</b> 7-day streak complete! +10 bonus credits earned!';
                            hint.style.color = '#F97316';
                        } else {
                            hint.innerHTML = `✅ Active today! Come back tomorrow for Day ${streak + 1} bonus.`;
                            hint.style.color = '#10B981';
                        }
                    } else {
                        hint.textContent = 'Process any file today to build your streak!';
                        hint.style.color = 'var(--text-muted)';
                    }
                }
            }

            // Init on page load
            refreshStreakOnLoad();
        })();


        // =============================================
        // KEYWORD PRESETS MANAGER SYSTEM
        // =============================================
        (function initPresetsSystem() {
            const PRESETS_KEY = 'metagen_keyword_presets';

            function getPresets() {
                try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || []; }
                catch { return []; }
            }

            function savePresets(presets) {
                localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
            }

            function renderSidebarPresets() {
                const presets = getPresets();
                const listEl = document.getElementById('sidebarPresetsList');
                if (!listEl) return;

                if (presets.length === 0) {
                    listEl.innerHTML = '<div style="font-size:0.75em; color:var(--text-muted); text-align:center; padding: 10px 0;">No presets saved yet.</div>';
                    return;
                }

                listEl.innerHTML = presets.map((p, i) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:var(--bg-input); border-radius:6px; border:1px solid var(--border-color);">
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:0.8em; font-weight:700; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${p.name}">${p.name}</div>
                            <div style="font-size:0.68em; color:var(--text-muted);">${p.keywords.length} keywords</div>
                        </div>
                        <button onclick="window.deletePreset(${i})" title="Delete" style="border:none; background:none; color:#EF4444; cursor:pointer; font-size:1em; padding:2px 6px;">×</button>
                    </div>
                `).join('');
            }

            function refreshAllPresetDropdowns() {
                const presets = getPresets();
                const dropdowns = document.querySelectorAll('.preset-select-dropdown');
                dropdowns.forEach(dd => {
                    const cardId = dd.getAttribute('data-card-id');
                    // Keep first option, replace rest
                    dd.innerHTML = '<option value="">📁 Apply Preset/Templates...</option>';
                    presets.forEach((p, i) => {
                        const opt = document.createElement('option');
                        opt.value = i;
                        opt.textContent = `${p.name} (${p.keywords.length} kw)`;
                        dd.appendChild(opt);
                    });
                });
            }

            // Save preset from a card's current keywords
            window.savePresetFromCard = function (cardId) {
                const fileData = (typeof uploadedFilesData !== 'undefined') ? uploadedFilesData.find(f => f.id === cardId) : null;
                if (!fileData || !fileData.keywords) {
                    if (typeof showCustomAlert === 'function') showCustomAlert('No keywords to save. Generate metadata first.', 'warning');
                    else alert('No keywords to save. Generate metadata first.');
                    return;
                }

                const keywords = Array.isArray(fileData.keywords) ? fileData.keywords.filter(k => k && k.trim()) : fileData.keywords.split(',').map(k => k.trim()).filter(Boolean);
                if (keywords.length === 0) {
                    if (typeof showCustomAlert === 'function') showCustomAlert('No keywords found on this card.', 'warning');
                    else alert('No keywords found on this card.');
                    return;
                }

                const name = prompt('Enter a name for this preset:', fileData.title || 'My Preset');
                if (!name || !name.trim()) return;

                const presets = getPresets();
                presets.push({ name: name.trim(), keywords: keywords });
                savePresets(presets);
                renderSidebarPresets();
                refreshAllPresetDropdowns();

                if (typeof showCustomAlert === 'function') showCustomAlert(`✅ Preset "${name.trim()}" saved with ${keywords.length} keywords!`, 'success');
            };

            // Apply preset to a card
            window.applyPresetToCard = function (cardId, presetIndex) {
                if (presetIndex === '' || presetIndex === null || presetIndex === undefined) return;
                const presets = getPresets();
                const preset = presets[parseInt(presetIndex)];
                if (!preset) return;

                const fileData = (typeof uploadedFilesData !== 'undefined') ? uploadedFilesData.find(f => f.id === cardId) : null;
                if (!fileData) return;

                // Merge: add preset keywords that don't already exist
                let existing = Array.isArray(fileData.keywords) ? fileData.keywords : (fileData.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
                const existingLower = new Set(existing.map(k => k.toLowerCase()));

                let addedCount = 0;
                preset.keywords.forEach(kw => {
                    if (!existingLower.has(kw.toLowerCase())) {
                        existing.push(kw);
                        existingLower.add(kw.toLowerCase());
                        addedCount++;
                    }
                });

                fileData.keywords = existing;
                if (typeof window.updateKeywordsDisplay === 'function') window.updateKeywordsDisplay(cardId);

                // Reset dropdown
                const dd = document.querySelector(`.preset-select-dropdown[data-card-id="${cardId}"]`);
                if (dd) dd.value = '';

                if (typeof showCustomAlert === 'function') showCustomAlert(`📋 Applied "${preset.name}" — ${addedCount} new keyword${addedCount !== 1 ? 's' : ''} added!`, 'success');
            };

            // Delete preset
            window.deletePreset = function (index) {
                const presets = getPresets();
                if (index < 0 || index >= presets.length) return;
                const name = presets[index].name;
                presets.splice(index, 1);
                savePresets(presets);
                renderSidebarPresets();
                refreshAllPresetDropdowns();
                if (typeof showCustomAlert === 'function') showCustomAlert(`🗑️ Preset "${name}" deleted.`, 'info');
            };

            // Create empty preset from sidebar input
            window.createKeywordPresetFromSidebar = function () {
                const input = document.getElementById('newPresetName');
                const name = input ? input.value.trim() : '';
                if (!name) {
                    if (typeof showCustomAlert === 'function') showCustomAlert('Please enter a preset name.', 'warning');
                    else alert('Please enter a preset name.');
                    return;
                }

                const keywordsStr = prompt('Enter keywords (comma-separated):');
                if (!keywordsStr || !keywordsStr.trim()) return;

                const keywords = keywordsStr.split(',').map(k => k.trim()).filter(Boolean);
                if (keywords.length === 0) return;

                const presets = getPresets();
                presets.push({ name: name, keywords: keywords });
                savePresets(presets);
                if (input) input.value = '';
                renderSidebarPresets();
                refreshAllPresetDropdowns();
                if (typeof showCustomAlert === 'function') showCustomAlert(`✅ Preset "${name}" created with ${keywords.length} keywords!`, 'success');
            };

            // Expose refresh for dynamic card creation
            window.refreshPresetDropdowns = refreshAllPresetDropdowns;

            // Init on load
            renderSidebarPresets();
            refreshAllPresetDropdowns();

            // Also refresh when new cards are created (MutationObserver)
            let _presetRefreshTimer = null;
            let _isRefreshing = false;
            const observer = new MutationObserver(() => {
                if (_isRefreshing) return; // Prevent re-entry
                clearTimeout(_presetRefreshTimer);
                _presetRefreshTimer = setTimeout(() => {
                    _isRefreshing = true;
                    observer.disconnect(); // Stop observing during refresh
                    try {
                        refreshAllPresetDropdowns();
                    } catch (e) { console.warn('Preset refresh error:', e); }
                    // Re-observe after a tick
                    setTimeout(() => {
                        const c = document.getElementById('filePreviewContainer');
                        if (c) observer.observe(c, { childList: true });
                        _isRefreshing = false;
                    }, 50);
                }, 300); // Debounce 300ms
            });
            const container = document.getElementById('filePreviewContainer');
            if (container) observer.observe(container, { childList: true });
        })();

        window.loadReviewStats = function () {
            // LocalStorage থেকে আগের রিভিউ ডেটা লোড করুন অথবা ডিফল্ট 1584 সেট করুন
            let stats = JSON.parse(localStorage.getItem('metagen_review_stats'));
            if (!stats) {
                stats = { count: 1584, totalScore: 1584 * 4.9 };
                localStorage.setItem('metagen_review_stats', JSON.stringify(stats));
            }

            let avg = (stats.totalScore / stats.count).toFixed(1);

            // 5.0 এর উপরে যেন না যায়
            if (parseFloat(avg) > 5.0) avg = "5.0";

            let avgEl = document.getElementById('reviewAvgScore');
            let countEl = document.getElementById('reviewTotalCount');

            if (avgEl) avgEl.innerText = avg;
            if (countEl) countEl.innerText = stats.count.toLocaleString();
        };

        window.openFeedbackWithRating = function (n) {
            const feedbackModal = document.getElementById('feedbackModal');
            if (feedbackModal) {
                feedbackModal.style.display = 'flex';
                if (typeof setRating === 'function') {
                    setRating(n);
                }
                const typeSelect = document.getElementById('feedbackType');
                if (typeSelect) typeSelect.value = 'General Feedback';
            }
        };

        // Star Hover Effects
        window.hoverStars = function (n) {
            const stars = document.querySelectorAll('.review-stars-interactive i');
            stars.forEach((star, index) => {
                if (index < n) {
                    star.style.color = '#F59E0B'; // Highlighted
                    star.style.transform = 'scale(1.1)';
                } else {
                    star.style.color = '#4A5568'; // Muted
                    star.style.transform = 'scale(1)';
                }
            });
        };

        window.resetHoverStars = function () {
            const stars = document.querySelectorAll('.review-stars-interactive i');
            stars.forEach(star => {
                star.style.color = '#F59E0B'; // Reset to default Yellow
                star.style.transform = 'scale(1)';
            });
        };

        document.addEventListener('DOMContentLoaded', function () {
            loadReviewStats();
        });


     
