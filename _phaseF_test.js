// Phase F real-time collaboration test. Run via _runner.js with TEST_PORT + DATA_DIR env.
const base = 'http://127.0.0.1:' + (process.env.TEST_PORT || '3001');
const wsUrlBase = 'ws://127.0.0.1:' + (process.env.TEST_PORT || '3001');
const WebSocket = require('ws');

let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (extra ? ' -> ' + extra : '')); } }

async function api(method, p, body, cookie) {
    const r = await fetch(base + p, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, json, cookie: r.headers.get('set-cookie') || cookie || '' };
}

function wsOpen(path, cookie) {
    return new Promise((resolve) => {
        const ws = new WebSocket(wsUrlBase + path, { headers: cookie ? { Cookie: cookie } : {} });
        const info = { ws, messages: [] };
        ws.on('message', (d) => { try { info.messages.push(JSON.parse(String(d))); } catch (e) {} });
        ws.on('open', () => resolve(Object.assign(info, { opened: true })));
        ws.on('unexpected-response', (req, res) => { res.resume(); resolve(Object.assign(info, { rejected: res.statusCode })); });
        ws.on('error', (e) => { resolve(Object.assign(info, { rejected: e.message })); });
    });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function verifyEmail(email) {
    const fs = require('fs');
    const dir = process.env.DATA_DIR || (__dirname + '/data');
    const target = email.toLowerCase();
    let raw = '';
    try { raw = fs.readFileSync(dir + '/mailbox.jsonl', 'utf8'); } catch (e) { return null; }
    const lines = raw.trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        try {
            const rec = JSON.parse(lines[i]);
            if ((rec.to || '').toLowerCase() === target && rec.link) {
                const m = /token=([^&\s]+)/.exec(rec.link);
                if (m) return decodeURIComponent(m[1]);
            }
        } catch (e) { /* skip */ }
    }
    return null;
}

