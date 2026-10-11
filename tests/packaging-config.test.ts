import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

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
