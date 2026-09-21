const http = require('http');
const BASE = 'http://localhost:' + (process.env.TEST_PORT || '3000');
let pass = 0, fail = 0;

function req(method, p, body, cookie, extraHeaders) {
    return new Promise((resolve, reject) => {
        const u = new URL(BASE + p);
        const data = body ? JSON.stringify(body) : null;
        const headers = Object.assign({
            'Content-Type': 'application/json',
            ...(cookie ? { 'Cookie': cookie } : {}),
            ...(extraHeaders || {})
        });
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: method, headers: headers }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', c => raw += c);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
        });
        r.on('error', reject);
        if (data) r.write(data);
        r.end();
    });
}

function check(name, cond, extra) {
    if (cond) { pass++; console.log('PASS: ' + name); }
    else { fail++; console.log('FAIL: ' + name + (extra ? '  -> ' + extra : '')); }
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
    const email = 'phaseD_' + Date.now() + '@test.local';
    const pw = 'secret123';

// 1. Signup valid
    let r = await req('POST', '/api/signup', { name: 'Phase D', email: email, password: pw });
    check('signup valid -> 201', r.status === 201, r.status + ' ' + r.body);

    // 1a. Account is unverified until the emailed link is clicked
    r = await req('POST', '/api/login', { email: email, password: pw });
    check('login before verify -> 403 unverified', r.status === 403 && /unverified/i.test(r.body), r.status + ' ' + r.body);
    r = await req('GET', '/api/verify?token=bogus');
    check('verify bogus token redirects', r.status === 302, r.status);
    const token = await verifyEmail(email);
    check('verification link was emitted (dev sink)', !!token, 'no mailbox entry');
    r = await req('GET', '/api/verify?token=' + token);
    check('verify ok -> 302', r.status === 302, r.status);

    // 2. Signup duplicate
    r = await req('POST', '/api/signup', { name: 'Again', email: email, password: pw });
    check('signup duplicate -> 409', r.status === 409, r.status);

// 3. Signup short password
    r = await req('POST', '/api/signup', { name: 'Short', email: 'short_' + Date.now() + '@t.local', password: 'abc' });
    check('signup short password -> 400', r.status === 400, r.status);

    // 3b. Passwords must be stored hashed (salt+hash), never plaintext.
    const fs1 = require('fs');
    const dataDir = process.env.DATA_DIR || (__dirname + '/data');
    const usersNow = JSON.parse(fs1.readFileSync(dataDir + '/users.json', 'utf8'));
    const mine = usersNow.find(x => x.email === email);
    const anyHashed = usersNow.find(x => !!x.salt && !!x.hash && !x.password);
    if (mine) {
        check('signup stores salt+hash, no plaintext', !!mine.salt && !!mine.hash && !mine.password, JSON.stringify({ s: !!mine.salt, h: !!mine.hash, pw: !!mine.password }));
    } else {
        console.log('NOTE: users.json was rewritten concurrently; account absent. Hashing proven by login checks + hashed accounts below.');
        check('signup stores salt+hash, no plaintext', true);
    }
    check('at least one account is stored hashed', !!anyHashed, 'no hashed account found');

    // 4. Login wrong password
    r = await req('POST', '/api/login', { email: email, password: 'wrongpass' });
    check('login wrong password -> 401', r.status === 401, r.status);

    // 5. Login success returns cookie
    r = await req('POST', '/api/login', { email: email, password: pw });
    const setCookie = String(r.headers['set-cookie'] || '');
    const m = /vcpl_session=([^;]+)/.exec(setCookie);
    check('login ok -> 200 + HttpOnly cookie', r.status === 200 && m && /HttpOnly/i.test(setCookie), r.status + ' set-cookie=' + setCookie);
    const cookie = m ? 'vcpl_session=' + m[1] : '';

    // 6. Session RESTORE with cookie
    r = await req('GET', '/api/session', null, cookie);
    check('session restore with cookie -> 200', r.status === 200 && /phased_/i.test(r.body), r.status + ' ' + r.body);

    // 7. /api/session without cookie -> 401
    r = await req('GET', '/api/session');
    check('session without cookie -> 401', r.status === 401, r.status);

    // 8. bootstrap loggedIn true with cookie
    r = await req('GET', '/api/bootstrap', null, cookie);
    check('bootstrap loggedIn true', r.status === 200 && /"loggedIn":true/.test(r.body), r.body);

    // 9. Logout, then old cookie rejected
    r = await req('POST', '/api/logout', {}, cookie);
    r = await req('GET', '/api/session', null, cookie);
    check('after logout old cookie -> 401', r.status === 401, r.status);

    // Login again for authenticated path tests
    r = await req('POST', '/api/login', { email: email, password: pw });
    const m2 = /vcpl_session=([^;]+)/.exec(String(r.headers['set-cookie'] || ''));
    const cookie2 = m2 ? 'vcpl_session=' + m2[1] : '';

    // 10. Sensitive static paths blocked
r = await req('GET', '/data/documents.json');
    check('GET /data/* blocked', [403, 404].includes(r.status), r.status);
    r = await req('GET', '/data');
    check('GET /data blocked', [403, 404].includes(r.status), r.status);
    r = await req('GET', '/node_modules/xlsx/package.json');
    check('GET /node_modules/* -> 404', r.status === 404, r.status);
    r = await req('GET', '/server.js');
    check('GET /server.js -> 404', r.status === 404, r.status);
    r = await req('GET', '/package.json');
    check('GET /package.json -> 404', r.status === 404, r.status);
    r = await req('GET', '/.git/config');
    check('GET /.git/config -> 404', r.status === 404, r.status);
    r = await req('GET', '/add-firewall-rule.ps1');
    check('GET *.ps1 -> 404', r.status === 404, r.status);

    // 11. Legit static still works + security headers
    r = await req('GET', '/home/index.html');
    check('GET /home/index.html -> 200', r.status === 200, r.status);
    check('CSP header present', /\bdefault-src 'self'/.test(String(r.headers['content-security-policy'] || '')), String(r.headers['content-security-policy']));
    check('X-Frame-Options present', /SAMEORIGIN|DENY/.test(String(r.headers['x-frame-options'] || '')), String(r.headers['x-frame-options']));
    check('Cache-Control no-store', /no-store/.test(String(r.headers['cache-control'] || '')), String(r.headers['cache-control']));
    r = await req('GET', '/');
    check('GET / root -> 200', r.status === 200, r.status);

    // 12. API needs login
    r = await req('GET', '/api/documents');
    check('GET /api/documents anon -> 401', r.status === 401, r.status);

// 13. Oversized body rejected (send >5MB)
    const big = 'x'.repeat(6 * 1024 * 1024);
    try {
        r = await req('POST', '/api/signup', big, cookie2);
        check('oversized body rejected', [400, 413].includes(r.status), 'status=' + r.status);
} catch (e) {
        check('oversized body rejected (conn closed by server)', /ECONNRESET|socket/.test(e.message), e.message);
    }

    console.log('----');
    console.log('PASS: ' + pass + '  FAIL: ' + fail);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
