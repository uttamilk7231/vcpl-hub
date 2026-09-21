'use strict';

// Cloud persistence: mirrors the local DATA_DIR to a Postgres database (Neon)
// so the hub survives restarts/redeploys on free hosting (ephemeral disks).
//
// Local development keeps using plain files/SQLite. When DATABASE_URL is set,
// the whole data directory is hydrated at boot and every changed file is
// pushed back on a short interval.

const fs = require('node:fs');
const path = require('node:path');

const DATABASE_URL = (process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '').trim();

let pool = null;
let enabled = false;
let dataRoot = '';
const seen = new Map(); // relPath -> "mtimeMs:size"

function toPosix(p) {
    return p.split(path.sep).join('/');
}

function walk(dir, out) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
    for (const e of entries) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name === '.git') continue;
            walk(fp, out);
        } else if (e.isFile()) {
            out.push(fp);
        }
    }
    return out;
}

function normalizedUrl() {
    // node-postgres chokes on the libpq-only "channel_binding" parameter that
    // Neon's copy button appends, so strip it before connecting.
    try {
        const u = new URL(DATABASE_URL);
        u.searchParams.delete('channel_binding');
        return u.toString();
    } catch (e) {
        return DATABASE_URL;
    }
}

async function initStore(rootDir) {
    dataRoot = rootDir;
    if (!fs.existsSync(dataRoot)) fs.mkdirSync(dataRoot, { recursive: true });
    if (!DATABASE_URL) {
        console.log('[store] DATABASE_URL not set - running in local file mode');
        return false;
    }

    let Pool;
    try {
        Pool = require('pg').Pool;
    } catch (e) {
        console.error('[store] "pg" is not installed - staying in local file mode');
        return false;
    }

    const ssl = process.env.PGSSL === 'no-verify' ? { rejectUnauthorized: false } : { rejectUnauthorized: true };
    pool = new Pool({
        connectionString: normalizedUrl(),
        ssl: ssl,
        max: 5,
        connectionTimeoutMillis: 15000
    });
    pool.on('error', (e) => console.error('[store] idle client error:', e && e.message));

    await pool.query(
        'CREATE TABLE IF NOT EXISTS vcpl_files (' +
        'path text PRIMARY KEY, ' +
        'data bytea NOT NULL, ' +
        'updated_at timestamptz NOT NULL DEFAULT now())'
    );

    const { rows } = await pool.query('SELECT path, data FROM vcpl_files');
    for (const r of rows) {
        const fp = path.join(dataRoot, r.path);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, r.data);
        try {
            const st = fs.statSync(fp);
            seen.set(r.path, st.mtimeMs + ':' + st.size);
        } catch (e) { /* ignore */ }
    }

    enabled = true;
    console.log('[store] connected to Postgres - hydrated ' + rows.length + ' file(s) from cloud');
    return true;
}

async function pushFile(rel, abs) {
    const buf = fs.readFileSync(abs);
    await pool.query(
        'INSERT INTO vcpl_files (path, data, updated_at) VALUES ($1, $2, now()) ' +
        'ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
        [rel, buf]
    );
}

async function scan() {
    if (!enabled) return;
    const files = walk(dataRoot, []);
    for (const abs of files) {
        let st;
        try { st = fs.statSync(abs); } catch (e) { continue; }
        const rel = toPosix(path.relative(dataRoot, abs));
        const sig = st.mtimeMs + ':' + st.size;
        if (seen.get(rel) === sig) continue;
        try {
            await pushFile(rel, abs);
            seen.set(rel, sig);
        } catch (e) {
            console.error('[store] could not persist ' + rel + ': ' + (e && e.message));
        }
    }
}

function startSync(intervalMs) {
    if (!enabled) return;
    const ms = Math.max(3000, Number(intervalMs) || 10000);
    const timer = setInterval(() => { scan().catch((e) => console.error('[store] sync error:', e && e.message)); }, ms);
    if (timer.unref) timer.unref();
    // Best-effort flush on shutdown so the last writes are not lost.
    const flush = () => { scan().catch(() => {}); };
    process.on('SIGTERM', flush);
    process.on('SIGINT', flush);
    console.log('[store] cloud sync every ' + ms + 'ms');
}

module.exports = { initStore, startSync, scan, isEnabled: () => enabled };
