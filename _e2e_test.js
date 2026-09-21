// _e2e_test.js — browser end-to-end test via Playwright (uses system Chrome, no downloads).
// Spawns its own server on port 3992 with a scratch DATA_DIR, then drives a real browser
// through: login -> open a CSV document -> edit a cell -> autosave -> history -> health.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const PORT = 3992;
const BASE = 'http://127.0.0.1:' + PORT;
const scratch = path.join(os.tmpdir(), 'opencode', 'e2e', String(Date.now()));
fs.mkdirSync(scratch, { recursive: true });
try { fs.cpSync('data', scratch, { recursive: true, force: true }); } catch (e) { console.log('note: no seed data copied (' + e.code + ')'); }
for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
    try { fs.rmSync(path.join(scratch, f), { force: true }); } catch (e) { /* ignore */ }
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + String(extra).slice(0, 400) : '')); }
}

let jar = '';
function api(method, p, body) {
    return new Promise((resolve, reject) => {
        const d = body ? JSON.stringify(body) : null;
        const headers = { 'Content-Type': 'application/json' };
        if (d) headers['Content-Length'] = Buffer.byteLength(d);
        if (jar) headers['Cookie'] = jar;
        const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, res => {
            let s = '';
            res.on('data', c => s += c);
            res.on('end', () => {
                const sc = res.headers['set-cookie'];
                if (sc) {
                    const sid = String(Array.isArray(sc) ? sc.join(';') : sc).match(/vcpl_session=([^;]+)/);
                    if (sid) jar = 'vcpl_session=' + sid[1];
                }
                let json = null;
                try { json = JSON.parse(s); } catch (e) { /* not json */ }
                resolve({ status: res.statusCode, json });
            });
        });
        req.on('error', reject);
        if (d) req.write(d);
        req.end();
    });
}

const server = spawn(process.execPath, ['server.js'], {
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: scratch }),
    stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
server.stdout.on('data', d => log += d);
server.stderr.on('data', d => log += d);

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    for (let i = 0; i < 40; i++) {
        if (server.exitCode != null) { console.log('SERVER DIED:\n' + log); process.exit(2); }
        try { const r = await fetch(BASE + '/api/bootstrap'); if (r.status === 200) break; } catch (e) { /* retry */ }
        await sleep(400);
    }

    const email = 'e2e_' + Date.now() + '@test.local';
    const su = await api('POST', '/api/signup', { name: 'E2E User', email: email, password: 'e2e12345' });
    check('signup e2e user', su.status === 201, su.json);
    const lg = await api('POST', '/api/login', { email: email, password: 'e2e12345' });
    check('login e2e user + session cookie', lg.status === 200 && /vcpl_session=/.test(jar), lg.status + ' cookie=' + /vcpl_session=/.test(jar));

    const csv = Buffer.from('Name,Note\nE2E-DATA,hello world\n').toString('base64');
    const cre = await api('POST', '/api/documents', { title: 'E2E CSV', format: 'CSV', fileName: 'e2e.csv', fileData: csv });
    const docId = cre.json && cre.json.document && cre.json.document.documentId;
    check('create e2e doc', cre.status === 201 && !!docId, JSON.stringify(cre.json).slice(0, 200));

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    const sid = jar.match(/vcpl_session=([^;]+)/)[1];
    await page.context().addCookies([{ name: 'vcpl_session', value: sid, domain: '127.0.0.1', path: '/' }]);

    const homeRes = await page.goto(BASE + '/home/index.html');
    await page.waitForSelector('body', { timeout: 8000 });
    check('home page loads', homeRes.status() === 200, homeRes.status());
    const homeText = await page.locator('body').innerText();
    check('home page shows signed-in user name', /E2E/i.test(homeText), homeText.slice(0, 160));

    await page.goto(BASE + '/data%20fields/index.html?doc=' + docId);
    await page.waitForSelector('.real-data-table', { timeout: 15000 });
    check('editor renders table', (await page.locator('.real-data-table').count()) > 0);
    const bodyText = await page.locator('#file-content-wrap').innerText();
    check('editor shows uploaded cells', bodyText.includes('E2E-DATA') && bodyText.includes('hello world'), bodyText.slice(0, 120));

    await page.click('#btn-modify');
    const firstCell = page.locator('#file-content-wrap .cell-input').first();
    await firstCell.click();
    await firstCell.fill('E2E-EDITED');
    await page.waitForFunction(
        () => { const el = document.getElementById('autosave-status'); return el && el.textContent.trim().length > 0; },
        null, { timeout: 8000 }
    ).catch(() => {});
    await sleep(1500);
    const statusTxt = await page.locator('#autosave-status').innerText().catch(() => '');
    check('autosave feedback appears', /saved|saving|error/i.test(statusTxt), statusTxt);

    await page.goto(BASE + '/data%20fields/index.html?doc=' + docId);
    await page.waitForSelector('.real-data-table', { timeout: 15000 });
    await sleep(700);
    const collab = await page.locator('#collab-status').innerText().catch(() => '');
    check('collab presence renders', collab.length > 0, collab);

    await page.click('#btn-history');
    await page.waitForSelector('#history-panel', { state: 'visible', timeout: 6000 });
    check('history panel opens', await page.locator('#history-panel').isVisible());

    const shotPath = path.join(scratch, 'e2e.png');
    await page.screenshot({ path: shotPath });
    check('screenshot saved', fs.existsSync(shotPath));

    const health = await api('GET', '/api/health');
    check('health endpoint ok', health.status === 200 && health.json && health.json.ok === true, health.json);
    check('health reports counters', typeof health.json.requests === 'number' && typeof health.json.documents === 'number' && typeof health.json.saves === 'number', health.json);

    if (errors.length) console.log('CONSOLE/PAGE ERRORS:\n' + errors.join('\n'));
    await browser.close();
    console.log('----');
    console.log('PASS: ' + pass + '  FAIL: ' + fail);
    server.kill();
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('E2E ERROR', e);
    try { server.kill(); } catch (e2) {}
    console.log('server log tail:\n' + log.slice(-600));
    process.exit(2);
});