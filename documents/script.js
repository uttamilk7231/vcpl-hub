let documents = [];
let members = [];

const avatarColors = [
    "linear-gradient(135deg, #667eea, #764ba2)",
    "linear-gradient(135deg, #f093fb, #f5576c)",
    "linear-gradient(135deg, #4facfe, #00f2fe)",
    "linear-gradient(135deg, #43e97b, #38f9d7)",
    "linear-gradient(135deg, #fa709a, #fee140)",
    "linear-gradient(135deg, #a18cd1, #fbc2eb)"
];

const getAvatarColor = (index) => avatarColors[index % avatarColors.length];

const formatDate = (dateString) => {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

function timeAgo(dateString) {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '—';
    const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return mins + (mins === 1 ? ' min ago' : ' mins ago');
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    const days = Math.floor(hours / 24);
    if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
    return formatDate(dateString);
}

function lastEditedOf(doc) {
    return doc.updatedAt || doc.date || doc.createdAt || '';
}

// ---------- Table rendering ----------
function buildRow(doc, index) {
    const tr = document.createElement('tr');
    tr.dataset.status = doc.status;

    // Name cell
    const nameCell = document.createElement('td');
    nameCell.dataset.label = 'Document';
    const nameWrap = document.createElement('div');
    nameWrap.className = 'doc-name-cell';
    const icon = document.createElement('div');
    icon.className = 'doc-icon ' + (doc.category || '').toLowerCase();
    icon.textContent = doc.format === 'Excel' ? 'XLS' :
        doc.format === 'Word' ? 'DOC' :
        doc.format === 'PowerPoint' ? 'PPT' : 'PDF';
    const info = document.createElement('div');
    info.className = 'doc-info';
    const title = document.createElement('span');
    title.className = 'doc-title';
    title.textContent = doc.title;
    const date = document.createElement('span');
    date.className = 'doc-date';
    date.textContent = formatDate(doc.date);
    info.append(title, date);
    nameWrap.append(icon, info);
    nameCell.appendChild(nameWrap);

    // Format cell
    const fmtCell = document.createElement('td');
    fmtCell.dataset.label = 'Format';
    const fmtBadge = document.createElement('span');
    fmtBadge.className = 'fmt-badge';
    fmtBadge.style.background = (doc.format || 'Other') === 'Excel' ? '#e7f9ee' :
        (doc.format || 'Other') === 'Word' ? '#e8f0fe' :
        (doc.format || 'Other') === 'PDF' ? '#fee2e2' : '#f5f3ff';
    fmtBadge.style.color = (doc.format || 'Other') === 'Excel' ? '#0e9f4e' :
        (doc.format || 'Other') === 'Word' ? '#2563eb' :
        (doc.format || 'Other') === 'PDF' ? '#dc2626' : '#8b5cf6';
    fmtBadge.textContent = doc.format || 'Other';
    fmtCell.appendChild(fmtBadge);

    // Members cell
    const membersCell = document.createElement('td');
    membersCell.dataset.label = 'Members';
    const membersWrap = document.createElement('div');
    membersWrap.className = 'members-cell';
    const list = doc.members && doc.members.length ? doc.members : [doc.user];
    const maxShow = Math.min(list.length, 3);
    for (let i = 0; i < maxShow; i++) {
        const av = document.createElement('div');
        av.className = 'member-avatar';
        av.style.background = getAvatarColor(index + i);
        av.textContent = list[i].initials;
        av.title = list[i].name;
        membersWrap.appendChild(av);
    }
    if (list.length > 3) {
        const more = document.createElement('span');
        more.className = 'members-count';
        more.textContent = '+' + (list.length - 3);
        membersWrap.appendChild(more);
    }
    membersCell.appendChild(membersWrap);

    // ID cell
    const idCell = document.createElement('td');
    idCell.dataset.label = 'ID Number';
    const idSpan = document.createElement('span');
    idSpan.className = 'id-cell';
    idSpan.textContent = doc.documentId;
    idCell.appendChild(idSpan);

    // Status cell
    const statusCell = document.createElement('td');
    statusCell.dataset.label = 'Status';
    const badge = document.createElement('span');
    badge.className = 'status-badge ' + doc.status;
    badge.textContent = doc.status.charAt(0).toUpperCase() + doc.status.slice(1);
    statusCell.appendChild(badge);

    // Last edited cell
    const updatedCell = document.createElement('td');
    updatedCell.dataset.label = 'Last Edited';
    updatedCell.className = 'updated-cell';
    updatedCell.textContent = timeAgo(lastEditedOf(doc));

    tr.append(nameCell, fmtCell, membersCell, idCell, statusCell, updatedCell, buildActions(doc, tr));
    tr.addEventListener('click', (e) => {
        if (e.detail === 1) {
            clearTimeout(clickTimeout);
            clickTimeout = setTimeout(() => openDetail(doc), 250);
        } else if (e.detail === 2) {
            clearTimeout(clickTimeout);
            window.location.href = '../data fields/index.html?doc=' + encodeURIComponent(doc.documentId);
        }
    });
    return tr;
}

// Three-dot actions menu cell (Open / Rename / Duplicate / Copy link / Status / Export / Remove)
function buildActions(doc, tr) {
    const cell = document.createElement('td');
    cell.className = 'actions-cell';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-menu-btn';
    btn.setAttribute('aria-label', 'Actions');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';

    const menu = document.createElement('div');
    menu.className = 'row-menu';
    menu.hidden = true;

    const item = (label, icon, danger) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'row-menu-item' + (danger ? ' danger' : '');
        b.innerHTML = icon + '<span>' + label + '</span>';
        return b;
    };

    const openItem = item('Open', '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>');
    openItem.addEventListener('click', (e) => {
        e.stopPropagation();
        closeRowMenus();
        window.location.href = '../data fields/index.html?doc=' + encodeURIComponent(doc.documentId);
    });

    const renameItem = item('Rename', '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>');
    renameItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeRowMenus();
        const val = await showPrompt({ title: 'Rename document', message: 'Give this document a new name.', value: doc.title, submitText: 'Rename' });
        if (!val) return;
        const res = await fetch('/api/documents/' + doc.documentId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: val })
        });
        const d = await res.json();
        if (d.ok) {
            showToast('Renamed to "' + d.document.title + '".', 'success');
            await loadDocuments();
        } else {
            showToast(d.error || 'Could not rename.', 'error');
        }
    });

    const duplicateItem = item('Duplicate', '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>');
    duplicateItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeRowMenus();
        const res = await fetch('/api/documents/' + doc.documentId + '/duplicate', { method: 'POST' });
        const d = await res.json();
        if (d.ok) {
            showToast('Duplicated as "' + d.document.title + '".', 'success');
            await loadDocuments();
        } else {
            showToast(d.error || 'Could not duplicate.', 'error');
        }
    });

    const copyItem = item('Copy link', '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>');
    copyItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeRowMenus();
        const link = window.location.origin + '/data%20fields/index.html?doc=' + encodeURIComponent(doc.documentId);
        try {
            await navigator.clipboard.writeText(link);
            showToast('Link copied to clipboard.', 'success');
        } catch (err) {
            showToast('Could not copy the link.', 'error');
        }
    });

    const statusTitle = doc.status === 'completed' ? 'Mark Active' : 'Mark Completed';
    const statusItem = item(statusTitle, '<svg viewBox="0 0 24 24"><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="M5.64 5.64l2.12 2.12"/><path d="M16.24 16.24l2.12 2.12"/><path d="M5.64 18.36l2.12-2.12"/><path d="M16.24 7.76l2.12-2.12"/></svg>');
    statusItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeRowMenus();
        const next = doc.status === 'completed' ? 'active' : 'completed';
        const res = await fetch('/api/documents/' + doc.documentId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: next })
        });
        const d = await res.json();
        if (d.ok) {
            showToast('Marked "' + doc.title + '" ' + next + '.', 'success');
            await loadDocuments();
        } else {
            showToast(d.error || 'Could not update the document.', 'error');
        }
    });

    const exportItem = item('Download / Export', '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>');
    exportItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeRowMenus();
        await exportDocument(doc);
    });

    const removeItem = item('Remove', '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', true);
    removeItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeRowMenus();
        await removeDocument(doc);
    });

    menu.append(openItem, renameItem, duplicateItem, copyItem, statusItem, exportItem, removeItem);
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu.hidden) {
            closeRowMenus();
            openRowMenu(btn, menu);
        } else {
            menu.hidden = true;
        }
    });
    cell.append(btn, menu);

    document.addEventListener('click', (e) => {
        if (!cell.contains(e.target)) menu.hidden = true;
    });

    return cell;
}

