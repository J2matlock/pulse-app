import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { licenseFilePath, isLicenseDoc } from '../src/main/license-files'

// AUDIT-088: LICENSE and THIRD_PARTY_LICENSES.txt ship in resources/ and the
// About screen opens them from there.
const ROOT = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

describe('bundled license files', () => {
  it('are listed in electron-builder extraResources', () => {
    const extra = pkg.build.extraResources as { from: string; to: string }[]
    expect(extra).toContainEqual({ from: 'LICENSE', to: 'LICENSE.txt' })
    expect(extra).toContainEqual({ from: 'THIRD_PARTY_LICENSES.txt', to: 'THIRD_PARTY_LICENSES.txt' })
    for (const e of extra) expect(existsSync(join(ROOT, e.from)), e.from).toBe(true)
  })

  it('resolve to the packaged names in a packaged app', () => {
    const extraTo = (pkg.build.extraResources as { to: string }[]).map(e => e.to)
    for (const which of ['license', 'third-party'] as const) {
      const p = licenseFilePath(which, true, '/res', '/app')
      expect(p.startsWith(join('/res'))).toBe(true)
      expect(extraTo).toContain(p.slice(join('/res').length + 1))
    }
  })

  it('resolve to the project files in development', () => {
    expect(existsSync(licenseFilePath('license', false, '/nowhere', ROOT))).toBe(true)
    expect(existsSync(licenseFilePath('third-party', false, '/nowhere', ROOT))).toBe(true)
  })

  it('accepts only the two known documents', () => {
    expect(isLicenseDoc('license')).toBe(true)
    expect(isLicenseDoc('third-party')).toBe(true)
    expect(isLicenseDoc('../../etc/passwd')).toBe(false)
    expect(isLicenseDoc(1)).toBe(false)
  })

  // AUDIT-192: the C code compiled into better_sqlite3.node needs its notices too
  it('include the statically linked SQLite and SQLite3 Multiple Ciphers notices', () => {
    const notices = readFileSync(join(ROOT, 'THIRD_PARTY_LICENSES.txt'), 'utf8')
    const native = readFileSync(join(ROOT, 'scripts', 'native-notices.txt'), 'utf8').trim()
    expect(notices).toContain(native)
    expect(native).toContain('Ulrich Telle')
    expect(native).toContain('May you do good and not evil.')
    expect(readFileSync(join(ROOT, 'scripts', 'third-party-licenses.mjs'), 'utf8')).toContain("'native-notices.txt'")
  })

  it('give MIT packages without a license file the MIT terms', () => {
    const notices = readFileSync(join(ROOT, 'THIRD_PARTY_LICENSES.txt'), 'utf8')
    expect(notices).not.toMatch(/Its package\.json declares: MIT\)/)
  })
})
