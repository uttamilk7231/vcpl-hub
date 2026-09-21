/* VCPL shared toast — call window.showToast(msg, type) */
(function () {
    var DURATION = 3500;
    var stack = null;

    function ensureStack() {
        if (stack && stack.parentNode) return stack;
        stack = document.createElement('div');
        stack.className = 'toast-stack';
        stack.setAttribute('aria-live', 'polite');
        stack.setAttribute('aria-atomic', 'false');
        document.body.appendChild(stack);
        return stack;
    }

    function showToast(msg, type) {
        type = type || 'info';
        var s = ensureStack();
        var el = document.createElement('div');
        el.className = 'toast-msg ' + type;
        var icon = document.createElement('span');
        icon.className = 'toast-icon';
        icon.textContent = type === 'success' ? '\u2713' : type === 'error' ? '!' : 'i';
        var text = document.createElement('span');
        text.textContent = msg || '';
        el.append(icon, text);
        s.appendChild(el);
        setTimeout(function () {
            el.classList.add('leaving');
            setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
        }, DURATION);
    }

    window.showToast = showToast;
})();