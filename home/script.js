// Documents data - loaded from the server
let documents = [];
let workspaceSig = '';
let contentSig = '';

// UI elements
let els = {};

// Avatar gradient pool
const avatarColors = [
    "linear-gradient(135deg, #667eea, #764ba2)",
    "linear-gradient(135deg, #f093fb, #f5576c)",
    "linear-gradient(135deg, #4facfe, #00f2fe)",
    "linear-gradient(135deg, #43e97b, #38f9d7)",
    "linear-gradient(135deg, #fa709a, #fee140)",
    "linear-gradient(135deg, #a18cd1, #fbc2eb)"
];

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

const getAvatarColor = (index) => avatarColors[index % avatarColors.length];

function lastEditedOf(doc) {
    return doc.updatedAt || doc.date || doc.createdAt || '';
}

/**
 * Build a table row element from a document object.
 * Uses textContent for values to avoid the need for escaping,
 * keeping data clean and dynamic (no hardcoded markup).
 */
function buildRow(doc, index) {
    const tr = document.createElement('tr');
    tr.dataset.status = doc.status;

    // Document name cell
    const nameCell = document.createElement('td');
    nameCell.dataset.label = 'Document';
    const nameWrap = document.createElement('div');
    nameWrap.className = 'doc-name-cell';
    const icon = document.createElement('div');
    icon.className = `doc-icon ${doc.type}`;
    icon.textContent = doc.type === 'pdf' ? 'PDF' : 'DOC';
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

    // Type cell
    const typeCell = document.createElement('td');
    typeCell.dataset.label = 'Type';
    typeCell.textContent = doc.category;

    // User cell
    const userCell = document.createElement('td');
    userCell.dataset.label = 'User Name';
    const userWrap = document.createElement('div');
    userWrap.className = 'user-cell';
    const avatar = document.createElement('div');
    avatar.className = 'user-cell-avatar';
    avatar.style.background = getAvatarColor(index);
    avatar.textContent = doc.user.avatar;
    const userName = document.createElement('span');
    userName.textContent = doc.user.name;
    userWrap.append(avatar, userName);
    userCell.appendChild(userWrap);

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
    badge.className = `status-badge ${doc.status}`;
    badge.textContent = doc.status.charAt(0).toUpperCase() + doc.status.slice(1);
    statusCell.appendChild(badge);

    // Last edited cell
    const updatedCell = document.createElement('td');
    updatedCell.dataset.label = 'Last Edited';
    updatedCell.className = 'updated-cell';
    updatedCell.textContent = timeAgo(lastEditedOf(doc));

    tr.append(nameCell, typeCell, userCell, idCell, statusCell, updatedCell, buildActions(doc));
    tr.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) return;
        clearTimeout(clickTimeout);
        clickTimeout = setTimeout(() => openContent(doc), 180);
    });
    return tr;
}

// Three-dot actions menu cell
function buildActions(doc) {
    const cell = document.createElement('td');
    cell.className = 'actions-cell';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-menu-btn';
    btn.setAttribute('aria-label', 'Actions for ' + doc.title);
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
    openItem.addEventListener('click', (e) => { e.stopPropagation(); closeRowMenus(); openContent(doc); });

    const renameItem = item('Rename', '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>');
    renameItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeRowMenus();
        const val = await showPrompt({ title: 'Rename document', message: 'Give this document a new name.', value: doc.title, submitText: 'Rename' });
        if (!val) return;
        await updateDoc(doc.documentId, { title: val });
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
        const okRes = await updateDoc(doc.documentId, { status: next });
        if (okRes) showToast('Marked "' + doc.title + '" ' + next + '.', 'success');
    });

    const removeItem = item('Remove', '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', true);
    removeItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeRowMenus();
        const yes = await showConfirm({ title: 'Remove document', message: 'Remove the document "' + doc.title + '"? This cannot be undone.', confirmText: 'Remove' });
        if (yes) {
            const res = await fetch('/api/documents/' + doc.documentId, { method: 'DELETE' });
            const d = await res.json();
            if (d.ok) {
                showToast('Removed "' + doc.title + '".', 'success');
                await loadDocuments();
            } else {
                showToast(d.error || 'Could not remove.', 'error');
            }
        }
    });

    menu.append(openItem, renameItem, duplicateItem, copyItem, statusItem, removeItem);

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

