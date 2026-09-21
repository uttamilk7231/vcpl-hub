'use strict';

// Tamper-evident audit trail. Every entry is chained to the previous one with
// a SHA-256 hash, so silently editing or deleting history is detectable with
// verify().

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let filePath = null;
let entries = [];

function init(dataDir) {
    filePath = path.join(dataDir, 'audit.json');
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        entries = Array.isArray(raw) ? raw : [];
    } catch (e) {
        entries = [];
    }
}

function digest(prevHash, e) {
    const payload = [
        prevHash,
        e.seq,
        e.ts,
        e.actor || '',
        e.action || '',
        JSON.stringify(e.detail == null ? {} : e.detail)
    ].join('|');
    return crypto.createHash('sha256').update(payload).digest('hex');
}

function persist() {
    if (!filePath) return;
    try {
        fs.writeFileSync(filePath, JSON.stringify(entries), 'utf8');
    } catch (e) {
        console.error('[audit] write failed:', e && e.message);
    }
}

function append(actor, action, detail) {
    const prev = entries.length ? entries[entries.length - 1].hash : 'GENESIS';
    const e = {
        seq: entries.length + 1,
        ts: new Date().toISOString(),
        actor: String(actor || 'system'),
        action: String(action || 'event'),
        detail: detail == null ? {} : detail
    };
    e.prevHash = prev;
    e.hash = digest(prev, e);
    entries.push(e);
    persist();
    return e;
}

function verify() {
    let prev = 'GENESIS';
    for (const e of entries) {
        if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq, reason: 'broken chain link' };
        if (digest(prev, e) !== e.hash) return { ok: false, brokenAt: e.seq, reason: 'tampered entry' };
        prev = e.hash;
    }
    return { ok: true, count: entries.length };
}

function list(limit) {
    const n = Math.max(1, Math.min(1000, Number(limit) || 200));
    return entries.slice(-n).reverse();
}

module.exports = { init, append, verify, list };
