// Splash-screen behaviour. Kept as an external file because the server's
// Content-Security-Policy (script-src 'self') blocks inline scripts.
(function () {
    var msgs = [
        'Preparing your workspace…',
        'Connecting to the portal…',
        'Checking your session…',
        'Almost there…'
    ];

    var el = document.getElementById('status-text');
    if (el) {
        var i = 0;
        setInterval(function () {
            i = (i + 1) % msgs.length;
            el.textContent = msgs[i];
        }, 1400);
    }

    var img = document.getElementById('splash-logo');
    var mono = document.getElementById('splash-monogram');
    if (img) {
        img.addEventListener('error', function () {
            img.style.display = 'none';
            if (mono) mono.style.display = 'block';
        });
    }

    // Safety net: if bootstrap never redirects, don't strand the user here.
    setTimeout(function () {
        window.location.replace('create account/index.html?err=slow');
    }, 12000);
})();
