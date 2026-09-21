const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cloudStore = require('./store');
const audit = require('./audit');

let XLSX = null;
try { XLSX = require('xlsx'); } catch (e) { /* optional spreadsheet parser */ }

let DOCX = null;
try { DOCX = require('docx'); } catch (e) { /* optional Word exporter */ }

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const PORT = process.env.PORT || 3000;
const APP_VERSION = process.env.APP_VERSION || '1.0.0';

function readRelease() {
    try {
        return JSON.parse(fs.readFileSync(path.join(ROOT, 'release.json'), 'utf8'));
    } catch (e) {
        return { version: APP_VERSION, desktop: {}, android: {} };
    }
}

const files = {
    users: path.join(DATA_DIR, 'users.json'),
    session: path.join(DATA_DIR, 'session.json'),
    sessions: path.join(DATA_DIR, 'sessions.json'),
    documents: path.join(DATA_DIR, 'documents.json'),
    rooms: path.join(DATA_DIR, 'rooms.json'),
    history: path.join(DATA_DIR, 'history')
};

// ---------- SQLite storage (built-in node:sqlite, zero installs) ----------
let db = null;
try {
    const { DatabaseSync } = require('node:sqlite');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        salt TEXT,
        hash TEXT,
        password TEXT,
        createdAt INTEGER,
        verified INTEGER NOT NULL DEFAULT 0,
        verifyToken TEXT,
        verifyExpires INTEGER
    );`);
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        email TEXT,
        startedAt INTEGER
    );`);
    db.exec(`CREATE TABLE IF NOT EXISTS documents (
        documentId TEXT PRIMARY KEY,
        json TEXT
    );`);
    db.exec(`CREATE TABLE IF NOT EXISTS rooms (
        roomId TEXT PRIMARY KEY,
        json TEXT
    );`);
    const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    if (!userCols.includes('verified')) db.exec('ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0');
    if (!userCols.includes('verifyToken')) db.exec('ALTER TABLE users ADD COLUMN verifyToken TEXT');
    if (!userCols.includes('verifyExpires')) db.exec('ALTER TABLE users ADD COLUMN verifyExpires INTEGER');
} catch (e) {
    console.error('SQLite unavailable, falling back to JSON files only:', e.message);
    db = null;
}

// ---------- Tiny JSON database ----------
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function uid() {
    return crypto.randomBytes(6).toString('hex').toUpperCase();
}

// ---------- Stored file helpers ----------
function csvEscape(value) {
    const s = String(value == null ? '' : value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function formatCell(value) {
    if (value instanceof Date) {
        const d = value;
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return dd + '-' + mm + '-' + d.getFullYear();
    }
    return value == null ? '' : String(value);
}

// Excel serial date range: 1 (1900-01-01) up to 2958465 (9999-12-31).
function excelSerialToDateString(n) {
    const ms = (n - 25569) * 86400000;
    const d = new Date(ms);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return dd + '-' + mm + '-' + d.getUTCFullYear();
}

function looksLikeExcelSerial(s) {
    if (!/^\d{1,7}$/.test(s)) return false;
    const n = Number(s);
    return n >= 1 && n <= 2958465;
}

// Render sheet rows the same way the editor sees them (dates as DD-MM-YYYY,
// Excel serial dates in date columns converted), so diffs compare like-for-like.
function sheetRowsToDisplay(arr) {
    if (!Array.isArray(arr)) return arr;
    let dateCols = null;
    if (arr.length && Array.isArray(arr[0])) {
        dateCols = arr[0].map((h, i) => DATE_RE.test(String(h == null ? '' : h)) ? i : -1).filter(i => i >= 0);
    }
    return arr.map((row, ri) => row.map((cell, ci) => {
        let v = formatCell(cell);
        if (ri > 0 && dateCols && dateCols.includes(ci) && looksLikeExcelSerial(v)) {
            v = excelSerialToDateString(Number(v));
        }
        return v;
    }));
}

// Convert "DD-MM-YYYY" strings back into real Excel date cells on save,
// so the stored file keeps proper dates instead of plain text.
function convertDatesToCells(ws) {
    if (!ws || !ws['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            const cell = ws[addr];
            if (!cell || cell.t !== 's') continue;
            const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(cell.v.trim());
            if (!m) continue;
            const serial = Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000 + 25569;
            ws[addr] = { t: 'n', v: serial, z: 'DD-MM-YYYY' };
        }
    }
    return ws;
}

const FILES_MIME = {
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.pdf': 'application/pdf',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint'
};

function saveFileData(documentId, payload, rawFileName) {
    let data = String(payload || '');
    if (/^data:[^;]+;base64,/.test(data)) {
        data = data.slice(data.indexOf(',') + 1);
    }
    const ext = path.extname(rawFileName || '').toLowerCase();
    const target = path.join(FILES_DIR, path.basename(documentId) + ext);
    if (!target.startsWith(FILES_DIR)) throw new Error('Bad path');
    fs.writeFileSync(target, Buffer.from(data, 'base64'));
    return path.basename(target);
}

function getFileForDocument(doc) {
    if (!doc || !doc.storedFile) return null;
    const p = path.join(FILES_DIR, path.basename(doc.storedFile));
    if (!p.startsWith(FILES_DIR) || !fs.existsSync(p)) return null;
    return p;
}

// Auto-analyse the real heading row out of an uploaded table file.
// Works for Excel (xlsx/xls) and separator text (csv/txt); returns the
// detected column names, an optional sample row, and whether the file is
// structured enough to build a "format-only" template.
function parseTabularHeaders(buf, fileName) {
    const ext = path.extname(fileName || '').toLowerCase();
    let rows = [];
    if (['.xlsx', '.xls'].includes(ext) && XLSX) {
        try {
            const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
            const ws = wb.Sheets[(wb.SheetNames || [])[0]];
            if (ws) rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        } catch (e) { /* unreadable spreadsheet */ }
    } else if (['.csv', '.txt'].includes(ext)) {
        const lines = buf.toString('utf8').split(/\r?\n/);
        const sep = (lines[0] && /[,;\t]/.exec(lines[0])) ? /[,;\t]/.exec(lines[0])[0] : ',';
        const parsedRows = lines.map(l => l.split(sep).map(s => String(s).trim().replace(/^"|"$/g, '')));
        // Skip leading title/blank rows: the heading row is the first one with
        // 2+ filled columns (mirrors the wizard's auto field analysis).
        let first = -1;
        for (let i = 0; i < parsedRows.length && i < 50; i++) {
            if (parsedRows[i].filter(c => c !== '').length >= 2) { first = i; break; }
        }
        if (first >= 0) rows = parsedRows.slice(first).filter(r => r.some(c => c !== ''));
    }
    if (!rows.length) return { headers: [], sample: [], totalRows: 0, formattable: false };
    const headers = (rows[0] || []).map((h, i) => String(h == null || h === '' ? ('Column ' + (i + 1)) : h));
    const formattable = ext === '.txt' ? headers.length >= 2 : headers.length >= 1;
    return { headers: headers, sample: rows[1] || [], totalRows: rows.length, formattable: formattable };
}

// Rewrite a stored file so it carries ONLY the column headings plus one
// empty template row. Returns true if the file was transformed (tabular).
function buildFormatOnlyFile(filePath, ext, headers) {
    if (!headers || !Array.isArray(headers) || !headers.length) return false;
    if (ext === '.txt' && headers.length < 2) return false;
    const out = headers.map(h => (h == null || h === '' ? '' : String(h)));
    if (['.xlsx', '.xls'].includes(ext) && XLSX) {
        const ws = XLSX.utils.aoa_to_sheet([out, out.map(() => '')]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const bookType = ext === '.xls' ? 'biff8' : 'xlsx';
        fs.writeFileSync(filePath, XLSX.write(wb, { type: 'buffer', bookType }));
        return true;
    }
    if (['.csv', '.txt'].includes(ext)) {
        const line = out.map(csvEscape).join(',');
        fs.writeFileSync(filePath, line + '\r\n' + out.map(() => '').join(','), 'utf8');
        return true;
    }
    return false;
}

// Mirror written content to the document's real device file (if connected).
// Returns a warning string if the mirror failed, else null.
function mirrorToConnected(doc, data) {
    if (!doc || !doc.connectedPath) return null;
    try {
        const p = path.resolve(doc.connectedPath);
        fs.writeFileSync(p, data);
        return null;
    } catch (e) {
        return 'Saved to the app, but could not write to the connected device file (' + doc.connectedPath + '): ' + e.message;
    }
}

// Write edited content back to a stored file. Shared by normal saves and version restore.
// body: { rows: [...] } for spreadsheets, { text: '...' } for TXT/CSV.
// Returns { connectedWarning, savedSummary } or throws an Error with a user-friendly message.
function writeContentToFile(filePath, doc, body) {
    const ext = path.extname(doc.storedFile || '').toLowerCase();
    let oldRows = null, oldText = null;
    try {
        if (Array.isArray(body.rows) && XLSX && ['.xlsx', '.xls', '.csv'].includes(ext)) {
            const oldWb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer', cellDates: true });
            const oldWs = oldWb.Sheets[(oldWb.SheetNames || [])[0]];
            if (oldWs) oldRows = sheetRowsToDisplay(XLSX.utils.sheet_to_json(oldWs, { header: 1, defval: '' }));
        } else if (typeof body.text === 'string') {
            oldText = fs.readFileSync(filePath, 'utf8');
        }
    } catch (e) { /* diff is best-effort */ }

    let connectedWarning = null, savedSummary = null;
    if (Array.isArray(body.rows)) {
        const rows = body.rows.map(r => Array.isArray(r) ? r : []);
        if (['.xlsx', '.xls'].includes(ext)) {
            let ws = XLSX.utils.aoa_to_sheet(rows);
            ws = convertDatesToCells(ws) || ws;
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            const bookType = ext === '.xls' ? 'biff8' : 'xlsx';
            const buf = XLSX.write(wb, { type: 'buffer', bookType });
            fs.writeFileSync(filePath, buf);
            connectedWarning = mirrorToConnected(doc, buf);
        } else {
            const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
            fs.writeFileSync(filePath, csv, 'utf8');
            connectedWarning = mirrorToConnected(doc, csv);
        }
        const d = summarizeDiff(oldRows || [], rows);
        const parts = [];
        if (d.changed) parts.push(d.changed + ' row(s) edited');
        if (d.added) parts.push(d.added + ' row(s) added');
        if (d.removed) parts.push(d.removed + ' row(s) removed');
        savedSummary = parts.length ? parts.join(', ') : 'Saved (no visible change)';
    } else if (typeof body.text === 'string') {
        if (!['.txt', '.csv'].includes(ext)) throw new Error('Text edits are only supported for TXT/CSV files.');
        fs.writeFileSync(filePath, body.text, 'utf8');
        connectedWarning = mirrorToConnected(doc, body.text);
        savedSummary = oldText === body.text ? 'Saved (no visible change)' : 'Raw text edited';
    } else {
        throw new Error('Nothing to save.');
    }
    return { connectedWarning: connectedWarning, savedSummary: savedSummary };
}

// ---------- Change history ----------
function historyFile(docId) {
    return path.join(files.history, path.basename(docId) + '.json');
}

function readHistory(docId) {
    try {
        const list = JSON.parse(fs.readFileSync(historyFile(docId), 'utf8'));
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function recordHistory(docId, entry) {
    try {
        if (!fs.existsSync(files.history)) fs.mkdirSync(files.history, { recursive: true });
        const list = readHistory(docId);
        list.push(entry);
        if (list.length > 300) list.splice(0, list.length - 300);
        fs.writeFileSync(historyFile(docId), JSON.stringify(list));
    } catch (e) {
        try { console.error('recordHistory error:', e && e.message); } catch (e2) { /* ignore */ }
    }
}

function summarizeDiff(oldRows, newRows) {
    let added = 0, removed = 0, changed = 0;
    const n = Math.max(oldRows.length, newRows.length);
    for (let i = 0; i < n; i++) {
        const a = oldRows[i], b = newRows[i];
        if (!a) { added++; continue; }
        if (!b) { removed++; continue; }
        if (JSON.stringify(a) !== JSON.stringify(b)) changed++;
    }
    return { added, removed, changed };
}

// Content-based date column fallback: a column is a date column if >=90% of
// its non-empty values parse as dates (used when no header looks like a date).
function detectDateColumnsByContent(all) {
    const res = [];
    const width = all.reduce((m, r) => Math.max(m, (r || []).length), 0);
    for (let c = 0; c < width; c++) {
        let hits = 0, scans = 0;
        for (let i = 1; i < all.length && scans < 300; i++) {
            const v = all[i][c];
            if (v == null || v === '') continue;
            scans++;
            if (parseDateValue(v)) hits++;
        }
        if (scans >= 3 && hits / scans >= 0.9) res.push(c);
    }
    return res;
}

// ---------- Minimal dependency-free PDF writer ----------
// Renders title + meta + text rows as a simple A4 report (built-in Helvetica).
function makeSimplePdf(sections) {
    const esc = (t) => String(t == null ? '' : t)
        .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
        .replace(/[^\x20-\x7E]/g, '_');
    const W = 595.28, H = 841.89;
    const ML = 50, MR = 50, MT = 64, MB = 44;
    const LW = W - ML - MR;
    const FONT = 9, MED = 11, BIG = 14, LEAD = 13;

    const raw = [];
    sections.forEach(sec => {
        if (sec.title) raw.push({ t: esc(sec.title), size: BIG, bold: true, gap: 10, pad: 2 });
        (sec.meta || []).forEach(m => raw.push({ t: esc(m), size: MED, bold: false, gap: 2, pad: 1 }));
        if (sec.message) raw.push({ t: esc(sec.message), size: FONT, bold: false, gap: 6 });
        if (sec.headers || (sec.rows && sec.rows.length)) {
            const headers = sec.headers || [];
            const rows = sec.rows || [];
            const cols = headers.length || rows.reduce((m, r) => Math.max(m, (r || []).length), 1);
            const colW = Math.max(18, Math.floor((LW - (cols - 1) * 8) / cols));
            const maxC = Math.max(1, Math.floor(colW / (FONT * 0.5)));
            const fit = (v) => {
                const s = String(v == null ? '' : v).replace(/[^\x20-\x7E]/g, '_');
                return s.length <= maxC ? s : s.slice(0, Math.max(4, maxC - 3)) + '...';
            };
            if (headers.length) raw.push({ t: headers.map(fit).join('    '), size: FONT, bold: true, gap: 5, underline: true });
            rows.forEach(r => {
                const v = Array(cols).fill('');
                (r || []).forEach((x, i) => { if (i < cols) v[i] = x; });
                raw.push({ t: v.map(fit).join('    '), size: FONT, bold: false });
            });
        }
    });

    const pages = [];
    let cur = [], y = MT;
    const flush = (newPage) => {
        if (newPage && cur.length) { pages.push(cur); cur = []; y = MT; }
    };
    raw.forEach(r => {
        const size = r.size || FONT;
        const width = Math.max(1, Math.floor(LW / (size * 0.5)));
        let t = r.t || '';
        const toks = [];
        while (t.length > width) { toks.push(t.slice(0, width)); t = t.slice(width); }
        if (t.length) toks.push(t);
        toks.forEach((ln, i) => {
            const isLast = i === toks.length - 1;
            if (y + size + (isLast ? LEAD + (r.pad || 0) + (r.gap || 0) : 2) > H - MB) flush(true);
            cur.push({ t: ln, size: size, bold: !!r.bold, underline: !!r.underline });
            y += size + (isLast ? LEAD + (r.pad || 0) + (r.gap || 0) : 2);
        });
    });
    if (cur.length) pages.push(cur);

    // Object numbering (built in a fixed order so cross-references are exact):
    // 1 Helvetica-Bold, 2 Helvetica, 3..3+n-1 content streams, next n page objs,
    // then Pages, then Catalog.
    const n = pages.length;
    const idFontB = 1, idFontR = 2;
    const idContentStart = 3;
    const idPageStart = idContentStart + n;
    const idPages = idPageStart + n;
    const idCatalog = idPages + 1;
    const idTotal = idCatalog;

    const contentStreamsFixed = pages.map(pg => {
        const parts = [];
        let cursorY = H - MT;
        pg.forEach(l => {
            const size = l.size || FONT;
            parts.push('/F' + (l.bold ? '2' : '1') + ' ' + size + ' Tf\n1 0 0 1 ' + ML + ' ' + cursorY + ' Tm\n(' + l.t + ') Tj');
            if (l.underline) parts.push('1 0 0 1 ' + ML + ' ' + (cursorY + 1) + ' Tm\n(................................................................................) Tj');
            cursorY -= size + LEAD;
        });
        return 'BT\n' + parts.join('\n') + '\nET';
    });

    const objs = [];
    objs[idFontB - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
    objs[idFontR - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    contentStreamsFixed.forEach(cs => {
        objs[idContentStart - 1] = '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream';
    });
    for (let i = 0; i < n; i++) {
        objs[idPageStart - 1 + i] = '<< /Type /Page /Parent ' + idPages + ' 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 ' + idFontR + ' 0 R /F2 ' + idFontB + ' 0 R >> /ProcSet [/PDF /Text] >> /Contents ' + (idContentStart + i) + ' 0 R >>';
    }
    objs[idPages - 1] = '<< /Type /Pages /Kids [' + Array.from({ length: n }, (_, i) => (idPageStart + i) + ' 0 R').join(' ') + '] /Count ' + n + ' >>';
    objs[idCatalog - 1] = '<< /Type /Catalog /Pages ' + idPages + ' 0 R >>';

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    for (let i = 0; i < objs.length; i++) {
        offsets.push(out.length);
        out += (i + 1) + ' 0 obj\n' + objs[i] + '\nendobj\n';
    }
    const xrefAt = out.length;
    out += 'xref\n0 ' + (idTotal + 1) + '\n0000000000 65535 f \n' + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += 'trailer\n<< /Size ' + (idTotal + 1) + ' /Root ' + idCatalog + ' 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF';
    return Buffer.from(out, 'latin1');
}

// ---------- Date helpers (for calendar export) ----------
const DATE_RE = /date|fecha|datum/i;

function getDateColumnIndices(header) {
    const idx = [];
    (header || []).forEach((h, c) => {
        if (DATE_RE.test(String(h == null ? '' : h))) idx.push(c);
    });
    return idx;
}

function excelSerialToDate(num) {
    const n = Number(num);
    if (isNaN(n) || n <= 0) return null;
    // Excel epoch: 1899-12-30 (with the 1900 leap year bug workaround)
    return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
}

function parseDateValue(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    const s = String(v).trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) {
        const num = Number(s);
        if (num > 20000) return excelSerialToDate(num);
        return null;
    }
    let m = /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) {
        let day = +m[1], mon = +m[2], yr = +m[3];
        if (mon > 12) { const t = day; day = mon; mon = t; }
        return new Date(yr, mon - 1, day, +m[4] || 0, +m[5] || 0, +m[6] || 0);
    }
    m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0, +m[6] || 0);
    const iso = new Date(s);
    return isNaN(iso.getTime()) ? null : iso;
}

function toMonthRange(monthStr) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(String(monthStr || ''));
    if (!m) return null;
    const start = new Date(+m[1], +m[2] - 1, 1);
    const end = new Date(+m[1], +m[2], 0, 23, 59, 59);
    return { from: start, to: end };
}

function toYearRange(yearStr) {
    const y = +String(yearStr || '');
    if (!y) return null;
    return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59) };
}

function toDayRange(dayStr) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(dayStr || ''));
    if (!m) return null;
    return { from: new Date(+m[1], +m[2] - 1, +m[3]), to: new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59) };
}

