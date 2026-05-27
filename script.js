<script>
// ===========================================
// SECTION 1: Main App Logic
// ===========================================
        (function () {
            const APP_STABLE_VERSION = "5.3.2"; // আগের যেকোনো ভার্সন থেকে বড় নম্বর দিন
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
                auth.onAuthStateChanged(async (user) => {
                    authUser = user;

                    if (user) {
                        // ইউজার লগইন অবস্থায় থাকলে প্রোফাইল সেভ হবে
                        await saveUserProfile(user);
                    }

                    hideLoadingState();
                    // checkAuthState আপনার অ্যাপের পুরনো লজিকগুলোকে রান করবে
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
                setTimeout(initFirebase, 500);
            }
        }
        initFirebase();

        // --- 🛡️ Admin Dashboard Logic ---
        const ADMIN_EMAILS = ['metagenp@gmail.com', 'pradipcob84@gmail.com'];

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

                const free = stats.freeCount !== undefined ? stats.freeCount : (total - (pro + prem));

                // UI Update
                document.getElementById('adminTotalUsers').innerText = total;
                document.getElementById('adminMRR').innerText = `$${stats.estimatedMRR || 0}`;
                document.getElementById('adminPlanSplit').innerText = `Pro: ${pro} | Prem: ${prem} | Free: ${free}`;
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
                    if (rawPlan.includes('premium')) plan = 'premium';
                    else if (rawPlan.includes('pro')) plan = 'pro';
                } else if (user?.monthlyLimit) {
                    if (user.monthlyLimit >= 3000) plan = 'premium';
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
                        Plan: ${plan === 'premium' ? '100' : plan === 'pro' ? '70' : '10'}/day
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
                updates[field] = value;

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

            if (!sidebar || plan !== 'free' || t.total <= 0) {
                if (sidebar) sidebar.style.display = 'none';
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
                if (remaining <= 0) hint.textContent = '⏰ Trial ended — Upgrade for unlimited!';
                else if (remaining <= 2) hint.textContent = '🔥 Almost done! Use wisely!';
                else hint.textContent = '✨ Pro features unlocked!';
            }

            // Update trial badges on Pro features
            updateTrialBadges(t.active && remaining > 0);
        }

        function updateTrialBadges(isTrialActive) {
            const proButtons = ['embedMetadataButton', 'translateAllBtn', 'batchQualityCheckButton'];
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

            if (plan === 'pro' || plan === 'premium' || isTrialActive) {
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
        }

        function hideLoadingState() {
            const init = document.getElementById('initialLoading');
            if (init) init.classList.add('hidden');
            const lf = document.getElementById('loginFormContainer'); if (lf) lf.style.display = 'block';
            const sf = document.getElementById('signupFormContainer'); if (sf) sf.style.display = 'none';
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
            // Hide the login modal and show main app. If email provided, treat as logged-in.
            document.getElementById('loginModal').classList.add('hidden');
            document.querySelector('.app-container').style.display = 'flex';

            const usageIndicator = document.getElementById('headerUsageLimit');

            // Show header profile icon always so user can open login/profile
            try { document.getElementById('profileHeaderBtn').style.display = 'flex'; } catch (e) { }
            if (email) {
                // --- NEW: Record Referral if exists ---
                const referrerEmailStored = localStorage.getItem('metagen_referrer');
                if (referrerEmailStored) {
                    try {
                        const referrerEmail = referrerEmailStored; // Already decoded

                        if (referrerEmail !== email && referrerEmail.includes('@')) {
                            // Give referral bonus via Firestore (using snake_case to match worker)
                            try {
                                // Check if this user already used a referral (prevent repeat bonus)
                                const currentUserDoc = await db.collection('users').doc(email.toLowerCase()).get();
                                const alreadyReferred = currentUserDoc.exists && currentUserDoc.data()?.referred_by;

                                if (!alreadyReferred) {
                                    // Award bonus to referrer
                                    const refDoc = db.collection('users').doc(referrerEmail);
                                    await refDoc.set({
                                        referral_bonus: firebase.firestore.FieldValue.increment(50)
                                    }, { merge: true });

                                    // Mark current user as referred to prevent repeat
                                    await db.collection('users').doc(email.toLowerCase()).set({
                                        referred_by: referrerEmail
                                    }, { merge: true });

                                    console.log("Referral bonus +50 awarded to:", referrerEmail);
                                } else {
                                    console.log("Referral already processed for this user.");
                                }
                                localStorage.removeItem('metagen_referrer');
                            } catch (error) {
                                console.warn("Referral Firestore error:", error);
                            }
                        } else {
                            // Self-referral attempt or invalid email
                            localStorage.removeItem('metagen_referrer');
                        }
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

                // 📊 Initialize and show usage indicator
                if (usageIndicator) {
                    usageIndicator.style.display = 'flex';
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

                    updateUsageUI();
                }
            } else {
                // Not logged in: hide the small user-profile panel
                document.getElementById('userProfile').classList.remove('visible');
                document.getElementById('userEmail').textContent = '';
                // Reset header profile button
                resetHeaderProfileImage();

                // 📊 Hide usage indicator
                if (usageIndicator) usageIndicator.style.display = 'none';
                if (window.userUsageData) window.userUsageData.email = null;
            }
        }

        // --- NEW: Referral & Sharing Logic ---
        async function handleToolShare() {
            const btn = document.getElementById('referralBtn');
            const originalContent = btn.innerHTML;

            if (!window.userUsageData || !window.userUsageData.email) {
                alert("Please login first to generate your referral link.");
                document.getElementById('loginModal').classList.remove('hidden');
                return;
            }

            try {
                // ১. রেফারেল লিঙ্ক তৈরি
                const encodedEmail = btoa(window.userUsageData.email);
                const referralUrl = `${window.location.origin}${window.location.pathname}?ref=${encodedEmail}`;
                const shareData = {
                    title: 'MetaGen Pro - AI Metadata Generator',
                    text: 'I use MetaGen Pro to generate SEO-friendly metadata for my stock photos. It is super fast and easy!',
                    url: referralUrl
                };

                // ২. শেয়ার মেথড (মোবাইল হলে শেয়ার মেনু খুলবে, পিসি হলে কপি হবে)
                if (navigator.share && navigator.canShare(shareData)) {
                    await navigator.share(shareData);
                } else {
                    await navigator.clipboard.writeText(referralUrl);
                    alert("Referral link copied to clipboard!");
                }

                // ৩. ইউআই আপডেট (লিঙ্ক কপি হওয়া বোঝানোর জন্য)
                btn.innerHTML = '<i class="fas fa-check"></i> Link Copied!';
                btn.style.background = '#10B981';

                setTimeout(() => {
                    btn.innerHTML = originalContent;
                    btn.style.background = '';
                }, 3000);

                // ৪. বোনাস ক্লেইম করা (যদি আগে না করা হয়)
                if (!window.userUsageData.hasClaimedShareBonus) {
                    const bonusRes = await fetch('https://metagen-pro-api.metagenp.workers.dev/user/claim-share-bonus', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: window.userUsageData.email })
                    });

                    if (bonusRes.ok) {
                        const bonusData = await bonusRes.json();
                        if (bonusData.success) {
                            showSuccess(`Congrats! +50 credits added to your monthly limit.`);
                            // Local update
                            window.userUsageData.referralBonus = bonusData.totalBonus;
                            window.userUsageData.hasClaimedShareBonus = true;
                            updateUsageUI();
                        }
                    }
                }

            } catch (err) {
                console.error("Sharing failed:", err);
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
        window.handleGoogleLogin = async function () {
            const btn = event.target;
            btn.disabled = true;
            btn.innerHTML = '<span style="animation: spin 1s linear infinite;">⌛</span> Redirecting to Google...';

            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                await auth.signInWithPopup(provider);
                // Auth change listener will handle the UI update
            } catch (error) {
                showError(error.message || 'Google login failed');
                btn.disabled = false;
                btn.innerHTML = '<span style="margin-right: 10px;">🔐</span> Continue with Google';
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
        window.openProfileModal = async function () {
            try {
                const user = auth.currentUser;
                if (user) {
                    document.getElementById('profileName').textContent = user.displayName || user.email.split('@')[0];
                    document.getElementById('profileEmailText').textContent = user.email;

                    const avatarImg = document.getElementById('profileAvatarImg');
                    avatarImg.src = user.photoURL || getGravatarUrl(user.email);
                    avatarImg.style.display = 'block';
                    document.getElementById('profileAvatarDefault').style.display = 'none';

                    // 📊 Refresh Usage Stats
                    const usage = await getMetadataUsage(user.email);
                    window.userUsageData = usage;
                    updateUsageUI();

                    document.getElementById('profileModal').classList.remove('hidden');
                } else {
                    showLoginModal();
                }
            } catch (err) {
                console.error('Error loading profile:', err);
                showLoginModal();
            }
        };
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
                document.getElementById('loginForm').reset();
                document.getElementById('signupForm').reset();
                closeProfileModal();
                // After logout, show the main app in logged-out state (do not force login modal)
                hideLoadingState();
                showMainApp();
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
            showLoadingState();
            checkAuthState();
        });

        document.addEventListener('DOMContentLoaded', function () {
            // Show loading state while auth initializes
            showLoadingState();

            // Policy modal setup
            const policyModal = document.getElementById('policyModal');
            const policyModalTitle = document.getElementById('policyModalTitle');
            const policyModalBody = document.getElementById('policyModalBody');
            const closePolicyModalBtn = document.getElementById('closePolicyModal');

            const today = new Date();
            const options = { year: 'numeric', month: 'long', day: 'numeric' };
            const autoDate = today.toLocaleDateString('en-US', options);

            const policyContentMap = {
                rank: {
                    title: 'Keyword Strategy Guide',
                    body: `
                      <div class="container-1">
                        <h1><strong>Welcome to MetaGen Pro!</strong></h1>
                           <div class="policy-section">
                              <p><strong>MetaGen Pro:</strong> MetaGen Pro একটি  professional মেটাডেটা অটোমেশন টুল, এই সেবা ব্যবহার করুন।</p></p>
                           </div>
                       <div class="success">
                         <h1>এক শব্দের কীওয়ার্ড, দুই শব্দের কীওয়ার্ড এবং তিন শব্দের কীওয়ার্ড: কোনটি কখন ব্যবহার করবেন?</h1>
                       </div>
                       <p>
                           স্টক ফটোগ্রাফি, ইলাস্ট্রেশন বা AI ইমেজে সঠিক keyword ব্যবহার না করলে ভালো ইমেজও sale পায় না।
                           এই গাইডে আমরা বুঝব—<span class="highlight">কোন keyword strategy সবচেয়ে কার্যকর</span>।
                       </p>

                      <h2>🟢 ১ শব্দের Keyword (Single-word)</h2>
                      <p>একটি মাত্র শব্দ দিয়ে তৈরি keyword, যা broad visibility তৈরি করে।</p>

                     <div class="example">
                         <strong>উদাহরণ:</strong><br />
                         <span class="tag">business</span>
                         <span class="tag">technology</span>
                         <span class="tag">hands</span>
                         <span class="tag">illustration</span>
                     </div>

                      <h2>✔ সুবিধা</h2>
                      <ul>
                          <li>Search volume বেশি</li>
                          <li>Algorithm-friendly</li>
                      </ul>

                      <h3>❌ অসুবিধা</h3>
                      <ul>
                          <li>Competition খুব বেশি</li>
                          <li>Conversion কম</li>
                      </ul>

                      <p><strong>Recommended:</strong> মোট keyword-এর <span class="highlight">20–30%</span></p>

                      <h4>🟡 ২ শব্দের Keyword (Two-word)</h4>
                          <p>দুটি শব্দ মিলিয়ে clear intent বোঝায় — stock SEO-র backbone।</p>

                      <div class="example">
                          <strong>উদাহরণ:</strong><br />
                          <span class="tag">business meeting</span>
                          <span class="tag">user interaction</span>
                          <span class="tag">mobile app</span>
                          <span class="tag">flat illustration</span>
                     </div>

                     <h2>✔ সুবিধা</h2>
                     <ul>
                         <li>High relevance</li>
                         <li>Buyer intent strong</li>
                     </ul>

                     <p><strong>Recommended:</strong> মোট keyword-এর <span class="highlight">40–50%</span></p>

                     <h5>🔵 ৩ বা তার বেশি শব্দের Keyword (Long-tail)</h5>
                     <p>৩–৫ শব্দে তৈরি highly targeted keyword, যা sale বাড়াতে সাহায্য করে।</p>

                     <div class="example">
                         <strong>উদাহরণ:</strong><br />
                         <span class="tag">hands interacting with smartphone</span>
                         <span class="tag">minimalist illustration of mobile app</span>
                         <span class="tag">user tapping checklist on phone</span>
                     </div>

                     <h2>✔ সুবিধা</h2>
                     <ul>
                        <li>Conversion বেশি</li>
                        <li>New contributor-friendly</li>
                     </ul>

                     <p><strong>Recommended:</strong> মোট keyword-এর <span class="highlight">20–30%</span></p>

                     <h2>✅ Ideal Keyword Mix (50 Keywords)</h2>
                     <ul>
                        <li>15টি → ১ শব্দের keyword</li>
                        <li>22টি → ২ শব্দের keyword</li>
                        <li>13টি → ৩+ শব্দের keyword</li>
                    </ul>

                    <div class="warning">
                    <strong>⚠️ Common Mistake:</strong>
                    <ul>
                       <li>একই শব্দ বারবার ব্যবহার</li>
                       <li>Image-এর সাথে সম্পর্কহীন keyword</li>
                       <li>অতিরিক্ত long sentence keyword</li>
                    </ul>
                    </div>

                    <div class="success">
                    <strong>🚀 MetaGen Pro Advantage</strong>
                    <p>
                       MetaGen Pro automatically keyword balance করে, duplicate remove করে এবং SEO Score দেখিয়ে দেয় —
                       ফলে আপনি faster upload করতে পারেন এবং rejection risk কমে।
                    </p>
                    </div>

                    <div class="footer-rank">
                        © MetaGen Pro • Stock SEO Knowledge Base
                    </div>
                    </div>
                   `
                },
            };

            function openPolicyModal(type) {
                if (!policyModal || !policyModalTitle || !policyModalBody) return;
                const content = policyContentMap[type];
                if (!content) return;
                policyModalTitle.textContent = content.title;
                policyModalBody.innerHTML = content.body;
                policyModal.style.display = 'flex';
                policyModal.classList.add('visible');
                document.body.style.overflow = 'hidden';
            }

            function closePolicyModal() {
                if (!policyModal) return;
                policyModal.style.display = 'none';
                policyModal.classList.remove('visible');
                document.body.style.overflow = '';
            }

            if (closePolicyModalBtn) {
                closePolicyModalBtn.addEventListener('click', closePolicyModal);
            }

            if (policyModal) {
                policyModal.addEventListener('click', (event) => {
                    if (event.target === policyModal) {
                        closePolicyModal();
                    }
                });
            }

            document.querySelectorAll('[data-policy]').forEach(link => {
                link.addEventListener('click', (event) => {
                    event.preventDefault();
                    const type = link.getAttribute('data-policy');
                    openPolicyModal(type);
                });
            });

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && policyModal && policyModal.classList.contains('visible')) {
                    closePolicyModal();
                }
            });

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
                            section.style.display = 'none'; // অন্যথায় লুকাবে
                        }
                    });
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

            // --- DRAG & DROP ---
            const dropZone = document.getElementById('dropZone');
            if (dropZone) {
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, preventDefaults, false));
                function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
                ['dragenter', 'dragover'].forEach(eventName => dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false));
                ['dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false));
                dropZone.addEventListener('drop', (event) => {
                    if (event.dataTransfer && event.dataTransfer.files.length) handleFiles(event.dataTransfer.files);
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
            async function handleFiles(files) {
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

                // --- NEW: Plan Limit Check (Asynchronous) ---
                // We do this after the UI change to avoid blocking
                const usage = await getMetadataUsage(user ? user.email : null);
                let currentPlan = 'free';
                if (usage?.plan) {
                    const rawPlan = String(usage.plan).toLowerCase().trim();
                    if (rawPlan.includes('premium')) currentPlan = 'premium';
                    else if (rawPlan.includes('pro')) currentPlan = 'pro';
                } else if (usage?.limit) {
                    if (usage.limit >= 100) currentPlan = 'premium';
                    else if (usage.limit >= 70) currentPlan = 'pro';
                }

                let maxFiles = 50;
                if (currentPlan === 'free') {
                    maxFiles = usage.limit;
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
                        const seekTime = Math.min(1, video.duration * 0.1);
                        video.currentTime = seekTime;
                    };

                    video.onseeked = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                        canvas.toBlob((blob) => {
                            URL.revokeObjectURL(video.src);
                            if (blob) {
                                resolve(new File([blob], videoFile.name + ".jpg", { type: 'image/jpeg' }));
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
                const pdfjsLib = window['pdfjs-dist/build/pdf'];
                if (!pdfjsLib) {
                    throw new Error("PDF.js library not loaded");
                }

                try {
                    const arrayBuffer = await aiFile.arrayBuffer();
                    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                    const pdf = await loadingTask.promise;
                    const page = await pdf.getPage(1); // Get first page

                    // Determine scale (aim for decent quality thumbnail)
                    const viewport = page.getViewport({ scale: 1.5 });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport
                    };

                    await page.render(renderContext).promise;

                    return new Promise((resolve, reject) => {
                        canvas.toBlob((blob) => {
                            if (blob) {
                                // Create a File object from the Blob
                                const file = new File([blob], aiFile.name.replace(/\.ai$/i, '.png'), { type: "image/png" });
                                resolve(file);
                            } else {
                                reject(new Error("Canvas to Blob conversion failed"));
                            }
                        }, 'image/png');
                    });
                } catch (error) {
                    console.error("PDF.js extraction error:", error);
                    throw new Error("Failed to parse AI file. Ensure it is saved with 'Create PDF Compatible File' option.");
                }
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

                card.innerHTML = `
                    <div class="card-image-col">
                        <div class="card-checkbox-container">
                            <input type="checkbox" class="bulk-checkbox" data-file-id="${card.id}" onchange="handleCheckboxChange()">
                        </div>
                        <div class="card-image-actions">
                            <button class="card-image-action-btn regenerate" title="Regenerate" onclick="regenerateMetadata(this)"><span style="font-size:1.1em;">&#x21bb;</span></button>
                            <button class="card-image-action-btn close" title="Close" onclick="closeCard(this)"><span style="font-size:1.1em;">&#x2716;</span></button>
                        </div>
                        <img src="${placeholderSrc}" alt="${file.name}" class="thumbnail-medium">
                        
                        <!-- Image Properties Overlay -->
                        <div class="image-properties-overlay">
                            <div class="prop-row"><span class="prop-label">Name:</span><span class="prop-value">${file.name}</span></div>
                            <div class="prop-row"><span class="prop-label">Size:</span><span class="prop-value">${sizeStr}</span></div>
                            <div class="prop-row"><span class="prop-label">Type:</span><span class="prop-value">${file.type || 'N/A'}</span></div>
                            <div class="prop-row"><span class="prop-label">Dims:</span><span class="prop-value" id="dims-${card.id}">...</span></div>
                        </div>

                        ${isAi ? '<div class="file-type-badge ai-badge" style="position: absolute; top: 10px; left: 10px; padding: 4px 8px; border-radius: 4px; font-size: 0.7em; font-weight: bold; background: #FF7F18; color: white;">AI</div>' : ''}
                        ${isVideo ? '<div class="file-type-badge video-badge" style="position: absolute; top: 10px; left: 10px; padding: 4px 8px; border-radius: 4px; font-size: 0.7em; font-weight: bold; background: #EF4444; color: white;">VIDEO</div>' : ''}
                        <div class="image-spinner" style="display:block;"></div>
                        
                        <!-- Copyright Status -->
                        <div id="copyright-status-${card.id}" class="copyright-status-container" style="margin-top: 2px; background: var(--bg-input); border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3); padding: 4px 12px; border-radius: 14px; text-align: center;">
                            <div class="copyright-badge copyright-checking">
                                <span class="image-spinner" style="display:inline-block; width:12px; height:12px; border-width:2px; margin:0;"></span> Checking Copyright...
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
                                <span><span data-i18n="seo_score">SEO Score</span><button class="seo-info-icon" onclick="openSeoInfoModal()" title="Learn how to improve SEO Score">i</button></span>
                                <span class="seo-badge excellent" id="seo-badge-${card.id}">0 / 100 🟢 Excellent</span>
                            </div>
                            <div class="seo-progress-bg">
                                <div class="seo-progress-fill excellent" id="seo-progress-${card.id}" style="width: 0%;"></div>
                            </div>
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
                        <div class="meta-section">
                            <div class="meta-section-label"><span><span data-i18n="label_title">Title</span> <span id="title-count-${card.id}" class="meta-count"></span></span><button class="copy-btn" onclick="copyToClipboard(this, 'title')"><i class="icon-copy"></i><span data-i18n="btn_copy">Copy</span></button></div>
                            <div class="meta-title" contenteditable="true" oninput="updateTitle(this)"></div>
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
                                     <button class="prompt-tab-btn" data-style="illustration" onclick="switchPromptStyle('${card.id}', 'illustration')">
                                         🎨 <span data-i18n="style_illustration">Illustration</span>
                                     </button>
                                     <button class="prompt-tab-btn" data-style="3d" onclick="switchPromptStyle('${card.id}', '3d')">
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

                        // Dimensions updated in UI hook, Platform Check functionality replaced by Release Check.
                    };
                }
                const spinner = card.querySelector('.image-spinner');

                if (isEps) {
                    // --- EPS Conversion Restriction (Premium Only) ---
                    const user = auth.currentUser;

                    // Plan check using global window.userUsageData or a simpler check
                    let isPremium = (window.userUsageData?.plan || '').toLowerCase().includes('premium') || (window.userUsageData?.limit >= 100);

                    if (!isPremium) {
                        alert("Direct Vector/EPS conversion is a Premium feature. Please upgrade to use this feature.");
                        openUpgradeModal('premium');
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
                        const previewFile = await extractAiPreview(file);
                        imgElement.src = URL.createObjectURL(previewFile);
                        uploadedFilesData.push({
                            id: card.id,
                            name: file.name,
                            fileObject: file, // Keep original AI file
                            previewFile: previewFile, // Store extracted preview separately
                            isAiFile: true,
                            title: '',
                            keywords: '',
                            description: '',
                            style: '',
                            mood: '',
                            prompt: ''
                        });
                    } catch (error) {
                        console.error('AI preview failed:', error);
                        // Fallback icon
                        imgElement.src = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBmaWxsPSJub25lIiBzdHJva2U9IiNGRjdGMTgiIHN0cm9rZS13aWR0aD0iNCI+IDxyZWN0IHg9IjIiIHk9IjIiIHdpZHRoPSI5NiIgaGVpZHRoPSI5NiIgcng9IjgiIHJ5PSI4IiBmaWxsPSIjMUUyOTNCIi8+IDx0ZXh0IHg9IjUwIiB5PSI2MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMzYiIGZpbGw9IiNGRjdGMTgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtd2VpZ2h0PSJib2xkIj5BSTwvdGV4dD48L3N2Zz4=`;

                        // Push original file even if preview fails
                        uploadedFilesData.push({
                            id: card.id,
                            name: file.name,
                            fileObject: file, // Use original file if preview fails
                            isAiFile: true,
                            title: '',
                            keywords: '',
                            description: '',
                            style: '',
                            mood: '',
                            prompt: ''
                        });
                    } finally {
                        spinner.style.display = 'none';
                        updateAllButtonStates(); // Ensure button state updates after async op

                        // Auto-run Copyright Check if enabled
                        if (document.getElementById('copyrightToggle') && document.getElementById('copyrightToggle').checked) {
                            if (uploadedFilesData[uploadedFilesData.length - 1].previewFile) {
                                checkCopyrightAndTrademark(uploadedFilesData[uploadedFilesData.length - 1].previewFile, card.id);
                            } else {
                                // Try with original file if preview missing (might fail but worth try if image)
                                checkCopyrightAndTrademark(file, card.id);
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
                        // No copyright check for videos
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
                    if (currentPlan !== 'pro' && currentPlan !== 'premium') {
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

                    // 📊 Log activity and update usage
                    logActivity('Copyright Check', {
                        fileName: file.name,
                        status: result.status
                    });

                } catch (error) {
                    console.error("Copyright Check Error:", error);
                    badge.className = 'copyright-badge copyright-warning';
                    badge.innerHTML = `⚠️ Check Failed: ${error.message}`;
                }
            }

            // --- AI IMAGE QUALITY & ARTIFACT CHECKER (PRO/PREMIUM ONLY) ---
            window.checkImageQuality = async function (fileData) {
                const plan = (window.userUsageData?.plan || 'free').toLowerCase();
                if (plan === 'free') {
                    alert("Upgrade to PRO/PREMIUM plan. Image quality check features are for pro & premium users only.");
                    if (typeof scrollToPricing === 'function') scrollToPricing();
                    return;
                }
                const cardId = fileData.id;
                const badge = document.getElementById(`quality-badge-${cardId}`);
                const reportBox = document.getElementById(`quality-report-${cardId}`);

                if (!badge) return;

                try {
                    // 1. Check User Plan & Get Token
                    const user = auth.currentUser;

                    let currentPlan = 'free';
                    let accessToken = '';

                    if (user) {
                        accessToken = await user.getIdToken();
                        try {
                            const profileDoc = await db.collection('users').doc(user.email).get();
                            const profileData = profileDoc.exists ? profileDoc.data() : null;
                            currentPlan = (profileData?.plan || 'free').toLowerCase();
                        } catch (e) { console.warn('Plan check failed:', e); }
                    }

                    // Restricted to Pro/Premium
                    if (currentPlan !== 'pro' && currentPlan !== 'premium') {
                        badge.className = 'quality-status-badge danger';
                        badge.innerHTML = '<i class="fas fa-lock"></i> Pro Required';
                        if (reportBox) {
                            reportBox.innerHTML = `<div class="quality-report-header" style="color: #EF4444; font-weight: bold;">Upgrade Required</div>
                                                   <p style="font-size: 0.85em; margin-top: 5px;">AI Quality Checker is exclusive to Pro and Premium plans.</p>
                                                   <button class="action-button orange-button" style="width: 100%; margin-top: 10px;" onclick="scrollToPricing()">Upgrade to Pro</button>`;
                            reportBox.style.display = 'block';
                        }
                        return null;
                    }

                    // Update UI to "Checking"
                    const container = document.getElementById(`quality-status-container-${cardId}`);
                    if (container) container.style.display = 'block';

                    badge.className = 'quality-status-badge checking';
                    badge.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
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
                    const qualityPrompt = `You are an expert image quality analyst for stock photography platforms. Analyze this image for technical quality issues. Check for: blur, noise/grain, compression artifacts, color banding, chromatic aberration, over/under exposure, AI-generated artifacts (extra fingers, distorted text, unnatural patterns), watermarks, logos. Return ONLY valid JSON in this exact format: {"overall_score": <0-100>, "issues": [{"type": "<issue name>", "description": "<brief description>", "severity": "<high|medium|low>"}]}. If no issues found, return {"overall_score": 95, "issues": []}. Be strict but fair.`;
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
                    resStr = resStr.replace(/```json/g, '').replace(/```/g, '').trim();
                    const results = JSON.parse(resStr);

                    // 5. Update UI
                    updateQualityUI(cardId, results);
                    return results;

                } catch (error) {
                    console.error("Quality Check Error:", error);
                    badge.className = 'quality-status-badge danger';
                    badge.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Check Failed: ${error.message}`;
                    if (reportBox) reportBox.innerHTML = `<div class="quality-report-header" style="color: #EF4444;">Error: ${error.message}</div>`;
                    return null;
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

                const score = results.overall_score || 0;
                const issues = results.issues || [];

                let reportHtml = `<div style="text-align: center; margin-bottom: 30px;">
                                    <div style="font-size: 2em; font-weight: 800; color: var(--text-primary); margin-bottom: 8px; letter-spacing: -0.5px;">Technical Analysis Report</div>
                                    <div style="color: var(--text-muted); font-size: 1em; font-weight: 500;">AI-Powered Quality Assessment</div>
                                  </div>
                                  
                                  <div style="background: var(--bg-input); border-radius: 20px; padding: 25px; margin-bottom: 30px; border: 1px solid var(--border-color); box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);">
                                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                                          <span style="font-weight: 700; color: var(--text-secondary); font-size: 1.1em;">Overall Quality Score</span>
                                          <div style="font-size: 1.8em; font-weight: 900; color: ${score >= 80 ? '#10B981' : (score >= 50 ? '#F59E0B' : '#EF4444')}">${score}<span style="font-size: 0.6em; opacity: 0.7;">/100</span></div>
                                      </div>
                                      <div style="height: 12px; width: 100%; background: rgba(0,0,0,0.1); border-radius: 6px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.2);">
                                          <div style="height: 100%; width: ${score}%; background: linear-gradient(90deg, ${score >= 80 ? '#10B981, #059669' : (score >= 50 ? '#F59E0B, #D97706' : '#EF4444, #DC2626')}); border-radius: 6px; transition: width 1s cubic-bezier(0.34, 1.56, 0.64, 1);"></div>
                                      </div>
                                      <div style="margin-top: 10px; font-size: 0.85em; color: var(--text-muted); text-align: right; font-weight: 600;">
                                          ${score >= 80 ? 'Excellent Technical Quality' : (score >= 50 ? 'Minor Technical Issues' : 'Critical Artifacts Detected')}
                                      </div>
                                  </div>`;

                if (issues.length > 0) {
                    reportHtml += `<div style="font-weight: 800; margin-bottom: 18px; color: var(--text-primary); display: flex; align-items: center; gap: 10px; font-size: 1.1em;">
                                       <i class="fas fa-microscope" style="color: var(--accent-blue);"></i> Detected Artifacts
                                   </div>`;
                    issues.forEach((issue, idx) => {
                        const icon = issue.severity === 'high' ? 'fa-exclamation-triangle' : 'fa-info-circle';
                        const color = issue.severity === 'high' ? '#EF4444' : '#F59E0B';
                        const bg = issue.severity === 'high' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(245, 158, 11, 0.05)';

                        const isFixable = issue.type.includes('Noise') || issue.type.includes('Blur') || issue.type.includes('Sharpness');
                        const fixButton = isFixable ? `<button class="ai-fix-btn" onclick="fixImageArtifact('${cardId}', '${issue.type.replace(/'/g, "\\'")}')">✨ AI Fix</button>` : '';

                        reportHtml += `<div class="issue-item" style="background: ${bg}; border-radius: 16px; padding: 18px; margin-bottom: 15px; border: 1px solid ${color}33; display: flex; gap: 18px; align-items: flex-start; transition: transform 0.2s; cursor: default;" onmouseover="this.style.transform='translateX(5px)'" onmouseout="this.style.transform='translateX(0)'">
                                           <div style="background: ${color}22; padding: 10px; border-radius: 12px;">
                                               <i class="fas ${icon}" style="color: ${color}; font-size: 1.25em;"></i>
                                           </div>
                                           <div style="flex: 1;">
                                               <div style="font-weight: 800; color: var(--text-primary); margin-bottom: 4px; font-size: 1.05em;">${issue.type}</div>
                                               <div style="font-size: 0.95em; color: var(--text-muted); line-height: 1.5; font-weight: 500;">${issue.description}</div>
                                               ${fixButton}
                                           </div>
                                       </div>`;
                    });
                } else {
                    reportHtml += `<div style="text-align: center; padding: 40px 20px; background: rgba(16, 185, 129, 0.05); border-radius: 20px; border: 2px dashed rgba(16, 185, 129, 0.2); animation: fadeIn 0.5s ease-out;">
                                       <div style="background: rgba(16, 185, 129, 0.1); width: 80px; height: 80px; border-radius: 40px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                                           <i class="fas fa-check-circle" style="color: #10B981; font-size: 3em;"></i>
                                       </div>
                                       <div style="color: #10B981; font-weight: 800; font-size: 1.4em; margin-bottom: 8px;">Technically Perfect!</div>
                                       <div style="color: var(--text-muted); font-size: 1em; line-height: 1.5;">Our AI engine found no technical issues. <br>This image is ready for top-tier platforms.</div>
                                   </div>`;
                }

                body.innerHTML = reportHtml;
                modal.style.display = 'flex';
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
                    if (issueType.includes('Noise')) {
                        // Subtle blur followed by contrast boost to reduce grain
                        ctx.filter = 'blur(0.5px) contrast(1.1) saturate(1.05)';
                    } else if (issueType.includes('Blur') || issueType.includes('Sharpness')) {
                        // High pass-like effect via contrast and brightness
                        ctx.filter = 'contrast(1.2) brightness(1.02) saturate(1.1)';
                    } else {
                        // General enhancement
                        ctx.filter = 'contrast(1.1) saturate(1.1)';
                    }

                    ctx.drawImage(img, 0, 0);

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
            }

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

                    // Define selectedProvider (default to 'gemini' since UI element is gone)
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

                    // Check plan and usage in parallel to save time
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
                            isProPremium = (dbPlan === 'pro' || dbPlan === 'premium');
                            usage = usageData;
                        } catch (e) {
                            console.warn('Initial data check failed', e);
                        }
                    }

                    // 🛑 LIMIT CHECK
                    if (user && usage.count + filesToProcess.length > usage.limit) {
                        const remaining = usage.limit - usage.count;
                        if (remaining <= 0) {
                            if (usage.limit === 10) {
                                showLimitModal("You have reached your daily limit <strong>(10 images for Free Plan fairness)</strong>. <strong>Upgrade to the Pro plan</strong> to process more images.");
                            } else {
                                showLimitModal(`Your daily limit <strong>(${usage.limit} images)</strong> has been reached. Please try again tomorrow or upgrade.`);
                            }
                        } else {
                            showLimitModal(`You have only <strong>${remaining}</strong> images left against your limit for today (current usage: ${usage.count}/${usage.limit}).<br><br>You have selected <strong>${filesToProcess.length}</strong> images. Please reduce the number of images to process or upgrade to a Pro plan.`);
                        }
                        processAllButton.disabled = false;
                        processAllButton.innerHTML = '<i class="icon-process"></i> ' + (typeof getTrans === 'function' ? getTrans('process_selected') : 'Process Selected');
                        hideBatchProgress();
                        return;
                    }

                    // Reset pause state and show button

                    // Reset pause state and show button
                    window.isPaused = false;
                    const pauseBtn = document.getElementById('pauseProcessButton');
                    if (pauseBtn) {
                        pauseBtn.style.display = 'inline-flex';
                        pauseBtn.innerHTML = '<i class="fas fa-pause"></i> ' + getTrans('pause');
                        pauseBtn.classList.remove('green-button');
                        pauseBtn.classList.add('orange-button');
                    }

                    let totalFiles = filesToProcess.length;
                    let processedCount = 0;
                    let completedCount = 0;
                    let errorCount = 0;

                    // 🟠 Show batch progress bar
                    showBatchProgress('generate');

                    for (const fileData of filesToProcess) {
                        try {
                            const latestUsage = await getMetadataUsage(authUser?.email || "unknown");
                            if (latestUsage.count >= latestUsage.limit) {
                                alert(`Daily limit reached during processing! Successfully processed: ${completedCount}`);
                                console.log("Stopping batch as limit exceeded.");
                                break; // লুপটি পুরোপুরি বন্ধ করে দিবে
                            }
                        } catch (usageErr) {
                            console.warn("Usage check failed, continuing carefully...", usageErr);
                        }
                        // Check for pause
                        while (window.isPaused) {
                            await new Promise(r => setTimeout(r, 200));
                        }

                        processedCount++;

                        updateProcessButtonText(processedCount, totalFiles, completedCount, errorCount);
                        updateBatchProgress(processedCount, totalFiles, fileData.name, 'generate');
                        const currentCard = document.getElementById(fileData.id);
                        if (currentCard) currentCard.style.borderColor = "#F97316";

                        try {
                            const metadata = await generateMetadata(fileData);

                            fileData.title = metadata.title;
                            fileData.keywords = metadata.keywords;
                            fileData.description = metadata.description || '';

                            const epsBtn = document.getElementById(`btn-eps-${fileData.id}`);
                            if (epsBtn) epsBtn.disabled = false;

                            // 📊 Usage and logging are already handled inside generateMetadata()
                            // No need to log here to avoid double-credit issue

                            // Enable batch translate button when metadata is available
                            const batchTranslateButton = document.getElementById('batchTranslateButton');
                            if (batchTranslateButton) {
                                batchTranslateButton.disabled = false;
                            }

                            completedCount++;

                            if (currentCard) currentCard.style.borderColor = "#10B981"; // Green border

                        } catch (error) {
                            console.error("Error processing file:", fileData.name, error);

                            // *** CRITICAL FIX ***
                            fileData.title = "Error";

                            const metaTitle = currentCard.querySelector('.meta-title');
                            if (metaTitle) metaTitle.textContent = "Failed: " + error.message;

                            errorCount++;

                            if (currentCard) {
                                currentCard.style.borderColor = "#EF4444";
                                const metaTitle = currentCard.querySelector('.meta-title');
                                if (metaTitle) metaTitle.textContent = "Failed: " + error.message;
                            }
                        }

                        // Delay logic: Pro users get faster processing (shorter delay)
                        let delayTime = 1500;
                        if (isProPremium) {
                            delayTime = 500; // Faster for Pro
                        } else if (selectedProvider === 'mistral') {
                            delayTime = 6000;
                        }

                        const overallCompleted = uploadedFilesData.filter(f => f.title && f.title !== "Error").length;
                        const overallErrors = uploadedFilesData.filter(f => f.title === "Error").length;
                        updateProcessButtonText(processedCount, totalFiles, overallCompleted, overallErrors);

                        await new Promise(resolve => setTimeout(resolve, delayTime));
                    }

                    const finalCompleted = uploadedFilesData.filter(f => f.title && f.title !== "Error").length;
                    const finalErrors = uploadedFilesData.filter(f => f.title === "Error").length;
                    updateProcessButtonText(processedCount, totalFiles, finalCompleted, finalErrors, true);
                    hideBatchProgress(finalErrors === 0);
                    setTimeout(() => {
                        processAllButton.disabled = false;
                        const pauseBtn = document.getElementById('pauseProcessButton');
                        if (pauseBtn) pauseBtn.style.display = 'none';
                    }, 1000)

                    // 🔔 Completion Notification
                    if (Notification.permission === "granted") {
                        new Notification("Metadata Generation Complete! ✅", {
                            body: `Process finished.\nSuccessful: ${finalCompleted}\nFailed: ${finalErrors}`,
                            icon: "https://cdn-icons-png.flaticon.com/512/148/148767.png" // Checkmark icon
                        });
                    } else {
                        alert(`Metadata Generation Complete!\nSuccessful: ${finalCompleted}\nFailed: ${finalErrors}`);
                    }

                    // --- NEW: Trigger Feedback Modal ---
                    // Show modal only if some files were successfully processed AND user hasn't submitted feedback before
                    if (finalCompleted > 0 && !localStorage.getItem('feedbackSubmitted')) {
                        setTimeout(() => {
                            const feedbackModal = document.getElementById('feedbackModal');
                            if (feedbackModal) {
                                feedbackModal.style.display = 'flex';
                            }
                        }, 2000); // Small delay to let the user see the "Complete" state/alert first
                    }
                }
                processAllButton.onclick = async function () {
                    if (this.disabled) return;

                    try {
                        const user = auth.currentUser;

                        if (user) {
                            await processSelectedFiles();
                        } else {
                            window.pendingProcessAll = true;
                            document.getElementById('loginModal').classList.remove('hidden');
                        }
                    } catch (err) {
                        console.error('Auth check failed:', err);
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
                            isProPremium2 = (dbPlan2 === 'pro' || dbPlan2 === 'premium');
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
                        try {
                            const originalBytes = new Uint8Array(e.target.result);
                            const iendOffset = findIendChunkOffset(originalBytes);
                            if (iendOffset === -1) {
                                throw new Error("Could not find IEND chunk. The PNG file might be corrupt.");
                            }
                            const contentBeforeIEND = originalBytes.subarray(0, iendOffset);
                            const iendChunk = originalBytes.subarray(iendOffset);
                            // Use translated metadata if available
                            const metadata = getMetadataForExport(fileData);
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
                            const blob = new Blob([newPngBytes], { type: 'image/png' });
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement("a");
                            link.href = url;
                            link.download = fileData.name.replace(/(\.png)$/i, '_meta$1');
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            URL.revokeObjectURL(url);
                            resolve();
                        } catch (error) {
                            console.error("A critical error occurred during PNG embedding:", error);
                            alert(`Could not process ${fileData.name}. The file might be corrupt. Check the console for details.`);
                            reject(error);
                        }
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
                    // 3. Inherited? (We wont do full inheritance for MVP, but we can try basic)
                    // 4. Default

                    if (node.hasAttribute(prop)) return node.getAttribute(prop);
                    if (stylesObj && stylesObj[prop]) return stylesObj[prop];

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

                    // Handle Hex
                    if (colorStr.startsWith('#')) {
                        let hex = colorStr.substring(1);
                        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
                        const r = parseInt(hex.substring(0, 2), 16) / 255;
                        const g = parseInt(hex.substring(2, 4), 16) / 255;
                        const b = parseInt(hex.substring(4, 6), 16) / 255;
                        this.psCode.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rgb`);
                    }
                    // Handle rgb()
                    else if (colorStr.startsWith('rgb')) {
                        const vals = colorStr.match(/\d+/g);
                        if (vals && vals.length >= 3) {
                            this.psCode.push(`${(vals[0] / 255).toFixed(3)} ${(vals[1] / 255).toFixed(3)} ${(vals[2] / 255).toFixed(3)} rgb`);
                        }
                    }
                    // Named colors could be added here (red, blue, etc.), defaulting to black otherwise
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

                const formData = new FormData();
                formData.append('title', currentTitle);
                formData.append('description', currentDesc);
                formData.append('keywords', currentKeywords);
                formData.append('file', fileData.fileObject);

                const response = await fetch('https://metagen-eps-server.onrender.com/api/convert-svg-to-eps', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) throw new Error("Server conversion failed.");
                return await response.blob();
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
                    const zip = new JSZip();
                    let successCount = 0;
                    let failCount = 0;

                    for (let i = 0; i < svgFiles.length; i++) {
                        if (batchBtn) {
                            batchBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Converting ${i + 1}/${svgFiles.length}...`;
                        }
                        try {
                            const blob = await getEpsBlobForFile(svgFiles[i]);
                            const epsFilename = svgFiles[i].name.replace(/(\.svg)$/i, '_meta.eps');
                            zip.file(epsFilename, blob);
                            successCount++;

                            // Small throttle delay between server requests
                            if (i < svgFiles.length - 1) await new Promise(r => setTimeout(r, 500));
                        } catch (err) {
                            console.error(`EPS conversion failed for ${svgFiles[i].name}:`, err);
                            failCount++;
                        }
                    }

                    if (successCount > 0) {
                        if (batchBtn) batchBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Packaging ZIP...`;
                        const zipBlob = await zip.generateAsync({ type: "blob" });
                        const url = URL.createObjectURL(zipBlob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `MetaGen_EPS_Batch_${new Date().getTime()}.zip`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
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

            window.exportAllCsv = function () {
                const successfulFiles = uploadedFilesData.filter(f => f.title && f.title !== "Error");
                if (successfulFiles.length === 0) {
                    alert("No successful metadata to export.");
                    return;
                }

                // Try to get active platform, default to generic if not found (though logic usually relies on active class)
                const activePlatformBtn = document.querySelector('.platform-button.active');
                const activePlatform = activePlatformBtn ? activePlatformBtn.dataset.platform : '';

                let csvContent = '';
                let isShutterstock = (activePlatform === 'shutterstock');
                let isAdobe = (activePlatform === 'adobe');

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

                const encodedUri = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
                const link = document.createElement("a");
                link.setAttribute("href", encodedUri);
                link.setAttribute("download", "metadata_export.csv");
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

                if (currentPlan !== 'premium') {
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

            async function svgFileToPngDataUrl(svgFile, width = 512, height = 512) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = function (e) {
                        const img = new Image();
                        img.onload = function () {
                            const canvas = document.createElement('canvas');
                            canvas.width = width; canvas.height = height;
                            const ctx = canvas.getContext('2d');
                            ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
                            ctx.drawImage(img, 0, 0, width, height);
                            resolve(canvas.toDataURL('image/png'));
                        };
                        img.onerror = reject;
                        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(e.target.result)));
                    };
                    reader.onerror = reject;
                    reader.readAsText(svgFile);
                });
            }

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
                        descriptionPromptSegment = `\n- Description: Generate a concise description between ${minDesc} and ${maxDesc} words based on the subject.`;
                    }
                    let keywordsPromptSegment = `Generate between ${minKeywords} and ${maxKeywords} SEO-friendly keywords based on the subject: "${customPromptText}". Format the output as a JSON array of objects, where each object has a "keyword" (string) and a "score" (integer 0-100 reflecting stock photo potential/relevance). Example: "keywords": [{"keyword": "sunset", "score": 95}, ...]`;
                    if (singleWordKeywords) {
                        keywordsPromptSegment = `Only generate single-word, SEO-friendly keywords (no phrases) for the subject: "${customPromptText}". Generate between ${minKeywords} and ${maxKeywords} keywords. Format as a JSON array of objects with "keyword" and "score". Example: "keywords": [{"keyword": "sunset", "score": 95}, ...]`;
                    }

                    // Vector Mode additions
                    let vectorModeInstructions = '';
                    if (vectorMode) {
                        vectorModeInstructions = `\n\nIMPORTANT - VECTOR MODE:\n- This is a vector illustration or logo.\n- Keywords MUST include: "vector illustration", "eps", "svg".\n- Detect and include style keywords like: "flat", "line art", "silhouette", "outline", "minimalist vector".\n- If the image has a plain background, describe it as "isolated on white background".`;
                    }

                    promptText = `Generate metadata for the subject: "${customPromptText}".\nFormat the output strictly as a JSON object with the keys: ${jsonFields}, "style", "mood", "rejection_prediction", "requires_model_release", "requires_property_release".\n- Keywords: ${keywordsPromptSegment}${descriptionPromptSegment}\n- Style: Detect the photographic style (e.g., Cinematic, Minimalist, Vintage).\n- Mood: Detect the mood of the image (e.g., Happy, Melancholic, Energetic).${vectorModeInstructions}\n- Rejection Prediction: Analyze technical quality (focus, lighting, noise, artifacts) for stock photography usage. Estimate the probability of likely rejection based on technical standards (0-100). Return integer in 'rejection_prediction'.\n- requires_model_release: true if the image contains recognizable people/faces, false otherwise.\n- requires_property_release: true if the image contains recognizable private properties, modern architecture, brands, logos, or artworks, false otherwise.`;
                } else {
                    let titleAddons = [];
                    if (addSilhouette) titleAddons.push("Silhouette");
                    const titleAddonString = titleAddons.length > 0 ? ` Must include the words: "${titleAddons.join(', ')}".` : '';

                    let jsonFields = '"title", "keywords"';
                    let descriptionPromptSegment = '';
                    if (!noDescriptionMode) {
                        jsonFields += ', "description"';
                        descriptionPromptSegment = `\n- Description: Generate a concise description between ${minDesc} and ${maxDesc} words.`;
                    }
                    let keywordsPromptSegment = `Generate between ${minKeywords} and ${maxKeywords} SEO-friendly keywords. Format the output as a JSON array of objects, where each object has a "keyword" (string) and a "score" (integer 0-100 reflecting stock photo potential/relevance). Example: "keywords": [{"keyword": "sunset", "score": 95}, ...]`;
                    if (singleWordKeywords) {
                        keywordsPromptSegment = `Only generate single-word, SEO-friendly keywords (no phrases). Generate between ${minKeywords} and ${maxKeywords} keywords. Format as a JSON array of objects with "keyword" and "score".`;
                    }

                    // Vector Mode additions
                    let vectorModeInstructions = '';
                    if (vectorMode) {
                        vectorModeInstructions = `\n\nIMPORTANT - VECTOR MODE:\n- This is a vector illustration or logo.\n- Keywords MUST include: "vector illustration", "eps", "svg".\n- Detect and include style keywords like: "flat", "line art", "silhouette", "outline", "minimalist vector".\n- If the image has a plain background, describe it as "isolated on white background".`;
                    }
                    promptText = `Analyze this image and generate metadata.\nFormat the output strictly as a JSON object with the keys: ${jsonFields}, "style", "mood", "rejection_prediction", "shutterstock_category", "requires_model_release", "requires_property_release".\n- Title: Generate an SEO-friendly title between ${minTitle} and ${maxTitle} words. It MUST include the detected Style and Mood of the image. Do not use colons (:).${titleAddonString}\n- Keywords: ${keywordsPromptSegment}${descriptionPromptSegment}\n- Style: Detect the photographic style (e.g., Cinematic, Minimalist, Vintage).\n- Mood: Detect the mood of the image (e.g., Happy, Melancholic, Energetic).${vectorModeInstructions}\n- Rejection Prediction: Analyze technical quality (focus, lighting, noise, artifacts) for stock photography usage. Estimate probability of rejection (0-100) as integer in 'rejection_prediction'.\n- requires_model_release: true if the image contains recognizable people/faces, false otherwise.\n- requires_property_release: true if the image contains recognizable private properties, modern architecture, brands, logos, or artworks, false otherwise.\n- shutterstock_category: Pick the SINGLE most fitting Shutterstock category from this exact list: Abstract, Animals/Wildlife, Arts, Backgrounds/Textures, Beauty/Fashion, Buildings/Landmarks, Business/Finance, Celebrities, Education, Food and Drink, Healthcare/Medical, Holidays, Industrial, Interiors, Miscellaneous, Nature, Objects, Parks/Outdoor, People, Religion, Science, Signs/Symbols, Sports/Recreation, Technology, Transportation, Vintage. Return only the category name as a string.`;
                }

                // --- NEW: Video-Specific Prompt Enhancement ---
                if (fileData.isVideo) {
                    // Update main prompt context
                    promptText = promptText.replace(/Analyze this image/g, "Analyze this stock video footage (represented by this frame)");
                    promptText = promptText.replace(/this image/g, "this video clip");

                    // Add video-specific instructions
                    const videoInstructions = `\n\nIMPORTANT - VIDEO MODE:
- This is a stock video footage clip. 
- You MUST include video-specific keywords: "footage", "video", "stock footage", "motion".
- If the scene looks cinematic or high quality, include keywords: "cinematic", "4k", "high definition".
- The Title should describe the action or scene accurately for a video buyer (e.g., "Drone view of...", "Slow motion of...", "Video clip of...").`;

                    promptText += videoInstructions;
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
                    const pngDataUrl = await svgFileToPngDataUrl(fileToProcess, 512, 512);
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

                if (dbPlan !== 'pro' && dbPlan !== 'premium') dbPlan = 'free';
                const isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium');
                const proxyUrl = "https://metagen-pro-api.metagenp.workers.dev/generate";

                let generatedText = "";
                let lastError = null;

                try {
                    // ================= ALL USERS LOGIC =================
                    const response = await fetch(proxyUrl, {
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

                    const data = await response.json();

                    if (!response.ok) {
                        if (response.status === 429) {
                            showLimitModal(data.error);
                            throw new Error("Daily limit reached");
                        }
                        throw new Error(`API Error: ${data.error || response.statusText}`);
                    }

                    // Update trial UI if applicable
                    if (data.newCount !== undefined && window.trialUsage) {
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
                                .replace(/[\r\n\t]/g, ' ') // Replace newlines/tabs with spaces
                                .replace(/\s+/g, ' ') // Normalize whitespace
                                .replace(/,\s*}/g, '}') // Remove trailing commas
                                .replace(/,\s*]/g, ']'); // Remove trailing commas in arrays

                            metadata = JSON.parse(cleanedJsonString);
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

                    // Title Addons
                    let finalTitle = metadata.title || "";
                    if (addWhiteBg && !finalTitle.toLowerCase().includes("white background")) finalTitle += " isolated on White Background";
                    if (addTransparentBg && !finalTitle.toLowerCase().includes("transparent background")) finalTitle += " isolated on Transparent Background";
                    metadata.title = finalTitle.replace(/,$/, '').trim();

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

                        if (metadata.requires_model_release) {
                            const isAiImage = fileData.isAiGenerated || fileData.name.toLowerCase().includes('ai generated');
                            if (isAiImage) {
                                reqModel.innerHTML = '<span style="color:#3B82F6; font-weight:bold;">AI 🤖</span>';
                            } else {
                                reqModel.innerHTML = '<span style="color:#EF4444; font-weight:bold;">Yes ⚠️</span>';
                                needsUpload = true;
                            }
                        } else {
                            reqModel.innerHTML = '<span style="color:#10B981;">No</span>';
                        }

                        if (metadata.requires_property_release) {
                            const isAiImage = fileData.isAiGenerated || fileData.name.toLowerCase().includes('ai generated');
                            if (isAiImage) {
                                reqProperty.innerHTML = '<span style="color:#3B82F6; font-weight:bold;">AI 🤖</span>';
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
            function calculateSeoScore(metadata) {
                let score = 0;
                const maxScore = 100;
                let penalties = 0;

                // 1. Title Length Score (Max 25)
                const title = (metadata.title || '').trim();
                const titleLength = title.length;
                if (titleLength >= 40 && titleLength <= 70) {
                    score += 25; // Perfect
                } else if (titleLength >= 20 && titleLength < 40) {
                    score += 20; // Good
                } else if (titleLength > 70 && titleLength <= 100) {
                    score += 20; // Good but long
                } else if (titleLength > 0) {
                    score += 10; // Too short/long
                } else {
                    penalties += 10; // Missing title
                }

                // 2. Description Length Score (Max 25)
                const desc = (metadata.description || '').trim();
                const descLength = desc.length;
                if (descLength >= 100 && descLength <= 160) {
                    score += 25; // Perfect
                } else if (descLength >= 70 && descLength < 100) {
                    score += 20; // Good
                } else if (descLength > 160 && descLength <= 200) {
                    score += 20; // Good but long
                } else if (descLength > 0) {
                    score += 10; // Too short/long
                } else {
                    penalties += 10; // Missing description
                }

                // 3. Keyword Count & Mix Score (Max 50)
                const keywordsArray = (metadata.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
                const totalKeywords = keywordsArray.length;

                // Count types
                const singleWords = keywordsArray.filter(k => k.split(/\s+/).length === 1).length;
                const twoWords = keywordsArray.filter(k => k.split(/\s+/).length === 2).length;
                const multiWords = keywordsArray.filter(k => k.split(/\s+/).length >= 3).length;

                // Percentages
                const pSingle = totalKeywords > 0 ? (singleWords / totalKeywords) * 100 : 0;
                const pTwo = totalKeywords > 0 ? (twoWords / totalKeywords) * 100 : 0;
                const pMulti = totalKeywords > 0 ? (multiWords / totalKeywords) * 100 : 0;

                // A. Quantity Score (Max 20)
                if (totalKeywords >= 30) score += 20;
                else if (totalKeywords >= 20) score += 15;
                else if (totalKeywords >= 10) score += 10;
                else if (totalKeywords > 0) score += 5;
                else penalties += 20;

                // B. Mix Quality Score (Max 30)
                // Ideal: Single: 30-40%, Two: 40-50%, Multi: 10-30%

                let mixScore = 0;
                // Single word check
                if (pSingle >= 20 && pSingle <= 50) mixScore += 10;
                else if (pSingle > 0 && pSingle < 80) mixScore += 5;

                // Two word check (The "Sweet Spot")
                if (pTwo >= 30 && pTwo <= 60) mixScore += 10;
                else if (pTwo > 10) mixScore += 5;

                // Multi word check
                if (pMulti >= 10 && pMulti <= 40) mixScore += 10;
                else if (pMulti > 0 && pMulti < 60) mixScore += 5;

                score += mixScore;

                // 4. Quality Checks & Penalties

                // A. Duplicate Keywords
                const uniqueKeywords = new Set(keywordsArray.map(k => k.toLowerCase()));
                if (uniqueKeywords.size < totalKeywords) {
                    penalties += (totalKeywords - uniqueKeywords.size) * 2; // -2 per duplicate
                }

                // B. Title == Description
                if (titleLength > 0 && title.toLowerCase() === desc.toLowerCase()) {
                    penalties += 20; // Heavy penalty for lazy metadata
                }

                // C. Repeated words in Title (Keyword stuffing)
                const titleWords = title.toLowerCase().split(/\s+/);
                const titleWordCounts = {};
                titleWords.forEach(w => { if (w.length > 3) titleWordCounts[w] = (titleWordCounts[w] || 0) + 1; });
                if (Object.values(titleWordCounts).some(c => c > 3)) {
                    penalties += 10; // Penalty for spammed title
                }

                // Final Calculation
                let finalScore = score - penalties;
                return Math.max(0, Math.min(100, finalScore));
            }

            // SEO Score Meter Update Function
            function updateSeoMeter(cardId, score) {
                const meterContainer = document.getElementById(`seo-meter-${cardId}`);
                const badge = document.getElementById(`seo-badge-${cardId}`);
                const progressFill = document.getElementById(`seo-progress-${cardId}`);

                const seoLock = document.getElementById(`seo-lock-${cardId}`);

                if (!meterContainer || !badge || !progressFill) return;

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
                        if (currentPlan.toLowerCase() !== 'pro' && currentPlan.toLowerCase() !== 'premium') {
                            alert("Upgrade to PRO/PREMIUM plan. healing features are for pro & premium users only.");
                            if (typeof scrollToPricing === 'function') scrollToPricing();
                            return;
                        }
                    }

                    if (section === 'sales-prediction') {
                        const currentPlan = window.userUsageData?.plan || 'free';
                        if (currentPlan.toLowerCase() !== 'pro' && currentPlan.toLowerCase() !== 'premium') {
                            alert("Upgrade to PRO/PREMIUM plan. sales-prediction features are for pro & premium users only.");
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

                    if (calendarSection) calendarSection.style.display = 'none';
                    if (nicheSection) nicheSection.style.display = 'none';
                    if (adminSection) adminSection.style.display = 'none';
                    if (healingSection) healingSection.style.display = 'none';
                    if (salesPredSection) salesPredSection.style.display = 'none';

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
                        isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium');
                    } catch (e) { console.warn('Plan check failed:', e); }
                }

                let apiKey = null;
                const promptInstruction = "Analyze the provided image in detail and generate three different style prompts for an AI image generator (like Midjourney, Leonardo.Ai, or DALL-E) based on this image.\n" +
                    "The three styles MUST be:\n" +
                    "1. realistic: A highly detailed photo-realistic, cinematic, or documentary photography style prompt.\n" +
                    "2. illustration: An artistic digital illustration, vector graphic, anime, or painting style prompt.\n" +
                    "3. 3d: A modern 3D render, CGI, digital sculpture, or claymation style prompt.\n\n" +
                    "You MUST respond ONLY with a valid JSON object matching exactly this format (no explanations, no code block formatting, just the raw JSON):\n" +
                    "{\n" +
                    "  \"realistic\": \"[realistic style prompt]\",\n" +
                    "  \"illustration\": \"[illustration style prompt]\",\n" +
                    "  \"3d\": \"[3d style prompt]\"\n" +
                    "}\n" +
                    "Do NOT include any markdown, backticks, or extra characters in your response. Just return the JSON object.";


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

    /* Login Modal Styles */
    .login-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        backdrop-filter: blur(5px);
    }

    .login-modal.hidden {
        display: none;
    }

    .login-container {
        background: var(--bg-modal);
        border-radius: 16px;
        padding: 40px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 8px 32px var(--shadow-md);
        border: 1px solid var(--border-color);
    }

    /* Initial Loading Overlay Styles */
    .initial-loading {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,0.7);
        z-index: 9998;
        backdrop-filter: blur(4px);
    }

    .initial-loading-box {
        background-color: var(--bg-tertiary);
        border-radius: 14px;
        padding: 36px 48px;
        text-align: center;
        border: 1px solid #334155;
        box-shadow: 0 12px 48px rgba(0,0,0,0.5);
        color: var(--text-primary);
        min-width: 320px;
        max-width: 520px;
    }

    .initial-loading-box h1 {
        color: #F97316;
        margin: 0 0 6px 0;
        font-size: 1.8em;
    }

    .initial-sub { color: var(--text-primary); margin: 0 0 14px 0; }

    .initial-icon { font-size: 2.2em; margin-bottom: 10px; display: inline-block; animation: spin 2s linear infinite; }

    .initial-desc { color: var(--text-primary); margin: 0; }

    .initial-loading.hidden { display: none; }

    .login-header {
        text-align: center;
        margin-bottom: 30px;
    }

    .login-header h1 {
        color: var(--accent-orange);
        font-size: 2em;
        margin: 0 0 10px 0;
        letter-spacing: 0.02em;
    }

    .login-header p {
        color: var(--text-muted);
        font-size: 0.95em;
        margin: 0;
    }

    .login-form-group {
        margin-bottom: 20px;
    }

    .login-form-group label {
        display: block;
        color: var(--text-secondary);
        font-weight: 600;
        margin-bottom: 8px;
        font-size: 0.95em;
    }

    .login-form-group input {
        width: 100%;
        padding: 12px 14px;
        background: var(--bg-input);
        border: 1.5px solid var(--border-color);
        border-radius: 8px;
        color: var(--text-primary);
        font-size: 1em;
        box-sizing: border-box;
        transition: border-color 0.2s, box-shadow 0.2s;
    }

    .login-form-group input:focus {
        outline: none;
        border-color: #F97316;
        box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.2);
    }

    .login-buttons {
        display: flex;
        gap: 12px;
        margin-top: 30px;
    }

    .login-button {
        flex: 1;
        padding: 12px 16px;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        font-size: 0.95em;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: center;
    }

    .login-button.primary {
        background: linear-gradient(90deg, #F97316 60%, #ea580c 100%);
        color: white;
    }

    .login-button.primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3);
    }

    .login-button.secondary {
        background: var(--bg-tertiary);
        color: var(--text-secondary);
    }

    .login-button.secondary:hover {
        background: #4B5563;
    }

    .login-button.google-button {
        background: linear-gradient(90deg, #FFFFFF 60%, #F3F4F6 100%);
        color: #1F2937;
        border: 1.5px solid #E5E7EB;
    }

    .login-button.google-button:hover {
        background: linear-gradient(90deg, #F3F4F6 60%, #E5E7EB 100%);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .login-toggle {
        text-align: center;
        margin-top: 20px;
        color: #94A3B8;
    }

    .login-toggle a {
        color: #F97316;
        cursor: pointer;
        text-decoration: none;
        font-weight: 600;
    }

    .login-toggle a:hover {
        text-decoration: underline;
    }

    .login-error {
        background: #7F1D1D;
        border: 1px solid #EF4444;
        color: #FECACA;
        padding: 12px;
        border-radius: 6px;
        margin-bottom: 20px;
        font-size: 0.9em;
        display: none;
    }

    .login-error.show {
        display: block;
    }

    .login-success {
        background: #064E3B;
        border: 1px solid #10B981;
        color: #CCFBF1;
        padding: 12px;
        border-radius: 6px;
        margin-bottom: 20px;
        font-size: 0.9em;
        display: none;
    }

    .login-success.show {
        display: block;
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

                    // Add remove button and draggable attributes
                    return `<span class="meta-keyword-pill draggable" 
                                  draggable="true"
                                  data-index="${index}"
                                  data-card-id="${cardId}"
                                  ondragstart="handleDragStart(event)"
                                  ondragend="handleDragEnd(event)"
                                  ondragover="handleDragOver(event)"
                                  ondrop="handleDrop(event)"
                                  onclick="handleKeywordClick(event, '${kw.replace(/'/g, "\\'")}', '${cardId}')"
                                  style="display:inline-flex; align-items:center;">
                                ${kw} ${scoreHtml} ${badgeHtml}
                                <button class="keyword-remove-btn" 
                                        onclick="event.stopPropagation(); removeKeyword('${cardId}', ${index});" 
                                        onmousedown="event.stopPropagation();"
                                        title="Remove">×</button>
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

                // Update SEO Score
                if (typeof calculateSeoScore === 'function' && typeof updateSeoMeter === 'function') {
                    const score = calculateSeoScore(fileData);
                    updateSeoMeter(cardId, score);
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
                            isPaidPlan = (currentPlan === 'pro' || currentPlan === 'premium');
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
            const savedTheme = localStorage.getItem('theme');
            const themeIcon = document.getElementById('themeIcon');

            // Default to Dark Mode unless 'light' is explicitly saved
            if (savedTheme === 'light') {
                document.body.classList.add('light-mode');
                if (themeIcon) themeIcon.textContent = '☀️';
            } else {
                // Enforce Dark Mode (Remove class in case it was added elsewhere)
                document.body.classList.remove('light-mode');
                if (themeIcon) themeIcon.textContent = '🌙';
            }

            // Initialize Animation
            initHeroAnimation();
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

                        if (currentPlan !== 'pro' && currentPlan !== 'premium') {
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
                        if (currentPlan.toLowerCase() !== 'pro' && currentPlan.toLowerCase() !== 'premium') {
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
                            isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium');
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
                        jsonString = jsonString.replace(/\n/g, ' ').replace(/\r/g, ' ');

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
                        isPaidPlan = (currentPlan === 'pro' || currentPlan === 'premium');
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

                jsonString = jsonString.replace(/[\r\n\t]/g, ' ');

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

            if (currentPlan !== 'pro' && currentPlan !== 'premium') {
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
                    jsonString = jsonString.replace(/[\r\n\t]/g, ' ');

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
                            teamRole: status.teamRole || ''
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
                    // ১. প্রথমে সরাসরি 'plan' ফিল্ড চেক করা সবচেয়ে নিরাপদ
                    const rawP = String(profile.plan || "").toLowerCase();

                    // ২. বড় লিমিটটিকে আগে প্রাধান্য দিন (Priority: monthlyLimit > legacy fields)
                    let userLimitVal = Number(profile.monthlyLimit || profile.monthly_limit || 0);

                    // ৩. প্ল্যান ডিটেকশন লজিক ফিক্স (বড় সংখ্যা দিয়ে চেক করা হচ্ছে)
                    if (rawP.includes('premium') || userLimitVal >= 3000) {
                        plan = 'premium';
                    } else if (rawP.includes('pro') || userLimitVal >= 2000 || userLimitVal === 3000) {
                        plan = 'pro';
                    } else {
                        plan = 'free';
                    }
                }

                // ৪. প্ল্যান অনুযায়ী স্ট্যান্ডার্ড লিমিট এবং ডেইলি ক্যাপ সেট করা
                const monthlyLimit = (plan === 'premium') ? 3000 : (plan === 'pro' ? 2000 : 120);
                const dailyCap = (plan === 'premium') ? 100 : (plan === 'pro' ? 70 : 10);

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
                    monthlyCount: dailyCount, // অথবা এখানে মাসিক ব্যবহারের আলাদা কোড দিতে পারেন
                    monthlyLimit: monthlyLimit,
                    plan: plan,
                    referralBonus: Number(profile?.referral_bonus || 0),
                    hasClaimedShareBonus: profile?.has_claimed_share_bonus || false
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
            const usage = window.userUsageData || { plan: 'free' };
            const currentPlan = (usage.plan || 'free').toLowerCase();

            // ১. প্রিমিয়াম চেক
            if (currentPlan === 'free') {
                alert("Similarity Checker is a PRO/PREMIUM feature to protect your account from spam rejection.");
                if (typeof scrollToPricing === 'function') scrollToPricing();
                return;
            }

            if (window.uploadedFilesData.length < 2) {
                alert("Upload at least 2 images to check similarity.");
                return;
            }

            const btn = this;
            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';

            // ২. ইমেজ হ্যাশ জেনারেট করা
            const fileHashes = [];
            for (const fileData of window.uploadedFilesData) {
                try {
                    const hash = await getImageFingerprint(fileData.id);
                    fileHashes.push({ id: fileData.id, name: fileData.name, hash: hash });
                } catch (e) { console.error("Hash failed for", fileData.name); }
            }

            // ৩. প্রতিটি ইমেজের সাথে তুলনা করা
            let similarFound = 0;
            // আগের ওয়ার্নিং ক্লিয়ার করা
            document.querySelectorAll('.similarity-warning, .similarity-badge').forEach(el => el.remove());

            for (let i = 0; i < fileHashes.length; i++) {
                for (let j = i + 1; j < fileHashes.length; j++) {
                    const distance = calculateHammingDistance(fileHashes[i].hash, fileHashes[j].hash);
                    // Hamming distance কম মানে মিল বেশি (০-৬৪ স্কেলে, ১০ এর নিচে মানে খুব সিমিলার)
                    if (distance < 12) {
                        markAsSimilar(fileHashes[j].id, fileHashes[i].name);
                        similarFound++;
                    }
                }
            }

            btn.disabled = false;
            btn.innerHTML = originalHTML;

            if (similarFound > 0) {
                alert(`Found ${similarFound} highly similar images! Red-marked images might be rejected as spam by stock agencies.`);
            } else {
                alert("Great! No significant similarity or spam detected in your batch.");
            }
        };

        // ইমেজের ডিজিটাল ফিঙ্গারপ্রিন্ট তৈরি (Average Hash Algorithm)
        async function getImageFingerprint(cardId) {
            return new Promise((resolve) => {
                const img = document.querySelector(`#${cardId} .thumbnail-medium`);
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // ৮x৮ ছোট ইমেজ তৈরি (কালার ইগনোর করে শুধু স্ট্রাকচার দেখার জন্য)
                canvas.width = 8;
                canvas.height = 8;
                ctx.drawImage(img, 0, 0, 8, 8);

                const imageData = ctx.getImageData(0, 0, 8, 8).data;
                let grayScale = [];
                let total = 0;

                for (let i = 0; i < imageData.length; i += 4) {
                    const avg = (imageData[i] + imageData[i + 1] + imageData[i + 2]) / 3;
                    grayScale.push(avg);
                    total += avg;
                }

                const averageColor = total / 64;
                // ১ এবং ০ দিয়ে একটি ৬৪-বিটের হ্যাশ তৈরি করা
                const hash = grayScale.map(pixel => pixel > averageColor ? '1' : '0').join('');
                resolve(hash);
            });
        }

        // দুই হ্যাশের মধ্যে পার্থক্য বের করা
        function calculateHammingDistance(hash1, hash2) {
            let distance = 0;
            for (let i = 0; i < hash1.length; i++) {
                if (hash1[i] !== hash2[i]) distance++;
            }
            return distance;
        }

        // সিমিলার ইমেজ মার্ক করা
        function markAsSimilar(cardId, matchedWithName) {
            const card = document.getElementById(cardId);
            if (card) {
                card.classList.add('similarity-warning');
                if (!card.querySelector('.similarity-badge')) {
                    const badge = document.createElement('div');
                    badge.className = 'similarity-badge';
                    badge.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Similar to: ${matchedWithName}`;
                    card.querySelector('.card-image-col').appendChild(badge);
                }
            }
        }

        document.addEventListener('DOMContentLoaded', function () {
            const pricingToggle = document.getElementById('pricingToggle');
            const proPrice = document.querySelector('.pricing-card.popular .price');
            const premiumPrice = document.querySelector('.pricing-card.premium .price');
            const monthlyLabel = document.getElementById('monthlyLabel');
            const yearlyLabel = document.getElementById('yearlyLabel');

            // Monthly Prices
            const prices = {
                pro: { monthly: '<s>$12</s> $6', yearly: '<s>$115</s> $89', m_text: '/ month', y_text: '/ year' },
                premium: { monthly: '<s>$29</s> $14', yearly: '<s>$278</s> $209', m_text: '/ month', y_text: '/ year' }
            };

            pricingToggle.addEventListener('change', function () {
                if (this.checked) {
                    // Switch to Yearly
                    proPrice.innerHTML = `${prices.pro.yearly}<span data-i18n="year">${prices.pro.y_text}</span>`;
                    premiumPrice.innerHTML = `${prices.premium.yearly}<span data-i18n="year">${prices.premium.y_text}</span>`;

                    yearlyLabel.style.color = "var(--text-primary)";
                    yearlyLabel.style.fontWeight = "bold";
                    monthlyLabel.style.color = "var(--text-muted)";
                    monthlyLabel.style.fontWeight = "normal";
                } else {
                    // Switch to Monthly
                    proPrice.innerHTML = `${prices.pro.monthly}<span data-i18n="month">${prices.pro.m_text}</span>`;
                    premiumPrice.innerHTML = `${prices.premium.monthly}<span data-i18n="month">${prices.premium.m_text}</span>`;

                    monthlyLabel.style.color = "var(--text-primary)";
                    monthlyLabel.style.fontWeight = "bold";
                    yearlyLabel.style.color = "var(--text-muted)";
                    yearlyLabel.style.fontWeight = "normal";
                }
            });
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


// ===========================================
// SECTION 5: Multi-language Translations
// ===========================================
        const translations = {
            en: {
                flag: '🇺🇸',
                name: 'EN',
                band: 'MetaGen Pro',
                tagline: 'Metadata, Powered by AI',
                home: 'Home',
                features: 'Features',
                start_tour: 'Start Tour',
                faq: 'FAQ',
                menu: 'MENU',
                blog: 'Blog Post',
                disclaimer: 'Disclaimer',
                about: 'About Us',
                contact: 'Contact Us',
                legal: 'Legal',
                select_lang: 'Select Language',
                general_btn: "General",
                save_key: 'Save Keys',
                close: 'Close',
                get_key: 'Get Key',
                badge: 'Badge',
                try_metagen: 'Try MetaGen Free',
                no_api: 'No API Key required for your trial',
                ref: 'Unlock Extra Daily Limit!',
                ref_text: 'Share MetaGen Pro. When someone joins by clicking on your referral link, your daily process limit will increase by +50!',
                ref_share_btn: 'Share now',
                watting_for: 'What are you waiting for?',
                "get_start": "Get Started for Free",
                "drag_and_drop": "Drag and drop anywhere to upload",
                "fast": "Fast",
                "best": "Best",
                "generate_meta": "Generate Metadata",
                "delete_select": "Delete Selected",
                "down_select": "Download Selected", // Fixed logical typo based on key name
                "translate_select": "Translate Selected",
                "done": "Done",
                "processing": "Processing",
                "analyzing_market": "Analyzing Market Trends...",
                "ai_is_researching": "AI is researching high-performing concepts for you.",
                "analyzing": "Analyzing...",
                "copy_tag": "Copy Tags",
                "copy_idea": "Copy Idea & Info",
                "download": "Download",
                "enter_your_convert_api": "Enter your Convert API key to enable EPS file conversions.",
                "export_csv": "Export CSV",
                "export_excel": "Export Excel",
                "niche_research_cen": "Niche Research Center",
                "niche_research_tag": "Discover high-demand, low-competition keywords and concepts for your stock portfolio.",
                "select_category": "Select Category",
                "market_focus": "Market Focus",
                "analyze_trend": "Analyze Trends",
                "ready_to_research": "Ready to Research",
                "ready_to_research_tag": "Select a category above and click \"Analyze Trends\" to uncover profitable niches.",
                "quick_suggest": "Quick Suggestions",
                "label_title": "Title",
                "label_desc": "Description",
                "label_keywords": "Keywords",
                "btn_copy": "Copy",
                "btn_add": "Add",
                "placeholder_add_kw": "Add keyword...",
                "seo_score": "SEO Score",
                "rejection": "Rejection",
                "platform_check": "Platform Check",
                "style": "Style",
                "mode": "Mode",
                "translate": "Translate",
                "go": "Go",
                "min_title": "Min Title Words",
                "max_title": "Max Title Words",
                "min_keywords": "Min Keywords",
                "max_keywords": "Max Keywords",
                "min_desc": "Min Description Words",
                "max_desc": "Max Description Words",
                "toggle_silhouette": "Silhouette",
                "toggle_vector": "Vector / Illustration Mode",
                "toggle_white_bg": "White Background",
                "toggle_trans_bg": "Transparent Background",
                "toggle_custom_prompt": "Custom Prompt",
                "toggle_prohibited": "Prohibited Words",
                "toggle_single_kw": "Single Word Keywords",
                "toggle_change_name": "Change File Name",
                "toggle_name_title": "File Name as Title",
                "feedback_matters": "Your Feedback Matters",
                "provide_feedback": "Please provide feedback about the tool?",
                "issue_type": "Issue Type",
                "general_feedback": "General Feedback",
                "bug_report": "Bug Report",
                "feature_request": "Feature Request",
                "your_mess": "Your Message",
                "send_feed": "Send Feedback",
                "trial_credits": "Trial Credits",
                "trial_footer": "First 10 images are on us! Add your API key for unlimited use.",
                eps_meta: 'EPS Metadata Generate & Embed',
                month: '/ month',
                pricing: 'Pricing',
                ftp_upload: 'FTP Direct Upload',
                ftp_upload_sub_txt: 'Upload files directly to stock sites (Adobe Stock, Shutterstock, Magnific).',
                upgrade_plan: 'Upgrade Plan',
                stock_calendar: 'Stock Calendar',
                get_access: 'Get access',
                pricing_plan: 'Our Pricing Plan',
                pricing_sub_txt: 'Choose the perfect plan for your creative workflow.',
                free_plan: 'Free Plan',
                free_price: '$0/month',
                most_popular: 'Most Popular',
                pro_plan: 'Upgrade to Pro',
                pro_price: '$12/month',
                premium_plan: 'Premium Plan',
                premium_price: '$29/month',
                '50_image': '120 images/month (Max 10/day for fair usage)',
                basic_ai_model: 'Basic AI models (Gemini, Mistral, Groq) Use your own API key.',
                batch_process: 'Batch process: up to 50 files',
                csv_export: 'CSV Export',
                ads_support: 'Ads Supported',
                auto_embed: 'Metadata Auto Embed (JPG/PNG/SVG)',
                excel_export: 'Excel Export',
                drag_keyword: 'Drag & Drop Keyword Reordering',
                copy_trade_check: 'Copyright/Trademark Check',
                get_started_free: 'Get Started Free',
                '300_images': '2000 images/month',
                advance_ai: 'Advanced AI models (API key not required.)',
                batch_process_pro: 'Batch process: up to 100 files',
                csv_excel_ex: 'CSV/Excel Export',
                seo_and_no_ads: 'SEO Analytics & No Ads',
                support_time: 'Support time 24hours',
                '1k_image': '3000 images/month',
                all_pro: 'All Pro Features',
                batch_process_pre: 'Batch process: up to 300 files',
                ftp_auto_up: 'FTP/SFTP Auto Upload',
                vector_eps: 'Direct Vector/EPS conversion',
                vip_support: 'VIP Support & Early Access',
                privacy_policy: 'Privacy Policy',
                terms_of_service: 'Terms of Service',
                adjustment: 'Adjustment',
                multi_tool: 'Multi Image Tools',
                sketch_art: 'Image to Sketch Art',
                all_tools: 'All Tools',
                image_enhance: 'AI Image Enhancer',
                bg_remove: 'AI Background Remover',
                pixel_check: 'Pixel-Check Studio',
                text_to_image: 'Text to Image Generator',
                company: 'Company',
                free_plan: 'Free plan',
                note: 'API access will be removed in 7 days. Upgrade to the Pro/Premium plan and use all the features of MetaGen Pro.',
                platform: 'Platform',
                add_more: 'Add More File',
                well_come: 'Welcome Back',
                login_google: 'Continue with Google',
                new_user: 'New user?',
                create_account: 'Create an account',
                niche_research: 'Niche Research',
                metadata_generator: 'Metadata Generator',
                seo_score: 'SEO Score & Analytics',
                batch_process: 'Super Fast Batch Process',
                sign_out: 'Sign out',
                switch_account: 'Switch account',
                upload_title: 'Upload Images or Videos',
                drag_drop: 'Drag & drop files here or click to upload',
                supports: 'Supports JPG, PNG, WEBP, MP4, MOV',
                max_size: 'Max 50MB per file',
                privacy_note: 'Your files are processed securely and deleted after 1 hour.',
                privacy_note_device: 'We analyze files on-device only, data is purged after processing.',
                upload_limit_info: 'Plan: {{plan}} | Limit: {{limit}} files/day',
                usage: 'Usage:',
                "daily_limit": "Daily Process Limit",
                refer_text: 'Share MetaGen Pro to get +50 extra monthly limit!',
                "share_get_credit": "Share & Get Process Credit",
                generate_metadata: 'Generate Metadata',
                "limit_reached_msg": "You have reached your daily process limit! Upgrade your plan for higher limits or share the tool for a bonus.",
                export_csv: 'Export to CSV',
                export_excel: 'Export to Excel',
                clear_all: 'Clear All',
                copy_all: 'Copy All',
                down_eps: 'Download EPS',
                guides: 'Guides',
                title: 'Title',
                description: 'Description',
                keywords: 'Keywords',
                categories: 'Categories',
                already_user: 'Already have an account?',
                login: 'Login',
                tools_generator: 'Tools & Generator',
                trending: '📅 Trending...',
                customization: 'Customization',
                settings: 'Settings',
                select_ai: 'Select AI Provider',
                manage_api: 'Manage API Keys',
                convert_api: 'ConvertAPI Key',
                translation_lang: 'Translation Language',
                upload_files: 'Upload Files',
                watch_demo: 'Watch Demo',
                watch_tagline: 'See how to boost your stock sales in seconds',
                process_selected: 'Process Selected',
                batch_quality_check: 'Batch Quality Check',
                check_quality: 'Quality Check',
                quality_pending: 'Quality: Pending',
                process_prompts: 'Process Prompts',
                embed_metadata: 'Embed Metadata',
                export: 'Export',
                batch_translate: 'Batch Translate (Free)',
                translate_all: 'Translate All (Pro)',
                test_metadata: 'Test Metadata',
                save_folder: 'Save to Folder',
                upload_complete: 'Upload Complete',
                share_files: 'Share Files',
                upload_drive: 'Upload to Drive',
                pause: 'Pause',
                image_to_prompt: 'Image to Prompt',
                jpg_png: 'JPG/PNG',
                svg_eps: 'SVG/EPS/AI',
                videos: 'Videos',
                check_copyright: 'Check for Copyright/Trademark:',
                upload_limit: 'Upload a maximum of 500 files in a single action',
                resume: 'Resume',
                send_feedback: 'Send Feedback / Bug Report',
                view_translated: 'View Translated',
                view_original: 'View Original',
                analyze_trends: 'Analyze Trends',
                downloading: 'Downloading...',
                translating: 'Translating...',
                embedding: 'Embedding...',
                analyzing: 'Analyzing...',
                processing: 'Processing...',
                process: 'Process',
                files: 'Files',
                prompts: 'Prompts',
                complete: 'Complete',
                success: 'Success',
                fail: 'Failed',
                saving: 'Saving...',
                preparing: 'Preparing...',
                uploading: 'Uploading...',
                initializing: 'Initializing connection...',
                "faq_q1": "How to use MetaGen Pro?",
                "faq_a1": "Upload your stock photos/videos -> Select AI Model -> Click 'Generate Metadata' -> Review and Download!",
                "faq_q2": "Is MetaGen Pro free? What's the pricing?",
                "faq_a2": "<p><strong>Free for everyone!</strong> MetaGen Pro offers a robust Free plan (120 images/month, max 25/day). For heavy users, we have <strong>Pro</strong> ($12/mo - 2000 images/month, max 70/day) and <strong>Premium</strong> ($29/mo - 3000 images/month, max 100/day) plans with advanced features like Excel export and direct FTP upload.</p>",
                "faq_q3": "Is my data safe?",
                "faq_a3": "Yes, we process all data on-device or via secure AI endpoints and purge it immediately after use.",
                "faq_q4": "Which formats are supported?",
                "faq_a4": "Currently we support JPG, PNG, WEBP, MP4, MOV. Support for SVG and EPS is available via ConvertAPI.",
                "faq_q5": "Can I upgrade my plan?",
                "faq_a5": "Yes! You can upgrade anytime from the Pricing section. Contact us at metagenp@gmail.com for early access billing details.",
                "faq_q6": "How can I get more process limits?",
                "faq_a6": "You can get +50 extra monthly limits for one month by referring your friends! Find your referral link in the profile modal.",
                "hero_title": "Free AI Metadata Generator & Stock Photo Keywords!",
                hero_tagline: 'Boost your visibility on Shutterstock, Adobe Stock, and Magnific. Generate SEO-optimized titles, descriptions, and keywords in seconds using advanced AI.',
                why_choose: 'Why Choose MetaGen Pro?',
                blog_1: 'Super Fast Batch Processing',
                blog_tag_1: 'Analyze and keyword hundreds of images in seconds. Save hours of manual work with our optimized batch engine.',
                blog_2: 'Advanced AI Analysis',
                blog_tag_2: 'Powered by Advance AI Model for industry-leading image recognition and accurate metadata.',
                blog_3: 'SEO Optimized Keywords',
                blog_tag_3: 'Generate high-ranking titles and tags specifically tailored for Shutterstock, Adobe Stock & Magnific algorithms.',
                blog_4: 'Niche Research',
                blog_tag_4: 'Discover low-competition, high-demand topics with our built-in Niche Research tool. Find what buyers are searching for.',
                blog_5: 'Drag & Drop Keyword Reordering',
                blog_tag_5: 'On stock sites (Adobe Stock, Shutterstock) the first 5-10 keywords are the most important.',
                blog_6: 'Metadata Embedding',
                blog_tag_6: 'Embed titles and keywords directly into your JPG/PNG/SVG files (IPTC/XMP). Simply download and upload to any stock agency.',
                blog_7: 'Multi-Language',
                blog_tag_7: 'Translate your metadata into 10+ languages instantly. Reach a global audience with localized titles and descriptions.',
                blog_8: 'Copyright Check',
                blog_tag_8: 'Avoid rejection! Our AI scans for potential trademark issues and logos in your images before you upload them.',
                blog_9: 'Export Metadata CSV',
                blog_tag_9: 'All stock site\'s (Adobe Stock, Shutterstock, Magnific) CSV file export facility.',
                trusted_all: 'Trusted for All Major Microstock Platforms',
                it_works: 'How It Works',
                upload_photos: 'Upload Photos',
                upload_photos_tag: 'Drag & drop your JPG/PNG files. We automatically read dimensions and tech specs.',
                select_platfrom: 'Select Platform & AI',
                select_platfrom_tag: 'Choose your target market (e.g. Adobe Stock) and preferred AI model (Gemini/Groq).',
                gen_down: 'Generate & Download',
                gen_down_tag: 'Get SEO-ready titles & keywords instantly. Download CSV or Embed directly.',
                processing_files: 'Processing Files...',
                why_choose_stock_title: 'Why Choose MetaGen Pro for Stock Photography?',
                how_to_use_title: 'How to use Tool?',
                master_stock_title: 'Master Your Stock Photography with AI-Powered Metadata',
                trusted_stock_title: 'Trusted by Stock Contributors Across the USA',
                why_choose_stock_p1: 'In the competitive world of stock photography, discoverability is key. Even the best images won\'t sell if buyers can\'t find them. <strong>MetaGen Pro</strong> is the ultimate <em>AI Metadata Generator</em> designed to solve this problem.',
                why_choose_stock_p2: 'Unlike manual keywording which is tedious and prone to errors, our tool uses state-of-the-art computer vision to analyze your image\'s subject, mood, lighting, and composition. It then generates 50+ optimized keywords, catchy titles, and detailed descriptions tailored for platforms like <strong>Shutterstock, Adobe Stock, Magnific, and Vecteezy</strong>.',
                why_choose_stock_p3: 'Whether you are a photographer, illustrator, or AI artist, MetaGen Pro streamlines your workflow. Features like <strong>Image-to-Prompt</strong> help you reverse-engineer successful AI images, while our <strong>Rejection Predictor</strong> helps you fix technical issues before uploading.',
                why_choose_stock_p4: 'Start maximizing your passive income today with the most advanced, free stock photo tagger available.',
                "plan_details_title": "Which Plan is Right for You?",
                "plan_details_free": "Free Plan - Best for Beginners",
                "plan_details_free_p1": "Our Free Plan is designed for hobbyists and new stock contributors. It allows you to process up to <strong>120 images per month (Max 10/day)</strong>. To keep the service completely free, You get access to our core features including super-fast batch processing (up to 10 files at once), AI metadata generation, and CSV export. Note that advanced features like Metadata Auto-Embed, Excel Export, and Copyright Checks are not included in this plan.",
                "plan_details_pro": "Pro Plan - For Professionals",
                "plan_details_pro_p1": "The Pro Plan is built for regular contributors who want to maximize their workflow and save hours of time. With a generous limit of <strong>2000 images/month (Max 70/day)</strong>, you no longer need to bring your own API keys—we handle all AI requests securely on our end. This plan unlocks powerful tools like <strong>Metadata Auto-Embed</strong> directly into your JPEG/PNG/SVG files, Drag & Drop Keyword Reordering, AI Copyright/Trademark checking, and Excel export. It also increases your batch processing limit to 100 files at once and offers a completely ad-free experience.",
                "plan_details_premium": "Premium Plan - For Power Users & Agencies",
                "plan_details_premium_p1": "Designed for high-volume creators, vector artists, and agencies, the Premium Plan offers a massive limit of <strong>3000 images/month (Max 100/day)</strong> and a batch limit of 300 files. It includes everything in the Pro plan, plus advanced automation features. You get exclusive access to <strong>Direct Vector/EPS conversion</strong> (no need for 3rd party ConvertAPI keys) and the <strong>FTP/SFTP Auto Upload</strong> feature. This allows you to automatically distribute your processed files and metadata directly to multiple stock agencies (Shutterstock, Adobe Stock, Magnific, etc.) straight from your browser.",
                "htu_step1_title": "1. Upload Files",
                "htu_step1_desc": "Drag & drop images (JPG/PNG), vectors (SVG/EPS), or videos to start.",
                "htu_step2_title": "2. Target Platform",
                "htu_step2_desc": "Select Shutterstock, Adobe Stock, or Magnific for optimized results.",
                "htu_step3_title": "3. AI Model Select",
                "htu_step3_desc": "Choose between Gemini, Mistral, or Groq for image analysis.",
                "htu_step4_title": "4. Customization",
                "htu_step4_desc": "Adjust Min/Max words for titles and keywords using sliders.",
                "htu_step5_title": "5. AI Settings",
                "htu_step5_desc": "Enable Vector Mode, White BG, or use your own Custom Prompts.",
                "htu_step6_title": "6. Generate Metadata",
                "htu_step6_desc": "Click 'Process Selected' to get SEO-ready titles and tags instantly.",
                "htu_step7_title": "7. Embed Metadata",
                "htu_step7_desc": "Directly write metadata into your JPG, PNG, or SVG files.",
                "htu_step8_title": "8. Multi-Translate",
                "htu_step8_desc": "Translate metadata into 10+ languages for a global market.",
                "htu_step9_title": "9. Export Results",
                "htu_step9_desc": "Download all your metadata as CSV or professional Excel sheets.",
                "htu_step10_title": "10. Save & Drive",
                "htu_step10_desc": "Save to local folder, share via link, or upload directly to Drive.",
                master_stock_subtitle1: 'How to Use MetaGen Pro',
                master_stock_p1: 'Getting started with MetaGen Pro is incredibly simple and requires no technical expertise. First, upload your images by dragging and dropping them into the designated upload area, or click to browse your files. MetaGen Pro supports all major image formats including JPG, PNG, SVG, and EPS, as well as video files. Once your images are uploaded, select your target platform (Shutterstock, Adobe Stock, Magnific, or General) to optimize the metadata specifically for that marketplace.',
                master_stock_p2: 'Next, configure your preferences using the sidebar settings. You can adjust the number of keywords (we recommend 35-50 for optimal SEO), set title length constraints, and enable special features like Vector Mode for illustrations or White Background detection for product images. The AI provider selection allows you to choose between Google Gemini, Mistral AI, or Groq Llama models based on your API availability and speed preferences.',
                master_stock_p3: 'After configuration, click the "Process All" button to generate metadata for all uploaded images simultaneously. Our advanced AI analyzes each image\'s visual content, composition, colors, subjects, and context to create highly relevant titles, descriptions, and keyword sets. The entire process typically takes just seconds per image, even when processing hundreds of files in batch mode.',
                master_stock_subtitle2: 'Benefits of Using This Tool',
                master_stock_benefit1: '<strong>Time Efficiency:</strong> Manual keywording can take 10-15 minutes per image. MetaGen Pro reduces this to mere seconds, allowing you to keyword hundreds of images in the time it would take to manually process just a few. For professional contributors uploading 50-100 images weekly, this translates to saving 10+ hours every single week.',
                master_stock_benefit2: '<strong>SEO Optimization:</strong> Our AI doesn\'t just describe what it sees—it understands search intent and marketplace algorithms. Each metadata set includes a strategic mix of broad keywords (high search volume), specific long-tail keywords (high conversion), and trending terms (current demand). The built-in SEO Score meter evaluates your metadata in real-time, ensuring every upload is optimized for maximum discoverability.',
                master_stock_benefit3: '<strong>Multi-Platform Support:</strong> Different stock agencies have different requirements and preferences. MetaGen Pro adapts to each platform\'s unique algorithm—Shutterstock prefers different keyword structures than Adobe Stock or Magnific. Our platform-specific optimization ensures your images rank well wherever you upload them.',
                master_stock_benefit4: '<strong>Consistency and Quality:</strong> Eliminate human error and maintain professional standards across your entire portfolio. MetaGen Pro ensures every image has properly formatted metadata, adequate keyword quantity, and appropriate descriptions. The Rejection Predictor feature analyzes your metadata against common rejection criteria, helping you avoid costly submission failures.',
                master_stock_subtitle3: 'What is Image SEO and Why It Matters',
                master_stock_seo_p1: 'Image SEO (Search Engine Optimization) is the practice of optimizing image metadata to improve visibility in search results on stock photography platforms and search engines. When a buyer searches for "business meeting" or "tropical beach sunset," the platform\'s algorithm doesn\'t "see" your image—it reads the metadata you\'ve provided. Effective Image SEO is the difference between your work appearing on page 1 versus page 50 of search results.',
                master_stock_seo_p2: '<strong>The Three Pillars of Image SEO:</strong> First, the <em>Title</em> should be descriptive yet concise (10-20 words), containing your primary keywords while remaining natural and readable. Second, the <em>Description</em> provides context and use cases (30-50 words), helping both algorithms and buyers understand your image\'s commercial applications. Third, <em>Keywords</em> cast a wide net (35-50 terms recommended), capturing various search queries that could lead buyers to your image.',
                master_stock_seo_p3: '<strong>Keyword Strategy Matters:</strong> The most effective metadata uses a balanced mix: 20-30% single-word keywords (broad reach), 40-50% two-word phrases (medium specificity), and 20-30% long-tail keywords (high conversion). For example, an image of hands using a smartphone should include "hands" (broad), "smartphone interaction" (medium), and "hands tapping mobile app interface" (long-tail). This strategy maximizes your image\'s chances of appearing in both broad and specific searches.',
                master_stock_seo_p4: '<strong>Search Ranking Factors:</strong> Stock platforms consider multiple factors when ranking search results. Relevance (how well your metadata matches the search query), completeness (having all metadata fields filled properly), and keyword diversity (using varied, related terms) all impact your ranking. Additionally, commercial relevance—describing how buyers can use your image—significantly impacts conversion rates even when your image does rank well.',
                master_stock_seo_p5: 'MetaGen Pro automates all these best practices, ensuring every image you upload is fully optimized for maximum visibility, downloads, and ultimately, income. Whether you\'re a hobbyist contributor or a full-time stock photographer, proper Image SEO is non-negotiable in today\'s competitive marketplace.',
                master_stock_cta: '<strong>Ready to boost your stock photography success?</strong> Start using MetaGen Pro today and transform hours of tedious keywording into seconds of automated excellence.',
                trusted_stock_subtitle: 'Discover why thousands of American photographers and creators rely on MetaGen Pro to boost their stock revenue',
                review_1_details: '📍 New York, NY • Professional Photographer',
                review_1_text: '"MetaGen Pro transformed my workflow completely! I used to spend hours keywording my photos for Shutterstock. Now it takes just minutes and my downloads have increased by 40%. The SEO score feature is brilliant!"',
                review_2_details: '📍 Los Angeles, CA • Content Creator',
                review_2_text: '"As a full-time content creator, time is money. This tool saves me at least 10 hours per week on metadata entry. The batch processing is lightning fast and the AI-generated keywords are spot-on. Best investment I\'ve made this year!"',
                review_3_details: '📍 Miami, FL • Stock Contributor',
                review_3_text: '"I was skeptical at first, but MetaGen Pro exceeded all expectations. The keyword suggestions are incredibly relevant and the multi-language feature helped me reach international buyers. My Adobe Stock earnings doubled in just 3 months!"',
                review_4_details: '📍 Chicago, IL • Graphic Designer',
                review_4_text: '"The copyright check feature alone is worth the price! It\'s saved me from potential rejections multiple times. Combined with the automated metadata generation, this tool is a must-have for anyone serious about stock photography."',
                review_5_details: '📍 Seattle, WA • Nature Photographer',
                review_5_text: '"I upload hundreds of nature photos every month. MetaGen Pro makes it effortless to manage and optimize all of them. The CSV export feature seamlessly integrates with my workflow. Highly recommend to fellow contributors!"',
                review_6_details: '📍 Austin, TX • Freelance Videographer',
                review_6_text: '"Game-changer for video metadata! The AI accurately identifies scenes and generates perfect titles. My Shutterstock video portfolio visibility improved dramatically. Support team is also extremely responsive and helpful."',
                stat_users: 'Active US Users',
                stat_satisfaction: 'Satisfaction Rate',
                stat_images: 'Images Optimized Daily',
                stat_rating: 'Average Rating',
                "faq_title": "Frequently Asked Questions — MetaGen Pro",
                "faq_q1": "🚀 How do I get started with MetaGen Pro?",
                "faq_a1": "<strong>Step 1:</strong> Sign up or login with your Google account or email.<br><strong>Step 2:</strong> Upload your images (JPG, PNG, SVG, EPS) - up to 500 at once!<br><strong>Step 3:</strong> Select your target platform (Shutterstock, Adobe Stock, etc.) and click 'Generate Metadata'.<br><strong>Step 4:</strong> Review, edit if needed, and download the files with embedded metadata!",
                "faq_q2": "💰 Is MetaGen Pro free? What is the pricing?",
                "faq_a2": "<p><strong>Free plan for everyone!</strong> MetaGen Pro offers a powerful free plan (120 images/month, max 25 daily). For heavy usage, we have <strong>Pro</strong> ($12/mo - 2000 images/month, max 70 daily) and <strong>Premium</strong> ($29/mo - 3000 images/month, max 100 daily) plans. Paid plans include advanced features like auto-embedding, Excel export, and direct FTP upload.</p>",
                "faq_q3": "🔑 Do I need an API key to use MetaGen Pro?",
                "faq_a3": "<p><strong>No, no API key is required for any plan now!</strong> In all plans, Free, Pro, and Premium, we process metadata using our own servers and Supabase Edge Functions dedicated AI models (advanced AI models).</p><p><strong>Security:</strong> All your data is completely <strong>safe</strong> and is deleted from the server immediately after processing.</p>",
                "faq_q4": "📁 Which file formats are supported?",
                "faq_a4": "<p><strong>Supported Formats:</strong></p><ul><li><strong>JPG/JPEG:</strong> Full support with EXIF embedding</li><li><strong>PNG:</strong> Full support with metadata embedding</li><li><strong>SVG:</strong> Full support with XMP metadata embedding</li><li><strong>EPS:</strong> Converted and processed</li></ul><p>Upload up to <strong>500 files</strong> at a time!</p>",
                "faq_q5": "🎯 Which platforms are supported?",
                "faq_a5": "<p>Optimized for all major platforms including Shutterstock, Adobe Stock, Magnific, Vecteezy, Pond5, 123RF, and more. Our AI generates metadata according to each platform's rules!</p>",
                "faq_q6": "📊 What are SEO Score and Keyword Badges?",
                "faq_a6": "<p><strong>SEO Score:</strong> Measures how well your metadata is optimized for search algorithms.</p><p><strong>Badges:</strong></p><ul><li>🟢 <strong>Green:</strong> One-word keyword (High search volume)</li><li>🟡 <strong>Yellow:</strong> Two-word keyword (Best balance)</li><li>🔵 <strong>Blue:</strong> 3+ word keyword (Specific target)</li></ul>",
                "faq_q7": "⚡ How does batch processing work?",
                "faq_a7": "<p>Upload up to 500 images and click 'Process Selected'. Our AI processes all images simultaneously. It's extremely fast—processing 100 images takes about the same time as one!</p>",
                "faq_q8": "🎨 What is the 'Image to Prompt' feature?",
                "faq_a8": "<p>It converts your image into a detailed prompt that can be used in Midjourney or DALL-E. Great for understanding the structure of successful stock photos!</p>",
                "faq_q9": "🔒 Is my data safe? Do you save images?",
                "faq_a9": "<p><strong>100% Private!</strong> All processing happens in your browser. We never save your images. Data is wiped as soon as the process is complete.</p>",
                "faq_q10": "🔧 Common Issues and Solutions",
                "faq_a10": "<ul><li><strong>Server Error:</strong> Check your internet and refresh the page.</li><li><strong>File too large:</strong> Try to keep it under 20MB.</li><li><strong>Slow speed:</strong> Keep other browser tabs closed.</li></ul>",
                "faq_q11": "🎭 How does the AI Image Generator work?",
                "faq_a11": "<p>Use the FLUX model to generate images directly. Write a prompt and create unique images for your stock portfolio!</p>",
                "faq_q12": "💬 How to get help or give feedback?",
                "faq_a12": "<p>Email us at: <strong>metagenp@gmail.com</strong> or use the in-app feedback button. We try to respond within 12 hours!</p>"
            },

            bn: {
                flag: '🇧🇩',
                name: 'BN',
                band: 'মেটাজেন প্রো',
                tagline: 'মেটাডেটা, AI দ্বারা চালিত',
                home: 'হোম',
                features: 'ফিচার',
                start_tour: 'ট্যুর শুরু করুন',
                faq: 'প্রশ্নাবলী',
                menu: 'মেনু',
                blog: 'ব্লগ',
                disclaimer: 'দাবিত্যাগ',
                about: 'আমাদের সম্পর্কে',
                contact: 'যোগাযোগ',
                legal: 'আইনি',
                select_lang: 'ভাষা নির্বাচন করুন',
                general_btn: "সাধারণ",
                save_key: 'কী সেভ করুন',
                close: 'বন্ধ করুন',
                get_key: 'কী পান',
                trial_credits: 'ট্রায়াল ক্রেডিট',
                trial_footer: 'প্রথম ১০টি ইমেজ আমাদের পক্ষ থেকে ফ্রি! আনলিমিটেড ব্যবহারের জন্য আপনার API Key যুক্ত করুন।',
                badge: 'ব্যাজ',
                try_metagen: 'MetaGen ফ্রি ব্যবহার করুন',
                no_api: 'আপনার বিনামূল্যের ট্রায়ালের জন্য কোনও API কী প্রয়োজন নেই।',
                ref: 'ডাবল লিমিট আনলক করুন!',
                ref_text: 'Metagen Pro. শেয়ার করুন। আপনার রেফারেল লিঙ্কে ক্লিক করে কেউ জয়েন করলেই আপনার প্রতিদিনের লিমিট ৫০ থেকে ১০০ হয়ে যাবে!',
                ref_share_btn: 'এখনই শেয়ার করুন',
                watting_for: 'আপনি আর কিসের জন্য অপেক্ষা করছেন?',
                "get_start": "বিনামূল্যে শুরু করুন",
                "drag_and_drop": "আপলোড করার জন্য যেকোনো জায়গায় টেনে আনুন",
                "fast": "দ্রুত",
                "best": "সেরা",
                "generate_meta": "মেটাডেটা তৈরি করুন",
                "delete_select": "নির্বাচিত মুছুন",
                "down_select": "নির্বাচিত ডাউনলোড",
                "translate_select": "নির্বাচিত অনুবাদ",
                "done": "সম্পন্ন",
                "processing": "প্রক্রিয়া চলছে",
                "analyzing_market": "বাজারের ট্রেন্ড বিশ্লেষণ করা হচ্ছে...",
                "ai_is_researching": "AI আপনার জন্য সেরা কনসেপ্টগুলো খুঁজছে।",
                "analyzing": "বিশ্লেষণ করা হচ্ছে...",
                "copy_tag": "ট্যাগ কপি করুন",
                "copy_idea": "আইডিয়া ও তথ্য কপি করুন",
                "download": "ডাউনলোড",
                "enter_your_convert_api": "EPS ফাইল কনভার্সন চালু করতে আপনার Convert API কি দিন।",
                "export_csv": "CSV রপ্তানি করুন",
                "export_excel": "এক্সপোর্ট এক্সেল",
                "niche_research_cen": "নিশ রিসার্চ সেন্টার",
                "niche_research_tag": "আপনার স্টক পোর্টফোলিওর জন্য উচ্চ-চাহিদা কম-প্রতিযোগিতামূলক কীওয়ার্ড এবং ধারণাগুলি আবিষ্কার করুন।",
                "select_category": "বিভাগ নির্বাচন করুন",
                "market_focus": "বাজার ফোকাস",
                "analyze_trend": "ট্রেন্ডস বিশ্লেষণ করুন",
                "ready_to_research": "গবেষণার জন্য প্রস্তুত",
                "ready_to_research_tag": "উপরে একটি বিভাগ নির্বাচন করুন এবং লাভজনক নিশগুলি আবিষ্কার করতে \"ট্রেন্ডস বিশ্লেষণ করুন\" এ ক্লিক করুন।",
                "quick_suggest": "দ্রুত পরামর্শ",
                "label_title": "শিরোনাম",
                "label_desc": "বিবরণ",
                "label_keywords": "কিওয়ার্ড",
                "btn_copy": "কপি",
                "btn_add": "যুক্ত করুন",
                "placeholder_add_kw": "কিওয়ার্ড লিখুন...",
                "seo_score": "SEO স্কোর",
                "rejection": "বাতিল হওয়ার সম্ভাবনা",
                "platform_check": "প্ল্যাটফর্ম চেক",
                "style": "স্টাইল",
                "mode": "মোড",
                "translate": "অনুবাদ",
                "go": "যান",
                "min_title": "ন্যূনতম টাইটেল শব্দ",
                "max_title": "সর্বোচ্চ টাইটেল শব্দ",
                "min_keywords": "ন্যূনতম কিওয়ার্ড",
                "max_keywords": "সর্বোচ্চ কিওয়ার্ড",
                "min_desc": "ন্যূনতম বিবরণ শব্দ",
                "max_desc": "সর্বোচ্চ বিবরণ শব্দ",
                "toggle_silhouette": "সিলুয়েট",
                "toggle_vector": "ভেক্টর / ইলাস্ট্রেশন মোড",
                "toggle_white_bg": "সাদা ব্যাকগ্রাউন্ড",
                "toggle_trans_bg": "স্বচ্ছ ব্যাকগ্রাউন্ড",
                "toggle_custom_prompt": "কাস্টম প্রম্পট",
                "toggle_prohibited": "নিষিদ্ধ শব্দ বাদ দিন",
                "toggle_single_kw": "এক শব্দের কিওয়ার্ড",
                "toggle_change_name": "ফাইলের নাম পরিবর্তন",
                "toggle_name_title": "ফাইলের নাম টাইটেল হিসেবে",
                "feedback_matters": "আপনার প্রতিক্রিয়া গুরুত্বপূর্ণ",
                "provide_feedback": "দয়া করে টুলটি সম্পর্কে প্রতিক্রিয়া জানান?",
                "issue_type": "সমস্যার ধরণ",
                "general_feedback": "সাধারণ প্রতিক্রিয়া",
                "bug_report": "বাগ রিপোর্ট",
                "feature_request": "বৈশিষ্ট্য অনুরোধ",
                "your_mess": "আপনার বার্তা",
                "send_feed": "প্রতিক্রিয়া পাঠান",
                eps_meta: 'ইপিএস মেটাডেটা জেনারেট এবং এম্বেড করুন',
                month: '/ মাস',
                pricing: 'প্রাইসিং',
                ftp_upload: 'এফটিপি (FTP) সরাসরি আপলোড',
                ftp_upload_sub_txt: 'সরাসরি স্টক সাইটে ফাইল আপলোড করুন (Adobe Stock, Shutterstock, Magnific)।',
                upgrade_plan: 'প্ল্যান আপগ্রেড করুন',
                stock_calendar: 'স্টক ক্যালেন্ডার',
                get_access: 'অ্যাক্সেস পান',
                pricing_plan: 'আমাদের প্রাইসিং প্ল্যান',
                pricing_sub_txt: 'আপনার ক্রিয়েটিভ ওয়ার্কফ্লোর জন্য নিখুঁত প্ল্যানটি বেছে নিন।',
                free_plan: 'ফ্রি প্ল্যান',
                free_price: '$0/মাস',
                most_popular: 'সবচেয়ে জনপ্রিয়',
                pro_plan: 'প্রো-তে আপগ্রেড করুন',
                pro_price: '$12/মাস',
                premium_plan: 'প্রিমিয়াম প্ল্যান',
                premium_price: '$29/মাস',
                '50_image': '১২০টি ছবি/মাস (ফেয়ার ইউসেজ এর জন্য দৈনিক ১০টি)',
                basic_ai_model: 'বেসিক এআই মডেল (Gemini, Mistral, Groq) আপনার নিজস্ব API কী ব্যবহার করুন।',
                batch_process: 'ব্যাচ প্রসেস: ৫০টি ফাইল পর্যন্ত',
                csv_export: 'সিএসভি (CSV) এক্সপোর্ট',
                ads_support: 'বিজ্ঞাপন সমর্থিত',
                auto_embed: 'মেটাডেটা অটো এম্বেড',
                excel_export: 'এক্সেল (Excel) এক্সপোর্ট',
                drag_keyword: 'ড্র্যাগ অ্যান্ড ড্রপ কীওয়ার্ড রিঅর্ডারিং',
                copy_trade_check: 'কপিরাইট/ট্রেডমার্ক যাচাইকরণ',
                get_started_free: 'বিনামূল্যে শুরু করুন',
                '300_images': '২০০০টি ছবি/মাস (দৈনিক ৭০টি)',
                advance_ai: 'অ্যাডভান্স এআই মডেল (API কী প্রয়োজন নেই।)',
                batch_process_pro: 'ব্যাচ প্রসেস: ১০০টি ফাইল পর্যন্ত',
                csv_excel_ex: 'সিএসভি/এক্সেল (CSV/Excel) এক্সপোর্ট',
                seo_and_no_ads: 'এসইও অ্যানালিটিক্স এবং কোন বিজ্ঞাপন নেই',
                support_time: '২৪ ঘন্টা সাপোর্ট',
                '1k_image': '৩০০০টি ছবি/মাস (দৈনিক ১০০টি)',
                all_pro: 'সমস্ত প্রো ফিচার',
                batch_process_pre: 'ব্যাচ প্রসেস: ৩০০টি ফাইল পর্যন্ত',
                ftp_auto_up: 'এফটিপি/এসএফটিপি (FTP/SFTP) অটো আপলোড',
                vector_eps: 'সরাসরি ভেক্টর/ইপিএস (Vector/EPS) রূপান্তর',
                vip_support: 'ভিআইপি (VIP) সাপোর্ট এবং আর্লি অ্যাক্সেস',
                privacy_policy: 'গোপনীয়তা নীতি',
                terms_of_service: 'পরিষেবার শর্তাবলী',
                adjustment: 'সমন্বয়',
                multi_tool: 'মাল্টি ইমেজ টুলস',
                sketch_art: 'ছবি থেকে স্কেচ আর্ট',
                all_tools: 'সকল টুলস',
                image_enhance: 'এআই ইমেজ এনহ্যান্সার',
                bg_remove: 'এআই ব্যাকগ্রাউন্ড রিমুভার',
                pixel_check: 'পিক্সেল-চেক স্টুডিও',
                text_to_image: 'টেক্সট টু ইমেজ জেনারেটর',
                company: 'কোম্পানি',
                free_plan: 'ফ্রি প্ল্যান',
                note: '৭ দিনের মধ্যে এপিআই অ্যাক্সেস বন্ধ করে দেওয়া হবে। প্রো/প্রিমিয়াম প্ল্যানে আপগ্রেড করুন এবং মেটাজেন প্রো-এর সমস্ত ফিচার ব্যবহার করুন।',
                platform: 'প্ল্যাটফর্ম',
                add_more: 'আরও ফাইল যুক্ত করুন',
                login_google: 'Google দিয়ে চালিয়ে যান',
                new_user: 'নতুন ব্যবহারকারী?',
                create_account: 'একটি অ্যাকাউন্ট তৈরি করুন',
                niche_research: 'নিশ রিসার্চ',
                metadata_generator: 'মেটাডেটা জেনারেটর',
                seo_score: 'এসইও স্কোর এবং অ্যানালিটিক্স',
                batch_process: 'সুপার ফাস্ট ব্যাচ প্রসেস',
                sign_out: 'সাইন আউট',
                switch_account: 'অ্যাকাউন্ট পরিবর্তন করুন',
                upload_title: 'ছবি বা ভিডিও আপলোড করুন',
                drag_drop: 'ফাইল এখানে ড্র্যাগ অ্যান্ড ড্রপ করুন অথবা আপলোড করতে ক্লিক করুন',
                supports: 'JPG, PNG, WEBP, MP4, MOV সমর্থন করে',
                max_size: 'প্রতিটি ফাইল সর্বোচ্চ ৫০এমবি',
                privacy_note: 'আপনার ফাইলগুলো নিরাপদে প্রসেস করা হয় এবং ১ ঘণ্টা পর মুছে ফেলা হয়।',
                privacy_note_device: 'আমরা আপনার ডিভাইসেই ফাইল বিশ্লেষণ করি, প্রসেসিং শেষে ডেটা মুছে ফেলা হয়।',
                upload_limit_info: 'প্ল্যান: {{plan}} | সীমা: {{limit}} ছবি/প্রতিদিন',
                usage: 'ব্যবহার:',
                "daily_limit": "দৈনিক প্রসেস সীমা",
                refer_text: 'মেটাজেন প্রো শেয়ার করে ১ মাসের জন্য +৫০ মাসিক সীমা পান!',
                ref: 'অতিরিক্ত মাসিক সীমা আনলক করুন!',
                "share_get_credit": "শেয়ার করুন এবং প্রসেস ক্রেডিট পান",
                generate_metadata: 'মেটাডেটা জেনারেট করুন',
                "limit_reached_msg": "আপনার দৈনিক প্রসেস সীমা শেষ হয়ে গেছে! উচ্চতর সীমার জন্য আপনার প্ল্যান আপগ্রেড করুন বা বোনাসের জন্য টুলটি শেয়ার করুন।",
                export_csv: 'CSV এক্সপোর্ট করুন',
                export_excel: 'Excel এক্সপোর্ট করুন',
                clear_all: 'সব মুছে ফেলুন',
                copy_all: 'সব কপি করুন',
                down_eps: 'ডাউনলোড EPS',
                guides: 'গাইড',
                title: 'টাইটেল',
                description: 'বর্ণনা',
                keywords: 'কীওয়ার্ড',
                categories: 'ক্যাটাগরি',
                already_user: 'আগে থেকেই কি অ্যাকাউন্ট আছে?',
                login: 'লগইন',
                well_come: 'আবার স্বাগতম',
                tools_generator: 'টুলস ও জেনারেটর',
                trending: '📅 ট্রেন্ডিং...',
                customization: 'কাস্টমাইজেশন',
                settings: 'সেটিংস',
                select_ai: 'AI প্রোভাইডার নির্বাচন করুন',
                manage_api: 'API কী ম্যানেজ করুন',
                convert_api: 'ConvertAPI কী',
                translation_lang: 'অনুবাদ ভাষা',
                upload_files: 'ফাইল আপলোড করুন',
                watch_demo: 'ডেমো দেখুন',
                watch_tagline: 'দেখুন কীভাবে কয়েক সেকেন্ডে আপনার স্টক সেল বাড়ানো যায়',
                process_selected: 'নির্বাচিত গুলো প্রসেস করুন',
                batch_quality_check: 'ব্যাচ কোয়ালিটি চেক',
                check_quality: 'কোয়ালিটি চেক',
                quality_pending: 'কোয়ালিটি: পেন্ডিং',
                process_prompts: 'প্রম্পট প্রসেস করুন',
                embed_metadata: 'মেটাডেটা এম্বেড করুন',
                export: 'এক্সপোর্ট',
                batch_translate: 'ব্যাচ ট্রান্সলেট (ফ্রি)',
                translate_all: 'সব ট্রান্সলেট করুন (Pro)',
                test_metadata: 'মেটাডেটা টেস্ট করুন',
                save_folder: 'ফোল্ডারে সেভ করুন',
                upload_complete: 'আপলোড সম্পন্ন',
                share_files: 'ফাইল শেয়ার করুন',
                upload_drive: 'ড্রাইভ আপলোড করুন',
                pause: 'বিরতি',
                image_to_prompt: 'ইমেজ থেকে প্রম্পট',
                jpg_png: 'JPG/PNG',
                svg_eps: 'SVG/EPS/AI',
                videos: 'ভিডিও',
                check_copyright: 'কপিরাইট/ট্রেডমার্ক চেক করুন:',
                upload_limit: 'একসাথে সর্বোচ্চ ৫০০টি ফাইল আপলোড করুন',
                resume: 'পুনরায় শুরু করুন',
                send_feedback: 'ফিডব্যাক / বাগ রিপোর্ট পাঠান',
                view_translated: 'অনূদিত দেখুন',
                view_original: 'মূল ফাইল দেখুন',
                analyze_trends: 'ট্রেন্ড অ্যানালাইসিস করুন',
                downloading: 'ডাউনলোড হচ্ছে...',
                translating: 'অনুবাদ হচ্ছে...',
                embedding: 'এম্বেড হচ্ছে...',
                analyzing: 'বিশ্লেষণ করা হচ্ছে...',
                processing: 'প্রসেসিং হচ্ছে...',
                process: 'প্রসেস',
                files: 'ফাইল',
                prompts: 'প্রম্পট',
                complete: 'সম্পন্ন',
                success: 'সফল',
                fail: 'ব্যর্থ',
                saving: 'সেভ হচ্ছে...',
                preparing: 'প্রস্তুত করা হচ্ছে...',
                uploading: 'আপলোড হচ্ছে...',
                initializing: 'কানেকশন শুরু হচ্ছে...',
                "hero_title": "ফ্রি এআই মেটাডেটা জেনারেটর এবং স্টক ফটো কিওয়ার্ড!",
                hero_tagline: 'Shutterstock, Adobe Stock, এবং Magnific-এ আপনার দৃশ্যমানতা বৃদ্ধি করুন। উন্নত AI ব্যবহার করে কয়েক সেকেন্ডের মধ্যে SEO-অপ্টিমাইজ করা শিরোনাম, বিবরণ এবং কীওয়ার্ড তৈরি করুন।',
                why_choose: 'কেন মেটাজেন প্রো বেছে নেবেন?',
                blog_1: 'অতি দ্রুত ব্যাচ প্রক্রিয়াকরণ',
                blog_tag_1: 'কয়েক সেকেন্ডের মধ্যে শত শত ছবি বিশ্লেষণ এবং কীওয়ার্ড করুন। আমাদের অপ্টিমাইজড ব্যাচ ইঞ্জিনের সাহায্যে ঘন্টার পর ঘন্টা ম্যানুয়াল কাজের সাশ্রয় করুন।',
                blog_2: 'উন্নত এআই বিশ্লেষণ',
                blog_tag_2: 'শিল্প-সেরা চিত্র শনাক্তকরণ এবং নির্ভুল মেটাডেটার জন্য উন্নত এআই মডেল দ্বারা চালিত।',
                blog_3: 'SEO অপ্টিমাইজড কীওয়ার্ড',
                blog_tag_3: 'Shutterstock, Adobe Stock এবং Magnific অ্যালগরিদমের জন্য বিশেষভাবে তৈরি উচ্চ-র্যাঙ্কিং শিরোনাম এবং ট্যাগ তৈরি করুন।',
                blog_4: 'নিশ রিসার্চ',
                blog_tag_4: 'আমাদের অন্তর্নির্মিত Niche Research টুলের সাহায্যে কম-প্রতিযোগিতামূলক, উচ্চ-চাহিদাসম্পন্ন বিষয়গুলি আবিষ্কার করুন। ক্রেতারা কী খুঁজছেন তা খুঁজে বের করুন।',
                blog_5: 'কীওয়ার্ড পুনর্বিন্যাস টেনে আনুন এবং ছেড়ে দিন',
                blog_tag_5: 'স্টক সাইটগুলিতে (অ্যাডোব স্টক, শাটারস্টক) প্রথম ৫-১০টি কীওয়ার্ড সবচেয়ে গুরুত্বপূর্ণ।',
                blog_6: 'মেটাডেটা এম্বেডিং',
                blog_tag_6: 'আপনার JPG/PNG/SVG ফাইলে (IPTC/XMP) সরাসরি শিরোনাম এবং কীওয়ার্ড এম্বেড করুন। কেবল ডাউনলোড করে যেকোনো স্টক এজেন্সিতে আপলোড করুন।',
                blog_7: 'বহু-ভাষা',
                blog_tag_7: 'আপনার মেটাডেটা তাৎক্ষণিকভাবে ১০+ ভাষায় অনুবাদ করুন। স্থানীয় শিরোনাম এবং বর্ণনার মাধ্যমে বিশ্বব্যাপী দর্শকদের কাছে পৌঁছান।',
                blog_8: 'কপিরাইট চেক',
                blog_tag_8: 'প্রত্যাখ্যান এড়িয়ে চলুন! আমাদের AI আপনার ছবি আপলোড করার আগে সম্ভাব্য ট্রেডমার্ক সমস্যা এবং লোগো স্ক্যান করে।',
                blog_9: 'মেটাডেটা CSV রপ্তানি করুন',
                blog_tag_9: 'সকল স্টক সাইটের অ্যাডোবি স্টক, শাটারস্টক, ফ্রিপিক সিএসভি ফাইল এক্সপোর্ট সুবিধা।',
                trusted_all: 'সকল প্রধান মাইক্রোস্টক প্ল্যাটফর্মের জন্য বিশ্বস্ত',
                it_works: 'কিভাবে এটা কাজ করে',
                upload_photos: 'ছবি আপলোড করুন',
                upload_photos_tag: 'আপনার JPG/PNG ফাইলগুলি টেনে আনুন এবং ছেড়ে দিন। আমরা স্বয়ংক্রিয়ভাবে মাত্রা এবং প্রযুক্তিগত বৈশিষ্ট্যগুলি পড়ি।',
                select_platfrom: 'প্ল্যাটফর্ম এবং এআই নির্বাচন করুন',
                select_platfrom_tag: 'আপনার লক্ষ্য বাজার (যেমন অ্যাডোবি স্টক) এবং পছন্দের এআই মডেল (জেমিনি/গ্রোক) বেছে নিন।',
                gen_down: 'তৈরি করুন এবং ডাউনলোড করুন',
                gen_down_tag: 'SEO-প্রস্তুত শিরোনাম এবং কীওয়ার্ডগুলি তাৎক্ষণিকভাবে পান। CSV ডাউনলোড করুন অথবা সরাসরি এম্বেড করুন।',
                processing_files: 'ফাইল প্রসেসিং...',
                why_choose_stock_title: 'স্টক ফটোগ্রাফির জন্য MetaGen Pro কেন বেছে নেবেন?',
                how_to_use_title: 'টুল কিভাবে ব্যবহার করবেন?',
                master_stock_title: 'AI-চালিত মেটাডেটা দিয়ে আপনার স্টক ফটোগ্রাফি দক্ষতা বাড়ান',
                trusted_stock_title: 'সারা মার্কিন যুক্তরাষ্ট্র জুড়ে স্টক অবদানকারীদের দ্বারা বিশ্বস্ত',
                why_choose_stock_p1: 'স্টক ফটোগ্রাফির প্রতিযোগিতামূলক বিশ্বে, দৃশ্যমানতাই মূল। ক্রেতারা খুঁজে না পেলে সেরা ছবিও বিক্রি হবে না। <strong>MetaGen Pro</strong> হল এই সমস্যা সমাধানের জন্য তৈরি চূড়ান্ত <em>AI Metadata Generator</em>।',
                why_choose_stock_p2: 'ম্যানুয়াল কিওয়ার্ডিংয়ের বিপরীতে যা ক্লান্তিকর এবং ভুলের প্রবণতা থাকে, আমাদের টুল আপনার ছবির বিষয়বস্তু, মেজাজ, আলো এবং গঠন বিশ্লেষণ করতে অত্যাধুনিক কম্পিউটার ভিশন ব্যবহার করে। এটি তারপরে <strong>Shutterstock, Adobe Stock, Magnific এবং Vecteezy</strong>-এর মতো প্ল্যাটফর্মগুলোর জন্য ৫০টিরও বেশি অপ্টিমাইজড কিওয়ার্ড, আকর্ষণীয় শিরোনাম এবং বিস্তারিত বিবরণ তৈরি করে।',
                why_choose_stock_p3: 'আপনি একজন ফটোগ্রাফার, ইলাস্ট্রেটর বা এআই আর্টিস্ট যাই হোন না কেন, MetaGen Pro আপনার কর্মপ্রবাহকে সহজতর করে। <strong>Image-to-Prompt</strong>-এর মতো ফিচারগুলি আপনাকে সফল এআই ছবিগুলো রিভার্স-ইঞ্জিনিয়ার করতে সাহায্য করে, আর আমাদের <strong>Rejection Predictor</strong> আপলোড করার আগেই প্রযুক্তিগত সমস্যাগুলি সমাধান করতে সাহায্য করে।',
                why_choose_stock_p4: 'আজই উপলব্ধ সবচেয়ে উন্নত, বিনামূল্যের স্টক ফটো ট্যাগারের মাধ্যমে আপনার প্যাসিভ আয় বাড়াতে শুরু করুন।',
                "plan_details_title": "কোন প্ল্যানটি আপনার জন্য উপযুক্ত?",
                "plan_details_free": "ফ্রি প্ল্যান - নতুনদের জন্য সেরা",
                "plan_details_free_p1": "আমাদের ফ্রি প্ল্যানটি শখ করে কাজ করা এবং নতুন স্টক কন্ট্রিবিউটরদের জন্য ডিজাইন করা হয়েছে। এটি আপনাকে প্রতিদিন <strong>১০টি ছবি</strong> পর্যন্ত প্রসেস করার সুবিধা দেয়। পরিষেবাটি সম্পূর্ণ বিনামূল্যে রাখার জন্য, আপনি আমাদের মূল ফিচারগুলো ব্যবহার করতে পারবেন যার মধ্যে রয়েছে সুপার-ফাস্ট ব্যাচ প্রসেসিং (একসাথে ১০টি ফাইল), এআই মেটাডেটা জেনারেশন এবং CSV এক্সপোর্ট। উল্লেখ্য যে, মেটাডেটা অটো-এম্বেড, এক্সেল এক্সপোর্ট এবং কপিরাইট চেকের মতো উন্নত ফিচারগুলো এই প্ল্যানে অন্তর্ভুক্ত নয়।",
                "plan_details_pro": "প্রো প্ল্যান - পেশাদারদের জন্য",
                "plan_details_pro_p1": "প্রো প্ল্যানটি নিয়মিত কন্ট্রিবিউটরদের জন্য তৈরি করা হয়েছে যারা তাদের কাজের গতি বাড়াতে এবং অনেক সময় বাঁচাতে চান। প্রতিদিন <strong>৭০টি ছবি</strong> প্রসেস করার বিশাল সুবিধার সাথে, আপনাকে আর নিজের এপিআই (API) কি ব্যবহার করতে হবে না—আমরা আমাদের এন্ড থেকে সমস্ত এআই রিকোয়েস্ট নিরাপদে পরিচালনা করি। এই প্ল্যানটি আপনার জেপিইজি/পিএনজি/এসভিজি (JPEG/PNG/SVG) ফাইলে সরাসরি <strong>মেটাডেটা অটো-এম্বেড</strong>, ড্র্যাগ অ্যান্ড ড্রপ কিওয়ার্ড রিঅর্ডারিং, এআই কপিরাইট/ট্রেডমার্ক চেকিং এবং এক্সেল এক্সপোর্টের মতো শক্তিশালী টুলগুলো আনলক করে। এটি আপনার ব্যাচ প্রসেসিং লিমিট একসাথে ১০০টি ফাইলে বৃদ্ধি করে এবং একটি সম্পূর্ণ বিজ্ঞাপনমুক্ত অভিজ্ঞতা প্রদান করে।",
                "plan_details_premium": "প্রিমিয়াম প্ল্যান - পাওয়ার ইউজার ও এজেন্সিদের জন্য",
                "plan_details_premium_p1": "হাই-ভলিউম ক্রিয়েটর, ভেক্টর আর্টিস্ট এবং এজেন্সিদের জন্য ডিজাইন করা প্রিমিয়াম প্ল্যানে প্রতিদিন <strong>১০০টি ছবি</strong> প্রসেস করার এবং একসাথে ৩০০টি ফাইলের ব্যাচ লিমিট রয়েছে। এতে প্রো প্ল্যানের সবকিছু, প্লাস উন্নত অটোমেশন ফিচার অন্তর্ভুক্ত রয়েছে। আপনি <strong>সরাসরি ভেক্টর/ইপিএস (Vector/EPS) কনভার্সন</strong> (কোনো থার্ড পার্টি ConvertAPI কি-এর প্রয়োজন নেই) এবং <strong>FTP/SFTP অটো আপলোড</strong> ফিচারের এক্সক্লুসিভ অ্যাক্সেস পাবেন। এটি আপনাকে আপনার প্রসেস করা ফাইল এবং মেটাডেটা সরাসরি একাধিক স্টক এজেন্সিতে (Shutterstock, Adobe Stock, Magnific, ইত্যাদি) ব্রাউজার থেকেই স্বয়ংক্রিয়ভাবে বিতরণ করার সুবিধা দেয়।",
                "htu_step1_title": "১. ফাইল আপলোড করুন",
                "htu_step1_desc": "শুরু করতে ছবি (JPG/PNG), ভেক্টর (SVG/EPS), বা ভিডিও ড্র্যাগ অ্যান্ড ড্রপ করুন।",
                "htu_step2_title": "২. টার্গেট প্ল্যাটফর্ম",
                "htu_step2_desc": "অপ্টিমাইজ করা ফলাফলের জন্য Shutterstock, Adobe Stock, বা Magnific নির্বাচন করুন।",
                "htu_step3_title": "৩. এআই মডেল নির্বাচন",
                "htu_step3_desc": "ইমেজ অ্যানালাইসিসের জন্য Gemini, Mistral, বা Groq-এর মধ্যে বেছে নিন।",
                "htu_step4_title": "৪. কাস্টমাইজেশন",
                "htu_step4_desc": "স্লাইডার ব্যবহার করে টাইটেল এবং কিওয়ার্ডের জন্য সর্বনিম্ন/সর্বোচ্চ শব্দ সেট করুন।",
                "htu_step5_title": "৫. এআই সেটিংস",
                "htu_step5_desc": "ভেক্টর মোড, হোয়াইট বিজি (সাদা ব্যাকগ্রাউন্ড) চালু করুন বা আপনার নিজস্ব কাস্টম প্রম্পট ব্যবহার করুন।",
                "htu_step6_title": "৬. মেটাডেটা জেনারেট করুন",
                "htu_step6_desc": "এসইও-রেডি টাইটেল এবং ট্যাগ সাথে সাথে পেতে 'Process Selected'-এ ক্লিক করুন।",
                "htu_step7_title": "৭. মেটাডেটা এম্বেড করুন",
                "htu_step7_desc": "সরাসরি আপনার JPG, PNG বা SVG ফাইলে মেটাডেটা সেভ করুন।",
                "htu_step8_title": "৮. মাল্টি-ট্রান্সলেট",
                "htu_step8_desc": "গ্লোবাল মার্কেটের জন্য মেটাডেটা ১০+ এর বেশি ভাষায় অনুবাদ করুন।",
                "htu_step9_title": "৯. ফলাফল এক্সপোর্ট করুন",
                "htu_step9_desc": "আপনার সমস্ত মেটাডেটা CSV বা প্রফেশনাল এক্সেল শিট হিসেবে ডাউনলোড করুন।",
                "htu_step10_title": "১০. সেভ এবং ড্রাইভ",
                "htu_step10_desc": "লোকাল ফোল্ডারে সেভ করুন, লিঙ্কের মাধ্যমে শেয়ার করুন, অথবা সরাসরি ড্রাইভে আপলোড করুন।",
                master_stock_subtitle1: 'MetaGen Pro কীভাবে ব্যবহার করবেন',
                master_stock_p1: 'MetaGen Pro দিয়ে শুরু করা অবিশ্বাস্যভাবে সহজ এবং কোনও প্রযুক্তিগত দক্ষতার প্রয়োজন নেই। প্রথমে, নির্ধারিত আপলোড এলাকায় ড্র্যাগ এবং ড্রপ করে আপনার ছবি আপলোড করুন, বা ফাইল ব্রাউজ করতে ক্লিক করুন। MetaGen Pro JPG, PNG, SVG এবং EPS সহ সমস্ত প্রধান ইমেজ ফরম্যাট এবং ভিডিও ফাইল সমর্থন করে।',
                master_stock_p2: 'এরপর, সাইডবার সেটিংস ব্যবহার করে আপনার পছন্দগুলি কনফিগার করুন। আপনি কীওয়ার্ডের সংখ্যা সামঞ্জস্য করতে পারেন (আমরা সেরা এসইও-এর জন্য ৩৫-৫০টি সুপারিশ করি), শিরোনামের দৈর্ঘ্যের সীমাবদ্ধতা সেট করতে পারেন।',
                master_stock_p3: 'কনফিগারেশনের পরে, সমস্ত আপলোড করা ছবির জন্য একযোগে মেটাডেটা তৈরি করতে "Process All" বোতামে ক্লিক করুন। আমাদের উন্নত এআই প্রতিটি ছবির ভিজ্যুয়াল কন্টেন্ট বিশ্লেষণ করে।',
                master_stock_subtitle2: 'এই টুল ব্যবহারের সুবিধা',
                master_stock_benefit1: '<strong>সময়ের দক্ষতা:</strong> ম্যানুয়াল কিওয়ার্ডিংয়ে প্রতি ছবিতে ১০-১৫ মিনিট সময় লাগতে পারে। MetaGen Pro এটি কয়েক সেকেন্ডে কমিয়ে আনে।',
                master_stock_benefit2: '<strong>SEO অপ্টিমাইজেশন:</strong> আমাদের এআই কেবল যা দেখে তা বর্ণনা করে না—এটি সার্চ ইনটেন্ট এবং মার্কেটপ্লেস অ্যালগরিদম বোঝে।',
                master_stock_benefit3: '<strong>মাল্টি-প্ল্যাটফর্ম সমর্থন:</strong> বিভিন্ন স্টক এজেন্সির বিভিন্ন প্রয়োজনীয়তা থাকে। MetaGen Pro প্রতিটি প্ল্যাটফর্মের অনন্য অ্যালগরিদমের সাথে খাপ খাইয়ে নেয়।',
                master_stock_benefit4: '<strong>ধারাবাহিকতা এবং গুণমান:</strong> মানবিক ত্রুটি দূর করুন এবং আপনার পুরো পোর্টফোলিও জুড়ে পেশাদার মান বজায় রাখুন।',
                master_stock_subtitle3: 'ইমেজ এসইও কী এবং কেন এটি গুরুত্বপূর্ণ',
                master_stock_seo_p1: 'ইমেজ এসইও (সার্চ ইঞ্জিন অপ্টিমাইজেশন) হল স্টক ফটোগ্রাফি প্ল্যাটফর্ম এবং সার্চ ইঞ্জিনগুলিতে দৃশ্যমানতা উন্নত করার জন্য ইমেজ মেটাডেটা অপ্টিমাইজ করার অনুশীলন।',
                master_stock_seo_p2: '<strong>ইমেজ এসইও-এর তিনটি স্তম্ভ:</strong> প্রথমত, <em>শিরোনাম</em> বর্ণনামূলক কিন্তু সংক্ষিপ্ত হওয়া উচিত। দ্বিতীয়ত, <em>বিবরণ</em> প্রসঙ্গ প্রদান করে। তৃতীয়ত, <em>কীওয়ার্ড</em> একটি বিস্তৃত জাল তৈরি করে।',
                master_stock_seo_p3: '<strong>কীওয়ার্ড কৌশল গুরুত্বপূর্ণ:</strong> সবচেয়ে কার্যকর মেটাডেটা একটি সুষম মিশ্রণ ব্যবহার করে: ২০-৩০% একক শব্দের কিওয়ার্ড, ৪০-৫০% দুই শব্দের বাক্যাংশ এবং ২০-৩০% লং-টেইল কিওয়ার্ড।',
                master_stock_seo_p4: '<strong>সার্চ র‍্যাঙ্কিং ফ্যাক্টর:</strong> স্টক প্ল্যাটফর্মগুলি সার্চ রেজাল্ট র‍্যাঙ্ক করার সময় একাধিক বিষয় বিবেচনা করে। প্রাসঙ্গিকতা, সম্পূর্ণতা এবং কীওয়ার্ড বৈচিত্র্য সবই আপনার র‍্যাঙ্কিংকে প্রভাবিত করে।',
                master_stock_seo_p5: 'MetaGen Pro এই সমস্ত সেরা অনুশীলনগুলিকে স্বয়ংক্রিয় করে, নিশ্চিত করে যে আপনার আপলোড করা প্রতিটি ছবি সর্বাধিক দৃশ্যমানতা এবং আয়ের জন্য সম্পূর্ণরূপে অপ্টিমাইজ করা হয়েছে।',
                master_stock_cta: '<strong>আপনার স্টক ফটোগ্রাফি সাফল্য বাড়াতে প্রস্তুত?</strong> আজই MetaGen Pro ব্যবহার শুরু করুন।',
                trusted_stock_subtitle: 'দেখুন কেন হাজার হাজার আমেরিকান ফটোগ্রাফার এবং নির্মাতা তাদের স্টক আয় বাড়াতে MetaGen Pro-এর উপর নির্ভর করেন',
                review_1_details: '📍 নিউ ইয়র্ক, এনওয়াই • পেশাদার ফটোগ্রাফার',
                review_1_text: '"MetaGen Pro আমার কর্মপ্রবাহ পুরোপুরি বদলে দিয়েছে! আমি আগে শাটারস্টকের জন্য আমার ছবি কিওয়ার্ডিং করতে ঘন্টার পর ঘন্টা ব্যয় করতাম। এখন এটি মাত্র কয়েক মিনিট সময় নেয় এবং আমার ডাউনলোড ৪০% বেড়েছে!"',
                review_2_details: '📍 লস এঞ্জেলেস, সিএ • কন্টেন্ট ক্রিয়েটর',
                review_2_text: '"একজন পূর্ণকালীন কন্টেন্ট ক্রিয়েটর হিসেবে, সময়ই টাকা। এই টুলটি আমাকে মেটাডেটা এন্ট্রিতে সপ্তাহে অন্তত ১০ ঘন্টা বাঁচায়।"',
                review_3_details: '📍 মিয়ামি, এফএল • স্টক কন্ট্রিবিউটর',
                review_3_text: '"আমি প্রথমে সন্দেহবাদী ছিলাম, কিন্তু MetaGen Pro সমস্ত প্রত্যাশা ছাড়িয়ে গেছে। কিওয়ার্ড পরামর্শগুলি অবিশ্বাস্যভাবে প্রাসঙ্গিক।"',
                review_4_details: '📍 শিকাগো, আইএল • গ্রাফিক ডিজাইনার',
                review_4_text: '"কপিরাইট চেক ফিচারটি একাই এর মূল্যের সমান! এটি আমাকে একাধিকবার সম্ভাব্য প্রত্যাখ্যান থেকে বাঁচিয়েছে।"',
                review_5_details: '📍 সিয়াটেল, ডাব্লুএ • নেচার ফটোগ্রাফার',
                review_5_text: '"আমি প্রতি মাসে শত শত প্রকৃতির ছবি আপলোড করি। MetaGen Pro সেগুলোর সবকটি পরিচালনা এবং অপ্টিমাইজ করা অনায়াস করে তোলে।"',
                review_6_details: '📍 অস্টিন, টিএক্স • ফ্রিল্যান্স ভিডিওগ্রাফার',
                review_6_text: '"ভিডিও মেটাডেটার জন্য গেম-চেঞ্জার! এআই নিখুঁতভাবে দৃশ্য শনাক্ত করে এবং নিখুঁত শিরোনাম তৈরি করে।"',
                stat_users: 'সক্রিয় ইউএস ব্যবহারকারী',
                stat_satisfaction: 'সন্তুষ্টির হার',
                stat_images: 'দৈনিক অপ্টিমাইজ করা ছবি',
                stat_rating: 'গড় রেটিং',
                "faq_title": "প্রশ্নাবলী — মেটাজেন প্রো",
                "faq_q1": "🚀 মেটাজেন প্রো কিভাবে শুরু করব?",
                "faq_a1": "<strong>ধাপ ১:</strong> আপনার গুগল অ্যাকাউন্ট বা ইমেল দিয়ে সাইন আপ বা লগইন করুন।<br><strong>ধাপ ২:</strong> আপনার ছবি (JPG, PNG, SVG, EPS) আপলোড করুন - একসাথে ৫০০টি পর্যন্ত!<br><strong>ধাপ ৩:</strong> আপনার টার্গেট প্ল্যাটফর্ম (Shutterstock, Adobe Stock ইত্যাদি) সিলেক্ট করুন এবং 'Generate Metadata' ক্লিক করুন।<br><strong>ধাপ ৪:</strong> রিভিউ করুন, প্রয়োজনে এডিট করুন এবং ফাইলে মেটাডেটা এম্বেড করে ডাউনলোড করুন!",
                "faq_q2": "💰 মেটাজেন প্রো কি ফ্রি? এর প্রাইসিং কেমন?",
                "faq_a2": "<p><strong>ফ্রি প্ল্যান সবার জন্য!</strong> মেটাজেন প্রো-তে একটি শক্তিশালী ফ্রি প্ল্যান রয়েছে (১২০টি ছবি/মাস, দৈনিক সর্বোচ্চ ২৫টি)। তবে ভারী ব্যবহারের জন্য আমাদের <strong>Pro</strong> ($12/মাস - ২০০০টি ছবি/মাস, দৈনিক সর্বোচ্চ ৭০টি) এবং <strong>Premium</strong> ($29/মাস - ৩০০০টি ছবি/মাস, দৈনিক সর্বোচ্চ ১০০টি) প্ল্যান রয়েছে। পেইড প্ল্যানগুলোতে মেটাডেটা অটো-এম্বেড, এক্সেল এক্সপোর্ট এবং সরাসরি FTP আপলোডের মতো উন্নত ফিচারগুলো পাওয়া যায়।</p>",
                "faq_q3": "🔑 মেটাজেন প্রো ব্যবহার করতে কি কোনো API কী লাগবে?",
                "faq_a3": "<p><strong>না, এখন কোনো প্ল্যানেই কোনো API কী-এর প্রয়োজন নেই!</strong> Free, Pro, এবং Premium সব প্ল্যানেই আমরা আমাদের নিজস্ব সার্ভার ও Supabase Edge Functions ডেডিকেটেড এআই মডেল (উন্নত AI মডেল) দিয়ে মেটাডেটা প্রসেস করে থাকি।</p><p><strong>নিরাপত্তা:</strong> আপনার সব ডাটা সম্পূর্ণ <strong>নিরাপদ</strong> এবং প্রসেসিং শেষে সাথে সাথে সার্ভার থেকে মুছে ফেলা হয়।</p>",
                "faq_q4": "📁 কোন কোন ফাইল ফরম্যাট সাপোর্ট করে?",
                "faq_a4": "<p><strong>সাপোর্টেড ফরম্যাট:</strong></p><ul><li><strong>JPG/JPEG:</strong> EXIF এম্বেডিং সহ ফুল সাপোর্ট</li><li><strong>PNG:</strong> মেটাডেটা এম্বেডিং সহ ফুল সাপোর্ট</li><li><strong>SVG:</strong> XMP মেটাডেটা এম্বেডিং সহ ফুল সাপোর্ট</li><li><strong>EPS:</strong> কনভার্ট হয়ে প্রসেস হয় (ConvertAPI কী প্রয়োজন)</li></ul><p>একসাথে <strong>৫০০টি পর্যন্ত ফাইল</strong> আপলোড করা যায়!</p>",
                "faq_q5": "🎯 কোন কোন প্ল্যাটফর্ম সাপোর্ট করে?",
                "faq_a5": "<p>Shutterstock, Adobe Stock, Magnific, Vecteezy, Pond5, 123RF সহ সকল প্রধান প্ল্যাটফর্মের জন্য অপ্টিমাইজড। আমাদের এআই প্রতিটি প্ল্যাটফর্মের নিয়ম অনুযায়ী মেটাডেটা তৈরি করে!</p>",
                "faq_q6": "📊 SEO স্কোর এবং কিওয়ার্ড ব্যাজ কি?",
                "faq_a6": "<p><strong>SEO স্কোর:</strong> আপনার মেটাডেটা সার্চ অ্যালগরিদমের জন্য কতটা উপযোগী তা পরিমাপ করে।</p><p><strong>ব্যাজসমূহ:</strong></p><ul><li>🟢 <strong>সবুজ:</strong> এক শব্দের কিওয়ার্ড (বেশি সার্চ হয়)</li><li>🟡 <strong>হলুদ:</strong> দুই শব্দের কিওয়ার্ড (সেরা ব্যালেন্স)</li><li>🔵 <strong>নীল:</strong> ৩+ শব্দের কিওয়ার্ড (নির্দিষ্ট টার্গেট)</li></ul>",
                "faq_q7": "⚡ ব্যাচ প্রসেসিং কিভাবে কাজ করে?",
                "faq_a7": "<p>৫০০টি ছবি আপলোড করে 'Process Selected' ক্লিক করুন। আমাদের এআই সব ছবি একসাথে প্রসেস করবে। এটি খুবই দ্রুত—১০০টি ছবি প্রসেস করতে ১টি ছবির সমান সময়ই লাগে!</p>",
                "faq_q8": "🎨 'Image to Prompt' ফিচারটি কি?",
                "faq_a8": "<p>এটি আপনার ছবিকে বিস্তারিত প্রম্পটে রূপান্তর করে যা Midjourney বা DALL-E-তে ব্যবহার করা যায়। সফল স্টক ছবির গঠন বোঝার জন্য এটি দারুণ!</p>",
                "faq_q9": "🔒 আমার ডাটা কি নিরাপদ? আপনারা কি ছবি সেভ করেন?",
                "faq_a9": "<p><strong>১০০% প্রাইভেট!</strong> সব প্রসেসিং আপনার ব্রাউজারে হয়। আমরা কখনোই আপনার ছবি সেভ করি না। প্রসেস শেষ হওয়ার সাথে সাথে ডাটা মুছে ফেলা হয়।</p>",
                "faq_q10": "🔧 সাধারণ সমস্যা ও সমাধান",
                "faq_a10": "<ul><li><strong>Server Error:</strong> ইন্টারনেট সংযোগ চেক করুন এবং পেজ রিফ্রেশ করুন।</li><li><strong>ফাইল বেশি বড়:</strong> ২০ মেগাবাইটের নিচে রাখার চেষ্টা করুন।</li><li><strong>ধীর গতি:</strong> ব্রাউজারের অন্যান্য ট্যাব বন্ধ রাখুন।</li></ul>",
                "faq_q11": "🎭 এআই ইমেজ জেনারেটর কিভাবে কাজ করে?",
                "faq_a11": "<p>সরাসরি ছবি তৈরি করতে FLUX মডেল ব্যবহার করুন। প্রম্পট লিখুন এবং আপনার স্টক পোর্টফোলিও-র জন্য ইউনিক ছবি তৈরি করুন!</p>",
                "faq_q12": "💬 সাহায্য বা ফিডব্যাকের জন্য কি করব?",
                "faq_a12": "<p>আমাদের ইমেল করুন: <strong>metagenp@gmail.com</strong> অথবা অ্যাপের ফিডব্যাক বাটন ব্যবহার করুন। আমরা ১২ ঘণ্টার মধ্যে উত্তর দেওয়ার চেষ্টা করি!</p>"
            },


            hi: {
                flag: '🇮🇳',
                name: 'HI',
                band: 'मेटाजेन प्रो',
                tagline: 'मेटाडेटा, एआई द्वारा संचालित',
                home: 'होम',
                features: 'विशेषताएं',
                start_tour: 'टूर शुरू करें',
                faq: 'सामान्य प्रश्न',
                menu: 'मेन्यू',
                blog: 'ब्लॉग',
                disclaimer: 'अस्वीकरण',
                about: 'हमारे बारे में',
                contact: 'संपर्क करें',
                legal: 'कानूनी',
                select_lang: 'भाषा चुने',
                general_btn: "सामान्य",
                save_key: 'की सेव करें',
                close: 'बंद करें',
                get_key: 'की प्राप्त करें',
                trial_credits: 'ट्रायल क्रेडिट',
                trial_footer: 'पहले 10 इमेज हमारी ओर से फ्री हैं! असीमित उपयोग के लिए अपना API Key जोड़ें।',
                badge: 'बैज',
                try_metagen: 'MetaGen फ्री आज़माएं',
                no_api: 'आपके निःशुल्क परीक्षण के लिए किसी API कुंजी की आवश्यकता नहीं है।',
                ref: 'डबल लिमिट अनलॉक करें!',
                ref_text: 'Metagen Pro. शेयर करें। जब कोई आपके रेफरल लिंक पर क्लिक करके जुड़ता है, तो आपकी दैनिक प्रोसेसिंग लिमिट 50 से बढ़कर 100 हो जाएगी!',
                ref_share_btn: 'अभी शेयर करें',
                watting_for: 'आप किस का इंतजार कर रहे हैं?',
                "get_start": "मुफ़्त में शुरुआत करें",
                "drag_and_drop": "अपलोड करने के लिए कहीं भी खींचें और छोड़ें",
                "fast": "तेज़",
                "best": "सर्वश्रेष्ठ",
                "generate_meta": "मेटाडेटा जनरेट करें",
                "delete_select": "चयनित हटाएं",
                "down_select": "चयनित डाउनलोड करें",
                "translate_select": "चयनित अनुवाद करें",
                "done": "संपन्न",
                "processing": "प्रोसेसिंग",
                "analyzing_market": "बाज़ार के रुझानों का विश्लेषण किया जा रहा है...",
                "ai_is_researching": "AI आपके लिए उच्च-प्रदर्शन वाले कॉन्सेप्ट खोज रहा है।",
                "analyzing": "विश्लेषण किया जा रहा है...",
                "copy_tag": "टैग कॉपी करें",
                "copy_idea": "विचार और जानकारी कॉपी करें",
                "download": "डाउनलोड",
                "enter_your_convert_api": "EPS फ़ाइल रूपांतरण सक्षम करने के लिए अपनी Convert API कुंजी दर्ज करें।",
                "export_csv": "CSV निर्यात करें",
                "export_excel": "Excel निर्यात करें",
                "niche_research_cen": "नीश रिसर्च सेंटर",
                "niche_research_tag": "अपने स्टॉक पोर्टफोलियो के लिए उच्च-मांग और कम-प्रतिस्पर्धा वाले कीवर्ड और अवधारणाओं की खोज करें।",
                "select_category": "श्रेणी चुनें",
                "market_focus": "बाज़ार फोकस",
                "analyze_trend": "रुझानों का विश्लेषण करें",
                "ready_to_research": "शोध के लिए तैयार",
                "ready_to_research_tag": "ऊपर एक श्रेणी चुनें और लाभदायक नीश खोजने के लिए \"रुझानों का विश्लेषण करें\" पर क्लिक करें।",
                "quick_suggest": "त्वरित सुझाव",
                "label_title": "शीर्षक",
                "label_desc": "विवरण",
                "label_keywords": "कीवर्ड",
                "btn_copy": "कॉपी",
                "btn_add": "जोड़ें",
                "placeholder_add_kw": "कीवर्ड जोड़ें...",
                "seo_score": "SEO स्कोर",
                "rejection": "अस्वीकृति",
                "platform_check": "प्लेटफ़ॉर्म जांच",
                "style": "शैली",
                "mode": "मोड",
                "translate": "अनुवाद",
                "go": "जाएं",
                "min_title": "न्यूनतम शीर्षक शब्द",
                "max_title": "अधिकतम शीर्षक शब्द",
                "min_keywords": "न्यूनतम कीवर्ड",
                "max_keywords": "अधिकतम कीवर्ड",
                "min_desc": "न्यूनतम विवरण शब्द",
                "max_desc": "अधिकतम विवरण शब्द",
                "toggle_silhouette": "सिल्हूट (छाया-चित्र)",
                "toggle_vector": "वेक्टर / चित्रण मोड",
                "toggle_white_bg": "सफेद पृष्ठभूमि",
                "toggle_trans_bg": "पारदर्शी पृष्ठभूमि",
                "toggle_custom_prompt": "कस्टम प्रॉम्प्ट",
                "toggle_prohibited": "निषिद्ध शब्द",
                "toggle_single_kw": "एकल शब्द कीवर्ड",
                "toggle_change_name": "फ़ाइल का नाम बदलें",
                "toggle_name_title": "फ़ाइल का नाम शीर्षक के रूप में",
                "feedback_matters": "आपकी प्रतिक्रिया महत्वपूर्ण है",
                "provide_feedback": "कृपया टूल के बारे में फ़ीडबैक दें?",
                "issue_type": "समस्या का प्रकार",
                "general_feedback": "सामान्य प्रतिक्रिया",
                "bug_report": "बग रिपोर्ट",
                "feature_request": "फ़ीचर अनुरोध",
                "your_mess": "आपका संदेश",
                "send_feed": "फ़ीडबैक भेजें",
                eps_meta: 'ईपीएस मेटाडेटा जनरेट और एम्बेड करें',
                month: '/ महीना',
                pricing: 'मूल्य निर्धारण',
                ftp_upload: 'FTP डायरेक्ट अपलोड',
                ftp_upload_sub_txt: 'स्टॉक साइट्स (Adobe Stock, Shutterstock, Magnific) पर सीधे फाइल अपलोड करें।',
                upgrade_plan: 'प्लान अपग्रेड करें',
                stock_calendar: 'स्टॉक कैलेंडर',
                get_access: 'एक्सेस प्राप्त करें',
                pricing_plan: 'हमारा प्राइसिंग प्लान',
                pricing_sub_txt: 'अपने क्रिएटिव वर्कफ़्लो के लिए एकदम सही प्लान चुनें।',
                free_plan: 'फ्री प्लान',
                free_price: '$0/महीना',
                most_popular: 'सबसे लोकप्रिय',
                pro_plan: 'प्रो में अपग्रेड करें',
                pro_price: '$12/महीना',
                premium_plan: 'प्रीमियम प्लान',
                premium_price: '$29/महीना',
                '50_image': 'प्रति माह 120 छवियां (उचित उपयोग के लिए प्रतिदिन अधिकतम 10)',
                basic_ai_model: 'बेसिक एआई मॉडल (Gemini, Mistral, Groq) अपनी खुद की API कुंजी का उपयोग करें।',
                batch_process: 'बैच प्रोसेस: 50 फ़ाइलों तक',
                csv_export: 'CSV निर्यात',
                ads_support: 'विज्ञापन समर्थित',
                auto_embed: 'मेटाडेटा ऑटो एम्बेड',
                excel_export: 'Excel निर्यात',
                drag_keyword: 'ड्रैग एंड ड्रॉप कीवर्ड रीऑर्डरिंग',
                copy_trade_check: 'कॉपीराइट/ट्रेडमार्क जाँच',
                get_started_free: 'मुफ़्त में शुरू करें',
                '300_images': '2000 चित्र/माह',
                advance_ai: 'उन्नत एआई मॉडल (API कुंजी की आवश्यकता नहीं है।)',
                batch_process_pro: 'बैच प्रोसेस: 100 फ़ाइलों तक',
                csv_excel_ex: 'CSV/Excel निर्यात',
                seo_and_no_ads: 'एसईओ एनालिटिक्स और कोई विज्ञापन नहीं',
                support_time: 'सपोर्ट का समय 24 घंटे',
                '1k_image': '3000 चित्र/माह',
                all_pro: 'सभी प्रो फीचर्स',
                batch_process_pre: 'बैच प्रोसेस: 300 फ़ाइलों तक',
                ftp_auto_up: 'FTP/SFTP ऑटो अपलोड',
                vector_eps: 'डायरेक्ट वेक्टर/EPS रूपांतरण',
                vip_support: 'VIP सपोर्ट और अर्ली एक्सेस',
                privacy_policy: 'गोपनीयता नीति',
                terms_of_service: 'सेवा की शर्तें',
                adjustment: 'समायोजन',
                multi_tool: 'मल्टी इमेज टूल्स',
                sketch_art: 'इमेज से स्केच आर्ट',
                all_tools: 'सभी टूल्स',
                image_enhance: 'एआई इमेज एन्हांसर',
                bg_remove: 'एआई बैकग्राउंड रिमूवर',
                pixel_check: 'पिक्सेल-चेक स्टूडियो',
                text_to_image: 'टेक्स्ट टू इमेज जेनरेटर',
                company: 'कंपनी',
                free_plan: 'फ्री प्लान',
                note: '7 दिनों में API एक्सेस हटा दिया जाएगा। प्रो/प्रीमियम प्लान में अपग्रेड करें और MetaGen Pro की सभी सुविधाओं का लाभ उठाएं।',
                platform: 'प्लेटफ़ॉर्म',
                add_more: 'और फ़ाइल जोड़ें',
                login_google: 'गूगल के साथ जारी रखें',
                new_user: 'नये उपयोगकर्ता?',
                create_account: 'खाता बनाएं',
                niche_research: 'नीश रिसर्च',
                metadata_generator: 'मेटाडेटा जेनरेटर',
                seo_score: 'SEO स्कोर और एनालिटिक्स',
                batch_process: 'सुपर फास्ट बैच प्रोसेस',
                sign_out: 'साइन आउट',
                switch_account: 'खाता बदलें',
                upload_title: 'चित्र या वीडियो अपलोड करें',
                drag_drop: 'फ़ाइलें यहाँ खींचें या अपलोड करने के लिए क्लिक करें',
                supports: 'JPG, PNG, WEBP, MP4, MOV का समर्थन करता है',
                max_size: 'अधिकतम 50MB प्रति फ़ाइल',
                privacy_note: 'आपकी फ़ाइलें सुरक्षित रूप से संसाधित होती हैं और 1 घंटे के बाद हटा दी जाती हैं।',
                privacy_note_device: 'हम केवल डिवाइस पर फ़ाइलों का विश्लेषण करते हैं, डेटा सर्वर पर सेव नहीं होता।',
                upload_limit_info: 'फ्री प्लान: 50 फाइलें/दिन',
                usage: 'उपयोग:',
                "daily_limit": "दैनिक प्रक्रिया सीमा",
                refer_text: 'अतिरिक्त 50 सीमा प्राप्त करने के लिए मेटा-जेन प्रो साझा करें!',
                "share_get_credit": "शेयर करें और प्रोसेस क्रेडिट प्राप्त करें",
                generate_metadata: 'मेटाडेटा जनरेट करें',
                "limit_reached_msg": "आपने अपनी दैनिक प्रोग्रेस लिमिट (Daily Process Limit) पूरी कर ली है! अधिक लिमिट के लिए अपना प्लान अपग्रेड करें या बोनस के लिए टूल शेयर करें।",
                export_csv: 'CSV में निर्यात करें',
                export_excel: 'Excel में निर्यात करें',
                clear_all: 'सभी साफ़ करें',
                copy_all: 'सभी कॉपी करें',
                down_eps: 'डाउनलोड EPS',
                guides: 'गाइड',
                title: 'शीर्षक',
                description: 'विवरण',
                keywords: 'कीवर्ड',
                categories: 'श्रेणियाँ',
                already_user: 'पहले से खाता है?',
                login: 'लॉगिन',
                well_come: 'वापसी पर स्वागत है',
                tools_generator: 'टूल्स और जेनरेटर',
                trending: '📅 ट्रेंडिंग...',
                customization: 'कस्टमाइज़ेशन',
                settings: 'सेटिंग्स',
                select_ai: 'AI प्रोवाइडर चुनें',
                manage_api: 'API कुंजी प्रबंधित करें',
                convert_api: 'ConvertAPI कुंजी',
                translation_lang: 'अनुवाद भाषा',
                upload_files: 'फाइल अपलोड',
                watch_demo: 'डेमो देखें',
                watch_tagline: 'कुछ ही सेकंड में अपने स्टॉक की बिक्री बढ़ाने का तरीका जानें',
                process_selected: 'चयनित प्रोसेस करें',
                process_prompts: 'प्रॉम्प्ट प्रोसेस करें',
                embed_metadata: 'मेटाडेटा एम्बेड करें',
                export: 'निर्यात',
                batch_translate: 'बैच अनुवाद (फ्री)',
                translate_all: 'सभी अनुवाद (Pro)',
                test_metadata: 'मेटाडेटा टेस्ट',
                save_folder: 'फ़ोल्डर में सहेजें',
                share_files: 'फ़ाइलें साझा करें',
                upload_drive: 'ड्राइव पर अपलोड',
                pause: 'रोकें',
                image_to_prompt: 'इमेज से प्रॉम्प्ट',
                jpg_png: 'JPG/PNG',
                svg_eps: 'SVG/EPS/AI',
                videos: 'वीडियो',
                check_copyright: 'कॉपीराइट/ट्रेडमार्क की जाँच करें:',
                upload_limit: 'एक बार में अधिकतम 500 फाइलें अपलोड करें',
                resume: 'फिर से शुरू',
                send_feedback: 'प्रतिक्रिया भेजें / बग रिपोर्ट करें',
                view_translated: 'अनुवादित देखें',
                view_original: 'असली देखें',
                analyze_trends: 'ट्रेंड विश्लेषण',
                downloading: 'डाउनलोड हो रहा है...',
                translating: 'अनुवाद हो रहा है...',
                embedding: 'एम्बेड हो रहा है...',
                analyzing: 'विश्लेषण हो रहा है...',
                processing: 'प्रोसेसिंग...',
                process: 'प्रोसेस',
                files: 'फाइल',
                prompts: 'प्रॉम्प्ट',
                complete: 'पूर्ण',
                success: 'सफल',
                fail: 'विफल',
                saving: 'सहेजा जा रहा है...',
                preparing: 'तैयार हो रहा है...',
                uploading: 'अपलोड हो रहा है...',
                initializing: 'कनेक्शन शुरू हो रहा है...',
                "hero_title": "निःशुल्क AI मेटाडेटा जेनरेटर और स्टॉक फोटो कीवर्ड!",
                hero_tagline: 'Shutterstock, Adobe Stock और Magnific पर अपनी दृश्यता बढ़ाएँ। उन्नत AI का उपयोग करके कुछ ही सेकंड में SEO-अनुकूलित शीर्षक, विवरण और कीवर्ड जेनरेट करें।',
                why_choose: 'MetaGen Pro को क्यों चुनें?',
                blog_1: 'सुपर फास्ट बैच प्रोसेसिंग',
                blog_tag_1: 'सेकंडों में सैकड़ों छवियों का विश्लेषण करें और उनमें कीवर्ड डालें। हमारे अनुकूलित बैच इंजन की मदद से मैन्युअल काम में लगने वाले घंटों की बचत करें।',
                blog_2: 'उन्नत एआई विश्लेषण',
                blog_tag_2: 'उद्योग जगत में अग्रणी छवि पहचान और सटीक मेटाडेटा के लिए उन्नत एआई मॉडल द्वारा संचालित।',
                blog_3: 'एसईओ अनुकूलित कीवर्ड',
                blog_tag_3: 'शटरस्टॉक, एडोब स्टॉक और फ्रीपिक के एल्गोरिदम के लिए विशेष रूप से तैयार किए गए उच्च-रैंकिंग वाले शीर्षक और टैग उत्पन्न करें।',
                blog_4: 'विशिष्ट अनुसंधान',
                blog_tag_4: 'हमारे अंतर्निहित नीश रिसर्च टूल की मदद से कम प्रतिस्पर्धा और उच्च मांग वाले विषयों की खोज करें। जानें कि खरीदार क्या खोज रहे हैं।',
                blog_5: 'कीवर्ड पुनर्व्यवस्थापन के लिए ड्रैग एंड ड्रॉप करें',
                blog_tag_5: 'स्टॉक साइटों (एडोब स्टॉक, शटरस्टॉक) पर पहले 5-10 कीवर्ड सबसे महत्वपूर्ण होते हैं।',
                blog_6: 'मेटाडेटा एम्बेडिंग',
                blog_tag_6: 'अपने JPG/PNG/SVG फ़ाइलों (IPTC/XMP) में सीधे शीर्षक और कीवर्ड एम्बेड करें। बस डाउनलोड करें और किसी भी स्टॉक एजेंसी पर अपलोड करें।',
                blog_7: 'बहु-भाषा',
                blog_tag_7: 'अपने मेटाडेटा को तुरंत 10 से अधिक भाषाओं में अनुवादित करें। स्थानीयकृत शीर्षकों और विवरणों के साथ वैश्विक दर्शकों तक पहुंचें।',
                blog_8: 'कॉपीराइट जाँच',
                blog_tag_8: 'अस्वीकृति से बचें! हमारी एआई आपकी छवियों को अपलोड करने से पहले उनमें संभावित ट्रेडमार्क संबंधी समस्याओं और लोगो की जांच करती है।',
                blog_9: 'मेटाडेटा को CSV फ़ाइल में निर्यात करें',
                blog_tag_9: 'सभी स्टॉक साइटों, जैसे एडोब स्टॉक, शटरस्टॉक और फ्रीपिक, की सीएसवी फाइल एक्सपोर्ट करने की सुविधा।',
                trusted_all: 'सभी प्रमुख माइक्रोस्टॉक प्लेटफॉर्मों के लिए विश्वसनीय',
                it_works: 'यह काम किस प्रकार करता है',
                upload_photos: 'फ़ोटो अपलोड करें',
                upload_photos_tag: 'अपनी JPG/PNG फ़ाइलों को ड्रैग और ड्रॉप करें। हम स्वचालित रूप से आयाम और तकनीकी विनिर्देश पढ़ लेंगे।',
                select_platfrom: 'प्लेटफ़ॉर्म और एआई का चयन करें',
                select_platfrom_tag: 'अपना लक्षित बाजार (जैसे एडोब स्टॉक) और पसंदीदा एआई मॉडल (जेमिनी/ग्रोक) चुनें।',
                gen_down: 'जनरेट करें और डाउनलोड करें',
                gen_down_tag: 'तुरंत SEO-अनुकूल शीर्षक और कीवर्ड प्राप्त करें। CSV फ़ाइल डाउनलोड करें या सीधे एम्बेड करें।',
                processing_files: 'फाइल प्रोसेसिंग...',
                why_choose_stock_title: 'स्टॉक फोटोग्राफी के लिए MetaGen Pro क्यों चुनें?',
                how_to_use_title: 'टूल का उपयोग कैसे करें?',
                master_stock_title: 'AI-संचालित मेटाडेटा के साथ अपनी स्टॉक फोटोग्राफी में महारत हासिल करें',
                trusted_stock_title: 'संयुक्त राज्य अमेरिका भर में स्टॉक योगदानकर्ताओं द्वारा भरोसेमंद',
                why_choose_stock_p1: 'स्टॉक फोटोग्राफी की प्रतिस्पर्धी दुनिया में, खोज योग्यता (discoverability) ही सफलता की कुंजी है। बेहतरीन तस्वीरें भी नहीं बिकेंगी यदि खरीदार उन्हें ढूंढ न सकें। <strong>MetaGen Pro</strong> इस समस्या को हल करने के लिए डिज़ाइन किया गया अंतिम <em>AI मेटाडेटा जेनरेटर</em> है।',
                why_choose_stock_p2: 'मैन्युअल कीवर्डिंग के विपरीत जो थकाऊ और गलतियों से भरी होती है, हमारा टूल आपकी छवि के विषय, मूड, लाइटिंग और कंपोज़िशन का विश्लेषण करने के लिए अत्याधुनिक कंप्यूटर विज़न का उपयोग करता है। इसके बाद यह <strong>Shutterstock, Adobe Stock, Magnific और Vecteezy</strong> जैसे प्लेटफार्मों के लिए तैयार 50+ अनुकूलित कीवर्ड, आकर्षक शीर्षक और विस्तृत विवरण तैयार करता है।',
                why_choose_stock_p3: 'चाहे आप फोटोग्राफर हों, इलस्ट्रेटर हों, या एआई कलाकार हों, MetaGen Pro आपके वर्कफ़्लो को सरल बनाता है। <strong>Image-to-Prompt</strong> जैसी विशेषताएं आपको सफल एआई छवियों को रिवर्स-इंजीनियर करने में मदद करती हैं, जबकि हमारा <strong>Rejection Predictor</strong> आपको अपलोड करने से पहले तकनीकी समस्याओं को ठीक करने में मदद करता है।',
                why_choose_stock_p4: 'उपलब्ध सबसे उन्नत, मुफ्त स्टॉक फोटो टैगर के साथ आज ही अपनी पैसिव इनकम को अधिकतम करना शुरू करें।',
                "plan_details_title": "आपके लिए कौन सा प्लान सही है?",
                "plan_details_free": "फ्री प्लान - शुरुआती लोगों के लिए सर्वश्रेष्ठ",
                "plan_details_free_p1": "हमारा फ्री प्लान शौकिया फोटोग्राफरों और नए स्टॉक योगदानकर्ताओं के लिए बनाया गया है। यह आपको प्रति माह <strong>120 छवियों तक (अधिकतम 10/दिन)</strong> प्रोसेस करने की अनुमति देता है। सेवा को पूरी तरह से फ्री रखने के लिए, आपको हमारी मुख्य सुविधाओं तक पहुंच मिलती है, जिनमें सुपर-फास्ट बैच प्रोसेसिंग (एक साथ 10 फाइलों तक), AI मेटाडेटा जनरेशन और CSV एक्सपोर्ट शामिल हैं। ध्यान दें कि मेटाडेटा ऑटो-एम्बेड, एक्सेल एक्सपोर्ट और कॉपीराइट चेक जैसी उन्नत सुविधाएं इस प्लान में शामिल नहीं हैं।",
                "plan_details_pro": "प्रो प्लान - पेशेवरों के लिए",
                "plan_details_pro_p1": "प्रो प्लान नियमित योगदानकर्ताओं के लिए बनाया गया है जो अपने वर्कफ़्लो को अधिकतम करना चाहते हैं और घंटों समय बचाना चाहते हैं। प्रतिदिन <strong>70 इमेजेज़</strong> की भारी सीमा के साथ, अब आपको अपनी API कीज़ लाने की आवश्यकता नहीं है—हम सभी AI अनुरोधों को सुरक्षित रूप से अपने एंड पर संभालते हैं। यह प्लान आपके JPEG/PNG/SVG फ़ाइलों में सीधे <strong>मेटाडेटा ऑटो-एम्बेड</strong>, ड्रैग एंड ड्रॉप कीवर्ड रीऑर्डरिंग, AI कॉपीराइट/ट्रेडमार्क चेकिंग और एक्सेल एक्सपोर्ट जैसे शक्तिशाली टूल्स अनलॉक करता है। यह आपकी बैच प्रोसेसिंग सीमा को एक साथ 100 फ़ाइलों तक बढ़ाता है और पूरी तरह से विज्ञापन-मुक्त अनुभव प्रदान करता है।",
                "plan_details_premium": "प्रीमियम प्लान - पावर यूजर्स और एजेंसियों के लिए",
                "plan_details_premium_p1": "हाई-वॉल्यूम क्रिएटर्स, वेक्टर कलाकारों और एजेंसियों के लिए डिज़ाइन किया गया, प्रीमियम प्लान प्रतिदिन <strong>100 इमेजेज़</strong> की विशाल सीमा और 300 फ़ाइलों की बैच सीमा प्रदान करता है। इसमें प्रो प्लान की हर चीज़ के साथ उन्नत ऑटोमेशन सुविधाएँ भी शामिल हैं। आपको <strong>डायरेक्ट वेक्टर/EPS रूपांतरण</strong> (किसी थर्ड पार्टी ConvertAPI कीज़ की आवश्यकता नहीं) और <strong>FTP/SFTP ऑटो अपलोड</strong> सुविधा का एक्सक्लूसिव एक्सेस मिलता है। यह आपको अपनी प्रोसेस की गई फ़ाइलों और मेटाडेटा को सीधे अपने ब्राउज़र से कई स्टॉक एजेंसियों (Shutterstock, Adobe Stock, Magnific, आदि) में स्वचालित रूप से वितरित करने की अनुमति देता है।",
                "htu_step1_title": "1. फ़ाइलें अपलोड करें",
                "htu_step1_desc": "शुरू करने के लिए छवियाँ (JPG/PNG), वेक्टर (SVG/EPS), या वीडियो को ड्रैग एंड ड्रॉप करें।",
                "htu_step2_title": "2. टारगेट प्लेटफ़ॉर्म",
                "htu_step2_desc": "बेहतर परिणामों के लिए Shutterstock, Adobe Stock, या Magnific चुनें।",
                "htu_step3_title": "3. AI मॉडल चुनें",
                "htu_step3_desc": "इमेज विश्लेषण के लिए Gemini, Mistral, या Groq के बीच चयन करें।",
                "htu_step4_title": "4. कस्टमाइज़ेशन",
                "htu_step4_desc": "स्लाइडर का उपयोग करके शीर्षक और कीवर्ड के लिए न्यूनतम/अधिकतम शब्द सेट करें।",
                "htu_step5_title": "5. AI सेटिंग्स",
                "htu_step5_desc": "वेक्टर मोड, व्हाइट बैकग्राउंड (White BG) सक्षम करें, या अपने स्वयं के कस्टम प्रॉम्प्ट का उपयोग करें।",
                "htu_step6_title": "6. मेटाडेटा जनरेट करें",
                "htu_step6_desc": "SEO-रेडी शीर्षक और टैग तुरंत प्राप्त करने के लिए 'Process Selected' पर क्लिक करें।",
                "htu_step7_title": "7. मेटाडेटा एम्बेड करें",
                "htu_step7_desc": "मेटाडेटा सीधे अपनी JPG, PNG, या SVG फ़ाइलों में लिखें।",
                "htu_step8_title": "8. मल्टी-ट्रांसलेट",
                "htu_step8_desc": "ग्लोबल मार्केट के लिए मेटाडेटा का 10+ भाषाओं में अनुवाद करें।",
                "htu_step9_title": "9. परिणाम एक्सपोर्ट करें",
                "htu_step9_desc": "अपना सारा मेटाडेटा CSV या पेशेवर एक्सेल शीट के रूप में डाउनलोड करें।",
                "htu_step10_title": "10. सेव और ड्राइव",
                "htu_step10_desc": "स्थानीय फ़ोल्डर में सहेजें, लिंक के माध्यम से साझा करें, या सीधे ड्राइव पर अपलोड करें।",
                master_stock_subtitle1: 'MetaGen Pro का उपयोग कैसे करें',
                master_stock_p1: 'MetaGen Pro के साथ शुरुआत करना अविश्वसनीय रूप से सरल है और इसके लिए किसी तकनीकी विशेषज्ञता की आवश्यकता नहीं है। सबसे पहले, अपनी छवियों को निर्दिष्ट अपलोड क्षेत्र में खींचकर छोड़ें, या अपनी फ़ाइलों को ब्राउज़ करने के लिए क्लिक करें। MetaGen Pro JPG, PNG, SVG और EPS के साथ-साथ वीडियो फ़ाइलों सहित सभी प्रमुख छवि प्रारूपों का समर्थन करता है। एक बार आपकी छवियां अपलोड हो जाने के बाद, उस मार्केटप्लेस के लिए विशेष रूप से मेटाडेटा को अनुकूलित करने के लिए अपना लक्ष्य प्लेटफ़ॉर्म (Shutterstock, Adobe Stock, Magnific, या General) चुनें।',
                master_stock_p2: 'इसके बाद, साइडबार सेटिंग्स का उपयोग करके अपनी प्राथमिकताएं कॉन्फ़िगर करें। आप कीवर्ड की संख्या समायोजित कर सकते हैं (हम इष्टतम एसईओ के लिए 35-50 की सिफारिश करते हैं), शीर्षक लंबाई की सीमाएं निर्धारित कर सकते हैं, और चित्रण के लिए वेक्टर मोड या उत्पाद छवियों के लिए व्हाइट बैकग्राउंड डिटेक्शन जैसी विशेष सुविधाओं को सक्षम कर सकते हैं। AI प्रदाता चयन आपको अपनी API उपलब्धता और गति प्राथमिकताओं के आधार पर Google Gemini, Mistral AI, या Groq Llama मॉडल के बीच चयन करने की अनुमति देता है।',
                master_stock_p3: 'कॉन्फ़िगरेशन के बाद, सभी अपलोड की गई छवियों के लिए एक साथ मेटाडेटा उत्पन्न करने के लिए "Process All" बटन पर क्लिक करें। हमारा उन्नत AI प्रत्येक छवि की दृश्य सामग्री, संरचना, रंग, विषय और संदर्भ का विश्लेषण करके अत्यधिक प्रासंगिक शीर्षक, विवरण और कीवर्ड सेट बनाता है। पूरी प्रक्रिया में आमतौर पर प्रति छवि केवल कुछ सेकंड लगते हैं, यहाँ तक कि बैच मोड में सैकड़ों फ़ाइलों को संसाधित करते समय भी।',
                master_stock_subtitle2: 'इस टूल का उपयोग करने के लाभ',
                master_stock_benefit1: '<strong>समय दक्षता:</strong> मैन्युअल कीवर्डिंग में प्रति छवि 10-15 मिनट लग सकते हैं। MetaGen Pro इसे मात्र कुछ सेकंड तक कम कर देता है, जिससे आप सैकड़ों छवियों को उतने ही समय में कीवर्ड कर सकते हैं जितना कि मैन्युअल रूप से कुछ ही संसाधित करने में लगता है। साप्ताहिक रूप से 50-100 चित्र अपलोड करने वाले पेशेवर योगदानकर्ताओं के लिए, इसका मतलब हर हफ्ते 10+ घंटे बचाना है।',
                master_stock_benefit2: '<strong>SEO अनुकूलन:</strong> हमारा AI केवल वही वर्णन नहीं करता जो वह देखता है—यह खोज उद्देश्य और बाज़ार के एल्गोरिदम को समझता है। प्रत्येक मेटाडेटा सेट में व्यापक कीवर्ड (उच्च खोज मात्रा), विशिष्ट लॉन्ग-टेल कीवर्ड (उच्च रूपांतरण), और ट्रेंडिंग शब्दों (वर्तमान मांग) का रणनीतिक मिश्रण शामिल है। बिल्ट-इन एसईओ स्कोर मीटर वास्तविक समय में आपके मेटाडेटा का मूल्यांकन करता है, यह सुनिश्चित करता है कि प्रत्येक अपलोड अधिकतम दृश्यता के लिए अनुकूलित है।',
                master_stock_benefit3: '<strong>मल्टी-प्लेटफ़ॉर्म सपोर्ट:</strong> अलग-अलग स्टॉक एजेंसियों की अलग-अलग ज़रूरतें और प्राथमिकताएं होती हैं। MetaGen Pro प्रत्येक प्लेटफ़ॉर्म के अद्वितीय एल्गोरिदम के अनुकूल होता है—Shutterstock को Adobe Stock या Magnific की तुलना में अलग कीवर्ड संरचनाएं पसंद हैं। हमारा प्लेटफ़ॉर्म-विशिष्ट अनुकूलन सुनिश्चित करता है कि आपकी छवियां जहाँ भी आप अपलोड करें, वहां अच्छी रैंक करें।',
                master_stock_benefit4: '<strong>स्थिरता और गुणवत्ता:</strong> मानवीय भूल को समाप्त करें और अपने पूरे पोर्टफोलियो में पेशेवर मानक बनाए रखें। MetaGen Pro सुनिश्चित करता है कि प्रत्येक छवि में ठीक से स्वरूपित मेटाडेटा, पर्याप्त कीवर्ड मात्रा और उचित विवरण हो। रिजेक्शन प्रिडिक्टर सुविधा सामान्य अस्वीकृति मानदंडों के खिलाफ आपके मेटाडेटा का विश्लेषण करती है, जिससे आपको महंगी सबमिशन विफलताओं से बचने में मदद मिलती।',
                master_stock_subtitle3: 'इमेज एसईओ क्या है और यह क्यों महत्वपूर्ण है',
                master_stock_seo_p1: 'इमेज एसईओ (सर्च इंजन ऑप्टिमाइजेशन) स्टॉक फोटोग्राफी प्लेटफॉर्म और सर्च इंजन पर दृश्यता में सुधार के लिए इमेज मेटाडेटा को अनुकूलित करने का अभ्यास है। जब कोई खरीदार "बिजनेस मीटिंग" या "ट्रॉपिकल बीच सनसेट" खोजता है, तो प्लेटफॉर्म का एल्गोरिदम आपकी छवि को "देखता" नहीं है—यह आपके द्वारा प्रदान किए गए मेटाडेटा को पढ़ता है। प्रभावी इमेज एसईओ आपके काम के खोज परिणामों के पेज 1 बनाम पेज 50 पर दिखने के बीच का अंतर है।',
                master_stock_seo_p2: '<strong>इमेज एसईओ के तीन स्तंभ:</strong> पहला, <em>Title</em> वर्णनात्मक लेकिन संक्षिप्त (10-20 शब्द) होना चाहिए, जिसमें आपके प्राथमिक कीवर्ड हों और प्राकृतिक और पठनीय बने रहें। दूसरा, <em>Description</em> संदर्भ और उपयोग के मामले (30-50 शब्द) प्रदान करता है, जिससे एल्गोरिदम और खरीदार दोनों को आपकी छवि के व्यावसायिक अनुप्रयोगों को समझने में मदद मिलती है। तीसरा, <em>Keywords</em> एक व्यापक जाल बिछाते हैं (35-50 शब्द अनुशंसित), विभिन्न खोज प्रश्नों को कैप्चर करते हैं जो खरीदारों को आपकी छवि तक ले जा सकते हैं।',
                master_stock_seo_p3: '<strong>कीवर्ड रणनीति मायने रखती है:</strong> सबसे प्रभावी मेटाडेटा एक संतुलित मिश्रण का उपयोग करता है: 20-30% एकल-शब्द कीवर्ड (व्यापक पहुंच), 40-50% दो-शब्द वाक्यांश (मध्यम विशिष्टता), और 20-30% लॉन्ग-टेल कीवर्ड (उच्च रूपांतरण)। उदाहरण के लिए, स्मार्टफोन का उपयोग करने वाले हाथों की एक छवि में "हाथ" (व्यापक), "स्मार्टफोन इंटरैक्शन" (मध्यम), और "मोबाइल ऐप इंटरफ़ेस टैप करने वाले हाथ" (लॉन्ग-टेल) शामिल होने चाहिए। यह रणनीति व्यापक और विशिष्ट दोनों खोजों में आपकी छवि के दिखने की संभावनाओं को अधिकतम करती है।',
                master_stock_seo_p4: '<strong>खोज रैंकिंग कारक:</strong> स्टॉक प्लेटफॉर्म खोज परिणामों की रैंकिंग करते समय कई कारकों पर विचार करते हैं। प्रासंगिकता (आपका मेटाडेटा खोज क्वेरी से कितनी अच्छी तरह मेल खाता है), पूर्णता (सभी मेटाडेटा फ़ील्ड ठीक से भरे हुए हैं), और कीवर्ड विविधता (विभिन्न, संबंधित शब्दों का उपयोग करना) सभी आपकी रैंकिंग को प्रभावित करते हैं। इसके अतिरिक्त, व्यावसायिक प्रासंगिकता—यह वर्णन करना कि खरीदार आपकी छवि का उपयोग कैसे कर सकते हैं—रूपांतरण दरों को महत्वपूर्ण रूप से प्रभावित करती है, भले ही आपकी छवि अच्छी रैंक करती हो।',
                master_stock_seo_p5: 'MetaGen Pro इन सभी सर्वोत्तम प्रथाओं को स्वचालित करता है, यह सुनिश्चित करता है कि आपके द्वारा अपलोड की गई प्रत्येक छवि अधिकतम दृश्यता, डाउनलोड और अंततः आय के लिए पूरी तरह से अनुकूलित है। चाहे आप शौकिया योगदानकर्ता हों या पूर्णकालिक स्टॉक फोटोग्राफर, आज के प्रतिस्पर्धी बाजार में उचित इमेज एसईओ अपरिहार्य है।',
                master_stock_cta: '<strong>अपनी स्टॉक फोटोग्राफी की सफलता को बढ़ावा देने के लिए तैयार हैं?</strong> आज ही MetaGen Pro का उपयोग करना शुरू करें और घंटों की थकाऊ कीवर्डिंग को सेकंडों की स्वचालित उत्कृष्टता में बदलें।',
                trusted_stock_subtitle: 'जानें कि क्यों हजारों अमेरिकी फोटोग्राफर और निर्माता अपने स्टॉक राजस्व को बढ़ाने के लिए MetaGen Pro पर भरोसा करते हैं',
                review_1_details: '📍 न्यूयॉर्क, NY • पेशेवर फोटोग्राफर',
                review_1_text: '"MetaGen Pro ने मेरे वर्कफ़्लो को पूरी तरह से बदल दिया! मैं शटरस्टॉक के लिए अपनी तस्वीरों की कीवर्डिंग में घंटों बिताता था। अब इसमें केवल कुछ मिनट लगते हैं और मेरे डाउनलोड में 40% की वृद्धि हुई है। एसईओ स्कोर सुविधा शानदार है!"',
                review_2_details: '📍 लॉस एंजिल्स, CA • सामग्री निर्माता',
                review_2_text: '"एक पूर्णकालिक सामग्री निर्माता के रूप में, समय ही पैसा है। यह टूल मेटाडेटा प्रविष्टि पर मुझे प्रति सप्ताह कम से कम 10 घंटे बचाता है। बैच प्रोसेसिंग बिजली की तरह तेज़ है और एआई-जनित कीवर्ड एकदम सटीक हैं। इस साल मैंने जो सबसे अच्छा निवेश किया है!"',
                review_3_details: '📍 मियामी, FL • स्टॉक योगदानकर्ता',
                review_3_text: '"मुझे शुरू में संदेह था, लेकिन MetaGen Pro ने सभी उम्मीदों को पार कर लिया। कीवर्ड सुझाव अविश्वसनीय रूप से प्रासंगिक हैं और बहु-भाषा सुविधा ने मुझे अंतरराष्ट्रीय खरीदारों तक पहुंचने में मदद की। मेरी एडोब स्टॉक कमाई मात्र 3 महीनों में दोगुनी हो गई!"',
                review_4_details: '📍 शिकागो, IL • ग्राफिक डिजाइनर',
                review_4_text: '"अकेले कॉपीराइट चेक फीचर ही कीमत के लायक है! इसने मुझे कई बार संभावित रिजेक्शन से बचाया है। स्वचालित मेटाडेटा निर्माण के साथ संयुक्त, यह टूल स्टॉक फोटोग्राफी के बारे में गंभीर किसी भी व्यक्ति के लिए आवश्यक है।"',
                review_5_details: '📍 सिएटल, WA • प्रकृति फोटोग्राफर',
                review_5_text: '"मैं हर महीने सैकड़ों प्रकृति तस्वीरें अपलोड करता हूं। MetaGen Pro उन सभी को प्रबंधित और अनुकूलित करना आसान बनाता है। CSV निर्यात सुविधा मेरे वर्कफ़्लो के साथ सहजता से एकीकृत हो जाती है। साथी योगदानकर्ताओं को अत्यधिक अनुशंसा!"',
                review_6_details: '📍 ऑस्टिन, TX • फ्रीलांस वीडियोग्राफर',
                review_6_text: '"वीडियो मेटाडेटा के लिए गेम-चेंजर! एआई सटीक रूप से दृश्यों की पहचान करता है और सही शीर्षक उत्पन्न करता है। मेरे शटरस्टॉक वीडियो पोर्टफोलियो की दृश्यता में नाटकीय रूप से सुधार हुआ है। सपोर्ट टीम भी बेहद संवेदनशील और मददगार है।"',
                stat_users: 'सक्रिय अमेरिकी उपयोगकर्ता',
                stat_satisfaction: 'संतुष्टि दर',
                stat_images: 'छवियां प्रतिदिन अनुकूलित',
                stat_rating: 'औसत रेटिंग',
                "faq_title": "सामान्य प्रश्न — MetaGen Pro",
                "faq_q1": "🚀 मैं MetaGen Pro के साथ कैसे शुरुआत करूं?",
                "faq_a1": "<strong>चरण 1:</strong> अपने Google खाते या ईमेल से साइन अप या लॉग इन करें।<br><strong>चरण 2:</strong> सेटिंग्स में अपनी Google Gemini API कुंजी सेट करें (<a href='https://aistudio.google.com/app/apikey' target='_blank'>Google AI Studio</a> पर एक मुफ्त प्राप्त करें)।<br><strong>चरण 3:</strong> अपनी छवियां (JPG, PNG, SVG, EPS) अपलोड करें - एक साथ 500 फाइलों तक!<br><strong>चरण 4:</strong> अपना लक्षित प्लेटफ़ॉर्म (Shutterstock, Adobe Stock, आदि) चुनें और 'Generate Metadata' पर क्लिक करें।<br><strong>चरण 5:</strong> समीक्षा करें, यदि आवश्यक हो तो संपादित करें, फ़ाइलों में मेटाडेटा एम्बेड करें और डाउनलोड करें!",
                "faq_q2": "💰 क्या MetaGen Pro मुफ़्त है? इसकी कीमत क्या है?",
                "faq_a2": "<p><strong>सभी के लिए मुफ़्त!</strong> MetaGen Pro एक दमदार मुफ़्त प्लान (120 इमेज/महीना, अधिकतम 25/दिन) प्रदान करता है। अधिक उपयोग करने वालों के लिए, हमारे पास <strong>प्रो</strong> ($12/महीना - 2000 इमेज/महीना, अधिकतम 70/दिन) और <strong>प्रीमियम</strong> ($29/महीना - 3000 इमेज/महीना, अधिकतम 100/दिन) प्लान हैं जिनमें एक्सेल एक्सपोर्ट और डायरेक्ट FTP अपलोड जैसी उन्नत सुविधाएँ शामिल हैं।</p>",
                "faq_q3": "🔑 मुझे API कुंजी कैसे मिलेगी? क्या वे सुरक्षित हैं?",
                "faq_a3": "<p><strong>नहीं, अब किसी भी प्लान के लिए API कुंजी की आवश्यकता नहीं है!</strong> सभी प्लानों में, चाहे वे फ्री हों, प्रो हों या प्रीमियम, हम अपने स्वयं के सर्वर और सुपबेस एज फंक्शंस के समर्पित AI मॉडल (उन्नत AI मॉडल) का उपयोग करके मेटाडेटा संसाधित करते हैं।</p><p><strong>सुरक्षा:</strong> आपका सारा डेटा पूरी तरह से सुरक्षित है और प्रसंस्करण के तुरंत बाद सर्वर से हटा दिया जाता है।</p>",
                "faq_q4": "📁 कौन से फ़ाइल स्वरूप समर्थित हैं?",
                "faq_a4": "<p><strong>समर्थित स्वरूप:</strong></p><ul><li><strong>JPG/JPEG:</strong> EXIF एम्बेडिंग के साथ पूर्ण समर्थन</li><li><strong>PNG:</strong> मेटाडेटा एम्बेडिंग के साथ पूर्ण समर्थन</li><li><strong>SVG:</strong> XMP एम्बेडिंग के साथ पूर्ण समर्थन</li><li><strong>EPS:</strong> SVG में परिवर्तित होता है (ConvertAPI कुंजी आवश्यक)</li></ul><p>एक बार में <strong>500 फ़ाइलें</strong> तक अपलोड करें!</p>",
                "faq_q5": "🎯 कौन से स्टॉक प्लेटफ़ॉर्म समर्थित हैं?",
                "faq_a5": "<p>सभी प्रमुख प्लेटफ़ॉर्म के लिए अनुकूलित: Shutterstock, Adobe Stock, Magnific, Vecteezy, Pond5, 123RF, iStock, Getty Images, और बहुत कुछ। हमारा AI स्वचालित रूप से प्रत्येक प्लेटफ़ॉर्म की आवश्यकताओं के अनुरूप ढल जाता है!</p>",
                "faq_q6": "📊 SEO स्कोर और कीवर्ड बैज क्या हैं?",
                "faq_a6": "<p><strong>SEO स्कोर:</strong> खोज एल्गोरिदम के लिए अनुकूलन को मापता है।</p><p><strong>बैज:</strong></p><ul><li>🟢 <strong>हरा:</strong> एकल-शब्द (उच्च मात्रा)</li><li>🟡 <strong>पीला:</strong> दो-शब्द (सर्वोत्तम संतुलन)</li><li>🔵 <strong>नीला:</strong> 3+ शब्द (लॉन्ग-टेल)</li></ul>",
                "faq_q7": "⚡ बैच प्रोसेसिंग कैसे काम करती?",
                "faq_a7": "<p>500 तक छवियां अपलोड करें, 'Process Selected' पर क्लिक करें, और हमारा AI उन्हें समानांतर में संभालता है। यह बिजली की तरह तेज़ है—100 फ़ाइलों में लगभग उतना ही समय लगता है जितना 1 फ़ाइल में!</p>",
                "faq_q8": "🎨 'Image to Prompt' सुविधा क्या है?",
                "faq_a8": "<p>यह आपकी छवि को Midjourney या DALL-E जैसे AI जनरेटर के लिए एक विस्तृत प्रॉम्प्ट में बदल देता है। सफल स्टॉक छवियों का विश्लेषण करने के लिए बिल्कुल सही!</p>",
                "faq_q9": "🔒 क्या मेरा डेटा निजी है? क्या आप मेरी छवियां संग्रहीत करते हैं?",
                "faq_a9": "<p><strong>100% निजी!</strong> प्रोसेसिंग आपके ब्राउज़र में होती है। हम आपकी छवियों को कभी भी संग्रहीत नहीं करते हैं। प्रोसेसिंग के तुरंत बाद डेटा हटा दिया जाता है।</p>",
                "faq_q10": "🔧 समस्या निवारण: सामान्य समस्याएं",
                "faq_a10": "<ul><li><strong>API कुंजी त्रुटि:</strong> सेटिंग्स में अपनी कुंजी जांचें।</li><li><strong>फ़ाइल बहुत बड़ी:</strong> 20MB से कम रखें।</li><li><strong>धीमी प्रोसेसिंग:</strong> अन्य ब्राउज़र टैब बंद करें।</li></ul>",
                "faq_q11": "🎭 AI इमेज जेनरेटर कैसे काम करता है?",
                "faq_a11": "<p>सीधे चित्र बनाने के लिए FLUX मॉडल का उपयोग करें। अपनी Together AI कुंजी सेट करें, एक प्रॉम्प्ट दर्ज करें, और अपने स्टॉक पोर्टफोलियो के लिए अद्वितीय चित्र बनाएं!</p>",
                "faq_q12": "💬 मुझे सहायता कैसे मिल सकती है या प्रतिक्रिया कैसे साझा कर सकता हूँ?",
                "faq_a12": "<p>हमें <strong>metagenp@gmail.com</strong> पर ईमेल करें या ऐप में फीडबैक बटन का उपयोग करें। हम 12 घंटे के भीतर महत्वपूर्ण समस्याओं का उत्तर देते हैं!</p>"
            },

            es: {
                flag: '🇪🇸',
                name: 'ES',
                band: 'MetaGen Pro',
                tagline: 'Metadatos impulsados por IA',
                home: 'Inicio',
                features: 'Características',
                start_tour: 'Iniciar Tour',
                faq: 'Preguntas Frecuentes',
                menu: 'MENÚ',
                blog: 'Blog',
                disclaimer: 'Descargo de responsabilidad',
                about: 'Sobre nosotros',
                contact: 'Contacto',
                legal: 'Aviso legal',
                select_lang: 'Seleccionar idioma',
                general_btn: "General",
                save_key: 'Guardar',
                close: 'Cerrar',
                get_key: 'Obtener clave',
                badge: 'Insignia',
                try_metagen: 'Pruebe MetaGen gratis',
                no_api: 'No se requiere clave API para su prueba gratuita',
                ref: '¡Desbloquea el límite doble!',
                ref_text: 'Comparte MetaGen Pro. Cuando alguien se una haciendo clic en tu enlace de referencia, tu límite diario de procesos aumentará de 50 a 100.',
                ref_share_btn: 'Comparte ahora',
                watting_for: '¿Que estas esperando?',
                "get_start": "Empieza gratis",
                "drag_and_drop": "Arrastre y suelte en cualquier lugar para cargar",
                "fast": "Rápido",
                "best": "Mejor",
                "generate_meta": "Generar metadatos",
                "delete_select": "Eliminar seleccionados",
                "down_select": "Descargar seleccionados",
                "translate_select": "Traducir seleccionados",
                "done": "Hecho",
                "processing": "Procesando",
                "analyzing_market": "Analizando tendencias del mercado...",
                "ai_is_researching": "La IA está investigando conceptos de alto rendimiento para ti.",
                "analyzing": "Analizando...",
                "copy_tag": "Copiar etiquetas",
                "copy_idea": "Copiar idea e información",
                "download": "Descargar",
                "enter_your_convert_api": "Introduce tu clave API de Convert para habilitar conversiones EPS.",
                "export_csv": "Exportar a CSV",
                "export_excel": "Exportar a Excel",
                "niche_research_cen": "Centro de Investigación de Nichos",
                "niche_research_tag": "Descubra palabras clave y conceptos de alta demanda y baja competencia para su portafolio de stock.",
                "select_category": "Seleccionar categoría",
                "market_focus": "Enfoque de mercado",
                "analyze_trend": "Analizar tendencias",
                "ready_to_research": "Listo para investigar",
                "ready_to_research_tag": "Seleccione una categoría arriba y haga clic en \"Analizar tendencias\" para descubrir nichos rentables.",
                "quick_suggest": "Sugerencias rápidas",
                "label_title": "Título",
                "label_desc": "Descripción",
                "label_keywords": "Palabras clave",
                "btn_copy": "Copiar",
                "btn_add": "Añadir",
                "placeholder_add_kw": "Añadir palabra clave...",
                "seo_score": "Puntuación SEO",
                "rejection": "Rechazo",
                "platform_check": "Verificación de plataforma",
                "style": "Estilo",
                "mode": "Modo",
                "translate": "Traducir",
                "go": "Ir",
                "min_title": "Mín. Palabras del Título",
                "max_title": "Máx. Palabras del Título",
                "min_keywords": "Mín. Palabras Clave",
                "max_keywords": "Máx. Palabras Clave",
                "min_desc": "Mín. Palabras de Descripción",
                "max_desc": "Máx. Palabras de Descripción",
                "toggle_silhouette": "Silueta",
                "toggle_vector": "Vector / Modo Ilustración",
                "toggle_white_bg": "Fondo Blanco",
                "toggle_trans_bg": "Fondo Transparente",
                "toggle_custom_prompt": "Prompt Personalizado",
                "toggle_prohibited": "Palabras Prohibidas",
                "toggle_single_kw": "Palabras Clave de Una Sola Palabra",
                "toggle_change_name": "Cambiar Nombre de Archivo",
                "toggle_name_title": "Nombre de Archivo como Título",
                "feedback_matters": "Sus comentarios son importantes",
                "provide_feedback": "¿Podría dar su opinión sobre la herramienta?",
                "issue_type": "Tipo de problema",
                "general_feedback": "Comentarios generales",
                "bug_report": "Informe de error",
                "feature_request": "Solicitud de función",
                "your_mess": "Su mensaje",
                "send_feed": "Enviar comentarios",
                eps_meta: 'Generar e incrustar metadatos EPS',
                month: '/ mes',
                pricing: 'Precios',
                ftp_upload: 'Carga directa FTP',
                ftp_upload_sub_txt: 'Sube archivos directamente a sitios de stock (Adobe Stock, Shutterstock, Magnific).',
                upgrade_plan: 'Mejorar plan',
                stock_calendar: 'Calendario de stock',
                get_access: 'Obtener acceso',
                pricing_plan: 'Nuestro plan de precios',
                pricing_sub_txt: 'Elige el plan perfecto para tu flujo de trabajo creativo.',
                free_plan: 'Plan gratuito',
                free_price: '$0/mes',
                most_popular: 'Más popular',
                pro_plan: 'Actualizar a Pro',
                pro_price: '$12/mes',
                premium_plan: 'Plan Premium',
                premium_price: '$29/mes',
                '50_image': '120 imágenes al mes (máximo 10 al día para uso legítimo)',
                basic_ai_model: 'Modelos de IA básicos (Gemini, Mistral, Groq) Usa tu propia clave de API.',
                batch_process: 'Proceso por lotes: hasta 50 archivos',
                csv_export: 'Exportación CSV',
                ads_support: 'Con publicidad',
                auto_embed: 'Incrustación automática de metadatos',
                excel_export: 'Exportación a Excel',
                drag_keyword: 'Reordenamiento de palabras clave (Arrastrar y soltar)',
                copy_trade_check: 'Comprobación de derechos de autor/marcas comerciales',
                get_started_free: 'Comenzar gratis',
                '300_images': '2000 imágenes por mes',
                advance_ai: 'Modelos de IA avanzados (No se requiere clave de API).',
                batch_process_pro: 'Proceso por lotes: hasta 100 archivos',
                csv_excel_ex: 'Exportación CSV/Excel',
                seo_and_no_ads: 'Análisis SEO y sin anuncios',
                support_time: 'Soporte 24 horas',
                '1k_image': '3000 imágenes por mes',
                all_pro: 'Todas las funciones Pro',
                batch_process_pre: 'Proceso por lotes: hasta 300 archivos',
                ftp_auto_up: 'Carga automática FTP/SFTP',
                vector_eps: 'Conversión directa a Vector/EPS',
                vip_support: 'Soporte VIP y acceso anticipado',
                privacy_policy: 'Política de privacidad',
                terms_of_service: 'Condiciones de servicio',
                adjustment: 'Ajuste',
                multi_tool: 'Herramientas multiimagen',
                sketch_art: 'Imagen a boceto',
                all_tools: 'Todas las herramientas',
                image_enhance: 'Mejorador de imagen IA',
                bg_remove: 'Eliminador de Fondo IA',
                pixel_check: 'Pixel-Check Studio',
                text_to_image: 'Generador de texto a imagen',
                company: 'Compañía',
                free_plan: 'Plan gratuito',
                note: 'El acceso a la API se eliminará en 7 días. Actualiza al plan Pro/Premium y disfruta de todas las funciones de MetaGen Pro.',
                platform: 'Plataforma',
                add_more: 'Agregar más archivos',
                login_google: 'Continuar con Google',
                new_user: '¿Usuario nuevo?',
                create_account: 'Crear una cuenta',
                niche_research: 'Investigación de Nicho',
                metadata_generator: 'Generador de Metadatos',
                seo_score: 'Puntuación SEO y Análisis',
                batch_process: 'Proceso por Lotes Súper Rápido',
                sign_out: 'Cerrar sesión',
                switch_account: 'Cambiar cuenta',
                upload_title: 'Subir imágenes o videos',
                drag_drop: 'Arrastra y suelta archivos aquí o haz clic para subir',
                supports: 'Soporta JPG, PNG, WEBP, MP4, MOV',
                max_size: 'Máx 50MB por archivo',
                privacy_note: 'Sus archivos se procesan de forma segura y se eliminan después de 1 hora.',
                privacy_note_device: 'Analizamos los archivos únicamente en el dispositivo, no se guardan datos.',
                upload_limit_info: 'Plan Gratuito: 50 archivos/día',
                usage: 'Uso:',
                "daily_limit": "Límite diario de procesos",
                refer_text: '¡Comparte MetaGen Pro para obtener +50 de límite diario adicional!',
                "share_get_credit": "Comparte y obtén créditos",
                generate_metadata: 'Generar Metadatos',
                "limit_reached_msg": "¡Has alcanzado tu límite diario de procesamiento! Actualiza tu plan para obtener límites más altos o comparte la herramienta para obtener un bono.",
                export_csv: 'Exportar a CSV',
                export_excel: 'Exportar a Excel',
                clear_all: 'Borrar todo',
                copy_all: 'Copiar todo',
                down_eps: 'Descargar EPS',
                guides: 'Guías',
                title: 'Título',
                description: 'Descripción',
                keywords: 'Palabras clave',
                categories: 'Categorías',
                already_user: '¿Ya tienes una cuenta?',
                login: 'Iniciar sesión',
                well_come: 'Bienvenido de nuevo',
                tools_generator: 'Herramientas y Generador',
                trending: '📅 Tendencias...',
                customization: 'Personalización',
                settings: 'Configuración',
                select_ai: 'Seleccionar proveedor de IA',
                manage_api: 'Gestionar claves API',
                convert_api: 'Clave ConvertAPI',
                translation_lang: 'Idioma de traducción',
                upload_files: 'Subir archivos',
                watch_demo: 'Ver demostración',
                watch_tagline: 'Vea cómo aumentar sus ventas de stock en segundos',
                process_selected: 'Procesar seleccionados',
                process_prompts: 'Procesar prompts',
                embed_metadata: 'Incrustar metadatos',
                export: 'Exportar',
                batch_translate: 'Traducción por lotes (Gratis)',
                translate_all: 'Traducir todo (API)',
                test_metadata: 'Probar metadatos',
                save_folder: 'Guardar en carpeta',
                share_files: 'Compartir archivos',
                upload_drive: 'Subir a Drive',
                pause: 'Pausa',
                image_to_prompt: 'Imagen a Prompt',
                jpg_png: 'JPG/PNG',
                svg_eps: 'SVG/EPS/AI',
                videos: 'Videos',
                check_copyright: 'Comprobar derechos de autor/marca:',
                upload_limit: 'Subir un máximo de 500 archivos en una sola acción',
                resume: 'Reanudar',
                send_feedback: 'Enviar comentarios / Informe de errores',
                view_translated: 'Ver traducido',
                view_original: 'Ver original',
                analyze_trends: 'Analizar tendencias',
                downloading: 'Descargando...',
                translating: 'Traduciendo...',
                embedding: 'Incrustando...',
                analyzing: 'Analizando...',
                processing: 'Procesando...',
                process: 'Procesar',
                files: 'Archivos',
                prompts: 'Prompts',
                complete: 'Completado',
                success: 'Éxito',
                fail: 'Fallo',
                saving: 'Guardando...',
                preparing: 'Preparando...',
                uploading: 'Subiendo...',
                initializing: 'Iniciando conexión...',
                "hero_title": "¡Generador de metadatos de IA y palabras clave de fotos de stock gratis!",
                hero_tagline: 'Aumenta tu visibilidad en Shutterstock, Adobe Stock y Magnific. Genera títulos, descripciones y palabras clave optimizadas para SEO en segundos con IA avanzada.',
                why_choose: '¿Por qué elegir MetaGen Pro?',
                blog_1: 'Procesamiento por lotes superrápido',
                blog_tag_1: 'Analiza y asigna palabras clave a cientos de imágenes en segundos. Ahorra horas de trabajo manual con nuestro motor de lotes optimizado.',
                blog_2: 'Análisis avanzado de IA',
                blog_tag_2: 'Impulsado por un modelo de IA avanzado para el reconocimiento de imágenes líder en la industria y metadatos precisos.',
                blog_3: 'Palabras clave optimizadas para SEO',
                blog_tag_3: 'Genere títulos y etiquetas de alto rango diseñados específicamente para los algoritmos de Shutterstock, Adobe Stock y Magnific.',
                blog_4: 'Investigación de nichos',
                blog_tag_4: 'Descubra temas con poca competencia y alta demanda con nuestra herramienta integrada de investigación de nichos. Descubra lo que buscan los compradores.',
                blog_5: 'Reordenamiento de palabras clave mediante arrastrar y soltar',
                blog_tag_5: 'En los sitios de stock (Adobe Stock, Shutterstock) las primeras 5 a 10 palabras clave son las más importantes.',
                blog_6: 'Incorporación de metadatos',
                blog_tag_6: 'Incruste títulos y palabras clave directamente en sus archivos JPG/PNG/SVG (IPTC/XMP). Simplemente descárguelos y súbalos a cualquier plataforma de archivo.',
                blog_7: 'Multilingüe',
                blog_tag_7: 'Traduce tus metadatos a más de 10 idiomas al instante. Llega a una audiencia global con títulos y descripciones localizados.',
                blog_8: 'Comprobación de derechos de autor',
                blog_tag_8: '¡Evita el rechazo! Nuestra IA escanea tus imágenes para detectar posibles problemas de marca registrada y logotipos antes de subirlas.',
                blog_9: 'Exportar metadatos CSV',
                blog_tag_9: 'Facilidad de exportación de archivos CSV de todos los sitios de stock de Adobe Stock, Shutterstock y Magnific.',
                trusted_all: 'De confianza para las principales plataformas de microstock',
                it_works: 'Cómo funciona',
                upload_photos: 'Subir fotos',
                upload_photos_tag: 'Arrastra y suelta tus archivos JPG/PNG. Leemos automáticamente las dimensiones y las especificaciones técnicas.',
                select_platfrom: 'Seleccione Plataforma e IA',
                select_platfrom_tag: 'Elija su mercado objetivo (por ejemplo, Adobe Stock) y el modelo de IA preferido (Gemini/Groq).',
                gen_down: 'Generar y descargar',
                gen_down_tag: 'Obtén títulos y palabras clave optimizados para SEO al instante. Descarga CSV o incrústalos directamente.',
                processing_files: 'Procesando archivos...',
                why_choose_stock_title: '¿Por qué elegir MetaGen Pro para fotografía de stock?',
                how_to_use_title: '¿Cómo usar la herramienta?',
                master_stock_title: 'Domina tu fotografía de stock con metadatos impulsados por IA',
                trusted_stock_title: 'Confiado por colaboradores de stock en todo Estados Unidos',
                why_choose_stock_p1: 'En el competitivo mundo de la fotografía de stock, la capacidad de descubrimiento es clave. Incluso las mejores imágenes no se venderán si los compradores no pueden encontrarlas. <strong>MetaGen Pro</strong> es el <em>Generador de Metadatos de IA</em> definitivo diseñado para resolver este problema.',
                why_choose_stock_p2: 'A diferencia del etiquetado manual, que es tedioso y propenso a errores, nuestra herramienta utiliza visión por computadora de vanguardia para analizar el sujeto, el estado de ánimo, la iluminación y la composición de su imagen. Luego genera más de 50 palabras clave optimizadas, títulos atractivos y descripciones detalladas adaptadas a plataformas como <strong>Shutterstock, Adobe Stock, Magnific y Vecteezy</strong>.',
                why_choose_stock_p3: 'Ya sea fotógrafo, ilustrador o artista de IA, MetaGen Pro agiliza su flujo de trabajo. Funciones como <strong>Imagen a Prompt</strong> le ayudan a realizar ingeniería inversa de imágenes de IA exitosas, mientras que nuestro <strong>Predictor de Rechazo</strong> le ayuda a solucionar problemas técnicos antes de cargarlas.',
                why_choose_stock_p4: 'Comience a maximizar sus ingresos pasivos hoy con el etiquetador de fotos de stock gratuito más avanzado disponible.',
                "plan_details_title": "¿Qué plan es el adecuado para ti?",
                "plan_details_free": "Plan Gratuito - Ideal para principiantes",
                "plan_details_free_p1": "Nuestro Plan Gratuito está diseñado para aficionados y nuevos colaboradores de stock. Te permite procesar hasta <strong>10 imágenes al día</strong>. Para mantener el servicio completamente gratuito, Obtendrás acceso a nuestras funciones principales, incluyendo procesamiento por lotes ultrarrápido (hasta 50 archivos a la vez), generación de metadatos con IA y exportación a CSV. Ten en cuenta que funciones avanzadas como la Incrustación Automática de Metadatos, Exportación a Excel y las Comprobaciones de Derechos de Autor no están incluidas en este plan.",
                "plan_details_pro": "Plan Pro - Para profesionales",
                "plan_details_pro_p1": "El Plan Pro está creado para colaboradores habituales que desean maximizar su flujo de trabajo y ahorrar horas de tiempo. Con un generoso límite de <strong>70 imágenes al día</strong>, ya no necesitas traer tus propias claves API: nosotros gestionamos todas las solicitudes de IA de forma segura por nuestra cuenta. Este plan desbloquea herramientas potentes como la <strong>Incrustación Automática de Metadatos</strong> directamente en tus archivos JPEG/PNG/SVG, reordenamiento de palabras clave mediante arrastrar y soltar, comprobación de derechos de autor/marcas registradas con IA y exportación a Excel. También aumenta tu límite de procesamiento por lotes a 100 archivos a la vez y ofrece una experiencia completamente libre de anuncios.",
                "plan_details_premium": "Plan Premium - Para usuarios avanzados y agencias",
                "plan_details_premium_p1": "Diseñado para creadores de alto volumen, artistas de vectores y agencias, el Plan Premium ofrece un límite masivo de <strong>100 imágenes al día</strong> y un límite por lote de 300 archivos. Incluye todo lo del plan Pro, además de funciones avanzadas de automatización. Tienes acceso exclusivo a la <strong>Conversión directa de Vectores/EPS</strong> (sin necesidad de claves ConvertAPI de terceros) y a la función de <strong>Subida Automática por FTP/SFTP</strong>. Esto te permite distribuir automáticamente tus archivos procesados y metadatos directamente a múltiples agencias de stock (Shutterstock, Adobe Stock, Magnific, etc.) desde tu navegador.",
                "htu_step1_title": "1. Subir Archivos",
                "htu_step1_desc": "Arrastra y suelta imágenes (JPG/PNG), vectores (SVG/EPS) o videos para comenzar.",
                "htu_step2_title": "2. Plataforma de Destino",
                "htu_step2_desc": "Selecciona Shutterstock, Adobe Stock o Magnific para obtener resultados optimizados.",
                "htu_step3_title": "3. Seleccionar Modelo de IA",
                "htu_step3_desc": "Elige entre Gemini, Mistral o Groq para el análisis de imágenes.",
                "htu_step4_title": "4. Personalización",
                "htu_step4_desc": "Ajusta las palabras mínimas/máximas para títulos y palabras clave mediante los controles deslizantes.",
                "htu_step5_title": "5. Configuración de IA",
                "htu_step5_desc": "Habilita el Modo Vector, Fondo Blanco o utiliza tus propios Prompts Personalizados.",
                "htu_step6_title": "6. Generar Metadatos",
                "htu_step6_desc": "Haz clic en 'Procesar seleccionados' para obtener títulos y etiquetas listos para SEO al instante.",
                "htu_step7_title": "7. Incrustar Metadatos",
                "htu_step7_desc": "Escribe metadatos directamente en tus archivos JPG, PNG o SVG.",
                "htu_step8_title": "8. Traducción Múltiple",
                "htu_step8_desc": "Traduce los metadatos a más de 10 idiomas para el mercado global.",
                "htu_step9_title": "9. Exportar Resultados",
                "htu_step9_desc": "Descarga todos tus metadatos como CSV o en hojas de Excel profesionales.",
                "htu_step10_title": "10. Guardar y Drive",
                "htu_step10_desc": "Guarda en una carpeta local, comparte mediante enlace o sube directamente a Google Drive.",
                master_stock_subtitle1: 'Cómo usar MetaGen Pro',
                master_stock_p1: 'Comenzar con MetaGen Pro es increíblemente simple y no requiere experiencia técnica. Primero, cargue sus imágenes arrastrándolas y soltándolas en el área de carga designada, o haga clic para buscar sus archivos. MetaGen Pro admite todos los formatos de imagen principales, incluidos JPG, PNG, SVG y EPS, así como archivos de video. Una vez que haya cargado sus imágenes, seleccione su plataforma de destino (Shutterstock, Adobe Stock, Magnific o General) para optimizar los metadatos específicamente para ese mercado.',
                master_stock_p2: 'Luego, configure sus preferencias usando la configuración de la barra lateral. Puede ajustar la cantidad de palabras clave (recomendamos 35-50 para un SEO óptimo), establecer restricciones de longitud de título y habilitar funciones especiales como el Modo Vector para ilustraciones o la detección de Fondo Blanco para imágenes de productos. La selección del proveedor de IA le permite elegir entre los modelos Google Gemini, Mistral AI o Groq Llama según su disponibilidad de API y preferencias de velocidad.',
                master_stock_p3: 'Después de la configuración, haga clic en el botón "Procesar todo" para generar metadatos para todas las imágenes cargadas simultáneamente. Nuestra IA avanzada analiza el contenido visual, la composición, los colores, los sujetos y el contexto de cada imagen para crear títulos, descripciones y conjuntos de palabras clave altamente relevantes. El proceso completo generalmente toma solo unos segundos por imagen, incluso cuando se procesan cientos de archivos en modo por lotes.',
                master_stock_subtitle2: 'Beneficios de usar esta herramienta',
                master_stock_benefit1: '<strong>Eficiencia de tiempo:</strong> El etiquetado manual puede llevar de 10 a 15 minutos por imagen. MetaGen Pro reduce esto a meros segundos, lo que le permite etiquetar cientos de imágenes en el tiempo que le llevaría procesar manualmente solo unas pocas. Para los colaboradores profesionales que cargan de 50 a 100 imágenes semanalmente, esto se traduce en un ahorro de más de 10 horas cada semana.',
                master_stock_benefit2: '<strong>Optimización SEO:</strong> Nuestra IA no solo describe lo que ve, sino que comprende la intención de búsqueda y los algoritmos del mercado. Cada conjunto de metadatos incluye una mezcla estratégica de palabras clave amplias (alto volumen de búsqueda), palabras clave específicas de cola larga (alta conversión) y términos de tendencia (demanda actual). El medidor de puntuación SEO integrado evalúa sus metadatos en tiempo real, garantizando que cada carga esté optimizada para una máxima visibilidad.',
                master_stock_benefit3: '<strong>Soporte multi-plataforma:</strong> Las diferentes agencias de stock tienen diferentes requisitos y preferencias. MetaGen Pro se adapta al algoritmo único de cada plataforma: Shutterstock prefiere estructuras de palabras clave diferentes a las de Adobe Stock o Magnific. Nuestra optimización específica de la plataforma garantiza que sus imágenes se posicionen bien dondequiera que las cargue.',
                master_stock_benefit4: '<strong>Consistencia y calidad:</strong> Elimine los errores humanos y mantenga estándares profesionales en todo su portafolio. MetaGen Pro garantiza que cada imagen tenga metadatos formateados correctamente, una cantidad adecuada de palabras clave y descripciones apropiadas. La función Predictor de Rechazo analiza sus metadatos frente a los criterios comunes de rechazo, ayudándole a evitar costosos fallos en el envío.',
                master_stock_subtitle3: '¿Qué es el SEO de imágenes y por qué es importante?',
                master_stock_seo_p1: 'El SEO de imágenes (optimización para motores de búsqueda) es la práctica de optimizar los metadatos de las imágenes para mejorar la visibilidad en los resultados de búsqueda en las plataformas de fotografía de stock y motores de búsqueda. Cuando un comprador busca "reunión de negocios" o "atardecer en playa tropical", el algoritmo de la plataforma no "ve" su imagen, sino que lee los metadatos que usted ha proporcionado. Un SEO de imágenes eficaz es la diferencia entre que su trabajo aparezca en la página 1 frente a la página 50 de los resultados de búsqueda.',
                master_stock_seo_p2: '<strong>Los tres pilares del SEO de imágenes:</strong> Primero, el <em>Título</em> debe ser descriptivo pero conciso (10-20 palabras), que contenga sus palabras clave principales y que sea natural y legible. Segundo, la <em>Descripción</em> proporciona contexto y casos de uso (30-50 palabras), ayudando tanto a los algoritmos como a los compradores a comprender las aplicaciones comerciales de su imagen. Tercero, las <em>Palabras clave</em> lanzan una red amplia (se recomiendan de 35 a 50 términos), capturando diversas consultas de búsqueda que podrían llevar a los compradores a su imagen.',
                master_stock_seo_p3: '<strong>La estrategia de palabras clave importa:</strong> Los metadatos más efectivos utilizan una mezcla equilibrada: 20-30% de palabras clave de una sola palabra (alcance amplio), 40-50% de frases de dos palabras (especificidad media) y 20-30% de palabras clave de cola larga (alta conversión). Por ejemplo, una imagen de manos usando un teléfono inteligente debería incluir "manos" (amplio), "interacción con teléfono inteligente" (medio) y "manos tocando la interfaz de la aplicación móvil" (cola larga). Esta estrategia maximiza las posibilidades de que su imagen aparezca tanto en búsquedas amplias como específicas.',
                master_stock_seo_p4: '<strong>Factores de posicionamiento en búsqueda:</strong> Las plataformas de stock consideran múltiples factores al clasificar los resultados de búsqueda. La relevancia (qué tan bien coinciden sus metadatos con la consulta de búsqueda), la integridad (tener todos los campos de metadatos completados correctamente) y la diversidad de palabras clave (usar términos variados y relacionados) impactan en su clasificación. Además, la relevancia comercial (describir cómo los compradores pueden usar su imagen) afecta significativamente las tasas de conversión incluso cuando su imagen se posiciona bien.',
                master_stock_seo_p5: 'MetaGen Pro automatiza todas estas mejores prácticas, garantizando que cada imagen que cargue esté completamente optimizada para una máxima visibilidad, descargas y, en última instancia, ingresos. Ya sea un colaborador aficionado o un fotógrafo de stock a tiempo completo, el SEO de imágenes adecuado no es negociable en el competitivo mercado actual.',
                master_stock_cta: '<strong>¿Listo para impulsar su éxito en la fotografía de stock?</strong> Comience a usar MetaGen Pro hoy mismo y transforme horas de tedioso etiquetado en segundos de excelencia automatizada.',
                trusted_stock_subtitle: 'Descubra por qué miles de fotógrafos y creadores estadounidenses confían en MetaGen Pro para aumentar sus ingresos de stock',
                review_1_details: '📍 Nueva York, NY • Fotógrafa Profesional',
                review_1_text: '"¡MetaGen Pro transformó mi flujo de trabajo por completo! Solía pasar horas etiquetando mis fotos para Shutterstock. Ahora solo toma minutos y mis descargas han aumentado un 40%. ¡La función de puntuación SEO es brillante!"',
                review_2_details: '📍 Los Ángeles, CA • Creador de Contenido',
                review_2_text: '"Como creador de contenido a tiempo completo, el tiempo es dinero. Esta herramienta me ahorra al menos 10 horas a la semana en la entrada de metadatos. El procesamiento por lotes es ultrarrápido y las palabras clave generadas por IA son acertadas. ¡La mejor inversión que he hecho este año!"',
                review_3_details: '📍 Miami, FL • Colaboradora de Stock',
                review_3_text: '"Al principio era escéptica, pero MetaGen Pro superó todas las expectativas. Las sugerencias de palabras clave son increíblemente relevantes y la función multi-idioma me ayudó a llegar a compradores internacionales. ¡Mis ganancias en Adobe Stock se duplicaron en solo 3 meses!"',
                review_4_details: '📍 Chicago, IL • Diseñador Gráfico',
                review_4_text: '"¡Solo la función de verificación de derechos de autor vale el precio! Me ha salvado de posibles rechazos varias veces. Combinado con la generación automatizada de metadatos, esta herramienta es imprescindible para cualquiera que se tome en serio la fotografía de stock."',
                review_5_details: '📍 Seattle, WA • Fotógrafa de Naturaleza',
                review_5_text: '"Cargo cientos de fotos de naturaleza cada mes. MetaGen Pro hace que sea fácil administrar y optimizar todas ellas. La función de exportación CSV se integra perfectamente con mi flujo de trabajo. ¡Altamente recomendado para otros colaboradores!"',
                review_6_details: '📍 Austin, TX • Videógrafo Freelance',
                review_6_text: '"¡Un cambio de juego para los metadatos de video! La IA identifica con precisión las escenas y genera títulos perfectos. La visibilidad de mi portafolio de videos de Shutterstock mejoró drásticamente. El equipo de soporte también es extremadamente atento y servicial."',
                stat_users: 'Usuarios activos en EE. UU.',
                stat_satisfaction: 'Tasa de satisfacción',
                stat_images: 'Imágenes optimizadas diariamente',
                stat_rating: 'Calificación promedio',
                "faq_title": "Preguntas frecuentes — MetaGen Pro",
                "faq_q1": "🚀 ¿Cómo empiezo con MetaGen Pro?",
                "faq_a1": "<strong>Paso 1:</strong> Regístrate o inicia sesión con Google o tu email.<br><strong>Paso 2:</strong> Configura tu clave API de Google Gemini en Ajustes (obtén una gratis en <a href='https://aistudio.google.com/app/apikey' target='_blank'>Google AI Studio</a>).<br><strong>Paso 3:</strong> ¡Sube tus imágenes (JPG, PNG, SVG, EPS) - hasta 500 archivos a la vez!<br><strong>Paso 4:</strong> Selecciona tu plataforma (Shutterstock, Adobe Stock, etc.) y haz clic en 'Generate Metadata'.<br><strong>Paso 5:</strong> Revisa, edita si es necesario, incrusta los metadatos y ¡descarga!",
                "faq_q2": "💰 ¿Es MetaGen Pro gratuito? ¿Cuál es el precio?",
                "faq_a2": "<p><strong>¡Planes gratuitos para todos!</strong> Metagen Pro tiene un potente plan gratuito (120 imágenes/mes, máximo 25 diarias). Sin embargo, para un uso intensivo, tenemos los planes <strong>Pro</strong> (12 $/mes - 2000 imágenes/mes, máximo 70 diarias) y <strong>Premium</strong> (29 $/mes - 3000 imágenes/mes, máximo 100 diarias). Los planes de pago ofrecen funciones avanzadas como la incrustación automática de metadatos, la exportación a Excel y la carga directa por FTP.</p>",
                "faq_q3": "🔑 ¿Cómo obtengo las claves API? ¿Son seguras?",
                "faq_a3": "<p><strong>¡No, no se requiere ninguna clave API para ningún plan ahora!</strong> En todos los planes, Gratuito, Pro y Premium, procesamos los metadatos utilizando nuestros propios servidores y modelos de IA dedicados de Supabase Edge Functions (modelos de IA avanzados).</p><p><strong>Seguridad:</strong> Todos sus datos son completamente <strong>seguros</strong> y se eliminan del servidor inmediatamente después del procesamiento.</p>",
                "faq_q4": "📁 ¿Qué formatos de archivo son compatibles?",
                "faq_a4": "<p><strong>Formatos compatibles:</strong></p><ul><li><strong>JPG/JPEG:</strong> Soporte total con incrustación EXIF</li><li><strong>PNG:</strong> Soporte total con incrustación de metadatos</li><li><strong>SVG:</strong> Soporte total con incrustación XMP</li><li><strong>EPS:</strong> Se convierte a SVG (requiere clave ConvertAPI)</li></ul><p>¡Sube hasta <strong>500 archivos a la vez</strong>!</p>",
                "faq_q5": "🎯 ¿Qué plataformas de stock son compatibles?",
                "faq_a5": "<p>Optimizado para: Shutterstock, Adobe Stock, Magnific, Vecteezy, Pond5, 123RF, iStock, Getty Images y más. ¡Nuestra IA se adapta automáticamente a los requisitos de cada plataforma!</p>",
                "faq_q6": "📊 ¿Qué es la puntuación SEO y las insignias de palabras clave?",
                "faq_a6": "<p><strong>SEO Score:</strong> Mide la optimización para algoritmos de búsqueda.</p><p><strong>Insignias:</strong></p><ul><li>🟢 <strong>Verde:</strong> Una palabra (Alto volumen)</li><li>🟡 <strong>Amarillo:</strong> Dos palabras (Mejor equilibrio)</li><li>🔵 <strong>Azul:</strong> 3+ palabras (Long-tail)</li></ul>",
                "faq_q7": "⚡ ¿Cómo funciona el procesamiento por lotes?",
                "faq_a7": "<p>Sube hasta 500 imágenes, haz clic en 'Process Selected' y nuestra IA las maneja en paralelo. ¡Es ultrarrápido!</p>",
                "faq_q8": "🎨 ¿Qué es la función 'Image to Prompt'?",
                "faq_a8": "<p>Convierte tu imagen en un prompt detallado para generadores como Midjourney o DALL-E. ¡Ideal para ingeniería inversa de imágenes exitosas!</p>",
                "faq_q9": "🔒 ¿Son mis datos privados? ¿Guardan mis imágenes?",
                "faq_a9": "<p><strong>¡100% Privado!</strong> El procesamiento ocurre en tu navegador. NUNCA guardamos tus imágenes. Los datos se borran tras el proceso.</p>",
                "faq_q10": "🔧 Solución de problemas comunes",
                "faq_a10": "<ul><li><strong>Error de clave API:</strong> Revisa tu clave en Ajustes.</li><li><strong>Archivo muy grande:</strong> Manténlo bajo 20MB.</li><li><strong>Proceso lento:</strong> Cierra otras pestañas del navegador.</li></ul>",
                "faq_q11": "🎭 ¿Cómo funciona el generador de imágenes IA?",
                "faq_a11": "<p>Usa modelos FLUX para crear imágenes. Configura tu clave de Together AI, escribe un prompt y genera imágenes únicas para tu portafolio.</p>",
                "faq_q12": "💬 ¿Cómo obtengo ayuda o envío comentarios?",
                "faq_a12": "<p>Escríbenos a <strong>metagenp@gmail.com</strong> o usa el botón de Feedback. ¡Respondemos en menos de 12 horas a problemas críticos!</p>"
            },

            pt: {
                flag: '🇧🇷',
                name: 'PT',
                band: 'MetaGen Pro',
                tagline: 'Metadados, Impulsionados por IA',
                home: 'Início',
                features: 'Recursos',
                start_tour: 'Iniciar Tour',
                faq: 'FAQ',
                menu: 'MENU',
                blog: 'Postagem do Blog',
                disclaimer: 'Isenção de Responsabilidade',
                about: 'Sobre Nós',
                contact: 'Contate-nos',
                legal: 'Legal',
                select_lang: 'Selecione o idioma',
                general_btn: "General",
                save_key: 'Guardar',
                close: 'Fechar',
                get_key: 'Obter chave',
                badge: 'Emblema',
                try_metagen: 'Experimente o MetaGen gratuitamente',
                no_api: 'Não é necessária nenhuma chave API para o seu teste gratuito.',
                watting_for: 'O que você está esperando?',
                "get_start": "Comece gratuitamente",
                "drag_and_drop": "Arraste e solte em qualquer lugar para fazer o upload.",
                "fast": "Rápido",
                "best": "Melhor",
                "generate_meta": "Gerar Metadatos",
                "delete_select": "Excluir Selecionados",
                "down_select": "Baixar Selecionados",
                "translate_select": "Traduzir Selecionados",
                "done": "Concluído",
                "processing": "Processando",
                "analyzing_market": "Analisando tendências de mercado...",
                "ai_is_researching": "A IA está pesquisando conceitos de alto desempenho para você.",
                "analyzing": "Analisando...",
                "copy_tag": "Copiar tags",
                "copy_idea": "Copiar ideia e informações",
                "download": "Baixar",
                "enter_your_convert_api": "Insira sua chave de API do Convert para ativar conversões de arquivos EPS.",
                "export_csv": "Exportar para CSV",
                "export_excel": "Exportar para Excel",
                "niche_research_cen": "Centro de Pesquisa de Nicho",
                "niche_research_tag": "Descubra palavras-chave e conceitos de alta demanda e baixa concorrência para seu portfólio de stock.",
                "select_category": "Selecionar Categoria",
                "market_focus": "Foco de Mercado",
                "analyze_trend": "Analisar Tendências",
                "ready_to_research": "Pronto para Pesquisar",
                "ready_to_research_tag": "Selecione uma categoria acima e clique em \"Analisar Tendências\" para descobrir nichos lucrativos.",
                "quick_suggest": "Sugestões Rápidas",
                "label_title": "Título",
                "label_desc": "Descrição",
                "label_keywords": "Palavras-chave",
                "btn_copy": "Copiar",
                "btn_add": "Adicionar",
                "placeholder_add_kw": "Adicionar palavra-chave...",
                "seo_score": "Pontuação SEO",
                "rejection": "Rejeição",
                "platform_check": "Verificação de plataforma",
                "style": "Estilo",
                "mode": "Modo",
                "translate": "Traduzir",
                "go": "Ir",
                "min_title": "Mín. Palavras do Título",
                "max_title": "Máx. Palavras do Título",
                "min_keywords": "Mín. Palavras-chave",
                "max_keywords": "Máx. Palavras-chave",
                "min_desc": "Mín. Palavras da Descrição",
                "max_desc": "Máx. Palavras da Descrição",
                "toggle_silhouette": "Silhueta",
                "toggle_vector": "Vetor / Modo Ilustração",
                "toggle_white_bg": "Fundo Branco",
                "toggle_trans_bg": "Fundo Transparente",
                "toggle_custom_prompt": "Prompt Personalizado",
                "toggle_prohibited": "Palavras Proibidas",
                "toggle_single_kw": "Palavras-chave Únicas",
                "toggle_change_name": "Alterar Nome do Arquivo",
                "toggle_name_title": "Nome do Arquivo como Título",
                "feedback_matters": "O seu feedback é importante",
                "provide_feedback": "Por favor, forneça feedback sobre a ferramenta?",
                "issue_type": "Tipo de problema",
                "general_feedback": "Feedback geral",
                "bug_report": "Relatório de erro",
                "feature_request": "Pedido de recurso",
                "your_mess": "A sua mensagem",
                "send_feed": "Enviar feedback",
                eps_meta: 'Gerar e incorporar metadados EPS',
                month: '/ mês',
                pricing: 'Preços',
                ftp_upload: 'Upload Direto FTP',
                ftp_upload_sub_txt: 'Faça upload de arquivos diretamente para sites de banco de imagens (Adobe Stock, Shutterstock, Magnific).',
                upgrade_plan: 'Fazer upgrade do plano',
                stock_calendar: 'Calendário de Stock',
                get_access: 'Obter acesso',
                pricing_plan: 'Nosso Plano de Preços',
                pricing_sub_txt: 'Escolha o plano perfeito para o seu fluxo de trabalho criativo.',
                free_plan: 'Plano Gratuito',
                free_price: '$0/mês',
                most_popular: 'Mais popular',
                pro_plan: 'Atualizar para Pro',
                pro_price: '$12/mês',
                premium_plan: 'Plano Premium',
                premium_price: '$29/mês',
                '50_image': '120 imagens por mês (máximo de 10 por dia para uma utilização justa)',
                basic_ai_model: 'Modelos de IA básicos (Gemini, Mistral, Groq) Use sua própria chave de API.',
                batch_process: 'Processamento em lote: até 50 arquivos',
                csv_export: 'Exportação CSV',
                ads_support: 'Com suporte a anúncios',
                auto_embed: 'Incorporação automática de metadados',
                excel_export: 'Exportação para Excel',
                drag_keyword: 'Reordenação de palavras-chave (Arrastar e Soltar)',
                copy_trade_check: 'Verificação de direitos autorais/marcas registradas',
                get_started_free: 'Comece grátis',
                '300_images': '2000 imagens/mês',
                advance_ai: 'Modelos de IA avançados (Não é necessária chave de API).',
                batch_process_pro: 'Processamento em lote: até 100 arquivos',
                csv_excel_ex: 'Exportação CSV/Excel',
                seo_and_no_ads: 'Análise de SEO e Sem anúncios',
                support_time: 'Suporte 24 horas',
                '1k_image': '3000 imagens/mês',
                all_pro: 'Todos os recursos Pro',
                batch_process_pre: 'Processamento em lote: até 300 arquivos',
                ftp_auto_up: 'Upload automático FTP/SFTP',
                vector_eps: 'Conversão direta de Vetor/EPS',
                vip_support: 'Suporte VIP e Acesso Antecipado',
                privacy_policy: 'Política de Privacidade',
                terms_of_service: 'Termos de Serviço',
                adjustment: 'Ajuste',
                multi_tool: 'Ferramentas Multi Imagem',
                sketch_art: 'Imagem para Arte de Esboço',
                all_tools: 'Todas as Ferramentas',
                image_enhance: 'Melhorador de Imagem IA',
                bg_remove: 'Removedor de Fundo IA',
                pixel_check: 'Pixel-Check Studio',
                text_to_image: 'Gerador de Texto para Imagem',
                company: 'Empresa',
                free_plan: 'Plano Gratuito',
                note: 'O acesso à API será removido dentro de 7 dias. Atualize para o plano Pro/Premium e utilize todas as funcionalidades do MetaGen Pro.',
                platform: 'Plataforma',
                add_more: 'Adicionar Mais Arquivos',
                well_come: 'Bem-vindo de Volta',
                login_google: 'Continuar com Google',
                new_user: 'Novo usuário?',
                create_account: 'Criar uma conta',
                niche_research: 'Pesquisa de Nicho',
                metadata_generator: 'Gerador de Metadados',
                seo_score: 'Pontuação SEO e Análise',
                batch_process: 'Processo em Lote Super Rápido',
                sign_out: 'Sair',
                switch_account: 'Trocar conta',
                upload_title: 'Carregar Imagens ou Vídeos',
                drag_drop: 'Arraste e solte arquivos aqui ou clique para carregar',
                supports: 'Suporta JPG, PNG, WEBP, MP4, MOV',
                max_size: 'Máx 50MB por arquivo',
                privacy_note: 'Seus arquivos são processados com segurança e excluídos após 1 hora.',
                privacy_note_device: 'Analisamos arquivos apenas no dispositivo, os dados são eliminados após o processamento.',
                upload_limit_info: 'Plano Gratuito: 50 arquivos/dia',
                usage: 'Uso:',
                "daily_limit": "Limite Diário de Processos",
                refer_text: '¡Comparte MetaGen Pro para obtener +50 de límite diario extra!',
                "share_get_credit": "Compartilhe e Ganhe Créditos",
                generate_metadata: 'Gerar Metadados',
                "limit_reached_msg": "Você atingiu seu limite diário de processamento! Atualize seu plano para limites maiores ou compartilhe a ferramenta para obter um bônus.",
                export_csv: 'Exportar para CSV',
                export_excel: 'Exportar para Excel',
                clear_all: 'Limpar Tudo',
                copy_all: 'Copiar Tudo',
                down_eps: 'Baixar EPS',
                guides: 'Guides',
                title: 'Título',
                description: 'Descrição',
                keywords: 'Palavras-chave',
                categories: 'Categorias',
                already_user: 'Já tem uma conta?',
                login: 'Entrar',
                tools_generator: 'Ferramentas e Gerador',
                trending: '📅 Tendências...',
                customization: 'Personalização',
                settings: 'Configurações',
                select_ai: 'Selecionar Provedor de IA',
                manage_api: 'Gerenciar Chaves API',
                convert_api: 'Chave ConvertAPI',
                translation_lang: 'Idioma de Tradução',
                upload_files: 'Carregar Arquivos',
                watch_demo: 'Assistir Demo',
                watch_tagline: 'Veja como aumentar suas vendas de stock em segundos',
                process_selected: 'Processar Selecionados',
                process_prompts: 'Processar Prompts',
                embed_metadata: 'Incorporar Metadados',
                export: 'Exportar',
                batch_translate: 'Tradução em Lote (Grátis)',
                translate_all: 'Traduzir Tudo (API)',
                test_metadata: 'Testar Metadados',
                save_folder: 'Salvar na Pasta',
                share_files: 'Compartilhar Arquivos',
                upload_drive: 'Carregar no Drive',
                pause: 'Pausar',
                image_to_prompt: 'Imagem para Prompt',
                jpg_png: 'JPG/PNG',
                svg_eps: 'SVG/EPS/AI',
                videos: 'Vídeos',
                check_copyright: 'Verificar Direitos Autorais/Marca:',
                upload_limit: 'Carregue no máximo 500 arquivos em uma única ação',
                resume: 'Retomar',
                send_feedback: 'Enviar feedback / Relatório de erros',
                view_translated: 'Ver Traduzido',
                view_original: 'Ver Original',
                analyze_trends: 'Analisar Tendências',
                downloading: 'Baixando...',
                translating: 'Traduzindo...',
                embedding: 'Incorporando...',
                analyzing: 'Analisando...',
                processing: 'Processando...',
                process: 'Processar',
                files: 'Arquivos',
                prompts: 'Prompts',
                complete: 'Completo',
                success: 'Sucesso',
                fail: 'Falha',
                saving: 'Salvando...',
                preparing: 'Preparando...',
                uploading: 'Carregando...',
                initializing: 'Inicializando conexão...',
                processing_files: 'Processando Arquivos...',
                "hero_title": "Gerador de Metadados IA Gratuito e Palavras-chave para Fotos de Stock!",
                hero_tagline: 'Aumente sua visibilidade no Shutterstock, Adobe Stock e Magnific. Gere títulos, descrições e palavras-chave otimizados para SEO em segundos usando IA avançada.',
                why_choose: 'Por que escolher MetaGen Pro?',
                blog_1: 'Processamento em Lote Super Rápido',
                blog_tag_1: 'Analise e coloque palavras-chave em centenas de imagens em segundos. Economize horas de trabalho manual com nosso mecanismo de lote otimizado.',
                blog_2: 'Análise de IA Avançada',
                blog_tag_2: 'Impulsionado por Gemini 1.5 Pro, Mistral e Llama 3 para reconhecimento de imagem líder da indústria e metadados precisos.',
                blog_3: 'Palavras-chave Otimizadas para SEO',
                blog_tag_3: 'Gere títulos e tags de alta classificação especificamente adaptados para os algoritmos do Shutterstock, Adobe Stock e Magnific.',
                blog_4: 'Pesquisa de Nicho',
                blog_tag_4: 'Descubra tópicos de baixa concorrência e alta demanda com nossa ferramenta de Pesquisa de Nicho integrada. Descubra o que os compradores estão pesquisando.',
                blog_5: 'Reordenação de Palavras-chave Arrastar e Soltar',
                blog_tag_5: 'Em sites de stock (Adobe Stock, Shutterstock), as primeiras 5-10 palavras-chave são as mais importantes.',
                blog_6: 'Incorporação de Metadados',
                blog_tag_6: 'Incorpore títulos e palavras-chave diretamente em seus arquivos JPG/PNG/SVG (IPTC/XMP). Basta baixar e carregar em qualquer agência de stock.',
                blog_7: 'Multilíngue',
                blog_tag_7: 'Traduza seus metadados para mais de 10 idiomas instantaneamente. Alcance um público global com títulos e descrições localizados.',
                blog_8: 'Verificação de Direitos Autorais',
                blog_tag_8: 'Evite rejeição! Nossa IA verifica possíveis problemas de marca registrada e logotipos em suas imagens antes de carregá-las.',
                blog_9: 'Exportar Metadados CSV',
                blog_tag_9: 'Facilidade de exportação de arquivo CSV para todos os sites de stock (Adobe Stock, Shutterstock, Magnific).',
                trusted_all: 'Confiável para todas as principais plataformas Microstock',
                it_works: 'Como Funciona',
                upload_photos: 'Carregar Fotos',
                upload_photos_tag: 'Arraste e solte seus arquivos JPG/PNG. Lemos automaticamente as dimensões e especificações técnicas.',
                select_platfrom: 'Selecionar Plataforma e IA',
                select_platfrom_tag: 'Escolha seu mercado alvo (ex: Adobe Stock) e modelo de IA preferido (Gemini/Groq).',
                gen_down: 'Gerar e Baixar',
                gen_down_tag: 'Obtenha títulos e palavras-chave prontos para SEO instantaneamente. Baixe CSV ou Incorpore diretamente.',
                why_choose_stock_title: 'Por que escolher o MetaGen Pro para fotografia de stock?',
                how_to_use_title: 'Como usar a ferramenta?',
                master_stock_title: 'Domine sua fotografia de stock com metadados impulsionados por IA',
                trusted_stock_title: 'Confiável por colaboradores de stock em todos os Estados Unidos',
                why_choose_stock_p1: 'No competitivo mundo da fotografia de stock, a capacidade de descoberta é fundamental. Mesmo as melhores imagens não serão vendidas se os compradores não as encontrarem. <strong>MetaGen Pro</strong> é o <em>Gerador de Metadados de IA</em> definitivo, projetado para resolver este problema.',
                why_choose_stock_p2: 'Diferente da atribuição de palavras-chave manual, que é cansativa e propensa a erros, a nossa ferramenta utiliza visão computacional de ponta para analisar o assunto, o clima, a iluminação e a composição da sua imagem. Em seguida, gera mais de 50 palavras-chave otimizadas, títulos atraentes e descrições detalhadas adaptadas a plataformas como <strong>Shutterstock, Adobe Stock, Magnific e Vecteezy</strong>.',
                why_choose_stock_p3: 'Quer seja fotógrafo, ilustrador ou artista de IA, o MetaGen Pro agiliza o seu fluxo de trabalho. Recursos como <strong>Imagem para Prompt</strong> ajudam a fazer engenharia reversa de imagens de IA bem-sucedidas, enquanto o nosso <strong>Preditores de Rejeição</strong> ajuda a corrigir problemas técnicos antes do upload.',
                why_choose_stock_p4: 'Comece a maximizar o seu rendimento passivo hoje com o marcador de fotos de stock gratuito mais avançado do mercado.',
                "plan_details_title": "Qual plano é o ideal para você?",
                "plan_details_free": "Plano Grátis - O melhor para iniciantes",
                "plan_details_free_p1": "Nosso Plano Grátis foi projetado para hobbistas e novos colaboradores de bancos de imagens. Ele permite que você processe até <strong>10 imagens por dia</strong>. Para manter o serviço totalmente gratuito, incluindo processamento em lote super-rápido (até 10 arquivos de uma vez), geração de metadados com IA e exportação para CSV. Observe que recursos avançados como Incorporação Automática de Metadados, Exportação para Excel e Verificações de Direitos Autorais não estão incluídos neste plano.",
                "plan_details_pro": "Plano Pro - Para Profissionais",
                "plan_details_pro_p1": "O Plano Pro foi criado para colaboradores regulares que desejam maximizar seu fluxo de trabalho e economizar horas de tempo. Com um limite generoso de <strong>70 imagens por dia</strong>, você não precisa mais trazer suas próprias chaves de API — nós gerenciamos todas as solicitações de IA com segurança do nosso lado. Este plano desbloqueia ferramentas poderosas como a <strong>Incorporação Automática de Metadados</strong> diretamente em seus arquivos JPEG/PNG/SVG, Reordenação de Palavras-chave do tipo Arrastar e Soltar, Verificação de Direitos Autorais/Marcas com IA e exportação para Excel. Ele também aumenta seu limite de processamento em lote para 100 arquivos de uma vez e oferece uma experiência totalmente sem anúncios.",
                "plan_details_premium": "Plano Premium - Para usuários avançados e agências",
                "plan_details_premium_p1": "Projetado para criadores de alto volume, artistas de vetores e agências, o Plano Premium oferece um limite massivo de <strong>100 imagens por dia</strong> e um limite de lote de 300 arquivos. Inclui tudo do plano Pro, além de recursos avançados de automação. Você obtém acesso exclusivo à <strong>Conversão Direta de Vetores/EPS</strong> (sem necessidade de chaves ConvertAPI de terceiros) e ao recurso de <strong>Upload Automático via FTP/SFTP</strong>. Isso permite que você distribua automaticamente seus arquivos e metadados processados para diversas agências de banco de imagens (Shutterstock, Adobe Stock, Magnific, etc.) direto do seu navegador.",
                "htu_step1_title": "1. Fazer upload de arquivos",
                "htu_step1_desc": "Arraste e solte imagens (JPG/PNG), vetores (SVG/EPS) ou vídeos para começar.",
                "htu_step2_title": "2. Plataforma de Destino",
                "htu_step2_desc": "Selecione Shutterstock, Adobe Stock ou Magnific para resultados otimizados.",
                "htu_step3_title": "3. Selecionar Modelo de IA",
                "htu_step3_desc": "Escolha entre Gemini, Mistral ou Groq para a análise das imagens.",
                "htu_step4_title": "4. Personalização",
                "htu_step4_desc": "Ajuste as palavras mínimas/máximas para títulos e palavras-chave usando os controles deslizantes.",
                "htu_step5_title": "5. Configurações de IA",
                "htu_step5_desc": "Ative o Modo Vetorial, Fundo Branco ou use seus próprios Prompts Personalizados.",
                "htu_step6_title": "6. Gerar Metadados",
                "htu_step6_desc": "Clique em 'Processar Selecionados' para obter títulos e tags prontos para SEO instantaneamente.",
                "htu_step7_title": "7. Incorporar Metadados",
                "htu_step7_desc": "Escreva metadados diretamente em seus arquivos JPG, PNG ou SVG.",
                "htu_step8_title": "8. Tradução Múltipla",
                "htu_step8_desc": "Traduza os metadados para mais de 10 idiomas para o mercado global.",
                "htu_step9_title": "9. Exportar Resultados",
                "htu_step9_desc": "Baixe todos os seus metadados em CSV ou planilhas profissionais do Excel.",
                "htu_step10_title": "10. Salvar e Drive",
                "htu_step10_desc": "Salve em uma pasta local, compartilhe via link ou faça o upload direto para o Google Drive.",
                master_stock_subtitle1: 'Como usar o MetaGen Pro',
                master_stock_p1: 'Começar a usar o MetaGen Pro é incrivelmente simples e não requer conhecimentos técnicos. Primeiro, carregue as suas imagens arrastando-as e soltando-as na área de upload designada, ou clique para navegar pelos seus ficheiros. O MetaGen Pro suporta todos os principais formatos de imagem, incluindo JPG, PNG, SVG e EPS, bem como ficheiros de vídeo. Assim que as suas imagens forem carregadas, selecione a sua plataforma alvo (Shutterstock, Adobe Stock, Magnific ou Geral) para otimizar os metadados especificamente para esse mercado.',
                master_stock_p2: 'Em seguida, configure as suas preferências nas configurações da barra lateral. Pode ajustar o número de palavras-chave (recomendamos 35-50 para um SEO ideal), definir limites de comprimento de título e ativar recursos especiais como o Modo Vetor para ilustrações ou a detecção de Fundo Branco para imagens de produtos. A seleção do fornecedor de IA permite escolher entre os modelos Google Gemini, Mistral AI ou Groq Llama com base na disponibilidade da sua API e preferências de velocidade.',
                master_stock_p3: 'Após a configuração, clique no botão "Processar Tudo" para gerar metadados para todas as imagens carregadas simultaneamente. A nossa IA avançada analisa o conteúdo visual, a composição, as cores, os assuntos e o contexto de cada imagem para criar títulos, descrições e conjuntos de palavras-chave altamente relevantes. Todo o processo leva geralmente apenas alguns segundos por imagem, mesmo ao processar centenas de ficheiros em modo lote.',
                master_stock_subtitle2: 'Benefícios de usar esta ferramenta',
                master_stock_benefit1: '<strong>Eficiência de Tempo:</strong> A atribuição de palavras-chave manual pode levar de 10 a 15 minutos por imagem. O MetaGen Pro reduz isto para meros segundos, permitindo-lhe colocar palavras-chave em centenas de imagens no tempo que levaria a processar manualmente apenas algumas. Para colaboradores profissionais que carregam 50-100 imagens semanalmente, isto traduz-se numa poupança de mais de 10 horas por semana.',
                master_stock_benefit2: '<strong>Otimização de SEO:</strong> A nossa IA não descreve apenas o que vê — ela entende a intenção de pesquisa e os algoritmos do mercado. Cada conjunto de metadados inclui uma mistura estratégica de palavras-chave amplas (alto volume de pesquisa), palavras-chave específicas de cauda longa (alta conversão) e termos de tendência (procura atual). O medidor de SEO Score integrado avalia os seus metadados em tempo real, garantindo que cada upload seja otimizado para a máxima visibilidade.',
                master_stock_benefit3: '<strong>Suporte Multi-plataforma:</strong> Diferentes agências de stock têm diferentes requisitos e preferências. O MetaGen Pro adapta-se ao algoritmo único de cada plataforma — a Shutterstock prefere estruturas de palavras-chave diferentes da Adobe Stock ou da Magnific. A nossa otimização específica da plataforma garante que as suas imagens tenham uma boa classificação onde quer que as carregue.',
                master_stock_benefit4: '<strong>Consistência e Qualidade:</strong> Elimine o erro humano e mantenha padrões profissionais em todo o seu portfólio. O MetaGen Pro garante que cada imagem tenha metadados formatados corretamente, quantidade adequada de palavras-chave e descrições apropriadas. O recurso Preditores de Rejeição analisa os seus metadados em relação aos critérios comuns de rejeição, ajudando-o a evitar falhas de submissão dispendiosas.',
                master_stock_subtitle3: 'O que é SEO de imagem e por que é importante',
                master_stock_seo_p1: 'SEO de imagem (Search Engine Optimization) é a prática de otimizar metadados de imagem para melhorar a visibilidade nos resultados de pesquisa em plataformas de fotografia de stock e motores de busca. Quando um comprador pesquisa "reunião de negócios" ou "pôr do sol em praia tropical", o algoritmo da plataforma não "vê" a sua imagem — ele lê os metadados que você forneceu. Um SEO de imagem eficaz é a diferença entre o seu trabalho aparecer na página 1 versus na página 50 dos resultados de pesquisa.',
                master_stock_seo_p2: '<strong>Os Três Pilares do SEO de Imagem:</strong> Primeiro, o <em>Título</em> deve ser descritivo, mas conciso (10-20 palavras), contendo as suas palavras-chave primárias e mantendo-se natural e legível. Segundo, a <em>Descrição</em> fornece contexto e casos de uso (30-50 palavras), ajudando algoritmos e compradores a entender as aplicações comerciais da sua imagem. Terceiro, as <em>Palavras-chave</em> lançam uma rede ampla (35-50 termos recomendados), capturando várias consultas de pesquisa que podem levar os compradores à sua imagem.',
                master_stock_seo_p3: '<strong>A Estratégia de Palavras-chave Importa:</strong> Os metadados mais eficazes usam uma mistura equilibrada: 20-30% de palavras-chave de uma única palavra (alcance amplo), 40-50% de frases de duas palavras (especificidade média) e 20-30% de palavras-chave de cauda longa (alta conversão). Por exemplo, uma imagem de mãos a usar um smartphone deve incluir "mãos" (amplo), "interação com smartphone" (médio) e "mãos a tocar na interface de aplicação móvel" (cauda longa). Esta estratégia maximiza as chances de a sua imagem aparecer em pesquisas amplas e específicas.',
                master_stock_seo_p4: '<strong>Fatores de Classificação de Pesquisa:</strong> As plataformas de stock consideram múltiplos fatores ao classificar os resultados de pesquisa. A relevância (quão bem os seus metadados correspondem à consulta de pesquisa), a integridade (ter todos os campos de metadatos preenchidos corretamente) e a diversidade de palavras-chave (usar termos variados e relacionados) afetam a sua classificação. Além disso, a relevância comercial — descrever como os compradores podem usar a sua imagem — afeta significativamente as taxas de conversão, mesmo quando a sua imagem tem uma boa classificação.',
                master_stock_seo_p5: 'O MetaGen Pro automatiza todas estas melhores práticas, garantindo que cada imagem que você carrega esteja totalmente otimizada para máxima visibilidade, downloads e, consequentemente, lucro. Quer seja um colaborador amador ou um fotógrafo de stock a tempo inteiro, o SEO de imagem adequado é inegociável no mercado competitivo de hoje.',
                master_stock_cta: '<strong>Pronto para impulsionar o seu sucesso na fotografia de stock?</strong> Comece a usar o MetaGen Pro hoje e transforme horas de atribuição de palavras-chave cansativa em segundos de excelência automatizada.',
                trusted_stock_subtitle: 'Descubra por que milhares de fotógrafos e criadores americanos confiam no MetaGen Pro para aumentar a sua receita de stock',
                review_1_details: '📍 Nova Iorque, NY • Fotógrafa Profissional',
                review_1_text: '"O MetaGen Pro transformou completamente o meu fluxo de trabalho! Eu costumava passar horas a colocar palavras-chave nas minhas fotos para a Shutterstock. Agora leva apenas minutos e os meus downloads aumentaram 40%. O recurso de SEO score é brilhante!"',
                review_2_details: '📍 Los Angeles, CA • Criador de Conteúdo',
                review_2_text: '"Como criador de conteúdo a tempo inteiro, tempo é dinheiro. Esta ferramenta poupa-me pelo menos 10 horas por semana na inserção de metadados. O processamento em lote é rápido como um relâmpago e as palavras-chave geradas por IA são precisas. O melhor investimento que fiz este ano!"',
                review_3_details: '📍 Miami, FL • Colaborador de Stock',
                review_3_text: '"Eu estava cético ao início, mas o MetaGen Pro superou todas as expectativas. As sugestões de palavras-chave são incrivelmente relevantes e o recurso multi-idioma ajudou-me a chegar a compradores internacionais. Os meus ganhos no Adobe Stock duplicaram em apenas 3 meses!"',
                review_4_details: '📍 Chicago, IL • Designer Gráfico',
                review_4_text: '"Só o recurso de verificação de direitos de autor já vale o preço! Salvou-me de possíveis rejeições várias vezes. Combinado com a geração automatizada de metadados, esta ferramenta é essencial para quem leva a sério a fotografia de stock."',
                review_5_details: '📍 Seattle, WA • Fotógrafa de Natureza',
                review_5_text: '"Eu carrego centenas de fotos de natureza todos os meses. O MetaGen Pro torna fácil gerir e otimizar todas elas. O recurso de exportação CSV integra-se perfeitamente com o meu fluxo de trabalho. Recomendo vivamente a outros colaboradores!"',
                review_6_details: '📍 Austin, TX • Videógrafo Freelancer',
                review_6_text: '"Uma revolução para metadados de vídeo! A IA identifica com precisão as cenas e gera títulos perfeitos. A visibilidade do meu portfólio de vídeos na Shutterstock melhorou drasticamente. A equipa de suporte também é extremamente rápida e prestável."',
                stat_users: 'Utilizadores Ativos nos EUA',
                stat_satisfaction: 'Taxa de Satisfação',
                stat_images: 'Imagens Otimizadas Diariamente',
                stat_rating: 'Avaliação Média',
                "faq_title": "Perguntas Frequentes — MetaGen Pro",
                "faq_q1": "🚀 Como começo a usar o MetaGen Pro?",
                "faq_a1": "<strong>Passo 1:</strong> Cadastre-se ou faça login com Google ou e-mail.<br><strong>Passo 2:</strong> Configure sua chave API do Google Gemini em Ajustes (obtenha uma grátis no <a href='https://aistudio.google.com/app/apikey' target='_blank'>Google AI Studio</a>).<br><strong>Passo 3:</strong> Envie suas imagens (JPG, PNG, SVG, EPS) - até 500 arquivos de uma vez!<br><strong>Passo 4:</strong> Selecione sua plataforma (Shutterstock, Adobe Stock, etc.) e clique em 'Generate Metadata'.<br><strong>Passo 5:</strong> Revise, edite se necessário, incorpore os metadados e baixe!",
                "faq_q2": "💰 O MetaGen Pro é gratuito? Qual o preço?",
                "faq_a2": "<p><strong>Planos gratuitos para todos!</strong> O Metagen Pro oferece um plano gratuito robusto (120 imagens/mês, máximo de 25 por dia). No entanto, para uma utilização intensa, temos os planos <strong>Pro</strong> (12 dólares/mês - 2000 imagens/mês, máximo de 70 por dia) e <strong>Premium</strong> (29 dólares/mês - 3000 imagens/mês, máximo de 100 por dia). Os planos pagos oferecem funcionalidades avançadas, como a incorporação automática de metadados, a exportação para Excel e o carregamento direto via FTP.</p>",
                "faq_q3": "🔑 Como obtenho as chaves API? São seguras?",
                "faq_a3": "<p><strong>Não, não é necessária nenhuma chave API para qualquer plano agora!</strong> Em todos os planos, Gratuito, Pro e Premium, processamos metadados utilizando os nossos próprios servidores e modelos de IA dedicados do Supabase Edge Functions (modelos de IA avançados).</p><p><strong>Segurança:</strong> Todos os seus dados estão completamente <strong>seguros</strong> e são eliminados do servidor imediatamente após o processamento.</p>",
                "faq_q4": "📁 Quais formatos de arquivo são suportados?",
                "faq_a4": "<p><strong>Formatos:</strong> JPG/JPEG (com EXIF), PNG, SVG (com XMP) e EPS (via ConvertAPI).</p><p>Envie até <strong>500 arquivos simultâneos</strong>!</p>",
                "faq_q5": "🎯 Quais plataformas de stock são suportadas?",
                "faq_a5": "<p>Otimizado para: Shutterstock, Adobe Stock, Magnific, Vecteezy, Pond5, 123RF, iStock e mais. A IA adapta-se automaticamente aos requisitos de cada site!</p>",
                "faq_q6": "📊 O que é o SEO Score e os selos de palavras-chave?",
                "faq_a6": "<p><strong>SEO Score:</strong> Mede a otimização para busca.</p><p><strong>Selos:</strong></p><ul><li>🟢 <strong>Verde:</strong> Uma palavra</li><li>🟡 <strong>Amarelo:</strong> Duas palavras</li><li>🔵 <strong>Azul:</strong> 3+ palavras (Long-tail)</li></ul>",
                "faq_q7": "⚡ Como funciona o processamento em lote?",
                "faq_a7": "<p>Envie até 500 imagens e clique em 'Process Selected'. Nossa IA processa tudo em paralelo. É super rápido!</p>",
                "faq_q8": "🎨 O que é a função 'Image to Prompt'?",
                "faq_a8": "<p>Converte sua imagem em um prompt detalhado para Midjourney ou DALL-E. Perfeito para analisar imagens de sucesso!</p>",
                "faq_q9": "🔒 Meus dados são privados? Vocês guardam minhas imagens?",
                "faq_a9": "<p><strong>100% Privado!</strong> O processamento ocorre no navegador. NUNCA guardamos suas imagens. Os dados são apagados após o uso.</p>",
                "faq_q10": "🔧 Solução de problemas comuns",
                "faq_a10": "<ul><li><strong>Erro de API:</strong> Verifique a chave em Ajustes.</li><li><strong>Arquivo grande:</strong> Use menos de 20MB.</li><li><strong>Lentidão:</strong> Feche outras abas.</li></ul>",
                "faq_q11": "🎭 Como funciona o gerador de imagens IA?",
                "faq_a11": "<p>Use modelos FLUX para criar imagens. Configure sua chave Together AI e gere imagens exclusivas para seu portfólio!</p>",
                "faq_q12": "💬 Como obtenho ajuda?",
                "faq_a12": "<p>E-mail: <strong>metagenp@gmail.com</strong> ou use o botão Feedback. Respondemos em até 12 horas!</p>"
            },

            id: {
                flag: '🇮🇩',
                name: 'ID',
                band: 'MetaGen Pro',
                tagline: 'Metadata, Didukung oleh AI',
                home: 'Beranda',
                features: 'Fitur',
                start_tour: 'Mulai Tur',
                faq: 'FAQ',
                menu: 'MENU',
                blog: 'Postingan Blog',
                disclaimer: 'Penyangkalan',
                about: 'Tentang Kami',
                contact: 'Hubungi Kami',
                legal: 'Legal',
                select_lang: 'Pilih Bahasa',
                general_btn: "Umum",
                save_key: 'Simpan',
                close: 'Tutup',
                get_key: 'Dapatkan kunci',
                badge: 'Lencana',
                try_metagen: 'Coba MetaGen Gratis',
                no_api: 'Tidak diperlukan Kunci API untuk uji coba gratis Anda.',
                watting_for: 'Apa yang kamu tunggu?',
                "get_start": "Mulai Gratis",
                "drag_and_drop": "Seret dan lepas ke mana saja untuk mengunggah",
                "fast": "Cepat",
                "best": "Terbaik",
                "generate_meta": "Hasilkan Metadata",
                "delete_select": "Hapus Terpilih",
                "down_select": "Unduh Terpilih",
                "translate_select": "Terjemahkan Terpilih",
                "done": "Selesai",
                "processing": "Memproses",
                "analyzing_market": "Menganalisis Tren Pasar...",
                "ai_is_researching": "AI sedang meneliti konsep berkinerja tinggi untuk Anda.",
                "analyzing": "Menganalisis...",
                "copy_tag": "Salin Tag",
                "copy_idea": "Salin Ide & Info",
                "download": "Unduh",
                "enter_your_convert_api": "Masukkan kunci API Convert Anda untuk mengaktifkan konversi file EPS.",
                "export_csv": "Ekspor CSV",
                "export_excel": "Ekspor Excel",
                "niche_research_cen": "Pusat Riset Niche",
                "niche_research_tag": "Temukan kata kunci dan konsep dengan permintaan tinggi dan persaingan rendah untuk portofolio stok Anda.",
                "select_category": "Pilih Kategori",
                "market_focus": "Fokus Pasar",
                "analyze_trend": "Analisis Tren",
                "ready_to_research": "Siap untuk Riset",
                "ready_to_research_tag": "Pilih kategori di atas dan klik \"Analisis Tren\" untuk mengungkap niche yang menguntungkan.",
                "quick_suggest": "Saran Cepat",
                "label_title": "Judul",
                "label_desc": "Deskripsi",
                "label_keywords": "Kata Kunci",
                "btn_copy": "Salin",
                "btn_add": "Tambah",
                "placeholder_add_kw": "Tambah kata kunci...",
                "seo_score": "Skor SEO",
                "rejection": "Penolakan",
                "platform_check": "Cek Platform",
                "style": "Gaya",
                "mode": "Mode",
                "translate": "Terjemahkan",
                "go": "Lanjut",
                "min_title": "Min Kata Judul",
                "max_title": "Maks Kata Judul",
                "min_keywords": "Min Kata Kunci",
                "max_keywords": "Maks Kata Kunci",
                "min_desc": "Min Kata Deskripsi",
                "max_desc": "Maks Kata Deskripsi",
                "toggle_silhouette": "Siluet",
                "toggle_vector": "Vektor / Mode Ilustrasi",
                "toggle_white_bg": "Latar Belakang Putih",
                "toggle_trans_bg": "Latar Belakang Transparan",
                "toggle_custom_prompt": "Prompt Khusus",
                "toggle_prohibited": "Kata-kata Terlarang",
                "toggle_single_kw": "Kata Kunci Satu Kata",
                "toggle_change_name": "Ubah Nama File",
                "toggle_name_title": "Nama File sebagai Judul",
                "feedback_matters": "Umpan balik Anda penting",
                "provide_feedback": "Silakan berikan umpan balik tentang alat ini?",
                "issue_type": "Jenis Masalah",
                "general_feedback": "Umpan balik umum",
                "bug_report": "Laporan bug",
                "feature_request": "Permintaan fitur",
                "your_mess": "Pesan Anda",
                "send_feed": "Kirim umpan balik",
                eps_meta: 'Buat & Sematkan Metadata EPS',
                month: '/ bulan',
                pricing: 'Harga',
                ftp_upload: 'Unggah Langsung FTP',
                ftp_upload_sub_txt: 'Unggah file langsung ke situs stok (Adobe Stock, Shutterstock, Magnific).',
                upgrade_plan: 'Tingkatkan Paket',
                stock_calendar: 'Kalender Stok',
                get_access: 'Dapatkan akses',
                pricing_plan: 'Paket Harga Kami',
                pricing_sub_txt: 'Pilih paket sempurna untuk alur kerja kreatif Anda.',
                free_plan: 'Paket Gratis',
                free_price: '$0/bulan',
                most_popular: 'Paling Populer',
                pro_plan: 'Tingkatkan ke Pro',
                pro_price: '$12/bulan',
                premium_plan: 'Paket Premium',
                premium_price: '$29/bulan',
                '50_image': '120 gambar per bulan (maksimum 10 per hari untuk penggunaan wajar)',
                basic_ai_model: 'Model AI dasar (Gemini, Mistral, Groq) Gunakan kunci API Anda sendiri.',
                batch_process: 'Proses batch: hingga 50 file',
                csv_export: 'Ekspor CSV',
                ads_support: 'Didukung Iklan',
                auto_embed: 'Semat Otomatis Metadata',
                excel_export: 'Ekspor Excel',
                drag_keyword: 'Seret & Lepas Susun Ulang Kata Kunci',
                copy_trade_check: 'Pemeriksaan Hak Cipta/Merek Dagang',
                get_started_free: 'Mulai Gratis',
                '300_images': '2000 gambar/bulan',
                advance_ai: 'Model AI lanjutan (Kunci API tidak diperlukan).',
                batch_process_pro: 'Proses batch: hingga 100 file',
                csv_excel_ex: 'Ekspor CSV/Excel',
                seo_and_no_ads: 'Analitik SEO & Tanpa Iklan',
                support_time: 'Waktu dukungan 24 jam',
                '1k_image': '3000 gambar/bulan',
                all_pro: 'Semua Fitur Pro',
                batch_process_pre: 'Proses batch: hingga 300 file',
                ftp_auto_up: 'Unggah Otomatis FTP/SFTP',
                vector_eps: 'Konversi Vektor/EPS Langsung',
                vip_support: 'Dukungan VIP & Akses Awal',
                privacy_policy: 'Kebijakan Privasi',
                terms_of_service: 'Ketentuan Layanan',
                adjustment: 'Penyesuaian',
                multi_tool: 'Alat Multi Gambar',
                sketch_art: 'Gambar ke Seni Sketsa',
                all_tools: 'Semua Alat',
                image_enhance: 'Peningkat Gambar AI',
                bg_remove: 'Penghapus Latar Belakang AI',
                pixel_check: 'Studio Pixel-Check',
                text_to_image: 'Generator Teks ke Gambar',
                company: 'Perusahaan',
                free_plan: 'Paket Gratis',
                note: 'Akses API akan dihapus dalam 7 hari. Tingkatkan ke paket Pro/Premium dan gunakan semua fitur MetaGen Pro.',
                platform: 'Platform',
                add_more: 'Tambah File Lain',
                well_come: 'Selamat Datang Kembali',
                login_google: 'Lanjutkan dengan Google',
                new_user: 'Pengguna baru?',
                create_account: 'Buat akun',
                niche_research: 'Riset Niche',
                metadata_generator: 'Generator Metadata',
                seo_score: 'Skor SEO & Analitik',
                batch_process: 'Proses Batch Super Cepat',
                sign_out: 'Keluar',
                switch_account: 'Ganti akun',
                upload_title: 'Unggah Gambar atau Video',
                drag_drop: 'Seret & lepas file di sini atau klik untuk mengunggah',
                supports: 'Mendukung JPG, PNG, WEBP, MP4, MOV',
                max_size: 'Maks 50MB per file',
                privacy_note: 'File Anda diproses dengan aman dan dihapus setelah 1 jam.',
                privacy_note_device: 'Kami menganalisis file hanya di perangkat, data dihapus setelah pemrosesan.',
                upload_limit_info: 'Paket Gratis: 50 file/hari',
                usage: 'Penggunaan:',
                "daily_limit": "Batas Proses Harian",
                refer_text: 'Bagikan MetaGen Pro untuk mendapatkan +50 batas harian tambahan!',
                "share_get_credit": "Bagikan & Dapatkan Kredit",
                generate_metadata: 'Hasilkan Metadata',
                "limit_reached_msg": "Anda telah mencapai batas pemrosesan harian Anda! Tingkatkan paket Anda untuk batas yang lebih tinggi atau bagikan alat ini untuk mendapatkan bonus.",
                export_csv: 'Ekspor ke CSV',
                export_excel: 'Ekspor ke Excel',
                clear_all: 'Hapus Semua',
                copy_all: 'Salin Semua',
                down_eps: 'Unduh EPS',
                guides: 'Panduan',
                title: 'Judul',
                description: 'Deskripsi',
                keywords: 'Kata Kunci',
                categories: 'Kategori',
                already_user: 'Sudah punya akun?',
                login: 'Masuk',
                tools_generator: 'Alat & Generator',
                trending: '📅 Sedang Tren...',
                customization: 'Kustomisasi',
                settings: 'Pengaturan',
                select_ai: 'Pilih Penyedia AI',
                manage_api: 'Kelola Kunci API',
                convert_api: 'Kunci ConvertAPI',
                translation_lang: 'Bahasa Terjemahan',
                upload_files: 'Unggah File',
                watch_demo: 'Tonton Demo',
                watch_tagline: 'Lihat cara meningkatkan penjualan stok Anda dalam hitungan detik',
                process_selected: 'Proses Terpilih',
                process_prompts: 'Proses Prompt',
                embed_metadata: 'Sematkan Metadata',
                export: 'Ekspor',
                batch_translate: 'Terjemahan Batch (Gratis)',
                translate_all: 'Terjemahkan Semua (API)',
                test_metadata: 'Uji Metadata',
                save_folder: 'Simpan ke Folder',
                share_files: 'Bagikan File',
                upload_drive: 'Unggah ke Drive',
                pause: 'Jeda',
                image_to_prompt: 'Gambar ke Prompt',
                jpg_png: 'JPG/PNG',
                svg_eps: 'SVG/EPS/AI',
                videos: 'Video',
                check_copyright: 'Periksa Hak Cipta/Merek Dagang:',
                upload_limit: 'Unggah maksimal 500 file dalam satu tindakan',
                resume: 'Lanjutkan',
                send_feedback: 'Kirim Masukan / Laporan Bug',
                view_translated: 'Lihat Terjemahan',
                view_original: 'Lihat Asli',
                analyze_trends: 'Analisis Tren',
                downloading: 'Mengunduh...',
                translating: 'Menerjemahkan...',
                embedding: 'Menyematkan...',
                analyzing: 'Menganalisis...',
                processing: 'Memproses...',
                process: 'Proses',
                files: 'File',
                prompts: 'Prompt',
                complete: 'Selesai',
                success: 'Berhasil',
                fail: 'Gagal',
                saving: 'Menyimpan...',
                preparing: 'Menyiapkan...',
                uploading: 'Mengunggah...',
                initializing: 'Menginisialisasi koneksi...',
                processing_files: 'Memproses File...',
                "hero_title": "Generator Metadata AI Gratis & Kata Kunci Stok Foto!",
                hero_tagline: 'Tingkatkan visibilitas Anda di Shutterstock, Adobe Stock, dan Magnific. Hasilkan judul, deskripsi, dan kata kunci yang dioptimalkan SEO dalam hitungan detik menggunakan AI canggih.',
                why_choose: 'Mengapa Memilih MetaGen Pro?',
                blog_1: 'Pemrosesan Batch Super Cepat',
                blog_tag_1: 'Analisis dan beri kata kunci ratusan gambar dalam hitungan detik. Hemat jam kerja manual dengan mesin batch kami yang optimal.',
                blog_2: 'Analisis AI Canggih',
                blog_tag_2: 'Didukung oleh Gemini 1.5 Pro, Mistral & Llama 3 untuk pengenalan gambar terkemuka di industri dan metadata yang akurat.',
                blog_3: 'Kata Kunci yang Dioptimalkan SEO',
                blog_tag_3: 'Hasilkan judul dan tag peringkat tinggi yang disesuaikan khusus untuk algoritma Shutterstock, Adobe Stock & Magnific.',
                blog_4: 'Riset Niche',
                blog_tag_4: 'Temukan topik dengan persaingan rendah dan permintaan tinggi dengan alat Riset Niche bawaan kami. Temukan apa yang dicari pembeli.',
                blog_5: 'Pemesanan Ulang Kata Kunci Seret & Lepas',
                blog_tag_5: 'Di situs stok (Adobe Stock, Shutterstock), 5-10 kata kunci pertama adalah yang paling penting.',
                blog_6: 'Penyematan Metadata',
                blog_tag_6: 'Sematkan judul dan kata kunci langsung ke file JPG/PNG/SVG Anda (IPTC/XMP). Cukup unduh dan unggah ke agensi stok mana pun.',
                blog_7: 'Multi-Bahasa',
                blog_tag_7: 'Terjemahkan metadata Anda ke 10+ bahasa secara instan. Jangkau audiens global dengan judul dan deskripsi yang dilokalkan.',
                blog_8: 'Pemeriksaan Hak Cipta',
                blog_tag_8: 'Hindari penolakan! AI kami memindai potensi masalah merek dagang dan logo di gambar Anda sebelum Anda mengunggahnya.',
                blog_9: 'Ekspor Metadata CSV',
                blog_tag_9: 'Fasilitas ekspor file CSV untuk semua situs stok (Adobe Stock, Shutterstock, Magnific).',
                trusted_all: 'Terpercaya untuk Semua Platform Microstock Utama',
                it_works: 'Cara Kerjanya',
                upload_photos: 'Unggah Foto',
                upload_photos_tag: 'Seret & lepas file JPG/PNG Anda. Kami secara otomatis membaca dimensi dan spesifikasi teknis.',
                select_platfrom: 'Pilih Platform & AI',
                select_platfrom_tag: 'Pilih target pasar Anda (misalnya Adobe Stock) dan model AI pilihan (Gemini/Groq).',
                gen_down: 'Hasilkan & Unduh',
                gen_down_tag: 'Dapatkan judul & kata kunci siap SEO secara instan. Unduh CSV atau Sematkan secara langsung.',
                why_choose_stock_title: 'Mengapa Memilih MetaGen Pro untuk Fotografi Stok?',
                how_to_use_title: 'Cara Menggunakan Alat?',
                master_stock_title: 'Kuasai Fotografi Stok Anda dengan Metadata Bertenaga AI',
                trusted_stock_title: 'Dipercaya oleh Kontributor Stok di Seluruh Amerika Serikat',
                why_choose_stock_p1: 'Dalam dunia fotografi stok yang kompetitif, ketertemukan (discoverability) adalah kunci. Bahkan gambar terbaik pun tidak akan laku jika pembeli tidak dapat menemukannya. <strong>MetaGen Pro</strong> adalah <em>Generator Metadata AI</em> terbaik yang dirancang untuk memecahkan masalah ini.',
                why_choose_stock_p2: 'Berbeda dengan pemberian kata kunci manual yang membosankan dan rentan kesalahan, alat kami menggunakan visi komputer tercanggih untuk menganalisis subjek, suasana, pencahayaan, dan komposisi gambar Anda. Alat ini kemudian menghasilkan 50+ kata kunci yang dioptimalkan, judul yang menarik, dan deskripsi mendalam yang disesuaikan untuk platform seperti <strong>Shutterstock, Adobe Stock, Magnific, dan Vecteezy</strong>.',
                why_choose_stock_p3: 'Baik Anda seorang fotografer, ilustrator, atau seniman AI, MetaGen Pro merampingkan alur kerja Anda. Fitur seperti <strong>Gambar-ke-Prompt</strong> membantu Anda merekayasa balik gambar AI yang sukses, sementara <strong>Prediktor Penolakan</strong> kami membantu Anda memperbaiki masalah teknis sebelum diunggah.',
                why_choose_stock_p4: 'Mulailah memaksimalkan pendapatan pasif Anda hari ini dengan penanda foto stok gratis tercanggih yang tersedia.',
                "plan_details_title": "Paket Mana yang Tepat untuk Anda?",
                "plan_details_free": "Paket Gratis - Terbaik untuk Pemula",
                "plan_details_free_p1": "Paket Gratis kami dirancang untuk penghobi dan kontributor stok baru. Ini memungkinkan Anda untuk memproses hingga <strong>10 gambar per hari</strong>. Agar layanan tetap gratis sepenuhnya, Anda mendapatkan akses ke fitur inti kami termasuk pemrosesan batch super cepat (hingga 10 file sekaligus), pembuatan metadata AI, dan ekspor CSV. Harap dicatat bahwa fitur lanjutan seperti Penyematan Otomatis Metadata, Ekspor Excel, dan Pemeriksaan Hak Cipta tidak termasuk dalam paket ini.",
                "plan_details_pro": "Paket Pro - Untuk Profesional",
                "plan_details_pro_p1": "Paket Pro dibuat untuk kontributor reguler yang ingin memaksimalkan alur kerja mereka dan menghemat waktu berjam-jam. Dengan batas besar <strong>70 gambar per hari</strong>, Anda tidak perlu lagi membawa kunci API Anda sendiri—kami menangani semua permintaan AI dengan aman di pihak kami. Paket ini membuka alat canggih seperti <strong>Penyematan Otomatis Metadata</strong> langsung ke file JPEG/PNG/SVG Anda, Mengatur Ulang Kata Kunci dengan Seret & Lepas, pemeriksaan Hak Cipta/Merek Dagang AI, dan ekspor Excel. Ini juga meningkatkan batas pemrosesan batch Anda menjadi 100 file sekaligus dan menawarkan pengalaman yang benar-benar bebas iklan.",
                "plan_details_premium": "Paket Premium - Untuk Pengguna Berat & Agensi",
                "plan_details_premium_p1": "Dirancang untuk kreator bervolume tinggi, seniman vektor, dan agensi, Paket Premium menawarkan batas masif sebesar <strong>100 gambar per hari</strong> dan batas batch 300 file. Ini mencakup semua yang ada di paket Pro, ditambah fitur otomatisasi tingkat lanjut. Anda mendapatkan akses eksklusif ke <strong>Konversi Vektor/EPS Langsung</strong> (tidak perlu kunci ConvertAPI pihak ke-3) dan fitur <strong>Unggah Otomatis FTP/SFTP</strong>. Ini memungkinkan Anda untuk mendistribusikan file dan metadata yang diproses secara otomatis langsung ke berbagai agensi stok (Shutterstock, Adobe Stock, Magnific, dll.) langsung dari browser Anda.",
                "htu_step1_title": "1. Unggah File",
                "htu_step1_desc": "Seret & lepas gambar (JPG/PNG), vektor (SVG/EPS), atau video untuk memulai.",
                "htu_step2_title": "2. Platform Target",
                "htu_step2_desc": "Pilih Shutterstock, Adobe Stock, atau Magnific untuk hasil yang dioptimalkan.",
                "htu_step3_title": "3. Pilih Model AI",
                "htu_step3_desc": "Pilih antara Gemini, Mistral, atau Groq untuk analisis gambar.",
                "htu_step4_title": "4. Kustomisasi",
                "htu_step4_desc": "Sesuaikan batas Min/Maks kata untuk judul dan kata kunci menggunakan penggeser.",
                "htu_step5_title": "5. Pengaturan AI",
                "htu_step5_desc": "Aktifkan Mode Vektor, Background Putih, atau gunakan Prompt Kustom Anda sendiri.",
                "htu_step6_title": "6. Buat Metadata",
                "htu_step6_desc": "Klik 'Proses yang Dipilih' untuk langsung mendapatkan judul dan tag yang siap untuk SEO.",
                "htu_step7_title": "7. Sematkan Metadata",
                "htu_step7_desc": "Tulis metadata secara langsung ke dalam file JPG, PNG, atau SVG Anda.",
                "htu_step8_title": "8. Multi-Terjemahan",
                "htu_step8_desc": "Terjemahkan metadata ke 10+ bahasa untuk pasar global.",
                "htu_step9_title": "9. Ekspor Hasil",
                "htu_step9_desc": "Unduh semua metadata Anda sebagai CSV atau lembar Excel profesional.",
                "htu_step10_title": "10. Simpan & Drive",
                "htu_step10_desc": "Simpan ke folder lokal, bagikan melalui tautan, atau unggah langsung ke Drive.",
                master_stock_subtitle1: 'Cara Menggunakan MetaGen Pro',
                master_stock_p1: 'Memulai dengan MetaGen Pro sangatlah sederhana dan tidak memerlukan keahlian teknis. Pertama, unggah gambar Anda dengan menyeret dan meletakkannya ke area unggah yang ditentukan, atau klik untuk menelusuri file Anda. MetaGen Pro mendukung semua format gambar utama termasuk JPG, PNG, SVG, dan EPS, serta file video. Setelah gambar Anda diunggah, pilih platform target Anda (Shutterstock, Adobe Stock, Magnific, atau Umum) untuk mengoptimalkan metadata khusus untuk pasar tersebut.',
                master_stock_p2: 'Selanjutnya, konfigurasikan preferensi Anda menggunakan pengaturan sidebar. Anda dapat menyesuaikan jumlah kata kunci (kami merekomendasikan 35-50 untuk SEO optimal), menetapkan batasan panjang judul, dan mengaktifkan fitur khusus seperti Mode Vektor untuk ilustrasi atau deteksi Latar Belakang Putih untuk gambar produk. Pemilihan penyedia AI memungkinkan Anda memilih antara model Google Gemini, Mistral AI, atau Groq Llama berdasarkan ketersediaan API dan preferensi kecepatan Anda.',
                master_stock_p3: 'Setelah konfigurasi, klik tombol "Proses Semua" untuk menghasilkan metadata untuk semua gambar yang diunggah secara bersamaan. AI canggih kami menganalisis konten visual, komposisi, warna, subjek, dan konteks setiap gambar untuk membuat judul, deskripsi, dan set kata kunci yang sangat relevan. Seluruh proses biasanya hanya memakan waktu beberapa detik per gambar, bahkan saat memproses ratusan file dalam mode batch.',
                master_stock_subtitle2: 'Manfaat Menggunakan Alat Ini',
                master_stock_benefit1: '<strong>Efisiensi Waktu:</strong> Pemberian kata kunci manual dapat memakan waktu 10-15 menit per gambar. MetaGen Pro menguranginya menjadi hanya beberapa detik, memungkinkan Anda memberi kata kunci pada ratusan gambar dalam waktu yang diperlukan untuk memproses beberapa gambar secara manual. Bagi kontributor profesional yang mengunggah 50-100 gambar setiap minggu, ini berarti menghemat lebih dari 10 jam setiap minggunya.',
                master_stock_benefit2: '<strong>Optimasi SEO:</strong> AI kami tidak hanya mendeskripsikan apa yang dilihatnya—ia memahami maksud pencarian dan algoritma pasar. Setiap set metadata mencakup campuran strategis kata kunci luas (volume pencarian tinggi), kata kunci ekor panjang spesifik (konversi tinggi), dan istilah yang sedang tren (permintaan saat ini). Pengukur SEO Score bawaan mengevaluasi metadata Anda secara real-time, memastikan setiap unggahan dioptimalkan untuk visibilitas maksimum.',
                master_stock_benefit3: '<strong>Dukungan Multi-Platform:</strong> Agen stok yang berbeda memiliki persyaratan dan preferensi yang berbeda. MetaGen Pro beradaptasi dengan algoritma unik setiap platform—Shutterstock lebih menyukai struktur kata kunci yang berbeda dari Adobe Stock atau Magnific. Optimasi khusus platform kami memastikan gambar Anda berperingkat baik di mana pun Anda mengunggahnya.',
                master_stock_benefit4: '<strong>Konsistensi dan Kualitas:</strong> Hilangkan kesalahan manusia dan pertahankan standar profesional di seluruh portofolio Anda. MetaGen Pro memastikan setiap gambar memiliki metadata yang diformat dengan benar, jumlah kata kunci yang memadai, dan deskripsi yang sesuai. Fitur Prediktor Penolakan menganalisis metadata Anda terhadap kriteria penolakan umum, membantu Anda menghindari kegagalan pengiriman yang merugikan.',
                master_stock_subtitle3: 'Apa itu SEO Gambar dan Mengapa Itu Penting',
                master_stock_seo_p1: 'SEO Gambar (Search Engine Optimization) adalah praktik mengoptimalkan metadata gambar untuk meningkatkan visibilitas dalam hasil pencarian di platform fotografi stok dan mesin pencari. Ketika pembeli mencari "pertemuan bisnis" atau "matahari terbenam pantai tropis," algoritma platform tidak "melihat" gambar Anda—ia membaca metadata yang Anda berikan. SEO Gambar yang efektif adalah perbedaan antara karya Anda muncul di halaman 1 versus halaman 50 hasil pencarian.',
                master_stock_seo_p2: '<strong>Tiga Pilar SEO Gambar:</strong> Pertama, <em>Judul</em> harus deskriptif namun ringkas (10-20 kata), berisi kata kunci utama Anda dengan tetap alami dan mudah dibaca. Kedua, <em>Deskripsi</em> memberikan konteks dan kasus penggunaan (30-50 kata), membantu algoritma dan pembeli memahami aplikasi komersial gambar Anda. Ketiga, <em>Kata Kunci</em> menjangkau jaringan yang luas (disarankan 35-50 istilah), menangkap berbagai kueri pencarian yang dapat mengarahkan pembeli ke gambar Anda.',
                master_stock_seo_p3: '<strong>Strategi Kata Kunci Itu Penting:</strong> Metadata yang paling efektif menggunakan campuran yang seimbang: 20-30% kata kunci satu kata (jangkauan luas), 40-50% frasa dua kata (spesifisitas sedang), dan 20-30% kata kunci ekor panjang (konversi tinggi). Misalnya, gambar tangan yang menggunakan ponsel cerdas harus menyertakan "tangan" (luas), "interaksi ponsel cerdas" (sedang), dan "tangan mengetuk antarmuka aplikasi seluler" (ekor panjang). Strategi ini memaksimalkan peluang gambar Anda muncul di pencarian luas dan spesifik.',
                master_stock_seo_p4: '<strong>Faktor Peringkat Pencarian:</strong> Platform stok mempertimbangkan banyak faktor saat menentukan peringkat hasil pencarian. Relevansi (seberapa baik metadata Anda cocok dengan kueri pencarian), kelengkapan (semua bidang metadata terisi dengan benar), dan keragaman kata kunci (menggunakan istilah yang bervariasi dan terkait) semuanya memengaruhi peringkat Anda. Selain itu, relevansi komersial—mendeskripsikan bagaimana pembeli dapat menggunakan gambar Anda—berdampak signifikan pada tingkat konversi bahkan ketika gambar Anda berperingkat baik.',
                master_stock_seo_p5: 'MetaGen Pro mengotomatiskan semua praktik terbaik ini, memastikan setiap gambar yang Anda unggah dioptimalkan sepenuhnya untuk visibilitas maksimum, unduhan, dan pada akhirnya, penghasilan. Baik Anda kontributor hobi atau fotografer stok purna waktu, SEO Gambar yang tepat tidak dapat ditawar di pasar kompetitif saat ini.',
                master_stock_cta: '<strong>Siap meningkatkan kesuksesan fotografi stok Anda?</strong> Mulailah menggunakan MetaGen Pro hari ini dan ubah berjam-jam pemberian kata kunci yang membosankan menjadi keunggulan otomatis dalam hitungan detik.',
                trusted_stock_subtitle: 'Temukan mengapa ribuan fotografer dan kreator Amerika mengandalkan MetaGen Pro untuk meningkatkan pendapatan stok mereka',
                review_1_details: '📍 New York, NY • Fotografer Profesional',
                review_1_text: '"MetaGen Pro mengubah alur kerja saya sepenuhnya! Saya terbiasa menghabiskan waktu berjam-jam memberi kata kunci pada foto saya untuk Shutterstock. Sekarang hanya butuh beberapa menit dan unduhan saya meningkat sebesar 40%. Fitur skor SEO-nya brilian!"',
                review_2_details: '📍 Los Angeles, CA • Kreator Konten',
                review_2_text: '"Sebagai kreator konten penuh waktu, waktu adalah uang. Alat ini menghemat setidaknya 10 jam per minggu untuk entri metadata. Pemrosesan batch-nya sangat cepat dan kata kunci yang dihasilkan AI sangat tepat. Investasi terbaik yang saya buat tahun ini!"',
                review_3_details: '📍 Miami, FL • Kontributor Stok',
                review_3_text: '"Awalnya saya skeptis, tapi MetaGen Pro melampaui semua ekspektasi. Saran kata kuncinya sangat relevan dan fitur multi-bahasa membantu saya menjangkau pembeli internasional. Penghasilan Adobe Stock saya naik dua kali lipat hanya dalam 3 bulan!"',
                review_4_details: '📍 Chicago, IL • Desainer Grafis',
                review_4_text: '"Fitur cek hak cipta saja sudah sebanding dengan harganya! Ini telah menyelamatkan saya dari potensi penolakan berkali-kali. Dikombinasikan dengan pembuatan metadata otomatis, alat ini wajib dimiliki bagi siapa pun yang serius dengan fotografi stok."',
                review_5_details: '📍 Seattle, WA • Fotografer Alam',
                review_5_text: '"Saya mengunggah ratusan foto alam setiap bulan. MetaGen Pro memudahkan pengelolaan dan pengoptimalan semuanya. Fitur ekspor CSV-nya terintegrasi dengan mulus dengan alur kerja saya. Sangat direkomendasikan untuk sesama kontributor!"',
                review_6_details: '📍 Austin, TX • Videografer Lepas',
                review_6_text: '"Pengubah permainan untuk metadata video! AI secara akurat mengidentifikasi adegan dan menghasilkan judul yang sempurna. Visibilitas portofolio video Shutterstock saya meningkat drastis. Tim dukungan juga sangat responsif dan membantu."',
                stat_users: 'Pengguna Aktif AS',
                stat_satisfaction: 'Tingkat Kepuasan',
                stat_images: 'Gambar Dioptimalkan Setiap Hari',
                stat_rating: 'Peringkat Rata-rata',
                "faq_title": "Pertanyaan Umum — MetaGen Pro",
                "faq_q1": "🚀 Bagaimana cara memulai MetaGen Pro?",
                "faq_a1": "<strong>Langkah 1:</strong> Daftar atau masuk dengan akun Google atau email.<br><strong>Langkah 2:</strong> Atur kunci API Google Gemini di Pengaturan (gratis di <a href='https://aistudio.google.com/app/apikey' target='_blank'>Google AI Studio</a>).<br><strong>Langkah 3:</strong> Unggah gambar Anda (JPG, PNG, SVG, EPS) - hingga 500 file sekaligus!<br><strong>Langkah 4:</strong> Pilih platform target (Shutterstock, Adobe Stock, dll) dan klik 'Generate Metadata'.<br><strong>Langkah 5:</strong> Tinjau, edit jika perlu, tanam metadata ke file, dan unduh!",
                "faq_q2": "💰 Apakah MetaGen Pro gratis? Berapa harganya?",
                "faq_a2": "<p><strong>Paket gratis untuk semua orang!</strong> Metagen Pro memiliki paket gratis yang mumpuni (120 gambar/bulan, maksimal 25 per hari). Namun, untuk penggunaan yang intensif, kami memiliki paket <strong>Pro</strong> ($12/bulan - 2000 gambar/bulan, maksimal 70 per hari) dan <strong>Premium</strong> ($29/bulan - 3000 gambar/bulan, maksimal 100 per hari). Paket berbayar menawarkan fitur-fitur canggih seperti penyematan metadata otomatis, ekspor Excel, dan unggahan FTP langsung.</p>",
                "faq_q3": "🔑 Bagaimana cara mendapatkan kunci API? Apakah aman?",
                "faq_a3": "<p><strong>Tidak, kunci API tidak diperlukan untuk paket apa pun sekarang!</strong> Di semua paket, Gratis, Pro, dan Premium, kami memproses metadata menggunakan server kami sendiri dan model AI khusus Supabase Edge Functions (model AI canggih).</p><p><strong>Keamanan:</strong> Semua data Anda sepenuhnya <strong>aman</strong> dan dihapus dari server segera setelah diproses.</p>",
                "faq_q4": "📁 Format file apa saja yang didukung?",
                "faq_a4": "<p><strong>Format:</strong> JPG/JPEG (dengan EXIF), PNG, SVG (dengan XMP), dan EPS (via ConvertAPI).</p><p>Unggah hingga <strong>500 file sekaligus</strong>!</p>",
                "faq_q5": "🎯 Platform stok mana saja yang didukung?",
                "faq_a5": "<p>Dioptimalkan untuk: Shutterstock, Adobe Stock, Magnific, Vecteezy, Pond5, 123RF, iStock, dan lainnya. AI kami otomatis menyesuaikan dengan syarat tiap platform!</p>",
                "faq_q6": "📊 Apa itu SEO Score dan lencana kata kunci?",
                "faq_a6": "<p><strong>SEO Score:</strong> Mengukur optimasi pencarian.</p><p><strong>Lencana:</strong></p><ul><li>🟢 <strong>Hijau:</strong> Satu kata</li><li>🟡 <strong>Kuning:</strong> Dua kata</li><li>🔵 <strong>Biru:</strong> 3+ kata</li></ul>",
                "faq_q7": "⚡ Bagaimana cara kerja pemrosesan batch?",
                "faq_a7": "<p>Unggah hingga 500 gambar, klik 'Process Selected'. AI kami memproses semuanya secara paralel. Sangat cepat!</p>",
                "faq_q8": "🎨 Apa itu fitur 'Image to Prompt'?",
                "faq_a8": "<p>Mengubah gambar menjadi prompt detail untuk AI generator seperti Midjourney atau DALL-E. Cocok untuk riset gambar stok sukses!</p>",
                "faq_q9": "🔒 Apakah data saya pribadi?",
                "faq_a9": "<p><strong>100% Pribadi!</strong> Pemrosesan di browser Anda. Kami TIDAK PERNAH menyimpan gambar Anda. Data langsung dihapus setelah selesai.</p>",
                "faq_q10": "🔧 Troubleshooting: Masalah umum",
                "faq_a10": "<ul><li><strong>Error API:</strong> Cek kunci di Pengaturan.</li><li><strong>File besar:</strong> Maksimal 20MB.</li><li><strong>Lambat:</strong> Tutup tab browser lain.</li></ul>",
                "faq_q11": "🎭 Bagaimana cara kerja AI Image Generator?",
                "faq_a11": "<p>Gunakan model FLUX untuk membuat gambar. Masukkan kunci Together AI dan buat gambar unik untuk portofolio Anda!</p>",
                "faq_q12": "💬 Butuh bantuan?",
                "faq_a12": "<p>Email ke <strong>metagenp@gmail.com</strong> atau gunakan tombol Feedback. Kami balas dalam 12 jam!</p>"
            },

            de: {
                flag: '🇩🇪',
                name: 'DE',
                band: 'MetaGen Pro',
                tagline: 'Metadaten, angetrieben durch KI',
                home: 'Startseite',
                features: 'Funktionen',
                start_tour: 'Tour starten',
                faq: 'FAQ',
                menu: 'MENÜ',
                blog: 'Blog-Beitrag',
                disclaimer: 'Haftungsausschluss',
                about: 'Über uns',
                contact: 'Kontakt',
                legal: 'Rechtliches',
                select_lang: 'Wählen Sie Sprache aus',
                general_btn: "Allgemein",
                save_key: 'Speichern',
                close: 'Schließen',
                get_key: 'Schlüssel abrufen',
                badge: 'Abzeichen',
                try_metagen: 'Probieren Sie MetaGen kostenlos aus',
                no_api: 'Für Ihre kostenlose Testversion ist kein API-Schlüssel erforderlich.',
                watting_for: 'Worauf wartest du noch?',
                "get_start": "Jetzt kostenlos loslegen",
                "drag_and_drop": "Per Drag & Drop an eine beliebige Stelle ziehen, um die Datei hochzuladen",
                "fast": "Schnell",
                "best": "Beste",
                "generate_meta": "Metadaten generieren",
                "delete_select": "Ausgewählte löschen",
                "down_select": "Ausgewählte herunterladen",
                "translate_select": "Ausgewählte übersetzen",
                "done": "Fertig",
                "processing": "Verarbeitung",
                "analyzing_market": "Markttrends werden analysiert...",
                "ai_is_researching": "Die KI recherchiert leistungsstarke Konzepte für Sie.",
                "analyzing": "Analysieren...",
                "copy_tag": "Tags kopieren",
                "copy_idea": "Idee & Infos kopieren",
                "download": "Herunterladen",
                "enter_your_convert_api": "Geben Sie Ihren Convert-API-Schlüssel ein, um EPS-Konvertierungen zu aktivieren.",
                "export_csv": "Als CSV exportieren",
                "export_excel": "Als Excel exportieren",
                "niche_research_cen": "Nischen-Forschungszentrum",
                "niche_research_tag": "Entdecken Sie Keywords und Konzepte mit hoher Nachfrage und geringem Wettbewerb für Ihr Stock-Portfolio.",
                "select_category": "Kategorie auswählen",
                "market_focus": "Marktfokus",
                "analyze_trend": "Trends analysieren",
                "ready_to_research": "Bereit zur Recherche",
                "ready_to_research_tag": "Wählen Sie oben eine Kategorie aus und klicken Sie auf \"Trends analysieren\", um profitable Nischen zu entdecken.",
                "quick_suggest": "Schnelle Vorschläge",
                "label_title": "Titel",
                "label_desc": "Beschreibung",
                "label_keywords": "Schlüsselwörter",
                "btn_copy": "Kopieren",
                "btn_add": "Hinzufügen",
                "placeholder_add_kw": "Schlüsselwort hinzufügen...",
                "seo_score": "SEO-Score",
                "rejection": "Ablehnung",
                "platform_check": "Plattform-Check",
                "style": "Stil",
                "mode": "Modus",
                "translate": "Übersetzen",
                "go": "Los",
                "min_title": "Min. Titelwörter",
                "max_title": "Max. Titelwörter",
                "min_keywords": "Min. Schlagwörter",
                "max_keywords": "Max. Schlagwörter",
                "min_desc": "Min. Beschreibungswörter",
                "max_desc": "Max. Beschreibungswörter",
                "toggle_silhouette": "Silhouette",
                "toggle_vector": "Vektor / Illustrationsmodus",
                "toggle_white_bg": "Weißer Hintergrund",
                "toggle_trans_bg": "Transparenter Hintergrund",
                "toggle_custom_prompt": "Benutzerdefinierter Prompt",
                "toggle_prohibited": "Verbotene Wörter",
                "toggle_single_kw": "Einzelwort-Schlagwörter",
                "toggle_change_name": "Dateinamen ändern",
                "toggle_name_title": "Dateiname als Titel",
                "feedback_matters": "Ihr Feedback ist uns wichtig",
                "provide_feedback": "Bitte geben Sie Feedback zum Tool.",
                "issue_type": "Problemtyp",
                "general_feedback": "Allgemeines Feedback",
                "bug_report": "Fehlerbericht",
                "feature_request": "Funktionsanfrage",
                "your_mess": "Ihre Nachricht",
                "send_feed": "Feedback senden",
                eps_meta: 'EPS-Metadaten generieren und einbetten',
                month: '/ Monat',
                pricing: 'Preise',
                ftp_upload: 'FTP-Direkt-Upload',
                ftp_upload_sub_txt: 'Laden Sie Dateien direkt auf Stock-Websites hoch (Adobe Stock, Shutterstock, Magnific).',
                upgrade_plan: 'Plan aktualisieren',
                stock_calendar: 'Stock-Kalender',
                get_access: 'Zugang erhalten',
                pricing_plan: 'Unser Preisplan',
                pricing_sub_txt: 'Wählen Sie den perfekten Plan für Ihren kreativen Workflow.',
                free_plan: 'Kostenloser Plan',
                free_price: '$0/Monat',
                most_popular: 'Am beliebtesten',
                pro_plan: 'Auf Pro upgraden',
                pro_price: '$12/Monat',
                premium_plan: 'Premium-Plan',
                premium_price: '$29/Monat',
                '50_image': '120 Bilder pro Monat (maximal 10 pro Tag im Rahmen der zulässigen Nutzung)',
                basic_ai_model: 'Einfache KI-Modelle (Gemini, Mistral, Groq) Verwenden Sie Ihren eigenen API-Schlüssel.',
                batch_process: 'Stapelverarbeitung: bis zu 50 Dateien',
                csv_export: 'CSV-Export',
                ads_support: 'Werbeunterstützt',
                auto_embed: 'Automatische Metadaten-Einbettung',
                excel_export: 'Excel-Export',
                drag_keyword: 'Keyword-Neuordnung per Drag & Drop',
                copy_trade_check: 'Urheberrechts-/Markenprüfung',
                get_started_free: 'Kostenlos starten',
                '300_images': '2000 Bilder/Monat',
                advance_ai: 'Erweiterte KI-Modelle (Kein API-Schlüssel erforderlich).',
                batch_process_pro: 'Stapelverarbeitung: bis zu 100 Dateien',
                csv_excel_ex: 'CSV-/Excel-Export',
                seo_and_no_ads: 'SEO-Analysen & Keine Werbung',
                support_time: 'Support 24 Stunden',
                '1k_image': '3000 Bilder/Monat',
                all_pro: 'Alle Pro-Funktionen',
                batch_process_pre: 'Stapelverarbeitung: bis zu 300 Dateien',
                ftp_auto_up: 'FTP/SFTP-Auto-Upload',
                vector_eps: 'Direkte Vektor-/EPS-Konvertierung',
                vip_support: 'VIP-Support & Vorabzugang',
                privacy_policy: 'Datenschutz',
                terms_of_service: 'Nutzungsbedingungen',
                adjustment: 'Anpassung',
                multi_tool: 'Multi-Bild-Tools',
                sketch_art: 'Bild zu Skizzenkunst',
                all_tools: 'Alle Tools',
                image_enhance: 'KI-Bildverbesserer',
                bg_remove: 'KI-Hintergrundentferner',
                pixel_check: 'Pixel-Check Studio',
                text_to_image: 'Text-zu-Bild-Generator',
                company: 'Unternehmen',
                free_plan: 'Kostenloser Plan',
                note: 'Der API-Zugriff wird in 7 Tagen entfernt. Aktualisieren Sie auf den Pro/Premium-Tarif und nutzen Sie alle Funktionen von MetaGen Pro.',
                platform: 'Plattform',
                add_more: 'Mehr Dateien hinzufügen',
                well_come: 'Willkommen zurück',
                login_google: 'Weiter mit Google',
                new_user: 'Neuer Benutzer?',
                create_account: 'Konto erstellen',
                niche_research: 'Nischenrecherche',
                metadata_generator: 'Metadaten-Generator',
                seo_score: 'SEO-Score & Analyse',
                batch_process: 'Superschnelle Stapelverarbeitung',
                sign_out: 'Abmelden',
                switch_account: 'Konto wechseln',
                upload_title: 'Bilder oder Videos hochladen',
                drag_drop: 'Dateien hierher ziehen oder zum Hochladen klicken',
                supports: 'Unterstützt JPG, PNG, WEBP, MP4, MOV',
                max_size: 'Max 50MB pro Datei',
                privacy_note: 'Ihre Dateien werden sicher verarbeitet und nach 1 Stunde gelöscht.',
                privacy_note_device: 'Wir analysieren Dateien nur auf dem Gerät, Daten werden nach der Verarbeitung gelöscht.',
                upload_limit_info: 'Kostenloser Plan: 50 Dateien/Tag',
                usage: 'Nutzung:',
                "daily_limit": "Tägliches Prozesslimit",
                refer_text: 'Teile MetaGen Pro, um +50 extra Tageslimit zu erhalten!',
                "share_get_credit": "Teilen & Guthaben erhalten",
                generate_metadata: 'Metadaten generieren',
                "limit_reached_msg": "Sie haben Ihr tägliches Verarbeitungslimit erreicht! Aktualisieren Sie Ihren Plan für höhere Limits oder teilen Sie das Tool für einen Bonus.",
                export_csv: 'Als CSV exportieren',
                export_excel: 'Als Excel exportieren',
                clear_all: 'Alles löschen',
                copy_all: 'Alles kopieren',
                down_eps: 'EPS herunterladen',
                guides: 'Anleitungen',
                title: 'Titel',
                description: 'Beschreibung',
                keywords: 'Schlagwörter',
                categories: 'Kategorien',
                already_user: 'Haben Sie bereits ein Konto?',
                login: 'Anmelden',
                tools_generator: 'Tools & Generator',
                trending: '📅 Im Trend...',
                customization: 'Anpassung',
                settings: 'Einstellungen',
                select_ai: 'KI-Anbieter auswählen',
                manage_api: 'API-Schlüssel verwalten',
                convert_api: 'ConvertAPI-Schlüssel',
                translation_lang: 'Übersetzungssprache',
                upload_files: 'Dateien hochladen',
                watch_demo: 'Demo ansehen',
                watch_tagline: 'Sehen Sie, wie Sie Ihre Stock-Verkäufe in Sekunden steigern',
                process_selected: 'Ausgewählte verarbeiten',
                process_prompts: 'Prompts verarbeiten',
                embed_metadata: 'Metadaten einbetten',
                export: 'Exportieren',
                batch_translate: 'Stapelübersetzung (Kostenlos)',
                translate_all: 'Alles übersetzen (API)',
                test_metadata: 'Metadaten testen',
                save_folder: 'In Ordner speichern',
                share_files: 'Dateien teilen',
                upload_drive: 'Auf Drive hochladen',
                pause: 'Pause',
                image_to_prompt: 'Bild zu Prompt',
                jpg_png: 'JPG/PNG',
                svg_eps: 'SVG/EPS/AI',
                videos: 'Videos',
                check_copyright: 'Auf Urheberrecht/Marken prüfen:',
                upload_limit: 'Maximal 500 Dateien in einer einzigen Aktion hochladen',
                resume: 'Fortsetzen',
                send_feedback: 'Feedback senden / Fehlerbericht melden',
                view_translated: 'Übersetzt anzeigen',
                view_original: 'Original anzeigen',
                analyze_trends: 'Trends analysieren',
                downloading: 'Wird heruntergeladen...',
                translating: 'Wird übersetzt...',
                embedding: 'Wird eingebettet...',
                analyzing: 'Wird analysiert...',
                processing: 'Wird verarbeitet...',
                process: 'Verarbeiten',
                files: 'Dateien',
                prompts: 'Prompts',
                complete: 'Abgeschlossen',
                success: 'Erfolg',
                fail: 'Fehlgeschlagen',
                saving: 'Wird gespeichert...',
                preparing: 'Wird vorbereitet...',
                uploading: 'Wird hochgeladen...',
                initializing: 'Verbindung wird hergestellt...',
                processing_files: 'Dateien werden verarbeitet...',
                "hero_title": "Kostenloser KI-Metadaten-Generator & Stockfoto-Keywords!",
                hero_tagline: 'Steigern Sie Ihre Sichtbarkeit auf Shutterstock, Adobe Stock und Magnific. Generieren Sie SEO-optimierte Titel, Beschreibungen und Keywords in Sekunden mit fortschrittlicher KI.',
                why_choose: 'Warum MetaGen Pro wählen?',
                blog_1: 'Superschnelle Stapelverarbeitung',
                blog_tag_1: 'Analysieren und verschlagworten Sie Hunderte von Bildern in Sekunden. Sparen Sie Stunden manueller Arbeit mit unserer optimierten Stapelverarbeitung.',
                blog_2: 'Fortschrittliche KI-Analyse',
                blog_tag_2: 'Angetrieben von Gemini 1.5 Pro, Mistral & Llama 3 für branchenführende Bilderkennung und präzise Metadaten.',
                blog_3: 'SEO-optimierte Keywords',
                blog_tag_3: 'Generieren Sie hochrangige Titel und Tags, die speziell auf die Algorithmen von Shutterstock, Adobe Stock & Magnific zugeschnitten sind.',
                blog_4: 'Nischenrecherche',
                blog_tag_4: 'Entdecken Sie Themen mit geringer Konkurrenz und hoher Nachfrage mit unserem integrierten Nischenrecherche-Tool. Finden Sie heraus, wonach Käufer suchen.',
                blog_5: 'Drag & Drop Keyword-Neuanordnung',
                blog_tag_5: 'Auf Stock-Seiten (Adobe Stock, Shutterstock) sind die ersten 5-10 Keywords am wichtigsten.',
                blog_6: 'Metadaten-Einbettung',
                blog_tag_6: 'Betten Sie Titel und Keywords direkt in Ihre JPG/PNG/SVG-Dateien ein (IPTC/XMP). Einfach herunterladen und bei jeder Stock-Agentur hochladen.',
                blog_7: 'Mehrsprachig',
                blog_tag_7: 'Übersetzen Sie Ihre Metadaten sofort in über 10 Sprachen. Erreichen Sie ein globales Publikum mit lokalisierten Titeln und Beschreibungen.',
                blog_8: 'Urheberrechtsprüfung',
                blog_tag_8: 'Vermeiden Sie Ablehnung! Unsere KI scannt Ihre Bilder auf potenzielle Markenprobleme und Logos, bevor Sie sie hochladen.',
                blog_9: 'Metadaten-CSV-Export',
                blog_tag_9: 'CSV-Exportfunktion für alle Stock-Seiten (Adobe Stock, Shutterstock, Magnific).',
                trusted_all: 'Vertraut für alle großen Microstock-Plattformen',
                it_works: 'Wie es funktioniert',
                upload_photos: 'Fotos hochladen',
                upload_photos_tag: 'Ziehen Sie Ihre JPG/PNG-Dateien hierher. Wir lesen automatisch Abmessungen und technische Spezifikationen.',
                select_platfrom: 'Plattform & KI auswählen',
                select_platfrom_tag: 'Wählen Sie Ihren Zielmarkt (z. B. Adobe Stock) und das bevorzugte KI-Modell (Gemini/Groq).',
                gen_down: 'Generieren & Herunterladen',
                gen_down_tag: 'Erhalten Sie sofort SEO-fertige Titel & Keywords. Laden Sie CSV herunter oder betten Sie sie direkt ein.',
                why_choose_stock_title: 'Warum MetaGen Pro für Stock-Fotografie wählen?',
                how_to_use_title: 'Wie benutzt man das Tool?',
                master_stock_title: 'Meistern Sie Ihre Stock-Fotografie mit KI-gestützten Metadaten',
                trusted_stock_title: 'Vertraut von Stock-Mitwirkenden in den gesamten USA',
                why_choose_stock_p1: 'In der wettbewerbsintensiven Welt der Stockfotografie ist die Auffindbarkeit der Schlüssel zum Erfolg. Selbst die besten Bilder werden nicht verkauft, wenn Käufer sie nicht finden können. <strong>MetaGen Pro</strong> ist der ultimative <em>KI-Metadaten-Generator</em>, der entwickelt wurde, um dieses Problem zu lösen.',
                why_choose_stock_p2: 'Im Gegensatz zur manuellen Verschlagwortung, die mühsam und fehleranfällig ist, nutzt unser Tool modernste Computer Vision, um Motiv, Stimmung, Beleuchtung und Komposition Ihres Bildes zu analysieren. Anschließend generiert es über 50 optimierte Keywords, eingängige Titel und detaillierte Beschreibungen, die auf Plattformen wie <strong>Shutterstock, Adobe Stock, Magnific und Vecteezy</strong> zugeschnitten sind.',
                why_choose_stock_p3: 'Egal, ob Sie Fotograf, Illustrator oder KI-Künstler sind, MetaGen Pro optimiert Ihren Workflow. Funktionen wie <strong>Bild-zu-Prompt</strong> helfen Ihnen dabei, erfolgreiche KI-Bilder zu rekonstruieren, während unser <strong>Ablehnungs-Prädiktor</strong> Ihnen hilft, technische Probleme vor dem Hochladen zu beheben.',
                why_choose_stock_p4: 'Beginnen Sie noch heute damit, Ihr passives Einkommen mit dem fortschrittlichsten kostenlosen Stockfoto-Tagger zu maximieren.',
                "plan_details_title": "Welcher Plan ist der richtige für Sie?",
                "plan_details_free": "Kostenloser Plan - Ideal für Anfänger",
                "plan_details_free_p1": "Unser kostenloser Plan ist für Hobbyisten und neue Stock-Kontributoren konzipiert. Er ermöglicht es Ihnen, bis zu <strong>10 Bilder pro Tag</strong> zu verarbeiten. Um den Service völlig kostenlos zu halten, Sie erhalten Zugriff auf unsere Kernfunktionen, einschließlich superschneller Stapelverarbeitung (bis zu 50 Dateien gleichzeitig), KI-Metadaten-Generierung und CSV-Export. Beachten Sie, dass erweiterte Funktionen wie die automatische Metadaten-Einbettung, Excel-Export und Urheberrechtsprüfungen in diesem Plan nicht enthalten sind.",
                "plan_details_pro": "Pro Plan - Für Profis",
                "plan_details_pro_p1": "Der Pro-Plan ist für regelmäßige Kontributoren gedacht, die ihren Workflow maximieren und Stunden sparen möchten. Mit einem großzügigen Limit von <strong>70 Bildern pro Tag</strong> müssen Sie Ihre eigenen API-Schlüssel nicht mehr mitbringen – wir verarbeiten alle KI-Anfragen sicher auf unserer Seite. Dieser Plan schaltet leistungsstarke Tools frei, wie die <strong>automatische Metadaten-Einbettung</strong> direkt in Ihre JPEG-/PNG-/SVG-Dateien, Drag-and-Drop-Schlüsselwort-Neuordnung, KI-gestützte Urheberrechts-/Markenprüfungen und Excel-Export. Er erhöht auch Ihr Stapelverarbeitungs-Limit auf 100 Dateien auf einmal und bietet ein komplett werbefreies Erlebnis.",
                "plan_details_premium": "Premium Plan - Für Power-User & Agenturen",
                "plan_details_premium_p1": "Entwickelt für High-Volume-Ersteller, Vektorkünstler und Agenturen bietet der Premium-Plan ein massives Limit von <strong>100 Bildern pro Tag</strong> und ein Batch-Limit von 300 Dateien. Er beinhaltet alles aus dem Pro-Plan sowie erweiterte Automatisierungsfunktionen. Sie erhalten exklusiven Zugriff auf <strong>direkte Vektor-/EPS-Konvertierung</strong> (keine ConvertAPI-Schlüssel von Drittanbietern erforderlich) und die Funktion <strong>FTP-/SFTP-Auto-Upload</strong>. Dies ermöglicht es Ihnen, Ihre verarbeiteten Dateien und Metadaten direkt aus Ihrem Browser automatisch an mehrere Stock-Agenturen (Shutterstock, Adobe Stock, Magnific usw.) zu verteilen.",
                "htu_step1_title": "1. Dateien hochladen",
                "htu_step1_desc": "Ziehen Sie Bilder (JPG/PNG), Vektoren (SVG/EPS) oder Videos per Drag & Drop, um zu beginnen.",
                "htu_step2_title": "2. Zielplattform",
                "htu_step2_desc": "Wählen Sie Shutterstock, Adobe Stock oder Magnific für optimierte Ergebnisse.",
                "htu_step3_title": "3. KI-Modell auswählen",
                "htu_step3_desc": "Wählen Sie zwischen Gemini, Mistral oder Groq für die Bildanalyse.",
                "htu_step4_title": "4. Anpassung",
                "htu_step4_desc": "Passen Sie die Min/Max-Wörter für Titel und Schlagwörter über die Schieberegler an.",
                "htu_step5_title": "5. KI-Einstellungen",
                "htu_step5_desc": "Aktivieren Sie den Vektor-Modus, den weißen Hintergrund oder nutzen Sie Ihre eigenen benutzerdefinierten Prompts.",
                "htu_step6_title": "6. Metadaten generieren",
                "htu_step6_desc": "Klicken Sie auf 'Ausgewählte verarbeiten', um sofort SEO-optimierte Titel und Tags zu erhalten.",
                "htu_step7_title": "7. Metadaten einbetten",
                "htu_step7_desc": "Schreiben Sie Metadaten direkt in Ihre JPG-, PNG- oder SVG-Dateien.",
                "htu_step8_title": "8. Multi-Übersetzung",
                "htu_step8_desc": "Übersetzen Sie Metadaten in über 10 Sprachen für den globalen Markt.",
                "htu_step9_title": "9. Ergebnisse exportieren",
                "htu_step9_desc": "Laden Sie alle Ihre Metadaten als CSV oder professionelle Excel-Tabellen herunter.",
                "htu_step10_title": "10. Speichern & Drive",
                "htu_step10_desc": "Speichern Sie im lokalen Ordner, teilen Sie per Link oder laden Sie direkt auf Google Drive hoch.",
                how_to_use_step5: '<strong>Schritt 5:</strong> Überprüfen Sie die Ergebnisse, bearbeiten Sie sie bei Bedarf und klicken Sie auf <strong>"Herunterladen"</strong> oder <strong>"CSV exportieren"</strong>.',
                master_stock_subtitle1: 'So verwenden Sie MetaGen Pro',
                master_stock_p1: 'Der Einstieg in MetaGen Pro ist denkbar einfach und erfordert kein technisches Fachwissen. Laden Sie zunächst Ihre Bilder hoch, indem Sie sie in den dafür vorgesehenen Upload-Bereich ziehen oder auf Ihre Dateien klicken. MetaGen Pro unterstützt alle gängigen Bildformate einschließlich JPG, PNG, SVG und EPS sowie Videodateien. Sobald Ihre Bilder hochgeladen sind, wählen Sie Ihre Zielplattform (Shutterstock, Adobe Stock, Magnific oder Allgemein) aus, um die Metadaten speziell für diesen Marktplatz zu optimieren.',
                master_stock_p2: 'Konfigurieren Sie anschließend Ihre Einstellungen über die Seitenleiste. Sie können die Anzahl der Keywords anpassen (wir empfehlen 35-50 für optimales SEO), Titel-Längenbeschränkungen festlegen und spezielle Funktionen wie den Vektormodus für Illustrationen oder die Weißer-Hintergrund-Erkennung für Produktbilder aktivieren. Die KI-Anbieterauswahl ermöglicht es Ihnen, je nach API-Verfügbarkeit und Geschwindigkeitspräferenzen zwischen Google Gemini-, Mistral KI- oder Groq Llama-Modellen zu wählen.',
                master_stock_p3: 'Klicken Sie nach der Konfiguration auf die Schaltfläche "Alle verarbeiten", um Metadaten für alle hochgeladenen Bilder gleichzeitig zu generieren. Unsere fortschrittliche KI analysiert den visuellen Inhalt, die Komposition, die Farben, die Motive und den Kontext jedes Bildes, um hochrelevante Titel, Beschreibungen und Keyword-Sets zu erstellen. Der gesamte Vorgang dauert in der Regel nur wenige Sekunden pro Bild, selbst wenn Hunderte von Dateien im Batch-Modus verarbeitet werden.',
                master_stock_subtitle2: 'Vorteile der Verwendung dieses Tools',
                master_stock_benefit1: '<strong>Zeiteffizienz:</strong> Die manuelle Verschlagwortung kann 10-15 Minuten pro Bild in Anspruch nehmen. MetaGen Pro reduziert dies auf wenige Sekunden, sodass Sie Hunderte von Bildern in der Zeit verschlagworten können, die Sie für die manuelle Bearbeitung von nur wenigen Bildern benötigen würden. Für professionelle Anbieter, die wöchentlich 50-100 Bilder hochladen, bedeutet dies eine Ersparnis von über 10 Stunden pro Woche.',
                master_stock_benefit2: '<strong>SEO-Optimierung:</strong> Unsere KI beschreibt nicht nur, was sie sieht – sie versteht die Suchintention und die Algorithmen der Marktplätze. Jedes Metadaten-Set enthält eine strategische Mischung aus allgemeinen Keywords (hohes Suchvolumen), spezifischen Long-Tail-Keywords (hohe Konversion) und Trendbegriffen (aktuelle Nachfrage). Das integrierte SEO-Score-Messgerät bewertet Ihre Metadaten in Echtzeit und stellt sicher, dass jeder Upload für maximale Auffindbarkeit optimiert ist.',
                master_stock_benefit3: '<strong>Multi-Plattform-Unterstützung:</strong> Verschiedene Stock-Agenturen haben unterschiedliche Anforderungen und Vorlieben. MetaGen Pro passt sich dem einzigartigen Algorithmus jeder Plattform an – Shutterstock bevorzugt andere Keyword-Strukturen als Adobe Stock oder Magnific. Unsere plattformspezifische Optimierung stellt sicher, dass Ihre Bilder überall dort, wo Sie sie hochladen, gut ranken.',
                master_stock_benefit4: '<strong>Konsistenz und Qualität:</strong> Eliminieren Sie menschliche Fehler und halten Sie professionelle Standards in Ihrem gesamten Portfolio ein. MetaGen Pro stellt sicher, dass jedes Bild über korrekt formatierte Metadaten, eine angemessene Keyword-Anzahl und passende Beschreibungen verfügt. Die Ablehnungs-Prädiktor-Funktion analysiert Ihre Metadaten anhand gängiger Ablehnungskriterien und hilft Ihnen, kostspielige Einreichungsfehler zu vermeiden.',
                master_stock_subtitle3: 'Was ist Bild-SEO und warum es wichtig ist',
                master_stock_seo_p1: 'Bild-SEO (Suchmaschinenoptimierung) ist die Praxis der Optimierung von Bildmetadaten, um die Sichtbarkeit in Suchergebnissen auf Stockfotografie-Plattformen und Suchmaschinen zu verbessern. Wenn ein Käufer nach "Geschäftstreffen" oder "tropischer Strandsonnenuntergang" sucht, "sieht" der Algorithmus der Plattform Ihr Bild nicht – er liest die von Ihnen bereitgestellten Metadaten. Effektives Bild-SEO ist der Unterschied, ob Ihre Arbeit auf Seite 1 oder auf Seite 50 der Suchergebnisse erscheint.',
                master_stock_seo_p2: '<strong>Die drei Säulen von Bild-SEO:</strong> Erstens sollte der <em>Titel</em> beschreibend, aber prägnant sein (10-20 Wörter) und Ihre primären Keywords enthalten, während er natürlich und lesbar bleibt. Zweitens bietet die <em>Beschreibung</em> Kontext und Anwendungsfälle (30-50 Wörter) und hilft sowohl Algorithmen als auch Käufern, die kommerziellen Anwendungen Ihres Bildes zu verstehen. Drittens decken <em>Keywords</em> ein breites Spektrum ab (empfohlen werden 35-50 Begriffe) und erfassen verschiedene Suchanfragen, die Käufer zu Ihrem Bild führen könnten.',
                master_stock_seo_p3: '<strong>Keyword-Strategie ist wichtig:</strong> Die effektivsten Metadaten verwenden eine ausgewogene Mischung: 20-30 % Ein-Wort-Keywords (große Reichweite), 40-50 % Zwei-Wort-Phrasen (mittlere Spezifität) und 20-30 % Long-Tail-Keywords (hohe Konversion). Beispielsweise sollte ein Bild von Händen, die ein Smartphone benutzen, "Hände" (allgemein), "Smartphone-Interaktion" (mittelspezifisch) und "Hände tippen auf mobile App-Oberfläche" (Long-Tail) enthalten. Diese Strategie maximiert die Chancen, dass Ihr Bild sowohl in allgemeinen als auch in spezifischen Suchen erscheint.',
                master_stock_seo_p4: '<strong>Suchranking-Faktoren:</strong> Stock-Plattformen berücksichtigen mehrere Faktoren beim Ranking der Suchergebnisse. Relevanz (wie gut Ihre Metadaten mit der Suchanfrage übereinstimmen), Vollständigkeit (alle Metadatenfelder korrekt ausgefüllt) und Keyword-Vielfalt (Verwendung variierter, verwandter Begriffe) wirken sich alle auf Ihr Ranking aus. Darüber hinaus beeinflusst die kommerzielle Relevanz – die Beschreibung, wie Käufer Ihr Bild verwenden können – die Konversionsraten erheblich, selbst wenn Ihr Bild gut rankt.',
                master_stock_seo_p5: 'MetaGen Pro automatisiert all diese Best Practices und stellt sicher, dass jedes Bild, das Sie hochladen, vollständig für maximale Sichtbarkeit, Downloads und letztendlich Einkommen optimiert ist. Egal, ob Sie ein Hobby-Anbieter oder ein Vollzeit-Stockfotograf sind, ordentliches Bild-SEO ist auf dem heutigen wettbewerbsintensiven Marktplatz unverzichtbar.',
                master_stock_cta: '<strong>Bereit, Ihren Erfolg in der Stockfotografie zu steigern?</strong> Nutzen Sie MetaGen Pro noch heute und verwandeln Sie Stunden mühsamer Verschlagwortung in Sekunden automatisierter Exzellenz.',
                trusted_stock_subtitle: 'Erfahren Sie, warum Tausende von amerikanischen Fotografen und Erstellern auf MetaGen Pro vertrauen, um ihre Stock-Einnahmen zu steigern',
                review_1_details: '📍 New York, NY • Professionelle Fotografin',
                review_1_text: '"MetaGen Pro hat meinen Workflow komplett verändert! Früher habe ich Stunden damit verbracht, meine Fotos für Shutterstock zu verschlagworten. Jetzt dauert es nur noch Minuten und meine Downloads sind um 40 % gestiegen. Die SEO-Score-Funktion ist brillant!"',
                review_2_details: '📍 Los Angeles, CA • Content Creator',
                review_2_text: '"Als Vollzeit-Content-Creator ist Zeit Geld. Dieses Tool spart mir mindestens 10 Stunden pro Woche bei der Metadaten-Eingabe. Die Batch-Verarbeitung ist blitzschnell und die KI-generierten Keywords sind genau auf den Punkt. Die beste Investition, die ich dieses Jahr getätigt habe!"',
                review_3_details: '📍 Miami, FL • Stock-Anbieterin',
                review_3_text: '"Ich war anfangs skeptisch, aber MetaGen Pro hat alle Erwartungen übertroffen. Die Keyword-Vorschläge sind unglaublich relevant und die Mehrsprachigkeitsfunktion hat mir geholfen, internationale Käufer zu erreichen. Meine Adobe Stock-Einnahmen haben sich in nur 3 Monaten verdoppelt!"',
                review_4_details: '📍 Chicago, IL • Grafikdesigner',
                review_4_text: '"Alleine die Urheberrechtsprüfung ist den Preis wert! Sie hat mich schon mehrmals vor möglichen Ablehnungen bewahrt. In Kombination mit der automatisierten Metadatengenerierung ist dieses Tool ein Muss für jeden, der Stockfotografie ernst nimmt."',
                review_5_details: '📍 Seattle, WA • Naturfotografin',
                review_5_text: '"Ich lade jeden Monat Hunderte von Naturfotos hoch. MetaGen Pro macht es mühelos, sie alle zu verwalten und zu optimieren. Die CSV-Exportfunktion lässt sich nahtlos in meinen Workflow integrieren. Sehr empfehlenswert für andere Anbieter!"',
                review_6_details: '📍 Austin, TX • Freiberuflicher Videograf',
                review_6_text: '"Ein Game-Changer für Video-Metadaten! Die KI identifiziert Szenen genau und generiert perfekte Titel. Die Sichtbarkeit meines Shutterstock-Videoportfolios hat sich dramatisch verbessert. Das Support-Team ist außerdem extrem reaktionsschnell und hilfreich."',
                stat_users: 'Aktive US-Nutzer',
                stat_satisfaction: 'Zufriedenheitsrate',
                stat_images: 'Täglich optimierte Bilder',
                stat_rating: 'Durchschnittliche Bewertung',
                "faq_title": "FAQs — MetaGen Pro",
                "faq_q1": "🚀 Wie fange ich mit MetaGen Pro an?",
                "faq_a1": "<strong>Schritt 1:</strong> Registrieren oder anmelden.<br><strong>Schritt 2:</strong> Google Gemini API-Key in den Einstellungen hinterlegen (<a href='https://aistudio.google.com/app/apikey' target='_blank'>Google AI Studio</a>).<br><strong>Schritt 3:</strong> Bilder hochladen (bis zu 500 Dateien gleichzeitig).<br><strong>Schritt 4:</strong> Plattform wählen und auf 'Generate Metadata' klicken.<br><strong>Schritt 5:</strong> Bearbeiten, Metadaten einbetten und herunterladen!",
                "faq_q2": "💰 Ist MetaGen Pro kostenlos?",
                "faq_a2": "<p><strong>Kostenlose Tarife für alle!</strong> Metagen Pro bietet einen leistungsstarken Gratis-Tarif (120 Bilder/Monat, max. 25 täglich). Für intensive Nutzung bieten wir jedoch die Tarife <strong>Pro</strong> (12 $/Monat – 2000 Bilder/Monat, max. 70 täglich) und <strong>Premium</strong> (29 $/Monat – 3000 Bilder/Monat, max. 100 täglich) an. Die kostenpflichtigen Tarife bieten erweiterte Funktionen wie automatisches Einbetten von Metadaten, Excel-Export und direkten FTP-Upload.</p>",
                "faq_q3": "🔑 Sind meine API-Keys sicher?",
                "faq_a3": "<p><strong>Nein, für keinen Tarif ist jetzt ein API-Schlüssel erforderlich!</strong> In allen Tarifen – Free, Pro und Premium – verarbeiten wir Metadaten mithilfe unserer eigenen Server und der dedizierten KI-Modelle von Supabase Edge Functions (fortschrittliche KI-Modelle).</p><p><strong>Sicherheit:</strong> Alle Ihre Daten sind absolut <strong>sicher</strong> und werden unmittelbar nach der Verarbeitung vom Server gelöscht.</p>",
                "faq_q4": "📁 Welche Formate werden unterstützt?",
                "faq_a4": "<p>Unterstützt werden JPG, PNG, SVG und EPS (via ConvertAPI).</p><p>Bis zu <strong>500 Dateien gleichzeitig</strong>!</p>",
                "faq_q5": "🎯 Welche Plattformen werden unterstützt?",
                "faq_a5": "<p>Optimiert für Shutterstock, Adobe Stock, Magnific und viele mehr. Unsere KI passt sich automatisch an.</p>",
                "faq_q6": "📊 Was ist der SEO Score?",
                "faq_a6": "<p>Misst die Sichtbarkeit für Suchalgorithmen. 🟢 = Ein Wort, 🟡 = Zwei Wörter, 🔵 = Long-tail.</p>",
                "faq_q7": "⚡ Wie schnell ist die Stapelverarbeitung?",
                "faq_a7": "<p>Blitzschnell! 100 Dateien dauern fast so kurz wie eine einzige Datei, da sie parallel verarbeitet werden.</p>",
                "faq_q8": "🎨 Was ist 'Image to Prompt'?",
                "faq_a8": "<p>Erstellt aus einem Bild einen Text-Prompt für Midjourney oder DALL-E.</p>",
                "faq_q9": "🔒 Sind meine Daten privat?",
                "faq_a9": "<p><strong>100% Privat!</strong> Alles geschieht im Browser. Wir speichern KEINE Bilder.</p>",
                "faq_q10": "🔧 Fehlerbehebung",
                "faq_a10": "<ul><li>API-Fehler? Key prüfen.</li><li>Datei zu groß? Max 20MB.</li></ul>",
                "faq_q12": "💬 Hilfe & Feedback",
                "faq_a12": "<p>E-Mail an <strong>metagenp@gmail.com</strong>. Wir antworten innerhalb von 12 Stunden!</p>"
            },

            ru: {
                flag: '🇷🇺',
                name: 'RU',
                band: 'MetaGen Pro',
                tagline: 'Метаданные на базе ИИ',
                home: 'Главная',
                features: 'Функции',
                start_tour: 'Начать тур',
                faq: 'FAQ',
                menu: 'МЕНЮ',
                blog: 'Блог',
                disclaimer: 'Отказ от ответственности',
                about: 'О нас',
                contact: 'Контакты',
                legal: 'Юридическая инфо',
                select_lang: 'Выберите язык',
                general_btn: "Общий",
                save_key: 'Сохранить',
                close: 'Закрыть',
                get_key: 'Получить ключ',
                badge: 'Значок',
                try_metagen: 'Попробуйте MetaGen бесплатно',
                no_api: 'Для бесплатного пробного периода ключ API не требуется.',
                watting_for: 'Чего вы ждёте?',
                "get_start": "Начните бесплатно",
                "drag_and_drop": "Перетащите мышью в любое место для загрузки.",
                "fast": "Быстро",
                "best": "Лучший",
                "generate_meta": "Создать метаданные",
                "delete_select": "Удалить выбранное",
                "down_select": "Скачать выбранное",
                "translate_select": "Перевести выбранное",
                "done": "Готово",
                "processing": "Обработка",
                "analyzing_market": "Анализ рыночных трендов...",
                "ai_is_researching": "ИИ ищет для вас высокоэффективные концепции.",
                "analyzing": "Анализ...",
                "copy_tag": "Копировать теги",
                "copy_idea": "Копировать идею и инфо",
                "download": "Скачать",
                "enter_your_convert_api": "Введите ключ Convert API для включения конвертации EPS файлов.",
                "export_csv": "Экспорт в CSV",
                "export_excel": "Экспорт в Excel",
                "niche_research_cen": "Центр исследования ниш",
                "niche_research_tag": "Откройте для себя высоко востребованные ключевые слова и концепции с низкой конкуренцией для вашего стокового портфолио.",
                "select_category": "Выберите категорию",
                "market_focus": "Рыночный фокус",
                "analyze_trend": "Анализировать тренды",
                "ready_to_research": "Готов к исследованию",
                "ready_to_research_tag": "Выберите категорию выше и нажмите «Анализировать тренды», чтобы найти прибыльные ниши.",
                "quick_suggest": "Быстрые предложения",
                "label_title": "Заголовок",
                "label_desc": "Описание",
                "label_keywords": "Ключевые слова",
                "btn_copy": "Копировать",
                "btn_add": "Добавить",
                "placeholder_add_kw": "Добавить ключевое слово...",
                "seo_score": "SEO оценка",
                "rejection": "Отказ",
                "platform_check": "Проверка платформы",
                "style": "Стиль",
                "mode": "Режим",
                "translate": "Перевести",
                "go": "Перейти",
                "min_title": "Мин. слов в заголовке",
                "max_title": "Макс. слов в заголовке",
                "min_keywords": "Мин. ключевых слов",
                "max_keywords": "Макс. ключевых слов",
                "min_desc": "Мин. слов в описании",
                "max_desc": "Макс. слов в описании",
                "toggle_silhouette": "Силуэт",
                "toggle_vector": "Вектор / Режим иллюстрации",
                "toggle_white_bg": "Белый фон",
                "toggle_trans_bg": "Прозрачный фон",
                "toggle_custom_prompt": "Пользовательский промпт",
                "toggle_prohibited": "Запрещенные слова",
                "toggle_single_kw": "Однословные ключевые слова",
                "toggle_change_name": "Изменить имя файла",
                "toggle_name_title": "Имя файла как заголовок",
                "feedback_matters": "Ваш отзыв важен",
                "provide_feedback": "Пожалуйста, оставьте отзыв об инструменте?",
                "issue_type": "Тип проблемы",
                "general_feedback": "Общий отзыв",
                "bug_report": "Сообщение об ошибке",
                "feature_request": "Запрос на добавление функции",
                "your_mess": "Ваше сообщение",
                "send_feed": "Отправить отзыв",
                eps_meta: 'Создание и встраивание метаданных EPS',
                month: '/ месяц',
                pricing: 'Цены',
                ftp_upload: 'Прямая загрузка по FTP',
                ftp_upload_sub_txt: 'Загружайте файлы напрямую на стоковые сайты (Adobe Stock, Shutterstock, Magnific).',
                upgrade_plan: 'Улучшить тариф',
                stock_calendar: 'Стоковый календарь',
                get_access: 'Получить доступ',
                pricing_plan: 'Наш тарифный план',
                pricing_sub_txt: 'Выберите идеальный план для вашего творческого рабочего процесса.',
                free_plan: 'Бесплатный план',
                free_price: '$0/мес',
                most_popular: 'Самый популярный',
                pro_plan: 'Перейти на Pro',
                pro_price: '$12/мес',
                premium_plan: 'Премиум план',
                premium_price: '$29/мес',
                '50_image': '120 изображений в месяц (максимум 10 в день для соблюдения принципов добросовестного использования)',
                basic_ai_model: 'Базовые модели ИИ (Gemini, Mistral, Groq) Используйте свой собственный API-ключ.',
                batch_process: 'Пакетная обработка: до 50 файлов',
                csv_export: 'Экспорт в CSV',
                ads_support: 'С поддержкой рекламы',
                auto_embed: 'Автоматическое внедрение метаданных',
                excel_export: 'Экспорт в Excel',
                drag_keyword: 'Изменение порядка ключевых слов (Drag & Drop)',
                copy_trade_check: 'Проверка авторских прав/товарных знаков',
                get_started_free: 'Начать бесплатно',
                '300_images': '2000 изображений в месяц',
                advance_ai: 'Продвинутые модели ИИ (API-ключ не требуется).',
                batch_process_pro: 'Пакетная обработка: до 100 файлов',
                csv_excel_ex: 'Экспорт в CSV/Excel',
                seo_and_no_ads: 'SEO-аналитика и Без рекламы',
                support_time: 'Поддержка 24 часа',
                '1k_image': '3000 изображений в месяц',
                all_pro: 'Все функции Pro',
                batch_process_pre: 'Пакетная обработка: до 300 файлов',
                ftp_auto_up: 'Автоматическая загрузка FTP/SFTP',
                vector_eps: 'Прямая конвертация в Vector/EPS',
                vip_support: 'VIP-поддержка и Ранний доступ',
                privacy_policy: 'Политика конфиденциальности',
                terms_of_service: 'Условия использования',
                adjustment: 'Регулировка',
                multi_tool: 'Мульти-инструменты',
                sketch_art: 'Фото в скетч',
                all_tools: 'Все инструменты',
                image_enhance: 'ИИ Улучшение фото',
                bg_remove: 'ИИ Удаление фона',
                pixel_check: 'Студия Pixel-Check',
                text_to_image: 'Генератор текста в изображение',
                company: 'Компания',
                free_plan: 'Бесплатный план',
                note: 'Доступ к API будет отключен через 7 дней. Перейдите на тарифный план Pro/Premium и используйте все функции MetaGen Pro.',
                platform: 'Платформа',
                add_more: 'Добавить еще файлы',
                well_come: 'С возвращением',
                login_google: 'Продолжить с Google',
                new_user: 'Новый пользователь?',
                create_account: 'Создать аккаунт',
                niche_research: 'Исследование ниши',
                metadata_generator: 'Генератор метаданных',
                seo_score: 'SEO Оценка и Аналитика',
                batch_process: 'Сверхбыстрая пакетная обработка',
                sign_out: 'Выйти',
                switch_account: 'Сменить аккаунт',
                upload_title: 'Загрузить изображения или видео',
                drag_drop: 'Перетащите файлы сюда или нажмите для загрузки',
                supports: 'Поддержка JPG, PNG, WEBP, MP4, MOV',
                max_size: 'Макс 50МБ на файл',
                privacy_note: 'Ваши файлы надежно обрабатываются и удаляются через 1 час.',
                privacy_note_device: 'Мы анализируем файлы только на устройстве, данные удаляются после обработки.',
                upload_limit_info: 'Бесплатный план: 50 файлов/день',
                usage: 'Использование:',
                "daily_limit": "Дневной лимит обработки",
                refer_text: 'Поделитесь ссылкой на MetaGen Pro, чтобы получить дополнительный дневной лимит в +50!',
                "share_get_credit": "Поделитесь и получите кредиты",
                generate_metadata: 'Создать метаданные',
                "limit_reached_msg": "Вы достигли своего дневного лимита обработки! Обновите свой план для получения более высоких лимитов или поделитесь инструментом для получения бонуса.",
                export_csv: 'Экспорт в CSV',
                export_excel: 'Экспорт в Excel',
                clear_all: 'Очистить все',
                copy_all: 'Копировать все',
                down_eps: 'Скачать EPS',
                guides: 'Руководства',
                title: 'Заголовок',
                description: 'Описание',
                keywords: 'Ключевые слова',
                categories: 'Категории',
                already_user: 'Уже есть аккаунт?',
                login: 'Войти',
                tools_generator: 'Инструменты и Генератор',
                trending: '📅 В тренде...',
                customization: 'Настройка',
                settings: 'Настройки',
                select_ai: 'Выбрать ИИ провайдера',
                manage_api: 'Управление API ключами',
                convert_api: 'Ключ ConvertAPI',
                translation_lang: 'Язык перевода',
                upload_files: 'Загрузить файлы',
                watch_demo: 'Смотреть демо',
                watch_tagline: 'Узнайте, как увеличить продажи на стоках за секунды',
                process_selected: 'Обработать выбранное',
                process_prompts: 'Обработать промпты',
                embed_metadata: 'Встроить метаданные',
                export: 'Экспорт',
                batch_translate: 'Пакетный перевод (Бесплатно)',
                translate_all: 'Перевести все (API)',
                test_metadata: 'Тест метаданных',
                save_folder: 'Сохранить в папку',
                share_files: 'Поделиться файлами',
                upload_drive: 'Загрузить на Диск',
                pause: 'Пауза',
                image_to_prompt: 'Изображение в Промпт',
                jpg_png: 'JPG/PNG',
                svg_eps: 'SVG/EPS/AI',
                videos: 'Видео',
                check_copyright: 'Проверка авторских прав/ТМ:',
                upload_limit: 'Загружайте максимум 500 файлов за одно действие',
                resume: 'Продолжить',
                send_feedback: 'Отправить отзыв / Сообщить об ошибке',
                view_translated: 'Смотреть перевод',
                view_original: 'Смотреть оригинал',
                analyze_trends: 'Анализ трендов',
                downloading: 'Скачивание...',
                translating: 'Перевод...',
                embedding: 'Встраивание...',
                analyzing: 'Анализ...',
                processing: 'Обработка...',
                process: 'Процесс',
                files: 'Файлы',
                prompts: 'Промпты',
                complete: 'Готово',
                success: 'Успех',
                fail: 'Ошибка',
                saving: 'Сохранение...',
                preparing: 'Подготовка...',
                uploading: 'Загрузка...',
                initializing: 'Инициализация соединения...',
                processing_files: 'Обработка файлов...',
                "hero_title": "Бесплатный ИИ-генератор метаданных и ключевых слов для стоковых фото!",
                hero_tagline: 'Увеличьте видимость на Shutterstock, Adobe Stock и Magnific. Создавайте SEO-оптимизированные заголовки, описания и теги за секунды с помощью ИИ.',
                why_choose: 'Почему MetaGen Pro?',
                blog_1: 'Сверхбыстрая пакетная обработка',
                blog_tag_1: 'Анализируйте и тегируйте сотни изображений за секунды. Сэкономьте часы ручной работы с нашим оптимизированным пакетным движком.',
                blog_2: 'Продвинутый ИИ анализ',
                blog_tag_2: 'Работает на Gemini 1.5 Pro, Mistral и Llama 3 для лучшего в отрасли распознавания изображений и точных метаданных.',
                blog_3: 'SEO-оптимизированные ключевые слова',
                blog_tag_3: 'Создавайте рейтинговые заголовки и теги, специально адаптированные для алгоритмов Shutterstock, Adobe Stock и Magnific.',
                blog_4: 'Исследование ниши',
                blog_tag_4: 'Находите темы с низкой конкуренцией и высоким спросом с помощью нашего встроенного инструмента. Узнайте, что ищут покупатели.',
                blog_5: 'Перетаскивание порядка ключевых слов',
                blog_tag_5: 'На стоковых сайтах (Adobe Stock, Shutterstock) первые 5-10 ключевых слов являются самыми важными.',
                blog_6: 'Встраивание метаданных',
                blog_tag_6: 'Встраивайте заголовки и теги прямо в ваши файлы JPG/PNG/SVG (IPTC/XMP). Просто скачайте и загрузите в любое агентство.',
                blog_7: 'Мультиязычность',
                blog_tag_7: 'Переводите метаданные на 10+ языков мгновенно. Охватите глобальную аудиторию с локализованными заголовками и описаниями.',
                blog_8: 'Проверка авторских прав',
                blog_tag_8: 'Избегайте отклонений! Наш ИИ сканирует ваши изображения на наличие потенциальных проблем с товарными знаками и логотипами перед загрузкой.',
                blog_9: 'Экспорт метаданных CSV',
                blog_tag_9: 'Функция экспорта CSV для всех стоковых сайтов (Adobe Stock, Shutterstock, Magnific).',
                trusted_all: 'Нам доверяют на всех основных микростоковых платформах',
                it_works: 'Как это работает',
                upload_photos: 'Загрузите фото',
                upload_photos_tag: 'Перетащите ваши файлы JPG/PNG. Мы автоматически считываем размеры и технические характеристики.',
                select_platfrom: 'Выберите платформу и ИИ',
                select_platfrom_tag: 'Выберите целевой рынок (например, Adobe Stock) и предпочтительную модель ИИ (Gemini/Groq).',
                gen_down: 'Создать и Скачать',
                gen_down_tag: 'Получите готовые SEO заголовки и теги мгновенно. Скачайте CSV или встройте напрямую.',
                why_choose_stock_title: 'Почему выбирают MetaGen Pro для стоковой фотографии?',
                how_to_use_title: 'Как использовать инструмент?',
                master_stock_title: 'Овладейте стоковой фотографией с метаданными на основе ИИ',
                trusted_stock_title: 'Доверяют стоковые участники по всей территории США',
                why_choose_stock_p1: 'В конкурентном мире стоковой фотографии ключевым моментом является обнаруживаемость. Даже лучшие изображения не будут продаваться, если покупатели не смогут их найти. <strong>MetaGen Pro</strong> — это идеальный <em>ИИ-генератор метаданных</em>, созданный для решения этой проблемы.',
                why_choose_stock_p2: 'В отличие от ручного подбора ключевых слов, который утомителен и чреват ошибками, наш инструмент использует современное компьютерное зрение для анализа объекта, настроения, освещения и композиции вашего изображения. Затем он генерирует более 50 оптимизированных ключевых слов, запоминающиеся заголовки и подробные описания, адаптированные для таких платформ, как <strong>Shutterstock, Adobe Stock, Magnific и Vecteezy</strong>.',
                why_choose_stock_p3: 'Будь вы фотографом, иллюстратором или ИИ-художником, MetaGen Pro оптимизирует ваш рабочий процесс. Такие функции, как <strong>Изображение в Промпт</strong>, помогают вам анализировать успешные ИИ-изображения, а наш <strong>Прогнозировщик отказов</strong> помогает исправлять технические проблемы перед загрузкой.',
                why_choose_stock_p4: 'Начните максимизировать свой пассивный доход сегодня с помощью самого продвинутого бесплатного инструмента для тегирования стоковых фотографий.',

                master_stock_subtitle1: 'Как использовать MetaGen Pro',
                master_stock_p1: 'Начать работу с MetaGen Pro невероятно просто и не требует технических навыков. Сначала загрузите свои изображения, перетащив их в специальную область загрузки, или нажмите, чтобы просмотреть файлы. MetaGen Pro поддерживает все основные форматы изображений, включая JPG, PNG, SVG и EPS, а также видеофайлы. После загрузки изображений выберите целевую платформу (Shutterstock, Adobe Stock, Magnific или General), чтобы оптимизировать метаданные специально для этого маркетплейса.',
                master_stock_p2: 'Затем настройте свои предпочтения в боковой панели. Вы можете настроить количество ключевых слов (мы рекомендуем 35–50 для оптимального SEO), установить ограничения на длину заголовка и включить специальные функции, такие как векторный режим для иллюстраций или обнаружение белого фона для фотографий товаров. Выбор провайдера ИИ позволяет выбирать между моделями Google Gemini, Mistral AI или Groq Llama в зависимости от доступности вашего API и предпочтений по скорости.',
                master_stock_p3: 'После настройки нажмите кнопку «Process All», чтобы сгенерировать метаданные для всех загруженных изображений одновременно. Наш продвинутый ИИ анализирует визуальный контент, композицию, цвета, объекты и контекст каждого изображения для создания максимально релевантных заголовков, описаний и наборов ключевых слов. Весь процесс обычно занимает всего несколько секунд на одно изображение, даже при пакетной обработке сотен файлов.',
                master_stock_subtitle2: 'Преимущества использования этого инструмента',
                master_stock_benefit1: '<strong>Экономия времени:</strong> Ручной подбор ключевых слов может занимать 10–15 минут на одно изображение. MetaGen Pro сокращает это время до нескольких секунд, позволяя вам снабдить ключевыми словами сотни изображений за то время, которое потребовалось бы для ручной обработки всего нескольких штук. Для профессиональных авторов, загружающих 50–100 изображений в неделю, это означает экономию более 10 часов каждую неделю.',
                master_stock_benefit2: '<strong>SEO-оптимизация:</strong> Наш ИИ не просто описывает то, что видит, — он понимает поисковые намерения и алгоритмы маркетплейсов. Каждый набор метаданных включает стратегическое сочетание широких ключевых слов (высокий объем поиска), специфических низкочастотных ключевых слов (высокая конверсия) и трендовых терминов (текущий спрос). Встроенный измеритель SEO-показателя оценивает ваши метаданные в реальном времени, гарантируя, что каждая загрузка оптимизирована для максимальной видимости.',
                master_stock_benefit3: '<strong>Мультиплатформенная поддержка:</strong> У разных стоковых агентств разные требования и предпочтения. MetaGen Pro адаптируется к уникальному алгоритму каждой платформы: Shutterstock предпочитает иную структуру ключевых слов, чем Adobe Stock или Magnific. Наша оптимизация под конкретные платформы гарантирует, что ваши изображения будут занимать высокие позиции в поиске везде, куда бы вы их ни загрузили.',
                master_stock_benefit4: '<strong>Стабильность и качество:</strong> Исключите человеческий фактор и поддерживайте профессиональные стандарты во всем своем портфолио. MetaGen Pro гарантирует, что каждое изображение имеет правильно отформатированные метаданные, достаточное количество ключевых слов и соответствующие описания. Функция прогнозирования отказов анализирует ваши метаданные на соответствие общим критериям отказа, помогая избежать дорогостоящих неудач при отправке.',
                master_stock_subtitle3: 'Что такое SEO для изображений и почему это важно',
                master_stock_seo_p1: 'SEO для изображений (поисковая оптимизация) — это практика оптимизации метаданных изображений для улучшения их видимости в результатах поиска на фотостоках и в поисковых системах. Когда покупатель ищет «деловая встреча» или «закат на тропическом пляже», алгоритм платформы не «видит» ваше изображение — он читает предоставленные вами метаданные. Эффективное SEO для изображений — это разница между тем, появится ли ваша работа на 1-й или на 50-й странице результатов поиска.',
                master_stock_seo_p2: '<strong>Три столпа SEO для изображений:</strong> Во-первых, <em>Заголовок</em> должен быть описательным, но кратким (10–20 слов), содержать ваши основные ключевые слова и оставаться естественным и читабельным. Во-вторых, <em>Описание</em> дает контекст и варианты использования (30–50 слов), помогая как алгоритмам, так и покупателям понять коммерческое применение вашего изображения. В-третьих, <em>Ключевые слова</em> охватывают широкую сеть (рекомендуется 35–50 терминов), захватывая различные поисковые запросы, которые могут привести покупателей к вашему изображению.',
                master_stock_seo_p3: '<strong>Стратегия ключевых слов имеет значение:</strong> Наиболее эффективные метаданные используют сбалансированное сочетание: 20–30% ключевых слов из одного слова (широкий охват), 40–50% фраз из двух слов (средняя специфика) и 20–30% низкочастотных ключевых слов (высокая конверсия). Например, изображение рук, использующих смартфон, должно включать слова «руки» (широкий охват), «взаимодействие со смартфоном» (средняя специфика) и «руки, нажимающие на интерфейс мобильного приложения» (низкочастотный запрос). Эта стратегия максимизирует шансы на то, что ваше изображение появится как в широком, так и в специфическом поиске.',
                master_stock_seo_p4: '<strong>Факторы ранжирования в поиске:</strong> Стоковые платформы учитывают множество факторов при ранжировании результатов поиска. Релевантность (насколько ваши метаданные соответствуют поисковому запросу), полнота (правильное заполнение всех полей метаданных) и разнообразие ключевых слов (использование различных связанных терминов) — все это влияет на ваш рейтинг. Кроме того, коммерческая релевантность — описание того, как покупатели могут использовать ваше изображение, — существенно влияет на уровень конверсии, даже если ваше изображение занимает высокую позицию.',
                master_stock_seo_p5: 'MetaGen Pro автоматизирует все эти лучшие практики, гарантируя, что каждое загружаемое вами изображение полностью оптимизировано для максимальной видимости, скачиваний и, в конечном счете, дохода. Будь вы любителем или профессиональным стоковым фотографом, правильное SEO для изображений является обязательным условием на сегодняшнем конкурентном рынке.',
                master_stock_cta: '<strong>Готовы повысить свой успех в стоковой фотографии?</strong> Начните использовать MetaGen Pro сегодня и превратите часы утомительного подбора ключевых слов в секунды автоматизированного превосходства.',
                trusted_stock_subtitle: 'Узнайте, почему тысячи американских фотографов и создателей контента полагаются на MetaGen Pro для увеличения своих доходов от стоков',
                review_1_details: '📍 Нью-Йорк, штат Нью-Йорк • Профессиональный фотограф',
                review_1_text: '"MetaGen Pro полностью изменил мой рабочий процесс! Раньше я часами подбирала ключевые слова к своим фотографиям для Shutterstock. Теперь это занимает считанные минуты, а количество скачиваний выросло на 40%. Функция SEO-показателя просто блестящая!"',
                review_2_details: '📍 Лос-Анджелес, Калифорния • Создатель контента',
                review_2_text: '"Для создателя контента на полной ставке время — деньги. Этот инструмент экономит мне как минимум 10 часов в неделю на вводе метаданных. Пакетная обработка молниеносна, а ключевые слова, сгенерированные ИИ, всегда в точку. Лучшая инвестиция, которую я сделал в этом году!"',
                review_3_details: '📍 Майами, Флорида • Автор стокового контента',
                review_3_text: '"Сначала я была настроена скептически, но MetaGen Pro превзошел все ожидания. Предложения ключевых слов невероятно актуальны, а многоязычная функция помогла мне выйти на международных покупателей. Мои доходы на Adobe Stock удвоились всего за 3 месяца!"',
                review_4_details: '📍 Чикаго, Иллинойс • Графический дизайнер',
                review_4_text: '"Одна только функция проверки авторских прав стоит потраченных денег! Она уже несколько раз спасала меня от возможных отказов. В сочетании с автоматической генерацией метаданных этот инструмент просто необходим каждому, кто серьезно занимается стоковой фотографией."',
                review_5_details: '📍 Сиэтл, Вашингтон • Фотограф дикой природы',
                review_5_text: '"Я загружаю сотни фотографий природы каждый месяц. MetaGen Pro позволяет без труда управлять ими и оптимизировать их все. Функция экспорта в CSV идеально вписывается в мой рабочий процесс. Очень рекомендую коллегам!"',
                review_6_details: '📍 Остин, Техас • Видеограф-фрилансер',
                review_6_text: '"Настоящий прорыв для метаданных видео! ИИ точно идентифицирует сцены и генерирует идеальные заголовки. Видимость моего видеопортфолио на Shutterstock значительно улучшилась. Команда поддержки также очень отзывчива и полезна."',
                stat_users: 'Активные пользователи в США',
                stat_satisfaction: 'Уровень удовлетворенности',
                stat_images: 'Изображений оптимизируется ежедневно',
                stat_rating: 'Средний рейтинг',
                "faq_title": "Часто задаваемые вопросы — MetaGen Pro",
                "faq_q1": "🚀 С чего начать работу с MetaGen Pro?",
                "faq_a1": "<strong>Шаг 1:</strong> Войдите через Google или email.<br><strong>Шаг 2:</strong> Вставьте API-ключ Google Gemini в настройках (<a href='https://aistudio.google.com/app/apikey' target='_blank'>Google AI Studio</a>).<br><strong>Шаг 3:</strong> Загрузите фото (JPG, PNG, SVG, EPS) — до 500 файлов сразу!<br><strong>Шаг 4:</strong> Выберите платформу и нажмите 'Generate Metadata'.<br><strong>Шаг 5:</strong> Проверьте, внедрите метаданные и скачайте!",
                "faq_q2": "💰 Это бесплатно?",
                "faq_a2": "<p><strong>Бесплатные тарифы для всех!</strong> Metagen Pro предлагает мощный бесплатный тариф (120 изображений в месяц, максимум 25 в день). Однако для интенсивного использования у нас есть тарифы <strong>Pro</strong> (12 долларов в месяц - 2000 изображений в месяц, максимум 70 в день) и <strong>Premium</strong> (29 долларов в месяц - 3000 изображений в месяц, максимум 100 в день). Платные тарифы предлагают расширенные функции, такие как автоматическое встраивание метаданных, экспорт в Excel и прямая загрузка по FTP.</p>",
                "faq_q3": "🔑 Нужен ли API-ключ?",
                "faq_a3": "<p><strong>Нет, для всех тарифных планов теперь не требуется ключ API!</strong> Во всех тарифных планах, Free, Pro и Premium, мы обрабатываем метаданные, используя собственные серверы и выделенные модели искусственного интеллекта Supabase Edge Functions (расширенные модели ИИ).</p><p><strong>Безопасность:</strong> Все ваши данные полностью <strong>безопасны</strong> и удаляются с сервера сразу после обработки.</p>",
                "faq_q4": "📁 Какие форматы поддерживаются?",
                "faq_a4": "<p>JPG, PNG, SVG и EPS. Загрузка до <strong>500 файлов одновременно</strong>!</p>",
                "faq_q5": "🎯 Какие фотостоки поддерживаются?",
                "faq_a5": "<p>Shutterstock, Adobe Stock, Magnific, Vecteezy и др. ИИ адаптирует теги под требования каждой площадки.</p>",
                "faq_q6": "📊 Что такое SEO Score?",
                "faq_a6": "<p>Показатель оптимизации для поиска. 🟢 = одно слово, 🟡 = два слова, 🔵 = фразы.</p>",
                "faq_q7": "⚡ Как работает пакетная обработка?",
                "faq_a7": "<p>ИИ обрабатывает файлы параллельно. 100 файлов обрабатываются почти так же быстро, как один!</p>",
                "faq_q8": "🎨 Что такое 'Image to Prompt'?",
                "faq_a8": "<p>Превращает картинку в текстовое описание для Midjourney или DALL-E.</p>",
                "faq_q9": "🔒 Мои данные защищены?",
                "faq_a9": "<p><strong>Полная приватность!</strong> Мы не храним ваши изображения. Все удаляется сразу после обработки.</p>",
                "faq_q12": "💬 Поддержка",
                "faq_a12": "<p>Пишите на <strong>metagenp@gmail.com</strong>. Мы отвечаем в течение 12 часов!</p>"
            },

            fr: {
                flag: '🇫🇷',
                name: 'FR',
                band: 'MetaGen Pro',
                tagline: 'Métadonnées, propulsées par l\'IA',
                home: 'Accueil',
                features: 'Fonctionnalités',
                start_tour: 'Commencer la visite',
                faq: 'FAQ',
                menu: 'MENU',
                blog: 'Article de Blog',
                disclaimer: 'Clause de non-responsabilité',
                about: 'À propos de nous',
                contact: 'Contactez-nous',
                legal: 'Mentions légales',
                select_lang: 'Choisir la langue',
                general_btn: "Général",
                save_key: 'Enregistrer les clés',
                close: 'Fermer',
                get_key: 'Obtenir une clé',
                badge: 'Badge',
                try_metagen: 'Essayer MetaGen Pro',
                no_api: 'Aucune clé API requise pour votre essai',
                ref: 'Débloquez une limite quotidienne supplémentaire !',
                ref_text: 'Partagez MetaGen Pro. Lorsqu\'une personne s\'inscrit en cliquant sur votre lien de parrainage, votre limite de traitement quotidienne augmentera de +50 !',
                ref_share_btn: 'Partager maintenant',
                watting_for: 'Qu\'attendez-vous ?',
                "get_start": "Commencer gratuitement",
                "drag_and_drop": "Glissez-déposez n'importe où pour télécharger",
                "fast": "Rapide",
                "best": "Meilleur",
                "generate_meta": "Générer les métadonnées",
                "delete_select": "Supprimer la sélection",
                "down_select": "Télécharger la sélection",
                "translate_select": "Traduire la sélection",
                "done": "Terminé",
                "processing": "Traitement en cours",
                "analyzing_market": "Analyse des tendances du marché...",
                "ai_is_researching": "L'IA recherche des concepts performants pour vous.",
                "analyzing": "Analyse...",
                "copy_tag": "Copier les tags",
                "copy_idea": "Copier l'idée et les infos",
                "download": "Télécharger",
                "enter_your_convert_api": "Entrez votre clé Convert API pour activer la conversion des fichiers EPS.",
                "export_csv": "Exporter en CSV",
                "export_excel": "Exporter en Excel",
                "niche_research_cen": "Centre de recherche de niche",
                "niche_research_tag": "Découvrez des mots-clés et des concepts à forte demande et faible concurrence pour votre portfolio de stock.",
                "select_category": "Sélectionner une catégorie",
                "market_focus": "Focus sur le marché",
                "analyze_trend": "Analyser les tendances",
                "ready_to_research": "Prêt pour la recherche",
                "ready_to_research_tag": "Sélectionnez une catégorie ci-dessus et cliquez sur \"Analyser les tendances\" pour découvrir des niches rentables.",
                "quick_suggest": "Suggestions rapides",
                "label_title": "Titre",
                "label_desc": "Description",
                "label_keywords": "Mots-clés",
                "btn_copy": "Copier",
                "btn_add": "Ajouter",
                "placeholder_add_kw": "Ajouter un mot-clé...",
                "seo_score": "Score SEO",
                "rejection": "Rejet",
                "platform_check": "Vérification de plateforme",
                "style": "Style",
                "mode": "Mode",
                "translate": "Traduire",
                "go": "Aller",
                "min_title": "Mots min (Titre)",
                "max_title": "Mots max (Titre)",
                "min_keywords": "Mots-clés min",
                "max_keywords": "Mots-clés max",
                "min_desc": "Mots min (Description)",
                "max_desc": "Mots max (Description)",
                "toggle_silhouette": "Silhouette",
                "toggle_vector": "Mode Vecteur / Illustration",
                "toggle_white_bg": "Fond blanc",
                "toggle_trans_bg": "Fond transparent",
                "toggle_custom_prompt": "Prompt personnalisé",
                "toggle_prohibited": "Mots interdits",
                "toggle_single_kw": "Mots-clés à mot unique",
                "toggle_change_name": "Changer le nom du fichier",
                "toggle_name_title": "Nom du fichier comme titre",
                "feedback_matters": "Votre avis compte",
                "provide_feedback": "Veuillez donner votre avis sur l'outil",
                "issue_type": "Type de problème",
                "general_feedback": "Avis général",
                "bug_report": "Rapport de bug",
                "feature_request": "Demande de fonctionnalité",
                "your_mess": "Votre message",
                "send_feed": "Envoyer l'avis",
                "trial_credits": "Crédits d'essai",
                "trial_footer": "Les 10 premières images sont offertes ! Ajoutez votre clé API pour un usage illimité.",
                eps_meta: 'Génération et intégration de métadonnées EPS',
                month: '/ mois',
                pricing: 'Tarification',
                ftp_upload: 'Téléchargement direct FTP',
                ftp_upload_sub_txt: 'Téléchargez des fichiers directement sur les sites de stock (Adobe Stock, Shutterstock, Magnific).',
                upgrade_plan: 'Améliorer le plan',
                stock_calendar: 'Calendrier de Stock',
                get_access: 'Obtenir l\'accès',
                pricing_plan: 'Nos tarifs',
                pricing_sub_txt: 'Choisissez le plan parfait pour votre flux de travail créatif.',
                free_plan: 'Plan Gratuit',
                free_price: '0 $/mois',
                most_popular: 'Le plus populaire',
                pro_plan: 'Passer au Pro',
                pro_price: '12 $/mois',
                premium_plan: 'Plan Premium',
                premium_price: '29 $/mois',
                '50_image': '120 images par mois (Max 10/jour) + (Partage 50)',
                basic_ai_model: 'Modèles IA de base (Gemini, Mistral, Groq). Utilisez votre propre clé API.',
                batch_process: 'Traitement par lot : jusqu\'à 50 fichiers',
                csv_export: 'Export CSV',
                ads_support: 'Supporté par la publicité',
                auto_embed: 'Intégration automatique des métadonnées',
                excel_export: 'Export Excel',
                drag_keyword: 'Réorganisation des mots-clés par glisser-déposer',
                copy_trade_check: 'Vérification Copyright/Marque déposée',
                get_started_free: 'Commencer gratuitement',
                '300_images': '2000 images par mois',
                advance_ai: 'Modèles IA avancés (Clé API non requise.)',
                batch_process_pro: 'Traitement par lot : jusqu\'à 100 fichiers',
                csv_excel_ex: 'Export CSV/Excel',
                seo_and_no_ads: 'Analyses SEO & Sans publicité',
                support_time: 'Support 24h/24',
                '1k_image': '3000 images par mois',
                all_pro: 'Toutes les fonctionnalités Pro',
                batch_process_pre: 'Traitement par lot : jusqu\'à 300 fichiers',
                ftp_auto_up: 'Téléchargement auto FTP/SFTP',
                vector_eps: 'Conversion directe Vecteur/EPS',
                vip_support: 'Support VIP & Accès anticipé',
                privacy_policy: 'Politique de confidentialité',
                terms_of_service: 'Conditions d\'utilisation',
                adjustment: 'Ajustement',
                multi_tool: 'Outils Multi-Images',
                sketch_art: 'Image en Sketch Art',
                all_tools: 'Tous les outils',
                image_enhance: 'Amélioration d\'image IA',
                bg_remove: 'Suppression de fond IA',
                pixel_check: 'Pixel-Check Studio',
                text_to_image: 'Générateur de texte en image',
                company: 'Entreprise',

                platform: 'Plateforme',
                add_more: 'Ajouter plus de fichiers',
                well_come: 'Bon retour',
                login_google: 'Continuer avec Google',
                new_user: 'Nouvel utilisateur ?',
                create_account: 'Créer un compte',
                niche_research: 'Recherche de niche',
                metadata_generator: 'Générateur de métadonnées',
                sign_out: 'Se déconnecter',
                switch_account: 'Changer de compte',
                upload_title: 'Télécharger images ou vidéos',
                drag_drop: 'Glissez-déposez ici ou cliquez pour télécharger',
                supports: 'Supporte JPG, PNG, WEBP, MP4, MOV',
                max_size: 'Max 50 Mo par fichier',
                privacy_note: 'Vos fichiers sont traités en toute sécurité et supprimés après 1 heure.',
                privacy_note_device: 'Nous analysons les fichiers uniquement sur l\'appareil, les données sont purgées après traitement.',
                upload_limit_info: 'Plan : {{plan}} | Limite : {{limit}} fichiers/jour',
                usage: 'Utilisation :',
                "daily_limit": "Limite quotidienne de traitement",
                refer_text: 'Partagez MetaGen Pro pour obtenir +50 de limite quotidienne supplémentaire !',
                "share_get_credit": "Partager et obtenir des crédits de traitement",
                generate_metadata: 'Générer les métadonnées',
                "limit_reached_msg": "Vous avez atteint votre limite quotidienne ! Améliorez votre plan pour des limites plus élevées ou partagez l'outil pour un bonus.",
                export_csv: 'Exporter en CSV',
                export_excel: 'Exporter en Excel',
                clear_all: 'Tout effacer',
                copy_all: 'Tout copier',
                down_eps: 'Télécharger EPS',
                guides: 'Guides',
                title: 'Titre',
                description: 'Description',
                keywords: 'Mots-clés',
                categories: 'Catégories',
                already_user: 'Déjà un compte ?',
                login: 'Connexion',
                tools_generator: 'Outils & Générateur',
                trending: '📅 Tendances...',
                customization: 'Personnalisation',
                settings: 'Paramètres',
                select_ai: 'Choisir le fournisseur IA',
                manage_api: 'Gérer les clés API',
                convert_api: 'Clé ConvertAPI',
                translation_lang: 'Langue de traduction',
                upload_files: 'Télécharger des fichiers',
                watch_demo: 'Voir la démo',
                watch_tagline: 'Voyez comment booster vos ventes de stock en quelques secondes',
                process_selected: 'Traiter la sélection',
                process_prompts: 'Traiter les prompts',
                embed_metadata: 'Incruster les métadonnées',
                export: 'Exporter',
                batch_translate: 'Traduction groupée (Gratuit)',
                translate_all: 'Tout traduire (Pro)',
                test_metadata: 'Tester les métadonnées',
                save_folder: 'Enregistrer dans le dossier',
                upload_complete: 'Téléchargement terminé',
                share_files: 'Partager des fichiers',
                upload_drive: 'Télécharger sur Drive',
                pause: 'Pause',
                image_to_prompt: 'Image en Prompt',
                jpg_png: 'JPG/PNG',
                svg_eps: 'SVG/EPS/AI',
                videos: 'Vidéos',
                check_copyright: 'Vérifier Copyright/Marque déposée :',
                upload_limit: 'Téléchargez un maximum de 500 fichiers en une seule action',
                resume: 'Reprendre',
                send_feedback: 'Envoyer avis / Signaler bug',
                view_translated: 'Voir la version traduite',
                view_original: 'Voir l\'original',
                analyze_trends: 'Analyser les tendances',
                downloading: 'Téléchargement...',
                translating: 'Traduction...',
                embedding: 'Incrustation...',
                processing: 'Traitement...',
                process: 'Traiter',
                files: 'Fichiers',
                prompts: 'Prompts',
                complete: 'Terminé',
                success: 'Succès',
                fail: 'Échec',
                saving: 'Enregistrement...',
                preparing: 'Préparation...',
                uploading: 'Téléchargement...',
                initializing: 'Initialisation de la connexion...',
                "faq_q1": "Comment utiliser MetaGen Pro ?",
                "faq_a1": "Téléchargez vos photos/vidéos de stock -> Sélectionnez le modèle IA -> Cliquez sur 'Générer les métadonnées' -> Vérifiez et téléchargez !",
                "faq_q2": "MetaGen Pro est-il gratuit ? Quels sont les prix ?",
                "faq_a2": "<p><strong>Gratuit pour tout le monde !</strong> MetaGen Pro propose un plan gratuit robuste (120 images/mois (Max 25/jour)). Pour les gros utilisateurs, nous avons les plans <strong>Pro</strong> (12 $/mois - 2120 images/mois (Max 25/jour)) et <strong>Premium</strong> (29 $/mois - 3000 images/mois (Max 100/jour)) avec des fonctionnalités avancées comme l'export Excel et le téléchargement FTP direct.</p>",
                "faq_q3": "Mes données sont-elles en sécurité ?",
                "faq_a3": "Oui, nous traitons toutes les données sur l'appareil ou via des terminaux IA sécurisés et les supprimons immédiatement après usage.",
                "faq_q4": "Quels formats sont supportés ?",
                "faq_a4": "Actuellement, nous supportons JPG, PNG, WEBP, MP4, MOV. Le support pour SVG et EPS est disponible via ConvertAPI.",
                "faq_q5": "Puis-je améliorer mon plan ?",
                "faq_a5": "Oui ! Vous pouvez passer à un plan supérieur à tout moment depuis la section Tarification. Contactez-nous à metagenp@gmail.com pour les détails de facturation en accès anticipé.",
                "faq_q6": "Comment obtenir plus de limites quotidiennes ?",
                "faq_a6": "Vous pouvez obtenir +50 limites quotidiennes supplémentaires en parrainant vos amis ! Trouvez votre lien de parrainage dans le profil.",
                "hero_title": "Générateur de métadonnées IA gratuit et mots-clés pour photos de stock !",
                hero_tagline: 'Boostez votre visibilité sur Shutterstock, Adobe Stock et Magnific. Générez des titres, descriptions et mots-clés optimisés pour le SEO en quelques secondes grâce à l\'IA avancée.',
                why_choose: 'Pourquoi choisir MetaGen Pro ?',
                blog_1: 'Traitement par lot ultra-rapide',
                blog_tag_1: 'Analysez et indexez des centaines d\'images en quelques secondes. Économisez des heures de travail manuel grâce à notre moteur de traitement par lot optimisé.',
                blog_2: 'Analyse IA avancée',
                blog_tag_2: 'Propulsé par Gemini 1.5 Pro, Mistral et Llama 3 pour une reconnaissance d\'image leader du secteur et des métadonnées précises.',
                blog_3: 'Mots-clés optimisés SEO',
                blog_tag_3: 'Générez des titres et des tags à haut classement, spécifiquement adaptés aux algorithmes de Shutterstock, Adobe Stock et Magnific.',
                blog_4: 'Recherche de niche',
                blog_tag_4: 'Découvrez des sujets à faible concurrence et à forte demande avec notre outil intégré de recherche de niche. Trouvez ce que les acheteurs recherchent.',
                blog_5: 'Réorganisation des mots-clés par glisser-déposer',
                blog_tag_5: 'Sur les sites de stock (Adobe Stock, Shutterstock), les 5 à 10 premiers mots-clés sont les plus importants. Gérez-les facilement.',
                blog_6: 'Incrustation de métadonnées',
                blog_tag_6: 'Incrustez des titres et des mots-clés directement dans vos fichiers JPG/PNG/SVG (IPTC/XMP). Téléchargez simplement et envoyez-les à n\'importe quelle agence.',
                blog_7: 'Multi-langue',
                blog_tag_7: 'Traduisez vos métadonnées en plus de 10 langues instantanément. Atteignez un public mondial avec des titres et descriptions localisés.',
                blog_8: 'Vérification du Copyright',
                blog_tag_8: 'Évitez les rejets ! Notre IA scanne les problèmes potentiels de marque déposée et les logos dans vos images avant de les télécharger.',
                blog_9: 'Exportation CSV des métadonnées',
                blog_tag_9: 'Facilité d\'exportation de fichiers CSV pour tous les sites de stock (Adobe Stock, Shutterstock, Magnific).',
                trusted_all: 'Approuvé pour toutes les principales plateformes de Microstock',
                it_works: 'Comment ça marche',
                upload_photos: 'Télécharger les photos',
                upload_photos_tag: 'Glissez-déposez vos fichiers JPG/PNG. Nous lisons automatiquement les dimensions et les spécifications techniques.',
                select_platfrom: 'Sélectionner la plateforme et l\'IA',
                select_platfrom_tag: 'Choisissez votre marché cible (ex. Adobe Stock) et votre modèle IA préféré (Gemini/Groq).',
                gen_down: 'Générer et télécharger',
                gen_down_tag: 'Obtenez instantanément des titres et mots-clés prêts pour le SEO. Téléchargez le CSV ou incrustez-les directement.',
                processing_files: 'Traitement des fichiers...',
                why_choose_stock_title: 'Pourquoi choisir MetaGen Pro pour la photographie de stock ?',
                how_to_use_title: 'Comment utiliser l\'outil ?',
                master_stock_title: 'Maîtrisez votre photographie de stock avec des métadonnées propulsées par l\'IA',
                trusted_stock_title: 'Approuvé par les contributeurs de stock à travers le monde',
                why_choose_stock_p1: 'Dans le monde compétitif de la photographie de stock, la découvrabilité est la clé. Même les meilleures images ne se vendront pas si les acheteurs ne peuvent pas les trouver. <strong>MetaGen Pro</strong> est le <em>Générateur de métadonnées IA</em> ultime conçu pour résoudre ce problème.',
                why_choose_stock_p2: 'Contrairement à l\'indexation manuelle qui est fastidieuse et sujette aux erreurs, notre outil utilise une vision par ordinateur de pointe pour analyser le sujet, l\'ambiance, l\'éclairage et la composition de votre image. Il génère ensuite plus de 50 mots-clés optimisés, des titres accrocheurs et des descriptions détaillées adaptées à des plateformes comme <strong>Shutterstock, Adobe Stock, Magnific et Vecteezy</strong>.',
                why_choose_stock_p3: 'Que vous soyez photographe, illustrateur ou artiste IA, MetaGen Pro simplifie votre flux de travail. Des fonctionnalités comme <strong>Image-to-Prompt</strong> vous aident à rétro-concevoir des images IA réussies, tandis que notre <strong>Prédicteur de rejet</strong> vous aide à corriger les problèmes techniques avant le téléchargement.',
                why_choose_stock_p4: 'Commencez à maximiser votre revenu passif dès aujourd\'hui avec l\'étiqueteur de photos de stock gratuit le plus avancé disponible.',
                "plan_details_title": "Quel plan vous convient le mieux ?",
                "plan_details_free": "Plan Gratuit - Idéal pour les débutants",
                "plan_details_free_p1": "Notre plan gratuit est conçu pour les amateurs et les nouveaux contributeurs de stock. Il vous permet de traiter jusqu'à <strong>120 images par mois (Max 25/jour)</strong>. Pour garder le service complètement gratuit, Vous avez accès à nos fonctionnalités de base, y compris le traitement par lot ultra-rapide (jusqu'à 50 fichiers à la fois), la génération de métadonnées par IA et l'exportation CSV. Notez que les fonctionnalités avancées comme l'incrustation automatique, l'exportation Excel et les vérifications de copyright ne sont pas incluses dans ce plan.",
                "plan_details_pro": "Plan Pro - Pour les professionnels",
                "plan_details_pro_p1": "Le plan Pro est conçu pour les contributeurs réguliers qui souhaitent maximiser leur flux de travail et gagner des heures. Avec une limite généreuse de <strong>2000 images par mois (Max 70/jour)</strong>, vous n'avez plus besoin d'apporter vos propres clés API — nous gérons toutes les requêtes IA de manière sécurisée. Ce plan débloque des outils puissants comme l'<strong>Incrustation automatique des métadonnées</strong> directement dans vos fichiers JPEG/PNG/SVG, la réorganisation des mots-clés par glisser-déposer, la vérification IA du copyright/marque déposée et l'exportation Excel. Il augmente également votre limite de traitement par lot à 100 fichiers à la fois et offre une expérience sans publicité.",
                "plan_details_premium": "Plan Premium - Pour les utilisateurs intensifs et les agences",
                "plan_details_premium_p1": "Conçu pour les créateurs à gros volume, les artistes vectoriels et les agences, le plan Premium offre une limite massive de <strong>3000 images par mois (Max 100/jour)</strong> et une limite de lot de 300 fichiers. Il comprend tout ce qui se trouve dans le plan Pro, plus des fonctionnalités d'automatisation avancées. Vous obtenez un accès exclusif à la <strong>conversion directe Vecteur/EPS</strong> (pas besoin de clés ConvertAPI tierces) et à la fonction de <strong>Téléchargement auto FTP/SFTP</strong>. Cela vous permet de distribuer automatiquement vos fichiers traités et vos métadonnées directement vers plusieurs agences de stock (Shutterstock, Adobe Stock, Magnific, etc.) directement depuis votre navigateur.",
                "htu_step1_title": "1. Télécharger les fichiers",
                "htu_step1_desc": "Glissez-déposez des images (JPG/PNG), des vecteurs (SVG/EPS) ou des vidéos pour commencer.",
                "htu_step2_title": "2. Plateforme cible",
                "htu_step2_desc": "Sélectionnez Shutterstock, Adobe Stock ou Magnific pour des résultats optimisés.",
                "htu_step3_title": "3. Sélection du modèle IA",
                "htu_step3_desc": "Choisissez entre Gemini, Mistral ou Groq pour l'analyse d'image.",
                "htu_step4_title": "4. Personnalisation",
                "htu_step4_desc": "Ajustez le nombre min/max de mots pour les titres et les mots-clés à l'aide des curseurs.",
                "htu_step5_title": "5. Paramètres IA",
                "htu_step5_desc": "Activez le mode vecteur, le fond blanc ou utilisez vos propres prompts personnalisés.",
                "htu_step6_title": "6. Générer les métadonnées",
                "htu_step6_desc": "Cliquez sur 'Traiter la sélection' pour obtenir instantanément des titres et des tags prêts pour le SEO.",
                "htu_step7_title": "7. Incruster les métadonnées",
                "htu_step7_desc": "Écrivez directement les métadonnées dans vos fichiers JPG, PNG ou SVG.",
                "htu_step8_title": "8. Multi-traduction",
                "htu_step8_desc": "Traduisez les métadonnées en plus de 10 langues pour un marché mondial.",
                "htu_step9_title": "9. Exporter les résultats",
                "htu_step9_desc": "Téléchargez toutes vos métadonnées sous forme de CSV ou de feuilles Excel professionnelles.",
                "htu_step10_title": "10. Enregistrer et Drive",
                "htu_step10_desc": "Enregistrez dans un dossier local, partagez via un lien ou téléchargez directement sur Drive.",
                master_stock_subtitle1: 'Comment utiliser MetaGen Pro',
                master_stock_p1: 'Commencer avec MetaGen Pro est incroyablement simple et ne nécessite aucune expertise technique. Tout d\'abord, téléchargez vos images en les faisant glisser dans la zone de téléchargement désignée, ou cliquez pour parcourir vos fichiers. MetaGen Pro supporte tous les formats d\'image majeurs, y compris JPG, PNG, SVG et EPS, ainsi que les fichiers vidéo. Une fois vos images téléchargées, sélectionnez votre plateforme cible (Shutterstock, Adobe Stock, Magnific ou Général) pour optimiser les métadonnées spécifiquement pour ce marché.',
                master_stock_p2: 'Ensuite, configurez vos préférences en utilisant les paramètres de la barre latérale. Vous pouvez ajuster le nombre de mots-clés (nous recommandons 35-50 pour un SEO optimal), définir des contraintes de longueur de titre et activer des fonctionnalités spéciales comme le Mode Vecteur pour les illustrations ou la détection de Fond Blanc pour les images de produits. La sélection du fournisseur IA vous permet de choisir entre les modèles Google Gemini, Mistral AI ou Groq Llama en fonction de la disponibilité de votre API et de vos préférences de vitesse.',
                master_stock_p3: 'Après la configuration, cliquez sur le bouton "Traiter tout" pour générer les métadonnées de toutes les images téléchargées simultanément. Notre IA avancée analyse le contenu visuel de chaque image, sa composition, ses couleurs, ses sujets et son contexte pour créer des titres, des descriptions et des ensembles de mots-clés hautement pertinents. L\'ensemble du processus ne prend généralement que quelques secondes par image, même lors du traitement de centaines de fichiers en mode batch.',
                master_stock_subtitle2: 'Avantages de l\'utilisation de cet outil',
                master_stock_benefit1: '<strong>Efficacité temporelle :</strong> L\'indexation manuelle peut prendre 10 à 15 minutes par image. MetaGen Pro réduit cela à quelques secondes, vous permettant d\'indexer des centaines d\'images dans le temps qu\'il faudrait pour n\'en traiter que quelques-unes manuellement. Pour les contributeurs professionnels téléchargeant 50 à 100 images par semaine, cela se traduit par une économie de plus de 10 heures chaque semaine.',
                master_stock_benefit2: '<strong>Optimisation SEO :</strong> Notre IA ne se contente pas de décrire ce qu\'elle voit — elle comprend l\'intention de recherche et les algorithmes du marché. Chaque ensemble de métadonnées comprend un mélange stratégique de mots-clés larges (gros volume de recherche), de mots-clés spécifiques de longue traîne (conversion élevée) et de termes tendance (demande actuelle). Le score SEO intégré évalue vos métadonnées en temps réel.',
                master_stock_benefit3: '<strong>Support Multi-Plateforme :</strong> Différentes agences de stock ont des exigences différentes. MetaGen Pro s\'adapte à l\'algorithme unique de chaque plateforme — Shutterstock préfère des structures de mots-clés différentes de celles d\'Adobe Stock ou de Magnific. Notre optimisation spécifique à la plateforme garantit que vos images sont bien classées partout où vous les téléchargez.',
                master_stock_benefit4: '<strong>Cohérence et Qualité :</strong> Éliminez l\'erreur humaine et maintenez des normes professionnelles sur l\'ensemble de votre portfolio. MetaGen Pro garantit que chaque image a des métadonnées correctement formatées, une quantité de mots-clés adéquate et des descriptions appropriées. La fonction de prédicteur de rejet analyse vos métadonnées par rapport aux critères de rejet courants.',
                master_stock_subtitle3: 'Qu\'est-ce que le SEO d\'image et pourquoi c\'est important',
                master_stock_seo_p1: 'Le SEO d\'image (Search Engine Optimization) est la pratique consistant à optimiser les métadonnées d\'une image pour améliorer sa visibilité dans les résultats de recherche. Lorsqu\'un acheteur recherche "réunion d\'affaires" ou "coucher de soleil sur une plage tropicale", l\'algorithme de la plateforme ne "voit" pas votre image — il lit les métadonnées que vous avez fournies. Un SEO d\'image efficace est la différence entre apparaître en page 1 ou en page 50.',
                master_stock_seo_p2: '<strong>Les trois piliers du SEO d\'image :</strong> Premièrement, le <em>Titre</em> doit être descriptif mais concis (10-20 mots). Deuxièmement, la <em>Description</em> fournit le contexte et les cas d\'utilisation (30-50 mots). Troisièmement, les <em>Mots-clés</em> jettent un large filet (35-50 termes recommandés), capturant diverses requêtes de recherche.',
                master_stock_seo_p3: '<strong>La stratégie de mots-clés compte :</strong> Les métadonnées les plus efficaces utilisent un mélange équilibré : 20-30% de mots-clés à mot unique (portée large), 40-50% de phrases de deux mots (spécificité moyenne) et 20-30% de mots-clés de longue traîne (conversion élevée). Cette stratégie maximise vos chances d\'apparaître dans les recherches larges et spécifiques.',
                master_stock_seo_p4: '<strong>Facteurs de classement de recherche :</strong> Les plateformes de stock considèrent plusieurs facteurs : la pertinence, la complétude des champs et la diversité des mots-clés. De plus, la pertinence commerciale — décrire comment les acheteurs peuvent utiliser votre image — impacte considérablement les taux de conversion.',
                master_stock_seo_p5: 'MetaGen Pro automatise toutes ces meilleures pratiques, garantissant que chaque image que vous téléchargez est entièrement optimisée pour une visibilité, des téléchargements et, en fin de compte, des revenus maximums.',
                master_stock_cta: '<strong>Prêt à booster votre succès en photographie de stock ?</strong> Commencez à utiliser MetaGen Pro dès aujourd\'hui.',
                trusted_stock_subtitle: 'Découvrez pourquoi des milliers de photographes et créateurs font confiance à MetaGen Pro pour booster leurs revenus de stock',
                review_1_details: '📍 New York, NY • Photographe Professionnel',
                review_1_text: '"MetaGen Pro a complètement transformé mon flux de travail ! Je passais des heures à indexer mes photos pour Shutterstock. Maintenant, cela ne prend que quelques minutes et mes téléchargements ont augmenté de 40%. La fonction de score SEO est géniale !"',
                review_2_details: '📍 Los Angeles, CA • Créateur de Contenu',
                review_2_text: '"En tant que créateur de contenu à plein temps, le temps c\'est de l\'argent. Cet outil me fait gagner au moins 10 heures par semaine sur la saisie des métadonnées. Le traitement par lot est ultra-rapide et les mots-clés générés par l\'IA sont parfaits !"',
                review_3_details: '📍 Miami, FL • Contributeur Stock',
                review_3_text: '"J\'étais sceptique au début, mais MetaGen Pro a dépassé toutes mes attentes. Les suggestions de mots-clés sont incroyablement pertinentes et la fonction multi-langue m\'a aidé à atteindre des acheteurs internationaux. Mes revenus sur Adobe Stock ont doublé en 3 mois !"',
                review_4_details: '📍 Chicago, IL • Designer Graphique',
                review_4_text: '"La fonction de vérification du copyright vaut à elle seule le prix ! Elle m\'a sauvé de rejets potentiels à plusieurs reprises. Combiné à la génération automatique de métadonnées, cet outil est indispensable pour quiconque est sérieux au sujet du stock."',
                review_5_details: '📍 Seattle, WA • Photographe de Nature',
                review_5_text: '"Je télécharge des centaines de photos de nature chaque mois. MetaGen Pro facilite la gestion et l\'optimisation de toutes ces photos. L\'export CSV s\'intègre parfaitement à mon flux de travail. Je le recommande vivement !"',
                review_6_details: '📍 Austin, TX • Vidéaste Freelance',
                review_6_text: '"Un changement radical pour les métadonnées vidéo ! L\'IA identifie avec précision les scènes et génère des titres parfaits. La visibilité de mon portfolio vidéo sur Shutterstock s\'est considérablement améliorée. L\'équipe de support est également très réactive."',
                stat_users: 'Utilisateurs actifs aux USA',
                stat_satisfaction: 'Taux de satisfaction',
                stat_images: 'Images optimisées quotidiennement',
                stat_rating: 'Note moyenne',
                "faq_title": "FAQ — MetaGen Pro",
                "faq_q1": "🚀 Comment démarrer avec MetaGen Pro ?",
                "faq_a1": "<strong>Étape 1 :</strong> Inscrivez-vous ou connectez-vous avec Google.<br><strong>Étape 2 :</strong> Configurez votre clé API Google Gemini dans les Paramètres.<br><strong>Étape 3 :</strong> Téléchargez vos images (JPG, PNG, SVG, EPS).<br><strong>Étape 4 :</strong> Sélectionnez la plateforme et cliquez sur 'Générer les métadonnées'.<br><strong>Étape 5 :</strong> Vérifiez et téléchargez !",
                "faq_q2": "💰 MetaGen Pro est-il gratuit ? Quels sont les tarifs ?",
                "faq_a2": "<p><strong>Un plan gratuit pour tous !</strong> MetaGen Pro propose un plan gratuit performant (120 images/mois, maximum 25 par jour). Cependant, pour une utilisation intensive, nous proposons les plans <strong>Pro</strong> (12 $/mois - 2 000 images/mois, max 70 par jour) et <strong>Premium</strong> (29 $/mois - 3 000 images/mois, max 100 par jour). Les plans payants incluent des fonctionnalités avancées telles que l'auto-intégration des métadonnées, l'exportation Excel et le téléchargement direct par FTP.</p>",
                "faq_q3": "🔑 Ai-je besoin d'une clé API pour utiliser MetaGen Pro ?",
                "faq_a3": "<p><strong>Non, aucune clé API n'est requise pour aucun de nos plans !</strong> Pour tous les plans (Free, Pro et Premium), nous traitons les métadonnées à l'aide de nos propres serveurs et des Supabase Edge Functions avec des modèles d'IA dédiés (modèles d'IA avancés).</p><p><strong>Sécurité :</strong> Toutes vos données sont totalement <strong>sécurisées</strong> et sont immédiatement supprimées du serveur une fois le traitement terminé.</p>",
                "faq_q4": "📁 Quels formats de fichiers sont supportés ?",
                "faq_a4": "JPG/JPEG, PNG, WEBP, MP4, MOV et SVG. L'EPS est supporté via ConvertAPI. Téléchargez jusqu'à 500 fichiers à la fois !",
                "faq_q9": "🔒 Mes données sont-elles privées ?",
                "faq_a9": "<p><strong>100% Privé !</strong> Le traitement se fait dans votre navigateur. Nous ne stockons JAMAIS vos images. Les données sont purgées après traitement.</p>",
                "faq_q12": "💬 Comment obtenir de l'aide ?",
                "faq_a12": "<p>Envoyez-nous un email à <strong>metagenp@gmail.com</strong> ou utilisez le bouton Feedback. Nous répondons sous 12 heures !</p>"

            },

            ja: {
                flag: '🇯🇵',
                name: 'JP',
                band: 'MetaGen Pro',
                tagline: 'AIによるメタデータ生成',
                home: 'ホーム',
                features: '機能',
                start_tour: 'ツアーを開始',
                faq: 'よくある質問',
                menu: 'メニュー',
                blog: 'ブログ記事',
                disclaimer: '免責事項',
                about: '私たちについて',
                contact: 'お問い合わせ',
                legal: '法的情報',
                select_lang: '言語を選択',
                general_btn: "一般",
                save_key: 'キーを保存',
                close: '閉じる',
                get_key: 'キーを取得',
                badge: 'バッジ',
                try_metagen: 'MetaGen Proを試す',
                no_api: 'トライアルにAPIキーは不要です',
                ref: '毎日の制限を解除！',
                ref_text: 'MetaGen Proを共有しましょう。紹介リンクから誰かが参加すると、1日の処理制限が+50増加します！',
                ref_share_btn: '今すぐ共有',
                watting_for: '何を待っていますか？',
                "get_start": "無料で始める",
                "drag_and_drop": "どこにでもドラッグ＆ドロップしてアップロード",
                "fast": "高速",
                "best": "最高",
                "generate_meta": "メタデータを生成",
                "delete_select": "選択項目を削除",
                "down_select": "選択項目をダウンロード",
                "translate_select": "選択項目を翻訳",
                "done": "完了",
                "processing": "処理中",
                "analyzing_market": "市場トレンドを分析中...",
                "ai_is_researching": "AIがパフォーマンスの高いコンセプトをリサーチしています。",
                "analyzing": "分析中...",
                "copy_tag": "タグをコピー",
                "copy_idea": "アイデアと情報をコピー",
                "download": "ダウンロード",
                "enter_your_convert_api": "EPSファイルの変換を有効にするには、Convert APIキーを入力してください。",
                "export_csv": "CSV書き出し",
                "export_excel": "Excel書き出し",
                "niche_research_cen": "ニッチリサーチセンター",
                "niche_research_tag": "ストックポートフォリオ向けに、需要が高く競争の少ないキーワードやコンセプトを見つけましょう。",
                "select_category": "カテゴリを選択",
                "market_focus": "市場フォーカス",
                "analyze_trend": "トレンドを分析",
                "ready_to_research": "リサーチの準備完了",
                "ready_to_research_tag": "上記のカテゴリを選択し、「トレンドを分析」をクリックして収益性の高いニッチを見つけてください。",
                "quick_suggest": "クイック提案",
                "label_title": "タイトル",
                "label_desc": "説明",
                "label_keywords": "キーワード",
                "btn_copy": "コピー",
                "btn_add": "追加",
                "placeholder_add_kw": "キーワードを追加...",
                "seo_score": "SEOスコア",
                "rejection": "却下理由",
                "platform_check": "プラットフォームチェック",
                "style": "スタイル",
                "mode": "モード",
                "translate": "翻訳",
                "go": "実行",
                "min_title": "最小タイトル単語数",
                "max_title": "最大タイトル単語数",
                "min_keywords": "最小キーワード数",
                "max_keywords": "最大キーワード数",
                "min_desc": "最小説明単語数",
                "max_desc": "最大説明単語数",
                "toggle_silhouette": "シルエット",
                "toggle_vector": "ベクター / イラストモード",
                "toggle_white_bg": "白背景",
                "toggle_trans_bg": "透明背景",
                "toggle_custom_prompt": "カスタムプロンプト",
                "toggle_prohibited": "禁止用語",
                "toggle_single_kw": "単一単語キーワード",
                "toggle_change_name": "ファイル名を変更",
                "toggle_name_title": "ファイル名をタイトルにする",
                "feedback_matters": "フィードバックをお願いします",
                "provide_feedback": "ツールについてのフィードバックをお寄せください。",
                "issue_type": "問題の種類",
                "general_feedback": "一般的なフィードバック",
                "bug_report": "バグ報告",
                "feature_request": "機能リクエスト",
                "your_mess": "メッセージ",
                "send_feed": "フィードバックを送信",
                "trial_credits": "トライアルクレジット",
                "trial_footer": "最初の10枚は無料です！無制限に利用するにはAPIキーを追加してください。",
                eps_meta: 'EPSメタデータ生成と埋め込み',
                month: '/ 月',
                pricing: '料金',
                ftp_upload: 'FTP直接アップロード',
                ftp_upload_sub_txt: 'ストックサイト（Adobe Stock, Shutterstock, Magnific）へファイルを直接アップロードします。',
                upgrade_plan: 'プランをアップグレード',
                stock_calendar: 'ストックカレンダー',
                get_access: 'アクセス権を取得',
                pricing_plan: '料金プラン',
                pricing_sub_txt: 'あなたのクリエイティブなワークフローに最適なプランをお選びください。',
                free_plan: '無料プラン',
                free_price: '$0/月',
                most_popular: '一番人気',
                pro_plan: 'Proへアップグレード',
                pro_price: '$12/月',
                premium_plan: 'プレミアムプラン',
                premium_price: '$29/月',
                '50_image': '月120枚まで（フェアユースの範囲内であれば1日最大25枚まで）',
                basic_ai_model: '基本AIモデル（Gemini, Mistral, Groq）ご自身のAPIキーを使用。',
                batch_process: '一括処理：最大50ファイル',
                csv_export: 'CSV書き出し',
                ads_support: '広告あり',
                auto_embed: 'メタデータの自動埋め込み',
                excel_export: 'Excel書き出し',
                drag_keyword: 'ドラッグ＆ドロップによるキーワードの並べ替え',
                copy_trade_check: '著作権/商標チェック',
                get_started_free: '無料で始める',
                '300_images': '月間2000枚の画像',
                advance_ai: '高度なAIモデル（APIキー不要）',
                batch_process_pro: '一括処理：最大100ファイル',
                csv_excel_ex: 'CSV/Excel書き出し',
                seo_and_no_ads: 'SEO分析＆広告なし',
                support_time: '24時間サポート',
                '1k_image': '月間3000枚の画像',
                all_pro: 'すべてのPro機能',
                batch_process_pre: '一括処理：最大300ファイル',
                ftp_auto_up: 'FTP/SFTP自動アップロード',
                vector_eps: 'ベクター/EPSへの直接変換',
                vip_support: 'VIPサポート＆早期アクセス',
                privacy_policy: 'プライバシーポリシー',
                terms_of_service: '利用規約',
                adjustment: '調整',
                multi_tool: 'マルチ画像ツール',
                sketch_art: '画像からスケッチアートへ',
                all_tools: 'すべてのツール',
                image_enhance: 'AI画像高画質化',
                bg_remove: 'AI背景削除',
                pixel_check: 'ピクセルチェックスタジオ',
                text_to_image: 'テキストから画像生成',
                company: '会社',
                note: 'APIへのアクセスは7日後に削除されます。Pro/Premiumプランにアップグレードして、MetaGen Proのすべての機能をご活用ください。',
                platform: 'プラットフォーム',
                add_more: 'ファイルを追加',
                well_come: 'お帰りなさい',
                login_google: 'Googleで続行',
                new_user: '初めての方ですか？',
                create_account: 'アカウントを作成',
                niche_research: 'ニッチリサーチ',
                metadata_generator: 'メタデータジェネレーター',
                seo_score: 'SEOスコア＆分析',
                sign_out: 'サインアウト',
                switch_account: 'アカウントを切り替える',
                upload_title: '画像または動画をアップロード',
                drag_drop: 'ファイルをここにドラッグ＆ドロップ、またはクリックしてアップロード',
                supports: '対応形式: JPG, PNG, WEBP, MP4, MOV',
                max_size: '1ファイル最大50MB',
                privacy_note: 'ファイルは安全に処理され、1時間後に削除されます。',
                privacy_note_device: 'ファイルはデバイス上でのみ分析され、処理後にデータは消去されます。',
                upload_limit_info: 'プラン: {{plan}} | 制限: 1日{{limit}}ファイル',
                usage: '使用量:',
                "daily_limit": "1日の処理制限",
                refer_text: 'MetaGen Proを共有して、1日の制限を+50増やしましょう！',
                "share_get_credit": "共有して処理クレジットを獲得",
                generate_metadata: 'メタデータを生成',
                "limit_reached_msg": "1日の処理制限に達しました！上限を増やすにはプランをアップグレードするか、ツールを共有してボーナスを獲得してください。",
                export_csv: 'CSVに書き出し',
                export_excel: 'Excelに書き出し',
                clear_all: 'すべてクリア',
                copy_all: 'すべてコピー',
                down_eps: 'EPSをダウンロード',
                guides: 'ガイド',
                title: 'タイトル',
                description: '説明',
                keywords: 'キーワード',
                categories: 'カテゴリ',
                already_user: 'すでにアカウントをお持ちですか？',
                login: 'ログイン',
                tools_generator: 'ツール＆ジェネレーター',
                trending: '📅 トレンド中...',
                customization: 'カスタマイズ',
                settings: '設定',
                select_ai: 'AIプロバイダーを選択',
                manage_api: 'APIキーを管理',
                convert_api: 'ConvertAPIキー',
                translation_lang: '翻訳言語',
                upload_files: 'ファイルをアップロード',
                watch_demo: 'デモを見る',
                watch_tagline: 'ストックの売上を数秒で向上させる方法を見る',
                process_selected: '選択項目を処理',
                process_prompts: 'プロンプトを処理',
                embed_metadata: 'メタデータを埋め込む',
                export: '書き出し',
                batch_translate: '一括翻訳（無料）',
                translate_all: 'すべて翻訳（Pro）',
                test_metadata: 'メタデータをテスト',
                save_folder: 'フォルダに保存',
                upload_complete: 'アップロード完了',
                share_files: 'ファイルを共有',
                upload_drive: 'ドライブにアップロード',
                pause: '一時停止',
                image_to_prompt: '画像からプロンプト生成',
                jpg_png: 'JPG/PNG',
                svg_eps: 'SVG/EPS/AI',
                videos: '動画',
                check_copyright: '著作権/商標をチェック:',
                upload_limit: '1回の操作で最大500ファイルまでアップロード可能',
                resume: '再開',
                send_feedback: 'フィードバック / バグ報告を送信',
                view_translated: '翻訳を表示',
                view_original: 'オリジナルを表示',
                analyze_trends: 'トレンドを分析',
                downloading: 'ダウンロード中...',
                translating: '翻訳中...',
                embedding: '埋め込み中...',
                analyzing: '分析中...',
                processing: '処理中...',
                process: '処理',
                files: 'ファイル',
                prompts: 'プロンプト',
                complete: '完了',
                success: '成功',
                fail: '失敗',
                saving: '保存中...',
                preparing: '準備中...',
                uploading: 'アップロード中...',
                initializing: '接続を初期化中...',
                "faq_q1": "MetaGen Proの使い方は？",
                "faq_a1": "ストック写真/動画をアップロード -> AIモデルを選択 -> 「メタデータを生成」をクリック -> 確認してダウンロード！",
                "faq_q2": "MetaGen Proは無料ですか？料金は？",
                "faq_a2": "<p><strong>誰でも無料！</strong> MetaGen Proは強力な無料プラン（1日50枚）を提供しています。ヘビーユーザー向けには、Excel書き出しや直接FTPアップロードなどの高度な機能を備えた <strong>Pro</strong> ($12/月 - 1日250枚) および <strong>Premium</strong> ($29/月 - 1日1000枚) プランを用意しています。</p>",
                "faq_q3": "データは安全ですか？",
                "faq_a3": "はい、すべてのデータはデバイス上または安全なAIエンドポイント経由で処理され、使用後すぐに消去されます。",
                "faq_q4": "どのフォーマットに対応していますか？",
                "faq_a4": "現在、JPG, PNG, WEBP, MP4, MOVに対応しています。SVGとEPSのサポートはConvertAPI経由で利用可能です。",
                "faq_q5": "プランのアップグレードは可能ですか？",
                "faq_a5": "はい！料金セクションからいつでもアップグレード可能です。早期アクセスの請求に関する詳細は、metagenp@gmail.comまでお問い合わせください。",
                "faq_q6": "1日の制限を増やすにはどうすればいいですか？",
                "faq_a6": "友達を紹介することで、1日の制限を+50増やすことができます！プロフィール画面で紹介リンクを確認してください。",
                "hero_title": "無料AIメタデータジェネレーター＆ストック写真キーワード！",
                hero_tagline: 'Shutterstock、Adobe Stock、Magnificでの露出を増やしましょう。高度なAIを使用して、SEOに最適化されたタイトル、説明、キーワードを数秒で生成します。',
                why_choose: 'なぜMetaGen Proが選ばれるのか？',
                blog_1: '超高速一括処理',
                blog_tag_1: '何百もの画像を数秒で分析し、キーワードを付与します。最適化された一括処理エンジンで、何時間もの手作業を節約しましょう。',
                blog_2: '高度なAI分析',
                blog_tag_2: 'Gemini 1.5 Pro, Mistral, Llama 3を搭載し、業界をリードする画像認識と正確なメタデータを提供します。',
                blog_3: 'SEO最適化キーワード',
                blog_tag_3: 'Shutterstock、Adobe Stock、Magnificのアルゴリズムに特化した、検索順位の高いタイトルとタグを生成します。',
                blog_4: 'ニッチリサーチ',
                blog_tag_4: '内蔵のニッチリサーチツールで、競争が少なく需要の高いトピックを発見しましょう。購入者が何を検索しているかを見つけます。',
                blog_5: 'ドラッグ＆ドロップによるキーワードの並べ替え',
                blog_tag_5: 'ストックサイト（Adobe Stock, Shutterstock）では、最初の5〜10個のキーワードが最も重要です。',
                blog_6: 'メタデータの埋め込み',
                blog_tag_6: 'タイトルとキーワードをJPG/PNG/SVGファイル（IPTC/XMP）に直接埋め込みます。ダウンロードして、そのままストックエージェンシーにアップロードするだけです。',
                blog_7: '多言語対応',
                blog_tag_7: 'メタデータを即座に10以上の言語に翻訳。ローカライズされたタイトルと説明で、世界中のオーディエンスにリーチしましょう。',
                blog_8: '著作権チェック',
                blog_tag_8: '却下を回避しましょう！アップロード前に、AIが画像内の商標問題やロゴの可能性をスキャンします。',
                blog_9: 'メタデータCSV書き出し',
                blog_tag_9: 'すべてのストックサイト（Adobe Stock, Shutterstock, Magnific）に対応したCSVファイル書き出し機能。',
                trusted_all: 'すべての主要なマイクロストックプラットフォームで信頼されています',
                it_works: '仕組み',
                upload_photos: '写真をアップロード',
                upload_photos_tag: 'JPG/PNGファイルをドラッグ＆ドロップします。解像度や技術仕様を自動的に読み取ります。',
                select_platfrom: 'プラットフォームとAIを選択',
                select_platfrom_tag: 'ターゲット市場（例：Adobe Stock）と好みのAIモデル（Gemini/Groq）を選択します。',
                gen_down: '生成＆ダウンロード',
                gen_down_tag: 'SEO対応のタイトルとキーワードを即座に取得。CSVをダウンロード、または直接埋め込みます。',
                processing_files: 'ファイルを処理中...',
                why_choose_stock_title: 'なぜストックフォト撮影にMetaGen Proを選ぶべきなのか？',
                how_to_use_title: '使い方は？',
                master_stock_title: 'AIでストックフォトをマスター',
                trusted_stock_title: '全米の寄稿者に信頼されています',
                why_choose_stock_p1: '競争の激しいストックフォトの世界では、発見されやすさが鍵となります。最高の画像であっても、購入者が見つけられなければ売れません。<strong>MetaGen Pro</strong>は、この問題を解決するために設計された究極の<em>AIメタデータジェネレーター</em>です。',
                why_choose_stock_p2: '面倒でエラーが発生しやすい手動キーワード設定とは異なり、当社のツールは最先端のコンピュータビジョンを使用して画像の被写体、雰囲気、照明、構図を分析します。そして、Shutterstock、Adobe Stock、Magnific、Vecteezyなどのプラットフォーム向けに最適化された50以上のキーワード、キャッチーなタイトル、詳細な説明を生成します。',
                why_choose_stock_p3: '写真家、イラストレーター、AIアーティストなど、どのような職種の方でも、MetaGen Proはワークフローを効率化します。<strong>Image-to-Prompt</strong>などの機能は、成功したAI画像をリバースエンジニアリングするのに役立ち、<strong>Rejection Predictor</strong>はアップロード前に技術的な問題を修正するのに役立ちます。',
                why_choose_stock_p4: '最先端の無料ストックフォトタグ付けツールを使って、今日から不労所得を最大化しましょう。',
                "plan_details_title": "あなたに最適なプランはどれですか？",
                "plan_details_free": "無料プラン - 初心者に最適",
                "plan_details_free_p1": "無料プランは、趣味で写真を使用する方や、ストックフォトを新規に提供する方を対象としています。1日あたり最大<strong>50枚</strong>の画像を処理できます。サービスを完全に無料でご利用いただくために、Google Gemini、Mistral、GroqなどのAPIキーをご提供いただく必要があります。これらのキーは無料で簡単に生成できます。超高速バッチ処理（一度に最大50ファイル）、AIによるメタデータ生成、CSVエクスポートなどの主要機能をご利用いただけます。ただし、メタデータ自動埋め込み、Excelエクスポート、著作権チェックなどの高度な機能は、このプランには含まれていませんのでご注意ください。",
                "plan_details_pro": "プロプラン - プロフェッショナル向け",
                "plan_details_pro_p1": "プロプランは、ワークフローを最大限に活用し、時間を大幅に節約したい定期的な投稿者向けに設計されています。1日あたり300枚の画像という十分な制限があるため、APIキーを別途用意する必要はありません。AIによるリクエストはすべて弊社側で安全に処理されます。このプランでは、JPEG/PNG/SVGファイルへのメタデータ自動埋め込み、ドラッグ＆ドロップによるキーワードの並べ替え、AIによる著作権/商標チェック、Excelエクスポートなどの強力なツールが利用可能になります。また、バッチ処理の上限が一度に100ファイルに引き上げられ、広告も一切表示されません。",
                "plan_details_premium": "プレミアムプラン - パワーユーザーおよび代理店向け",
                "plan_details_premium_p1": "大量の画像を扱うクリエイター、ベクターアーティスト、代理店向けに設計されたプレミアムプランは、1日あたり最大1000枚の画像と、バッチ処理で最大300ファイルという大容量の制限を提供します。プロプランのすべての機能に加え、高度な自動化機能も含まれています。サードパーティのConvertAPIキーが不要なダイレクトベクター/EPS変換機能と、FTP/SFTP自動アップロード機能に独占的にアクセスできます。これにより、処理済みのファイルとメタデータを、ブラウザから直接、複数のストックフォトサイト（Shutterstock、Adobe Stock、Magnificなど）に自動的に配信できます。",
                "htu_step1_title": "1. ファイルのアップロード",
                "htu_step1_desc": "画像（JPG/PNG）、ベクター画像（SVG/EPS）、または動画をドラッグ＆ドロップして開始してください。",
                "htu_step2_title": "2. 対象プラットフォーム",
                "htu_step2_desc": "最適な結果を得るには、Shutterstock、Adobe Stock、またはMagnificを選択してください。",
                "htu_step3_title": "3. AIモデルの選択",
                "htu_step3_desc": "画像解析には、Gemini、Mistral、またはGroqのいずれかを選択してください。",
                "htu_step4_title": "4. カスタマイズ",
                "htu_step4_desc": "スライダーを使って、タイトルとキーワードの最小/最大文字数を調整します。",
                "htu_step5_title": "5. AI設定",
                "htu_step5_desc": "ベクターモードを有効にするか、白い背景を使用するか、独自のカスタムプロンプトを使用してください。",
                "htu_step6_title": "6. メタデータを生成する",
                "htu_step6_desc": "「選択した項目を処理」をクリックすると、SEO対策済みのタイトルとタグがすぐに生成されます。",
                "htu_step7_title": "7. メタデータの埋め込み",
                "htu_step7_desc": "JPG、PNG、またはSVGファイルにメタデータを直接書き込みます。",
                "htu_step8_title": "8. 複数翻訳",
                "htu_step8_desc": "グローバル市場向けに、メタデータを10以上の言語に翻訳します。",
                "htu_step9_title": "9. 結果のエクスポート",
                "htu_step9_desc": "すべてのメタデータをCSVファイルまたはプロ仕様のExcelシートとしてダウンロードしてください。",
                "htu_step10_title": "10. セーブ＆ドライブ",
                "htu_step10_desc": "ローカルフォルダに保存するか、リンクで共有するか、またはGoogleドライブに直接アップロードします。",
                master_stock_subtitle1: 'MetaGen Pro の使い方',
                master_stock_p1: 'MetaGen Pro の使い方は非常に簡単で、専門的な知識は必要ありません。まず、画像をアップロードエリアにドラッグ＆ドロップするか、クリックしてファイルを選択します。MetaGen Pro は、JPG、PNG、SVG、EPS などの主要な画像形式に加え、動画ファイルもサポートしています。アップロード後、ターゲットとなるプラットフォーム（Shutterstock、Adobe Stock、Magnific、または一般）を選択すると、その市場に特化したメタデータが最適化されます。',
                master_stock_p2: '次に、サイドバーの設定を使用して好みを構成します。キーワードの数（最適なSEOのために35〜50個を推奨）の調整、タイトル長の制限、イラスト用のベクターモードや商品写真用の白背景検出などの特別機能を有効にできます。AIプロバイダーの選択では、APIの可用性や速度の好みに基づいて、Google Gemini、Mistral AI、または Groq Llama モデルから選択できます。',
                master_stock_p3: '設定後、「すべて処理（Process All）」ボタンをクリックすると、アップロードされたすべての画像のメタデータが同時に生成されます。当社の高度なAIが各画像の視覚的内容、構成、色、被写体、および文脈を分析し、関連性の高いタイトル、説明、キーワードセットを作成します。プロセス全体は通常、画像あたりわずか数秒で完了し、バッチモードで数百のファイルを処理する場合も同様です。',

                master_stock_subtitle2: 'このツールを使用するメリット',
                master_stock_benefit1: '<strong>時間の効率化:</strong> 手動でのキーワード入力は1枚あたり10〜15分かかる場合がありますが、MetaGen Pro はこれをわずか数秒に短縮します。これにより、手動で数枚処理する時間で数百枚の画像にキーワードを付けることができ、プロの寄稿者にとって週に10時間以上の節約になります。',
                master_stock_benefit2: '<strong>SEOの最適化:</strong> 当社のAIは単に見たものを説明するだけでなく、検索意図や市場のアルゴリズムを理解します。各メタデータには、広範なキーワード（高検索ボリューム）、特定のロングテールキーワード（高コンバージョン）、トレンド用語（現在の需要）が戦略的に混合されています。内蔵のSEOスコアメーターがリアルタイムでメタデータを評価し、すべてのアップロードが最大の発見可能性を得られるよう最適化します。',
                master_stock_benefit3: '<strong>マルチプラットフォーム対応:</strong> 各ストックエージェンシーには異なる要件があります。MetaGen Pro は各プラットフォーム独自のアルゴリズムに適応します（Shutterstock は Adobe Stock や Magnific とは異なるキーワード構造を好みます）。当社のプラットフォーム別最適化により、どこにアップロードしても画像が上位にランクされるようになります。',
                master_stock_benefit4: '<strong>一貫性と品質:</strong> ヒューマンエラーを排除し、ポートフォリオ全体でプロフェッショナルな基準を維持します。MetaGen Pro は、すべての画像に適切にフォーマットされたメタデータ、十分なキーワード数、適切な説明が含まれることを保証します。リジェクト予測機能は、一般的な拒否基準に照らしてメタデータを分析し、コストのかかる申請失敗を回避するのに役立ちます。',

                master_stock_subtitle3: '画像SEOとは何か、なぜ重要なのか',
                master_stock_seo_p1: '画像SEO（検索エンジン最適化）とは、ストックフォトプラットフォームや検索エンジンでの視認性を高めるために画像のメタデータを最適化する作業です。購入者が「ビジネスミーティング」や「南国のビーチの夕日」を検索したとき、プラットフォームのアルゴリズムは画像そのものを「見る」のではなく、提供されたメタデータを読み取ります。効果的な画像SEOは、あなたの作品が検索結果の1ページ目に表示されるか、50ページ目に埋もれるかの分かれ目となります。',
                master_stock_seo_p2: '<strong>画像SEOの3つの柱:</strong> 第一に「タイトル」は、主要なキーワードを含みつつ、自然で読みやすい簡潔なもの（10〜20語）である必要があります。第二に「説明」は文脈とユースケース（30〜50語）を提供し、アルゴリズムと購入者の両方が画像の商業的用途を理解するのを助けます。第三に「キーワード」は網を広げ（35〜50語を推奨）、購入者を画像に導くさまざまな検索クエリをキャッチします。',
                master_stock_seo_p3: '<strong>キーワード戦略の重要性:</strong> 最も効果的なメタデータは、バランスの取れた組み合わせを使用します：単一ワードのキーワード20〜30％（広いリーチ）、2語のフレーズ40〜50％（中程度の具体性）、およびロングテールキーワード20〜30％（高いコンバージョン）。この戦略により、広範な検索と特定の検索の両方で画像が表示される可能性が最大化されます。',
                master_stock_seo_p4: '<strong>検索順位の決定要因:</strong> ストックプラットフォームは、関連性、完全性、キーワードの多様性など、複数の要因を考慮して順位を決定します。さらに、購入者がその画像をどのように使用できるかを説明する商業的な関連性は、画像が上位にランクされた後の成約率に大きく影響します。',
                master_stock_seo_p5: 'MetaGen Pro はこれらすべてのベストプラクティスを自動化し、アップロードするすべての画像が視認性、ダウンロード数、そして最終的な収益を最大化するように完全に最適化されることを保証します。',

                master_stock_cta: '<strong>ストックフォトでの成功を加速させる準備はできましたか？</strong> 今すぐ MetaGen Pro を使い始めて、退屈な手動作業を数秒の自動化された卓越性に変えましょう。',

                trusted_stock_subtitle: '全米の何千人ものフォトグラファーやクリエイターが、収益向上のために MetaGen Pro を信頼している理由をご覧ください',
                review_1_details: '📍 ニューヨーク州、ニューヨーク • プロフォトグラファー',
                review_1_text: '「MetaGen Pro は私のワークフローを完全に変えました！以前は Shutterstock 用のキーワード入力に何時間も費やしていましたが、今では数分で終わり、ダウンロード数は40%増加しました。SEOスコア機能は素晴らしいです！」',
                review_2_details: '📍 カリフォルニア州、ロサンゼルス • コンテンツクリエイター',
                review_2_text: '「フルタイムのクリエイターとして、時間は金なりです。このツールにより、メタデータ入力の時間を毎週少なくとも10時間は節約できています。一括処理は電光石火の速さで、AIが生成するキーワードは的確です。今年最高の投資です！」',
                review_3_details: '📍 フロリダ州、マイアミ • ストック寄稿者',
                review_3_text: '「最初は半信半疑でしたが、MetaGen Pro は期待以上でした。キーワードの提案は非常に適切で、多言語機能により海外の購入者にもリーチできるようになりました。Adobe Stock の収益がわずか3ヶ月で2倍になりました！」',
                review_4_details: '📍 イリノイ州、シカゴ • グラフィックデザイナー',
                review_4_text: '「著作権チェック機能だけでも価値があります！これにより、リジェクトされる可能性を何度も回避できました。自動生成機能と合わせれば、本気でストックフォトに取り組む人には必須のツールです。」',
                review_5_details: '📍 ワシントン州、シアトル • 自然写真家',
                review_5_text: '「毎月何百枚もの自然写真をアップロードしていますが、MetaGen Pro ならそれらすべてを簡単に管理・最適化できます。CSV書き出し機能もワークフローにシームレスに組み込めます。」',
                review_6_details: '📍 テキサス州、オースティン • フリーランスビデオグラファー',
                review_6_text: '「動画メタデータの救世主です！AIが正確にシーンを特定し、完璧なタイトルを生成してくれます。Shutterstock の動画ポートフォリオの視認性が劇的に向上しました。」',

                stat_users: 'アクティブユーザー（米国）',
                stat_satisfaction: '満足度',
                stat_images: '毎日最適化される画像数',
                stat_rating: '平均評価',
                "faq_title": "よくある質問 — MetaGen Pro",
                "faq_q1": "🚀 MetaGen Pro を使い始めるには？",
                "faq_a1": "<strong>ステップ 1:</strong> Googleアカウントまたはメールアドレスで登録・ログインします。<br><strong>ステップ 2:</strong> 設定で Google Gemini API キーを設定します（<a href='https://aistudio.google.com/app/apikey' target='_blank'>Google AI Studio</a> で無料で取得可能）。<br><strong>ステップ 3:</strong> 画像（JPG, PNG, SVG, EPS）をアップロードします（一度に最大500ファイルまで！）。<br><strong>ステップ 4:</strong> ターゲットプラットフォームを選択して「メタデータ生成」をクリックします。<br><strong>ステップ 5:</strong> 確認・編集し、メタデータをファイルに埋め込んでダウンロードします！",
                "faq_q2": "💰 MetaGen Pro は無料ですか？料金は？",
                "faq_a2": "<p><strong>どなたでも無料プランをご利用いただけます！</strong> Metagen Proには、強力な無料プラン（月間120枚、1日最大25枚）があります。ただし、ヘビーユーザー向けには、<strong>Pro</strong>（月額12ドル - 月間2000枚、1日最大70枚）と<strong>Premium</strong>（月額29ドル - 月間3000枚、1日最大100枚）のプランをご用意しています。有料プランでは、メタデータの自動埋め込み、Excelエクスポート、FTP直接アップロードなどの高度な機能をご利用いただけます。</p>",
                "faq_q3": "🔑 APIキーを取得するには？安全ですか？",
                "faq_a3": "<p><strong>いいえ、現在どのプランでもAPIキーは必要ありません！</strong>無料、プロ、プレミアムのすべてのプランにおいて、メタデータは自社サーバーとSupabase Edge Functions専用AIモデル（高度なAIモデル）を使用して処理されます。</p><p><strong>セキュリティ：</strong>お客様のデータはすべて完全に<strong>安全</strong>であり、処理後すぐにサーバーから削除されます。</p>",
                "faq_q4": "📁 サポートされているファイル形式は？",
                "faq_a4": "<p><strong>対応形式:</strong></p><ul><li><strong>JPG/JPEG:</strong> EXIF埋め込みをフルサポート</li><li><strong>PNG:</strong> メタデータ埋め込みをフルサポート</li><li><strong>SVG:</strong> XMP埋め込みをフルサポート</li><li><strong>EPS:</strong> SVGに変換して処理（ConvertAPIキーが必要）</li></ul><p>一度に最大 <strong>500ファイル</strong> までアップロード可能です！</p>",
                "faq_q5": "🎯 どのストックプラットフォームに対応していますか？",
                "faq_a5": "<p>主要なすべてのプラットフォームに最適化されています：Shutterstock, Adobe Stock, Magnific, Vecteezy, Pond5, 123RF, iStock, Getty Images など。AIが各サイトの要件に自動的に適応します！</p>",
                "faq_q6": "📊 SEOスコアとキーワードバッジとは？",
                "faq_a6": "<p><strong>SEOスコア:</strong> 検索アルゴリズムへの最適化度を測定します。</p><p><strong>バッジ:</strong></p><ul><li>🟢 <strong>緑:</strong> 単一語（高ボリューム）</li><li>🟡 <strong>黄:</strong> 2語（ベストバランス）</li><li>🔵 <strong>青:</strong> 3語以上（ロングテール）</li></ul>",
                "faq_q7": "⚡ 一括処理（バッチ処理）の仕組みは？",
                "faq_a7": "<p>最大500枚の画像をアップロードし、「選択項目を処理」をクリックすると、AIが並列処理します。非常に高速で、100枚の処理も1枚のときとほぼ同じ時間で完了します！</p>",
                "faq_q8": "🎨 「画像からプロンプト（Image to Prompt）」機能とは？",
                "faq_a8": "<p>画像を Midjourney や DALL-E などの画像生成AI用の詳細なプロンプトに変換します。成功しているストック画像の構成を分析するのに最適です！</p>",
                "faq_q9": "🔒 データは保護されますか？画像は保存されますか？",
                "faq_a9": "<p><strong>100% プライベートです！</strong> 処理はブラウザ上で行われます。画像を保存することは一切ありません。データは処理後すぐに消去されます。</p>",
                "faq_q10": "🔧 トラブルシューティング: よくある問題",
                "faq_a10": "<ul><li><strong>APIキーエラー:</strong> 設定のキーを再確認してください。</li><li><strong>ファイルが大きすぎる:</strong> 20MB未満に抑えてください。</li><li><strong>動作が遅い:</strong> 他のブラウザタブを閉じてみてください。</li></ul>",
                "faq_q11": "🎭 AI画像生成機能の仕組みは？",
                "faq_a11": "<p>FLUXモデルを使用して直接画像を作成できます。Together AI キーを設定し、プロンプトを入力して、ストックポートフォリオ用のユニークな画像を生成しましょう！</p>",
                "faq_q12": "💬 ヘルプやフィードバックの連絡先は？",
                "faq_a12": "<p><strong>metagenp@gmail.com</strong> までメールをいただくか、アプリ内のフィードバックボタンをご利用ください。重要な問題には12時間以内に回答いたします！</p>"

            }
        };


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
                        isPaidPlan = (dbPlan === 'pro' || dbPlan === 'premium');
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
                    return generatedText.replace(/^```[a-z]*\s*|\s*```$/gi, '').trim();

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
                const listContainer = document.getElementById(`suggestion-list-${cardId}`);
                if (!listContainer) return; // Modal was closed

                if (suggestions && suggestions.length > 0) {
                    listContainer.innerHTML = suggestions.map(s =>
                        `<span class="suggestion-pill" onclick="addSuggestedKeyword('${cardId}', '${s.replace(/'/g, "\\'")}')">+ ${s}</span>`
                    ).join('');
                } else {
                    listContainer.innerHTML = '<div class="suggestion-loading" style="color:#EF4444">No suggestions found. Please configure API Keys or Pro plan.</div>';
                }
                modal.querySelector('.suggestion-loading').style.display = 'none';

            } catch (error) {
                console.error("Suggestion error:", error);
                const listContainer = document.getElementById(`suggestion-list-${cardId}`);
                if (listContainer) {
                    listContainer.innerHTML = `<div class="suggestion-loading" style="color:#EF4444">Error generating keywords.</div>`;
                    modal.querySelector('.suggestion-loading').style.display = 'none';
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
        async function handlePayment(planType) {
            // Monthly/Yearly toggle for subscription plans
            const toggle = document.getElementById('pricingToggle');
            const isYearly = toggle ? toggle.checked : false;

            // পডেল প্রাইস আইডি ম্যাপিং
            const priceMap = {
                'pro': {
                    monthly: 'pri_01kqfns94nxjkkx13fev08r17y',
                    yearly: 'pri_01kqfmww2dq13cfgp8f31wjj0w'
                },
                'premium': {
                    monthly: 'pri_01kqfnkzh5r1sns8qk6nw055vc',
                    yearly: 'pri_01kq7jac3fw4q51j18426yzqr0'
                },
                'agency': {
                    monthly: 'pri_01krqxzwcg75487rs8zjhrzran',
                    yearly: 'pri_01krqxzwcg75487rs8zjhrzran' // Same for now
                },
                'starter_pack': 'pri_01krqybgp7ds4e3vs0amd0mgw6',
                'power_pack': 'pri_01krqyfxsvb8c82ntrtmg14137'
            };

            const plan = priceMap[planType];
            if (!plan) {
                alert(`Unknown plan: ${planType}. Please contact support.`);
                return;
            }

            // Credit packs are flat strings, subscription plans are objects
            let targetPriceId;
            if (typeof plan === 'string') {
                targetPriceId = plan;
            } else {
                targetPriceId = isYearly ? plan.yearly : plan.monthly;
            }

            if (!targetPriceId || targetPriceId.includes('YOUR_')) {
                alert("Price ID is not set yet. Please check back later.");
                return;
            }

            // চেকআউট ওপেন করুন
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

// ===========================================
// SECTION 11: Team Management & Admin
// ===========================================
        async function openTeamManagement() {
            const modal = document.getElementById('teamManagementModal');
            modal.style.display = 'flex';
            const user = auth.currentUser;
            const adminToken = await user.getIdToken();

            try {
                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/team/info', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);

                document.getElementById('teamUsageText').textContent = `${data.teamMonthlyUsage}/${data.monthlyLimit}`;
                const pct = Math.min((data.teamMonthlyUsage / data.monthlyLimit) * 100, 100);
                document.getElementById('teamUsageFill').style.width = `${pct}%`;

                const list = document.getElementById('teamMemberList');
                list.innerHTML = '';
                data.members.forEach(m => {
                    const div = document.createElement('div');
                    div.style = 'display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid var(--border-color);';
                    div.innerHTML = `
                            <span>${m} ${m === user.email ? '<small>(Owner)</small>' : ''}</span>
                            ${m !== user.email ? `<button onclick="removeTeamMember('${m}')" style="color:#EF4444; background:none; border-none; cursor:pointer;"><i class="fas fa-trash"></i></button>` : ''}
                        `;
                    list.appendChild(div);
                });
                if (data.members.length === 0) list.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">No members added yet.</div>';

            } catch (e) {
                alert('Failed to load team info: ' + e.message);
            }
        }

        async function inviteTeamMember() {
            const emailInput = document.getElementById('teamMemberEmail');
            const targetEmail = emailInput.value.trim().toLowerCase();
            if (!targetEmail) return;

            const user = auth.currentUser;
            const adminToken = await user.getIdToken();
            try {
                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/team/invite', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ memberEmail: targetEmail })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                alert('Member invited successfully!');
                emailInput.value = '';
                openTeamManagement();
            } catch (e) {
                alert('Invite failed: ' + e.message);
            }
        }

        async function removeTeamMember(targetEmail) {
            if (!confirm(`Are you sure you want to remove ${targetEmail} from your team?`)) return;
            const user = auth.currentUser;
            const adminToken = await user.getIdToken();
            try {
                const res = await fetch('https://metagen-pro-api.metagenp.workers.dev/team/remove', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ memberEmail: targetEmail })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                openTeamManagement();
            } catch (e) {
                alert('Removal failed: ' + e.message);
            }
        }

        async function openBroadcastModal() {
            const user = auth.currentUser;
            const ADMIN_EMAILS = ['metagenp@gmail.com', 'pradipcob84@gmail.com'];

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

        function _initHealingCanvas(file) {
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
                ctx.drawImage(img, 0, 0, w, h);
                healingMaskHistory = [ctx.getImageData(0, 0, w, h)];
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

        function downloadHealedImage() {
            const img = document.getElementById('healingResultImg');
            if (!img.src) return;
            const a = document.createElement('a');
            a.href = img.src;
            a.download = 'healed_' + (healingOriginalFile ? healingOriginalFile.name : 'image.png');
            a.click();
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
                        <div style="width:120px; min-width:120px; background:var(--bg-tertiary); display:flex; align-items:center; justify-content:center; border-right:1px solid var(--border-color);">
                            <img src="${imgData}" style="max-width:100%; max-height:120px; object-fit:contain;" />
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
            errEl.style.display = 'none';
            loadingEl.style.display = 'block';
            resultPanel.style.display = 'none';
            analyzeBtn.disabled = true;
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

                statusEl.textContent = 'Processing...';
                statusEl.style.background = 'rgba(59,130,246,0.1)';
                statusEl.style.color = '#3B82F6';
                errEl.style.display = 'none';

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
                }
            }

            analyzeBtn.disabled = false;
        }
      });
</script>
