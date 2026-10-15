// @vitest-environment jsdom
/**
 * The security summary fits a school as well as an agency, says one thing about
 * backups, names HIPAA and FERPA without claiming more, and can be printed
 * (persona study #10).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const invoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import {
  SecuritySummaryDialog, SECURITY_SUMMARY_TEXT, REGULATION_TEXT, securitySummaryFor,
} from '../../../../src/renderer/components/shared/SecuritySummaryDialog'
import { setWords } from '../../vocabFixture'

function settingsWith(org: string | null) {
  invoke.mockImplementation((channel: string, key?: string) =>
    Promise.resolve(channel === 'settings:get' && key === 'profile_org' ? { ok: true, data: org } : { ok: false, error: 'nope' }))
}

beforeEach(() => { invoke.mockReset(); setWords(); settingsWith(null) })

describe('security summary wording', () => {
  it('never says "agency"', () => {
    expect(SECURITY_SUMMARY_TEXT).not.toMatch(/agency/i)
  })

  it('says one thing about backups: the ones Pulse makes are encrypted, exports are not', () => {
    expect(SECURITY_SUMMARY_TEXT).toContain('Backups Pulse makes are encrypted')
    const notEncrypted = SECURITY_SUMMARY_TEXT.split('\n').filter(l => /not encrypted/.test(l))
    expect(notEncrypted).toHaveLength(1)
    expect(notEncrypted[0]).toMatch(/exported PDFs and CSVs/)
    expect(notEncrypted[0]).not.toMatch(/backup/i)
  })

  it('names HIPAA and FERPA, leaves the call to the compliance office, and claims no compliance', () => {
    expect(REGULATION_TEXT).toMatch(/\bHIPAA\b/)
    expect(REGULATION_TEXT).toMatch(/\bFERPA\b/)
    expect(REGULATION_TEXT).toContain('Your compliance office makes the final call.')
    expect(REGULATION_TEXT).toContain('no HIPAA or FERPA certification')
    // Nothing that reads as a promise: "is compliant", "certified", "guarantees"
    const claims = REGULATION_TEXT.replace('no HIPAA or FERPA certification', '').replace("doesn't by itself make an organization compliant", '')
    expect(claims).not.toMatch(/\b(compliant|certified|certification|guarantee[sd]?|approved)\b/i)
    expect(SECURITY_SUMMARY_TEXT).toContain(REGULATION_TEXT)
  })

  it('puts the organization name in the heading, with the right possessive', () => {
    expect(securitySummaryFor(SECURITY_SUMMARY_TEXT, null)).toContain("What stays your organization's job")
    expect(securitySummaryFor(SECURITY_SUMMARY_TEXT, '  ')).toContain("What stays your organization's job")
    expect(securitySummaryFor(SECURITY_SUMMARY_TEXT, 'Lincoln Elementary District')).toContain("What stays Lincoln Elementary District's job")
    expect(securitySummaryFor(SECURITY_SUMMARY_TEXT, 'Lincoln Public Schools')).toContain("What stays Lincoln Public Schools' job")
  })
})

describe('SecuritySummaryDialog', () => {
  it('uses the organization from Settings → Profile', async () => {
    settingsWith('Lincoln Elementary District')
    render(<SecuritySummaryDialog open onClose={() => {}} />)
    expect(await screen.findByText("What stays Lincoln Elementary District's job")).toBeTruthy()
    expect(screen.queryByText(/agency/i)).toBeNull()
  })

  it('has a Print button next to Copy, which prints the summary as text', async () => {
    settingsWith('<b>Lincoln</b> District')
    const print = vi.fn()
    const origCreate = document.createElement.bind(document)
    let frame: HTMLIFrameElement | null = null
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, opts?: ElementCreationOptions) => {
      const el = origCreate(tag, opts)
      if (tag === 'iframe') frame = el as HTMLIFrameElement
      return el
    })
    render(<SecuritySummaryDialog open onClose={() => {}} />)
    await screen.findByText("What stays <b>Lincoln</b> District's job")
    expect(screen.getByRole('button', { name: /Copy for my supervisor/ })).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Print' })
    // The print goes to the hidden frame's window
    const realAppend = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      const out = realAppend(node)
      if (node === frame && frame?.contentWindow) Object.defineProperty(frame.contentWindow, 'print', { value: print, configurable: true })
      return out
    })
    fireEvent.click(button)
    await waitFor(() => expect(print).toHaveBeenCalled())
    const doc = (frame as HTMLIFrameElement | null)?.contentDocument
    expect(doc?.querySelector('h1')?.textContent).toMatch(/security at a glance/)
    // The organization name is text, not markup
    expect(doc?.querySelector('b')).toBeNull()
    expect(doc?.body.textContent).toContain("What stays <b>Lincoln</b> District's job")
    expect(doc?.body.textContent).toContain('FERPA')
    expect(doc?.querySelector('style')?.textContent).toMatch(/font-size: 12pt/)
    vi.restoreAllMocks()
  })
})
