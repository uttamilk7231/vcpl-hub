let members = [];
let selectedMembers = [];
let currentFormat = null;
let currentFile = null;

const avatarColors = [
    "linear-gradient(135deg, #667eea, #764ba2)",
    "linear-gradient(135deg, #f093fb, #f5576c)",
    "linear-gradient(135deg, #4facfe, #00f2fe)",
    "linear-gradient(135deg, #43e97b, #38f9d7)",
    "linear-gradient(135deg, #fa709a, #fee140)",
    "linear-gradient(135deg, #a18cd1, #fbc2eb)"
];

const getAvatarColor = (index) => avatarColors[index % avatarColors.length];

// ---------- Format auto-detection ----------
const FORMATS = {
    xlsx:  { label: 'Excel', color: '#16a34a', key: 'excel' },
    xls:   { label: 'Excel', color: '#16a34a', key: 'excel' },
    csv:   { label: 'Excel', color: '#16a34a', key: 'csv' },
    docx:  { label: 'Word',  color: '#2563eb', key: 'word' },
    doc:   { label: 'Word',  color: '#2563eb', key: 'word' },
    pdf:   { label: 'PDF',   color: '#dc2626', key: 'pdf' },
    txt:   { label: 'Text',  color: '#6b7280', key: 'csv' },
    pptx:  { label: 'PowerPoint', color: '#f59e0b', key: 'ppt' },
    ppt:   { label: 'PowerPoint', color: '#f59e0b', key: 'ppt' }
};

function detectFormat(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    return FORMATS[ext] || { label: 'Other', color: '#8b5cf6', key: 'other' };
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
}

const initialsOf = (name) =>
    String(name).trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '--';

// ---------- Preview (format visual) ----------
function buildPreview(key, fileName, sizeText) {
    const container = document.getElementById('file-preview');
    container.innerHTML = '';
    container.hidden = false;

    const wrap = document.createElement('div');
    wrap.className = 'preview-wrap';

    const visual = document.createElement('div');
    visual.className = 'preview-visual';

    if (key === 'excel') {
        const grid = document.createElement('div');
        grid.className = 'grid-preview';
        for (let r = 0; r < 4; r++) {
            const row = document.createElement('div');
            row.className = 'grid-row';
            for (let c = 0; c < 5; c++) {
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                if (r === 0) cell.classList.add('head');
                else if (r === 1 && c === 0) cell.classList.add('accent');
                row.appendChild(cell);
            }
            grid.appendChild(row);
        }
        visual.appendChild(grid);
    } else if (key === 'word') {
        const page = document.createElement('div');
        page.className = 'page-mock';
        const bar = document.createElement('div');
        bar.className = 'page-bar';
        const lines = [72, 86, 58, 78, 46];
        page.appendChild(bar);
        lines.forEach(w => {
            const l = document.createElement('div');
            l.className = 'page-line';
            l.style.width = w + '%';
            page.appendChild(l);
        });
        visual.appendChild(page);
    } else if (key === 'pdf') {
        const page = document.createElement('div');
        page.className = 'page-mock pdf';
        const lines = [70, 84, 60, 74, 48];
        lines.forEach(w => {
            const l = document.createElement('div');
            l.className = 'page-line';
            l.style.width = w + '%';
            page.appendChild(l);
        });
        visual.appendChild(page);
    } else if (key === 'csv') {
        const linesEl = document.createElement('div');
        linesEl.className = 'text-preview';
        linesEl.textContent = 'name,units,price\nwidget,25,£10\n';
        visual.appendChild(linesEl);
    } else {
        const generic = document.createElement('div');
        generic.className = 'generic-page';
        visual.appendChild(generic);
    }

    const meta = document.createElement('div');
    meta.className = 'preview-meta';
    const name = document.createElement('span');
    name.className = 'preview-name';
    name.textContent = fileName;
    const size = document.createElement('span');
    size.className = 'preview-size';
    size.textContent = sizeText;
    meta.append(name, size);

    wrap.append(visual, meta);
    container.appendChild(wrap);
}

// Pick the field separator that gives the most columns (comma / tab / semicolon).
function pickSeparator(line) {
    let best = ',', bestN = 0;
    for (const s of [',', '\t', ';']) {
        const n = line.split(s).length;
        if (n > bestN) { bestN = n; best = s; }
    }
    return best;
}