function openRowMenu(btn, menu) {
    // Move the menu to <body> so no transformed/overflow-clipped ancestor can
    // shift it or clip it, then position it relative to the viewport.
    if (menu.parentElement !== document.body) document.body.appendChild(menu);
    menu.style.position = 'fixed';
    menu.style.top = 'auto';
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.left = 'auto';
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const gap = 8;
    const up = r.bottom + m.height + gap > window.innerHeight;
    if (up) {
        menu.style.bottom = (window.innerHeight - r.top + gap) + 'px';
    } else {
        menu.style.top = (r.bottom + gap) + 'px';
    }
    let left = (up ? r.right - m.width : r.left);
    left = Math.max(12, Math.min(left, window.innerWidth - m.width - 12));
    menu.style.left = left + 'px';
}

function closeRowMenus() {
    document.querySelectorAll('.row-menu').forEach(m => {
        if (m.hidden) return;
        m.hidden = true;
        if (m.parentElement === document.body) m.remove();
    });
}

// Drop any open row menu on scroll/resize so it never floats detached from its button.
document.addEventListener('scroll', () => closeRowMenus(), { capture: true, passive: true });
window.addEventListener('resize', () => closeRowMenus());

// Export the document details (metadata + fields) as CSV
async function exportDocument(doc) {
    try {
        const res = await fetch('/api/documents/' + doc.documentId + '/export');
        if (!res.ok) {
            showToast('Could not export the document.', 'error');
            return;
        }
        const text = await res.text();
        const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (doc.title || 'document').replace(/[^a-z0-9_-]+/gi, '_') + '.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('Exported ' + (doc.title || 'document'), 'success');
    } catch (e) {
        showToast('Could not reach the server.', 'error');
    }
}

