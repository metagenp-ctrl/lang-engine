
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