// PUT a document's updated field, then refresh the list
async function updateDoc(docId, body) {
    try {
        const res = await fetch('/api/documents/' + docId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const d = await res.json();
        if (d.ok) {
            await loadDocuments();
            return d.document;
        }
        showToast(d.error || 'Could not update the document.', 'error');
        return null;
    } catch (e) {
        showToast('Could not reach the server.', 'error');
        return null;
    }
}

// Load the user's recent documents from the server, then refresh the view
async function loadDocuments() {
    try {
        const res = await fetch('/api/documents');
        const data = await res.json();
        if (data.ok) {
            documents = data.documents;
            workspaceSig = sigOf(documents);
            contentSig = sigOf(documents);
            setConnection('Connected', 'ok');
            scheduleRefresh();
        }
        if (!documents.length) return showState(els.stateEmpty);
        renderTabs();
        els.tabBar.querySelector('.tab[data-key]')?.click();
        fitTabCounts();
        updateSortIndicators();
        applyFilters();
        updateStats();
    } catch (e) {
        renderDocuments(documents);
    }
}

// Summary cards (auto-updating widgets)
function updateStats() {
    const total = documents.length;
    let active = 0, completed = 0;
    documents.forEach(d => {
        if (d.status === 'active') active++;
        else if (d.status === 'completed') completed++;
    });
    const el = id => document.getElementById(id);
    if (el('stat-total')) el('stat-total').textContent = total;
    if (el('stat-active')) el('stat-active').textContent = active;
    if (el('stat-completed')) el('stat-completed').textContent = completed;
}

// Open a document's content (tabs workspace) — single tap / click
function openContent(doc) {
    window.location.href = '../data fields/index.html?doc=' + encodeURIComponent(doc.documentId);
}

// Open the detail sheet on the Documents page
function openDoc(doc) {
    window.location.href = '../documents/index.html?doc=' + encodeURIComponent(doc.documentId);
}

function renderEmptyState(msg) {
    const tbody = document.getElementById('documents-body');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'empty-state';
    const wrap = document.createElement('div');
    wrap.className = 'empty-wrap';
    const p = document.createElement('p');
    p.textContent = msg || 'No documents found';
    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'empty-create-btn';
    createBtn.textContent = '+ Create a document';
    createBtn.addEventListener('click', () => {
        window.location.href = '../fields/index.html';
    });
    wrap.append(p, createBtn);
    td.appendChild(wrap);
    tr.appendChild(td);
    tbody.appendChild(tr);
}

function renderDocuments(list) {
    const tbody = document.getElementById('documents-body');
    tbody.innerHTML = '';

    if (!list.length) {
        const noDocs = documents.length === 0;
        renderEmptyState(noDocs ? 'No documents yet — create your first one.' : 'No documents match your filter.');
        return;
    }

    list.forEach((doc, index) => tbody.appendChild(buildRow(doc, index)));
}

// ---------- Search (title / owner / ID locally, content via server) ----------
let globalHits = [];

function searchDocumentsLocally(q) {
    if (!q) return documents;
    return documents.filter(doc =>
        (doc.title || '').toLowerCase().includes(q) ||
        (doc.user.name || '').toLowerCase().includes(q) ||
        (doc.type || '').toLowerCase().includes(q) ||
        (doc.category || '').toLowerCase().includes(q) ||
        (doc.documentId || '').toLowerCase().includes(q) ||
        (doc.status || '').toLowerCase().includes(q)
    );
}

let searchTimer = null;
function runSearch() {
    const q = mainQuery;
    let local = searchDocumentsLocally(q);
    // Append content matches from the server (dedup), don't lose local hits
    const seen = new Set(local.map(d => d.documentId));
    for (const h of globalHits) {
        if (!seen.has(h.documentId)) {
            const full = documents.find(d => d.documentId === h.documentId);
            if (full) {
                local = local.concat([{ match: h, ...full }]);
                seen.add(h.documentId);
            }
        }
    }
    renderDocuments(local);
}

async function fetchContentSearch(q) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
        if (!q) { globalHits = []; runSearch(); return; }
        try {
            const res = await fetch('/api/search?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (data.ok) {
                globalHits = data.results.filter(r => r.matchedIn === 'content');
                runSearch();
            }
        } catch (e) { /* ignore */ }
    }, 350);
}

// ---------- Filter tabs ----------
let activeFilter = 'all';

function applyFilters() {
    let result = searchDocumentsLocally(mainQuery);

    if (activeFilter !== 'all') {
        result = result.filter(doc => doc.status === activeFilter);
    }

    // Apply sorting
    if (sortKey) {
        const dir = sortAsc ? 1 : -1;
        result.sort((a, b) => {
            let av, bv;
            if (sortKey === 'title') { av = (a.title || '').toLowerCase(); bv = (b.title || '').toLowerCase(); }
            else if (sortKey === 'category') { av = (a.category || a.type || '').toLowerCase(); bv = (b.category || b.type || '').toLowerCase(); }
            else if (sortKey === 'user') { av = (a.user.name || '').toLowerCase(); bv = (b.user.name || '').toLowerCase(); }
            else if (sortKey === 'id') { av = (a.documentId || '').toLowerCase(); bv = (b.documentId || '').toLowerCase(); }
            else if (sortKey === 'status') { av = (a.status || '').toLowerCase(); bv = (b.status || '').toLowerCase(); }
            else if (sortKey === 'updated') { av = (lastEditedOf(a) || ''); bv = (lastEditedOf(b) || ''); if (av === bv) return 0; }
            if (sortKey === 'updated') return av < bv ? dir : (av > bv ? -dir : 0);
            return av < bv ? -dir : (av > bv ? dir : 0);
        });
    }

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
            let label = f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Completed';
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
            if (sortKey === key) {
                sortAsc = !sortAsc;
            } else {
                sortKey = key;
                sortAsc = key === 'updated';
            }
            updateSortIndicators();
            applyFilters();
        };
        th.addEventListener('click', onSort);
        th.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(); }
        });
    });
}

