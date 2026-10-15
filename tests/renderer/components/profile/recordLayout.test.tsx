// @vitest-environment jsdom
/** 3.4: the note box first, one log of notes, and sections that say what's inside. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React, { useRef } from 'react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: vi.fn().mockReturnValue(() => {}) },
  writable: true, configurable: true,
})
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { CaseLog } from '../../../../src/renderer/components/profile/CaseLog'
import { CollapsibleSection } from '../../../../src/renderer/components/shared/CollapsibleSection'
import { setWords } from '../../vocabFixture'

const note = (extra: Record<string, unknown> = {}) => ({
  id: 5, row_id: 10, content: 'Called about rent', log_type: 'phone', created_at: '2026-10-09 10:00:00', updated_at: '2026-10-09 10:00:00',
  is_pinned: 0, follow_up_date: null, follow_up_completed: 0, original_content: null, edited_at: null, voided_at: null, voided_reason: null, source_action_id: null, ...extra,
})

beforeEach(() => {
  setWords()
  localStorage.clear()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string, ...args: unknown[]) => {
    if (channel === 'case-log:get') {
      const includeVoided = args[2] as boolean
      return Promise.resolve({ ok: true, data: includeVoided
        ? [note({ id: 6, content: 'Wrong person', voided_at: '2026-10-09 11:00:00', voided_reason: 'Entered on the wrong record' }), note({ edited_at: '2026-10-09 12:00:00', updated_at: '2026-10-09 12:00:00' })]
        : [note({ edited_at: '2026-10-09 12:00:00', updated_at: '2026-10-09 12:00:00' })] })
    }
    if (channel === 'case-log:count') {
      const [, , includeVoided, opts] = args as [number, boolean, boolean, { logType?: string } | undefined]
      // Three change entries, one voided note, one live note
      return Promise.resolve({ ok: true, data: opts?.logType === 'system' ? 3 : includeVoided ? 5 : 4 })
    }
    return Promise.resolve({ ok: true, data: null })
  })
})

describe('the note box', () => {
  it('starts as one line and opens when clicked', async () => {
    render(<CaseLog rowId={10} />)
    expect(screen.getByTestId('note-composer').className).toContain('hidden')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Add a case note…/ })) })
    expect(screen.getByTestId('note-composer').className).not.toContain('hidden')
  })

  it('opens and takes the cursor from the header button', async () => {
    let open: (() => void) | null = null
    function Harness() {
      const ref = useRef<(() => void) | null>(null)
      open = () => ref.current?.()
      return <CaseLog rowId={10} focusRef={ref} />
    }
    render(<Harness />)
    await act(async () => { open!(); await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getByTestId('note-composer').className).not.toContain('hidden')
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/Add a note entry/))
  })

  it('shows deadlines and details between the note box and past notes', async () => {
    render(<CaseLog rowId={10} between={<div>DEADLINES HERE</div>} />)
    const order = [screen.getByTestId('note-composer'), screen.getByText('DEADLINES HERE'), await screen.findByText('Called about rent')]
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('one log', () => {
  it('shows earlier versions on the note itself', async () => {
    render(<CaseLog rowId={10} />)
    expect(await screen.findByText(/show earlier versions/)).toBeTruthy()
  })

  it('shows voided notes, crossed out with the reason, on request', async () => {
    render(<CaseLog rowId={10} />)
    await screen.findByText('Called about rent')
    expect(screen.queryByText('Wrong person')).toBeNull()
    await act(async () => { fireEvent.click(await screen.findByLabelText('Show 1 voided case note')) })
    expect(await screen.findByText('Wrong person')).toBeTruthy()
    expect(screen.getByText('Voided: Entered on the wrong record')).toBeTruthy()
    expect(screen.getByText('Wrong person').className).toContain('line-through')
  })

  it('offers "Show voided" only when a voided note exists (C-26)', async () => {
    mockInvoke.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === 'case-log:get') return Promise.resolve({ ok: true, data: [note()] })
      if (channel === 'case-log:count') return Promise.resolve({ ok: true, data: (args[3] as { logType?: string } | undefined)?.logType === 'system' ? 0 : 1 })
      return Promise.resolve({ ok: true, data: null })
    })
    render(<CaseLog rowId={10} />)
    await screen.findByText('Called about rent')
    expect(screen.queryByLabelText(/Show .* voided/)).toBeNull()
    expect(screen.queryByText(/hidden —/)).toBeNull()
  })

  it('says how many changes the filter hides and shows them on request (C-01)', async () => {
    render(<CaseLog rowId={10} />)
    expect(await screen.findByText('3 changes are hidden —')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show them' })) })
    expect(mockInvoke).toHaveBeenCalledWith('case-log:get', 10, true, false, 51, 0, { query: '', oldestFirst: false })
    expect((screen.getByLabelText('What to show') as HTMLSelectElement).value).toBe('everything')
    expect(screen.queryByText('3 changes are hidden —')).toBeNull()
  })

  it('includes changes the app made when asked', async () => {
    render(<CaseLog rowId={10} />)
    await screen.findByText('Called about rent')
    await act(async () => { fireEvent.change(screen.getByLabelText('What to show'), { target: { value: 'changes' } }) })
    expect(mockInvoke).toHaveBeenCalledWith('case-log:get', 10, true, false, 51, 0, { query: '', oldestFirst: false, logType: 'system' })
  })
})

describe('sections', () => {
  it('shows a count and starts collapsed when empty', () => {
    render(<>
      <CollapsibleSection title="Files" sectionKey="files-1" count={0} keepMounted><p>no files</p></CollapsibleSection>
      <CollapsibleSection title="Linked" sectionKey="linked-1" count={2} keepMounted><p>two links</p></CollapsibleSection>
    </>)
    expect(screen.getByRole('button', { name: /Files \(0\)/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: /Linked \(2\)/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('remembers open/closed separately for each list', () => {
    const { unmount } = render(<CollapsibleSection title="Files" sectionKey="profile-files-1" count={3}><p>x</p></CollapsibleSection>)
    fireEvent.click(screen.getByRole('button', { name: /Files \(3\)/ }))
    unmount()
    render(<CollapsibleSection title="Files" sectionKey="profile-files-2" count={3}><p>x</p></CollapsibleSection>)
    expect(screen.getByRole('button', { name: /Files \(3\)/ }).getAttribute('aria-expanded')).toBe('true')
  })
})