// Delete the document after confirmation
async function removeDocument(doc) {
    const yes = await showConfirm({
        title: 'Remove document',
        message: 'Remove the document "' + doc.title + '"? This cannot be undone.',
        confirmText: 'Remove'
    });
    if (!yes) return;
    try {
        const res = await fetch('/api/documents/' + doc.documentId, { method: 'DELETE' });
        const data = await res.json();
        if (!data.ok) {
            showToast(data.error || 'Could not remove the document.', 'error');
            return;
        }
        documents = documents.filter(d => d.documentId !== doc.documentId);
        if (activeDoc && activeDoc.documentId === doc.documentId) closeDetail();
        applyFilters();
        showToast('Removed "' + (doc.title || 'document') + '".', 'success');
    } catch (e) {
        showToast('Could not reach the server.', 'error');
    }
}

function renderDocuments(list) {
    const tbody = document.getElementById('documents-body');
    tbody.innerHTML = '';

    if (!list.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.className = 'empty-state';
        const wrap = document.createElement('div');
        wrap.className = 'empty-wrap';
        const p = document.createElement('p');
        p.textContent = documents.length === 0
            ? 'No documents yet — create your first one.'
            : 'No documents match your filter.';
        const createBtn = document.createElement('a');
        createBtn.href = '../fields/index.html';
        createBtn.className = 'empty-create-btn';
        createBtn.textContent = '+ Create a document';
        wrap.append(p, createBtn);
        td.appendChild(wrap);
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    list.forEach((doc, index) => tbody.appendChild(buildRow(doc, index)));
}

let mainQuery = '';
let clickTimeout = null;
let activeFilter = 'all';
let globalContentHits = [];

function searchLocally(q) {
    if (!q) return documents;
    return documents.filter(doc =>
        (doc.title || '').toLowerCase().includes(q) ||
        (doc.format || '').toLowerCase().includes(q) ||
        (doc.documentId || '').toLowerCase().includes(q) ||
        (doc.status || '').toLowerCase().includes(q)
    );
}

let searchTimer = null;
function fetchContentSearch(q) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
        if (!q) { globalContentHits = []; applyFilters(); return; }
        try {
            const res = await fetch('/api/search?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (data.ok) {
                globalContentHits = data.results.filter(r => r.matchedIn === 'content');
                applyFilters();
            }
        } catch (e) { /* ignore */ }
    }, 350);
}

