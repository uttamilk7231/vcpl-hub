// One shot: spawn server on TEST_PORT, write server.pid, run tests, cleanup.
const { spawn } = require('child_process');
const port = process.env.TEST_PORT || '3001';

const server = spawn(process.execPath, ['server.js'], {
    env: Object.assign({}, process.env, { PORT: port }),
    stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitReady() {
    for (let i = 0; i < 40; i++) {
        if (server.exitCode != null) { console.log('SERVER DIED early:\n' + log); return false; }
        try {
            const r = await fetch('http://127.0.0.1:' + port + '/api/bootstrap');
            if (r.status) return true;
        } catch (e) { /* not ready yet */ }
        await sleep(400);
    }
    return false;
}

(async () => {
    const ok = await waitReady();
    if (!ok) { console.log('server never became ready:\n' + log); process.exit(2); }
    console.log('server ready on :' + port);
    const t = spawn(process.execPath, [process.argv[2] || '_phaseD_test.js'], {
        env: Object.assign({}, process.env, { TEST_PORT: port }),
        stdio: 'inherit'
    });
    const code = await Promise.race([
        new Promise(res => t.on('exit', res)),
        (async () => { await sleep(90000); console.log('[watchdog] test child timed out'); t.kill(); return 124; })()
    ]);
    server.kill();
    console.log('\ntest exit=' + code + '\nserver log tail:\n' + log.slice(-1200));
    process.exit(code);
})();