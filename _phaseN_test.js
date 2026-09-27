// Phase N: member notifications, shared documents and recent activity.
const http = require('http');
const fs = require('fs');
const path = require('path');
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
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(raw); } catch (e) { /* non-json */ }
                resolve({ status: res.statusCode, headers: res.headers, body: raw, json: json });
            });
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

function cookieFrom(res) {
    const raw = res.headers['set-cookie'] || [];
    const first = Array.isArray(raw) ? raw[0] : raw;
    return first ? first.split(';')[0] : null;
}

function verifyEmail(email) {
    const dir = process.env.DATA_DIR || (path.join(__dirname, 'data'));
    const target = String(email).toLowerCase();
    let raw = '';
    try { raw = fs.readFileSync(path.join(dir, 'mailbox.jsonl'), 'utf8'); } catch (e) { return null; }
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

async function signupAndLogin(name, email, pw) {
    await req('POST', '/api/signup', { name: name, email: email, password: pw });
    const token = verifyEmail(email);
    if (token) await req('GET', '/api/verify?token=' + encodeURIComponent(token));
    const r = await req('POST', '/api/login', { email: email, password: pw });
    return { cookie: cookieFrom(r), status: r.status, json: r.json };
}

(async () => {
    const stamp = Date.now();
    const ownerEmail = 'phaseN_owner_' + stamp + '@test.local';
    const memberEmail = 'phaseN_member_' + stamp + '@test.local';
    const strangerEmail = 'phaseN_stranger_' + stamp + '@test.local';
    const pw = 'secret123';

    // 1. Two members exist and are signed in.
    const owner = await signupAndLogin('Phase N Owner', ownerEmail, pw);
    check('owner signed in', owner.status === 200 && !!owner.cookie, owner.status + ' ' + JSON.stringify(owner.json));

    const member = await signupAndLogin('Phase N Member', memberEmail, pw);
    check('member signed in', member.status === 200 && !!member.cookie, member.status + ' ' + JSON.stringify(member.json));

    // 2. Notifications require a session.
    let r = await req('GET', '/api/notifications');
    check('notifications 401 without session', r.status === 401, r.status + ' ' + r.body);
    r = await req('GET', '/api/activity');
    check('activity 401 without session', r.status === 401, r.status + ' ' + r.body);
    r = await req('GET', '/api/shared');
    check('shared 401 without session', r.status === 401, r.status + ' ' + r.body);

    // 3. The welcome notification is queued for the new member.
    r = await req('GET', '/api/notifications', null, member.cookie);
    check('member has notifications', r.status === 200 && r.json.notifications.length >= 1, r.status + ' ' + r.body);
    check('member unread count > 0', r.json && r.json.unread >= 1, JSON.stringify(r.json && r.json.unread));
    check('welcome notification present',
        r.json.notifications.some(n => n.type === 'welcome'),
        JSON.stringify(r.json.notifications.map(n => n.type)));

    // 4. Owner creates a document, then shares it with the member.
    r = await req('POST', '/api/documents', {
        title: 'Phase N Ledger',
        format: 'CSV',
        type: 'csv',
        category: 'Finance',
        fields: [{ name: 'Amount', col: true }]
    }, owner.cookie);
    check('document created', r.status === 201 && !!r.json.document.documentId, r.status + ' ' + r.body);
    const docId = r.json.document.documentId;

    r = await req('POST', '/api/documents/' + docId + '/share', { email: memberEmail, note: 'Please review' }, owner.cookie);
    check('share accepted', r.status === 201 && r.json.ok === true, r.status + ' ' + r.body);
    check('share records the note', r.json.share && r.json.share.note === 'Please review', JSON.stringify(r.json.share));

    // 5. The member is notified about the share.
    r = await req('GET', '/api/notifications', null, member.cookie);
    const shareNote = r.json.notifications.find(n => n.type === 'share' && n.docId === docId);
    check('share notification delivered', !!shareNote, JSON.stringify(r.json.notifications.map(n => n.type + ':' + n.docId)));
    check('share notification has a body', !!(shareNote && shareNote.body), JSON.stringify(shareNote));

    // 6. The member now sees the document in their list and in /api/shared.
    r = await req('GET', '/api/documents', null, member.cookie);
    check('shared document visible to member', r.json.documents.some(d => d.documentId === docId), r.body.slice(0, 200));

    r = await req('GET', '/api/shared', null, member.cookie);
    check('shared list for member', r.status === 200 && r.json.shared.some(s => s.documentId === docId), r.status + ' ' + r.body);
    check('shared entry names the sender', r.json.shared[0] && r.json.shared[0].fromEmail === ownerEmail.toLowerCase(), JSON.stringify(r.json.shared[0]));
    check('shared entry keeps the note', r.json.shared[0] && r.json.shared[0].note === 'Please review', JSON.stringify(r.json.shared[0]));

    r = await req('GET', '/api/shared', null, owner.cookie);
    check('sharedBy lists what I shared', r.json.sharedBy.some(s => s.documentId === docId), r.body.slice(0, 300));

    // 7. Sharing is validated and never grants access to a non-member.
    r = await req('POST', '/api/documents/' + docId + '/share', { email: 'nope' }, owner.cookie);
    check('share rejects bad email', r.status === 400, r.status + ' ' + r.body);
    r = await req('POST', '/api/documents/' + docId + '/share', { email: ownerEmail }, owner.cookie);
    check('share rejects self', r.status === 400, r.status + ' ' + r.body);
    r = await req('POST', '/api/documents/' + docId + '/share', { email: 'nobody_' + stamp + '@test.local' }, owner.cookie);
    check('share rejects unknown member', r.status === 404, r.status + ' ' + r.body);
    r = await req('POST', '/api/documents/NOSUCH/share', { email: memberEmail }, owner.cookie);
    check('share 404 for missing document', r.status === 404, r.status + ' ' + r.body);

    r = await req('GET', '/api/documents', null, member.cookie);
    r = await req('POST', '/api/documents', { title: 'Stranger doc', format: 'CSV' }, owner.cookie);
    const strangerDoc = r.json.document.documentId;
    r = await req('GET', '/api/documents', null, member.cookie);
    check('member cannot see unshared document', !r.json.documents.some(d => d.documentId === strangerDoc), r.body.slice(0, 200));
    r = await req('POST', '/api/documents/' + strangerDoc + '/share', { email: memberEmail }, member.cookie);
    check('non-member cannot share', r.status === 403, r.status + ' ' + r.body);

    // 8. Recent activity shows real document events and hides auth chatter.
    r = await req('GET', '/api/activity?limit=50', null, owner.cookie);
    check('activity returns entries', r.status === 200 && r.json.activity.length >= 2, r.status + ' ' + r.body.slice(0, 200));
    const actions = r.json.activity.map(a => a.action);
    check('activity has create + share', actions.includes('document-create') && actions.includes('document-share'), JSON.stringify(actions));
    check('activity hides login events', !actions.includes('login') && !actions.includes('signup'), JSON.stringify(actions));
    const create = r.json.activity.find(a => a.action === 'document-create' && a.docId === docId);
    check('activity entry is readable', !!create && /added a new document/.test(create.summary), JSON.stringify(create));
    check('activity is newest first', r.json.activity[0].ts >= r.json.activity[r.json.activity.length - 1].ts, 'order');

    // 9. Editing content notifies members and lands in the activity feed.
    r = await req('GET', '/api/notifications', null, member.cookie);
    const before = r.json.notifications.filter(n => n.type === 'update').length;
    const fileName = 'phase_n_' + stamp + '.csv';
    r = await req('POST', '/api/documents', { title: 'Phase N Data', format: 'CSV', type: 'csv', fileName: fileName, fileData: 'data:text/csv;base64,' + Buffer.from('Amount\n10\n').toString('base64') }, owner.cookie);
    const dataDoc = r.json.document.documentId;
    r = await req('POST', '/api/documents/' + dataDoc + '/share', { email: memberEmail }, owner.cookie);
    check('shared the data document', r.status === 201, r.status + ' ' + r.body);

    r = await req('PUT', '/api/documents/' + dataDoc + '/content', { rows: [['Amount'], ['42']] }, owner.cookie);
    check('content saved', r.status === 200 && r.json.ok === true, r.status + ' ' + r.body);
    r = await req('GET', '/api/notifications', null, member.cookie);
    const after = r.json.notifications.filter(n => n.type === 'update' && n.docId === dataDoc).length;
    check('content save notified the member', after >= 1, 'before=' + before + ' after=' + after);
    r = await req('GET', '/api/activity', null, owner.cookie);
    check('content save in activity', r.json.activity.some(a => a.action === 'document-content' && a.docId === dataDoc), JSON.stringify(r.json.activity.map(a => a.action)));

    // 10. Marking notifications read.
    r = await req('GET', '/api/notifications', null, member.cookie);
    const ids = r.json.notifications.slice(0, 2).map(n => n.id);
    r = await req('POST', '/api/notifications/read', { ids: ids }, member.cookie);
    check('mark specific ids read', r.status === 200 && r.json.updated === ids.length, r.status + ' ' + r.body);
    r = await req('GET', '/api/notifications', null, member.cookie);
    check('specific ids now read', ids.every(id => r.json.notifications.find(n => n.id === id).read), 'still unread');
    check('unread count dropped', r.json.unread < ids.length + 1, String(r.json.unread));

    r = await req('POST', '/api/notifications/read', {}, member.cookie);
    check('mark all read', r.status === 200 && r.json.unread === 0, r.status + ' ' + r.body);
    r = await req('GET', '/api/notifications', null, member.cookie);
    check('all read confirmed', r.json.unread === 0 && r.json.notifications.every(n => !!n.read), JSON.stringify(r.json.unread));

    // 11. Notifications are per member - the owner does not see the member's list.
    r = await req('GET', '/api/notifications', null, owner.cookie);
    const ownerIds = new Set(r.json.notifications.map(n => n.id));
    r = await req('GET', '/api/notifications', null, member.cookie);
    check('notification lists are private', r.json.notifications.every(n => !ownerIds.has(n.id)), 'leak');

    // 12. Unshare removes access, and deleting a document clears its share records.
    r = await req('POST', '/api/documents/' + dataDoc + '/unshare', { email: memberEmail }, owner.cookie);
    check('unshare ok', r.status === 200, r.status + ' ' + r.body);
    r = await req('GET', '/api/documents', null, member.cookie);
    check('unshared document hidden', !r.json.documents.some(d => d.documentId === dataDoc), r.body.slice(0, 200));
    r = await req('POST', '/api/documents/' + dataDoc + '/unshare', { email: memberEmail }, member.cookie);
    check('non-owner cannot unshare', r.status === 403, r.status + ' ' + r.body);

    r = await req('DELETE', '/api/documents/' + dataDoc, null, owner.cookie);
    check('delete ok', r.status === 200, r.status + ' ' + r.body);
    r = await req('GET', '/api/shared', null, owner.cookie);
    check('deleted document drops share records', !r.json.sharedBy.some(s => s.documentId === dataDoc), JSON.stringify(r.json.sharedBy.map(s => s.documentId)));

    // 13. Notification files are written for cloud mirroring.
    const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
    check('notifications.json written', fs.existsSync(path.join(dir, 'notifications.json')), dir);
    check('shares.json written', fs.existsSync(path.join(dir, 'shares.json')), dir);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'notifications.json'), 'utf8'));
    check('notification file has entries', Array.isArray(stored) && stored.length > 0, String(stored.length));

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(2); });