function applyFilters() {
    let result = searchLocally(mainQuery);

    if (activeFilter !== 'all') {
        result = result.filter(doc => doc.status === activeFilter);
    }

    // Merge content-search hits that matched only inside the file contents
    if (globalContentHits.length) {
        const ids = new Set(result.map(d => d.documentId));
        for (const h of globalContentHits) {
            if (!ids.has(h.documentId)) {
                const full = documents.find(d => d.documentId === h.documentId);
                if (full) { result.push(full); ids.add(h.documentId); }
            }
        }
    }

    // Sort (updated desc by default)
    const dir = sortAsc ? 1 : -1;
    const cmp = (a, b) => {
        let av, bv;
        if (sortKey === 'title') { av = (a.title || '').toLowerCase(); bv = (b.title || '').toLowerCase(); }
        else if (sortKey === 'format') { av = (a.format || '').toLowerCase(); bv = (b.format || '').toLowerCase(); }
        else if (sortKey === 'members') { av = (a.members || []).length; bv = (b.members || []).length; }
        else if (sortKey === 'id') { av = (a.documentId || '').toLowerCase(); bv = (b.documentId || '').toLowerCase(); }
        else if (sortKey === 'status') { av = (a.status || '').toLowerCase(); bv = (b.status || '').toLowerCase(); }
        else if (sortKey === 'updated') { av = (lastEditedOf(a) || ''); bv = (lastEditedOf(b) || ''); }
        if (av < bv) return -dir;
        if (av > bv) return dir;
        return 0;
    };
    result.sort(cmp);

    renderDocuments(result);
}

function fitTabCounts() {
    if (!documents.length) return;
    const counts = { all: documents.length, active: 0, completed: 0 };
    documents.forEach(d => {
        const s = d.status || 'active';
        if (s === 'active') counts.active++;
        else if (s === 'completed') counts.completed++;
    });
    document.querySelectorAll('.filter-tab').forEach(t => {
        const f = t.dataset.filter;
        if (counts[f] !== undefined) {
            const label = f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Completed';
            t.textContent = label + ' (' + counts[f] + ')';
        }
    });
}

// ---------- Sortable headers ----------
let sortKey = 'updated';
let sortAsc = false;

function updateSortIndicators() {
    document.querySelectorAll('th.sortable').forEach(th => {
        const ind = th.querySelector('.sort-ind');
        if (!ind) return;
        if (th.dataset.sort === sortKey) {
            ind.textContent = sortAsc ? ' ▲' : ' ▼';
            th.classList.add('sorting');
        } else {
            ind.textContent = '';
            th.classList.remove('sorting');
        }
    });
}

function initSortableHeaders() {
    document.querySelectorAll('th.sortable').forEach(th => {
        const key = th.dataset.sort;
        const onSort = () => {
            if (sortKey === key) sortAsc = !sortAsc;
            else { sortKey = key; sortAsc = key === 'updated'; }
            updateSortIndicators();
            applyFilters();
        };
        th.addEventListener('click', onSort);
        th.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(); }
        });
    });
}

// ---------- Members for the detail picker ----------
async function loadMembers() {
    try {
        const res = await fetch('/api/users');
        const d = await res.json();
        if (d.ok) members = d.users || [];
    } catch (e) { /* server unreachable */ }
}