// ---------- Field extraction ----------
// Real column headings detected in the uploaded file are tagged with `col:true`
// so the server knows which fields are the table's columns (vs. plain metadata).
async function extractFields(file, fmt) {
    const fields = [
        { name: 'File Name', value: file.name },
        { name: 'Format', value: fmt.label },
        { name: 'File Size', value: formatSize(file.size) }
    ];

    if (fmt.key === 'csv') {
        try {
            const text = await file.text();
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const sep = pickSeparator(lines[0] || '');
            const cells = (line) => line.split(sep).map(s => s.trim().replace(/^"|"$/g, ''));
            // Auto field analysis: find the first row holding 2+ columns and treat
            // it as the heading row (skips title lines like "STock Report").
            let hi = -1;
            for (let i = 0; i < Math.min(lines.length, 50); i++) {
                const c = cells(lines[i]);
                if (c.filter(v => v !== '').length >= 2) { hi = i; break; }
            }
            if (hi >= 0) {
                const headers = cells(lines[hi]);
                const values = lines[hi + 1] ? cells(lines[hi + 1]) : [];
                headers.forEach((h, i) => {
                    fields.push({ name: h || ('Column ' + (i + 1)), value: values[i] || '', col: true });
                });
                if (hi + 1 < lines.length) {
                    fields.push({ name: 'Total Rows', value: String(lines.length - 1 - hi) });
                }
            } else {
                lines.slice(0, 8).forEach((l, i) => fields.push({ name: 'Row ' + (i + 1), value: l }));
            }
        } catch (e) { /* keep metadata */ }
    } else if (fmt.key === 'excel') {
        // Excel headings cannot be read in the browser, so the server analyses
        // the file and hands back the detected columns (auto field analysis).
        try {
            const fileData = await fileToBase64(file);
            const preview = await fetch('/api/documents/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileName: file.name, fileData: fileData })
            }).then(r => r.json()).catch(() => null);
            if (preview && preview.ok && Array.isArray(preview.headers)) {
                if (preview.headers.length >= 1) {
                    preview.headers.forEach((h, i) => {
                        fields.push({
                            name: String(h),
                            value: preview.sample && preview.sample[i] != null ? String(preview.sample[i]) : '',
                            col: true
                        });
                    });
                    fields.push({ name: 'Total Rows', value: String(preview.totalRows != null ? preview.totalRows : 1) });
                }
            }
        } catch (e) { /* keep metadata */ }
    }

    return fields;
}

// Auto-detected column headings (fields tagged as real columns).
function getDetectedColumns() {
    return docFields.filter(f => f && f.col).map(f => String(f.name == null ? '' : f.name).trim()).filter(Boolean);
}

// Metadata rows and "Row N" placeholders that must never become columns.
const NON_COLUMN_FIELDS = new Set(['File Name', 'Format', 'File Size', 'Total Rows']);

// The column headings that a "With format" template would be built from:
// 1) auto-detected columns, or 2) the headings the user typed by hand in the
// Fields step when nothing could be auto-detected.
function getTemplateColumns() {
    const auto = getDetectedColumns();
    if (auto.length) return auto;
    const seen = new Set();
    return (docFields || [])
        .map(f => String(f.name == null ? '' : f.name).trim())
        .filter(n => n && !NON_COLUMN_FIELDS.has(n) && !/^Row \d+$/i.test(n))
        .filter(n => (seen.has(n) ? false : (seen.add(n), true)));
}

// ---------- Fields table ----------
let docFields = [];

function renderFields() {
    const tbody = document.getElementById('fields-body');
    tbody.innerHTML = '';

    docFields.forEach((f, i) => {
        const tr = document.createElement('tr');

        const idxCell = document.createElement('td');
        const idx = document.createElement('input');
        idx.type = 'text';
        idx.className = 'field-index';
        idx.readOnly = true;
        idx.value = i + 1;
        idxCell.appendChild(idx);

        const nameCell = document.createElement('td');
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = f.name;
        nameCell.appendChild(nameInput);

        const valCell = document.createElement('td');
        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.value = f.value;
        valCell.appendChild(valInput);

        const actCell = document.createElement('td');
        actCell.style.textAlign = 'right';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'field-remove';
        remove.textContent = '×';
        remove.title = 'Remove field';
        remove.addEventListener('click', () => {
            docFields.splice(i, 1);
            renderFields();
        });
        actCell.appendChild(remove);

        tr.append(idxCell, nameCell, valCell, actCell);
        tbody.appendChild(tr);
    });

    updateImportModeUI();
}

