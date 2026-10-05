// Saves paired logins so users only get a SHORT session ID like
// LEGEND-K7P2M9XQ4A instead of a huge blob.
//
// Two storage backends, same API:
//   1) FOLDER (default): one small file per session in ./saved-sessions
//      (override the folder with SESSIONS_DIR). No account needed.
//      ⚠️ Only permanent on hosts with a permanent disk (VPS, panel,
//      paid Render disk). On Render's FREE tier the disk is wiped on
//      every redeploy/sleep, so saved sessions would be lost there.
//   2) UPSTASH REDIS (optional): set UPSTASH_REDIS_REST_URL and
//      UPSTASH_REDIS_REST_TOKEN and it is used automatically instead.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, '..', 'saved-sessions');

const URL_BASE = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

// 32 characters, no 0/O/1/I — easy to read and type. 32^10 ≈ 1.1 quadrillion combos.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ID_LENGTH = 10;
const ID_REGEX = new RegExp(`^[${ALPHABET}]{${ID_LENGTH}}$`);

const useRedis = () => Boolean(URL_BASE && TOKEN);
const configured = () => true; // folder storage always works

if (!useRedis()) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    console.log(`💾 Session storage: folder (${SESSIONS_DIR})`);
    if (process.env.RENDER) {
        console.log('⚠️  Running on Render with folder storage — the free tier wipes this folder on every redeploy/sleep. Add UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or use a Render disk, to keep sessions permanently.');
    }
} else {
    console.log('💾 Session storage: Upstash Redis');
}

function newId() {
    let id = '';
    for (let i = 0; i < ID_LENGTH; i++) id += ALPHABET[crypto.randomInt(ALPHABET.length)];
    return id;
}

async function redis(command) {
    const res = await fetch(URL_BASE, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command)
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Redis error ${res.status}`);
    return data.result;
}

/** Stores the creds JSON string and returns the new short id (e.g. "K7P2M9XQ4A"). */
async function saveSession(credsJson) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const id = newId();
        if (useRedis()) {
            const ok = await redis(['SET', `sess:${id}`, credsJson, 'NX']); // NX = never overwrite
            if (ok === 'OK') return id;
        } else {
            const file = path.join(SESSIONS_DIR, `${id}.json`);
            try {
                fs.writeFileSync(file, credsJson, { flag: 'wx', mode: 0o600 }); // wx = fail if it exists
                return id;
            } catch (e) {
                if (e.code !== 'EEXIST') throw e;
            }
        }
    }
    throw new Error('Could not allocate a session ID, try again.');
}

/** Returns the creds JSON string, or null if the id doesn't exist. */
async function getSession(id) {
    if (!ID_REGEX.test(id)) return null; // also blocks path tricks like ../
    if (useRedis()) return redis(['GET', `sess:${id}`]);
    const file = path.join(SESSIONS_DIR, `${id}.json`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

module.exports = { configured, saveSession, getSession, ID_REGEX };
