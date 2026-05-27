
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
                window.userUsageData.email = null;
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

   <!-- Vector Checklist Modal -->
    <div id="vectorChecklistModal" class="modal" style="display: none;">
        <div class="modal-content checklist-modal-content">
            <h3>📋 Vector File Quality Checklist</h3>
            <div class="checklist-filename" id="checklistFilename"></div>
            <div class="checklist-results" id="checklistResults"></div>
            <div class="checklist-actions">
                <button class="action-button grey-button" id="checklistCancelBtn">Cancel</button>
                <button class="action-button green-button" id="checklistContinueBtn">Continue Upload</button>
            </div>
        </div>
    </div>

    <!-- FTP Settings Modal Redesign -->
    <div id="ftpModal" class="modal" style="display:none; align-items:center; justify-content:center;">
        <div class="modal-content"
            style="max-width: 550px; width: 92%; max-height: 95vh; overflow-y: auto; padding: 25px; border-radius: 16px; background: var(--bg-modal); position: relative; border: 1px solid var(--border-color); box-shadow: 0 10px 40px rgba(0,0,0,0.3); color: var(--text-primary);">
            <span class="modal-close-btn"
                style="color: var(--text-muted); font-size: 28px; position: absolute; right: 20px; top: 15px; cursor: pointer;"
                onclick="document.getElementById('ftpModal').style.display='none'">&times;</span>

            <!-- Header -->
            <div style="text-align: center; margin-bottom: 20px;">
                <h2
                    style="color: var(--accent-orange); margin: 0; font-size: 1.4em; display: flex; align-items: center; justify-content: center; gap: 10px; font-weight: 700;">
                    <i class="fas fa-cloud-upload-alt"></i> FTP Direct Upload
                </h2>
                <p style="font-size: 0.85em; color: var(--text-muted); margin-top: 6px;">Securely transfer files to
                    multiple stock agencies.</p>
            </div>

            <!-- Configuration Section -->
            <div
                style="background: var(--bg-tertiary); padding: 15px; border-radius: 12px; margin-bottom: 20px; border: 1px solid var(--border-color);">
                <div style="margin-bottom: 12px;">
                    <label
                        style="display: block; font-size: 0.9em; margin-bottom: 6px; color: var(--text-secondary); font-weight: 500;">Select
                        Provider:</label>
                    <select id="ftpPlatform" onchange="window.handleAgencyConfigChange()"
                        style="width: 100%; padding: 10px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 8px; font-size: 0.95em; outline: none; transition: 0.2s;">
                        <option value="shutterstock">Shutterstock</option>
                        <option value="adobestock">Adobe Stock</option>
                        <option value="Magnific">Magnific</option>
                        <option value="vecteezy">Vecteezy</option>
                        <option value="vectorstock">VectorStock</option>
                        <option value="123rf">123RF</option>
                        <option value="pond5">Pond5</option>
                        <option value="custom">Custom Site</option>
                    </select>
                </div>

                <div style="display: flex; gap: 10px; margin-bottom: 8px;">
                    <input type="text" id="ftpHost" placeholder="Host Address"
                        style="flex: 3; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-primary); font-size: 0.9em; outline: none;">
                    <input type="text" id="ftpPort" placeholder="Port"
                        style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-primary); font-size: 0.9em; outline: none; text-align: center;">
                </div>
                <div style="display: flex; gap: 10px; margin-bottom: 12px;">
                    <input type="text" id="ftpUser" placeholder="FTP Username"
                        style="flex:1; padding: 10px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-primary); font-size: 0.9em; outline: none;">
                    <input type="password" id="ftpPass" placeholder="FTP Password"
                        style="flex:1; padding: 6px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-primary); font-size: 0.9em; outline: none;">
                </div>

                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <button id="saveAgencyCredsBtn"
                        style="background: var(--accent-blue); color: white; border: none; padding: 8px 30px; border-radius: 8px; font-size: 0.95em; cursor: pointer; font-weight: 600; transition: 0.2s;">
                        Save Credentials
                    </button>
                    <span id="ftpSaveStatus"
                        style="font-size: 0.85em; opacity: 0; transition: 0.3s; font-weight: 600;"></span>
                </div>
            </div>

            <!-- Agency Selection Section -->
            <div style="margin-bottom: 20px;">
                <label
                    style="display: block; font-size: 0.9em; margin-bottom: 12px; color: var(--text-secondary); font-weight: 600; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">
                    Send To Platforms:
                </label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <label
                        style="display: flex; align-items: center; gap: 10px; font-size: 0.85em; cursor: pointer; background: var(--bg-input); padding: 10px; border-radius: 10px; border: 1px solid var(--border-color);">
                        <input type="checkbox" class="ftp-upload-checkbox" value="shutterstock"
                            style="width: 18px; height: 18px; cursor:pointer;"> Shutterstock
                    </label>
                    <label
                        style="display: flex; align-items: center; gap: 10px; font-size: 0.85em; cursor: pointer; background: var(--bg-input); padding: 10px; border-radius: 10px; border: 1px solid var(--border-color);">
                        <input type="checkbox" class="ftp-upload-checkbox" value="adobestock"
                            style="width: 18px; height: 18px; cursor:pointer;"> Adobe Stock
                    </label>
                    <label
                        style="display: flex; align-items: center; gap: 10px; font-size: 0.85em; cursor: pointer; background: var(--bg-input); padding: 10px; border-radius: 10px; border: 1px solid var(--border-color);">
                        <input type="checkbox" class="ftp-upload-checkbox" value="Magnific"
                            style="width: 18px; height: 18px; cursor:pointer;"> Magnific
                    </label>
                    <label
                        style="display: flex; align-items: center; gap: 10px; font-size: 0.85em; cursor: pointer; background: var(--bg-input); padding: 10px; border-radius: 10px; border: 1px solid var(--border-color);">
                        <input type="checkbox" class="ftp-upload-checkbox" value="vecteezy"
                            style="width: 18px; height: 18px; cursor:pointer;"> Vecteezy
                    </label>
                    <label
                        style="display: flex; align-items: center; gap: 10px; font-size: 0.85em; cursor: pointer; background: var(--bg-input); padding: 10px; border-radius: 10px; border: 1px solid var(--border-color);">
                        <input type="checkbox" class="ftp-upload-checkbox" value="vectorstock"
                            style="width: 18px; height: 18px; cursor:pointer;"> VectorStock
                    </label>
                    <label
                        style="display: flex; align-items: center; gap: 10px; font-size: 0.85em; cursor: pointer; background: var(--bg-input); padding: 10px; border-radius: 10px; border: 1px solid var(--border-color);">
                        <input type="checkbox" class="ftp-upload-checkbox" value="123rf"
                            style="width: 18px; height: 18px; cursor:pointer;"> 123RF
                    </label>
                </div>
            </div>

            <!-- Progress Bar -->
            <div id="ftpProgressContainer"
                style="display: none; background: var(--bg-tertiary); padding: 15px; border-radius: 12px; margin-bottom: 15px; border: 1px solid var(--border-color);">
                <div
                    style="display: flex; justify-content: space-between; font-size: 0.8em; color: var(--text-secondary); margin-bottom: 8px;">
                    <span id="ftpProgressFileName" style="font-weight: 600;">Preparing...</span>
                    <span id="ftpProgressPercent" style="color: var(--accent-orange); font-weight: bold;">0%</span>
                </div>
                <div
                    style="width: 100%; height: 8px; background: var(--bg-input); border-radius: 4px; overflow: hidden;">
                    <div id="ftpProgressBar"
                        style="width: 0%; height: 100%; background: linear-gradient(90deg, var(--accent-orange), #ea580c); transition: width 0.3s; border-radius: 4px;">
                    </div>
                </div>
                <div id="ftpStatus"
                    style="margin-top: 10px; font-size: 0.85em; text-align: center; color: var(--text-primary); font-weight: 500;">
                </div>
            </div>

            <!-- Action Button -->
            <button id="startFtpBtn"
                style="width: 100%; background: var(--accent-orange); color: white; border: none; padding: 14px; border-radius: 12px; font-size: 1.1em; cursor: pointer; font-weight: bold; transition: 0.2s; display: flex; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 4px 15px rgba(249, 115, 22, 0.3);">
                <i class="fas fa-rocket"></i> Start Cloud Upload
            </button>
        </div>
    </div>
    </div>
    <script>
        //<![CDATA[
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

      
