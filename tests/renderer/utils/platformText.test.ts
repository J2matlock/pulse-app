/** Update and cloud-folder wording fits the computer Pulse runs on (audit X-40, N-25, F-36). */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/renderer/utils/safeInvoke', () => ({ safeInvoke: vi.fn() }))

import { updateText, cloudFolderAdvice, toPlatform } from '../../../src/renderer/utils/platformText'

describe('updateText', () => {
  it('talks about the .exe and PulseData only on Windows', () => {
    const win = updateText('win32')
    expect(win.steps.join(' ')).toMatch(/Windows protected your PC/)
    expect(win.dataNote).toMatch(/PulseData/)
    for (const p of ['darwin', 'linux', 'other', null] as const) {
      const t = updateText(p)
      const all = [t.banner, ...t.steps, t.dataNote].join(' ')
      expect(all).not.toMatch(/\.exe|PULSE\.exe|PulseData|Windows/)
    }
  })

  it('gives Mac and Linux their own steps', () => {
    expect(updateText('darwin').steps.join(' ')).toMatch(/Applications/)
    expect(updateText('linux').steps.join(' ')).toMatch(/AppImage/)
  })

  it('maps unknown platforms to the plain wording', () => {
    expect(toPlatform('freebsd')).toBe('other')
    expect(toPlatform('win32')).toBe('win32')
  })
})

describe('cloudFolderAdvice', () => {
  it('says what to do, naming the service', () => {
    expect(cloudFolderAdvice('OneDrive', 'win32')).toMatch(/inside OneDrive.*move Pulse and its PulseData folder/)
    expect(cloudFolderAdvice('Dropbox', 'darwin')).not.toMatch(/PulseData|C:\\/)
  })
})