// ---------- Data access (SQLite source of truth, JSON mirror) ----------
function getUsers() {
    if (db) {
        try {
            const rows = db.prepare('SELECT * FROM users').all();
            if (rows.length) return rows.map(r => ({ id: r.id, name: r.name, email: r.email, salt: r.salt || undefined, hash: r.hash || undefined, password: r.password || undefined, createdAt: r.createdAt, verified: Number(r.verified || 0), verifyToken: r.verifyToken || undefined, verifyExpires: r.verifyExpires || undefined }));
        } catch (e) { /* fall through */ }
    }
    const list = readJson(files.users, []);
    if (db && list.length) {
        try {
            const ins = db.prepare('INSERT OR REPLACE INTO users (id,name,email,salt,hash,password,createdAt,verified,verifyToken,verifyExpires) VALUES (?,?,?,?,?,?,?,?,?,?)');
            db.exec('BEGIN');
            try { for (const u of list) ins.run(u.id, u.name, u.email, u.salt || null, u.hash || null, u.password || null, u.createdAt, u.verified || 0, u.verifyToken || null, u.verifyExpires || null); db.exec('COMMIT'); }
            catch (er) { db.exec('ROLLBACK'); }
        } catch (e) { /* ignore */ }
    }
    return list;
}
function saveUsers(list) {
    writeJson(files.users, list);
    if (!db) return;
    const ins = db.prepare('INSERT OR REPLACE INTO users (id,name,email,salt,hash,password,createdAt,verified,verifyToken,verifyExpires) VALUES (?,?,?,?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    try {
        db.prepare('DELETE FROM users').run();
        for (const u of list) ins.run(u.id || uid(), u.name || '', u.email || '', u.salt || null, u.hash || null, u.password || null, u.createdAt || Date.now(), u.verified || 0, u.verifyToken || null, u.verifyExpires || null);
        db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function getSessions() {
    if (db) {
        try {
            const rows = db.prepare('SELECT token, email, startedAt FROM sessions').all();
            if (rows.length) { const map = {}; for (const r of rows) map[r.token] = { email: r.email, startedAt: r.startedAt }; return map; }
        } catch (e) { /* fall through */ }
    }
    const s = readJson(files.sessions, {});
    const map = (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
    if (db && Object.keys(map).length) {
        try {
            const ins = db.prepare('INSERT OR REPLACE INTO sessions (token,email,startedAt) VALUES (?,?,?)');
            db.exec('BEGIN');
            try { for (const tok of Object.keys(map)) ins.run(tok, map[tok].email, map[tok].startedAt); db.exec('COMMIT'); }
            catch (er) { db.exec('ROLLBACK'); }
        } catch (e) { /* ignore */ }
    }
    return map;
}
function saveSessions(map) {
    writeJson(files.sessions, map || {});
    if (!db) return;
    const ins = db.prepare('INSERT OR REPLACE INTO sessions (token,email,startedAt) VALUES (?,?,?)');
    db.exec('BEGIN');
    try {
        db.prepare('DELETE FROM sessions').run();
        for (const tok of Object.keys(map || {})) ins.run(tok, map[tok].email, map[tok].startedAt);
        db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- Email verification (real original email only) ----------
const DISPOSABLE_DOMAINS = new Set(`
mailinator.com mailinator.net mailinator.org
yopmail.com yopmail.fr yopmail.net
guerrillamail.com guerrillamail.net grr.la guerrillamail.org
tempmail.com tempmail.net tempmail.org
10minutemail.com 10minutemail.net 10minutemail.org
temp-mail.org temp-mail.io temp-mail.com
throwawaymail.com throwaway.email throwawaymail.org
maildrop.cc maildrop.io
getnada.com nada.email
dispostable.com
mailnesia.com
mailcatch.com
mailnull.com
mailmetrash.com
mytempemail.com
spam4.me
sharklasers.com
emailondeck.com
mintemail.com
mailtemp.net
maileater.com
mailsac.com
throwaway.link
tempinbox.com
discard.email
discardmail.com discardmail.de
minutemail.com minutesmail.net
trashmail.com trashmail.de trashmail.me
jetable.org
spamgourmet.com
mailexpire.com
meltmail.com
maildrop.xyz
harakirimail.com
fakeinbox.com
fakemail.net
armyspy.com
cuvox.de
dayrep.com
einrot.com
fleckens.hu
gustr.com
jourrapide.com
teleworm.us
gmail.com.gmail.net.nware
`.trim().split(/\s+/));

function isThrowawayEmail(email) {
    const at = String(email).indexOf('@');
    if (at < 1) return true;
    const domain = String(email).slice(at + 1).toLowerCase().trim();
    const labels = domain.split('.');
    const base = labels.length >= 2 ? labels.slice(-2).join('.') : domain;
    return DISPOSABLE_DOMAINS.has(domain) || DISPOSABLE_DOMAINS.has(base);
}

const SMTP = {
    host: (process.env.SMTP_HOST || '').trim(),
    port: Number(process.env.SMTP_PORT || 587),
    user: (process.env.SMTP_USER || '').trim(),
    pass: process.env.SMTP_PASS || '',
    from: (process.env.SMTP_FROM || (process.env.SMTP_USER || 'no-reply@vcpl.local')).trim()
};

function mailtoHeader(to, subject) {
    return 'From: ' + SMTP.from +
        '\r\nTo: ' + to +
        '\r\nSubject: ' + String(subject).replace(/[\r\n]/g, ' ') +
        '\r\nMIME-Version: 1.0' +
        '\r\nContent-Type: text/plain; charset=utf-8' +
        '\r\nMessage-ID: <' + crypto.randomBytes(12).toString('hex') + '@vcpl>\r\n\r\n';
}

function smtpTransaction(to, subject, body) {
    return new Promise((resolve, reject) => {
        const net = require('node:net');
        const tls = require('node:tls');
        const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

        let step = 0;
        let buf = '';
        let sock;

        const finish = (err) => {
            try { sock && sock.destroy(); } catch (e) { /* ignore */ }
            if (err && !err.message) {
                err.message = String(err.code || err.name || err || 'unknown');
            }
            err ? reject(err) : resolve(true);
        };

        const onData = (chunk) => {
            buf += chunk.toString('utf8');
            const lines = buf.split(/\r?\n/);
            buf = lines.pop();
            for (const raw of lines) {
                if (!/^\d{3}[ -]/.test(raw)) continue;
                const code = parseInt(raw.slice(0, 3), 10);
                if (raw.charAt(3) === '-') continue;
                if (step === 0) { if (code === 220) { step = 1; sock.write('EHLO vcpl.local\r\n'); } else finish(new Error('SMTP connect ' + code)); }
                else if (step === 1) { if (code === 250) { step = 2; if (SMTP.port === 465) { upgradeToTls(); } else { sock.write('STARTTLS\r\n'); } } else finish(new Error('EHLO failed ' + code)); }
                else if (step === 2) { if (code === 220) { upgradeToTls(); } else finish(new Error('STARTTLS failed ' + code)); }
                else if (step === 3) { if (code === 250) { step = 4; sock.write('AUTH LOGIN\r\n'); } else finish(new Error('EHLO-TLS failed ' + code)); }
                else if (step === 4) { if (code === 334) { step = 5; sock.write(b64(SMTP.user) + '\r\n'); } else finish(new Error('AUTH user rejected ' + code)); }
                else if (step === 5) { if (code === 334) { step = 6; sock.write(b64(SMTP.pass) + '\r\n'); } else finish(new Error('AUTH pass rejected ' + code)); }
                else if (step === 6) { if (code === 235) { step = 7; sock.write('MAIL FROM:<' + SMTP.from + '>\r\n'); } else finish(new Error('AUTH failed ' + code)); }
                else if (step === 7) { if (code === 250) { step = 8; sock.write('RCPT TO:<' + to + '>\r\n'); } else finish(new Error('MAIL FROM rejected ' + code)); }
                else if (step === 8) { if (code === 250) { step = 9; sock.write('DATA\r\n'); } else finish(new Error('RCPT rejected ' + code)); }
                else if (step === 9) { if (code === 354) { step = 10; sock.write(mailtoHeader(to, subject) + body + '\r\n.\r\n'); } else finish(new Error('DATA rejected ' + code)); }
                else if (step === 10) { if (code === 250) { step = 11; sock.write('QUIT\r\n'); finish(); } else finish(new Error('Message rejected ' + code)); }
                else finish(new Error('SMTP out of sequence ' + code));
            }
        };

        const upgradeToTls = () => {
            const raw = sock;
            raw.removeListener('data', onData);
            sock = tls.connect({ socket: raw, servername: SMTP.host });
            sock.on('data', onData);
            sock.on('error', (e) => finish(e));
            step = 3;
            sock.write('EHLO vcpl.local\r\n');
        };

        try {
            sock = (SMTP.port === 465)
                ? tls.connect({ host: SMTP.host, port: SMTP.port, servername: SMTP.host })
                : net.connect(SMTP.port, SMTP.host);
            sock.setTimeout(20000);
            sock.on('timeout', () => finish(new Error('SMTP timeout')));
            sock.on('error', (e) => finish(e));
            sock.on('data', onData);
        } catch (e) { finish(e); }
    });
}

function devMailSink(to, subject, text, link) {
    ensureDataDir();
    const file = path.join(DATA_DIR, 'mailbox.jsonl');
    const line = JSON.stringify({ at: new Date().toISOString(), to: to, subject: subject, link: link });
    fs.appendFileSync(file, line + '\n', 'utf8');
    console.log('[mail-dev] to=' + to + ' link=' + link);
    return true;
}

async function sendMail(to, subject, text, link) {
    if (SMTP.host && SMTP.user) {
        try {
            await smtpTransaction(to, subject, text);
            console.log('[mail-smtp] sent to ' + to + ' subject=' + subject);
            return true;
        } catch (e) {
            console.error('[mail-smtp] failed (' + e.message + ' name=' + e.name + ' code=' + (e.code || '-') + '), using dev sink');
        }
    }
    return devMailSink(to, subject, text, link);
}

function sendVerificationMail(to, token, base) {
    const link = base + '/api/verify?token=' + encodeURIComponent(token);
    const subject = 'Verify your VCPL account';
    const text = 'Hi,\n\nPlease verify your email address to activate your VCPL account.\n\nVerification link:\n' + link + '\n\nThis link expires in 48 hours. If you did not create this account, ignore this email.\n\n-- VCPL';
    return sendMail(to, subject, text, link);
}

// ---------- Google (Gmail) OAuth ----------
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
const GOOGLE_REDIRECT = (process.env.GOOGLE_REDIRECT || '').trim();
const GOOGLE_AUTH_ENABLED = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const googleStates = new Map();
const GOOGLE_STATE_TTL = 10 * 60 * 1000;

function baseFromReq(req) {
    return process.env.BASE_URL || ('http://' + (req.headers.host || 'localhost:' + PORT));
}

function googleStateIssue(base) {
    const token = crypto.randomBytes(24).toString('hex');
    googleStates.set(token, { base: base, exp: Date.now() + GOOGLE_STATE_TTL });
    return token;
}

function googleStateConsume(token) {
    const rec = token ? googleStates.get(token) : null;
    if (!rec) return null;
    googleStates.delete(token);
    if (Date.now() > rec.exp) return null;
    return rec.base;
}

function googleAuthUrl(base) {
    const redirectUri = (GOOGLE_REDIRECT || (base + '/api/auth/google/callback'));
    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        prompt: 'select_account',
        state: googleStateIssue(base)
    });
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

async function googleTokenExchange(code, redirectUri) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code: code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        })
    });
    if (!res.ok) throw new Error('Google token exchange failed: ' + res.status);
    return res.json();
}

