#!/usr/bin/env node
/**
 * build-win.js — Cross-compile Windows launcher from Linux.
 *
 * Produces PULSE.exe — a lightweight launcher that extracts the Electron app
 * on first run (with progress bar) and launches directly on subsequent runs.
 *
 * Steps:
 *   1. electron-vite build (creates out/)
 *   2. Create staging dir with out/, package.json, package-lock.json and
 *      production node_modules (npm ci, so versions match the lock)
 *   3. Check the Windows binary that better-sqlite3-multiple-ciphers bundles
 *      (Node-API, so it works with any Electron version; nothing to download)
 *   4. Run electron-builder --win (produces win-unpacked/ directory)
 *   5. Verify win-unpacked directory
 *   6. Package win-unpacked into PULSE.exe launcher via Inno Setup
 *   7. Clean up staging dir
 *
 * The exe is not code-signed: Pulse is free and open source, so Windows
 * SmartScreen shows "More info → Run anyway" on first run.
 *
 * Requires: Inno Setup 6 (native on Windows, or under Wine on Linux)
 *   Install on Linux: bash scripts/setup-innosetup.sh
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { writeStagingPackage, STAGING_INSTALL_CMD, assertStagedDepsMatchLock } = require('./staging-deps')

const ROOT = path.resolve(__dirname, '..')
const STAGING = path.join(ROOT, '.build-staging')
const DIST = path.join(ROOT, 'dist')

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts })
}

function runQuiet(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', ...opts }).trim()
}

// ---------- cleanup from prior run ----------
if (fs.existsSync(STAGING)) {
  console.log('[build-win] Cleaning prior staging dir...')
  fs.rmSync(STAGING, { recursive: true, force: true })
}
// Remove stale exe files from dist/ (keeps non-exe files like yaml/yml)
if (fs.existsSync(DIST)) {
  const staleExes = fs.readdirSync(DIST).filter(f => f.endsWith('.exe'))
  for (const f of staleExes) {
    fs.unlinkSync(path.join(DIST, f))
    console.log(`[build-win] Removed stale: ${f}`)
  }
}

// ---------- step 1: electron-vite build ----------
console.log('\n=== Step 1: electron-vite build ===')
run('npx electron-vite build')

// ---------- step 2: create staging directory ----------
console.log('\n=== Step 2: Create staging directory ===')
fs.mkdirSync(STAGING, { recursive: true })

// Copy out/ (the bundled app)
execSync(`cp -r "${path.join(ROOT, 'out')}" "${path.join(STAGING, 'out')}"`)

// Copy build/ assets (icons etc.)
execSync(`cp -r "${path.join(ROOT, 'build')}" "${path.join(STAGING, 'build')}"`)

// Copy afterPack script
fs.mkdirSync(path.join(STAGING, 'scripts'), { recursive: true })
fs.copyFileSync(
  path.join(ROOT, 'scripts', 'afterPack.js'),
  path.join(STAGING, 'scripts', 'afterPack.js')
)

// Read the real package.json
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

// Minimal package.json + package-lock.json + license files for electron-builder
writeStagingPackage(ROOT, STAGING, pkg, {
  npmRebuild: false, // we already have the right binary
})

// Install production deps in the staging directory (clean, small tree), at
// exactly the versions in package-lock.json
console.log('[build-win] Installing production dependencies in staging...')
run(STAGING_INSTALL_CMD, { cwd: STAGING })
assertStagedDepsMatchLock(ROOT, STAGING)

// ---------- step 3: check the Windows native binary in staging ----------
console.log('\n=== Step 3: Check Windows native binary ===')
// package.json build.win.files leaves the other platforms' binaries out of the app
const stagingSqlite = path.join(STAGING, 'node_modules', 'better-sqlite3-multiple-ciphers')
const nativeWin = path.join(stagingSqlite, 'prebuilds', 'win32-x64.node')
if (!fs.existsSync(nativeWin)) {
  console.error(`[build-win] ERROR: ${nativeWin} is missing`)
  process.exit(1)
}

// Verify it's a PE32+ binary
const fileType = runQuiet(`file "${nativeWin}"`)
if (!fileType.includes('PE32+')) {
  console.error('[build-win] ERROR: Native binary is not PE32+!')
  console.error(`  file output: ${fileType}`)
  process.exit(1)
}
console.log('[build-win] Windows native binary verified (PE32+)')

// Check staging node_modules size
const stagingNmSize = runQuiet(`du -sh "${path.join(STAGING, 'node_modules')}"`)
console.log(`[build-win] Staging node_modules: ${stagingNmSize.split('\t')[0]}`)

// ---------- step 4: run electron-builder ----------
console.log('\n=== Step 4: electron-builder --win ===')

// Copy @electron/fuses into staging node_modules (needed by afterPack.js)
const fusesSource = path.join(ROOT, 'node_modules', '@electron', 'fuses')
const fusesDest = path.join(STAGING, 'node_modules', '@electron', 'fuses')
if (fs.existsSync(fusesSource)) {
  fs.mkdirSync(path.join(STAGING, 'node_modules', '@electron'), { recursive: true })
  execSync(`cp -r "${fusesSource}" "${fusesDest}"`)
  // Also copy its dependency node-int64 if needed
  const nodeInt64Src = path.join(ROOT, 'node_modules', 'node-int64')
  const nodeInt64Dest = path.join(STAGING, 'node_modules', 'node-int64')
  if (fs.existsSync(nodeInt64Src) && !fs.existsSync(nodeInt64Dest)) {
    execSync(`cp -r "${nodeInt64Src}" "${nodeInt64Dest}"`)
  }
}

const electronVersion = require('electron/package.json').version
run(`npx electron-builder --win --project "${STAGING}" -c.electronVersion=${electronVersion}`, { cwd: ROOT })

// ---------- step 5: verify win-unpacked ----------
console.log('\n=== Step 5: Verify win-unpacked ===')
const stagingDist = path.join(STAGING, 'dist')
const winUnpacked = path.join(stagingDist, 'win-unpacked')
if (!fs.existsSync(winUnpacked)) {
  console.error('[build-win] ERROR: win-unpacked directory not found!')
  console.error('[build-win] Expected at:', winUnpacked)
  process.exit(1)
}
const winUnpackedSize = runQuiet(`du -sh "${winUnpacked}"`)
console.log(`[build-win] win-unpacked: ${winUnpackedSize.split('\t')[0]}`)

// ---------- step 6: create launcher with Inno Setup ----------
console.log('\n=== Step 6: Create launcher with Inno Setup ===')
fs.mkdirSync(DIST, { recursive: true })

// Convert Linux path to Wine Z: path
function winPath(p) {
  if (process.platform === 'win32') return p
  return 'Z:' + p.split('/').join('\\')
}

// Find ISCC.exe
let isccCmd = null
if (process.platform === 'win32') {
  const winPaths = [
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  ]
  for (const p of winPaths) {
    if (fs.existsSync(p)) { isccCmd = `"${p}"`; break }
  }
  if (!isccCmd) {
    try { runQuiet('where ISCC'); isccCmd = 'ISCC' } catch {}
  }
} else {
  const winePaths = [
    path.join(process.env.HOME, '.wine/drive_c/Program Files (x86)/Inno Setup 6/ISCC.exe'),
    path.join(process.env.HOME, '.wine/drive_c/Program Files/Inno Setup 6/ISCC.exe'),
  ]
  for (const p of winePaths) {
    if (fs.existsSync(p)) {
      isccCmd = `wine "${winPath(p)}"`
      break
    }
  }
}

if (!isccCmd) {
  console.error('[build-win] ERROR: Inno Setup (ISCC.exe) not found!')
  console.error('[build-win] Install it:')
  console.error('  bash scripts/setup-innosetup.sh')
  process.exit(1)
}

console.log(`[build-win] Using ISCC: ${isccCmd}`)

const issScript = path.join(ROOT, 'scripts', 'pulse-launcher.iss')
const defines = [
  `/DAppVersion=${pkg.version}`,
  `/DSourcePath="${winPath(winUnpacked)}"`,
  `/DOutputDir="${winPath(DIST)}"`,
  `/DIconPath="${winPath(path.join(ROOT, 'build', 'icon.ico'))}"`,
].join(' ')

run(`${isccCmd} ${defines} "${winPath(issScript)}"`)

// Verify PULSE.exe was created
const launcherExe = path.join(DIST, 'PULSE.exe')
if (!fs.existsSync(launcherExe)) {
  console.error('[build-win] ERROR: PULSE.exe was not created!')
  process.exit(1)
}
const launcherSize = fs.statSync(launcherExe).size
console.log(`[build-win] Launcher created: PULSE.exe (${(launcherSize / 1024 / 1024).toFixed(1)} MB)`)

// ---------- step 7: cleanup + restore ----------
console.log('\n=== Step 7: Cleanup ===')
fs.rmSync(STAGING, { recursive: true, force: true })
console.log('[build-win] Staging directory removed')

console.log('\n=== Build complete! ===')
// List output
if (fs.existsSync(DIST)) {
  const artifacts = fs.readdirSync(DIST).filter(f => f.endsWith('.exe') && !f.startsWith('win-'))
  for (const a of artifacts) {
    const size = fs.statSync(path.join(DIST, a)).size
    console.log(`  ${a} (${(size / 1024 / 1024).toFixed(1)} MB)`)
  }
  console.log('\n  Users download PULSE.exe — first launch extracts, subsequent launches are instant.')
}
