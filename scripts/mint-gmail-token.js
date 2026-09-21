'use strict';
/*
 * Mint an offline refresh token for the Gmail API sender.
 *
 * Usage:
 *   node scripts/mint-gmail-token.js
 *
 * The script starts a tiny loopback server, opens the Google consent page for
 * the scopes below, waits for the code, exchanges it for a refresh token, and
 * prints the refresh token. Put that token in GMAIL_REFRESH_TOKEN on the host
 * running the hub (e.g. Render env var).
 *
 * Requirements before running:
 *   - Gmail API enabled for the project.
 *   - Consent screen includes the Gmail API "send as" scope (gmail.send).
 *   - OAuth client is a Web/Desktop client (loopback redirect is allowed).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 17005;
const REDIRECT = 'http://127.0.0.1:' + PORT + '/callback';
const SCOPES = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify'
].join(' ');

const ids = {
    clientId: (process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || ''),
    clientSecret: (process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '')
};

function readSecret(name) {
    const p = path.join(__dirname, '..', '..', '..', '..', '..', name);
    try {
        return fs.readFileSync(p, 'utf8').trim();
    } catch (e) {
        return '';
    }
}

if (!ids.clientId) ids.clientId = readSecret('vcpl mailer client id.txt') || readSecret('new client id.txt') || readSecret('client id.txt');
if (!ids.clientSecret) ids.clientSecret = readSecret('vcpl mailer client secert.txt') || readSecret('new client secret.txt') || readSecret('client secret.txt');

if (!ids.clientId || !ids.clientSecret) {
    console.error('Missing client id/secret. Set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET env or place "client id.txt"/"client secret.txt" in O:\\');
    process.exit(1);
}

const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
        client_id: ids.clientId,
        redirect_uri: REDIRECT,
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true'
    }).toString();

const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1:' + PORT);
    if (u.pathname !== '/callback') {
        res.writeHead(404).end('not found');
        return;
    }
    const code = u.searchParams.get('code');
    const error = u.searchParams.get('error');
    if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h3>OAuth error: ' + error + '</h3><p>close this window</p>');
        server.close();
        console.error('OAuth error: ' + error);
        process.exit(1);
        return;
    }
    if (!code) {
        res.writeHead(400).end('no code');
        return;
    }

    (async () => {
        const params = new URLSearchParams();
        params.set('grant_type', 'authorization_code');
        params.set('client_id', ids.clientId);
        params.set('client_secret', ids.clientSecret);
        params.set('redirect_uri', REDIRECT);
        params.set('code', code);
        const tok = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
        const j = await tok.json();
        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (!tok.ok) {
            res.end('<h3>Token exchange failed</h3><pre>' + JSON.stringify(j, null, 2) + '</pre>');
            server.close();
            console.error('Token exchange failed:', JSON.stringify(j, null, 2));
            process.exit(1);
            return;
        }
        res.end('<h3>Done! Token captured. You can close this window.</h3>');
        server.close();
        console.log('GOOGLE_CLIENT_ID=' + ids.clientId);
        console.log('GMAIL_REFRESH_TOKEN=' + j.refresh_token);
        console.log('access_token (temp)=' + j.access_token);
        console.log('scope=' + j.scope);
        console.log('expires_in=' + j.expires_in);
        const stamp = process.env.GMAIL_TOKEN_OUT || 'O:\\gmail refresh token.txt';
        try {
            fs.writeFileSync(stamp, j.refresh_token + '\n', 'utf8');
            console.log('token saved to ' + stamp);
        } catch (e) { /* ignore */ }
        process.exit(0);
    })().catch((e) => {
        res.writeHead(500).end(String(e));
        server.close();
        console.error(e);
        process.exit(1);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('Listening on ' + REDIRECT);
    console.log('Opening consent page in your browser...');
    console.log(authUrl);
    const opener = process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    require('node:child_process').spawn(opener, [authUrl], { shell: process.platform === 'win32', detached: true, stdio: 'ignore' }).unref();
});