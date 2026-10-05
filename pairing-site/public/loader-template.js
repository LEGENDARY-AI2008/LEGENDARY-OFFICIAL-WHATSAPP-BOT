// ============================================================
// LËGĒNDÃRY BØT — DEPLOY LOADER
// Fill in your details below, save this file as index.js in an empty
// folder on your panel/VPS, then run: node index.js
// ============================================================
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const config = {
  SESSION_ID: 'your-session-id',
  OWNER_NUMBER: '234XXXXXXXXXX',
  WORKTYPE: 'public',
  PREFIX: '.',
  TIMEZONE: 'Africa/Lagos',
  OWNER_NAME: 'Your Name',
  BOT_NAME: 'LËGĒNDÃRY BØT'
}

const REPO_URL = 'https://github.com/LEGENDARY-AI2008/LEGENDARY-OFFICIAL-WHATSAPP-BOT'

function writeEnvFile(filePath) {
  const envText = Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  fs.writeFileSync(filePath, envText)
  console.log('config.env written')
}

function moveFilesToRoot(srcDir, destDir) {
  const files = fs.readdirSync(srcDir, { withFileTypes: true })
  for (const file of files) {
    const srcPath = path.join(srcDir, file.name)
    const destPath = path.join(destDir, file.name)

    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true, force: true })
    }

    fs.renameSync(srcPath, destPath)
  }
}

try {
  console.log('Cloning LËGĒNDÃRY BØT...')
  execSync(`git clone --depth 1 ${REPO_URL} temp-dir`, {
    stdio: 'inherit',
    timeout: 180000, // give up after 3 minutes instead of hanging forever
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } // never wait for a username/password
  })

  const rootDir = process.cwd()
  const tempDir = path.join(rootDir, 'temp-dir')

  fs.rmSync(path.join(tempDir, '.git'), { recursive: true, force: true })
  moveFilesToRoot(tempDir, rootDir)
  fs.rmSync(tempDir, { recursive: true, force: true })

  writeEnvFile(path.join(rootDir, 'config.env'))

  console.log('Installing dependencies...')
  // npm 12+ blocks git dependencies by default (Baileys needs one), so allow them.
  fs.writeFileSync(path.join(rootDir, '.npmrc'), 'allow-git=all\n')
  execSync('npm install --allow-git=all', { stdio: 'inherit', env: { ...process.env, NPM_CONFIG_ALLOW_GIT: 'all' } })

  console.log('Starting bot...')
  execSync('npm start', { stdio: 'inherit' })

} catch (err) {
  console.error('Setup failed:', err.message)
  process.exit(1)
}
