/**
 * staging-deps.js — shared by build-linux.js, build-win.js and build-mac.js.
 *
 * The build scripts package from a clean staging directory. Production
 * dependencies are installed there from package-lock.json with `npm ci`, so
 * what ships is exactly what the tests, sbom.json and THIRD_PARTY_LICENSES.txt
 * describe, never whatever versions happen to be newest on build day.
 */
const fs = require('fs')
const path = require('path')

/** Files every packaged app ships in its resources folder (see package.json build.extraResources). */
const LICENSE_FILES = ['LICENSE', 'THIRD_PARTY_LICENSES.txt']

/**
 * Write the staging package.json and copy package-lock.json and the license
 * files next to it. The staging package.json lists only production
 * dependencies; `npm ci` accepts that because it only checks that every
 * package it would install is in the lock at the same version (dev-only
 * entries are simply not installed).
 */
function writeStagingPackage(root, staging, pkg, buildOverrides) {
  const stagingPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    author: pkg.author,
    main: pkg.main,
    homepage: pkg.homepage,
    dependencies: pkg.dependencies,
    build: { ...pkg.build, ...buildOverrides },
  }
  fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify(stagingPkg, null, 2))
  fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(staging, 'package-lock.json'))
  for (const f of LICENSE_FILES) fs.copyFileSync(path.join(root, f), path.join(staging, f))
}

/**
 * The install command: lockfile versions only, production packages only, no
 * install scripts. No --legacy-peer-deps: package-lock.json was resolved
 * without it, and with it npm drops the lock's peer-reached packages.
 */
const STAGING_INSTALL_CMD = 'npm ci --omit=dev --ignore-scripts'

/**
 * Compare the staged node_modules against package-lock.json. Returns a list
 * of problems (empty when every production package is present at its locked
 * version and nothing unlisted was installed).
 */
function verifyStagedDeps(staging, lock) {
  const problems = []
  const expected = new Map()
  for (const [loc, entry] of Object.entries(lock.packages ?? {})) {
    if (!loc || entry.dev || entry.link) continue
    expected.set(loc, entry)
  }
  for (const [loc, entry] of expected) {
    const pj = path.join(staging, loc, 'package.json')
    if (!fs.existsSync(pj)) {
      // Optional packages for other platforms (e.g. @esbuild/win32-x64) are skipped by npm
      if (!entry.optional && !entry.devOptional) problems.push(`missing ${loc}@${entry.version}`)
      continue
    }
    const installed = JSON.parse(fs.readFileSync(pj, 'utf8')).version
    if (installed !== entry.version) problems.push(`${loc}: installed ${installed}, lock says ${entry.version}`)
  }
  for (const loc of listInstalled(path.join(staging, 'node_modules'), 'node_modules')) {
    if (!expected.has(loc)) problems.push(`not in package-lock.json (or dev-only): ${loc}`)
  }
  return problems
}

// Every package directory under node_modules, as lock-style relative paths
function listInstalled(dir, rel) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue
    if (name.startsWith('@')) {
      for (const sub of fs.readdirSync(path.join(dir, name))) {
        out.push(...packageAt(path.join(dir, name, sub), `${rel}/${name}/${sub}`))
      }
    } else {
      out.push(...packageAt(path.join(dir, name), `${rel}/${name}`))
    }
  }
  return out
}

function packageAt(dir, rel) {
  if (!fs.existsSync(path.join(dir, 'package.json'))) return []
  return [rel, ...listInstalled(path.join(dir, 'node_modules'), `${rel}/node_modules`)]
}

/** Throw if the staged tree doesn't match the lock (call right after STAGING_INSTALL_CMD). */
function assertStagedDepsMatchLock(root, staging) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const problems = verifyStagedDeps(staging, lock)
  if (problems.length) {
    throw new Error(`Staged dependencies don't match package-lock.json:\n  ${problems.slice(0, 30).join('\n  ')}`)
  }
  console.log('[staging] Production dependencies match package-lock.json')
}

module.exports = { LICENSE_FILES, STAGING_INSTALL_CMD, writeStagingPackage, verifyStagedDeps, assertStagedDepsMatchLock }
