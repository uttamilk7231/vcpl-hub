const PHASE = 'I';
let PASS = 0, FAIL = 0;
const BASE = 'http://127.0.0.1:' + (process.env.TEST_PORT || 3001);
const http = require('http');

function check(name, ok, extra) {
    if (ok) { PASS++; console.log('PASS ' + name); }
    else { FAIL++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

function request(method, path, bodyObj, cookie) {
    return new Promise((resolve, reject) => {
        const data = bodyObj === undefined || bodyObj === null ? null : JSON.stringify(bodyObj);
        const req = http.request({
            hostname: '127.0.0.1', port: BASE.split(':').pop() || 3001, path: path, method: method,
            headers: Object.assign({}, data ? { 'Content-Type': 'application/json' } : {}, cookie ? { 'Cookie': cookie } : {}, data ? { 'Content-Length': Buffer.byteLength(data) } : {})
        }, (res) => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(raw); } catch (e) {}
                resolve({ status: res.statusCode, json: json, headers: res.headers, raw: raw });
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

function bufReq(method, path, cookie) {
    return new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port: BASE.split(':').pop() || 3001, path: path, headers: cookie ? { 'Cookie': cookie } : {} }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
        }).on('error', reject);
    });
}

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
    const email = 'phasei_' + Date.now() + '@test.local';
    let r = await request('POST', '/api/signup', { name: 'PhaseI', email: email, password: 'abc123' });
    check('signup -> 201', r.status === 201, r.status);
    r = await request('POST', '/api/login', { email: email, password: 'abc123' });
    check('login before verify blocked', r.status === 403, r.status);
    const token = await verifyEmail(email);
    check('verification token emitted', !!token, 'no mailbox entry');
    await request('GET', '/api/verify?token=' + token);
    r = await request('POST', '/api/login', { email: email, password: 'abc123' });
    check('login -> 200', r.status === 200, r.status);
    const cookie = r.headers['set-cookie'] && r.headers['set-cookie'][0].split(';')[0];
    check('cookie issued', !!cookie, cookie);

    // Doc 1: header-based date column ("FECHA")
    const csvA = 'ID,FECHA,OT\nA1,01-02-2026,55\nA2,15-02-2026,60\nA3,01-03-2026,99\n';
    r = await request('POST', '/api/documents', { title: 'PI Hdr', format: 'CSV', fileName: 'h.csv', fileData: Buffer.from(csvA).toString('base64') }, cookie);
    const hdrDoc = r.json && r.json.document ? r.json.document.documentId : null;
    check('create header-date doc', !!hdrDoc, r.json);

    r = await request('GET', '/api/documents/' + hdrDoc + '/export/period?mode=month&month=2026-02&format=json&scope=rows', null, cookie);
    check('json preview -> 200', r.status === 200, r.status);
    const j1 = r.json;
    check('detected = header', j1.rows && j1.rows.dateDetected === 'header', j1.rows && j1.rows.dateDetected);
    check('date column points at FECHA', j1.rows && j1.rows.dateColumns && j1.rows.dateColumns[0] === 1, j1.rows && j1.rows.dateColumns);
    check('february matches 2 rows', j1.rows && j1.rows.matchedRows === 2, j1.rows && j1.rows.matchedRows);
    check('totalRows = 3', j1.rows && j1.rows.totalRows === 3, j1.rows && j1.rows.totalRows);
    check('preview rows exclude the march row', j1.rows && j1.rows.rows.length === 3 && JSON.stringify(j1.rows.rows).indexOf('99') === -1, j1.rows && j1.rows.rows);

    // Doc 2: content-based date column (header NOT date-like)
    const csvB = 'Nombre,Ajuste\nJuan,01-02-2026\nAna,10-02-2026\nLuis,20-02-2026\nPaz,01-03-2026\n';
    r = await request('POST', '/api/documents', { title: 'PI Val', format: 'CSV', fileName: 'v.csv', fileData: Buffer.from(csvB).toString('base64') }, cookie);
    const valDoc = r.json && r.json.document ? r.json.document.documentId : null;
    check('create content-date doc', !!valDoc, r.json);
    r = await request('GET', '/api/documents/' + valDoc + '/export/period?mode=month&month=2026-02&format=json&scope=rows', null, cookie);
    const j2 = r.json;
    check('detected = content (fallback)', j2.rows && j2.rows.dateDetected === 'content', j2.rows && j2.rows.dateDetected);
    check('content date column = Ajuste (col 1)', j2.rows && j2.rows.dateColumns && j2.rows.dateColumns[0] === 1, j2.rows && j2.rows.dateColumns);
    check('content february matches 3 rows', j2.rows && j2.rows.matchedRows === 3, j2.rows && j2.rows.matchedRows);

    // Change preview via range on header doc
    r = await request('GET', '/api/documents/' + hdrDoc + '/export/period?mode=range&from=2026-01-01&to=2026-02-28&format=json&scope=both', null, cookie);
    check('range both -> 200', r.status === 200, r.status);
    check('range both rows matched', r.json && r.json.rows && r.json.rows.matchedRows === 2, r.json && r.json.rows);
    check('changeReport array present', Array.isArray(r.json && r.json.changeReport), r.json && r.json.changeReport);

    // PDF export (integrity check of the writer)
    r = await bufReq('GET', '/api/documents/' + hdrDoc + '/export/period?mode=month&month=2026-02&format=pdf&scope=both', cookie);
    check('pdf -> 200 + application/pdf', r.status === 200 && /application\/pdf/.test(r.headers['content-type']), r.status + ' / ' + (r.headers && r.headers['content-type'] || 'none') + ' / ' + r.buf.length + 'b');
    const s = r.buf.toString('latin1');
    check('pdf header %PDF', s.startsWith('%PDF-1.4'), s.slice(0, 16));
    check('pdf has trailer/startxref/%%EOF', s.indexOf('startxref') !== -1 && s.indexOf('%%EOF') !== -1, '');
    check('pdf has content streams', s.indexOf('stream') !== -1 && s.indexOf('endstream') !== -1, '');
    check('pdf has Helvetica font refs', s.indexOf('/Type /Font') !== -1, '');
    // verify xref offsets: each "N 0 obj" line that the offsets claim should exist at the offset
    const xrefM = /startxref\s+(\d+)\s*%%EOF/.exec(s);
    check('startxref points inside file', !!xrefM && +xrefM[1] > 0 && +xrefM[1] < s.length, xrefM && xrefM[1]);
    if (xrefM) {
        const xrefBody = s.slice(+xrefM[1]);
        const cntM = /xref\n0 (\d+)\n/.exec(xrefBody);
        let entryLines = [];
        if (cntM) entryLines = xrefBody.slice(cntM.index + cntM[0].length).split('\n');
        const firstObj = entryLines.length >= 2 ? parseInt(entryLines[1], 10) : NaN;
        check('xref count matches object count', cntM && entryLines.length >= 1 && +cntM[1] >= 5 && +cntM[1] <= 40, cntM && cntM[1]);
        check('first object offset valid', isFinite(firstObj) && firstObj > 0 && firstObj < s.length, firstObj);
        if (isFinite(firstObj) && firstObj > 0) {
            check('object 1 found at xref offset', s.slice(firstObj, firstObj + 12).indexOf('1 0 obj') === 0, s.slice(firstObj, firstObj + 16));
        }
    }

    // invalid format -> 400
    r = await request('GET', '/api/documents/' + hdrDoc + '/export/period?mode=month&month=2026-02&format=exe&scope=both', null, cookie);
    check('bad format -> 400', r.status === 400, r.status);

    // Cleanup
    await request('DELETE', '/api/documents/' + hdrDoc, null, cookie);
    await request('DELETE', '/api/documents/' + valDoc, null, cookie);

    console.log('----');
    console.log('PASS: ' + PASS + '  FAIL: ' + FAIL);
    process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });