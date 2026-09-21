// Data Fields page - shows a single document's extracted fields
// in the exact order they were stored (matching the source document).

const formatDate = (dateString) => {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const FORMAT_STYLES = {
    'Excel':      ['#e7f9ee', '#0e9f4e'],
    'Word':       ['#e8f0fe', '#2563eb'],
    'PDF':        ['#fee2e2', '#dc2626'],
    'PowerPoint': ['#fef3c7', '#d97706'],
    'Text':       ['#f3f4f6', '#4b5563'],
    'Other':      ['#f5f3ff', '#8b5cf6']
};

const fmtBadge = (format) => {
    const f = format || 'Other';
    const [bg, fg] = FORMAT_STYLES[f] || FORMAT_STYLES['Other'];
    const el = document.createElement('span');
    el.className = 'fmt-badge';
    el.style.background = bg;
    el.style.color = fg;
    el.textContent = f;
    return el;
};

const iconType = (doc) => {
    const t = String(doc.type || '').toLowerCase();
    if (/pdf/.test(t)) return 'pdf';
    if (/word|doc/.test(t)) return 'word';
    if (/ppt/.test(t)) return 'ppt';
    if (/excel|xls|csv/.test(t)) return 'excel';
    if (/txt|text/.test(t)) return 'text';
    return 'other';
};

const iconLabel = (doc) => {
    const t = iconType(doc);
    return t === 'pdf' ? 'PDF'
        : t === 'word' ? 'DOC'
        : t === 'ppt' ? 'PPT'
        : t === 'excel' ? 'XLS'
        : 'FILE';
};

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text == null ? '' : text;
}

// ---------- Auto-date helpers (Phase C) ----------
const DATE_COL_RE = /date|fecha|datum/i;
let dateColumns = [];        // column indices whose header looks like a date
let autoDateOn = true;   // auto-date is a permanent feature - always on

function todayString() {
    const d = new Date();
    const pd = (n) => String(n).padStart(2, '0');
    return pd(d.getDate()) + '-' + pd(d.getMonth() + 1) + '-' + d.getFullYear();
}

function excelSerialToDate(serial) {
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
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

function recomputeDateColumns() {
    dateColumns = [];
    if (!dataRows || !dataRows[0]) return;
    (dataRows[0] || []).forEach((h, c) => {
        if (DATE_COL_RE.test(String(h == null ? '' : h))) dateColumns.push(c);
    });
}

function normalizeDateInput(s) {
    if (s == null) return s;
    const t = String(s).trim();
    if (!t) return '';
    if (/^(today|now)$/i.test(t)) return todayString();
    const pd = (n) => String(n).padStart(2, '0');
    let m = /^(\d{1,4})[-\/.]([0-9]{1,2})[-\/.]([0-9]{1,4})$/.exec(t);
    if (m) {
        const a = +m[1], b = +m[2], c3 = +m[3];
        if (m[1].length === 4 || a > 999) {
            if (b >= 1 && b <= 12 && c3 >= 1 && c3 <= 31) return pd(c3) + '-' + pd(b) + '-' + a;
        } else {
            let day = a, mon = b;
            if (mon > 12) { const t2 = day; day = mon; mon = t2; }
            let year = c3;
            if (year < 100) year += 2000;
            if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return pd(day) + '-' + pd(mon) + '-' + year;
        }
    }
    if (/^\d{4,7}$/.test(t)) {
        const n = +t;
        if (n >= 25569 && n <= 2958465) {
            const d = new Date((n - 25569) * 86400000);
            return pd(d.getUTCDate()) + '-' + pd(d.getUTCMonth() + 1) + '-' + d.getUTCFullYear();
        }
    }
    return s;
}

function renderDocument(doc) {
    const meta = document.getElementById('doc-meta');
    if (meta) meta.hidden = false;

    const icon = document.getElementById('meta-icon');
    if (icon) {
        icon.className = 'doc-icon ' + iconType(doc);
        icon.textContent = iconLabel(doc);
    }

    setText('meta-title', doc.title || 'Untitled');
    setText('meta-id', doc.documentId || '');
    setText('meta-file', doc.fileName || '—');
    setText('meta-count', String((doc.fields && doc.fields.length) || 0));
    setText('meta-creator', doc.user ? doc.user.name : '—');
    setText('meta-created', formatDate(doc.date));

    const statusEl = document.getElementById('meta-status');
    if (statusEl) {
        const st = doc.status || 'active';
        statusEl.textContent = st.charAt(0).toUpperCase() + st.slice(1);
        statusEl.className = 'status-badge ' + (st === 'completed' ? 'completed' : 'active');
    }

    const fmtWrap = document.getElementById('meta-format');
    if (fmtWrap) {
        fmtWrap.innerHTML = '';
        fmtWrap.appendChild(fmtBadge(doc.format));
    }

    renderTabs(doc.documentId);
    hideTabPicker();
    loadFileContent(doc);
}

// ---------- Document tabs (multi-document workspace) ----------
const TABS_KEY = 'vcpl_openTabs';
let openTabs = [];
let docsCache = [];

function tabTitleFor(id) {
    const d = docsCache.find(x => x.documentId === id);
    return d ? d.title : 'Untitled';
}

function loadOpenTabs() {
    try { openTabs = JSON.parse(localStorage.getItem(TABS_KEY) || '[]'); } catch (e) { openTabs = []; }
    if (!Array.isArray(openTabs)) openTabs = [];
}

function saveOpenTabs() {
    openTabs = openTabs.slice(0, 12);
    try { localStorage.setItem(TABS_KEY, JSON.stringify(openTabs)); } catch (e) { /* ignore */ }
}

function addTab(id, title) {
    if (!openTabs.some(t => t.documentId === id)) {
        openTabs.push({ documentId: id, title: title || tabTitleFor(id) });
        saveOpenTabs();
    }
}

function removeTabAt(idx) {
    const removed = openTabs[idx];
    openTabs.splice(idx, 1);
    saveOpenTabs();
    return removed;
}

function renderTabs(activeId) {
    const strip = document.getElementById('doc-tabs');
    const scroll = document.getElementById('doc-tabs-scroll');
    if (!strip || !scroll) return;
    scroll.innerHTML = '';
    if (!openTabs.length) { strip.hidden = true; return; }
    strip.hidden = false;
    openTabs.forEach((t, i) => {
        const chip = document.createElement('div');
        chip.className = 'doc-tab' + (t.documentId === activeId ? ' active' : '');
        chip.title = t.title || 'Untitled';
        chip.setAttribute('role', 'tab');
        chip.setAttribute('aria-selected', t.documentId === activeId ? 'true' : 'false');
        const title = document.createElement('span');
        title.className = 'doc-tab-title';
        title.textContent = t.title || 'Untitled';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'doc-tab-close';
        close.textContent = '×';
        close.setAttribute('aria-label', 'Close tab');
        close.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(i);
        });
        chip.addEventListener('click', () => activateTab(t.documentId));
        chip.append(title, close);
        scroll.appendChild(chip);
    });
    if (!openTabs.some(t => t.documentId === activeId)) {
        const last = scroll.querySelector('.doc-tab:last-child');
        if (last) last.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
}

function activateTab(id) {
    const doc = docsCache.find(d => d.documentId === id);
    if (!doc) return;
    document.title = (doc.title || 'Document') + ' - Data Fields';
    renderDocument(doc);
    try { history.replaceState(null, '', '?doc=' + encodeURIComponent(doc.documentId)); } catch (e) { /* ignore */ }
}

function closeTab(idx) {
    const removed = removeTabAt(idx);
    const wasActive = fileDoc && fileDoc.documentId === removed.documentId;
    if (wasActive) {
        closeWs();
        if (openTabs.length) {
            const prev = openTabs[Math.min(Math.max(idx - 1, 0), openTabs.length - 1)];
            activateTab(prev.documentId);
        } else {
            renderTabs(null);
            renderPlaceholder();
        }
    } else {
        renderTabs(fileDoc ? fileDoc.documentId : null);
    }
}

function renderTabPicker() {
    const pane = document.getElementById('doc-tabs-picker-pane');
    const list = document.getElementById('doc-tabs-picker-list');
    if (!pane || !list) return;
    list.innerHTML = '';
    const available = docsCache.filter(d => !openTabs.some(t => t.documentId === d.documentId));
    if (!available.length) {
        const p = document.createElement('p');
        p.className = 'empty-state';
        p.style.padding = '14px';
        p.textContent = 'No more documents to open.';
        list.appendChild(p);
        return;
    }
    available.forEach((d) => {
        const label = document.createElement('div');
        label.className = 'picker-item';
        label.style.cursor = 'pointer';
        const av = document.createElement('span');
        av.className = 'picker-avatar';
        av.textContent = (d.format === 'Excel' ? 'X' : d.format === 'Word' ? 'W' : d.format === 'PDF' ? 'P' : 'F');
        const name = document.createElement('span');
        name.className = 'picker-name';
        name.textContent = d.title;
        const email = document.createElement('span');
        email.className = 'picker-email';
        email.textContent = d.documentId;
        label.append(av, name, email);
        label.addEventListener('click', () => {
            addTab(d.documentId, d.title);
            activateTab(d.documentId);
        });
        list.appendChild(label);
    });
    pane.hidden = false;
}

function hideTabPicker() {
    const pane = document.getElementById('doc-tabs-picker-pane');
    if (pane) pane.hidden = true;
}

function initTabs() {
    loadOpenTabs();
    const addBtn = document.getElementById('doc-tabs-add');
    if (addBtn) {
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pane = document.getElementById('doc-tabs-picker-pane');
            if (pane && !pane.hidden) { hideTabPicker(); return; }
            renderTabPicker();
        });
    }
    document.addEventListener('click', (e) => {
        const pane = document.getElementById('doc-tabs-picker-pane');
        if (!pane || pane.hidden) return;
        const addBtnEl = document.getElementById('doc-tabs-add');
        if (!e.target.closest('#doc-tabs-picker-pane') && !(addBtnEl && addBtnEl.contains(e.target))) {
            hideTabPicker();
        }
    });
}

function renderPlaceholder() {
    renderTabs(null);
    hideTabPicker();
    const meta = document.getElementById('doc-meta');
    if (meta) meta.hidden = true;

    const download = document.getElementById('download-btn');
    if (download) download.hidden = true;

    const dev = document.getElementById('device-connect');
    if (dev) dev.hidden = true;

    showToolbar(false);
    showSearchBar(false);

    const area = document.getElementById('file-content-area');
    if (area) area.hidden = false;

    const wrap = document.getElementById('file-content-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    const box = document.createElement('div');
    box.className = 'placeholder-box';
    box.style.padding = '48px 20px';
    const msg = document.createElement('p');
    msg.textContent = 'No document selected.';
    const hint = document.createElement('p');
    hint.className = 'placeholder-hint';
    hint.textContent = 'Double-click a document on the Documents page to open its data fields here, or go to the Documents page and pick one.';
    const link = document.createElement('a');
    link.href = '../documents/index.html';
    link.className = 'create-btn';
    link.textContent = 'Go to Documents';
    box.append(msg, hint, link);
    wrap.appendChild(box);
}

// ---------- Real file contents editor ----------
let fileDoc = null;
let dataRows = null;       // 2D array including the header row (index 0)
let dataText = null;       // raw text for TXT previews
let contentKind = null;    // 'rows' | 'text' | null
let editMode = false;
let selection = null;      // { type: 'row'|'column'|'cell', r, col }
let selectedMultiRows = new Set();
let truncatedWarning = false;  // true if the file had more rows than the API returned
let totalRowsInFile = 0;       // actual row count in the stored file

function setDownload(doc) {
    const btn = document.getElementById('download-btn');
    if (!btn) return;
    btn.hidden = false;
    btn.href = '/api/documents/' + doc.documentId + '/file';
}

function showToolbar(show) {
    const tb = document.getElementById('file-toolbar');
    if (tb) tb.hidden = !show;
}

function setModifyBtn() {
    const b = document.getElementById('btn-modify');
    if (!b) return;
    b.textContent = editMode ? 'Done Editing' : 'Modify';
    b.classList.toggle('active', editMode);
}

function commitInputs() {
    if (!dataRows) return;
    document.querySelectorAll('#file-content-wrap .cell-input').forEach(inp => {
        const r = +inp.dataset.row;
        const c = +inp.dataset.col;
        if (dataRows[r]) dataRows[r][c] = inp.value;
    });
}

// ---------- Selection ----------
function clearSelectionUI() {
    const wrap = document.getElementById('file-content-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('.selected-row, .selected-cell, th.selected').forEach(el => {
        el.classList.remove('selected-row', 'selected-cell', 'selected');
    });
}

function applySelectionUI() {
    const wrap = document.getElementById('file-content-wrap');
    if (!wrap || !selection) return;
    if (selection.type === 'row') {
        const tr = wrap.querySelector('tr[data-r="' + selection.r + '"]');
        if (tr) tr.classList.add('selected-row');
    } else if (selection.type === 'column') {
        const th = wrap.querySelector('th[data-col="' + selection.col + '"]');
        if (th) th.classList.add('selected');
    } else if (selection.type === 'cell') {
        const td = wrap.querySelector('td[data-r="' + selection.r + '"][data-col="' + selection.col + '"]');
        if (td) td.classList.add('selected-cell');
    }
}

function selectRow(r) { selection = { type: 'row', r: r }; clearSelectionUI(); applySelectionUI(); }
function selectColumn(col) { selection = { type: 'column', col: col }; clearSelectionUI(); applySelectionUI(); }
function selectCell(r, col) {
    selection = { type: 'cell', r: r, col: col };
    clearSelectionUI();
    applySelectionUI();
}

// ---------- Rendering ----------
const PAGE_SIZE = 200;
let page = 0;
let searchQuery = '';
let searchRows = null;   // array of matching data-row indices, or null (show all rows)
let searchSample = null; // Set of 'r:c' matched cell keys
let searchCols = null;   // Set of matched column indices (header contains query)

function visibleRowCount() {
    if (!dataRows) return 0;
    if (searchRows) return searchRows.length;
    return dataRows.length - 1;
}

function totalPages() {
    return Math.max(1, Math.ceil(visibleRowCount() / PAGE_SIZE));
}

function clampPage() {
    const tp = totalPages();
    if (page >= tp) page = Math.max(tp - 1, 0);
    if (page < 0) page = 0;
}