// ---------- Document detail (tabbed form) ----------
const detailModal = document.getElementById('detail-modal');
const detailTabs = document.getElementById('detail-tabs');
const detailMembersPicker = document.getElementById('detail-members-picker');

let activeDoc = null;
let detailMembers = [];

function openDetail(doc) {
    activeDoc = doc;
    detailMembers = (doc.members && doc.members.length) ? doc.members.slice() : [];

    document.getElementById('detail-title').value = doc.title || '';
    document.getElementById('detail-file').value = doc.fileName || '';
    const fmtSelect = document.getElementById('detail-format');
    const fmt = doc.format || 'Other';
    fmtSelect.value = [...fmtSelect.options].some(o => o.value === fmt) ? fmt : 'Other';
    document.getElementById('detail-status').value = doc.status || 'active';
    document.getElementById('detail-id').textContent = doc.documentId;
    document.getElementById('detail-creator').textContent = doc.user ? doc.user.name : '—';
    document.getElementById('detail-created').textContent = new Date(doc.date).toLocaleString();

    switchTab('details');
    renderDetailMembers();
    renderHistory();
    detailMembersPicker.hidden = true;

    detailModal.hidden = false;
    document.body.style.overflow = 'hidden';
}

function closeDetail() {
    detailModal.hidden = true;
    document.body.style.overflow = '';
    activeDoc = null;
}

function switchTab(name) {
    document.querySelectorAll('#detail-tabs .tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('#detail-form .tab-pane').forEach(p =>
        p.classList.toggle('active', p.dataset.pane === name));
}

function renderDetailMembers() {
    const box = document.getElementById('detail-members-list');
    box.innerHTML = '';

    if (!detailMembers.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.style.padding = '20px';
        empty.textContent = 'No members yet.';
        box.appendChild(empty);
        return;
    }

    detailMembers.forEach((m, i) => {
        const row = document.createElement('div');
        row.className = 'detail-member-row';
        const av = document.createElement('div');
        av.className = 'detail-member-avatar';
        av.style.background = getAvatarColor(i);
        av.textContent = m.initials || '--';
        const info = document.createElement('div');
        info.className = 'detail-member-info';
        const name = document.createElement('span');
        name.className = 'detail-member-name';
        name.textContent = m.name;
        const email = document.createElement('span');
        email.className = 'detail-member-email';
        email.textContent = m.email;
        info.append(name, email);
        const role = document.createElement('span');
        role.className = 'detail-member-role';
        role.textContent = 'Member';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'detail-member-remove';
        remove.textContent = '×';
        remove.title = 'Remove member';
        remove.addEventListener('click', () => {
            detailMembers = detailMembers.filter(mm => mm.email !== m.email);
            renderDetailMembers();
            renderDetailPicker();
        });
        row.append(av, info, role, remove);
        box.appendChild(row);
    });
}

function renderDetailPicker() {
    const box = document.getElementById('detail-member-list');
    box.innerHTML = '';

    const others = members.filter(m => !detailMembers.some(dm => dm.email === m.email));
    if (!others.length) {
        box.textContent = 'All available users are already members.';
        return;
    }

    others.forEach((m, i) => {
        const label = document.createElement('label');
        label.className = 'picker-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        const avatar = document.createElement('span');
        avatar.className = 'picker-avatar';
        avatar.style.background = getAvatarColor(i);
        avatar.textContent = m.initials;
        const name = document.createElement('span');
        name.className = 'picker-name';
        name.textContent = m.name;
        const email = document.createElement('span');
        email.className = 'picker-email';
        email.textContent = m.email;
        label.append(cb, avatar, name, email);
        cb.addEventListener('change', () => {
            if (cb.checked) {
                detailMembers.push(m);
                renderDetailMembers();
                renderDetailPicker();
            }
        });
        box.appendChild(label);
    });
}

