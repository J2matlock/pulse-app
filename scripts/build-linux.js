#!/usr/bin/env node
/**
 * build-linux.js — Build the Linux AppImage using a staging directory.
 *
 * electron-builder's node_modules scanner OOMs on large dev trees.
 * This script creates a clean staging directory with only production
 * dependencies, then runs electron-builder from there.
 *
 * Steps:
 *   1. electron-vite build (creates out/)
 *   2. Create staging dir with out/, package.json, package-lock.json and
 *      production node_modules (npm ci, so versions match the lock)
 *   3. Check the SQLCipher module's bundled Linux binary (Node-API, so the
 *      same prebuilt binary works with any Electron version; no rebuild)
 *   4. Run electron-builder --linux from the staging dir
 *   5. Check the AppImage exists, copy it to dist/ and clean up
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
  console.log('[build-linux] Cleaning prior staging dir...')
  fs.rmSync(STAGING, { recursive: true, force: true })
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
  npmRebuild: false, // the native module ships prebuilt (Node-API)
})

// Install production deps in the staging directory (clean, small tree), at
// exactly the versions in package-lock.json
console.log('[build-linux] Installing production dependencies in staging...')
run(STAGING_INSTALL_CMD, { cwd: STAGING })
assertStagedDepsMatchLock(ROOT, STAGING)

// Check staging node_modules size
const stagingNmSize = runQuiet(`du -sh "${path.join(STAGING, 'node_modules')}"`)
console.log(`[build-linux] Staging node_modules: ${stagingNmSize.split('\t')[0]}`)

// ---------- step 3: check the native module ----------
console.log('\n=== Step 3: Check native module for Linux ===')
const electronVersion = require('electron/package.json').version

// better-sqlite3-multiple-ciphers 13+ bundles a Node-API binary per platform;
// package.json build.linux.files leaves the other platforms' binaries out
const nativePath = path.join(STAGING, 'node_modules', 'better-sqlite3-multiple-ciphers', 'prebuilds', 'linux-x64.node')
if (fs.existsSync(nativePath)) {
  const fileType = runQuiet(`file "${nativePath}"`)
  if (!fileType.includes('ELF')) {
    console.error('[build-linux] ERROR: Native binary is not ELF!')
    console.error(`  file output: ${fileType}`)
    process.exit(1)
  }
  console.log('[build-linux] Native binary verified (ELF)')
} else {
  console.error('[build-linux] ERROR: Native binary not found at expected path')
  process.exit(1)
}

// Copy @electron/fuses into staging node_modules (needed by afterPack.js)
const fusesSource = path.join(ROOT, 'node_modules', '@electron', 'fuses')
const fusesDest = path.join(STAGING, 'node_modules', '@electron', 'fuses')
if (fs.existsSync(fusesSource)) {
  fs.mkdirSync(path.join(STAGING, 'node_modules', '@electron'), { recursive: true })
  execSync(`cp -r "${fusesSource}" "${fusesDest}"`)
  const nodeInt64Src = path.join(ROOT, 'node_modules', 'node-int64')
  const nodeInt64Dest = path.join(STAGING, 'node_modules', 'node-int64')
  if (fs.existsSync(nodeInt64Src) && !fs.existsSync(nodeInt64Dest)) {
    execSync(`cp -r "${nodeInt64Src}" "${nodeInt64Dest}"`)
  }
}

// ---------- step 4: run electron-builder ----------
console.log('\n=== Step 4: electron-builder --linux ===')
run(`npx electron-builder --linux --project "${STAGING}" -c.electronVersion=${electronVersion}`, { cwd: ROOT })

// ---------- step 5: copy artifacts ----------
console.log('\n=== Step 5: Copy artifacts ===')
const stagingDist = path.join(STAGING, 'dist')
// The AppImage must have been built (a missing AppImage tool can fail quietly)
const artifacts = [`BaringaSoftPulse-${pkg.version}.AppImage`]
for (const a of artifacts) {
  if (!fs.existsSync(path.join(stagingDist, a))) {
    console.error(`[build-linux] ERROR: ${a} was not built`)
    process.exit(1)
  }
}
if (fs.existsSync(stagingDist)) {
  fs.mkdirSync(DIST, { recursive: true })
  const files = fs.readdirSync(stagingDist)
  for (const f of files) {
    const src = path.join(stagingDist, f)
    const dest = path.join(DIST, f)
    const stat = fs.statSync(src)
    if (stat.isFile()) {
      fs.copyFileSync(src, dest)
      console.log(`  Copied: ${f}`)
    } else if (stat.isDirectory()) {
      execSync(`cp -r "${src}" "${dest}"`)
      console.log(`  Copied dir: ${f}`)
    }
  }
}

// ---------- step 6: cleanup ----------
console.log('\n=== Step 6: Cleanup ===')
fs.rmSync(STAGING, { recursive: true, force: true })
console.log('[build-linux] Staging directory removed')

console.log('\n=== Build complete! ===')
for (const a of artifacts) {
  const size = fs.statSync(path.join(DIST, a)).size
  console.log(`  ${a} (${(size / 1024 / 1024).toFixed(1)} MB)`)
}
