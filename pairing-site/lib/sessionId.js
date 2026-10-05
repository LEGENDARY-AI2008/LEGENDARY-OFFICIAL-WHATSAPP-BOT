const fs = require('fs');
const path = require('path');

// Must match src/lib/session.js's SESSION_PREFIX exactly — this is the
// single source of truth for what a valid LËGĒNDÃRY BØT session ID
// looks like, shared conceptually across both the bot and this site.
const SESSION_PREFIX = 'LEGEND-';

/** Reads a just-paired creds.json out of its temp auth dir and returns the branded SESSION_ID string. */
function exportSessionId(authDir) {
    const credsPath = path.join(authDir, 'creds.json');
    if (!fs.existsSync(credsPath)) return null;
    const raw = fs.readFileSync(credsPath, 'utf-8');
    return SESSION_PREFIX + Buffer.from(raw).toString('base64');
}

/**
 * Packs the WHOLE auth folder (creds.json + encryption keys: pre-keys, sessions,
 * sender keys, lid mappings...) into one JSON string. Restoring only creds.json
 * loses the keys, so the bot can't decrypt messages from your phone/contacts.
 * Format: { v: 2, files: { 'creds.json': '<text>', 'pre-key-1.json': '<text>', ... } }
 */
function readAuthBundle(authDir) {
    const files = {};
    for (const name of fs.readdirSync(authDir)) {
        if (!/^[\w.\-]+\.json$/.test(name)) continue;
        files[name] = fs.readFileSync(path.join(authDir, name), 'utf-8');
    }
    if (!files['creds.json']) return null;
    return JSON.stringify({ v: 2, files });
}

module.exports = { SESSION_PREFIX, exportSessionId, readAuthBundle };
