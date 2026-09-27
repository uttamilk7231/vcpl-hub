'use strict';

// Per-member notifications and document-sharing records.
//
// Both files live in DATA_DIR, so store.js mirrors them to Postgres/Neon on the
// same cycle as users/documents and they are restored on a cold boot.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let dir = '';
let notifications = []; // oldest -> newest
let shares = [];        // oldest -> newest

const MAX_PER_USER = 100;
const MAX_TOTAL = 5000;
const MAX_SHARES = 2000;

function uid() {
    return crypto.randomBytes(8).toString('hex');
}

function read(file, fallback) {
    try {
        const v = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(v) ? v : fallback;
    } catch (e) {
        return fallback;
    }
}

function write(file, data) {
    if (!dir) return;
    try {
        fs.writeFileSync(file, JSON.stringify(data), 'utf8');
    } catch (e) {
        console.error('[notify] write failed:', e && e.message);
    }
}

function init(dataDir) {
    dir = dataDir;
    if (!dir) return;
    notifications = read(path.join(dir, 'notifications.json'), []);
    shares = read(path.join(dir, 'shares.json'), []);
    console.log(`[notify] loaded ${notifications.length} notification(s), ${shares.length} share(s)`);
}

function saveNotifications() {
    write(path.join(dir, 'notifications.json'), notifications);
}

function saveShares() {
    write(path.join(dir, 'shares.json'), shares);
}

function key(email) {
    return String(email || '').trim().toLowerCase();
}

// Create one notification for a member. Returns the stored record.
function notify(email, opts) {
    const to = key(email);
    if (!to || !dir) return null;
    const o = opts || {};
    const n = {
        id: uid(),
        to: to,
        type: String(o.type || 'info'),
        title: String(o.title || 'Update'),
        body: String(o.body || ''),
        docId: o.docId ? String(o.docId) : null,
        actor: o.actor ? String(o.actor) : '',
        ts: new Date().toISOString(),
        read: 0
    };
    notifications.push(n);

    // Keep the newest MAX_PER_USER for this member so the list never grows forever.
    const mine = notifications.filter(x => x.to === to);
    if (mine.length > MAX_PER_USER) {
        const drop = new Set(mine.slice(0, mine.length - MAX_PER_USER).map(x => x.id));
        notifications = notifications.filter(x => !drop.has(x.id));
    }
    if (notifications.length > MAX_TOTAL) {
        notifications = notifications.slice(-MAX_TOTAL);
    }
    saveNotifications();
    return n;
}

function listFor(email, limit) {
    const to = key(email);
    const n = Math.max(1, Math.min(200, Number(limit) || 50));
    const mine = notifications.filter(x => x.to === to);
    return {
        notifications: mine.slice(-n).reverse(),
        unread: mine.filter(x => !x.read).length
    };
}

// Mark notifications read. Pass an array of ids to clear specific ones,
// or nothing to mark the member's whole list as read.
function markRead(email, ids) {
    const to = key(email);
    const wanted = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
    let updated = 0;
    for (const n of notifications) {
        if (n.to !== to || n.read) continue;
        if (wanted && !wanted.has(n.id)) continue;
        n.read = 1;
        n.readAt = new Date().toISOString();
        updated++;
    }
    if (updated) saveNotifications();
    return updated;
}

// Record that a document was shared with a member and notify them.
function addShare(rec) {
    if (!dir) return null;
    const to = key(rec.to);
    const from = key(rec.from);
    if (!to || !from) return null;
    const share = {
        id: uid(),
        docId: rec.docId ? String(rec.docId) : null,
        title: String(rec.title || 'Document'),
        from: from,
        fromName: String(rec.fromName || rec.from || ''),
        to: to,
        toName: String(rec.toName || rec.to || ''),
        note: String(rec.note || ''),
        ts: new Date().toISOString()
    };
    shares.push(share);
    if (shares.length > MAX_SHARES) shares = shares.slice(-MAX_SHARES);
    saveShares();
    return share;
}

function listSharedWith(email) {
    const to = key(email);
    return shares.filter(s => s.to === to).slice().reverse();
}

function listSharedBy(email) {
    const from = key(email);
    return shares.filter(s => s.from === from).slice().reverse();
}

function removeSharesFor(docId) {
    const before = shares.length;
    shares = shares.filter(s => String(s.docId || '') !== String(docId || ''));
    if (shares.length !== before) saveShares();
    return before - shares.length;
}

module.exports = {
    init,
    notify,
    listFor,
    markRead,
    addShare,
    listSharedWith,
    listSharedBy,
    removeSharesFor
};
