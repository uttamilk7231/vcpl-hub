const fs = require('fs');
const files = ['home/index.html', 'profile/index.html', 'documents/index.html'];
for (const f of files) {
    console.log('\n======= ' + f + ' =======');
    const t = fs.readFileSync(f, 'utf8');
    const s = t.indexOf('<ul class="nav-list"');
    const e = t.indexOf('</ul>', s);
    const seg = t.slice(s, e);
    const rows = seg.split('<li class="nav-item').slice(1);
    rows.forEach((r) => {
        const href = /href="([^"]+)"/.exec(r);
        const h = href ? href[1] : '@';
        const highlights = /highlighted/.test(r.split('>')[0]);
        const spans = [];
        for (const mm of r.matchAll(/<span>\s*([^<]{2,}?)\s*<\/span>/g)) spans.push(mm[1].trim());
        console.log('   ' + h.padEnd(34) + (highlights ? '[*]' : '   ') + '  ' + spans.join(' | '));
    });
}
