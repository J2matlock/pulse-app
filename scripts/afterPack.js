/**
 * afterPack.js — Electron Fuses hardening (security checklist #19).
 * Runs automatically after electron-builder packages the app.
 * Flips fuses in the Electron binary to disable dangerous capabilities.
 */

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
const path = require('path')

// electron-builder's Arch.arm64
let ARM64 = 3
try { ARM64 = require('electron-builder').Arch.arm64 } catch { /* keep the known value */ }

/** Platforms where electron-builder embeds the asar integrity hash */
function asarIntegritySupported(platform) {
  return platform === 'darwin' || platform === 'win32'
}

module.exports = async function afterPack(context) {
  const { electronPlatformName, appOutDir } = context
  const productName = context.packager.appInfo.productFilename

  const fs = require('fs')
  const executableName = context.packager.platformSpecificBuildOptions?.executableName

  let electronBinary
  if (electronPlatformName === 'darwin') {
    electronBinary = path.join(appOutDir, `${productName}.app`)
  } else if (electronPlatformName === 'win32') {
    electronBinary = path.join(appOutDir, `${productName}.exe`)
  } else {
    // Linux — try executableName first, then productName, then package name
    const candidates = [executableName, productName, context.packager.appInfo.name].filter(Boolean)
    electronBinary = candidates
      .map(name => path.join(appOutDir, name))
      .find(p => fs.existsSync(p))
    if (!electronBinary) {
      console.warn(`Could not find Electron binary in ${appOutDir}, skipping fuse flip`)
      return
    }
  }

  console.log(`Flipping Electron fuses in: ${electronBinary}`)

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    // Prevent ELECTRON_RUN_AS_NODE from turning the app into a plain Node process
    [FuseV1Options.RunAsNode]: false,
    // Encrypt cookies at rest
    [FuseV1Options.EnableCookieEncryption]: true,
    // Prevent --inspect from attaching a debugger to the packaged app
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // Only load app code from the ASAR archive — prevents code injection via loose files
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // Prevent NODE_OPTIONS env var from modifying the Electron runtime
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    // Prevent file:// protocol from gaining extra privileges
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    // Refuse to start if app.asar was changed after packaging (AUDIT-094/186).
    // electron-builder embeds the asar hash only on Windows and macOS; Electron
    // has no asar integrity check on Linux, so the fuse stays off there.
    // Before shipping a release, test-launch it on Windows AND macOS: if the
    // hash isn't embedded, this fuse stops the app from starting at all.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: asarIntegritySupported(electronPlatformName),
    // Flipping fuses breaks the ad-hoc signature of an unsigned Apple Silicon
    // build, and macOS won't launch it. Re-sign ad hoc (real signing comes later).
    resetAdHocDarwinSignature: electronPlatformName === 'darwin' && context.arch === ARM64,
  })

  console.log(`Electron fuses applied successfully (asar integrity ${asarIntegritySupported(electronPlatformName) ? 'on' : 'off'} for ${electronPlatformName}).`)
}

module.exports.asarIntegritySupported = asarIntegritySupported
