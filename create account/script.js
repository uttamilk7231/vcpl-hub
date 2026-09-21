(function () {
    const form = document.getElementById('signup-form');
    const nameInput = document.getElementById('signup-name');
    const emailInput = document.getElementById('signup-email');
    const passwordInput = document.getElementById('signup-password');
    const strengthBar = document.querySelector('#strength-bar span');
    const strengthBadge = document.getElementById('strength-badge');

    // ---------- Password strength ----------
    function getStrength(pw) {
        let score = 0;
        if (pw.length >= 8) score++;
        if (pw.length >= 12) score++;
        if (/[A-Z]/.test(pw)) score++;
        if (/[0-9]/.test(pw)) score++;
        if (/[^A-Za-z0-9]/.test(pw)) score++;
        return score;
    }

    function updateStrength() {
        const pw = passwordInput.value;
        const s = getStrength(pw);
        const widths = ['0%', '20%', '40%', '65%', '100%'];
        const labels = ['', 'Weak', 'Fair', 'Strong', 'Strong'];
        const colors = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#16a34a'];
        const idx = Math.min(s, 4);

        strengthBar.style.width = widths[idx];
        strengthBar.style.background = idx > 0 ? colors[idx] : '';
        strengthBadge.textContent = labels[idx];
        strengthBadge.style.color = idx > 0 ? colors[idx] : 'transparent';
        strengthBadge.style.background = idx > 0 ? (idx >= 3 ? '#e7f9ee' : '#fef9c3') : 'transparent';
        strengthBadge.style.display = pw.length ? 'block' : 'none';
    }

    passwordInput.addEventListener('input', updateStrength);
    updateStrength();

    // Pre-fill email when redirected from sign-in ("no account found")
    const params = new URLSearchParams(window.location.search);
    if (params.get('email')) emailInput.value = params.get('email');

    if (params.get('err') === 'server') {
        alert('Could not reach the server. Start it by running: node server.js');
    }

    // ---------- Submit ----------
    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const name = nameInput.value.trim();
        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;
        const strength = getStrength(password);

        if (!name || !email || !password) {
            alert('Please fill in all fields.');
            return;
        }

        if (strength < 3) {
            alert('Please choose a stronger password (at least 8 characters with upper, lower, number, and symbol).');
            return;
        }

        try {
            const res = await fetch('/api/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, email: email, password: password })
            });
            const data = await res.json();

            if (!data.ok) {
                alert(data.error || 'Something went wrong. Please try again.');
                if (res.status === 409) {
                    const prefilled = new URLSearchParams({ email: email }).toString();
                    window.location.href = '../login page/index.html?' + prefilled;
                }
                return;
            }

            // Account created - verification link sent, go sign in after verifying
            const q = new URLSearchParams({ email: email, created: '1' }).toString();
            window.location.href = '../login page/index.html?' + q;
        } catch (err) {
            alert('Could not reach the server. Start it by running: node server.js');
        }
    });

    // Google sign-in
    const googleBtn = document.getElementById('google-signup-btn');
    if (googleBtn) {
        googleBtn.addEventListener('click', async function (e) {
            e.preventDefault();
            try {
                const res = await fetch('/api/auth/google');
                if (res.ok) { window.location.href = '/api/auth/google'; return; }
                const data = await res.json().catch(() => ({}));
                alert(data.error || 'Google sign-in is not available right now.');
            } catch (err) {
                alert('Could not reach the server.');
            }
        });
    }
})();