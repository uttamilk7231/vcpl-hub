// _all_tests.js — runs every phase test suite against a fresh scratch data dir.
// Usage: npm test   (runs each phase test on an isolated port + scratch DATA_DIR)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tests = ['_phaseD_test.js', '_phaseF_test.js', '_phaseG_test.js', '_phaseI_test.js'];
const scratchRoot = path.join(os.tmpdir(), 'opencode', 'alltests', String(Date.now()));
fs.mkdirSync(scratchRoot, { recursive: true });
try { fs.cpSync('data', scratchRoot, { recursive: true }); } catch (e) { /* no data yet */ }
for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
    try { fs.rmSync(path.join(scratchRoot, f), { force: true }); } catch (e) { /* ignore */ }
}

console.log('Scratch data dir: ' + scratchRoot);
let failed = 0;
for (const t of tests) {
    console.log('\n=== ' + t + ' ===');
    const r = spawnSync(process.execPath, ['_runner.js', t], {
        env: Object.assign({}, process.env, { DATA_DIR: scratchRoot, TEST_PORT: '3001' }),
        stdio: 'inherit'
    });
    if (r.status !== 0) { failed++; console.log('!! ' + t + ' FAILED (exit ' + r.status + ')'); }
}
try { fs.rmSync(scratchRoot, { recursive: true, force: true }); } catch (e) { /* ignore */ }
console.log(failed ? ('\n' + failed + ' test file(s) FAILED.') : '\nAll phase tests passed.');
process.exit(failed ? 1 : 0);