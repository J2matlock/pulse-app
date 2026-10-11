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