async function googleProfile(accessToken) {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: 'Bearer ' + accessToken }
    });
    if (!res.ok) throw new Error('Google profile fetch failed: ' + res.status);
    return res.json();
}

// ---------- GitHub OAuth ----------
const GITHUB_CLIENT_ID = (process.env.GITHUB_CLIENT_ID || '').trim();
const GITHUB_CLIENT_SECRET = (process.env.GITHUB_CLIENT_SECRET || '').trim();
const GITHUB_REDIRECT = (process.env.GITHUB_REDIRECT || '').trim();
const GITHUB_AUTH_ENABLED = !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET);
const githubStates = new Map();

function githubStateIssue(base) {
    const token = crypto.randomBytes(24).toString('hex');
    githubStates.set(token, { base: base, exp: Date.now() + GOOGLE_STATE_TTL });
    return token;
}

function githubStateConsume(token) {
    const rec = token ? githubStates.get(token) : null;
    if (!rec) return null;
    githubStates.delete(token);
    if (Date.now() > rec.exp) return null;
    return rec.base;
}

function githubAuthUrl(base) {
    const redirectUri = (GITHUB_REDIRECT || (base + '/api/auth/github/callback'));
    const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        redirect_uri: redirectUri,
        scope: 'read:user user:email',
        state: githubStateIssue(base)
    });
    return 'https://github.com/login/oauth/authorize?' + params.toString();
}

async function githubTokenExchange(code, redirectUri) {
    const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code: code,
            redirect_uri: redirectUri
        })
    });
    if (!res.ok) throw new Error('GitHub token exchange failed: ' + res.status);
    const j = await res.json();
    if (!j.access_token) throw new Error('GitHub did not return an access token');
    return j.access_token;
}

async function githubProfile(token) {
    const headers = {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'vcpl-hub'
    };
    const ures = await fetch('https://api.github.com/user', { headers: headers });
    if (!ures.ok) throw new Error('GitHub profile fetch failed: ' + ures.status);
    const u = await ures.json();
    let email = String(u.email || '').trim().toLowerCase();
    if (!email) {
        const er = await fetch('https://api.github.com/user/emails', { headers: headers });
        if (er.ok) {
            const list = await er.json();
            const pick = Array.isArray(list) ? (list.find(e => e.primary && e.verified) || list.find(e => e.verified)) : null;
            if (pick && pick.email) email = String(pick.email).toLowerCase();
        }
    }
    return { name: u.name || u.login || email.split('@')[0], email: email };
}

function getDocuments() {
    if (db) {
        try {
            const rows = db.prepare('SELECT json FROM documents').all();
            if (rows.length) return rows.map(r => JSON.parse(r.json));
        } catch (e) { /* fall through */ }
    }
    const list = readJson(files.documents, []);
    if (db && list.length) {
        try {
            const ins = db.prepare('INSERT OR REPLACE INTO documents (documentId,json) VALUES (?,?)');
            db.exec('BEGIN');
            try { for (const d of list) ins.run(d.documentId, JSON.stringify(d)); db.exec('COMMIT'); }
            catch (er) { db.exec('ROLLBACK'); }
        } catch (e) { /* ignore */ }
    }
    return list;
}
function saveDocuments(list) {
    writeJson(files.documents, list);
    if (!db) return;
    const ins = db.prepare('INSERT OR REPLACE INTO documents (documentId,json) VALUES (?,?)');
    db.exec('BEGIN');
    try {
        db.prepare('DELETE FROM documents').run();
        for (const d of list) ins.run(d.documentId, JSON.stringify(d));
        db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function getRooms() {
    if (db) {
        try {
            const rows = db.prepare('SELECT json FROM rooms').all();
            if (rows.length) return rows.map(r => JSON.parse(r.json));
        } catch (e) { /* fall through */ }
    }
    const list = readJson(files.rooms, []);
    if (db && list.length) {
        try {
            const ins = db.prepare('INSERT OR REPLACE INTO rooms (roomId,json) VALUES (?,?)');
            db.exec('BEGIN');
            try { for (const r of list) ins.run(r.roomId || r.id || uid(), JSON.stringify(r)); db.exec('COMMIT'); }
            catch (er) { db.exec('ROLLBACK'); }
        } catch (e) { /* ignore */ }
    }
    return list;
}
function saveRooms(list) {
    writeJson(files.rooms, list);
    if (!db) return;
    const ins = db.prepare('INSERT OR REPLACE INTO rooms (roomId,json) VALUES (?,?)');
    db.exec('BEGIN');
    try {
        db.prepare('DELETE FROM rooms').run();
        for (const r of list) ins.run(r.roomId || r.id || uid(), JSON.stringify(r));
        db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const COOKIE_NAME = 'vcpl_session';

// ---------- Password hashing (free, built-in scrypt) ----------
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
    return { salt: salt, hash: hash };
}

function verifyPassword(password, user) {
    // New-style: scrypt hash with stored salt.
    if (user.salt && user.hash) {
        const candidate = crypto.scryptSync(String(password), user.salt, 32).toString('hex');
        const a = Buffer.from(candidate, 'hex');
        const b = Buffer.from(user.hash, 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    // Legacy: plaintext stored before the upgrade.
    if (user.password != null) return user.password === String(password);
    return false;
}

// ---------- Rate limiting (in-memory, free) ----------
const rateBuckets = new Map();
function rateLimited(key, limit, windowMs) {
    const now = Date.now();
    const rec = rateBuckets.get(key);
    if (!rec || now - rec.start > windowMs) {
        rateBuckets.set(key, { start: now, count: 1 });
        return false;
    }
    rec.count++;
    return rec.count > limit;
}

function clientIp(req) {
    return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// ---------- Token-based sessions (cookie) ----------
function parseCookies(req) {
    const out = {};
    const raw = req.headers.cookie || '';
    raw.split(';').forEach(pair => {
        const i = pair.indexOf('=');
        if (i > 0) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
    });
    return out;
}

function getSessionToken(req) {
    return parseCookies(req)[COOKIE_NAME] || null;
}

// Session tokens are stored as SHA-256 hashes, so a leaked database/file dump
// cannot be replayed as a live login. Sessions also expire.
const SESSION_TTL_MS = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 168)) * 3600 * 1000;

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function cookieFlags() {
    // Behind a TLS-terminating proxy (Render/Koyeb) requests are https; only then
    // is the Secure flag safe to set (http://localhost would otherwise drop it).
    return '; HttpOnly; SameSite=Lax; Path=/' + (process.env.COOKIE_SECURE === '1' ? '; Secure' : '');
}

function getSessionUser(req) {
    if (!req) return null;
    const token = getSessionToken(req);
    if (!token) return null;
    const sessions = getSessions();
    const key = hashToken(token);
    const sess = sessions[key];
    if (!sess) return null;
    if (SESSION_TTL_MS && Date.now() - (sess.startedAt || 0) > SESSION_TTL_MS) {
        delete sessions[key];
        saveSessions(sessions);
        return null;
    }
    return getUsers().find(u => u.email === sess.email) || null;
}

function newSession(req, res) {
    const email = req.__sessionEmail;
    const token = crypto.randomBytes(32).toString('base64url');
    const sessions = getSessions();
    sessions[hashToken(token)] = { email: email, startedAt: Date.now() };
    saveSessions(sessions);
    res.setHeader('Set-Cookie', COOKIE_NAME + '=' + token + cookieFlags() + '; Max-Age=604800');
    return token;
}

function endSession(req, res) {
    const token = getSessionToken(req);
    if (token) {
        const sessions = getSessions();
        delete sessions[hashToken(token)];
        saveSessions(sessions);
    }
    res.setHeader('Set-Cookie', COOKIE_NAME + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function initials(name) {
    return String(name).trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '--';
}

// ---------- HTTP utilities ----------
function sendJson(res, status, data) {
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, RESP_HEADERS));
    res.end(JSON.stringify(data));
}

function readBody(req, maxBytes) {
    const limit = Number(maxBytes) || 5 * 1024 * 1024; // 5 MB default
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        let tooBig = false;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) { tooBig = true; req.destroy(); return; }
            body += chunk;
        });
        req.on('end', () => {
            if (tooBig) return reject(new Error('Payload too large'));
            resolve(body);
        });
        req.on('error', (e) => reject(e));
    });
}

