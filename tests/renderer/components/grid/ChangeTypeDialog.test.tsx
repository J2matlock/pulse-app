// @vitest-environment jsdom
/** "Change type…" (audit G-19): a preview before changing, then one undo step. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({ useFocusTrap: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async (channel: string) => {
  if (channel === 'column:type-preview') return { ok: true, data: { total: 3, clean: 2, examples: ['soon'] } }
  if (channel === 'column:change-type') return { ok: true, data: { previousType: 'text', previousConfig: '{}', changed: [{ rowId: 1, old: '10/6/2026' }] } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke }, writable: true, configurable: true })

import { ChangeTypeDialog } from '../../../../src/renderer/components/grid/ChangeTypeDialog'
import { useUndoStore } from '../../../../src/renderer/stores/undoStore'
import type { Column } from '../../../../src/shared/types'

const column = { id: 7, grid_id: 1, name: 'Seen on', column_type: 'text', config: '{}' } as Column

beforeEach(() => { invoke.mockClear(); useUndoStore.getState().clear() })

describe('ChangeTypeDialog', () => {
  it('says how many values fit, changes the type, and can undo it', async () => {
    const onClose = vi.fn()
    render(<ChangeTypeDialog column={column} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('New type'), { target: { value: 'date' } })
    await waitFor(() => expect(screen.getByTestId('type-preview').textContent).toMatch(/2 of 3 values fit\. The other 1 stay as they are.*“soon”/))
    fireEvent.click(screen.getByText('Change type'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(invoke).toHaveBeenCalledWith('column:change-type', 7, 'date')
    expect(useUndoStore.getState().undoStack[0]!.description).toBe('Changed "Seen on" to Date')
    await useUndoStore.getState().undo()
    expect(invoke).toHaveBeenCalledWith('column:change-type-undo', 7, expect.objectContaining({ previousType: 'text' }))
  })
})
