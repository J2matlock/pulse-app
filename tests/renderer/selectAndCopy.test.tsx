// @vitest-environment jsdom
/** 3.8: text can be selected and copied; each note has a Copy button. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { render, screen, fireEvent, act } from '@testing-library/react'

const copyToClipboard = vi.fn(async () => {})
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: () => () => {}, copyToClipboard }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)

import { CaseLogEntry } from '../../src/renderer/components/profile/CaseLogEntry'
import { setWords } from './vocabFixture'
import type { CaseLogEntry as Entry } from '../../src/shared/types'

beforeEach(() => setWords())

describe('selecting text', () => {
  it('is allowed on the page, and switched off only for chrome', () => {
    const css = readFileSync(join(__dirname, '../../src/renderer/styles/globals.css'), 'utf8')
    const body = css.slice(css.indexOf('  body {'), css.indexOf('}', css.indexOf('  body {')))
    expect(body).not.toMatch(/user-select:\s*none/)
    expect(css).toMatch(/button, nav, label[^{]*\{\s*user-select: none;/)
  })
})

describe('copying a note', () => {
  it('copies the note text', async () => {
    const entry = {
      id: 5, row_id: 10, content: 'Called about rent', log_type: 'phone', created_at: '2026-10-01 10:00:00', updated_at: '2026-10-01 10:00:00',
      is_pinned: 0, follow_up_date: null, follow_up_completed: 0, original_content: null, edited_at: null, voided_at: null, voided_reason: null, source_action_id: null,
    } as Entry
    render(<CaseLogEntry entry={entry} onPin={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onVoid={vi.fn()} onCompleteFollowUp={vi.fn()} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })) })
    expect(copyToClipboard).toHaveBeenCalledWith('Called about rent')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
  })
})
