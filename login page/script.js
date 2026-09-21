(function () {
    const form     = document.getElementById('login-form');
    const email    = document.getElementById('login-email');
    const pw       = document.getElementById('login-password');
    const eyeBtn   = document.getElementById('password-eye');
    const eyeOpen  = eyeBtn.querySelector('.eye-open');
    const eyeClose = eyeBtn.querySelector('.eye-closed');
    const banner   = document.getElementById('auth-banner');

    function showBanner(message, kind, actionsHtml) {
        banner.hidden = false;
        banner.className = 'auth-banner ' + (kind || 'info');
        banner.innerHTML = '<span class="auth-banner-text">' + message + '</span>' + (actionsHtml || '');
    }

    // Pre-fill email from create-account redirect, else remember last known email
    const params = new URLSearchParams(window.location.search);
    if (params.get('email')) email.value = params.get('email');
    else if (localStorage.getItem('lastEmail')) email.value = localStorage.getItem('lastEmail');

    if (params.get('created') === '1') {
        showBanner('Account created — check your inbox for the verification link, then sign in below.', 'info');
    } else if (params.get('verified') === '1') {
        showBanner('Your email has been verified. You can now sign in.', 'success');
    } else if (params.get('verified') === '0') {
        showBanner('That verification link is invalid or has expired. Sign up again or request a new link.', 'error');
    }

    // Password visibility toggle
    eyeBtn.addEventListener('click', function () {
        const isPassword = pw.type === 'password';
        pw.type = isPassword ? 'text' : 'password';
        eyeOpen.style.display  = isPassword ? 'none' : 'block';
        eyeClose.style.display = isPassword ? 'block' : 'none';
    });

    // Submit - validate against saved account, then start the session
    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const emailVal = email.value.trim().toLowerCase();
        const pwVal    = pw.value;

        if (!emailVal || !pwVal) {
            showBanner('Please fill in all fields.', 'error');
            return;
        }

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: emailVal, password: pwVal })
            });
            const data = await res.json();

            if (!data.ok) {
                if (res.status === 404) {
                    showBanner('No account found with this email. Please create one first.', 'error');
                    setTimeout(() => { window.location.href = '../create account/index.html?email=' + encodeURIComponent(emailVal); }, 1500);
                    return;
                }
                if (res.status === 403 && data.unverified) {
                    const resend = '<button type="button" class="banner-action" id="resend-verify-btn">Resend verification link</button>';
                    showBanner('Please verify your email first. Check your inbox for the link we sent.', 'error', resend);
                    document.getElementById('resend-verify-btn').addEventListener('click', async function (ev) {
                        ev.preventDefault();
                        try {
                            await fetch('/api/resend-verification', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ email: emailVal })
                            });
                            showBanner('A fresh verification link has been sent to ' + emailVal + '.', 'success');
                        } catch (err) {
                            showBanner('Could not reach the server. Try again shortly.', 'error');
                        }
                    });
                    return;
                }
                showBanner(data.error || 'Could not sign you in. Please try again.', 'error');
                return;
            }

            // Session is now active on the server - go to dashboard
            localStorage.setItem('lastEmail', emailVal);
            window.location.href = '../home/index.html';
        } catch (err) {
            showBanner('Could not reach the server. Start it by running: node server.js', 'error');
        }
    });

    // Google sign-in
    const googleBtn = document.getElementById('google-login-btn');
    if (googleBtn) {
        googleBtn.addEventListener('click', async function (e) {
            e.preventDefault();
            try {
                const res = await fetch('/api/auth/google');
                if (res.ok) { window.location.href = '/api/auth/google'; return; }
                const data = await res.json().catch(() => ({}));
                showBanner(data.error || 'Google sign-in is not available right now.', 'error');
            } catch (err) {
                showBanner('Could not reach the server.', 'error');
            }
        });
    }
})();