// Tolerantly parse a JSON request body; returns {} for empty/garbage.
async function safeBody(req) {
    try {
        const raw = (await readBody(req)) || '{}';
        return JSON.parse(raw) || {};
    } catch (e) {
        return {};
    }
}

// Neutralize CSV formula injection (=, +, -, @, tab) in exported text.
function csvSafeExport(value) {
    const s = String(value == null ? '' : value).trimLeft();
    if (/^[=+\-@\t]/.test(s)) return "'" + String(value);
    return String(value == null ? '' : value);
}

// ---------- API routes ----------

// Check whether a user may view/edit a document (owner or member).
function canAccessDocument(doc, user) {
    if (!doc || !user) return false;
    if (doc.user && doc.user.email === user.email) return true;
    return Array.isArray(doc.members) && doc.members.some(m => m && m.email === user.email);
}
async function handleApi(req, res, url) {
    const method = req.method;
    MON_REQ++;

    // GET /api/bootstrap - decide where the root page goes
    if (url.pathname === '/api/bootstrap' && method === 'GET') {
        const user = getSessionUser(req);
        return sendJson(res, 200, {
            loggedIn: !!user,
            user: user ? { name: user.name, email: user.email } : null,
            hasAccount: getUsers().length > 0
        });
    }

    // GET /api/health - process health / counters for monitoring
    if (url.pathname === '/api/health' && method === 'GET') {
        const mem = process.memoryUsage();
        return sendJson(res, 200, {
            ok: true,
            uptimeSeconds: Math.round((Date.now() - MON_STARTED) / 1000),
            requests: MON_REQ,
            saves: MON_SAVED,
            liveEditors: MON_WS,
            memoryMB: {
                rss: Math.round(mem.rss / 1048576),
                heapUsed: Math.round(mem.heapUsed / 1048576)
            },
            documents: getDocuments().length,
            time: new Date().toISOString()
        });
    }

    // GET /api/version - latest release info (drives in-app "Check for updates")
    if (url.pathname === '/api/version' && method === 'GET') {
        const rel = readRelease();
        return sendJson(res, 200, {
            ok: true,
            version: rel.version || APP_VERSION,
            releaseNotes: rel.releaseNotes || '',
            desktop: rel.desktop || {},
            android: rel.android || {}
        });
    }

    // POST /api/signup - create a new account
    if (url.pathname === '/api/signup' && method === 'POST') {
        if (rateLimited('signup:' + clientIp(req), 10, 15 * 60000)) {
            return sendJson(res, 429, { ok: false, error: 'Too many sign-up attempts. Try again later.' });
        }

        let body = {};
        try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, { ok: false, error: 'Bad request.' }); }
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');

        if (!name || !email || !password) {
            return sendJson(res, 400, { ok: false, error: 'All fields are required.' });
        }
        if (!/^\S+@\S+\.\S+$/.test(email)) {
            return sendJson(res, 400, { ok: false, error: 'Please enter a valid email address.' });
        }
        if (isThrowawayEmail(email)) {
            return sendJson(res, 400, { ok: false, error: 'Please register with a real, non-disposable email address.' });
        }
        if (password.length < 6) {
            return sendJson(res, 400, { ok: false, error: 'Password must be at least 6 characters long.' });
        }

        const users = getUsers();
        if (users.some(u => u.email === email)) {
            return sendJson(res, 409, { ok: false, error: 'An account with this email already exists.' });
        }

        const { salt, hash } = hashPassword(password);
        const verifyToken = crypto.randomBytes(24).toString('base64url');
        const newUser = {
            id: uid(),
            name: name,
            email: email,
            salt: salt,
            hash: hash,
            createdAt: Date.now(),
            verified: 0,
            verifyToken: verifyToken,
            verifyExpires: Date.now() + 48 * 3600 * 1000
        };
        users.push(newUser);
        saveUsers(users);
        audit.append(email, 'signup', { name: name });

        const base = baseFromReq(req);
        sendVerificationMail(email, verifyToken, base).catch(e => console.error('[mail] verify send error:', e && e.message));

        return sendJson(res, 201, { ok: true, user: { name: name, email: email }, message: 'Verification link sent. Check your inbox to activate your account.' });
    }

    // POST /api/login - verify credentials and start a session
    if (url.pathname === '/api/login' && method === 'POST') {
        if (rateLimited('login:' + clientIp(req), 5, 15 * 60000)) {
            return sendJson(res, 429, { ok: false, error: 'Too many attempts. Wait a few minutes and try again.' });
        }

        let body = {};
        try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, { ok: false, error: 'Bad request.' }); }
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');

        const user = getUsers().find(u => u.email === email);
        if (!user) {
            return sendJson(res, 404, { ok: false, error: 'No account found with this email.' });
        }
        if (!verifyPassword(password, user)) {
            return sendJson(res, 401, { ok: false, error: 'Incorrect password.' });
        }
        if (Number(user.verified || 0) !== 1) {
            return sendJson(res, 403, { ok: false, error: 'Please verify your email first. Check your inbox for the link we sent.', unverified: true, email: user.email });
        }

        // Upgrade legacy plaintext passwords to hashed on successful login.
        if (!user.salt) {
            const { salt, hash } = hashPassword(password);
            user.salt = salt;
            user.hash = hash;
            delete user.password;
            saveUsers(getUsers());
        }

        req.__sessionEmail = user.email;
        newSession(req, res);
        audit.append(user.email, 'login', {});
        return sendJson(res, 200, { ok: true, user: { name: user.name, email: user.email } });
    }

    // POST /api/logout - clear the session
    if (url.pathname === '/api/logout' && method === 'POST') {
        const who = getSessionUser(req);
        endSession(req, res);
        if (who) audit.append(who.email, 'logout', {});
        return sendJson(res, 200, { ok: true });
    }

    // GET /api/session - current logged-in user (used by dashboard/profile)
    if (url.pathname === '/api/session' && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });
        return sendJson(res, 200, { ok: true, user: { name: user.name, email: user.email } });
    }

    // GET /api/verify - confirm email address via emailed link
    if (url.pathname === '/api/verify' && method === 'GET') {
        const token = String(url.searchParams.get('token') || '');
        const now = Date.now();
        const users = getUsers();
        const user = users.find(u => u.verifyToken && u.verifyToken === token);
        const expires = user ? user.verifyExpires : undefined;
        if (user) user.verified = 1;
        if (user) user.verifyToken = undefined;
        if (user) user.verifyExpires = undefined;
        if (user) saveUsers(users);
        const ok = !!(user && (now <= (expires || now)));
        res.writeHead(302, { Location: '/login page/?verified=' + (ok ? '1' : '0') });
        return res.end();
    }

    // POST /api/resend-verification - email another link to an unverified account
    if (url.pathname === '/api/resend-verification' && method === 'POST') {
        let body = {};
        try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, { ok: false, error: 'Bad request.' }); }
        const email = String(body.email || '').trim().toLowerCase();
        if (!email) return sendJson(res, 400, { ok: false, error: 'Email is required.' });
        if (rateLimited('resend:' + email, 5, 15 * 60000)) {
            return sendJson(res, 429, { ok: false, error: 'Too many requests. Try again in a few minutes.' });
        }
        const users = getUsers();
        const user = users.find(u => u.email === email);
        if (user && Number(user.verified || 0) !== 1) {
            user.verifyToken = crypto.randomBytes(24).toString('base64url');
            user.verifyExpires = Date.now() + 48 * 3600 * 1000;
            saveUsers(users);
            const base = baseFromReq(req);
            sendVerificationMail(email, user.verifyToken, base).catch(e => console.error('[mail] resend error:', e && e.message));
        }
        return sendJson(res, 200, { ok: true });
    }

    // GET /api/auth/google - start Google (Gmail) sign-in
    if (url.pathname === '/api/auth/google' && method === 'GET') {
        if (!GOOGLE_AUTH_ENABLED) {
            return sendJson(res, 503, { ok: false, error: 'Sign in with Google is not configured yet.' });
        }
        res.writeHead(302, { Location: googleAuthUrl(baseFromReq(req)) });
        return res.end();
    }

    // GET /api/auth/google/callback - finish Google sign-in
    if (url.pathname === '/api/auth/google/callback' && method === 'GET') {
        const code = url.searchParams.get('code') || '';
        const state = url.searchParams.get('state') || '';
        const base = googleStateConsume(state);
        if (!base) return sendJson(res, 400, { ok: false, error: 'Invalid or expired Google sign-in state. Try again.' });
        const redirectUri = (GOOGLE_REDIRECT || (base + '/api/auth/google/callback'));
        try {
            const tok = await googleTokenExchange(code, redirectUri);
            const me = await googleProfile(tok.access_token);
            const email = String(me.email || '').trim().toLowerCase();
            if (!email) return sendJson(res, 400, { ok: false, error: 'Google did not return an email address.' });
            const users = getUsers();
            let user = users.find(u => u.email === email);
            if (!user) {
                const { salt, hash } = hashPassword(crypto.randomBytes(32).toString('hex'));
                user = { id: uid(), name: String(me.name || email.split('@')[0] || 'Google User'), email: email, salt: salt, hash: hash, createdAt: Date.now(), verified: 1 };
                users.push(user);
                saveUsers(users);
            } else if (Number(user.verified || 0) !== 1) {
                user.verified = 1;
                user.verifyToken = undefined;
                user.verifyExpires = undefined;
                saveUsers(users);
            }
            req.__sessionEmail = email;
            newSession(req, res);
            audit.append(email, 'login-google', {});
            res.writeHead(302, { Location: base + '/home/' });
            return res.end();
        } catch (e) {
            console.error('[google] callback error:', e && e.stack || e);
            return sendJson(res, 502, { ok: false, error: 'Google sign-in failed. Please try again.' });
        }
    }

    // GET /api/auth/github - start GitHub sign-in
    if (url.pathname === '/api/auth/github' && method === 'GET') {
        if (!GITHUB_AUTH_ENABLED) {
            return sendJson(res, 503, { ok: false, error: 'Sign in with GitHub is not configured yet.' });
        }
        res.writeHead(302, { Location: githubAuthUrl(baseFromReq(req)) });
        return res.end();
    }

    // GET /api/auth/github/callback - finish GitHub sign-in
    if (url.pathname === '/api/auth/github/callback' && method === 'GET') {
        const code = url.searchParams.get('code') || '';
        const state = url.searchParams.get('state') || '';
        const base = githubStateConsume(state);
        if (!base) return sendJson(res, 400, { ok: false, error: 'Invalid or expired GitHub sign-in state. Try again.' });
        const redirectUri = (GITHUB_REDIRECT || (base + '/api/auth/github/callback'));
        try {
            const token = await githubTokenExchange(code, redirectUri);
            const me = await githubProfile(token);
            const email = String(me.email || '').trim().toLowerCase();
            if (!email) return sendJson(res, 400, { ok: false, error: 'GitHub did not return a verified email address.' });
            const users = getUsers();
            let user = users.find(u => u.email === email);
            if (!user) {
                const { salt, hash } = hashPassword(crypto.randomBytes(32).toString('hex'));
                user = { id: uid(), name: String(me.name || email.split('@')[0] || 'GitHub User'), email: email, salt: salt, hash: hash, createdAt: Date.now(), verified: 1 };
                users.push(user);
                saveUsers(users);
                audit.append(email, 'signup-github', { name: user.name });
            } else if (Number(user.verified || 0) !== 1) {
                user.verified = 1;
                user.verifyToken = undefined;
                user.verifyExpires = undefined;
                saveUsers(users);
            }
            req.__sessionEmail = email;
            newSession(req, res);
            audit.append(email, 'login-github', {});
            res.writeHead(302, { Location: base + '/home/' });
            return res.end();
        } catch (e) {
            console.error('[github] callback error:', e && e.stack || e);
            return sendJson(res, 502, { ok: false, error: 'GitHub sign-in failed. Please try again.' });
        }
    }

    // GET /api/auth/providers - which sign-in providers are configured
    if (url.pathname === '/api/auth/providers' && method === 'GET') {
        return sendJson(res, 200, { ok: true, google: GOOGLE_AUTH_ENABLED, github: GITHUB_AUTH_ENABLED });
    }

    // GET /api/documents - the current user's recent documents
    if (url.pathname === '/api/documents' && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const list = getDocuments().filter(d => {
            if (d.user && d.user.email === user.email) return true;
            return Array.isArray(d.members) && d.members.some(m => m && m.email === user.email);
        });
        return sendJson(res, 200, { ok: true, documents: list });
    }

    // GET /api/search?q=... - search document titles AND file contents
    if (url.pathname === '/api/search' && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
        if (!q) return sendJson(res, 200, { ok: true, results: [] });

        const mine = getDocuments().filter(d => {
            if (d.user && d.user.email === user.email) return true;
            return Array.isArray(d.members) && d.members.some(m => m && m.email === user.email);
        });

        const results = [];
        for (const d of mine) {
            const titleHit = d.title && d.title.toLowerCase().includes(q);
            let snippet = '';
            let matchedIn = 'title';
            if (!titleHit) {
                try {
                    const fp = getFileForDocument(d);
                    if (fp) {
                        const raw = fs.readFileSync(fp, 'utf8');
                        const lower = raw.toLowerCase();
                        const idx = lower.indexOf(q);
                        if (idx >= 0) {
                            matchedIn = 'content';
                            snippet = raw.slice(Math.max(0, idx - 40), Math.min(raw.length, idx + q.length + 60)).replace(/\n/g, ' ').trim();
                        }
                    }
                } catch (e) { /* skip unreadable */ }
                if (matchedIn !== 'content') continue;
            }
            results.push({
                documentId: d.documentId,
                title: d.title,
                format: d.format,
                status: d.status,
                matchedIn: matchedIn,
                snippet: snippet
            });
            if (results.length >= 30) break;
        }
        return sendJson(res, 200, { ok: true, results: results });
    }

    // POST /api/documents/preview - analyse an uploaded file's headings (no storage)
    if (url.pathname === '/api/documents/preview' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const body = await safeBody(req);
        const fileName = String(body.fileName || '');
        let data = String(body.fileData || '');
        if (/^data:[^;]+;base64,/.test(data)) data = data.slice(data.indexOf(',') + 1);
        const parsed = parseTabularHeaders(Buffer.from(data, 'base64'), fileName);
        return sendJson(res, 200, {
            ok: true,
            fileName: fileName,
            headers: parsed.headers,
            sample: parsed.sample,
            totalRows: parsed.totalRows,
            formattable: parsed.formattable,
            ext: path.extname(fileName).toLowerCase()
        });
    }

    // POST /api/documents - save a new document
    if (url.pathname === '/api/documents' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const body = await safeBody(req);
        const title = String(body.title || '').trim();
        const format = String(body.format || 'Other').trim();
        const type = String(body.type || 'other').toLowerCase();
        const fileName = String(body.fileName || '').trim();
        const members = Array.isArray(body.members) ? body.members : [];
        const fields = Array.isArray(body.fields) ? body.fields : [];
        const status = String(body.status || 'active');
        const category = String(body.category || format);
        const importMode = String(body.importMode || 'data').toLowerCase();

        if (!title) return sendJson(res, 400, { ok: false, error: 'Title is required.' });

        const documentId = uid();

        let storedFile = null;
        if (body.fileData) {
            try {
                storedFile = saveFileData(documentId, body.fileData, fileName);
            } catch (e) {
                return sendJson(res, 400, { ok: false, error: 'Could not store the uploaded file.' });
            }
        }

        const doc = {
            documentId: documentId,
            title: title,
            type: type,
            category: category,
            format: format,
            fileName: fileName,
            hasFile: !!storedFile,
            storedFile: storedFile,
            members: members,
            fields: fields,
            date: new Date().toISOString(),
            status: status,
            user: {
                name: user.name,
                avatar: initials(user.name),
                email: user.email
            }
        };

        // "With format" mode: strip the data rows and keep only the column
        // headings (+ one empty template row) so members fill their own data.
        if (importMode === 'format') {
            const filePath = getFileForDocument(doc);
            if (filePath) {
                const colFields = fields.filter(f => f && f.col).map(f => String(f.name == null ? '' : f.name).trim()).filter(Boolean);
                let headers = colFields;
                if (!headers.length) {
                    // Fall back to headings the user typed by hand in the Fields
                    // step (skipping metadata rows and "Row N" placeholders).
                    const seen = new Set();
                    const manual = fields
                        .map(f => String(f.name == null ? '' : f.name).trim())
                        .filter(n => n && !['File Name', 'Format', 'File Size', 'Total Rows'].includes(n) && !/^Row \d+$/i.test(n))
                        .filter(n => (seen.has(n) ? false : (seen.add(n), true)));
                    const manExt = path.extname(doc.storedFile || fileName).toLowerCase();
                    if (manual.length >= (manExt === '.txt' ? 2 : 1)) headers = manual;
                }
                if (!headers.length) headers = parseTabularHeaders(fs.readFileSync(filePath), doc.storedFile || fileName).headers;
                const ext = path.extname(doc.storedFile || fileName).toLowerCase();
                if (buildFormatOnlyFile(filePath, ext, headers)) {
                    doc.importMode = 'format';
                } else {
                    doc.importMode = 'data';
                }
            } else {
                doc.importMode = 'data';
            }
        } else {
            doc.importMode = 'data';
        }

        const list = getDocuments();
        list.unshift(doc);
        saveDocuments(list);

        return sendJson(res, 201, { ok: true, document: doc });
    }

    // PUT /api/documents/:id - update a document's fields
    const updMatch = /^\/api\/documents\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (updMatch && method === 'PUT') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const docId = updMatch[1];
        const list = getDocuments();
        const doc = list.find(d => d.documentId === docId);
        if (!doc) return sendJson(res, 404, { ok: false, error: 'Document not found.' });

        const body = await safeBody(req);

        if ('title' in body && String(body.title).trim()) doc.title = String(body.title).trim();
        if ('fileName' in body) doc.fileName = String(body.fileName || '').trim();
        if ('format' in body && String(body.format).trim()) {
            doc.format = String(body.format).trim();
            doc.category = doc.format;
        }
        if ('status' in body) doc.status = String(body.status || 'active');
        if (Array.isArray(body.members)) doc.members = body.members;
        doc.updatedAt = new Date().toISOString();

        saveDocuments(list);
        return sendJson(res, 200, { ok: true, document: doc });
    }

    // POST /api/documents/:id/duplicate - clone a document (owner only)
    const dupMatch = /^\/api\/documents\/([A-Za-z0-9]+)\/duplicate$/.exec(url.pathname);
    if (dupMatch && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const list = getDocuments();
        const src = list.find(d => d.documentId === dupMatch[1]);
        if (!src) return sendJson(res, 404, { ok: false, error: 'Document not found.' });
        if (src.user.email !== user.email) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });

        const newId = uid();
        let storedFile = null;
        const srcPath = getFileForDocument(src);
        if (srcPath) {
            const ext = path.extname(src.fileName || src.title || '.txt');
            storedFile = path.basename(newId) + ext;
            const target = path.join(FILES_DIR, storedFile);
            if (!target.startsWith(FILES_DIR)) return sendJson(res, 500, { ok: false, error: 'Duplicate failed.' });
            fs.copyFileSync(srcPath, target);
        }

        const clone = {
            documentId: newId,
            title: String(src.title || 'Document') + ' (Copy)',
            type: src.type || 'csv',
            category: src.category || src.format || 'CSV',
            format: src.format || 'CSV',
            fileName: src.fileName || '',
            hasFile: !!storedFile,
            storedFile: storedFile,
            members: Array.isArray(src.members) ? src.members.slice() : [],
            fields: Array.isArray(src.fields) ? JSON.parse(JSON.stringify(src.fields)) : [],
            date: new Date().toISOString(),
            status: src.status || 'active',
            user: { name: user.name, avatar: initials(user.name), email: user.email }
        };

        list.push(clone);
        saveDocuments(list);
        return sendJson(res, 201, { ok: true, document: clone });
    }

    // GET /api/documents/:id/export/period - calendar / date-based export
    const periodMatch = /^\/api\/documents\/([A-Za-z0-9]+)\/export\/period$/.exec(url.pathname);
    if (periodMatch && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const doc = getDocuments().find(d => d.documentId === periodMatch[1]);
        if (!doc) return sendJson(res, 404, { ok: false, error: 'Document not found.' });
        if (!canAccessDocument(doc, user)) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });

        const q = url.searchParams;
        const mode = String(q.get('mode') || 'range');
        const format = String(q.get('format') || 'xlsx').toLowerCase();
        const scope = String(q.get('scope') || 'both').toLowerCase();
        if (!['xlsx', 'docx', 'txt', 'pdf', 'json'].includes(format)) return sendJson(res, 400, { ok: false, error: 'format must be xlsx, docx, txt, pdf or json.' });
        if (!['changes', 'rows', 'both'].includes(scope)) return sendJson(res, 400, { ok: false, error: 'scope must be changes, rows or both.' });

        let range = null;
        if (mode === 'month') range = toMonthRange(q.get('month'));
        else if (mode === 'year') range = toYearRange(q.get('year'));
        else if (mode === 'day') range = toDayRange(q.get('day'));
        else {
            const from = q.get('from');
            const to = q.get('to');
            const f = from ? parseDateValue(from) : null;
            const t = to ? parseDateValue(to) : null;
            if (from && !f) return sendJson(res, 400, { ok: false, error: 'Invalid from date.' });
            if (to && !t) return sendJson(res, 400, { ok: false, error: 'Invalid to date.' });
            range = { from: f || new Date(1970, 0, 1), to: t || new Date(2100, 11, 31, 23, 59, 59) };
        }
        if (!range) return sendJson(res, 400, { ok: false, error: 'Invalid period.' });

        function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
        function endOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
        const fromD = startOfDay(range.from);
        const toD = endOfDay(range.to);

        const wantChanges = scope === 'changes' || scope === 'both';
        const wantRows = scope === 'rows' || scope === 'both';

        // --- Change report data ---
        const history = wantChanges ? readHistory(doc.documentId).filter(e => {
            const t = new Date(e.ts);
            if (!(t >= fromD && t <= toD)) return false;
            if (String(e.summary || '') === 'Saved (no visible change)') return false;
            return true;
        }) : [];

        // --- Rows by DATE column data ---
        let filteredRows = null;
        if (wantRows) {
            const filePath = getFileForDocument(doc);
            if (filePath && XLSX && ['.xlsx', '.xls', '.csv'].includes(path.extname(filePath).toLowerCase())) {
                const raw = fs.readFileSync(filePath);
                const readOpts = path.extname(filePath).toLowerCase() === '.csv'
                    ? { type: 'buffer', raw: true }
                    : { type: 'buffer', cellDates: true };
                const wb = XLSX.read(raw, readOpts);
                const ws = wb.Sheets[(wb.SheetNames || [])[0]];
                if (ws) {
                    const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                    const header = all[0] || [];
                    let dateCols = getDateColumnIndices(header);
                    let dateDetected = dateCols.length ? 'header' : 'none';
                    if (!dateCols.length) {
                        dateCols = detectDateColumnsByContent(all);
                        if (dateCols.length) dateDetected = 'content';
                    }
                    filteredRows = [header];
                    for (let i = 1; i < all.length; i++) {
                        const row = all[i];
                        const inRange = dateCols.some(c => {
                            const d = parseDateValue(row[c]);
                            return d && d >= fromD && d <= toD;
                        });
                        if (inRange) filteredRows.push(row);
                    }
                    filteredRows._dateCols = dateCols;
                    filteredRows._dateDetected = dateDetected;
                    filteredRows._totalRows = all.length - 1;
                }
            }
        }

        const base = String(doc.title || 'document').replace(/[^a-z0-9_-]+/gi, '_') || 'document';
        const periodName = mode === 'month' ? q.get('month') : mode === 'year' ? q.get('year') : mode === 'day' ? q.get('day') : (q.get('from') || 'start') + '_to_' + (q.get('to') || 'end');
        const plain = (v) => String(v == null ? '' : v);

        if (format === 'txt') {
            const lines = [];
            if (wantChanges) {
                lines.push('CHANGE REPORT - ' + base);
                lines.push('Period: ' + fromD.toLocaleDateString('en-GB') + ' to ' + toD.toLocaleDateString('en-GB'));
                lines.push('--------------------------------------------');
                if (!history.length) lines.push('No changes in this period.');
                history.forEach((e, i) => {
                    const t = new Date(e.ts);
                    lines.push((i + 1) + '. ' + t.toLocaleString('en-GB') + '  |  ' + (e.user || '?') + '  |  ' + (e.summary || e.action));
                });
            }
            if (wantRows) {
                if (wantChanges && lines.length) lines.push('');
                lines.push('ROWS BY DATE - ' + base);
                lines.push('Period: ' + fromD.toLocaleDateString('en-GB') + ' to ' + toD.toLocaleDateString('en-GB'));
                lines.push('--------------------------------------------');
                if (!filteredRows) lines.push('This file has no date column; no rows exported.');
                else if (filteredRows.length === 1) lines.push('No rows fall inside this period.');
                else filteredRows.forEach(r => lines.push((r || []).map(formatCell).map(csvSafeExport).map(csvEscape).join('\t')));
            }
            const buf = Buffer.from(lines.join('\r\n'), 'utf8');
            res.writeHead(200, {
                'Content-Type': 'text/plain; charset=utf-8',
                'Content-Disposition': 'attachment; filename="' + base + '_' + periodName + '.txt"',
                'Content-Length': buf.length
            });
            return res.end(buf);
        }

        if (format === 'xlsx' && XLSX) {
            let wb = XLSX.utils.book_new();
            if (wantChanges) {
                const rows = [
                    ['#', 'Date & Time', 'Changed By', 'Action', 'Details']
                ];
                history.forEach((e, i) => {
                    rows.push([i + 1, new Date(e.ts).toLocaleString('en-GB'), e.user || '', (e.action || '').toUpperCase(), e.summary || '']);
                });
                if (!history.length) rows.push([1, '', '', '', 'No changes in this period.']);
                let ws = XLSX.utils.aoa_to_sheet(rows);
                if (ws['!cols']) delete ws['!cols'];
                ws['!cols'] = [{ wch: 6 }, { wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 50 }];
                XLSX.utils.book_append_sheet(wb, ws, 'Change Report');
            }
            if (wantRows) {
                let ws = XLSX.utils.aoa_to_sheet(filteredRows || [['This file has no date column; no rows exported.']]);
                ws = convertDatesToCells(ws) || ws;
                XLSX.utils.book_append_sheet(wb, ws, 'Rows by Date');
            }
            const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
            res.writeHead(200, {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': 'attachment; filename="' + base + '_' + periodName + '.xlsx"',
                'Content-Length': buf.length
            });
            return res.end(buf);
        }

        if (format === 'docx' && DOCX) {
            const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType } = DOCX;

            let doc = null;
            const children = [];
            const re = (text) => new Paragraph({ children: [new TextRun({ text: text || '', size: 22 })], spacing: { after: 100 } });
            const cell = (text, bold) => new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: String(text == null ? '' : text), bold: !!bold, size: 20 })], spacing: { after: 0 } })]
            });
            const rowFrom = (values, bold) => new TableRow({ tableHeader: bold || undefined, children: values.map(v => cell(v, bold)) });

            if (wantChanges) {
                children.push(new Paragraph({ text: 'CHANGE REPORT - ' + base, heading: HeadingLevel.HEADING_1 }));
                children.push(re('Period: ' + fromD.toLocaleDateString('en-GB') + ' to ' + toD.toLocaleDateString('en-GB')));
                if (!history.length) {
                    children.push(re('No changes in this period.'));
                } else {
                    const tRows = [rowFrom(['#', 'Date & Time', 'Changed By', 'Action', 'Details'], true)];
                    history.forEach((e, i) => {
                        tRows.push(rowFrom([i + 1, new Date(e.ts).toLocaleString('en-GB'), e.user || '', (e.action || '').toUpperCase(), e.summary || '']));
                    });
                    children.push(new Table({ rows: tRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
                }
            }

            if (wantRows) {
                if (wantChanges) children.push(new Paragraph({ text: '', spacing: { before: 200 } }));
                children.push(new Paragraph({ text: 'ROWS BY DATE - ' + base, heading: HeadingLevel.HEADING_1 }));
                children.push(re('Period: ' + fromD.toLocaleDateString('en-GB') + ' to ' + toD.toLocaleDateString('en-GB')));
                if (!filteredRows) {
                    children.push(re('This file has no date column; no rows exported.'));
                } else if (filteredRows.length === 1) {
                    children.push(re('No rows fall inside this period.'));
                } else {
                    const tRows = filteredRows.map((r, i) => rowFrom((r || []).map(formatCell), i === 0));
                    children.push(new Table({ rows: tRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
                }
            }

            doc = new Document({ sections: [{ children: children }] });
            return Packer.toBuffer(doc).then(buf => {
                res.writeHead(200, {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'Content-Disposition': 'attachment; filename="' + base + '_' + periodName + '.docx"',
                    'Content-Length': buf.length
                });
                res.end(buf);
            });
        }

        // JSON: structured preview data used by the in-app calendar preview
        if (format === 'json') {
            const preview = {
                ok: true,
                document: doc.title || '',
                period: { from: fromD.toISOString(), to: toD.toISOString() },
                changeReport: wantChanges ? history.map(e => ({
                    ts: e.ts,
                    user: e.user || '',
                    action: e.action || '',
                    summary: e.summary || ''
                })) : null,
                rows: wantRows ? {
                    dateColumns: (filteredRows && filteredRows._dateCols) || [],
                    dateDetected: (filteredRows && filteredRows._dateDetected) || 'none',
                    totalRows: (filteredRows && filteredRows._totalRows) || 0,
                    matchedRows: filteredRows ? Math.max(0, filteredRows.length - 1) : 0,
                    hasDateColumn: !!filteredRows,
                    rows: filteredRows || []
                } : null
            };
            return sendJson(res, 200, preview);
        }

        // PDF: dependency-free A4 report
        if (format === 'pdf') {
            const sections = [];
            if (wantChanges) {
                const sec = {
                    title: 'CHANGE REPORT - ' + base,
                    meta: ['Period: ' + fromD.toLocaleDateString('en-GB') + ' to ' + toD.toLocaleDateString('en-GB')]
                };
                if (!history.length) sec.message = 'No changes in this period.';
                else {
                    sec.headers = ['#', 'Date & Time', 'Changed By', 'Action', 'Details'];
                    sec.rows = history.map((e, i) => [i + 1, new Date(e.ts).toLocaleString('en-GB'), e.user || '', (e.action || '').toUpperCase(), e.summary || '']);
                }
                sections.push(sec);
            }
            if (wantRows && sections.length) sections.push({ title: '', meta: [], gap: 0 });
            if (wantRows) {
                const sec = {
                    title: 'ROWS BY DATE - ' + base,
                    meta: ['Period: ' + fromD.toLocaleDateString('en-GB') + ' to ' + toD.toLocaleDateString('en-GB')]
                };
                if (!filteredRows) sec.message = 'This file has no date column; no rows exported.';
                else if (filteredRows.length === 1) sec.message = 'No rows fall inside this period.';
                else { sec.rows = filteredRows.map((r) => (Array.isArray(r) ? r.map(formatCell) : [])); }
                sections.push(sec);
            }
            const buf = makeSimplePdf(sections);
            res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="' + base + '_' + periodName + '.pdf"',
                'Content-Length': buf.length
            });
            return res.end(buf);
        }

        return sendJson(res, 400, { ok: false, error: 'Export not available (missing library or bad format).' });
    }

    // GET /api/documents/:id/export - export a document's details as CSV
    const expMatch = /^\/api\/documents\/([A-Za-z0-9]+)\/export$/.exec(url.pathname);
    if (expMatch && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const doc = getDocuments().find(d => d.documentId === expMatch[1]);
        if (!doc) return sendJson(res, 404, { ok: false, error: 'Document not found.' });
        if (!canAccessDocument(doc, user)) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });

        function csvCell(value) {
            const s = String(value == null ? '' : value);
            const safe = /^[=+\-@\t]/.test(s.trimStart()) ? "'" + s : s;
            return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
        }
        function csvRow(values) {
            return values.map(csvCell).join(',');
        }

        const lines = [
            csvRow(['Metadata', 'Value']),
            csvRow(['Document Name', doc.title]),
            csvRow(['ID Number', doc.documentId]),
            csvRow(['Format', doc.format || 'Other']),
            csvRow(['File Name', doc.fileName || '']),
            csvRow(['Status', doc.status || 'active']),
            csvRow(['Created By', doc.user.name]),
            csvRow(['Created', doc.date]),
            csvRow(['Updated', doc.updatedAt || '']),
            '',
            csvRow(['Field Name', 'Field Value'])
        ];
        (doc.fields || []).forEach(f => lines.push(csvRow([f.name, f.value])));
        const csv = '\uFEFF' + lines.join('\r\n');

        const safeName = String(doc.title).replace(/[^a-z0-9_-]+/gi, '_') || 'document';
        res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="' + safeName + '.csv"',
            'X-Content-Type-Options': 'nosniff'
        });
        return res.end(csv, 'utf8');
    }

    // DELETE /api/documents/:id - remove a document (owner only)
    const delMatch = /^\/api\/documents\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (delMatch && method === 'DELETE') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const docId = delMatch[1];
        const list = getDocuments();
        const doc = list.find(d => d.documentId === docId);
        if (!doc) return sendJson(res, 404, { ok: false, error: 'Document not found.' });
        if (doc.user.email !== user.email) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });

        saveDocuments(list.filter(d => d.documentId !== docId));
        try { const fp = getFileForDocument(doc); if (fp) fs.unlinkSync(fp); } catch (e) { /* ignore */ }
        try { if (fs.existsSync(historyFile(docId))) fs.unlinkSync(historyFile(docId)); } catch (e) { /* ignore */ }
        return sendJson(res, 200, { ok: true });
    }

    // GET /api/users - people who can be added as members
    if (url.pathname === '/api/users' && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });
        const list = getUsers().map(u => ({
            name: u.name,
            email: u.email,
            initials: initials(u.name)
        }));
        return sendJson(res, 200, { ok: true, users: list });
    }

    // ---------- Rooms ----------

    // GET /api/rooms
    if (url.pathname === '/api/rooms' && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });
        const list = getRooms().filter(r => r.members.some(m => m.email === user.email) || r.creator.email === user.email);
        return sendJson(res, 200, { ok: true, rooms: list });
    }

    // POST /api/rooms - create a room
    if (url.pathname === '/api/rooms' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const body = await safeBody(req);
        const name = String(body.name || '').trim();
        const type = String(body.type || 'team').toLowerCase();

        if (!name) return sendJson(res, 400, { ok: false, error: 'Room name is required.' });

        const room = {
            roomId: uid(),
            name: name,
            type: type,
            status: 'active',
            createdAt: Date.now(),
            creator: { name: user.name, email: user.email, initials: initials(user.name) },
            members: [{ name: user.name, email: user.email, initials: initials(user.name) }]
        };

        const list = getRooms();
        list.unshift(room);
        saveRooms(list);

        return sendJson(res, 201, { ok: true, room: room });
    }

    // PUT /api/documents/:id/source - connect a real device file path to this document
    const srcMatch = /^\/api\/documents\/([A-Za-z0-9]+)\/source$/.exec(url.pathname);
    if (srcMatch && method === 'PUT') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const docId = srcMatch[1];
        const list = getDocuments();
        const doc = list.find(d => d.documentId === docId);
        if (!doc) return sendJson(res, 404, { ok: false, error: 'Document not found.' });
        if (doc.user.email !== user.email) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });

        const body = await safeBody(req);
        const p = String(body.path || '').trim();
        if (!p) {
            doc.connectedPath = null;
            doc.updatedAt = new Date().toISOString();
            saveDocuments(list);
            return sendJson(res, 200, { ok: true, connectedPath: null });
        }

        try {
            const abs = path.resolve(p);
            if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
                return sendJson(res, 400, { ok: false, error: 'That path is not a file on this device, or it does not exist.' });
            }
            doc.connectedPath = abs;
            doc.deviceMtimeMs = fs.statSync(abs).mtimeMs;
            doc.updatedAt = new Date().toISOString();
            saveDocuments(list);
            return sendJson(res, 200, { ok: true, connectedPath: abs });
        } catch (e) {
            return sendJson(res, 400, { ok: false, error: 'Could not access that path: ' + e.message });
        }
    }

    // GET /api/documents/:id/source/status - poll the connected device file for changes
    const srcStatusMatch = /^\/api\/documents\/([A-Za-z0-9]+)\/source\/status$/.exec(url.pathname);
    if (srcStatusMatch && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });
        const doc = getDocuments().find(d => d.documentId === srcStatusMatch[1]);
        if (!doc) return sendJson(res, 404, { ok: false, error: 'Document not found.' });
        if (!canAccessDocument(doc, user)) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });
        if (!doc.connectedPath) return sendJson(res, 200, { ok: true, connectedPath: null });
        try {
            const st = fs.statSync(doc.connectedPath);
            return sendJson(res, 200, {
                ok: true,
                connectedPath: doc.connectedPath,
                exists: true,
                size: st.size,
                mtimeMs: st.mtimeMs,
                baselineMtime: doc.deviceMtimeMs || null,
                changedSince: doc.deviceMtimeMs ? st.mtimeMs !== doc.deviceMtimeMs : false
            });
        } catch (e) {
            return sendJson(res, 200, { ok: true, connectedPath: doc.connectedPath, exists: false });
        }
    }

    // GET /api/backups - list automatic backups
    if (url.pathname === '/api/backups' && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });
        return sendJson(res, 200, { ok: true, backups: listAutoBackups(), lastBackupAt: lastBackupAt });
    }

    // POST /api/backups/run - trigger a backup now
    if (url.pathname === '/api/backups/run' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });
        const r = createAutoBackup();
        if (!r) return sendJson(res, 500, { ok: false, error: 'Backup failed.' });
        lastBackupAt = r.time;
        return sendJson(res, 201, { ok: true, backup: r });
    }

    // POST /api/reports/run - generate monthly summary reports now
    if (url.pathname === '/api/reports/run' && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });
        const created = runMonthlyReports();
        return sendJson(res, 201, { ok: true, files: created });
    }

    // POST /api/documents/:id/source/sync - pull the current disk file into the stored copy
    const srcSyncMatch = /^\/api\/documents\/([A-Za-z0-9]+)\/source\/sync$/.exec(url.pathname);
    if (srcSyncMatch && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });
        const list = getDocuments();
        const doc = list.find(d => d.documentId === srcSyncMatch[1]);
        if (!doc) return sendJson(res, 404, { ok: false, error: 'Document not found.' });
        if (doc.user.email !== user.email) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });
        if (!doc.connectedPath) return sendJson(res, 400, { ok: false, error: 'No device file is connected.' });
        try {
            if (!fs.existsSync(doc.connectedPath) || !fs.statSync(doc.connectedPath).isFile()) {
                return sendJson(res, 400, { ok: false, error: 'The connected file was moved or deleted.' });
            }
            const stored = getFileForDocument(doc);
            if (!stored) return sendJson(res, 400, { ok: false, error: 'No stored file for this document.' });
            const buf = fs.readFileSync(doc.connectedPath);
            fs.writeFileSync(stored, buf);
            doc.deviceMtimeMs = fs.statSync(doc.connectedPath).mtimeMs;
            doc.updatedAt = new Date().toISOString();
            recordHistory(doc.documentId, {
                id: uid(),
                ts: new Date().toISOString(),
                action: 'device-sync',
                summary: 'Synced from device file',
                user: user.name,
                snapshot: buf.toString('utf8').slice(0, 20000)
            });
            MON_SAVED++;
            saveDocuments(list);
            return sendJson(res, 200, { ok: true, message: 'Synced the device file into the document.' });
        } catch (e) {
            return sendJson(res, 500, { ok: false, error: 'Could not sync: ' + e.message });
        }
    }

    // PUT /api/documents/:id/content - persist edited contents back to the file
    const contentMatch = /^\/api\/documents\/([A-Za-z0-9]+)\/content$/.exec(url.pathname);
    if (contentMatch && method === 'PUT') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const doc = getDocuments().find(d => d.documentId === contentMatch[1]);
        if (!doc) return sendJson(res, 404, { ok: false, error: 'Document not found.' });
        if (!canAccessDocument(doc, user)) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });

        const filePath = getFileForDocument(doc);
        if (!filePath) return sendJson(res, 404, { ok: false, error: 'No file is stored for this document.' });

        let body = {};
        try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { /* leave empty */ }

        let connectedWarning = null, savedSummary = null;
        try {
            const r = writeContentToFile(filePath, doc, body);
            connectedWarning = r.connectedWarning;
            savedSummary = r.savedSummary;
        } catch (e) {
            if (e && e.message === 'Nothing to save.') return sendJson(res, 400, { ok: false, error: 'Nothing to save.' });
            return sendJson(res, 500, { ok: false, error: 'Could not write the file.' });
        }

        if (savedSummary !== 'Saved (no visible change)') {
            const snapshot = Array.isArray(body.rows) ? body.rows : (typeof body.text === 'string' ? body.text : null);
            MON_SAVED++;
            recordHistory(doc.documentId, {
                id: uid(),
                ts: new Date().toISOString(),
                action: Array.isArray(body.rows) ? 'rows' : 'text',
                summary: savedSummary || 'Saved',
                user: user.name,
                snapshot: snapshot
            });
            doc.updatedAt = new Date().toISOString();
            saveDocuments(getDocuments());
        }

        return sendJson(res, 200, { ok: true, connectedWarning: connectedWarning });
    }

    // GET /api/documents/:id/content - read the real data stored inside the file
    if (contentMatch && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const doc = getDocuments().find(d => d.documentId === contentMatch[1]);
        if (!doc) return sendJson(res, 404, { ok: false, error: 'Document not found.' });
        if (!canAccessDocument(doc, user)) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });

        const filePath = getFileForDocument(doc);
        if (!filePath) return sendJson(res, 200, { ok: true, hasFile: false, rows: [], text: '', sheetNames: [] });

        const ext = path.extname(doc.storedFile || '').toLowerCase();
        const raw = fs.readFileSync(filePath);
        const isText = ['.csv', '.txt'].includes(ext);
        const isSheet = ['.xlsx', '.xls', '.csv'].includes(ext);

        const MAX_ROWS = 200000;
        let rows = [];
        let text = '';
        let sheetNames = [];
        let truncated = false;
        let totalRows = 0;

        if (isText) {
            text = raw.toString('utf8');
        }

        if (isSheet && XLSX) {
            try {
                const readOpts = ext === '.csv' ? { type: 'buffer', raw: true } : { type: 'buffer', cellDates: true };
                const wb = XLSX.read(raw, readOpts);
                sheetNames = wb.SheetNames || [];
                const ws = wb.Sheets[sheetNames[0]];
                if (ws) {
                    const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                    totalRows = arr.length;
                    truncated = totalRows > MAX_ROWS;
                    rows = sheetRowsToDisplay(arr).slice(0, MAX_ROWS);
                }
            } catch (e) {
                return sendJson(res, 200, {
                    ok: true,
                    hasFile: true,
                    fileName: doc.fileName || '',
                    format: doc.format || 'Other',
                    rows: [],
                    text: text,
                    sheetNames: [],
                    totalRows: 0,
                    truncated: false,
                    parseError: 'Could not parse this file with the installed reader.'
                });
            }
        }

        return sendJson(res, 200, {
            ok: true,
            hasFile: true,
            fileName: doc.fileName || '',
            format: doc.format || 'Other',
            ext: ext,
            connectedPath: doc.connectedPath || null,
            rows: rows,
            text: text,
            sheetNames: sheetNames,
            totalRows: totalRows,
            truncated: truncated,
            parsed: isSheet
        });
    }

    // GET /api/documents/:id/history - list version history (without full snapshots)
    const historyListMatch = /^\/api\/documents\/([A-Za-z0-9]+)\/history$/.exec(url.pathname);
    if (historyListMatch && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const doc = getDocuments().find(d => d.documentId === historyListMatch[1]);
        if (!doc) return sendJson(res, 404, { ok: false, error: 'Document not found.' });
        if (!canAccessDocument(doc, user)) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });

        const entries = readHistory(doc.documentId)
            .map(e => ({
                id: e.id,
                ts: e.ts,
                action: e.action,
                summary: e.summary,
                user: e.user
            }))
            .slice(-200)
            .reverse();
        return sendJson(res, 200, { ok: true, history: entries });
    }

    // POST /api/documents/:id/history/restore - restore a previous snapshot
    const historyRestoreMatch = /^\/api\/documents\/([A-Za-z0-9]+)\/history\/restore$/.exec(url.pathname);
    if (historyRestoreMatch && method === 'POST') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const doc = getDocuments().find(d => d.documentId === historyRestoreMatch[1]);
        if (!doc) return sendJson(res, 404, { ok: false, error: 'Document not found.' });
        if (!canAccessDocument(doc, user)) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });

        let body = {};
        try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { /* leave empty */ }
        const ts = String(body.ts || '');
        if (!ts) return sendJson(res, 400, { ok: false, error: 'A version timestamp is required.' });

        const entry = readHistory(doc.documentId).find(e => e && String(e.ts) === ts);
        if (!entry) return sendJson(res, 404, { ok: false, error: 'That version was not found.' });
        if (entry.snapshot == null) return sendJson(res, 400, { ok: false, error: 'That version has no restorable content.' });

        const filePath = getFileForDocument(doc);
        if (!filePath) return sendJson(res, 404, { ok: false, error: 'No file is stored for this document.' });

        const payload = Array.isArray(entry.snapshot) ? { rows: entry.snapshot } : { text: entry.snapshot };
        let connectedWarning = null;
        try {
            connectedWarning = writeContentToFile(filePath, doc, payload).connectedWarning;
        } catch (e) {
            return sendJson(res, 500, { ok: false, error: 'Could not restore the file: ' + (e && e.message ? e.message : 'unknown error') });
        }

        recordHistory(doc.documentId, {
            id: uid(),
            ts: new Date().toISOString(),
            action: Array.isArray(entry.snapshot) ? 'rows' : 'text',
            summary: 'Restored version from ' + new Date(entry.ts).toLocaleString(),
            user: user.name,
            snapshot: entry.snapshot
        });

        return sendJson(res, 200, { ok: true, connectedWarning: connectedWarning });
    }

    // GET /api/documents/:id/file - download the original file
    const fileMatch = /^\/api\/documents\/([A-Za-z0-9]+)\/file$/.exec(url.pathname);
    if (fileMatch && method === 'GET') {
        const user = getSessionUser(req);
        if (!user) return sendJson(res, 401, { ok: false, error: 'Not signed in.' });

        const doc = getDocuments().find(d => d.documentId === fileMatch[1]);
        if (!doc) return sendJson(res, 404, { ok: false, error: 'Document not found.' });
        if (!canAccessDocument(doc, user)) return sendJson(res, 403, { ok: false, error: 'Forbidden.' });

        const filePath = getFileForDocument(doc);
        if (!filePath) return sendJson(res, 404, { ok: false, error: 'No file is stored for this document.' });

        const ext = path.extname(filePath).toLowerCase();
        const base = String(doc.title || 'document').replace(/[^a-z0-9_-]+/gi, '_') || 'document';
        const displayName = base + (ext || '');
        res.writeHead(200, {
            'Content-Type': FILES_MIME[ext] || 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="' + displayName + '"',
            'Content-Length': fs.statSync(filePath).size,
            'X-Content-Type-Options': 'nosniff'
        });
        return fs.createReadStream(filePath).pipe(res);
    }

    return sendJson(res, 404, { ok: false, error: 'Not found.' });
}