function addField(name, value) {
    docFields.push({ name: name || 'New Field', value: value || '' });
    renderFields();
    const rows = document.querySelectorAll('#fields-body tr');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('td:nth-child(2) input').focus();
}

function collectFields() {
    const rows = document.querySelectorAll('#fields-body tr');
    const out = [];
    rows.forEach((tr, i) => {
        const inputs = tr.querySelectorAll('input[type="text"]');
        const name = inputs[1].value.trim();
        if (name) out.push({ name: name, value: inputs[2].value.trim(), col: !!(docFields[i] && docFields[i].col) });
    });
    return out;
}

// ---------- Import mode (With data / With format) ----------
function updateImportModeUI() {
    const formatCard = document.getElementById('import-mode-format');
    const summary = document.getElementById('import-format-summary');
    const note = document.getElementById('import-format-note');
    if (!formatCard || !summary || !note) return;

    const columns = getTemplateColumns();
    const canFormat = columns.length >= 1;
    formatCard.classList.toggle('disabled', !canFormat);

    const formatRadio = formatCard.querySelector('input[type="radio"]');
    const dataRadio = document.querySelector('input[name="import-mode"][value="data"]');
    const active = document.querySelector('input[name="import-mode"]:checked');

    if (!canFormat) {
        if (active && active.value === 'format') dataRadio.checked = true;
        formatRadio.checked = false;
        summary.hidden = true;
        note.hidden = false;
        note.textContent = 'No headings found yet. Add column headings in the Fields step (e.g. Date, Item Name, Qty), then select "With format".';
        return;
    }

    note.hidden = true;
    const chosen = document.querySelector('input[name="import-mode"]:checked');
    if (chosen && chosen.value === 'format') {
        summary.hidden = false;
        summary.textContent = 'Detected headings: ' + columns.join('  ·  ');
    } else {
        summary.hidden = true;
    }

    document.querySelectorAll('.import-mode-card').forEach(c =>
        c.classList.toggle('selected', !!c.querySelector('input[type="radio"]:checked')));
}

// ---------- Steps ----------
const STEPS = ['upload', 'fields', 'details', 'members'];

function goTo(step) {
    const idx = STEPS.indexOf(step);
    document.querySelectorAll('.step-pane').forEach(p =>
        p.classList.toggle('active', p.dataset.pane === step));
    document.querySelectorAll('.step-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.step === step);
        b.classList.toggle('done', STEPS.indexOf(b.dataset.step) < idx);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Members ----------
function renderChips() {
    const chipsBox = document.getElementById('member-chips');
    chipsBox.innerHTML = '';
    selectedMembers.forEach(m => {
        const chip = document.createElement('span');
        chip.className = 'member-chip';
        chip.textContent = m.initials + ' ' + m.name;
        chip.title = m.email;
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'chip-remove';
        x.textContent = '×';
        x.addEventListener('click', () => {
            selectedMembers = selectedMembers.filter(mm => mm.email !== m.email);
            renderChips();
        });
        chip.appendChild(x);
        chipsBox.appendChild(chip);
    });
}

function renderPicker() {
    const box = document.getElementById('member-list');
    box.innerHTML = '';

    if (!members.length) {
        box.textContent = 'No other users available.';
        return;
    }
    members.forEach((m, i) => {
        const label = document.createElement('label');
        label.className = 'picker-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selectedMembers.some(sm => sm.email === m.email);
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
                if (!selectedMembers.some(sm => sm.email === m.email)) selectedMembers.push(m);
            } else {
                selectedMembers = selectedMembers.filter(sm => sm.email !== m.email);
            }
            renderChips();
        });
        box.appendChild(label);
    });
}

