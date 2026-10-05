const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

const { autoJoinEverything } = require('./lib/autoJoin');
const { exportSessionId, readAuthBundle, SESSION_PREFIX } = require('./lib/sessionId');
const store = require('./lib/sessionStore');

// Baileys sometimes rejects a promise after a socket closes (e.g. 'Connection Closed'
// during the post-pairing restart). On Node 22 that used to CRASH the whole server and
// wipe every pairing in progress. Log it and keep running instead.
process.on('unhandledRejection', (r) => console.log('⚠️ unhandledRejection:', (r && r.message) || r));
process.on('uncaughtException', (e) => console.log('⚠️ uncaughtException:', (e && e.message) || e));

const app = express();
app.set('trust proxy', 1); // behind Render's proxy — needed for real client IPs
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TMP_ROOT = path.join(__dirname, 'tmp-sessions');
fs.mkdirSync(TMP_ROOT, { recursive: true });

// requestId -> { status: 'waiting'|'connected'|'error', sessionId?, error?, authDir, sock, createdAt }
const sessions = new Map();

function newRequestId() {
    return crypto.randomBytes(8).toString('hex');
}

function cleanupSession(requestId, delayMs = 5000) {
    setTimeout(() => {
        const entry = sessions.get(requestId);
        if (!entry) return;
        try { entry.sock?.end(undefined); } catch {}
        try { fs.rmSync(entry.authDir, { recursive: true, force: true }); } catch {}
        sessions.delete(requestId);
    }, delayMs);
}

// Sweep anything abandoned (started pairing, never finished) after 10 minutes.
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessions) {
        if (now - entry.createdAt > 10 * 60 * 1000) cleanupSession(id, 0);
    }
}, 60 * 1000);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Creates (or re-creates) the socket for one pairing request.
 * WhatsApp ALWAYS drops the connection with code 515 (restartRequired)
 * right after the user enters the pairing code / scans the QR. The
 * fix is to open a brand-new socket on the same auth folder, so this
 * function can be called again and again for the same requestId.
 */
async function startSocket(requestId, authDir) {
    const entry = sessions.get(requestId);
    if (!entry) return null;

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false
    });
    entry.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const current = sessions.get(requestId);
        if (!current || current.sock !== sock) return; // stale socket, ignore

        if (qr && current.onQr) current.onQr(qr);

        if (connection === 'open') {
            if (current.status !== 'waiting') return;
            console.log(`🔌 [${requestId}] connection open`);
            try {
                await delay(2000); // let the session settle before sending
                let sessionId = exportSessionId(authDir); // long form (fallback)
                if (!sessionId) throw new Error('Paired, but could not read the session.');
                if (store.configured()) {
                    // Save the login in the database and hand out a short ID instead.
                    const bundle = readAuthBundle(authDir);
                    if (!bundle) throw new Error('Paired, but could not read the login files.');
                    sessionId = SESSION_PREFIX + (await store.saveSession(bundle));
                    console.log(`💾 [${requestId}] session saved (${Math.round(bundle.length / 1024)} KB, ${Object.keys(JSON.parse(bundle).files).length} files)`);
                }

                // 1) Send the session ID to the user's own WhatsApp (message yourself)
                const myJid = sock.user.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
                await sock.sendMessage(myJid, { text: sessionId });
                console.log(`📨 [${requestId}] session ID sent to DM`);
                await sock.sendMessage(myJid, {
                    text: '*LËGĒNDÃRY BØT*\n\nThis is your SESSION_ID (the long message above).\n' +
                          'Copy it into the loader on the deploy page, then run: node index.js\n\n' +
                          '⚠️ Never share your SESSION_ID with anyone.'
                });

                current.status = 'connected';
                current.sessionId = sessionId;
                console.log(`✅ Paired — session sent for request ${requestId}`);

                // 2) Auto-join is optional extra — must never break the session delivery
                autoJoinEverything(sock).catch(() => {});
                await delay(4000);
            } catch (e) {
                console.log(`❌ [${requestId}] pairing failed: ${e.message}`);
                current.status = 'error';
                current.error = e.message;
            }
            cleanupSession(requestId);
        }

        if (connection === 'close' && current.status === 'waiting') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`🔁 [${requestId}] connection closed (code ${statusCode}), restart #${(current.restarts || 0) + 1}`);
            const canRetry = [
                DisconnectReason.restartRequired,   // 515 — normal right after pairing
                DisconnectReason.connectionClosed,
                DisconnectReason.connectionLost,
                DisconnectReason.timedOut
            ].includes(statusCode);

            current.restarts = (current.restarts || 0) + 1;
            if (canRetry && current.restarts <= 6) {
                try { await startSocket(requestId, authDir); } catch (e) {
                    current.status = 'error';
                    current.error = e.message;
                    cleanupSession(requestId, 0);
                }
            } else {
                current.status = 'error';
                current.error = 'Connection closed before pairing completed. Try again.';
                cleanupSession(requestId, 0);
            }
        }
    });

    return sock;
}