// ---------- Static file serving ----------
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon'
};

// Security headers applied to every response.
const RESP_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'self'"
};

const PUBLIC_DIRS = ['home', 'documents', 'fields', 'data fields', 'profile', 'login page', 'create account', 'shared'];

function serveStatic(res, url) {
    let clean = decodeURIComponent(url.pathname).replace(/\\/g, '/');
    if (clean === '/' || clean === '') clean = '/index.html';
    if (clean.endsWith('/')) clean += 'index.html';
    const segs = clean.split('/').filter(Boolean);

    // Only an explicit allow-list of root-level assets is served.
    if (segs.length === 1) {
        const ROOT_ASSETS = [
            'index.html',
            'bootstrap.js',
            'splash.js',
            'sw.js',
            'manifest.json',
            'icon-192.png',
            'icon-512.png',
            'release.json'
        ];
        if (ROOT_ASSETS.includes(segs[0])) return serveStaticFile(path.join(ROOT, segs[0]), res);
        return denyStatic(res);
    }

    const [dir, ...rest] = segs;
    if (!PUBLIC_DIRS.includes(dir)) return denyStatic(res);

    const fileName = rest[rest.length - 1];
    const ext = path.extname(fileName).toLowerCase();
    if (!MIME[ext]) return denyStatic(res);

    const filePath = path.join(ROOT, dir, ...rest);
    if (!filePath.startsWith(path.join(ROOT, dir))) return denyStatic(res);
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, RESP_HEADERS);
            return res.end('Not found');
        }
        res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] }, RESP_HEADERS));
        fs.createReadStream(filePath).pipe(res);
    });
}

