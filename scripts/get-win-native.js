#!/usr/bin/env node
/**
 * Downloads the Windows prebuilt native binary for better-sqlite3-multiple-ciphers.
 * Run this before electron-builder --win when cross-compiling from Linux.
 *
 * The prebuild-install tool fetches the correct PE32+ DLL from the package's
 * GitHub releases, matching the Electron ABI version.
 *
 *   node scripts/get-win-native.js [package dir]
 *
 * build-win.js passes the staging copy of the package, so the dev tree's
 * native binary (built for Linux) is never overwritten. With no argument it
 * writes into the dev tree's node_modules; run electron-rebuild afterwards.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const pkgDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'node_modules', 'better-sqlite3-multiple-ciphers');
const electronVersion = require('electron/package.json').version;

// Resolve prebuild-install from within the package's own deps first, then fallback
let prebuildInstall;
try {
  prebuildInstall = require.resolve('prebuild-install/bin.js', { paths: [pkgDir] });
} catch {
  prebuildInstall = require.resolve('prebuild-install/bin.js');
}

const buildDir = path.join(pkgDir, 'build', 'Release');
const binaryPath = path.join(buildDir, 'better_sqlite3.node');

console.log(`[get-win-native] Downloading win32-x64 prebuilt for Electron ${electronVersion}...`);

const saved = process.cwd();
process.chdir(pkgDir);
try {
  execSync(
    `node "${prebuildInstall}" --platform win32 --arch x64 --runtime electron --target ${electronVersion}`,
    { stdio: 'inherit' }
  );
} finally {
  process.chdir(saved);
}

// Verify the downloaded binary is actually PE32+
const { execSync: exec2 } = require('child_process');
const fileType = exec2(`file "${binaryPath}"`).toString();
if (!fileType.includes('PE32+')) {
  console.error(`[get-win-native] ERROR: Downloaded binary is not PE32+!`);
  console.error(`  file output: ${fileType.trim()}`);
  process.exit(1);
}

console.log(`[get-win-native] OK — Windows binary installed at ${binaryPath}`);
