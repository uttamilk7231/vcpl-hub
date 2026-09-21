(function () {
    function initials(name) {
        return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '--';
    }

    function renderProfile(user) {
        const nameEl = document.getElementById('profile-name');
        const phoneEl = document.getElementById('contact-phone');
        const emailEl = document.getElementById('contact-email');
        const avatarEl = document.getElementById('profile-avatar');

        document.getElementById('sidebar-name').textContent = user.name;
        document.getElementById('sidebar-avatar').textContent = initials(user.name);

        nameEl.textContent = user.name;
        emailEl.textContent = user.email;
        avatarEl.textContent = initials(user.name);
        // Phone is editable/unknown in the prototype - keep a friendly working value
        phoneEl.textContent = '—'; // real one would come from the account
    }

    document.addEventListener('DOMContentLoaded', async () => {
        // Auth guard: load the live session from the server
        let user = null;
        try {
            const res = await fetch('/api/session');
            const data = await res.json();
            if (data.ok) user = data.user;
        } catch (e) { /* server unreachable */ }

        if (!user) {
            window.location.replace('../login page/index.html');
            return;
        }

        renderProfile(user);

        // Sidebar toggle (click on logo) + persist state across pages
        const sidebar = document.querySelector('.sidebar');
        if (localStorage.getItem('sidebarCollapsed') === 'true') {
            sidebar.classList.add('collapsed');
        }

        document.getElementById('logo-toggle').addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
        });

        // Dark mode toggle
        const darkToggle = document.getElementById('dark-mode-toggle');
        darkToggle.addEventListener('click', () => {
            darkToggle.classList.toggle('on');
        });

        // Log out - clear the server session and return to sign in
        const logoutItem = document.querySelector('.logout-label').closest('.menu-item');
        logoutItem.addEventListener('click', async () => {
            try { await fetch('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
            window.location.replace('../login page/index.html');
        });
    });
})();