function fileToBase64(file) {
    if (!file) return Promise.resolve('');
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            resolve(result.indexOf(',') >= 0 ? result.slice(result.indexOf(',') + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

// ---------- Create ----------
async function createDocument() {
    const title = document.getElementById('doc-name').value.trim();
    if (!title) {
        goTo('details');
        document.getElementById('doc-name').focus();
        showToast('Please give the document a name.', 'error');
        return;
    }
    if (!currentFormat) {
        goTo('upload');
        showToast('Please upload a file first.', 'error');
        return;
    }

    const fields = collectFields();

    const modeInput = document.querySelector('input[name="import-mode"]:checked');
    const importMode = modeInput && modeInput.value === 'format' ? 'format' : 'data';
    if (importMode === 'format' && !getTemplateColumns().length) {
        showToast('No headings are available yet, so the document cannot be created as a format-only template. Choose "With data" or add column headings in the Fields step.', 'error');
        return;
    }

    let fileData = '';
    if (currentFile) {
        try { fileData = await fileToBase64(currentFile); } catch (e) { /* keep empty */ }
    }

    try {
        const res = await fetch('/api/documents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: title,
                format: document.getElementById('doc-format').value,
                type: currentFormat.key,
                fileName: document.getElementById('doc-file-name').value.trim(),
                status: document.getElementById('doc-status').value,
                fields: fields,
                members: selectedMembers,
                fileData: fileData,
                importMode: importMode
            })
        });
        const data = await res.json();
        if (!data.ok) {
            showToast(data.error || 'Could not create the document.', 'error');
            return;
        }
        window.location.href = '../documents/index.html';
    } catch (e) {
        showToast('Could not reach the server.', 'error');
    }
}

// ---------- Init ----------
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

    document.getElementById('sidebar-name').textContent = user.name;
    document.getElementById('sidebar-avatar').textContent = initialsOf(user.name);

    // Sidebar toggle
    const sidebar = document.querySelector('.sidebar');
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }
    document.getElementById('logo-toggle').addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    });

    // Load users for member picking
    try {
        const res = await fetch('/api/users');
        const data = await res.json();
        if (data.ok) members = data.users;
    } catch (e) { /* none */ }

    // Step tabs (also allow navigating to already-visited steps)
    let currentStep = 0;
    document.getElementById('step-tabs').addEventListener('click', (e) => {
        const btn = e.target.closest('.step-btn');
        if (!btn) return;
        const idx = STEPS.indexOf(btn.dataset.step);
        if (idx <= currentStep) {
            currentStep = idx;
            goTo(btn.dataset.step);
        }
    });

    // Upload zone
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('doc-file');
    const badge = document.getElementById('format-badge');
    const uploadNote = document.getElementById('upload-note');

    const openFilePicker = () => fileInput.click();
    uploadZone.addEventListener('click', openFilePicker);
    uploadZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openFilePicker();
        }
    });
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragging'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragging'));
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragging');
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            fileInput.dispatchEvent(new Event('change'));
        }
    });

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;

        currentFile = file;
        currentFormat = detectFormat(file);
        badge.hidden = false;
        badge.textContent = 'Detected format: ' + currentFormat.label;
        badge.style.background = currentFormat.color + '1a';
        badge.style.color = currentFormat.color;
        buildPreview(currentFormat.key, file.name, formatSize(file.size));
        uploadNote.hidden = false;

        // Defaults
        const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        if (!document.getElementById('doc-name').value) document.getElementById('doc-name').value = base;
        document.getElementById('doc-format').value = currentFormat.label;
        document.getElementById('doc-file-name').value = file.name;

        docFields = await extractFields(file, currentFormat);
        renderFields();
        document.getElementById('upload-next').disabled = false;
    });

    // Step navigation
    document.getElementById('upload-next').addEventListener('click', () => { currentStep = 1; goTo('fields'); });
    document.getElementById('fields-next').addEventListener('click', () => { currentStep = 2; goTo('details'); });
    document.getElementById('details-next').addEventListener('click', () => { currentStep = 3; goTo('members'); });
    document.getElementById('fields-back').addEventListener('click', () => { currentStep = 0; goTo('upload'); });
    document.getElementById('details-back').addEventListener('click', () => { currentStep = 1; goTo('fields'); });
    document.getElementById('members-back').addEventListener('click', () => { currentStep = 2; goTo('details'); });

    // Fields editing
    document.getElementById('add-field-btn').addEventListener('click', () => addField());

    // Members
    const pickerBox = document.getElementById('members-picker');
    document.getElementById('add-members-btn').addEventListener('click', () => {
        pickerBox.hidden = !pickerBox.hidden;
        renderPicker();
    });

    // Create / cancel
    document.getElementById('create-btn').addEventListener('click', createDocument);
    document.getElementById('cancel-btn').addEventListener('click', () => {
        window.location.href = '../documents/index.html';
    });

    // Import mode (With data / With format)
    document.querySelectorAll('input[name="import-mode"]').forEach(r =>
        r.addEventListener('change', updateImportModeUI));

    goTo('upload');
});