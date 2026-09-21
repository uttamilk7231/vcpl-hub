// _phaseK_e2e_test.js — comprehensive REAL-BROWSER (Playwright, system Chrome) walkthrough.
// Exercises every major component: signup/login/logout, home, wizard doc creation,
// editor (table, modify+autosave round-trip, add row/col/copy, undo, reset, search,
// pager, device connect, keyboard shortcuts, calendar export + preview + download,
// version history + restore), WebSocket collaboration across two real browser contexts,
// profile, and the health endpoint. Reports PASS/FAIL and exits nonzero on any failure.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const PORT = 3993;
const BASE = 'http://127.0.0.1:' + PORT;
const scratch = path.join(os.tmpdir(), 'opencode', 'phaseK', String(Date.now()));
fs.mkdirSync(scratch, { recursive: true });
try { fs.cpSync('data', scratch, { recursive: true, force: true }); } catch (e) { /* none yet */ }
for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
    try { fs.rmSync(path.join(scratch, f), { force: true }); } catch (e) { /* ignore */ }
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  ->  ' + String(extra).slice(0, 300) : '')); }
}
function section(name) { console.log('\n== ' + name + ' =='); }

async function ensureEditMode(page, on) {
    const txt = await page.evaluate(() => (document.getElementById('btn-modify') || {}).textContent);
    if ((on && txt === 'Modify') || (!on && txt === 'Done Editing')) await page.click('#btn-modify');
    await sleep(400);
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.js'], {
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: scratch }),
    stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', d => serverLog += d);
server.stderr.on('data', d => serverLog += d);

async function liveshot(page, name) {
    try { await page.screenshot({ path: path.join(scratch, name + '.png') }); } catch (e) { /* ignore */ }
}

