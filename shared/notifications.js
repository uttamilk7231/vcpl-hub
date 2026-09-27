// Real desktop/browser notifications for the VCPL member portal.
//
// Polls the signed-in member's notification feed and raises genuine operating
// system notifications through the Web Notifications API, so the desktop app
// (Electron/Chromium) and the browser behave the same way as the mobile app.
//
// Pages can use it directly:
//   VCPLNotifications.poll()          force a refresh
//   VCPLNotifications.markRead(ids)   clear one or more notifications
//   VCPLNotifications.unread          current unread count
//   window.addEventListener('vcpl:notifications', e => e.detail)  live feed updates
(function () {
    'use strict';
    if (window.VCPLNotifications) return;

    var POLL_MS = 20000;
    var SEEN_KEY = 'vcpl.notifiedIds';
    var MAX_SEEN = 300;
    var timer = null;

    function loadSeen() {
        try {
            var raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
            return Array.isArray(raw) ? new Set(raw) : new Set();
        } catch (e) {
            return new Set();
        }
    }

    function saveSeen(set) {
        try {
            var arr = Array.from(set);
            if (arr.length > MAX_SEEN) arr = arr.slice(arr.length - MAX_SEEN);
            localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
        } catch (e) { /* private mode */ }
    }

    function supported() {
        return typeof window.Notification === 'function';
    }

    // Browsers only allow the permission prompt from a user gesture, so ask on
    // the first click/keypress instead of on page load.
    function armPermissionPrompt() {
        if (!supported() || window.Notification.permission !== 'default') return;
        var ask = function () {
            try { window.Notification.requestPermission(); } catch (e) { /* ignore */ }
        };
        window.addEventListener('click', armOnGesture, { once: true });
        window.addEventListener('keydown', armOnGesture, { once: true });
        function armOnGesture() {
            window.removeEventListener('click', armOnGesture);
            window.removeEventListener('keydown', armOnGesture);
            ask();
        }
    }

    function raise(item) {
        if (!supported() || window.Notification.permission !== 'granted') return;
        try {
            var note = new window.Notification(item.title || 'VCPL update', {
                body: item.body || '',
                tag: 'vcpl-' + item.id,
                icon: '/icon-192.png',
                badge: '/icon-192.png'
            });
            note.onclick = function () {
                try { window.focus(); } catch (e) { /* ignore */ }
                note.close();
                markRead([item.id]);
            };
        } catch (e) { /* some platforms require a service worker */ }
    }

    function markRead(ids) {
        var payload = Array.isArray(ids) && ids.length ? { ids: ids } : {};
        return fetch('/api/notifications/read', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (r) { return r.ok ? r.json() : null; })
            .then(function () { return poll(); })
            .catch(function () { return null; });
    }

    var primed = false;

    function poll() {
        return fetch('/api/notifications?limit=25', {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        }).then(function (r) {
            if (r.status === 401) { stop(); return null; }
            if (!r.ok) return null;
            return r.json();
        }).then(function (data) {
            if (!data || !data.ok) return null;
            var list = data.notifications || [];
            var seen = loadSeen();
            var fresh = list.filter(function (n) { return !seen.has(n.id) && !n.read; });

            if (primed && fresh.length) {
                // Surface at most five at once so a busy day cannot spam the desktop.
                fresh.slice(0, 5).forEach(function (n) { seen.add(n.id); raise(n); });
                saveSeen(seen);
            } else {
                // First poll of a session only records what already exists.
                fresh.forEach(function (n) { seen.add(n.id); });
                saveSeen(seen);
            }
            primed = true;

            document.documentElement.setAttribute('data-vcpl-unread', String(data.unread || 0));
            window.dispatchEvent(new CustomEvent('vcpl:notifications', { detail: data }));
            return data;
        }).catch(function () { return null; });
    }

    function start() {
        if (timer) return;
        timer = setInterval(poll, POLL_MS);
        poll();
    }

    function stop() {
        if (timer) { clearInterval(timer); timer = null; }
    }

    window.VCPLNotifications = {
        start: start,
        stop: stop,
        poll: poll,
        markRead: markRead,
        get unread() { return Number(document.documentElement.getAttribute('data-vcpl-unread') || 0); }
    };

    armPermissionPrompt();
    start();

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) poll();
    });
    window.addEventListener('online', poll);
})();
