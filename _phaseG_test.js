const PHASE = 'G';
let PASS = 0, FAIL = 0;
const BASE = 'http://127.0.0.1:' + (process.env.TEST_PORT || 3001);
const server = require('http');
const crypto = require('crypto');

function check(name, ok, extra) {
    if (ok) { PASS++; console.log('PASS ' + name); }
    else { FAIL++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

function request(method, path, bodyObj, cookie) {
    return new Promise((resolve, reject) => {
        const data = bodyObj === undefined || bodyObj === null ? null : JSON.stringify(bodyObj);
        const req = server.request({
            hostname: '127.0.0.1', port: BASE.split(':').pop() || 3001, path: path, method: method,
            headers: Object.assign({}, data ? { 'Content-Type': 'application/json' } : {}, cookie ? { 'Cookie': cookie } : {}, data ? { 'Content-Length': Buffer.byteLength(data) } : {})
        }, (res) => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(raw); } catch (e) {}
                resolve({ status: res.statusCode, json: json, headers: res.headers });
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    const uname = 'phaseg_' + Date.now() + '@test.local';
    const noname = 'phaseg_' + Date.now() + 'x@test.local';

    let r = await request('POST', '/api/signup', { name: 'PhaseG', email: uname, password: 'abc123' });
    check('signup -> 201', r.status === 201, r.status);
    r = await request('POST', '/api/login', { email: uname, password: 'abc123' });
    check('login before verify blocked', r.status === 403, r.status);
    const token = await verifyEmail(uname);
    check('verification token emitted', !!token, 'no mailbox entry');
    await request('GET', '/api/verify?token=' + token);
    r = await request('POST', '/api/login', { email: uname, password: 'abc123' });
    check('login -> 200', r.status === 200, r.status);
    let cookie = r.headers['set-cookie'] && r.headers['set-cookie'][0].split(';')[0];
    if (!cookie) { cookie = r.headers['set-cookie'] && r.headers['set-cookie'].join(';'); }
    check('cookie issued', !!cookie, cookie);

    const flow = {
        A: uname, B: noname,
        cookieA: cookie,
        cookieB: null
    };

    // CSV document
    const csvA = Buffer.from('a,b\n1,2\n3,4\n').toString('base64');
    r = await request('POST', '/api/documents', { title: 'PG CSV', format: 'CSV', fileName: 'pg.csv', fileData: csvA }, cookie);
    check('create csv -> 201', r.status === 201, r.status);
    const docId = r.json && r.json.document ? r.json.document.documentId : null;
    check('create csv documentId', !!docId, r.json);

    // Save v1 (differs from the uploaded content so it records a snapshot)
    const v1 = [['a', 'b'], ['10', '20'], ['30', '40']];
    r = await request('PUT', '/api/documents/' + docId + '/content', { rows: v1 }, cookie);
    check('save v1 -> 200', r.status === 200, r.status);

    // Save v2
    const v2 = [['a', 'b'], ['1', 'TWO'], ['3', '4'], ['5', '6']];
    r = await request('PUT', '/api/documents/' + docId + '/content', { rows: v2 }, cookie);
    check('save v2 -> 200', r.status === 200, r.status);

    // History list (no snapshots exposed)
    r = await request('GET', '/api/documents/' + docId + '/history', null, cookie);
    check('history -> 200', r.status === 200, r.status);
    const hist = (r.json && r.json.history) || [];
    check('history has >=2 entries', hist.length >= 2, hist.length);
    check('history list excludes snapshot', hist.every(h => h.snapshot === undefined), hist.slice(0, 1));
    check('history newest first', hist.length < 2 || new Date(hist[0].ts) >= new Date(hist[1].ts), hist.map(h => h.ts));

    const firstTs = hist[hist.length - 1].ts; // v1 save

    // Restore v1
    r = await request('POST', '/api/documents/' + docId + '/history/restore', { ts: firstTs }, cookie);
    check('restore v1 -> 200', r.status === 200, r.status);

    // Verify content is back to v1
    r = await request('GET', '/api/documents/' + docId + '/content', null, cookie);
    const rows = (r.json && r.json.rows) || [];
    check('content restored to v1', JSON.stringify(rows) === JSON.stringify(v1), JSON.stringify(rows));

    // Restore of unknown ts -> 404
    r = await request('POST', '/api/documents/' + docId + '/history/restore', { ts: '1999-01-01T00:00:00.000Z' }, cookie);
    check('restore unknown -> 404', r.status === 404, r.status);

    // History now includes a restore entry
    r = await request('GET', '/api/documents/' + docId + '/history', null, cookie);
    const hist2 = (r.json && r.json.history) || [];
    check('restore recorded in history', hist2.some(h => /restored/i.test(h.summary || '')), hist2.map(h => h.summary).slice(0, 3));

    // Permission: other user 403 on history
    r = await request('POST', '/api/signup', { name: 'PhaseG2', email: noname, password: 'abc123' });
    r = await request('POST', '/api/login', { email: noname, password: 'abc123' });
    const tokenB = await verifyEmail(noname);
    await request('GET', '/api/verify?token=' + tokenB);
    r = await request('POST', '/api/login', { email: noname, password: 'abc123' });
    const cookieB = r.headers['set-cookie'] && r.headers['set-cookie'][0].split(';')[0];
    flow.cookieB = cookieB;
    r = await request('GET', '/api/documents/' + docId + '/history', null, flow.cookieB);
    check('history denied for non-owner', r.status === 403, r.status);

    // Text file restore
    r = await request('POST', '/api/documents', { title: 'PG TXT', format: 'Text', fileName: 'pg.txt', fileData: Buffer.from('hello world').toString('base64') }, cookie);
    const txtId = r.json && r.json.document ? r.json.document.documentId : null;
    r = await request('PUT', '/api/documents/' + txtId + '/content', { text: 'version one' }, cookie);
    r = await request('PUT', '/api/documents/' + txtId + '/content', { text: 'version two' }, cookie);
    r = await request('GET', '/api/documents/' + txtId + '/history', null, cookie);
    const txtHist = (r.json && r.json.history) || [];
    check('txt history >=2', txtHist.length >= 2, txtHist.length);
    r = await request('POST', '/api/documents/' + txtId + '/history/restore', { ts: txtHist[txtHist.length - 1].ts }, cookie);
    check('txt restore -> 200', r.status === 200, r.status);
    if (r.status === 200) {
        r = await request('GET', '/api/documents/' + txtId + '/content', null, cookie);
        check('txt content restored', (r.json && r.json.text) === 'version one', r.json && r.json.text);
    }

    // Cleanup
    await request('DELETE', '/api/documents/' + docId, null, cookie);
    await request('DELETE', '/api/documents/' + txtId, null, cookie);

    console.log('----');
    console.log('PASS: ' + PASS + '  FAIL: ' + FAIL);
    process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });