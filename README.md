# LËGĒNDÃRY BØT — v2

Session-ID based WhatsApp bot, Kord/Levanter-style deploy flow.

## Project layout

```
src/            <- your REAL, readable source. NEVER push this publicly.
scripts/        <- build-obfuscated.js: obfuscates src/ -> publish/
publish/        <- generated. This is what you push to the PUBLIC deploy repo.
loader.js       <- the ONE file end users copy/fill/run on their own panel.
```

## Local development & testing

Test straight from `src/` before ever obfuscating anything:

```bash
npm install
cp src/.env.example src/config.env
# fill in SESSION_ID etc. (run src/pair.js first if you don't have one yet)
node src/pair.js 2348012345678     # one-time, prints your SESSION_ID
node src/index.js
```

## Publishing a protected build

When you're ready to push an update to the public deploy repo:

```bash
npm install                        # pulls in javascript-obfuscator (devDependency)
node scripts/build-obfuscated.js   # writes the obfuscated build to /publish
```

Then push the **contents of `/publish`** (not `/src`) to your public
deploy repo — e.g.:

```bash
cd publish
git init   # first time only
git remote add origin https://github.com/YOUR_USERNAME/legendary-bot-v2   # first time only
git add .
git commit -m "build: update"
git push origin main --force
```

Keep `/src` itself private — either a separate private repo, or just
local/untracked. It never gets pushed to the deploy repo.

## The loader (what end users actually run)

`loader.js` is given out separately (on your deploy page, Panel/Render/VPS
tabs — like Kord's). The user:
1. Copies `loader.js`, saves it as `index.js` in an empty folder on their panel/VPS.
2. Fills in the `config` object at the top (their SESSION_ID, owner number, etc.).
3. Runs `node index.js`.

It clones your public deploy repo (the obfuscated `/publish` contents),
writes their config into `config.env`, `npm install`s, then `npm start`s
— which runs the real (obfuscated) `index.js` that just got cloned in,
overwriting the loader itself in the process.

**Before handing this out:** edit `REPO_URL` near the top of `loader.js`
to point at your actual public repo once it exists.

## Commands (20)

**General** — menu, ping, alive, owner, jid
**Media** — sticker, toimg, take, vv
**Group** — kick, add, promote, demote, grouplink, antilink
**Fun** — joke, quote, 8ball
**Owner-only** — broadcast, mode

Add command #21+ in `src/commands/`, then rebuild with
`node scripts/build-obfuscated.js` before pushing.

## Notes

- ffmpeg must be on PATH wherever this actually runs (video/GIF stickers).
- Obfuscation raises the bar against casual copying — it's not
  encryption, and a determined person can still unpick it eventually.
- `data/settings.json` (antilink toggle, mode) and `auth_info/` are
  created at runtime and gitignored — never part of what you push.
