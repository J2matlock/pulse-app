/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
const toastSuccess = vi.fn()
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: (...a: unknown[]) => toastSuccess(...a) }) }))

import { WordsEditor } from '../../../../src/renderer/components/settings/WordsEditor'
import { IPC } from '../../../../src/shared/ipc-channels'
import { HUMAN_SERVICES_VOCAB } from '../../../../src/shared/vocab'
import { setWords } from '../../vocabFixture'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'

const preview = () => screen.getByText(/due this week/).textContent?.replace(/^Preview: /, '')
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save words' }))

beforeEach(() => {
  setWords({})
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((_c: string, patch: { vocab: unknown }) => Promise.resolve({ ok: true, data: { vocab: patch.vocab, features: {}, gridVocab: {} } }))
  toastSuccess.mockReset()
})

describe('WordsEditor', () => {
  it('previews typed words and saves only what differs from the general words', async () => {
    render(<WordsEditor />)
    expect(preview()).toBe('Add a record · 3 records due this week · Record notes · New list')
    expect((screen.getByRole('button', { name: 'Save words' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('What you track: one'), { target: { value: 'animal' } })
    fireEvent.change(screen.getByLabelText('What you track: more than one'), { target: { value: 'animals' } })
    fireEvent.change(screen.getByLabelText('Lists: one'), { target: { value: 'kennel' } })
    expect(preview()).toBe('Add an animal · 3 animals due this week · Animal notes · New kennel')

    save()
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, { vocab: {
      record: { one: 'animal', many: 'animals', article: 'an' },
      list: { one: 'kennel', many: 'lists', article: 'a' },
    } }))
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('describes requirements as calls or visits, not "contacts" (AUDIT-164)', () => {
    render(<WordsEditor />)
    expect(screen.getByText('How many calls or visits each one needs in a period')).toBeTruthy()
    expect(screen.queryByText(/How many contacts/)).toBeNull()
  })

  it('blocks empty words and words with < > { }', () => {
    render(<WordsEditor />)
    fireEvent.change(screen.getByLabelText('Notes: one'), { target: { value: '  ' } })
    expect(screen.getByText('Fill this in')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Notes: one'), { target: { value: '<b>' } })
    expect(screen.getByText('Leave out < > { }')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save words' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('resets to human-services or general words, and discards unsaved changes', async () => {
    render(<WordsEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'Use human-services words' }))
    expect(preview()).toBe('Add a client · 3 clients due this week · Client case notes · New caseload')
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(preview()).toMatch(/^Add a record/)

    fireEvent.click(screen.getByRole('button', { name: 'Use human-services words' }))
    save()
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, expect.objectContaining({ vocab: expect.objectContaining({ record: HUMAN_SERVICES_VOCAB.record }) })))
  })

  it('starts from saved words', () => {
    setWords()
    render(<WordsEditor />)
    expect((screen.getByLabelText('Outside contacts: one') as HTMLInputElement).value).toBe('provider')
    fireEvent.click(screen.getByRole('button', { name: 'Use general words' }))
    expect((screen.getByLabelText('Outside contacts: one') as HTMLInputElement).value).toBe('contact')
  })

  it('saves typed changes when the person leaves the tab (audit X-30)', async () => {
    const { unmount } = render(<WordsEditor />)
    fireEvent.change(screen.getByLabelText('What you track: one'), { target: { value: 'pet' } })
    unmount()
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, expect.objectContaining({ vocab: expect.objectContaining({ record: expect.objectContaining({ one: 'pet' }) }) })))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Your word changes were saved.'))
  })

  it('names the lists that keep their own words (audit X-29)', async () => {
    useGridStore.setState({ grids: [{ id: 3, name: 'Customers' }, { id: 4, name: 'Notes pad' }] as never })
    setWords({}, { 3: { record: { one: 'customer', many: 'customers', article: 'a' } } })
    render(<WordsEditor />)
    expect(screen.getByText(/Lists with their own words keep them/)).toBeTruthy()
    expect(screen.getByText('Customers (customer)')).toBeTruthy()
    expect(screen.queryByText(/Notes pad/)).toBeNull()
    fireEvent.change(screen.getByLabelText('What you track: one'), { target: { value: 'client' } })
    save()
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Words saved. Lists with their own words keep them.'))
    useGridStore.setState({ grids: [] as never })
  })

  it('leaves untouched words alone when the person leaves', () => {
    const { unmount } = render(<WordsEditor />)
    unmount()
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