// Real-time refresh functionality
let refreshTimer = null;
const REFRESH_INTERVAL = 30000; // 30 seconds

function sigOf(data) {
    if (!data || !Array.isArray(data)) return '';
    // Create a signature based on document IDs and their last edited times
    const sorted = [...data].sort((a, b) => (a.documentId || '').localeCompare(b.documentId || ''));
    return sorted.map(doc => `${doc.documentId || ''}:${doc.updatedAt || doc.date || doc.createdAt || ''}`).join('|');
}

function scheduleRefresh() {
    stopRefresh(); // Clear any existing timer
    refreshTimer = setInterval(async () => {
        await quietRefresh();
    }, REFRESH_INTERVAL);
}

async function quietRefresh() {
    try {
        const res = await fetch('/api/documents');
        const data = await res.json();
        if (data.ok && data.documents) {
            const newSig = sigOf(data.documents);
            if (newSig !== workspaceSig) {
                // Content has changed, do a full refresh
                await pollContent();
            }
        }
    } catch (err) {
        // Silently fail for quiet refresh
        console.warn('Quiet refresh failed:', err);
    }
}

async function pollContent() {
    try {
        const res = await fetch('/api/documents');
        const data = await res.json();
        if (data.ok && data.documents) {
            documents = data.documents;
            workspaceSig = sigOf(documents);
            // Update UI without full reload if possible
            fitTabCounts();
            updateSortIndicators();
            applyFilters();
            updateStats();
            renderDocuments(documents);
            showToast('Content updated', 'ok');
        }
    } catch (err) {
        showToast('Failed to update content: ' + err.message, 'error');
    }
}

function stopRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

function setConnection(text, status) {
    // Update connection status indicator
    // For now, we'll just log it since we don't have a specific UI element for this
    // In a real implementation, this would update a connection status badge or indicator
    console.log(`Connection: ${text} (${status})`);
}

function showState(element) {
    // Show a state element in the documents table body
    const tbody = document.getElementById('documents-body');
    tbody.innerHTML = '';
    tbody.appendChild(element);
}

// ---------- Search ----------
let mainQuery = '';
let clickTimeout = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Auth guard: only logged-in users may view the dashboard
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

    // Show the real logged-in user in the sidebar
    function initials(name) {
        return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '--';
    }
    document.getElementById('sidebar-name').textContent = user.name;
    document.getElementById('sidebar-avatar').textContent = initials(user.name);

    // Cache DOM elements
    els = {
        stateEmpty: document.createElement('div'),
        tabBar: document.getElementById('filter-tabs')
    };
    els.stateEmpty.className = 'empty-state';
    els.stateEmpty.innerHTML = `
        <div class="empty-wrap">
            <p>No documents yet — create your first one.</p>
            <button type="button" class="empty-create-btn">+ Create a document</button>
        </div>
    `;
    els.stateEmpty.querySelector('.empty-create-btn').addEventListener('click', () => {
        window.location.href = '../fields/index.html';
    });

    await loadDocuments();

    async function loadBackupStatus() {
        try {
            const res = await fetch('/api/backups');
            const data = await res.json();
            if (data.ok) {
                const el = document.getElementById('stat-backup');
                if (el) {
                    const last = data.lastBackupAt || (data.backups && data.backups[0] && data.backups[0].time) || null;
                    el.textContent = last ? timeAgo(last) : '—';
                }
            }
        } catch (e) { /* ignore */ }
    }
    loadBackupStatus();

    // Sidebar toggle (click on logo) + persist state across pages
    const sidebar = document.querySelector('.sidebar');
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }

    document.getElementById('logo-toggle').addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    });

    // Filter tabs
    document.getElementById('filter-tabs').addEventListener('click', (e) => {
        const tab = e.target.closest('.filter-tab');
        if (!tab) return;
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.toggle('active', t === tab));
        activeFilter = tab.dataset.filter;
        applyFilters();
    });

    // Create document
    document.getElementById('create-doc-btn').addEventListener('click', () => {
        window.location.href = '../fields/index.html';
    });

    // Secondary search: local + content search on the server
    document.getElementById('search-input').addEventListener('input', (e) => {
        mainQuery = e.target.value.trim().toLowerCase();
        applyFilters();
        fetchContentSearch(mainQuery);
    });

    // Sortable headers
    initSortableHeaders();
});