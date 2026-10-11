import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'

const ROOT = join(__dirname, '..')
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')

describe('macOS entitlements', () => {
  // AUDIT-191: keep the hardened runtime as tight as Electron allows
  it('allows the V8 JIT but not unsigned executable memory', () => {
    const plist = read('build/entitlements.mac.plist')
    expect(plist).toContain('<key>com.apple.security.cs.allow-jit</key>')
    expect(plist).not.toContain('<key>com.apple.security.cs.allow-unsigned-executable-memory</key>')
  })
})

describe('app.asar contents', () => {
  // AUDIT-187: source maps and the SQLite C sources aren't needed at runtime
  it('leaves out node_modules source maps and the native module sources', () => {
    const files = JSON.parse(read('package.json')).build.files as string[]
    expect(files).toContain('!**/node_modules/**/*.map')
    expect(files).toContain('!**/node_modules/better-sqlite3-multiple-ciphers/{deps,src}${/*}')
    // The compiled module itself must still ship (and be unpacked from the asar)
    expect(files.some(f => f.includes('build') && f.startsWith('!'))).toBe(false)
    expect(JSON.parse(read('package.json')).build.asarUnpack).toContain('**/*.node')
  })
})

describe('native database module', () => {
  // better-sqlite3-multiple-ciphers 13 bundles a Node-API binary for every
  // platform; each build keeps its own and leaves the rest out
  const build = JSON.parse(read('package.json')).build
  const dropped = (platform: 'linux' | 'win' | 'mac') => (build[platform].files as string[]).join(' ')
  it("ships only the platform's own prebuilt binaries", () => {
    expect(dropped('linux')).toMatch(/!\*\*\/node_modules\/better-sqlite3-multiple-ciphers\/prebuilds\/\{win32,darwin,linuxmusl\}-\*\.node/)
    expect(dropped('win')).toMatch(/prebuilds\/\{linux,linuxmusl,darwin\}-\*\.node/)
    expect(dropped('mac')).toMatch(/prebuilds\/\{linux,linuxmusl,win32\}-\*\.node/)
  })
})

describe('Linux package', () => {
  const pkg = JSON.parse(read('package.json'))
  it('builds only the AppImage', () => {
    expect(pkg.build.linux.target).toEqual(['AppImage'])
    expect(pkg.build.deb).toBeUndefined()
  })

  it('does not turn the sandbox off', () => {
    expect(JSON.stringify(pkg.build)).not.toContain('no-sandbox')
    expect(read('README.md')).not.toContain('--no-sandbox')
  })
})

describe('Electron fuses', () => {
  // AUDIT-094/186: electron-builder embeds the asar hash on Windows and macOS only
  const afterPack = createRequire(import.meta.url)('../scripts/afterPack.js') as { asarIntegritySupported: (p: string) => boolean }
  it('checks asar integrity on Windows and macOS, never on Linux', () => {
    expect(afterPack.asarIntegritySupported('win32')).toBe(true)
    expect(afterPack.asarIntegritySupported('darwin')).toBe(true)
    expect(afterPack.asarIntegritySupported('linux')).toBe(false)
    expect(read('scripts/afterPack.js')).toContain('[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: asarIntegritySupported(electronPlatformName)')
  })
})

describe('Windows launcher', () => {
  // AUDIT-091: a version change used to force-kill Pulse, losing edits still being typed
  it('asks Pulse to close before forcing it', () => {
    const iss = read('scripts/pulse-launcher.iss')
    const code = iss.slice(iss.indexOf('[Code]'))
    const graceful = code.indexOf("Exec('taskkill.exe', '/IM \"Pulse by BaringaSoft.exe\"'")
    const forced = code.indexOf("'/F /IM \"Pulse by BaringaSoft.exe\" /T'")
    expect(graceful).toBeGreaterThan(-1)
    expect(forced).toBeGreaterThan(graceful)
    expect(code).toMatch(/while IsPulseRunning and \(Waited < \d+\) do/)
    expect(code).toContain('CloseRunningInstance;')
  })

  it("clears the old version's app files before extracting", () => {
    const iss = read('scripts/pulse-launcher.iss')
    expect(iss).toContain('[InstallDelete]')
    expect(iss).toContain('Type: filesandordirs; Name: "{app}\\resources"')
  })
})