function serveStaticFile(filePath, res) {
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, RESP_HEADERS);
            return res.end('Not found');
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream' }, RESP_HEADERS));
        fs.createReadStream(filePath).pipe(res);
    });
}

function denyStatic(res) {
    res.writeHead(404, RESP_HEADERS);
    return res.end('Not found');
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Public download page: shares the desktop installer and the Android APK.
function serveDownload(res) {
    const rel = readRelease();
    const d = rel.desktop || {};
    const a = rel.android || {};
    const btn = (href, label) => href
        ? '<a class="btn" href="' + escapeHtml(href) + '">' + escapeHtml(label) + '</a>'
        : '<span class="btn off">' + escapeHtml(label) + ' (not uploaded yet)</span>';
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Download VCPL</title><style>' +
        'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
        'font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#0b1020;' +
        'background:radial-gradient(1200px 600px at 20% 0%,#dbeafe,transparent),' +
        'radial-gradient(1000px 500px at 100% 100%,#fde68a,transparent),#eef2ff}' +
        '.card{width:min(560px,92vw);padding:34px 30px;border-radius:22px;background:rgba(255,255,255,.62);' +
        'backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.75);' +
        'box-shadow:0 24px 60px rgba(15,23,42,.18)}' +
        'h1{margin:0 0 4px;font-size:26px}.sub{margin:0 0 22px;color:#475569;font-size:14px}' +
        '.row{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 4px}' +
        '.btn{display:inline-block;padding:12px 18px;border-radius:14px;text-decoration:none;font-weight:600;' +
        'color:#fff;background:linear-gradient(135deg,#2563eb,#7c3aed);box-shadow:0 10px 24px rgba(37,99,235,.35)}' +
        '.btn.off{background:#cbd5e1;color:#475569;box-shadow:none}' +
        '.note{font-size:12px;color:#64748b;margin-top:10px}' +
        '</style></head><body><div class="card">' +
        '<h1>Download VCPL</h1><p class="sub">Version ' + escapeHtml(rel.version || APP_VERSION) + '</p>' +
        '<div><strong>Windows desktop</strong><div class="row">' +
        btn(d.setup, 'Download installer (.exe)') + btn(d.portable, 'Download portable (.exe)') + '</div></div>' +
        '<div style="margin-top:20px"><strong>Android</strong><div class="row">' +
        btn(a.apk, 'Download APK') + '</div><div class="note">Enable "Install unknown apps" for your browser to install.</div></div>' +
        '<p class="note">Builds are unsigned; Windows may show a SmartScreen prompt (choose More info &rarr; Run anyway).</p>' +
        '</div></body></html>';
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, RESP_HEADERS));
    return res.end(html);
}

