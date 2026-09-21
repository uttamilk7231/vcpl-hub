// Shared promise-based prompt / confirm modals (no native browser dialogs).
(function () {
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function closeModal() {
        const m = document.getElementById('v-dialog');
        if (m && m.parentNode) m.parentNode.removeChild(m);
    }

    window.showPrompt = function (opts) {
        opts = opts || {};
        const wrap = document.createElement('div');
        wrap.className = 'v-modal-overlay';
        wrap.id = 'v-dialog';
        wrap.setAttribute('role', 'presentation');
        wrap.innerHTML =
            '<div class="v-modal" role="dialog" aria-modal="true">' +
                '<h3 class="v-modal-title">' + esc(opts.title || 'Enter a value') + '</h3>' +
                (opts.message ? '<p class="v-modal-msg">' + esc(opts.message) + '</p>' : '') +
                '<input class="v-modal-input" type="text" maxlength="120" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') + '">' +
                '<div class="v-modal-actions">' +
                    '<button type="button" class="v-btn v-btn-ghost" data-act="cancel">Cancel</button>' +
                    '<button type="button" class="v-btn v-btn-primary" data-act="ok">' + esc(opts.submitText || 'Save') + '</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(wrap);

        const input = wrap.querySelector('.v-modal-input');
        const btnCancel = wrap.querySelector('[data-act="cancel"]');
        const btnOk = wrap.querySelector('[data-act="ok"]');

        return new Promise(resolve => {
            const done = val => { closeModal(); if (opts.onClose) opts.onClose(val); resolve(val); };

            const submit = () => done(input.value.trim());
            btnOk.addEventListener('click', submit);
            btnCancel.addEventListener('click', () => done(null));
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
                else if (e.key === 'Escape') done(null);
            });
            wrap.addEventListener('mousedown', e => { if (e.target === wrap) done(null); });

            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
        });
    };

    window.showConfirm = function (opts) {
        opts = opts || {};
        const wrap = document.createElement('div');
        wrap.className = 'v-modal-overlay';
        wrap.id = 'v-dialog';
        wrap.setAttribute('role', 'presentation');
        wrap.innerHTML =
            '<div class="v-modal" role="alertdialog" aria-modal="true">' +
                '<h3 class="v-modal-title">' + esc(opts.title || 'Are you sure?') + '</h3>' +
                (opts.message ? '<p class="v-modal-msg">' + esc(opts.message) + '</p>' : '') +
                '<div class="v-modal-actions">' +
                    '<button type="button" class="v-btn v-btn-ghost" data-act="cancel">' + esc(opts.cancelText || 'Cancel') + '</button>' +
                    '<button type="button" class="v-btn v-btn-danger" data-act="ok">' + esc(opts.confirmText || 'Confirm') + '</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(wrap);

        const btnCancel = wrap.querySelector('[data-act="cancel"]');
        const btnOk = wrap.querySelector('[data-act="ok"]');

        return new Promise(resolve => {
            const done = val => { closeModal(); if (opts.onClose) opts.onClose(val); resolve(val); };

            btnOk.addEventListener('click', () => done(true));
            btnCancel.addEventListener('click', () => done(false));
            wrap.addEventListener('mousedown', e => { if (e.target === wrap) done(false); });
            wrap.addEventListener('keydown', e => { if (e.key === 'Escape') done(false); });
        });
    };
})();