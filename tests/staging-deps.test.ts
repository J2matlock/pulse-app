import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// AUDIT-086 / AUDIT-088: the packaging scripts install production deps from
// package-lock.json and stage the license files that ship in resources/.
const require = createRequire(import.meta.url)
const staging = require('../scripts/staging-deps.js') as {
  LICENSE_FILES: string[]
  STAGING_INSTALL_CMD: string
  writeStagingPackage: (root: string, staging: string, pkg: Record<string, unknown>, overrides: Record<string, unknown>) => void
  verifyStagedDeps: (staging: string, lock: { packages: Record<string, Record<string, unknown>> }) => string[]
}

const ROOT = join(__dirname, '..')

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pulse-staging-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function installPkg(loc: string, version: string) {
  mkdirSync(join(dir, loc), { recursive: true })
  writeFileSync(join(dir, loc, 'package.json'), JSON.stringify({ name: loc.split('node_modules/').pop(), version }))
}

describe('staging install', () => {
  it('uses npm ci with the lockfile, production packages only', () => {
    expect(staging.STAGING_INSTALL_CMD).toMatch(/^npm ci /)
    expect(staging.STAGING_INSTALL_CMD).toContain('--omit=dev')
    expect(staging.STAGING_INSTALL_CMD).toContain('--ignore-scripts')
    expect(staging.STAGING_INSTALL_CMD).not.toMatch(/npm install/)
  })

  it('every build script installs through the shared helper and checks the result', () => {
    for (const f of ['build-linux.js', 'build-win.js', 'build-mac.js']) {
      const src = readFileSync(join(ROOT, 'scripts', f), 'utf8')
      expect(src, f).not.toMatch(/npm install/)
      expect(src, f).toContain('run(STAGING_INSTALL_CMD, { cwd: STAGING })')
      expect(src, f).toContain('assertStagedDepsMatchLock(ROOT, STAGING)')
      expect(src, f).toContain('writeStagingPackage(ROOT, STAGING, pkg')
    }
  })

  it('build-win checks the bundled Windows binary in staging, not the dev tree', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'build-win.js'), 'utf8')
    expect(src).toMatch(/stagingSqlite = path\.join\(STAGING, 'node_modules', 'better-sqlite3-multiple-ciphers'\)/)
    expect(src).toMatch(/path\.join\(stagingSqlite, 'prebuilds', 'win32-x64\.node'\)/)
    expect(src).toContain("includes('PE32+')")
    expect(src).not.toMatch(/nativeSrc = path\.join\(ROOT/)
  })

  it('build-linux builds and checks both the AppImage and the .deb', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'build-linux.js'), 'utf8')
    expect(src).toContain('.AppImage`')
    expect(src).toContain('.deb`')
    expect(src).toMatch(/path\.join\(STAGING, 'node_modules', 'better-sqlite3-multiple-ciphers', 'prebuilds', 'linux-x64\.node'\)/)
    expect(src).toContain("includes('ELF')")
  })

  it('writes the staging package.json and copies the lock and license files', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    staging.writeStagingPackage(ROOT, dir, pkg, { npmRebuild: false })
    const written = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(written.dependencies).toEqual(pkg.dependencies)
    expect(written.build.npmRebuild).toBe(false)
    expect(written.build.appId).toBe(pkg.build.appId)
    expect(readFileSync(join(dir, 'package-lock.json'), 'utf8')).toBe(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))
    for (const f of staging.LICENSE_FILES) expect(existsSync(join(dir, f)), f).toBe(true)
  })
})

describe('verifyStagedDeps', () => {
  const lock = {
    packages: {
      '': { name: 'app', version: '1.0.0' },
      'node_modules/a': { version: '1.0.0' },
      'node_modules/@s/b': { version: '2.0.0' },
      'node_modules/a/node_modules/c': { version: '3.0.0' },
      'node_modules/opt': { version: '1.0.0', optional: true },
      'node_modules/devonly': { version: '1.0.0', dev: true },
    },
  }

  it('passes when the staged tree matches the lock', () => {
    installPkg('node_modules/a', '1.0.0')
    installPkg('node_modules/@s/b', '2.0.0')
    installPkg('node_modules/a/node_modules/c', '3.0.0')
    expect(staging.verifyStagedDeps(dir, lock)).toEqual([])
  })

  it('reports a version that drifted from the lock', () => {
    installPkg('node_modules/a', '1.0.1')
    installPkg('node_modules/@s/b', '2.0.0')
    installPkg('node_modules/a/node_modules/c', '3.0.0')
    expect(staging.verifyStagedDeps(dir, lock)).toEqual(['node_modules/a: installed 1.0.1, lock says 1.0.0'])
  })

  it('reports missing, unlisted and dev-only packages', () => {
    installPkg('node_modules/a', '1.0.0')
    installPkg('node_modules/a/node_modules/c', '3.0.0')
    installPkg('node_modules/surprise', '9.9.9')
    installPkg('node_modules/devonly', '1.0.0')
    const problems = staging.verifyStagedDeps(dir, lock)
    expect(problems).toContain('missing node_modules/@s/b@2.0.0')
    expect(problems).toContain('not in package-lock.json (or dev-only): node_modules/surprise')
    expect(problems).toContain('not in package-lock.json (or dev-only): node_modules/devonly')
    expect(problems).toHaveLength(3)
  })
})