// ---------- Server ----------
// Never let a single bad request take the whole prototype down.
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err && err.stack || err));

ensureDataDir();
// Make sure the history log directory exists (and is a directory, not a stray file).
if (fs.existsSync(files.history)) {
    if (!fs.statSync(files.history).isDirectory()) { fs.unlinkSync(files.history); }
}
if (!fs.existsSync(files.history)) fs.mkdirSync(files.history, { recursive: true });

// ---------- Lightweight monitoring ----------
let MON_REQ = 0, MON_SAVED = 0, MON_WS = 0;
const MON_STARTED = Date.now();

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
        handleApi(req, res, url);
    } else if (url.pathname === '/download' || url.pathname === '/download/') {
        serveDownload(res);
    } else {
        serveStatic(res, url);
    }
});

// ---------- Real-time collaboration (WebSocket, free 'ws' package) ----------
let WS_SRV = null;
try {
    const { WebSocketServer } = require('ws');
    WS_SRV = new WebSocketServer({ noServer: true });

    // docId -> Set of websockets editing that document
    const rooms = new Map();

    function roomOf(ws) { return ws.__docId; }

    function joinRoom(ws, docId) {
        ws.__docId = docId;
        let room = rooms.get(docId);
        if (!room) { room = new Set(); rooms.set(docId, room); }
        room.add(ws);
        broadcastPresence(docId);
    }

    function leaveRoom(ws, docId) {
        const room = rooms.get(docId);
        if (room) {
            room.delete(ws);
            if (room.size === 0) rooms.delete(docId);
            else broadcastPresence(docId);
        }
    }

    function broadcast(docId, message, exceptWs) {
        const room = rooms.get(docId);
        if (!room) return;
        const text = JSON.stringify(message);
        for (const ws of room) {
            if (ws !== exceptWs && ws.readyState === 1) {
                try { ws.send(text); } catch (e) { /* ignore */ }
            }
        }
    }

    function broadcastPresence(docId) {
        const room = rooms.get(docId);
        const users = room ? Array.from(room).map(ws => ({ name: ws.__userName, email: ws.__userEmail })) : [];
        const msg = { t: 'presence', users: users };
        const text = JSON.stringify(msg);
        for (const ws of (room || [])) {
            if (ws.readyState === 1) {
                try { ws.send(text); } catch (e) { /* ignore */ }
            }
        }
    }

    server.on('upgrade', (req, socket, head) => {
        let url;
        try { url = new URL(req.url, 'http://localhost'); } catch (e) { socket.destroy(); return; }
        if (url.pathname !== '/ws' && url.pathname !== '/ws/') {
            socket.destroy();
            return;
        }

        const docId = (url.searchParams.get('doc') || '').trim();
        if (!docId) { socket.destroy(); return; }

        const user = getSessionUser(req);
        if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }

        const doc = getDocuments().find(d => d.documentId === docId);
        if (!doc) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
        const isMember = (doc.user && doc.user.email === user.email) ||
            (Array.isArray(doc.members) && doc.members.some(m => m.email === user.email));
        if (!isMember) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }

        WS_SRV.handleUpgrade(req, socket, head, (ws) => {
            ws.__userName = user.name || user.email;
            ws.__userEmail = user.email;
            WS_SRV.emit('connection', ws, req);
            joinRoom(ws, docId);

            ws.on('message', (data) => {
                let msg = null;
                try { msg = JSON.parse(String(data)); } catch (e) { return; }
                if (msg && msg.t === 'op' && msg.op && roomOf(ws) === docId) {
                    broadcast(docId, {
                        t: 'op',
                        op: msg.op,
                        from: { name: ws.__userName, email: ws.__userEmail }
                    }, ws);
                } else if (msg && msg.t === 'get-presence') {
                    broadcastPresence(docId);
                }
            });

            MON_WS++;
            ws.on('close', () => { MON_WS = Math.max(0, MON_WS - 1); leaveRoom(ws, docId); });
            ws.on('error', () => { try { ws.close(); } catch (e) { /* ignore */ } });
        });
    });
} catch (e) {
    console.error('WebSocket collaboration disabled:', e.message);
}