app.post('/pair', async (req, res) => {
    try {
        const number = (req.body.number || '').replace(/[^0-9]/g, '');
        if (!number) return res.status(400).json({ error: 'A valid phone number is required.' });

        const requestId = newRequestId();
        const authDir = path.join(TMP_ROOT, requestId);
        fs.mkdirSync(authDir, { recursive: true });

        sessions.set(requestId, { status: 'waiting', authDir, sock: null, createdAt: Date.now() });
        const sock = await startSocket(requestId, authDir);

        await delay(2500); // socket must be connecting before a code can be requested
        const code = await sock.requestPairingCode(number);
        res.json({ requestId, code });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ---- bots download their login from here using the short ID ----
const hits = new Map(); // ip -> { count, misses, resetAt }
function limited(ip, isMiss) {
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || now > h.resetAt) { h = { count: 0, misses: 0, resetAt: now + 60 * 60 * 1000 }; hits.set(ip, h); }
    if (isMiss === undefined) { h.count++; return h.count > 60 || h.misses > 10; }
    if (isMiss) h.misses++;
    return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k); }, 10 * 60 * 1000).unref();

app.get('/session/:id', async (req, res) => {
    const ip = req.ip;
    if (limited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    if (!store.configured()) return res.status(503).json({ error: 'Session storage is not set up.' });
    try {
        const creds = await store.getSession(String(req.params.id).toUpperCase());
        limited(ip, !creds);
        if (!creds) return res.status(404).json({ error: 'Session ID not found.' });
        res.setHeader('Cache-Control', 'no-store');
        res.json({ creds });
    } catch (e) {
        res.status(500).json({ error: 'Could not read session.' });
    }
});

app.get('/status/:requestId', (req, res) => {
    const entry = sessions.get(req.params.requestId);
    if (!entry) return res.json({ status: 'error', error: 'Session expired or not found.' });
    res.json({ status: entry.status, sessionId: entry.sessionId, error: entry.error });
});

app.get('/qr', async (req, res) => {
    try {
        const requestId = newRequestId();
        const authDir = path.join(TMP_ROOT, requestId);
        fs.mkdirSync(authDir, { recursive: true });

        let resolved = false;
        const entry = { status: 'waiting', authDir, sock: null, createdAt: Date.now() };
        entry.onQr = async (qr) => {
            if (resolved) return;
            resolved = true;
            const dataUrl = await QRCode.toDataURL(qr);
            res.json({ requestId, qr: dataUrl });
        };
        sessions.set(requestId, entry);
        await startSocket(requestId, authDir);

        // If no QR shows up in time (rare), fail cleanly instead of hanging the request.
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                res.status(500).json({ error: 'QR generation timed out — try again.' });
                cleanupSession(requestId, 0);
            }
        }, 20000);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/qr/status/:requestId', (req, res) => {
    const entry = sessions.get(req.params.requestId);
    if (!entry) return res.json({ status: 'error', error: 'Session expired or not found.' });
    res.json({ status: entry.status, sessionId: entry.sessionId, error: entry.error });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔗 Pairing site running on port ${PORT}`));
