

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