(async () => {
    // 1. Login (use an account we create so the suite is self-contained)
    const email = 'phasef_' + Date.now() + '@test.local';
    let r = await api('POST', '/api/signup', { name: 'PhaseF A', email, password: 'secret123' });
    check('signup -> 201', r.status === 201, r.status);
    r = await api('POST', '/api/login', { email, password: 'secret123' });
    check('login before verify blocked', r.status === 403, r.status);
    const tokenA = await verifyEmail(email);
    check('verification token emitted for A', !!tokenA, 'no mailbox entry');
    await api('GET', '/api/verify?token=' + tokenA);
    r = await api('POST', '/api/login', { email, password: 'secret123' });
    check('login -> 200', r.status === 200, r.status);
    const cookie = r.cookie.split(';')[0];

    // Second account (to prove only owner/members can edit)
    const email2 = 'phasefb_' + Date.now() + '@test.local';
    await api('POST', '/api/signup', { name: 'PhaseF B', email: email2, password: 'secret123' });
    const tokenB = await verifyEmail(email2);
    check('verification token emitted for B', !!tokenB, 'no mailbox entry');
    await api('GET', '/api/verify?token=' + tokenB);
    r = await api('POST', '/api/login', { email: email2, password: 'secret123' });
    const cookieB = r.cookie.split(';')[0];

    // 2. Create a document owned by A (no members)
    r = await api('POST', '/api/documents', { title: 'PhaseF Doc', fields: [] }, cookie);
    check('create doc -> 201', r.status === 201, r.status);
    const docId = r.json && r.json.document ? r.json.document.documentId : null;
    check('create doc returns documentId', !!docId, JSON.stringify(r.json));

    // 3. Unauthenticated WS rejected
    const anon = await wsOpen('/ws?doc=' + docId, '');
    check('anon ws rejected (401/403)', anon.rejected === 401 || anon.rejected === 403, 'rejected=' + anon.rejected);

    // 4. Non-member WS rejected
    const outsider = await wsOpen('/ws?doc=' + docId, cookieB);
    check('non-member ws rejected 403', outsider.rejected === 403, 'rejected=' + outsider.rejected);

    // 5. Two owner sockets join + presence
    const a = await wsOpen('/ws?doc=' + docId, cookie);
    const b = await wsOpen('/ws?doc=' + docId, cookie);
    check('owner A ws opened', !!a.opened, JSON.stringify(a.rejected));
    check('owner B ws opened', !!b.opened, JSON.stringify(b.rejected));
    await sleep(600);
    const bPresence = b.messages.filter(m => m.t === 'presence');
    check('B received presence', bPresence.length > 0, 'got ' + bPresence.length);
    check('presence lists 2 editors', bPresence.length > 0 && bPresence[0].users.length === 2, JSON.stringify(bPresence[0]));

    // 6. Op from A reaches B (not echoed back to A)
    a.messages.length = 0;
    b.messages.length = 0;
    a.ws.send(JSON.stringify({ t: 'op', op: { t: 'cell', r: 1, c: 0, v: 'Hello!' } }));
    await sleep(500);
    const bOps = b.messages.filter(m => m.t === 'op');
    check('B received the op', bOps.length === 1 && bOps[0].op.v === 'Hello!', JSON.stringify(bOps));
    check('A did not get an echo', a.messages.filter(m => m.t === 'op').length === 0, JSON.stringify(a.messages.slice(0, 3)));

    // 7. Member access: create a doc shared with a member, then B (different account) joins
    r = await api('POST', '/api/documents', { title: 'PhaseF Shared', fields: [], members: [{ email: email2 }] }, cookie);
    check('create shared doc -> 201', r.status === 201, r.status);
    const sharedId = r.json && r.json.document ? r.json.document.documentId : null;
    const c = await wsOpen('/ws?doc=' + sharedId, cookieB);
    check('member can join shared doc', !!c.opened, JSON.stringify(c.rejected));
    await sleep(300);
    const c2 = await wsOpen('/ws?doc=' + sharedId, cookie);
    check('owner can join shared doc', !!c2.opened, JSON.stringify(c2.rejected));
    await sleep(600);
    const gotShared = c2.messages.some(m => m.t === 'presence' && m.users.length >= 2);
    const gotSharedB = c.messages.some(m => m.t === 'presence' && m.users.length >= 2);
    check('shared doc presence >=2 (both sides)', gotShared && gotSharedB, JSON.stringify(c2.messages.slice(0, 3)));
    c.ws.close(); c2.ws.close();

    // 7b. Preview endpoint auto-analyses headings (With format support)
    const previewCsv = Buffer.from('Date,Pallot No,Location,Item Name\n11-01-2025,OP,Road,Crystal Moka\n').toString('base64');
    r = await api('POST', '/api/documents/preview', { fileName: 'in.csv', fileData: previewCsv }, cookie);
    check('preview -> 200', r.status === 200, r.status);
    check('preview detects headings', JSON.stringify(r.json && r.json.headers) === JSON.stringify(['Date', 'Pallot No', 'Location', 'Item Name']), JSON.stringify(r.json));
    check('preview marks file as formattable', r.json && r.json.formattable === true, r.json && r.json.formattable);
    check('preview supplies a sample row', JSON.stringify(r.json && r.json.sample) === JSON.stringify(['11-01-2025', 'OP', 'Road', 'Crystal Moka']), JSON.stringify(r.json && r.json.sample));

    // 7b2. Preview skips title lines and detects the real heading row
    const titleCsv = Buffer.from('STock Inventory Report 2026\nDate,Pallot No,Location,Item Name\n11-01-2025,OP,Road,Crystal Moka\n').toString('base64');
    r = await api('POST', '/api/documents/preview', { fileName: 'titled.csv', fileData: titleCsv }, cookie);
    check('preview skips title line -> headings detected', JSON.stringify(r.json && r.json.headers) === JSON.stringify(['Date', 'Pallot No', 'Location', 'Item Name']), JSON.stringify(r.json && r.json.headers));
    const tabText = 'Date\tPallot No\tLocation\n11-01-2025\tOP\tRoad\n';
    r = await api('POST', '/api/documents/preview', { fileName: 't.tsv.txt', fileData: Buffer.from(tabText).toString('base64') }, cookie);
    check('preview handles tab separators', r.json && r.json.headers && r.json.headers.length === 3 && r.json.headers[0] === 'Date' && r.json.headers[2] === 'Location', JSON.stringify(r.json && r.json.headers));

    // 7b3. Preview analyses real Excel files too
    const XLSX = require('xlsx');
    const xws = XLSX.utils.aoa_to_sheet([['DATE', 'PALLET NO.', 'LOCATION', 'ITEM NAME', 'QTY'], ['11-01-2025', 'OP', 'Road', 'Crystal', 19]]);
    const xwb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(xwb, xws, 'Sheet1');
    const xlsxBuf = XLSX.write(xwb, { type: 'buffer', bookType: 'xlsx' }).toString('base64');
    r = await api('POST', '/api/documents/preview', { fileName: 'real.xlsx', fileData: xlsxBuf }, cookie);
    check('preview analyses xlsx -> 5 headings', JSON.stringify(r.json && r.json.headers) === JSON.stringify(['DATE', 'PALLET NO.', 'LOCATION', 'ITEM NAME', 'QTY']), JSON.stringify(r.json && r.json.headers));
    check('preview xlsx sample row read', r.json && r.json.sample && r.json.sample[0] === '11-01-2025', JSON.stringify(r.json && r.json.sample));

    // 7c. Create a format-only document (headings + one empty template row)
    r = await api('POST', '/api/documents', {
        title: 'PhaseF Format',
        fileName: 'fmt.csv',
        fields: [
            { name: 'File Name', value: 'fmt.csv' },
            { name: 'Date', value: '', col: true },
            { name: 'Pallot No', value: '', col: true },
            { name: 'Item Name', value: '', col: true }
        ],
        fileData: previewCsv,
        importMode: 'format'
    }, cookie);
    check('create format-only doc -> 201', r.status === 201, r.status);
    const fmtId = r.json && r.json.document ? r.json.document.documentId : null;
    check('format-only doc returns documentId', !!fmtId, JSON.stringify(r.json));
    check('format-only doc stamped importMode=format', r.json && r.json.document.importMode === 'format', JSON.stringify(r.json && r.json.document.importMode));
    r = await api('GET', '/api/documents/' + fmtId + '/content', null, cookie);
    const fmtRows = r.json && r.json.rows;
    check('format-only content has only header + empty row', Array.isArray(fmtRows) && fmtRows.length === 2, JSON.stringify(fmtRows));
    check('format-only header row kept', Array.isArray(fmtRows) && fmtRows[0] && JSON.stringify(fmtRows[0]) === JSON.stringify(['Date', 'Pallot No', 'Item Name']), JSON.stringify(fmtRows && fmtRows[0]));
    check('format-only template row is empty', Array.isArray(fmtRows) && fmtRows[1] && fmtRows[1].every(v => v === ''), JSON.stringify(fmtRows && fmtRows[1]));

    // 7c2. No auto-detected columns -> headings typed by hand in the Fields
    // step become the format template (single-column CSV has no header row).
    const singleColCsv = Buffer.from('Fruits\nApple\nBanana\n').toString('base64');
    r = await api('POST', '/api/documents', {
        title: 'PhaseF Manual',
        fileName: 'manual.csv',
        fields: [
            { name: 'File Name', value: 'manual.csv' },
            { name: 'Item Name', value: '' },
            { name: 'Qty', value: '' }
        ],
        fileData: singleColCsv,
        importMode: 'format'
    }, cookie);
    const manId = r.json && r.json.document ? r.json.document.documentId : null;
    r = await api('GET', '/api/documents/' + manId + '/content', null, cookie);
    const manRows = r.json && r.json.rows;
    check('manual-headings fallback -> template from Fields step', Array.isArray(manRows) && manRows[0] && JSON.stringify(manRows[0]) === JSON.stringify(['Item Name', 'Qty']), JSON.stringify(manRows && manRows[0]));

    // 7d. "With data" keeps the complete file contents
    r = await api('POST', '/api/documents', { title: 'PhaseF Full', fileName: 'full.csv', fields: [], fileData: previewCsv, importMode: 'data' }, cookie);
    const fullId = r.json && r.json.document ? r.json.document.documentId : null;
    r = await api('GET', '/api/documents/' + fullId + '/content', null, cookie);
    check('with-data content keeps all rows', Array.isArray(r.json && r.json.rows) && r.json.rows.length === 2 && r.json.rows[1][0] === '11-01-2025', JSON.stringify(r.json && r.json.rows));

    // 8. Cleanup
    a.ws.close(); b.ws.close();
    await api('DELETE', '/api/documents/' + docId, null, cookie);
    await api('DELETE', '/api/documents/' + sharedId, null, cookie);
    await api('DELETE', '/api/documents/' + fmtId, null, cookie);
    await api('DELETE', '/api/documents/' + fullId, null, cookie);
    if (manId) await api('DELETE', '/api/documents/' + manId, null, cookie);

    console.log('----\nPASS: ' + pass + '  FAIL: ' + fail);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); console.log('----\nPASS: ' + pass + '  FAIL: ' + fail); process.exit(2); });