#!/usr/bin/env node
/**
 * build-linux.js — Build Linux AppImage using a staging directory.
 *
 * electron-builder's node_modules scanner OOMs on large dev trees.
 * This script creates a clean staging directory with only production
 * dependencies, then runs electron-builder from there.
 *
 * Steps:
 *   1. electron-vite build (creates out/)
 *   2. Create staging dir with out/, package.json, and production node_modules
 *   3. Rebuild native module for Linux in staging
 *   4. Run electron-builder --linux from the staging dir
 *   5. Copy artifacts back and clean up
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

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

// Create a minimal package.json for electron-builder
const stagingPkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  author: pkg.author,
  main: pkg.main,
  homepage: pkg.homepage,
  dependencies: pkg.dependencies,
  build: {
    ...pkg.build,
    npmRebuild: false, // we rebuild manually below
  }
}
fs.writeFileSync(
  path.join(STAGING, 'package.json'),
  JSON.stringify(stagingPkg, null, 2)
)

// Install production deps in the staging directory (clean, small tree)
console.log('[build-linux] Installing production dependencies in staging...')
run('npm install --production --ignore-scripts --legacy-peer-deps', { cwd: STAGING })

// Check staging node_modules size
const stagingNmSize = runQuiet(`du -sh "${path.join(STAGING, 'node_modules')}"`)
console.log(`[build-linux] Staging node_modules: ${stagingNmSize.split('\t')[0]}`)

// ---------- step 3: rebuild native module for Linux ----------
console.log('\n=== Step 3: Rebuild native module for Linux ===')
const electronVersion = require('electron/package.json').version
run(`npx electron-rebuild -f -w better-sqlite3-multiple-ciphers --module-dir "${STAGING}"`)

// Verify the native binary is ELF (Linux)
const nativePath = path.join(STAGING, 'node_modules', 'better-sqlite3-multiple-ciphers', 'build', 'Release', 'better_sqlite3.node')
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
if (fs.existsSync(DIST)) {
  const artifacts = fs.readdirSync(DIST).filter(f => f.endsWith('.AppImage'))
  for (const a of artifacts) {
    const size = fs.statSync(path.join(DIST, a)).size
    console.log(`  ${a} (${(size / 1024 / 1024).toFixed(1)} MB)`)
  }
}
