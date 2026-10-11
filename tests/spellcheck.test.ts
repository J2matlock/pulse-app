import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { configureSpellchecker, spellcheckAllowed } from '../src/main/spellcheck'

// AUDIT-018: on Windows and Linux Chromium downloads Hunspell dictionaries from
// Google's CDN. The update check must stay Pulse's only network request.
describe('spellchecker setup', () => {
  function mockSession() {
    return { setSpellCheckerEnabled: vi.fn() }
  }

  it.each(['linux', 'win32'] as const)('turns the spellchecker off on %s', (platform) => {
    const ses = mockSession()
    configureSpellchecker(ses, platform)
    expect(ses.setSpellCheckerEnabled).toHaveBeenCalledWith(false)
    expect(spellcheckAllowed(platform)).toBe(false)
  })

  it('keeps the native spellchecker on macOS, which never downloads dictionaries', () => {
    const ses = mockSession()
    configureSpellchecker(ses, 'darwin')
    expect(ses.setSpellCheckerEnabled).toHaveBeenCalledWith(true)
    expect(spellcheckAllowed('darwin')).toBe(true)
  })

  it('is wired into the main process before the window opens', () => {
    const src = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    const configure = src.indexOf('configureSpellchecker(session.defaultSession, process.platform)')
    const firstWindow = src.indexOf('  createWindow()\n')
    expect(configure).toBeGreaterThan(-1)
    expect(firstWindow).toBeGreaterThan(configure)
    expect(src).toContain('spellcheck: spellcheckAllowed(process.platform)')
  })
})
