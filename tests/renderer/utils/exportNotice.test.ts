// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const toastFn = vi.hoisted(() => vi.fn())
vi.mock('react-hot-toast', () => ({ default: toastFn }))

import { noteUnencryptedExport, resetExportNotice, clientFileName } from '../../../src/renderer/utils/exportNotice'

describe('export notice', () => {
  beforeEach(() => { toastFn.mockClear(); resetExportNotice() })

  it('shows once per session', () => {
    noteUnencryptedExport()
    noteUnencryptedExport()
    expect(toastFn).toHaveBeenCalledTimes(1)
    expect(String(toastFn.mock.calls[0]![0])).toMatch(/aren't encrypted/)
  })

  it('default file names use initials, never the full client name', () => {
    const name = clientFileName('Maria Garcia', 'profile', 'pdf')
    expect(name).toMatch(/^MG_profile_\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(name).not.toContain('Maria')
    expect(clientFileName('', 'profile', 'pdf')).toMatch(/^record_profile_/)
  })

  it('names things and jobs in full, safely', () => {
    expect(clientFileName('2017 Honda Civic – ABC123', 'profile', 'pdf', 'thing')).toMatch(/^2017 Honda Civic ABC123_profile_\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(clientFileName('J-0001 Fix ../sink', 'profile', 'pdf', 'job')).toMatch(/^J-0001 Fix ..sink_profile_/)
    expect(clientFileName('Maria Garcia', 'profile', 'pdf', 'person')).toMatch(/^MG_profile_/)
    expect(clientFileName('***', 'profile', 'pdf', 'thing')).toMatch(/^record_profile_/)
  })
})