function renderPager() {
    const pager = document.getElementById('file-pager');
    if (!pager) return;
    const total = visibleRowCount();
    const tp = totalPages();
    const show = contentKind === 'rows' && tp > 1;
    pager.hidden = !show;
    if (!show) return;
    clampPage();
    const from = page * PAGE_SIZE + 1;
    const to = Math.min((page + 1) * PAGE_SIZE, total);
    const info = document.getElementById('page-info');
    const prev = document.getElementById('page-prev');
    const next = document.getElementById('page-next');
    if (info) info.textContent = (searchQuery ? 'Match ' : 'Row ') + from + (to > from ? '–' + to : '') + ' of ' + total + '  ·  Page ' + (page + 1) + '/' + tp;
    if (prev) prev.disabled = page <= 0;
    if (next) next.disabled = page >= tp - 1;
}

function renderDataTable() {
    const wrap = document.getElementById('file-content-wrap');
    if (!wrap) return;
    clampPage();
    wrap.innerHTML = '';

    if (!dataRows || !dataRows.length) {
        const p = document.createElement('p');
        p.className = 'empty-state';
        p.textContent = 'This spreadsheet is empty.';
        p.style.padding = '40px 20px';
        wrap.appendChild(p);
        renderPager();
        return;
    }

    const isSearch = !!searchQuery;
    const width = dataRows.reduce((m, r) => Math.max(m, r.length), 0);
    const table = document.createElement('table');
    table.className = 'real-data-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const chkHead = document.createElement('th');
    chkHead.className = 'corner';
    chkHead.style.textAlign = 'center';
    const chkAllInput = document.createElement('input');
    chkAllInput.type = 'checkbox';
    chkAllInput.id = 'chk-all-rows';
    chkAllInput.title = 'Select all rows on this page';
    chkAllInput.addEventListener('change', (e) => {
        const checked = e.target.checked;
        const checkboxes = tbody.querySelectorAll('.row-chk');
        checkboxes.forEach(cb => {
            cb.checked = checked;
            const r = parseInt(cb.dataset.row);
            if (checked) selectedMultiRows.add(r);
            else selectedMultiRows.delete(r);
            const tr = cb.closest('tr');
            if (tr) tr.classList.toggle('multi-selected', checked);
        });
    });
    chkHead.appendChild(chkAllInput);
    headRow.appendChild(chkHead);
    const corner = document.createElement('th');
    corner.className = 'corner';
    corner.textContent = '#';
    headRow.appendChild(corner);

    for (let c = 0; c < width; c++) {
        const th = document.createElement('th');
        th.dataset.col = c;
        if (searchCols && searchCols.has(c)) th.classList.add('search-col');
        if (editMode) {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'cell-input head-input';
            inp.value = dataRows[0][c] != null ? String(dataRows[0][c]) : '';
            inp.dataset.row = 0;
            inp.dataset.col = c;
inp.addEventListener('change', () => {
                    if (dataRows[0]) {
                        dataRows[0][c] = inp.value;
                        const wasDate = dateColumns.includes(c);
                        recomputeDateColumns();
                        if (autoDateOn && !wasDate && dateColumns.includes(c)) {
                            const t = todayString();
                            for (let r = 1; r < dataRows.length; r++) {
                                if (dataRows[r][c] == null || dataRows[r][c] === '') dataRows[r][c] = t;
                            }
                            renderDataTable();
                        }
                        sendOp({ t: 'header', c: c, v: dataRows[0][c] });
                    }
                });
            inp.addEventListener('input', () => {
                if (dataRows[0]) { dataRows[0][c] = inp.value; scheduleAutosave(); }
            });
            inp.addEventListener('focus', pushUndo);
            inp.addEventListener('click', (e) => { e.stopPropagation(); selectColumn(c); });
            th.appendChild(inp);
        } else {
            th.textContent = dataRows[0][c] != null && dataRows[0][c] !== '' ? String(dataRows[0][c]) : ('Column ' + (c + 1));
            th.title = 'Select column';
            th.addEventListener('click', () => selectColumn(c));
        }
        headRow.appendChild(th);
    }

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const rowPool = isSearch ? searchRows : null;
    const totalRows = rowPool ? rowPool.length : dataRows.length - 1;
    const startData = page * PAGE_SIZE;
    const endData = Math.min(startData + PAGE_SIZE, totalRows);

    if (totalRows === 0) {
        const p = document.createElement('p');
        p.className = 'empty-state';
        p.textContent = isSearch ? 'No rows match "' + searchQuery + '".' : 'This spreadsheet has no data rows.';
        p.style.padding = '40px 20px';
        wrap.appendChild(p);
        renderPager();
        return;
    }

    for (let d = startData; d < endData; d++) {
        const r = rowPool ? rowPool[d] : (d + 1);
        const row = dataRows[r];
        const tr = document.createElement('tr');
        tr.dataset.r = r;

        const chkCell = document.createElement('td');
        chkCell.style.textAlign = 'center';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'row-chk';
        chk.dataset.row = r;
        chk.checked = selectedMultiRows.has(r);
        chk.addEventListener('change', (e) => {
            if (e.target.checked) selectedMultiRows.add(r);
            else selectedMultiRows.delete(r);
            tr.classList.toggle('multi-selected', e.target.checked);
            const boxes = tbody.querySelectorAll('.row-chk');
            const total = boxes.length;
            const sel = tbody.querySelectorAll('.row-chk:checked').length;
            chkAllInput.checked = total > 0 && sel === total;
            chkAllInput.indeterminate = sel > 0 && sel < total;
        });
        chkCell.appendChild(chk);
        tr.appendChild(chkCell);
        tr.classList.toggle('multi-selected', selectedMultiRows.has(r));

        const numTd = document.createElement('td');
        numTd.className = 'row-num';
        numTd.textContent = String(r + 1);
        numTd.title = 'Select row';
        numTd.addEventListener('click', () => selectRow(r));
        tr.appendChild(numTd);

        for (let c = 0; c < width; c++) {
            const td = document.createElement('td');
            td.dataset.r = r;
            td.dataset.col = c;
            if (searchSample && searchSample.has(r + ':' + c)) td.classList.add('search-hit');
            if (editMode) {
                const inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'cell-input';
                inp.value = row[c] == null ? '' : String(row[c]);
                inp.dataset.row = r;
                inp.dataset.col = c;
                inp.addEventListener('change', () => {
                    row[c] = (autoDateOn && dateColumns.includes(c)) ? normalizeDateInput(inp.value) : inp.value;
                });
                inp.addEventListener('input', () => {
                    row[c] = (autoDateOn && dateColumns.includes(c)) ? normalizeDateInput(inp.value) : inp.value;
                    scheduleAutosave();
                    sendOp({ t: 'cell', r: r, c: c, v: row[c] });
                });
                inp.addEventListener('focus', pushUndo);
                inp.addEventListener('click', (e) => { e.stopPropagation(); selectCell(r, c); });
                td.appendChild(inp);
            } else {
                td.textContent = row[c] == null ? '' : String(row[c]);
                td.title = 'Select cell';
                td.addEventListener('click', () => selectCell(r, c));
            }
            tr.appendChild(td);
        }

        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    applySelectionUI();
    renderPager();
}

function renderDataText() {
    const wrap = document.getElementById('file-content-wrap');
    if (!wrap) return;
    const pager = document.getElementById('file-pager');
    if (pager) pager.hidden = true;
    wrap.innerHTML = '';

    const pre = document.createElement('pre');
    pre.className = 'file-text';
    pre.textContent = dataText || '(empty file)';
    if (editMode) {
        pre.setAttribute('contenteditable', 'true');
        pre.classList.add('editing');
        pre.addEventListener('input', () => { dataText = pre.textContent; scheduleAutosave(); sendOp({ t: 'text', v: dataText }); });
    }
    wrap.appendChild(pre);
}

// ---------- Search ----------
function clearSearch() {
    const input = document.getElementById('file-search-input');
    if (input) input.value = '';
    const count = document.getElementById('file-search-count');
    if (count) count.textContent = '';
    searchQuery = '';
    searchRows = null;
    searchSample = null;
    searchCols = null;
    page = 0;
    renderDataTable();
}

function runSearch() {
    const input = document.getElementById('file-search-input');
    const count = document.getElementById('file-search-count');
    if (!input) return;
    const query = input.value.trim().toLowerCase();
    searchQuery = query;

    if (!query || !dataRows) {
        searchRows = null;
        searchSample = null;
        searchCols = null;
        page = 0;
        if (count) count.textContent = '';
        renderDataTable();
        return;
    }

    const terms = query.split('/').map(t => t.trim()).filter(t => t.length > 0);
    const width = dataRows.reduce((m, r) => Math.max(m, r.length), 0);
    const rowHits = [];
    const cellHits = new Set();
    const colHits = new Set();

    for (let c = 0; c < width; c++) {
        const header = dataRows[0] && dataRows[0][c] != null ? String(dataRows[0][c]).toLowerCase() : '';
        if (terms.some(t => header.includes(t))) colHits.add(c);
    }

    for (let r = 1; r < dataRows.length; r++) {
        const row = dataRows[r] || [];
        const anyMatch = (t) => {
            for (let c = 0; c < width; c++) {
                const v = row[c] == null ? '' : String(row[c]).toLowerCase();
                if (v.includes(t)) {
                    cellHits.add(r + ':' + c);
                    return true;
                }
            }
            return false;
        };
        if (terms.every(anyMatch)) rowHits.push(r);
    }

    searchRows = rowHits;
    searchSample = cellHits;
    searchCols = colHits;
    page = 0;

    if (count) {
        let msg = rowHits.length + ' matching row(s)';
        if (colHits.size) msg += ' · ' + colHits.size + ' matching column(s)';
        count.textContent = msg;
    }
    renderDataTable();
}

function showSearchBar(show) {
    const bar = document.getElementById('file-search-bar');
    if (bar) bar.hidden = !show;
}

// ---------- Calendar export ----------
let exportMode = 'range';

function openExportPanel() {
    if (!fileDoc) return;
    const panel = document.getElementById('export-panel');
    if (panel) panel.hidden = false;

    const now = new Date();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const from = new Date(now.getFullYear(), now.getMonth(), 1);

    const fmt = (d) => {
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return d.getFullYear() + '-' + m + '-' + dd;
    };
    const fromEl = document.getElementById('exp-from');
    const toEl = document.getElementById('exp-to');
    const monthEl = document.getElementById('exp-month');
    const yearEl = document.getElementById('exp-year');
    const dayEl = document.getElementById('exp-day');
    if (fromEl && !fromEl.value) fromEl.value = fmt(from);
    if (toEl && !toEl.value) toEl.value = fmt(to);
    if (monthEl && !monthEl.value) monthEl.value = from.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    if (yearEl && !yearEl.value) yearEl.value = String(now.getFullYear());
    if (dayEl && !dayEl.value) dayEl.value = fmt(to);
}

function setExportMode(mode) {
    exportMode = mode;
    const tabs = document.querySelectorAll('.exp-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    const fields = document.querySelectorAll('.exp-fields');
    fields.forEach(f => { f.hidden = f.dataset.f !== mode; });
    const zone = document.getElementById('exp-preview');
    if (zone) zone.hidden = true;
}

function buildPeriodParams() {
    const q = new URLSearchParams();
    q.set('mode', exportMode);
    if (exportMode === 'range') {
        q.set('from', document.getElementById('exp-from').value);
        q.set('to', document.getElementById('exp-to').value);
    } else if (exportMode === 'month') {
        q.set('month', document.getElementById('exp-month').value);
    } else if (exportMode === 'year') {
        q.set('year', document.getElementById('exp-year').value.trim());
    } else if (exportMode === 'day') {
        q.set('day', document.getElementById('exp-day').value);
    }
    return q;
}

function validatePeriodParams(q) {
    if (exportMode === 'range') {
        if (!q.get('from') || !q.get('to')) return 'Please pick a From and To date.';
    } else if (exportMode === 'month') {
        if (!q.get('month')) return 'Please pick a month.';
    } else if (exportMode === 'year') {
        if (!/^\d{4}$/.test(q.get('year') || '')) return 'Please enter a 4-digit year.';
    } else if (exportMode === 'day') {
        if (!q.get('day')) return 'Please pick a day.';
    }
    return null;
}

function runPeriodExport() {
    const msg = document.getElementById('exp-msg');
    if (msg) msg.textContent = '';

    if (!fileDoc) return;
    const wantChanges = document.getElementById('exp-scope-changes').checked;
    const wantRows = document.getElementById('exp-scope-rows').checked;
    if (!wantChanges && !wantRows) {
        if (msg) msg.textContent = 'Tick at least one: Change report or File rows by date.';
        return;
    }

    const q = buildPeriodParams();
    const err = validatePeriodParams(q);
    if (err) { if (msg) msg.textContent = err; return; }
    q.set('format', document.getElementById('exp-format').value);
    q.set('scope', wantChanges && wantRows ? 'both' : wantChanges ? 'changes' : 'rows');

    const url = '/api/documents/' + fileDoc.documentId + '/export/period?' + q.toString();
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();

    const panel = document.getElementById('export-panel');
    if (panel) panel.hidden = true;
}

async function runPeriodPreview() {
    const msg = document.getElementById('exp-msg');
    if (msg) msg.textContent = '';
    if (!fileDoc) return;

    const q = buildPeriodParams();
    const err = validatePeriodParams(q);
    if (err) { if (msg) msg.textContent = err; return; }
    q.set('format', 'json');
    q.set('scope', 'rows');

    const zone = document.getElementById('exp-preview');
    if (!zone) return;
    zone.hidden = false;
    zone.innerHTML = '<p class="loading-state">Previewing…</p>';

    try {
        const res = await fetch('/api/documents/' + fileDoc.documentId + '/export/period?' + q.toString());
        const d = await res.json();
        if (!d.ok) { if (msg) msg.textContent = d.error || 'Preview failed.'; return; }
        renderCalendarPreview(d, q.get('month'));
    } catch (e) {
        if (msg) msg.textContent = 'Could not reach the server.';
    }
}

function renderCalendarPreview(d, monthStr) {
    const zone = document.getElementById('exp-preview');
    if (!zone) return;

    if (!d.rows || !d.rows.hasDateColumn) {
        zone.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'empty-state';
        p.textContent = d && d.rows && d.rows.totalRows
            ? 'No date column was detected. Type dates such as 01-01-2026 into a column (or rename a header with "Date"), then preview again.'
            : 'This file has no data rows to preview.';
        zone.appendChild(p);
        return;
    }

    const matched = (d.rows.rows || []).slice(1);
    const header = (d.rows.rows || [])[0] || [];
    const dateCols = d.rows.dateColumns || [];
    const from = new Date(d.period.from);

    const wrap = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'exp-preview-summary';
    const colName = header[dateCols[0]] != null && header[dateCols[0]] !== ''
        ? '"' + header[dateCols[0]] + '"'
        : 'Column ' + ((dateCols[0] || 0) + 1);
    head.textContent = 'Date column detected from ' + (d.rows.dateDetected === 'content' ? 'values' : 'header names')
        + ' (' + colName + '): ' + matched.length + ' of ' + d.rows.totalRows + ' row(s) match this period.';
    wrap.appendChild(head);

    if (exportMode === 'month') {
        const counts = {};
        const details = {};
        matched.forEach(row => {
            const dayD = dateCols.map(c => parseDateValue(row[c])).find(x => x);
            if (!dayD) return;
            const key = dayD.getFullYear() + '-' + dayD.getMonth() + '-' + dayD.getDate();
            counts[key] = (counts[key] || 0) + 1;
            (details[key] = details[key] || []).push(row);
        });

        const grid = document.createElement('div');
        grid.className = 'cal-grid';
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(n => {
            const h = document.createElement('div');
            h.className = 'cal-cell cal-head';
            h.textContent = n;
            grid.appendChild(h);
        });
        const cur = new Date(from.getFullYear(), from.getMonth(), 1);
        for (let i = 0; i < cur.getDay(); i++) {
            const e = document.createElement('div');
            e.className = 'cal-cell cal-empty';
            grid.appendChild(e);
        }
        const daysInMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const cell = document.createElement('div');
            cell.className = 'cal-cell';
            const num = document.createElement('div');
            num.className = 'cal-day';
            num.textContent = day;
            cell.appendChild(num);
            const key = from.getFullYear() + '-' + from.getMonth() + '-' + day;
            const n = counts[key] || 0;
            if (n) {
                const badge = document.createElement('div');
                badge.className = 'cal-badge';
                badge.textContent = n + (n === 1 ? ' row' : ' rows');
                badge.title = (details[key] || []).map(r => (r || []).slice(0, 6).join('  ·  ')).slice(0, 4).join('\n');
                cell.appendChild(badge);
            }
            grid.appendChild(cell);
        }
        wrap.appendChild(grid);
    } else {
        const note = document.createElement('div');
        note.className = 'exp-preview-summary';
        note.textContent = matched.length ? 'Matching rows (showing first 20):' : 'No rows fall inside this period.';
        wrap.appendChild(note);
        matched.slice(0, 20).forEach(row => {
            const line = document.createElement('div');
            line.className = 'exp-preview-row';
            line.textContent = (row || []).map(v => String(v == null ? '' : v)).join('  |  ');
            wrap.appendChild(line);
        });
    }

    zone.innerHTML = '';
    zone.appendChild(wrap);
}

// ---------- Actions ----------
function toggleEdit() {
    if (contentKind === 'rows' && !dataRows) return;
    if (contentKind === 'text' && dataText == null) return;
    commitInputs();
    editMode = !editMode;
    setModifyBtn();
    if (contentKind === 'rows') renderDataTable();
    else renderDataText();
}

function doRemove() {
    if (!dataRows) return;
    commitInputs();
    
    if (selectedMultiRows.size > 0) {
        pushUndo();
        // Remove rows in descending order so indices don't shift!
        const rowsToRemove = Array.from(selectedMultiRows).sort((a, b) => b - a);
        let headerRemoved = false;
        rowsToRemove.forEach(r => {
            if (r > 0) {
                dataRows.splice(r, 1);
            } else {
                headerRemoved = true;
            }
        });
        
        sendOp({ t: 'fullrows', rows: dataRows }); 
        selectedMultiRows.clear();
        selection = null;
        recomputeDateColumns();
        if (searchQuery) { runSearch(); } else renderDataTable();
        scheduleAutosave();
        
        if (headerRemoved) {
            showToast('The header row cannot be removed. Other selected rows were removed.', 'info');
        }
        return;
    }

    if (!selection) {
        showToast('Select rows using checkboxes, or click a single row/column/cell first.', 'error');
        return;
    }

    if (selection.type === 'row') {
        if (selection.r <= 0) { showToast('The header row cannot be removed.', 'error'); return; }
        pushUndo();
        dataRows.splice(selection.r, 1);
        sendOp({ t: 'remove', what: 'row', r: selection.r });
    } else if (selection.type === 'column') {
        const c = selection.col;
        pushUndo();
        dataRows = dataRows.map(row => (row || []).filter((_, j) => j !== c));
        sendOp({ t: 'remove', what: 'column', c: c });
    } else {
        if (dataRows[selection.r]) { pushUndo(); dataRows[selection.r][selection.col] = ''; sendOp({ t: 'cell', r: selection.r, c: selection.col, v: '' }); }
    }

    selection = null;
    recomputeDateColumns();
    if (searchQuery) { runSearch(); }
    else renderDataTable();
    scheduleAutosave();
}

function doAdd(action) {
    if (!dataRows) return;
    commitInputs();
    recomputeDateColumns();
    const width = dataRows.reduce((m, r) => Math.max(m, r.length), 0);
    const afterRow = selection && (selection.type === 'row' || selection.type === 'cell') ? selection.r : dataRows.length;
    const afterCol = selection && selection.type === 'column' ? selection.col : (width - 1);
    pushUndo();
    mutateAdd(action, { r: afterRow, c: afterCol });
    sendOp({ t: 'add', action: action, r: afterRow, c: afterCol });
    selection = null;
    if (searchQuery) { runSearch(); }
    else renderDataTable();
    scheduleAutosave();
}

async function saveContent(silent) {
    if (!fileDoc) return { ok: false };
    if (truncatedWarning) {
        if (!silent) showToast('This file has more rows than the editor supports (' + totalRowsInFile + '). Saving would delete the remaining rows, so Save is disabled. Download the original and edit it in Excel instead.', 'error');
        return { ok: false, error: 'truncated' };
    }
    commitInputs();

    if (contentKind === 'rows' && !dataRows) return { ok: false };
    if (contentKind === 'text' && dataText == null) return { ok: false };

    const payload = contentKind === 'rows' ? { rows: dataRows } : { text: dataText };
    const btn = document.getElementById('btn-save');
    if (!silent && btn) {
        btn.disabled = true;
        btn.textContent = 'Saving…';
    }

    try {
        const res = await fetch('/api/documents/' + fileDoc.documentId + '/content', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const d = await res.json();
        if (!d.ok) {
            if (silent) setSaveStatus(d.error || 'Save failed.', true);
            else showToast(d.error || 'Could not save.', 'error');
            return { ok: false };
        }
        setSaveStatus(d.connectedWarning || 'Saved');
        if (!silent && d.connectedWarning) showToast(d.connectedWarning, 'error');
        else if (!silent) showToast('Saved.', 'success');
        return { ok: true };
    } catch (e) {
        if (silent) setSaveStatus('Could not reach the server.', true);
        else showToast('Could not reach the server.', 'error');
        return { ok: false };
    } finally {
        if (!silent && btn) {
            btn.disabled = false;
            btn.textContent = 'Save';
        }
    }
}

// ---------- Debounced autosave ----------
let autosaveTimer = null;

function setSaveStatus(msg, isError) {
    const el = document.getElementById('autosave-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
    el.classList.toggle('ok', !isError && !!msg);
    clearTimeout(el._t);
    if (!isError && msg) {
        el._t = setTimeout(() => { el.textContent = ''; el.classList.remove('ok'); }, 4000);
    }
}

let _toastTimer = null;
function showToast(msg, type) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'toast' + (type ? ' ' + type : '');
    el.hidden = false;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

function scheduleAutosave() {
    if (truncatedWarning || !fileDoc) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { saveContent(true); }, 1000);
}

// ---------- Real-time collaboration ----------
let _ws = null, _wsReconnectTimer = null, _wsReconnectDelay = 1000, _wsDocId = null, _wsSelfEmail = null;

function connectWs(docId) {
    closeWs();
    if (!docId) return;
    _wsDocId = docId;
    _wsReconnectDelay = 1000;

    try {
        const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
        _ws = new WebSocket(proto + location.host + '/ws?doc=' + encodeURIComponent(docId));
        _ws.onopen = () => {
            _wsReconnectDelay = 1000;
            refreshCollabStatus(null, 'Connecting…');
            try { _ws.send(JSON.stringify({ t: 'get-presence' })); } catch (e) { /* ignore */ }
        };
        _ws.onmessage = (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (msg.t === 'op' && msg.op) applyRemoteOp(msg.op, msg.from);
            else if (msg.t === 'presence') {
                const others = (msg.users || []).filter(u => u.email !== _wsSelfEmail);
                refreshCollabStatus(others);
            }
        };
        _ws.onclose = () => {
            refreshCollabStatus(null, 'Disconnected');
            if (_wsDocId) {
                clearTimeout(_wsReconnectTimer);
                _wsReconnectTimer = setTimeout(() => {
                    if (_wsDocId && document.visibilityState !== 'hidden') connectWs(_wsDocId);
                }, _wsReconnectDelay);
                _wsReconnectDelay = Math.min(_wsReconnectDelay * 2, 30000);
            }
        };
        _ws.onerror = () => {};
    } catch (e) {
        refreshCollabStatus(null, 'WS failed');
    }
}

function closeWs() {
    clearTimeout(_wsReconnectTimer);
    _wsReconnectTimer = null;
    if (_ws) { try { _ws.close(); } catch (e) {} _ws = null; }
    _wsDocId = null;
    refreshCollabStatus(null, '');
}

function sendOp(op) {
    if (_ws && _ws.readyState === 1) {
        try { _ws.send(JSON.stringify({ t: 'op', op: op })); } catch (e) {}
    }
}

function applyRemoteOp(op, from) {
    if (!dataRows && op.t !== 'presence') return;
    let changed = false;
    if (op.t === 'cell') {
        if (dataRows[op.r] != null && op.c != null && op.c >= 0) { dataRows[op.r][op.c] = op.v != null ? String(op.v) : ''; changed = true; }
    } else if (op.t === 'header') {
        if (dataRows && dataRows[0] && op.c != null && op.c >= 0) { dataRows[0][op.c] = op.v != null ? String(op.v) : ''; recomputeDateColumns(); changed = true; }
    } else if (op.t === 'add') {
        mutateAdd(op.action, { r: op.r, c: op.c });
        changed = true;
    } else if (op.t === 'remove') {
        if (op.what === 'row' && op.r > 0) { dataRows.splice(op.r, 1); changed = true; }
        else if (op.what === 'column' && op.c != null) { dataRows = dataRows.map(row => (row || []).filter((_, j) => j !== op.c)); changed = true; }
    } else if (op.t === 'text') {
        if (contentKind === 'text') dataText = op.v;
    } else if (op.t === 'fullrows') {
        if (contentKind === 'rows' && Array.isArray(op.rows)) {
            dataRows = op.rows.map(r => (Array.isArray(r) ? r : []).slice());
            recomputeDateColumns();
            changed = true;
        }
    }
    if (changed) {
        if (searchQuery) runSearch(); else renderDataTable();
    }
    // show a brief notification
    if (from && from.name) showCollabToast(from.name);
}

function mutateAdd(action, opts) {
    if (!dataRows) return;
    const width = dataRows.reduce((m, r) => Math.max(m, r.length), 0);
    const afterRow = opts && opts.r != null ? opts.r : (selection && (selection.type === 'row' || selection.type === 'cell') ? selection.r : dataRows.length);
    const afterCol = opts && opts.c != null ? opts.c : (selection && selection.type === 'column' ? selection.col : (width - 1));

    if (action === 'row') {
        const newRow = Array(width).fill('');
        if (autoDateOn) { const t = todayString(); dateColumns.forEach(c => { if (c >= 0 && c < width) newRow[c] = t; }); }
        dataRows.splice(afterRow + 1, 0, newRow);
    } else if (action === 'column') {
        dataRows = dataRows.map(row => { row.splice(afterCol + 1, 0, ''); return row; });
        recomputeDateColumns();
        if (autoDateOn && dateColumns.includes(afterCol + 1)) { const t = todayString(); for (let r = 1; r < dataRows.length; r++) { if (!dataRows[r][afterCol + 1]) dataRows[r][afterCol + 1] = t; } }
    } else if (action === 'box') {
        const r = opts && opts.r != null ? opts.r : (selection ? selection.r : Math.max(dataRows.length - 1, 0));
        if (dataRows[r]) dataRows[r].push('');
    } else if (action === 'copy-row') {
        const r = opts && opts.r != null ? opts.r : (selection && (selection.type === 'row' || selection.type === 'cell') ? selection.r : 1);
        if (r >= 1 && dataRows[r]) { const rowCopy = dataRows[r].slice(); if (autoDateOn) { const t = todayString(); dateColumns.forEach(c => { if (c >= 0 && c < rowCopy.length) rowCopy[c] = t; }); } dataRows.splice(r + 1, 0, rowCopy); }
    } else if (action === 'copy-column') {
        const src = opts && opts.c != null ? opts.c : (selection && (selection.type === 'column' || selection.type === 'cell') ? selection.col : 0);
        dataRows = dataRows.map(row => { const v = row[src] != null ? row[src] : ''; row.splice(src + 1, 0, v); return row; });
        recomputeDateColumns();
    }
}

let _collabToastTimer = null;
function showCollabToast(name) {
    const el = document.getElementById('collab-status');
    if (!el) return;
    clearTimeout(_collabToastTimer);
    el.textContent = name + ' editing…';
    el.classList.add('collab-active');
    _collabToastTimer = setTimeout(() => { el.classList.remove('collab-active'); }, 2000);
}
function refreshCollabStatus(others, noteText) {
    const el = document.getElementById('collab-status');
    if (!el) return;
    if (noteText != null && noteText !== '') { el.textContent = noteText; el.classList.remove('collab-active'); return; }
    if (!others || !others.length) { el.textContent = 'Only you'; el.classList.remove('collab-active'); return; }
    el.textContent = others.length + ' other' + (others.length > 1 ? 's' : '') + ' editing';
    el.classList.remove('collab-active');
}

// ---------- Undo ----------
let undoStack = [];
const UNDO_MAX = 50;

function pushUndo() {
    if (contentKind !== 'rows' || !dataRows) return;
    undoStack.push(JSON.stringify(dataRows));
    if (undoStack.length > UNDO_MAX) undoStack.shift();
}

function doUndo() {
    if (contentKind !== 'rows' || !dataRows) return;
    if (!undoStack.length) { setSaveStatus('Nothing to undo yet.', true); return; }
    dataRows = JSON.parse(undoStack.pop());
    recomputeDateColumns();
    if (searchQuery) runSearch(); else renderDataTable();
    sendOp({ t: 'fullrows', rows: dataRows });
    scheduleAutosave();
    setSaveStatus('Undone');
}

// ---------- Version history ----------
async function openHistory() {
    const panel = document.getElementById('history-panel');
    const list = document.getElementById('history-list');
    const msg = document.getElementById('history-msg');
    if (!panel || !fileDoc) return;
    panel.hidden = false;
    list.innerHTML = '';
    if (msg) msg.textContent = 'Loading…';
    try {
        const res = await fetch('/api/documents/' + fileDoc.documentId + '/history');
        const d = await res.json();
        if (!d.ok || !Array.isArray(d.history)) {
            if (msg) msg.textContent = (d && d.error) || 'Could not load history.';
            return;
        }
        if (msg) msg.textContent = d.history.length ? '' : 'No saved versions yet — save changes to create versions.';
        d.history.forEach((e) => {
            const item = document.createElement('div');
            item.className = 'history-item';
            const body = document.createElement('div');
            body.className = 'hibody';
            const s = document.createElement('div');
            s.className = 'hisummary';
            s.textContent = (e.summary || 'Saved') + (e.action === 'rows' ? '' : '');
            const who = document.createElement('div');
            who.className = 'hiwho';
            who.textContent = (e.user || '?') + ' editing';
            const ts = document.createElement('div');
            ts.className = 'hits';
            ts.textContent = new Date(e.ts).toLocaleString();
            body.appendChild(s); body.appendChild(who); body.appendChild(ts);
            item.appendChild(body);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tb-btn';
            btn.textContent = 'Restore';
            btn.addEventListener('click', () => restoreVersion(e));
            item.appendChild(btn);
            list.appendChild(item);
        });
    } catch (err) {
        if (msg) msg.textContent = 'Could not reach the server.';
    }
}

async function restoreVersion(e) {
    if (!confirm('Restore the file to the version from ' + new Date(e.ts).toLocaleString() + '?\nThis replaces the current content.')) return;
    const btn = document.getElementById('btn-history');
    if (btn) { btn.disabled = true; }
    try {
        const res = await fetch('/api/documents/' + fileDoc.documentId + '/history/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ts: e.ts })
        });
        const d = await res.json();
        if (!d.ok) {
            showToast(d.error || 'Could not restore.', 'error');
            return;
        }
        if (d.connectedWarning) showToast(d.connectedWarning, 'error');
        pushUndo();
        await loadFileContent(fileDoc);
        setSaveStatus('Restored previous version');
        openHistory();
    } catch (err) {
        showToast('Could not reach the server.', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ---------- Device file connection ----------
let devicePollTimer = null;
let deviceLastMtime = null;
let DEVICE_POLL_MS = 15000;

async function connectDeviceFile(path) {
    if (!fileDoc) return;
    const status = document.getElementById('device-status');
    if (status) { status.textContent = 'Connecting…'; status.classList.remove('error'); }
    try {
        const res = await fetch('/api/documents/' + fileDoc.documentId + '/source', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path })
        });
        const d = await res.json();
        if (!d.ok) {
            if (status) { status.textContent = d.error || 'Could not connect.'; status.classList.add('error'); }
            return;
        }
        fileDoc.connectedPath = d.connectedPath;
        renderDeviceConnection(fileDoc);
        if (status) status.textContent = d.connectedPath ? 'Connected. Saves now update the real file too.' : 'Disconnected.';
        if (d.connectedPath) startDevicePolling();
    } catch (e) {
        if (status) { status.textContent = 'Could not reach the server.'; status.classList.add('error'); }
    }
}

function stopDevicePolling() {
    clearInterval(devicePollTimer);
    devicePollTimer = null;
    deviceLastMtime = null;
}

function startDevicePolling() {
    clearInterval(devicePollTimer);
    deviceLastMtime = null;
    if (!fileDoc || !fileDoc.connectedPath) return;
    const auto = document.getElementById('device-auto-refresh');
    if (auto && !auto.checked) return;
    fetch('/api/documents/' + fileDoc.documentId + '/source/status')
        .then(r => r.json())
        .then(d => {
            if (d && d.ok) deviceLastMtime = (d.baselineMtime != null ? d.baselineMtime : d.mtimeMs);
        })
        .catch(() => {});
    devicePollTimer = setInterval(async () => {
        if (!fileDoc || !fileDoc.connectedPath || (auto && !auto.checked)) { stopDevicePolling(); return; }
        try {
            const res = await fetch('/api/documents/' + fileDoc.documentId + '/source/status');
            const d = await res.json();
            if (!d.ok || !d.connectedPath || d.exists === false) return;
            if (deviceLastMtime != null && d.mtimeMs != null && d.mtimeMs !== deviceLastMtime) {
                const dirty = !!document.getElementById('autosave-status') &&
                    /saving|saved/.test(document.getElementById('autosave-status').textContent) &&
                    document.getElementById('autosave-status').textContent.toLowerCase().indexOf('saved') === -1;
                if (!dirty && !editMode) {
                    showToast('Device file changed — reloading latest copy.', 'info');
                    reloadDeviceCopy();
                } else {
                    showToast('Device file changed on disk — Save to keep your edits.', 'info');
                }
            }
            deviceLastMtime = d.mtimeMs;
        } catch (e) { /* server unreachable */ }
    }, DEVICE_POLL_MS);
}

function reloadDeviceCopy() {
    const docId = fileDoc ? fileDoc.documentId : null;
    if (!docId) return;
    (async () => {
        try {
            await fetch('/api/documents/' + docId + '/source/sync', { method: 'POST' });
        } catch (e) { /* ignore */ }
        closeWs();
        loadFileContent(fileDoc);
    })();
}

function renderDeviceConnection(doc) {
    const wrap = document.getElementById('device-connect');
    if (!wrap) return;
    const path = doc && doc.connectedPath;
    const input = document.getElementById('device-path');
    const conn = document.getElementById('btn-connect');
    const disc = document.getElementById('btn-disconnect');
    const status = document.getElementById('device-status');

    const connected = !!path;

    if (input) {
        input.value = connected ? path : '';
        input.disabled = connected;
    }
    if (conn) conn.hidden = connected;
    if (disc) disc.hidden = !connected;
    if (status) { status.textContent = ''; status.classList.remove('error'); }
}

function resetContent() {
    if (!fileDoc) return;
    editMode = false;
    setModifyBtn();
    selection = null;
    loadFileContent(fileDoc);
}

// ---------- Loading ----------
async function loadFileContent(doc) {
    fileDoc = doc;
    closeWs();
    stopDevicePolling();
    connectWs(doc.documentId);
    fetch('/api/session').then(r => r.json()).then(d => { if (d && d.ok) _wsSelfEmail = d.user.email; }).catch(() => {});
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    editMode = false;
    setModifyBtn();
    selection = null;
    dataRows = null;
    dataText = null;
    contentKind = null;
    truncatedWarning = false;
    totalRowsInFile = 0;
    dateColumns = [];
    page = 0;
    searchQuery = '';
    searchRows = null;
    searchSample = null;
    searchCols = null;
    showToolbar(false);
    showSearchBar(false);

    const searchInputBox = document.getElementById('file-search-input');
    if (searchInputBox) searchInputBox.value = '';

    const area = document.getElementById('file-content-area');
    const wrap = document.getElementById('file-content-wrap');
    const note = document.getElementById('file-content-note');
    setDownload(doc);
    if (!area || !wrap || !note) return;

    wrap.innerHTML = '';
    const loading = document.createElement('p');
    loading.className = 'loading-state';
    loading.textContent = 'Loading contents…';
    wrap.appendChild(loading);
    area.hidden = false;
    note.textContent = '';

    try {
        const res = await fetch('/api/documents/' + doc.documentId + '/content');
        const data = await res.json();
        if (!data.ok) { area.hidden = true; return; }

        if (!data.hasFile) {
            const dev = document.getElementById('device-connect');
            if (dev) dev.hidden = true;
            note.textContent = '';
            wrap.innerHTML = '';
            const p = document.createElement('p');
            p.className = 'empty-state';
            p.textContent = 'No file was stored for this document. Re-upload it from the Fields page to view its real contents.';
            p.style.padding = '40px 20px';
            wrap.appendChild(p);
            return;
        }

        area.hidden = false;

        const dc = document.getElementById('device-connect');
        if (dc) {
            dc.hidden = false;
            fileDoc.connectedPath = data.connectedPath || null;
            renderDeviceConnection(fileDoc);
            if (fileDoc.connectedPath) startDevicePolling();
        }

if (data.rows && data.rows.length) {
            contentKind = 'rows';
            dataRows = data.rows.map(r => r.slice());
            truncatedWarning = !!data.truncated;
            totalRowsInFile = data.totalRows || data.rows.length;
            recomputeDateColumns();
            const sheet = (data.sheetNames && data.sheetNames.length) ? ' · Sheet: ' + data.sheetNames[0] : '';
            note.textContent = 'From ' + (data.fileName || 'file') + sheet + ' — ' + data.rows.length + ' row(s). Select a row (row number), column (header), or cell, then use Modify / Remove / Add.';
            if (truncatedWarning) {
                note.textContent += ' WARNING: file has ' + totalRowsInFile + ' rows total; only the first are shown and Save is disabled to avoid data loss.';
            }
            showToolbar(true);
            showSearchBar(true);
            renderDataTable();
        } else if (data.text != null) {
            contentKind = 'text';
            dataText = data.text;
            note.textContent = 'Raw contents of ' + (data.fileName || 'file') + '. Use Modify to edit, then Save.';
            showToolbar(true);
            showSearchBar(false);
            renderDataText();
        } else {
            const devErr = document.getElementById('device-connect');
            if (devErr) devErr.hidden = true;
            note.textContent = data.parseError || 'This file format cannot be previewed inline, but you can download the original below.';
            wrap.innerHTML = '';
        }
    } catch (e) {
        area.hidden = true;
        showToolbar(false);
    }
}

function initEditorControls() {
    const modify = document.getElementById('btn-modify');
    const remove = document.getElementById('btn-remove');
    const add = document.getElementById('btn-add');
    const menu = document.getElementById('add-menu');
    const save = document.getElementById('btn-save');
    const reset = document.getElementById('btn-reset');

    if (modify) modify.addEventListener('click', toggleEdit);
    if (remove) remove.addEventListener('click', doRemove);

    if (add && menu) {
        add.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.hidden = !menu.hidden;
        });
        document.addEventListener('click', () => { menu.hidden = true; });
        menu.querySelectorAll('.add-item').forEach(item => {
            item.addEventListener('click', () => {
                doAdd(item.dataset.act);
                menu.hidden = true;
            });
        });
    }

    if (save) save.addEventListener('click', saveContent);
    if (reset) reset.addEventListener('click', resetContent);

    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.addEventListener('click', () => { commitInputs(); doUndo(); });

    const histBtn = document.getElementById('btn-history');
    const histClose = document.getElementById('btn-history-close');
    const histPanel = document.getElementById('history-panel');
    if (histBtn) histBtn.addEventListener('click', () => { commitInputs(); openHistory(); });
    if (histClose) histClose.addEventListener('click', () => { if (histPanel) histPanel.hidden = true; });
    if (histPanel) histPanel.addEventListener('click', (e) => { if (e.target === histPanel) histPanel.hidden = true; });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'z') {
            e.preventDefault();
            commitInputs();
            doUndo();
        } else if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
            e.preventDefault();
            saveContent(false);
        } else if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'e') {
            e.preventDefault();
            toggleEdit();
        } else if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'f') {
            const si = document.getElementById('file-search-input');
            if (si && !document.getElementById('file-search-bar').hidden) {
                e.preventDefault();
                si.focus();
                si.select();
            }
        } else if (e.key === 'Escape') {
            const exp = document.getElementById('export-panel');
            if (exp && !exp.hidden) exp.hidden = true;
            const hist = document.getElementById('history-panel');
            if (hist && !hist.hidden) hist.hidden = true;
        }
    });

    const exportBtn = document.getElementById('btn-export');
    if (exportBtn) exportBtn.addEventListener('click', openExportPanel);

    const cancelBtn = document.getElementById('btn-export-cancel');
    const runBtn = document.getElementById('btn-export-run');
    const panel = document.getElementById('export-panel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { if (panel) panel.hidden = true; });
    if (runBtn) runBtn.addEventListener('click', runPeriodExport);
    const previewBtn = document.getElementById('btn-export-preview');
    if (previewBtn) previewBtn.addEventListener('click', runPeriodPreview);
    if (panel) panel.addEventListener('click', (e) => { if (e.target === panel) panel.hidden = true; });
    document.querySelectorAll('.exp-tab').forEach(tab => {
        tab.addEventListener('click', () => setExportMode(tab.dataset.mode));
    });

    const connBtn = document.getElementById('btn-connect');
    const discBtn = document.getElementById('btn-disconnect');
    if (connBtn) {
        connBtn.addEventListener('click', () => {
            const input = document.getElementById('device-path');
            connectDeviceFile(input ? input.value.trim() : '');
        });
    }
    if (discBtn) {
        discBtn.addEventListener('click', () => {
            stopDevicePolling();
            connectDeviceFile('');
        });
    }

    const prevPage = document.getElementById('page-prev');
    const nextPage = document.getElementById('page-next');
    if (prevPage) prevPage.addEventListener('click', () => { if (page > 0) { commitInputs(); page--; renderDataTable(); } });
    if (nextPage) nextPage.addEventListener('click', () => { if (page < totalPages() - 1) { commitInputs(); page++; renderDataTable(); } });

    const searchInput = document.getElementById('file-search-input');
    const searchClear = document.getElementById('file-search-clear');
    if (searchInput) {
        searchInput.addEventListener('input', runSearch);
        searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearSearch(); });
    }
    if (searchClear) searchClear.addEventListener('click', clearSearch);
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
    setText('sidebar-name', user.name);
    setText('sidebar-avatar', initials(user.name));

    const sidebar = document.querySelector('.sidebar');
    if (sidebar && localStorage.getItem('sidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }
    const logo = document.getElementById('logo-toggle');
    if (sidebar && logo) {
        logo.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
        });
    }

    // Locate the document that was opened
    initEditorControls();
    initTabs();

    const targetId = new URLSearchParams(window.location.search).get('doc');

    try {
        const res = await fetch('/api/documents');
        const data = await res.json();
        if (data.ok && Array.isArray(data.documents)) {
            docsCache = data.documents;
        }
    } catch (e) { /* server unreachable */ }

    if (targetId) {
        const doc = docsCache.find(d => d.documentId === targetId);
        if (doc) {
            addTab(doc.documentId, doc.title);
            document.title = (doc.title || 'Document') + ' - Data Fields';
            renderDocument(doc);
            return;
        }
    }

    if (openTabs.length) {
        const last = openTabs[openTabs.length - 1];
        const doc = docsCache.find(d => d.documentId === last.documentId);
        if (doc) {
            document.title = (doc.title || 'Document') + ' - Data Fields';
            renderDocument(doc);
            return;
        }
        openTabs = [];
        saveOpenTabs();
    }

    renderPlaceholder();
});