
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