// ---------- Automation: auto-backup + scheduled monthly summary reports ----------
const AUTO_BACKUP_DIR = path.join(path.dirname(path.resolve(DATA_DIR)), 'auto_backups');
const AUTO_REPORT_DIR = path.join(path.dirname(path.resolve(DATA_DIR)), 'auto_reports');
const BACKUP_KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP || '10', 10));
const BACKUP_INTERVAL_MIN = Math.max(1, parseInt(process.env.BACKUP_INTERVAL_MIN || '60', 10));
const REPORT_DAY = parseInt(process.env.REPORT_DAY || '1', 10);
const REPORT_HOUR = parseInt(process.env.REPORT_HOUR || '9', 10);

function dirSize(p) {
    let total = 0;
    if (!fs.existsSync(p)) return 0;
    try {
        for (const f of fs.readdirSync(p, { withFileTypes: true })) {
            const fp = path.join(p, f.name);
            if (f.isDirectory()) total += dirSize(fp);
            else total += fs.statSync(fp).size;
        }
    } catch (e) { /* ignore */ }
    return total;
}

function createAutoBackup() {
    try {
        if (!fs.existsSync(DATA_DIR)) return null;
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const name = 'backup-' + ts;
        const dest = path.join(AUTO_BACKUP_DIR, name);
        fs.mkdirSync(AUTO_BACKUP_DIR, { recursive: true });
        fs.cpSync(DATA_DIR, dest, { recursive: true });
        let entries = [];
        try {
            entries = fs.readdirSync(AUTO_BACKUP_DIR)
                .map(n => path.join(AUTO_BACKUP_DIR, n))
                .filter(p => fs.statSync(p).isDirectory())
                .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        } catch (e) { /* ignore */ }
        for (const p of entries.slice(BACKUP_KEEP)) {
            try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        }
        return { name: name, time: new Date().toISOString() };
    } catch (e) {
        return null;
    }
}

function listAutoBackups() {
    try {
        if (!fs.existsSync(AUTO_BACKUP_DIR)) return [];
        return fs.readdirSync(AUTO_BACKUP_DIR)
            .map(n => path.join(AUTO_BACKUP_DIR, n))
            .filter(p => fs.statSync(p).isDirectory())
            .map(p => ({ name: path.basename(p), size: dirSize(p), time: fs.statSync(p).mtime.toISOString() }))
            .sort((a, b) => b.time.localeCompare(a.time));
    } catch (e) {
        return [];
    }
}

function generateReportForDoc(doc) {
    const month = new Date().toISOString().slice(0, 7);
    const dir = path.join(AUTO_REPORT_DIR, month);
    fs.mkdirSync(dir, { recursive: true });
    const safeTitle = (doc.title || 'document').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60) || 'document';
    const fp = path.join(dir, safeTitle + '.txt');
    const lines = [
        'Victory CeraTech - Monthly Summary Report',
        'Generated: ' + new Date().toISOString(),
        'Document: ' + (doc.title || '(untitled)'),
        'ID: ' + doc.documentId,
        'Format: ' + (doc.format || 'Other'),
        'Status: ' + (doc.status || 'active'),
        'Created: ' + (doc.date || ''),
        'Last edited: ' + (doc.updatedAt || doc.date || ''),
        'Members: ' + (Array.isArray(doc.members) ? doc.members.map(m => m && m.name).filter(Boolean).join(', ') : ''),
        '---'
    ];
    fs.writeFileSync(fp, lines.join('\n') + '\n', 'utf8');
    return fp;
}

function runMonthlyReports() {
    const created = [];
    try {
        for (const d of getDocuments()) {
            try { created.push(generateReportForDoc(d)); } catch (e) { /* skip */ }
        }
    } catch (e) { /* ignore */ }
    return created;
}

let lastBackupAt = null;

function startAutomation() {
    const runBackup = () => {
        const r = createAutoBackup();
        if (r) lastBackupAt = r.time;
    };
    setInterval(runBackup, BACKUP_INTERVAL_MIN * 60 * 1000).unref();

    const checkMonthReport = () => {
        const now = new Date();
        if (now.getUTCDate() === REPORT_DAY && now.getUTCHours() === REPORT_HOUR) {
            const key = now.toISOString().slice(0, 7);
            if (checkMonthReport.lastMonths == null) checkMonthReport.lastMonths = {};
            if (!checkMonthReport.lastMonths[key]) {
                checkMonthReport.lastMonths[key] = true;
                runMonthlyReports();
            }
        }
    };
    setInterval(checkMonthReport, 60 * 60 * 1000).unref();
}

// Startup: remove orphaned stored files and history not referenced by any document.
function cleanupOrphans() {
    try {
        const active = new Set(getDocuments().map(d => d.documentId));
        const usedFiles = new Set(getDocuments().map(d => d.storedFile).filter(Boolean));
        if (fs.existsSync(FILES_DIR)) {
            for (const f of fs.readdirSync(FILES_DIR)) {
                if (!usedFiles.has(f)) {
                    try { fs.unlinkSync(path.join(FILES_DIR, f)); } catch (e) { /* ignore */ }
                }
            }
        }
        if (fs.existsSync(files.history)) {
            if (fs.statSync(files.history).isDirectory()) {
                for (const f of fs.readdirSync(files.history)) {
                    const id = path.basename(f, path.extname(f));
                    if (!active.has(id) || path.extname(f) !== '.json') {
                        try { fs.unlinkSync(path.join(files.history, f)); } catch (e) { /* ignore */ }
                    }
                }
            }
        }
    } catch (e) { /* cleanup is best-effort */ }
}

// Boot sequence: hydrate from the cloud store (if configured) before serving,
// then keep local files mirrored to Postgres so restarts never lose data.
(async () => {
    try {
        await cloudStore.initStore(DATA_DIR);
    } catch (e) {
        console.error('[store] cloud init failed, continuing with local files:', e && e.message);
    }
    audit.init(DATA_DIR);
    cloudStore.startSync(15000);

    server.listen(PORT, () => {
        cleanupOrphans();
        startAutomation();
        console.log(`VCPL hub running at http://localhost:${PORT}`);
        console.log(`Data is saved in: ${DATA_DIR}`);
        console.log(`Cloud persistence: ${cloudStore.isEnabled() ? 'on (Postgres)' : 'off (local files)'}`);
    });
})();