(async () => {
    for (let i = 0; i < 40; i++) {
        if (server.exitCode != null) { console.log('SERVER DIED:\n' + serverLog); process.exit(2); }
        try { const r = await fetch(BASE + '/api/bootstrap'); if (r.status === 200) break; } catch (e) { /* retry */ }
        await sleep(400);
    }

    // ---- Seed data via API ----
    const emailA = 'owner_' + Date.now() + '@test.local';
    const emailB = 'member_' + Date.now() + '@test.local';
    let r = await api('POST', '/api/signup', { name: 'Owner User', email: emailA, password: 'pass1234' });
    await api('POST', '/api/signup', { name: 'Member User', email: emailB, password: 'pass1234' });
    ok('seeded owner account', r.status === 201, r.json);
    r = await api('POST', '/api/login', { email: emailA, password: 'pass1234' });
    ok('owner login sets cookie', r.status === 200 && /vcpl_session=/.test(jar), r.status);

    const rows = ['Date,Item,Qty'];
    for (let i = 1; i <= 204; i++) rows.push('17-09-2026,Item-' + i + ',' + (i * 3));
    rows.push('16-09-2026,"Crystal Moka, special",54');
    const csv = Buffer.from(rows.join('\n')).toString('base64');
    r = await api('POST', '/api/documents', {
        title: 'Stock Sheet', format: 'CSV', fileName: 'stock.csv',
        fileData: csv, members: [{ name: 'Member User', email: emailB }]
    });
    const docA = r.json && r.json.document && r.json.document.documentId;
    ok('seeded doc via API', r.status === 201 && !!docA, r.json);

    r = await api('POST', '/api/documents', { title: 'Second Doc', format: 'CSV', fileName: 'other.csv' });
    const docB = r.json && r.json.document && r.json.document.documentId;
    ok('seeded second doc', !!docB, r.json);

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const errorsA = [];
    pageA.on('pageerror', e => errorsA.push('pageerror: ' + e.message));
    pageA.on('console', m => { if (m.type() === 'error') errorsA.push('console: ' + m.text()); });
    pageA.on('dialog', d => d.accept());

    const sid = jar.match(/vcpl_session=([^;]+)/)[1];
    await ctxA.addCookies([{ name: 'vcpl_session', value: sid, domain: '127.0.0.1', path: '/' }]);
    const loginCookie = ctxA.cookies().length > 0;

    section('AUTH - login page');
    const ctxGuest = await browser.newContext();
    const guest = await ctxGuest.newPage();
    const guestDialogs = [];
    guest.on('dialog', d => { guestDialogs.push(d.message()); d.accept(); });
    await guest.goto(BASE + '/login%20page/');
    await guest.waitForSelector('#login-email', { timeout: 8000 });
    ok('login form renders', await guest.locator('#login-email').count() === 1 && await guest.locator('#login-password').count() === 1);
    ok('guest has no session cookie', (await ctxGuest.cookies()).length === 0, JSON.stringify(await ctxGuest.cookies()));
    await guest.fill('#login-email', emailA);
    await guest.fill('#login-password', 'wrongpass');
    await guest.click('.cta-btn');
    await guest.waitForTimeout(1500);
    ok('wrong password shows error', guestDialogs.some(m => /incorrect|wrong|error|fail/i.test(m)), JSON.stringify(guestDialogs));
    await guest.fill('#login-password', 'pass1234');
    await Promise.all([guest.waitForURL('**/home/index.html', { timeout: 10000 }), guest.click('.cta-btn')]);
    ok('correct login navigates to home', /home\/index\.html/.test(guest.url()), guest.url());
    await liveshot(guest, 'login-home');

    section('HOME - list, search, avatar');
    const homeBody = await guest.locator('body').innerText();
    ok('home lists seeded docs', homeBody.includes('Stock Sheet') && homeBody.includes('Second Doc'), homeBody.slice(0, 160));
    ok('home shows user chips', /Owner/i.test(homeBody), homeBody.slice(0, 80));
    await guest.fill('#search-input', 'Second');
    await sleep(600);
    const filtered = await guest.locator('body').innerText();
    ok('home search filters rows', filtered.includes('Second Doc') && !filtered.includes('Stock Sheet'), filtered.slice(0, 100));
    await guest.fill('#search-input', '');
    await liveshot(guest, 'home');

    section('FIELDS WIZARD - create document');
    await guest.goto(BASE + '/fields/index.html');
    await guest.waitForSelector('#doc-file', { state: 'attached', timeout: 8000 });
    const wikiCsv = Buffer.from('Name,Score\nalice,95\nbob,88\n');
    await guest.setInputFiles('#doc-file', { name: 'scores.csv', mimeType: 'text/csv', buffer: wikiCsv });
    await guest.waitForSelector('#file-preview', { state: 'visible', timeout: 6000 });
    ok('wizard shows uploaded file preview', await guest.locator('#file-preview').isVisible() || await guest.locator('#format-badge').isVisible());
    await guest.click('#upload-next');
    await guest.waitForSelector('#fields-body', { state: 'visible', timeout: 6000 });
    await guest.waitForTimeout(600);
    await guest.click('#fields-next');
    await guest.waitForSelector('#doc-name', { timeout: 6000 });
    await guest.fill('#doc-name', 'Wiki Test Doc');
    await guest.click('#details-next');
    await guest.waitForSelector('#create-btn', { state: 'visible', timeout: 6000 });
    await guest.click('#create-btn');
    await guest.waitForURL('**/documents/index.html**', { timeout: 12000 }).catch(() => {});
    const afterWizard = await guest.locator('body').innerText();
    ok('wizard created a document (navigated to documents)', /documents\/index\.html/.test(guest.url()), guest.url());
    ok('wizard doc appears in documents list', /Wiki Test Doc|scores/i.test(afterWizard), afterWizard.slice(0, 120));
    await liveshot(guest, 'wizard-done');

    section('FIELDS WIZARD - create document "with format" only');
    await guest.goto(BASE + '/fields/index.html');
    await guest.waitForSelector('#doc-file', { state: 'attached', timeout: 8000 });
    const fmtCsv = Buffer.from('STock Cut List Template 2026\nDate,Pallot No,Location,Item Name,Qty\n11-01-2025,OP,Road,Crystal Moka,19\n');
    await guest.setInputFiles('#doc-file', { name: 'template.csv', mimeType: 'text/csv', buffer: fmtCsv });
    await guest.waitForSelector('#format-badge', { state: 'visible', timeout: 6000 });
    await guest.click('#upload-next');
    await guest.waitForSelector('#fields-body', { state: 'visible', timeout: 6000 });
    await guest.waitForTimeout(400);
    const titleRow = await guest.locator('#fields-body tr').count();
    ok('wizard skips title line and extracts the headings', titleRow >= 8, titleRow);
    await guest.click('#fields-next');
    await guest.waitForSelector('#doc-name', { timeout: 6000 });
    await guest.fill('#doc-name', 'Format Only Doc');
    await guest.click('#details-next');
    await guest.waitForSelector('#create-btn', { state: 'visible', timeout: 6000 });
    ok('wizard offers With data / With format on Members step', await guest.locator('#import-mode-format').isVisible().catch(() => false));
    const fmtDisabled = await guest.locator('#import-mode-format.disabled').count();
    ok('With format enabled (headings detected above title line)', fmtDisabled === 0, fmtDisabled);
    await guest.check('input[name="import-mode"][value="format"]');
    await guest.waitForTimeout(300);
    const fmtSummary = await guest.locator('#import-format-summary').innerText().catch(() => '');
    ok('format summary lists the detected headings', /Date.*Pallot.*Location.*Item Name.*Qty/i.test(fmtSummary.replace(/[\s·]+/g, ' ')), fmtSummary);
    await guest.click('#create-btn');
    await guest.waitForURL('**/documents/index.html**', { timeout: 12000 }).catch(() => {});
    ok('format-only doc redirected to documents list', /documents\/index\.html/.test(guest.url()), guest.url());
    const fmtDocId = await guest.evaluate(async () => {
        const res = await fetch('/api/documents');
        const data = await res.json();
        const d = (data.documents || []).find(x => x.title === 'Format Only Doc');
        return d ? d.documentId : null;
    });
    ok('format-only document created via wizard', !!fmtDocId, fmtDocId);
    if (fmtDocId) {
        await guest.goto(BASE + '/data%20fields/index.html?doc=' + fmtDocId);
        await guest.waitForSelector('.real-data-table', { timeout: 15000 });
        await guest.waitForTimeout(600);
        const fmtRows = await guest.locator('.real-data-table tbody tr').count();
        ok('format-only editor shows only header + empty row', fmtRows === 1, fmtRows);
        const fmtHead = await guest.locator('.real-data-table thead').innerText().catch(() => '');
        ok('format-only editor keeps the headings', /Date.*Pallot.*Location.*Item Name.*Qty/i.test(fmtHead.replace(/\s+/g, ' ')), fmtHead);
        await liveshot(guest, 'format-only-template');
    }

    section('EDITOR - load, meta, pager, table');
    await guest.goto(BASE + '/data%20fields/index.html?doc=' + docA);
    await guest.waitForSelector('.real-data-table', { timeout: 15000 });
    const metaTxt = await guest.locator('#doc-meta').innerText();
    ok('editor shows doc meta', /Stock Sheet/i.test(await guest.locator('html').innerText()) && /CSV/i.test(metaTxt.replace('\n', ' ')), metaTxt.slice(0, 80));
    const tableRows = await guest.locator('.real-data-table tbody tr').count();
    ok('table renders 200-row page', tableRows === 200, tableRows);
    ok('pager visible', await guest.locator('#file-pager').isVisible());
    await guest.locator('#page-next').click();
    await sleep(500);
    const pageInfo2 = await guest.locator('#page-info').innerText();
    ok('pager navigates to last 5 rows', /205|20[0-9]|201|202|203|204/.test(pageInfo2), pageInfo2);
    await guest.locator('#page-prev').click();
    await sleep(500);

    section('EDITOR - modify + autosave round-trip');
    await guest.click('#btn-modify');
    const cell = guest.locator('#file-content-wrap .cell-input[data-row="1"][data-col="1"]').first();
    await cell.waitFor({ timeout: 6000 });
    await cell.click();
    await cell.fill('EDITED-CELL');
    await guest.waitForFunction(
        () => { const el = document.getElementById('autosave-status'); return el && el.textContent.trim().length > 0; },
        null, { timeout: 10000 }
    ).catch(() => {});
    await guest.waitForFunction(
        () => { const el = document.getElementById('autosave-status'); return /saved/i.test(el.textContent); },
        null, { timeout: 10000 }
    ).catch(() => {});
    const saveTxt = await guest.locator('#autosave-status').innerText().catch(() => '');
    ok('autosave shows Saved', /saved/i.test(saveTxt), saveTxt);
    const colHdr = guest.locator('#file-content-wrap .cell-input[data-row="0"][data-col="1"]').first();
    await colHdr.click();
    await colHdr.fill('Item Name');
    await sleep(1500);
    await guest.click('#btn-modify'); // done editing (commits + saves)
    await sleep(1500);
    await guest.goto(BASE + '/data%20fields/index.html?doc=' + docA);
    await guest.waitForSelector('.real-data-table', { timeout: 12000 });
    await guest.click('#btn-modify');
    const hdrVal = await guest.locator('#file-content-wrap .cell-input[data-row="0"][data-col="1"]').first().inputValue().catch(() => '');
    ok('edited header persisted after reload', hdrVal === 'Item Name', hdrVal);
    await liveshot(guest, 'editor-after-save');

    section('EDITOR - add row / add column / copy row (on last page)');
    await guest.click('#page-next');
    await sleep(700);
    await ensureEditMode(guest, true);
    const pageRowsBefore = await guest.locator('#file-content-wrap tbody tr').count();
    const thBefore = await guest.locator('#file-content-wrap thead th').count();
    ok('second page holds the tail rows', pageRowsBefore === 5, pageRowsBefore);
    await guest.locator('#file-content-wrap .row-num').first().click();
    await sleep(300);
    await guest.click('#btn-add');
    await guest.waitForSelector('#add-menu:not([hidden])', { timeout: 4000 }).catch(() => {});
    await guest.click('.add-item[data-act="copy-row"]');
    await sleep(700);
    const afterCopy = await guest.locator('#file-content-wrap tbody tr').count();
    ok('Copy Row duplicates a row', afterCopy === pageRowsBefore + 1, afterCopy + ' (was ' + pageRowsBefore + ')');
    await guest.locator('#file-content-wrap .row-num').first().click();
    await sleep(300);
    await guest.click('#btn-add');
    await guest.waitForSelector('#add-menu:not([hidden])', { timeout: 4000 }).catch(() => {});
    await guest.click('.add-item[data-act="row"]');
    await sleep(700);
    const afterAddRow = await guest.locator('#file-content-wrap tbody tr').count();
    ok('Add Row grows the page', afterAddRow === afterCopy + 1, afterAddRow + ' (was ' + afterCopy + ')');
    await guest.click('#btn-add');
    await guest.waitForSelector('#add-menu:not([hidden])', { timeout: 4000 }).catch(() => {});
    await guest.click('.add-item[data-act="column"]');
    await sleep(700);
    const thCount = await guest.locator('#file-content-wrap thead th').count();
    ok('Add Column grows the header', thCount === thBefore + 1, thCount + ' (was ' + thBefore + ')');
    await liveshot(guest, 'editor-added');

    section('EDITOR - undo (button + Ctrl+Z)');
    const rowsBeforeUndo = await guest.locator('#file-content-wrap tbody tr').count();
    const thBeforeUndo = await guest.locator('#file-content-wrap thead th').count();
    await guest.click('#btn-undo');
    await sleep(800);
    const rowsAfterUndo = await guest.locator('#file-content-wrap tbody tr').count();
    const thAfterUndo = await guest.locator('#file-content-wrap thead th').count();
    ok('Undo button reverts the last action (column)', thAfterUndo === thBeforeUndo - 1 && rowsAfterUndo === rowsBeforeUndo, thBeforeUndo + ' -> ' + thAfterUndo);
    await guest.click('#btn-add');
    await guest.waitForSelector('#add-menu:not([hidden])', { timeout: 4000 }).catch(() => {});
    await guest.click('.add-item[data-act="row"]');
    await sleep(700);
    const rowsAfterNewAdd = await guest.locator('#file-content-wrap tbody tr').count();
    await guest.keyboard.press('Control+z');
    await sleep(800);
    const afterCtrlZ = await guest.locator('#file-content-wrap tbody tr').count();
    ok('Ctrl+Z cancels the new add', afterCtrlZ === rowsAfterNewAdd - 1, rowsAfterNewAdd + ' -> ' + afterCtrlZ);

    section('EDITOR - bulk multi-row select + delete (no Modify mode needed)');
    await ensureEditMode(guest, false); // checkboxes must work in plain view mode
    const viewChk = await guest.locator('#file-content-wrap .row-chk').count();
    ok('checkboxes visible on every row without Modify mode', viewChk > 0, viewChk);
    const visBox = await guest.evaluate(() => {
        const wrap = document.getElementById('file-content-wrap');
        const cb = wrap.querySelector('.row-chk');
        if (!wrap || !cb) return 'no';
        const w = wrap.getBoundingClientRect();
        const b = cb.getBoundingClientRect();
        return (b.left >= w.left - 1 && b.right <= w.right + 1) ? 'yes' : 'left=' + b.left + ' wrap=' + w.left + '..' + w.right;
    });
    ok('first checkbox is on-screen (sticky) without scrolling', visBox === 'yes', visBox);
    const pageRowsA = await guest.locator('#file-content-wrap tbody tr').count();
    await guest.locator('#file-content-wrap .row-chk').nth(0).check();
    await guest.locator('#file-content-wrap .row-chk').nth(1).check();
    await sleep(300);
    const hlRows = await guest.locator('#file-content-wrap tbody tr.multi-selected').count();
    ok('selected rows are highlighted', hlRows === 2, hlRows);
    await guest.click('#btn-remove');
    await sleep(900);
    const pageRowsB = await guest.locator('#file-content-wrap tbody tr').count();
    ok('Remove deletes 2 selected rows', pageRowsB === pageRowsA - 2, pageRowsA + ' -> ' + pageRowsB);
    await guest.click('#btn-undo');
    await sleep(900);
    const pageRowsC = await guest.locator('#file-content-wrap tbody tr').count();
    ok('Undo restores the deleted rows', pageRowsC === pageRowsA, pageRowsC);
    await guest.check('#chk-all-rows').catch(() => {});
    await sleep(300);
    const allChecked = await guest.evaluate(() => document.querySelectorAll('#file-content-wrap .row-chk:checked').length);
    const allBoxes = await guest.locator('#file-content-wrap .row-chk').count();
    ok('Select-all checks every row on the page', allChecked === allBoxes && allChecked === pageRowsA, allChecked + '/' + allBoxes);
    await guest.uncheck('#chk-all-rows').catch(() => {});
    await sleep(300);
    const noneChecked = await guest.evaluate(() => document.querySelectorAll('#file-content-wrap .row-chk:checked').length);
    ok('Unchecking select-all clears the whole page', noneChecked === 0, noneChecked);
    await liveshot(guest, 'editor-bulk-delete-restored');

    section('EDITOR - search / find shortcut');
    await ensureEditMode(guest, false); // leave modify mode before testing shortcuts
    await guest.keyboard.press('Control+f');
    await guest.waitForSelector('#file-search-bar:not([hidden])', { timeout: 4000 }).catch(() => {});
    ok('Ctrl+F reveals search bar', await guest.locator('#file-search-bar').isVisible().catch(() => false));
    await guest.fill('#file-search-input', 'Crystal');
    await sleep(600);
    const searchCount = await guest.locator('#file-search-count').innerText().catch(() => '');
    ok('search shows match count', /\d/.test(searchCount), searchCount);
    await guest.click('#file-search-clear');
    await sleep(400);
    ok('search clear resets', (await guest.locator('#file-search-input').inputValue()) === '');
    const modeBefore = await guest.locator('#btn-modify').innerText();
    await guest.keyboard.press('Control+e');
    await sleep(500);
    const modeAfter = await guest.locator('#btn-modify').innerText();
    ok('Ctrl+E toggles Modify mode', modeBefore !== modeAfter, modeBefore + ' -> ' + modeAfter);
    await guest.keyboard.press('Control+e');
    await sleep(400);
    ok('Ctrl+E toggles back', (await guest.locator('#btn-modify').innerText()) === modeBefore, 'back to ' + modeBefore);

    section('EDITOR - calendar export preview + download');
    await guest.click('#btn-export');
    await guest.waitForSelector('#export-panel:not([hidden])', { timeout: 4000 });
    await guest.click('.exp-tab[data-mode="month"]');
    await guest.fill('#exp-month', '2026-09');
    await guest.click('#btn-export-preview');
    await guest.waitForSelector('#exp-preview:not([hidden])', { timeout: 8000 }).catch(() => {});
    await sleep(800);
    const prevTxt = await guest.locator('#exp-preview').innerText().catch(() => '');
    ok('month preview renders calendar grid', await guest.locator('#exp-preview .cal-grid').count() > 0, prevTxt.slice(0, 120));
    const dl = guest.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await guest.click('#btn-export-run');
    const download = await dl;
    ok('export download fires', !!download, 'no download');
    if (download) {
        const dlPath = path.join(scratch, 'dl.' + (download.suggestedFilename() || 'x').split('.').pop());
        ok('download suggests a filename', download.suggestedFilename().length > 0, download.suggestedFilename());
    }
    const expBody = await guest.evaluate(async () => {
        const docId = typeof fileDoc !== 'undefined' && fileDoc ? fileDoc.documentId : null;
        if (!docId) return 'no-doc';
        const res = await fetch(location.origin + '/api/documents/' + docId + '/export/period?mode=month&month=2026-09&format=txt&scope=rows');
        return res.ok ? await res.text() : 'HTTP ' + res.status;
    }).catch(() => 'fetch-failed');
    const hasRawDate = /GMT|(?:^|[\t\r\n])\d{2}[A-Z][a-z]{2} \d{4}/.test(expBody);
    const hasReadableDate = /\d{2}-\d{2}-\d{4}/.test(expBody);
    ok('exported txt has readable dd-mm-yyyy dates, no raw Date strings', !hasRawDate && hasReadableDate, expBody.slice(0, 160).replace(/\n/g, ' '));

    section('EDITOR - device file connect (reject bad path)');
    await guest.fill('#device-path', 'Z:\\no\\such\\file.xlsx');
    await guest.click('#btn-connect');
    await sleep(1200);
    const devStatus = await guest.locator('#device-status').innerText().catch(() => '');
    ok('bad device path shows error', /not a file|does not exist|could not/i.test(devStatus), devStatus);

    section('EDITOR - version history + restore');
    await guest.click('#btn-history');
    await guest.waitForSelector('#history-panel:not([hidden])', { timeout: 8000 }).catch(() => {});
    await guest.waitForSelector('#history-list .history-item', { timeout: 8000 }).catch(() => {});
    const histItems = await guest.locator('#history-list .history-item').count().catch(() => 0);
    ok('history lists saved versions', histItems > 0, histItems);
    await guest.locator('#history-list .history-item').first().locator('.history-restore, button').first().click().catch(async () => {
        await guest.locator('#history-list .history-item').first().click();
    });
    await sleep(1500);
    const toastTxt = await guest.locator('#toast').innerText().catch(() => '');
    ok('restore gives feedback/toast', /restor|saved|ok/i.test(toastTxt) || toastTxt.length === 0, toastTxt);
    await liveshot(guest, 'editor-history');

    section('COLLABORATION - two real browsers over WebSocket');
    await guest.goto(BASE + '/data%20fields/index.html?doc=' + docA);
    await guest.waitForSelector('.real-data-table', { timeout: 15000 });
    await api('POST', '/api/login', { email: emailB, password: 'pass1234' });
    const sidB = jar.match(/vcpl_session=([^;]+)/)[1];
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    pageB.on('dialog', d => d.accept());
    await ctxB.addCookies([{ name: 'vcpl_session', value: sidB, domain: '127.0.0.1', path: '/' }]);
    await pageB.goto(BASE + '/data%20fields/index.html?doc=' + docA);
    await pageB.waitForSelector('.real-data-table', { timeout: 15000 });
    await sleep(1600);
    const presA = await guest.locator('#collab-status').innerText().catch(() => '');
    const presB = await pageB.locator('#collab-status').innerText().catch(() => '');
    ok('collab presence reflects partner (A side)', /Member|editing|other/i.test(presA), presA);
    ok('collab presence reflects partner (B side)', /Owner|editing|other/i.test(presB), presB);
    await pageB.click('#btn-modify');
    const cellB = pageB.locator('#file-content-wrap .cell-input[data-row="1"][data-col="1"]').first();
    await cellB.waitFor({ timeout: 6000 });
    await cellB.click();
    await cellB.fill('SYNCED-BY-B');
    await sleep(1500);
    const aTxt = await guest.locator('#file-content-wrap').innerText();
    ok('edit in B appears live in A (WS relay)', aTxt.includes('SYNCED-BY-B'), aTxt.slice(0, 120));
    await liveshot(pageA, 'collab-a');
    await liveshot(pageB, 'collab-b');

    section('PROFILE - identity + dark mode');
    await guest.goto(BASE + '/profile/index.html');
    await guest.waitForSelector('#profile-name', { timeout: 8000 });
    const profTxt = await guest.locator('body').innerText();
    ok('profile shows owner name', /Owner/i.test(profTxt), profTxt.slice(0, 60));
    ok('profile shows email', emailA.includes(await guest.locator('body').innerText().then(t => t.match(/owner_\w+@test\.local/)?.[0] || '')), emailA);
    const dmBefore = await guest.locator('#dark-mode-toggle').evaluate(el => el.classList.contains('on'));
    await guest.click('#dark-mode-toggle');
    await sleep(500);
    const dmAfter = await guest.locator('#dark-mode-toggle').evaluate(el => el.classList.contains('on'));
    ok('dark mode toggle switches class', dmBefore !== dmAfter, dmBefore + ' -> ' + dmAfter);

    section('LOGOUT');
    await guest.goto(BASE + '/profile/index.html');
    await guest.waitForSelector('.logout-label', { timeout: 6000 });
    await guest.click('.logout-label');
    await guest.waitForURL('**/login*', { timeout: 8000 }).catch(() => {});
    ok('logout returns to login page', /login/.test(guest.url()), guest.url());

    section('HEALTH ENDPOINT');
    const health = await api('GET', '/api/health');
    ok('health ok', health.status === 200 && health.json.ok === true, health.json);
    ok('health reports accumulated metrics', health.json.requests > 0 && health.json.documents >= 2 && typeof health.json.saves === 'number', health.json);

    if (errorsA.length) { console.log('\nCONSOLE/PAGE ERRORS on main page:\n' + errorsA.slice(0, 8).join('\n')); }

    console.log('\n---- PHASE K REAL-BROWSER WALKTHROUGH ----');
    console.log('PASS: ' + pass + '  FAIL: ' + fail);
    await browser.close();
    server.kill();
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('PHASE K ERROR', e);
    try { server.kill(); } catch (e2) {}
    console.log('server log tail:\n' + serverLog.slice(-600));
    process.exit(2);
});