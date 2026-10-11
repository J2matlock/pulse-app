#!/usr/bin/env node
/**
 * build-mac.js — build the macOS app (dmg + zip, Apple Silicon and Intel).
 *
 * Must run on a Mac (dmg creation, code signing and notarization need
 * macOS tools). Uses a staging directory with production dependencies only,
 * like build-linux.js; electron-builder rebuilds the native database module
 * for each architecture.
 *
 * Signing and notarization are optional and driven by environment variables:
 *   CSC_NAME or CSC_LINK (+ CSC_KEY_PASSWORD)   Developer ID Application certificate
 *   APPLE_TEAM_ID + APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD   notarization
 *   (or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER)
 * Without them the build is unsigned (ad hoc): fine for testing on your own
 * Mac, but other Macs will refuse to open it. See plans/macos-build.md.
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { writeStagingPackage, STAGING_INSTALL_CMD, assertStagedDepsMatchLock } = require('./staging-deps')

const ROOT = path.resolve(__dirname, '..')
const STAGING = path.join(ROOT, '.build-staging-mac')
const DIST = path.join(ROOT, 'dist')

if (process.platform !== 'darwin') {
  console.error('[build-mac] This script must run on macOS. See plans/macos-build.md.')
  process.exit(1)
}

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts })
}

const env = process.env
const canSign = !!(env.CSC_NAME || env.CSC_LINK)
const canNotarize = canSign && !!env.APPLE_TEAM_ID && !!(
  (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD) || (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER)
)
console.log(`[build-mac] Signing: ${canSign ? 'yes' : 'NO (ad hoc, for testing only)'}  ·  Notarization: ${canNotarize ? 'yes' : 'no'}`)

if (fs.existsSync(STAGING)) fs.rmSync(STAGING, { recursive: true, force: true })

console.log('\n=== Step 1: electron-vite build ===')
run('npx electron-vite build')

console.log('\n=== Step 2: staging directory ===')
fs.mkdirSync(path.join(STAGING, 'scripts'), { recursive: true })
fs.cpSync(path.join(ROOT, 'out'), path.join(STAGING, 'out'), { recursive: true })
fs.cpSync(path.join(ROOT, 'build'), path.join(STAGING, 'build'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'scripts', 'afterPack.js'), path.join(STAGING, 'scripts', 'afterPack.js'))
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
writeStagingPackage(ROOT, STAGING, pkg, { npmRebuild: true })
run(STAGING_INSTALL_CMD, { cwd: STAGING })
assertStagedDepsMatchLock(ROOT, STAGING)

console.log('\n=== Step 3: electron-builder --mac ===')
const electronVersion = require('electron/package.json').version
const flags = [
  `--project "${STAGING}"`,
  `-c.electronVersion=${electronVersion}`,
  canSign ? '' : '-c.mac.identity=null',
  canNotarize ? '-c.mac.notarize=true' : '',
].filter(Boolean).join(' ')
// One architecture at a time, so each gets its own native module build
for (const arch of ['arm64', 'x64']) {
  run(`npx electron-builder --mac --${arch} ${flags}`)
}

console.log('\n=== Step 4: copy artifacts ===')
fs.mkdirSync(DIST, { recursive: true })
for (const f of fs.readdirSync(path.join(STAGING, 'dist'))) {
  if (/\.(dmg|zip|blockmap)$/.test(f)) {
    fs.copyFileSync(path.join(STAGING, 'dist', f), path.join(DIST, f))
    console.log(`  Copied: ${f}`)
  }
}
fs.rmSync(STAGING, { recursive: true, force: true })
console.log('\n[build-mac] Done. Artifacts are in dist/.')