function renderHistory() {
    const box = document.getElementById('detail-history');
    box.innerHTML = '';

    const entries = [
        { title: 'Document created' + (activeDoc.user ? ' by ' + activeDoc.user.name : ''), time: new Date(activeDoc.date).toLocaleString() }
    ];
    if (activeDoc.updatedAt) {
        entries.push({ title: 'Details last updated', time: new Date(activeDoc.updatedAt).toLocaleString() });
    }

    entries.forEach(en => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const dot = document.createElement('div');
        dot.className = 'history-dot';
        const body = document.createElement('div');
        const t = document.createElement('div');
        t.className = 'history-title';
        t.textContent = en.title;
        const tm = document.createElement('div');
        tm.className = 'history-time';
        tm.textContent = en.time;
        body.append(t, tm);
        item.append(dot, body);
        box.appendChild(item);
    });
}

async function saveDetail() {
    if (!activeDoc) return;

    const title = document.getElementById('detail-title').value.trim();
    if (!title) {
        showToast('Document name cannot be empty.', 'error');
        return;
    }

    const payload = {
        title: title,
        format: document.getElementById('detail-format').value,
        fileName: document.getElementById('detail-file').value.trim(),
        status: document.getElementById('detail-status').value,
        members: detailMembers
    };

    try {
        const res = await fetch('/api/documents/' + activeDoc.documentId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.ok) {
            showToast(data.error || 'Could not save changes.', 'error');
            return;
        }

        const idx = documents.findIndex(d => d.documentId === activeDoc.documentId);
        if (idx >= 0) documents[idx] = data.document;
        applyFilters();
        closeDetail();
        showToast('Changes saved.', 'success');
    } catch (e) {
        showToast('Could not reach the server.', 'error');
    }
}

// ---------- Init ----------
// Load the document list from the server, then refresh the view
async function loadDocuments() {
    try {
        const res = await fetch('/api/documents');
        const data = await res.json();
        if (data.ok) documents = data.documents;
    } catch (e) { /* empty */ }
    fitTabCounts();
    updateSortIndicators();
    applyFilters();
}

document.addEventListener('DOMContentLoaded', async () => {
    // Auth guard
    let user = null;
    try {
        const res = await fetch('/api/session');
        const data = await res.json();
        if (data.ok) user = data.user;
    } catch (e) { /* server unreachable */ }

    if (!user) {
        window.location.replace('../login page/index.html');
        return;
    }

    function initials(name) {
        return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '--';
    }
    document.getElementById('sidebar-name').textContent = user.name;
    document.getElementById('sidebar-avatar').textContent = initials(user.name);

    // Load documents
    await loadDocuments();
    await loadMembers();

    // Auto-open a specific document if the page was navigated to with ?doc=<id>
    const targetId = new URLSearchParams(window.location.search).get('doc');
    if (targetId) {
        const target = documents.find(d => d.documentId === targetId);
        if (target) openDetail(target);
    }

    // Sidebar toggle
    const sidebar = document.querySelector('.sidebar');
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }
    document.getElementById('logo-toggle').addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    });

    // Search (title/format/ID locally + content via server)
    document.getElementById('search-input').addEventListener('input', (e) => {
        mainQuery = e.target.value.trim().toLowerCase();
        applyFilters();
        fetchContentSearch(mainQuery);
    });

    // Filter tabs (All / Active / Completed)
    document.getElementById('filter-tabs').addEventListener('click', (e) => {
        const tab = e.target.closest('.filter-tab');
        if (!tab) return;
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.toggle('active', t === tab));
        activeFilter = tab.dataset.filter;
        applyFilters();
    });

    // Sortable headers
    initSortableHeaders();

    // Detail modal wiring
    document.getElementById('detail-close').addEventListener('click', closeDetail);
    document.getElementById('detail-cancel').addEventListener('click', closeDetail);
    detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) closeDetail();
    });
    document.getElementById('detail-save').addEventListener('click', saveDetail);
    detailTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (btn) switchTab(btn.dataset.tab);
    });
    document.getElementById('detail-add-members').addEventListener('click', () => {
        detailMembersPicker.hidden = !detailMembersPicker.hidden;
        renderDetailPicker();
    });
});