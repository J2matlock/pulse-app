// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

// ── Global mocks ────────────────────────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn },
  writable: true,
})

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      const { variants, initial, animate, exit, ...rest } = props
      return <div ref={ref} {...rest} />
    }),
  },
}))

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/utils/animations', () => ({
  backdropVariants: {},
  modalPanelVariants: {},
}))

vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

// ── Component import ────────────────────────────────────────────────────────

import { ImportWizard } from '../../../../src/renderer/components/grid/ImportWizard'
import { splitWarning } from '../../../../src/renderer/components/grid/importWizardShared'
import { useAlertStore } from '../../../../src/renderer/stores/alertStore'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

describe('ImportWizard', () => {
  let onClose: ReturnType<typeof vi.fn>
  let onImported: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    onClose = vi.fn()
    onImported = vi.fn()
  })

  it('renders nothing when open is false', () => {
    const { container } = render(
      <ImportWizard open={false} gridId={1} onClose={onClose} onImported={onImported} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders dialog when open is true', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('renders Import Clients title', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    expect(screen.getByText('Import Clients')).toBeTruthy()
  })

  it('renders file selection step with browse area', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    expect(screen.getByText(/Drop a CSV or Excel file here/)).toBeTruthy()
    expect(screen.getByText('Supports .csv and .xlsx')).toBeTruthy()
  })

  it('renders step indicator with Choose a file active', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    expect(screen.getByText('Choose a file')).toBeTruthy()
  })

  it('puts focus on the drop zone, not the ✕ (UX-A-33)', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    expect(document.activeElement).toBe(screen.getByLabelText('Click to browse for a file, or drop a file here'))
  })

  it('close button calls onClose', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    const closeBtn = screen.getByLabelText('Close')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape key calls onClose', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('browse area triggers file dialog IPC', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, data: { canceled: true, filePaths: [] } })
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    const browseArea = screen.getByLabelText('Click to browse for a file, or drop a file here')
    fireEvent.click(browseArea)
    expect(mockInvoke).toHaveBeenCalled()
  })

  describe('ways in that used to fail (audit X-14, X-15, X-18)', () => {
    it('does not offer "Paste from clipboard", which could never work', () => {
      render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
      expect(screen.queryByText('Paste from clipboard')).toBeNull()
    })

    it('reads a dropped file through the preload path bridge', async () => {
      const pathForFile = vi.fn().mockReturnValue('/home/me/dropped.csv')
      Object.assign(window.api as object, { pathForFile })
      mockInvoke.mockResolvedValue({ ok: false, error: 'stop here' })
      render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
      const file = new File(['Name\nAl'], 'dropped.csv', { type: 'text/csv' })
      fireEvent.drop(screen.getByLabelText('Click to browse for a file, or drop a file here'), { dataTransfer: { files: [file] } })
      await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('import:file-preview', '/home/me/dropped.csv', undefined, undefined))
      expect(pathForFile).toHaveBeenCalledWith(file)
    })

    it('explains how to convert an old .xls file', async () => {
      mockInvoke.mockResolvedValueOnce({ ok: true, data: { canceled: false, filePaths: ['/home/me/agency.xls'] } })
      render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
      fireEvent.click(screen.getByLabelText('Click to browse for a file, or drop a file here'))
      expect(await screen.findByText(/Save As → Excel Workbook \(\.xlsx\)/)).toBeTruthy()
      expect(mockInvoke).not.toHaveBeenCalledWith('import:file-preview', expect.anything(), undefined, undefined)
    })
  })

  describe('a full import', () => {
    const preview = {
      sheets: ['Sheet1'], activeSheet: 0, headers: ['Name', 'Notes'],
      rows: [['Al', 'Called Tuesday']],
      detectedColumns: [
        { index: 0, originalName: 'Name', detectedType: 'text', samples: ['Al'] },
        { index: 1, originalName: 'Notes', detectedType: 'text', samples: ['Called Tuesday'] },
      ],
      detectedHeaderRow: 0, headerDetectionConfidence: 'high', rawRowCount: 2,
    }
    beforeEach(() => {
      mockInvoke.mockImplementation((channel: string) => {
        switch (channel) {
          case 'app:show-file-dialog': return Promise.resolve({ ok: true, data: { canceled: false, filePaths: ['/home/me/list.csv'] } })
          case 'import:file-preview': return Promise.resolve({ ok: true, data: preview })
          case 'import:detect-columns': return Promise.resolve({ ok: true, data: [{ sourceIndex: 0, action: 7 }, { sourceIndex: 1, action: 'create', newName: 'Notes', newType: 'text' }] })
          case 'grid:get': return Promise.resolve({ ok: true, data: { columns: [{ id: 7, name: 'Name', column_type: 'text' }] } })
          case 'import:file': return Promise.resolve({ ok: true, data: { imported: 3, skipped: 2, warnings: [], skippedNames: ['Maria Garcia', 'Bob Lee'] } })
          default: return Promise.resolve({ ok: true, data: null })
        }
      })
    })

    async function goToMapping() {
      render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
      fireEvent.click(screen.getByLabelText('Click to browse for a file, or drop a file here'))
      fireEvent.click(await screen.findByRole('button', { name: /Next/ }))
      await screen.findByText(/Choose where each column in your file goes/)
    }

    it('keeps a Notes column as text, and says why', async () => {
      await goToMapping()
      expect(screen.getByText('Notes come in as a text column, so nothing is lost.')).toBeTruthy()
      const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
      expect(selects.some(s => s.value === 'create')).toBe(true)
      expect(selects.some(s => s.value === 'skip')).toBe(false)
    })

    it('names column types in plain words, not "currency" or "checkbox" (polish R5)', async () => {
      await goToMapping()
      expect(screen.getAllByRole('option', { name: 'Money ($)' }).length).toBeGreaterThan(0)
      expect(screen.queryByRole('option', { name: 'currency' })).toBeNull()
    })

    it('a developer error from the import becomes a plain sentence (polish R5)', async () => {
      const base = mockInvoke.getMockImplementation()!
      mockInvoke.mockImplementation((channel: string, ...args: unknown[]) =>
        channel === 'import:file' ? Promise.resolve({ ok: false, error: 'Invalid grid ID' }) : base(channel, ...args))
      await goToMapping()
      fireEvent.click(screen.getByRole('button', { name: /Next/ }))
      fireEvent.click(await screen.findByRole('button', { name: /^Import/ }))
      expect((await screen.findAllByText('The import failed. Please check your file and try again.')).length).toBeGreaterThan(0)
      expect(screen.queryByText('Invalid grid ID')).toBeNull()
    })

    it('can undo the import, moving the new records to Trash (audit X-19)', async () => {
      const base = mockInvoke.getMockImplementation()!
      mockInvoke.mockImplementation((channel: string, ...args: unknown[]) => {
        if (channel === 'import:file') return Promise.resolve({ ok: true, data: { imported: 2, skipped: 0, warnings: [], skippedNames: [], newRowIds: [41, 42] } })
        if (channel === 'import:undo') return Promise.resolve({ ok: true, data: { moved: 2 } })
        return base(channel, ...args)
      })
      await goToMapping()
      fireEvent.click(screen.getByRole('button', { name: /Next/ }))
      fireEvent.click(await screen.findByRole('button', { name: /^Import/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'Undo this import' }))
      expect(await screen.findByText(/in the Trash, where they can be restored/)).toBeTruthy()
      expect(mockInvoke).toHaveBeenCalledWith('import:undo', 1, [41, 42])
    })

    it('keeps a Back button after a failed import', async () => {
      const base = mockInvoke.getMockImplementation()!
      mockInvoke.mockImplementation((channel: string, ...args: unknown[]) =>
        channel === 'import:file' ? Promise.resolve({ ok: false, error: 'Invalid column type' }) : base(channel, ...args))
      await goToMapping()
      fireEvent.click(screen.getByRole('button', { name: /Next/ }))
      fireEvent.click(await screen.findByRole('button', { name: /^Import/ }))
      expect(await screen.findByText('Import failed')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /Back/ }))
      expect(await screen.findByText(/If a name is already in this/)).toBeTruthy()
    })

    it.each([
      ['the ✕ button', () => fireEvent.click(screen.getByLabelText('Close'))],
      ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ])('closing a finished import with %s still reports it, so the list reloads', async (_how, closeIt) => {
      await goToMapping()
      fireEvent.click(screen.getByRole('button', { name: /Next/ }))
      fireEvent.click(await screen.findByRole('button', { name: /^Import/ }))
      await screen.findByText(/3 .* imported/)
      closeIt()
      expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ imported: 3 }))
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('an undone import is reported as undone', async () => {
      const base = mockInvoke.getMockImplementation()!
      mockInvoke.mockImplementation((channel: string, ...args: unknown[]) => {
        if (channel === 'import:file') return Promise.resolve({ ok: true, data: { imported: 2, skipped: 0, warnings: [], newRowIds: [41, 42] } })
        if (channel === 'import:undo') return Promise.resolve({ ok: true, data: { moved: 2 } })
        return base(channel, ...args)
      })
      await goToMapping()
      fireEvent.click(screen.getByRole('button', { name: /Next/ }))
      fireEvent.click(await screen.findByRole('button', { name: /^Import/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'Undo this import' }))
      await screen.findByText(/in the Trash, where they can be restored/)
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
      expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ undone: true }))
    })

    describe('hidden spreadsheet rows (AUDIT-127)', () => {
      function withHidden(extra: Record<string, unknown>) {
        const base = mockInvoke.getMockImplementation()!
        mockInvoke.mockImplementation((channel: string, ...args: unknown[]) =>
          channel === 'import:file-preview' ? Promise.resolve({ ok: true, data: { ...preview, ...extra } }) : base(channel, ...args))
      }
      async function openPreview() {
        render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
        fireEvent.click(screen.getByLabelText('Click to browse for a file, or drop a file here'))
        await screen.findByRole('button', { name: /Next/ })
      }
      async function runImport() {
        fireEvent.click(screen.getByRole('button', { name: /Next/ }))
        await screen.findByText(/Choose where each column in your file goes/)
        fireEvent.click(screen.getByRole('button', { name: /Next/ }))
        fireEvent.click(await screen.findByRole('button', { name: /^Import/ }))
        await screen.findByText(/3 .* imported/)
        const call = mockInvoke.mock.calls.find(c => c[0] === 'import:file')
        return call?.[1] as { skipHiddenRows?: boolean }
      }

      it('counts hidden rows and columns, and imports them unless left out', async () => {
        withHidden({ hiddenRowCount: 3, hiddenColumns: ['Old code'] })
        await openPreview()
        expect(screen.getByText(/This spreadsheet has 3 hidden rows/)).toBeTruthy()
        expect(screen.getByText(/Hidden column in the spreadsheet: Old code/)).toBeTruthy()
        const box = screen.getByLabelText('Leave out 3 hidden rows') as HTMLInputElement
        expect(box.checked).toBe(false)
        expect((await runImport()).skipHiddenRows).toBe(false)
      })

      it('sends the choice to leave them out', async () => {
        withHidden({ hiddenRowCount: 1, hiddenColumns: [] })
        await openPreview()
        fireEvent.click(screen.getByLabelText('Leave out 1 hidden row'))
        expect((await runImport()).skipHiddenRows).toBe(true)
      })

      it('says nothing when nothing is hidden', async () => {
        withHidden({ hiddenRowCount: 0, hiddenColumns: [] })
        await openPreview()
        expect(screen.queryByText(/hidden/i)).toBeNull()
      })
    })

    it('numbers the steps a CSV shows 1 to 5, with no gap for the sheet step (UX-B-33)', async () => {
      await goToMapping()
      const current = document.querySelector('[aria-current="step"]')!
      expect(current.textContent).toContain('3')
      expect(current.textContent).toContain('Match columns')
      expect(screen.queryByText('Sheet')).toBeNull()
    })

    it('says where each column goes in plain words (UX-B-07)', async () => {
      await goToMapping()
      expect(screen.getByText('Column in your file')).toBeTruthy()
      expect(screen.getByText('Goes into')).toBeTruthy()
      expect(screen.getAllByRole('option', { name: 'A new column' }).length).toBeGreaterThan(0)
      expect(screen.getAllByRole('option', { name: 'Leave it out' }).length).toBeGreaterThan(0)
      expect(screen.queryByText('Map To')).toBeNull()
    })

    it('lists who was skipped as already here', async () => {
      await goToMapping()
      fireEvent.click(screen.getByRole('button', { name: /Next/ }))
      fireEvent.click(await screen.findByRole('button', { name: /^Import/ }))
      expect(await screen.findByText(/2 skipped because they were already here: Maria Garcia, Bob Lee/)).toBeTruthy()
    })
  })

  describe('first and last name in separate columns (UX-A-07)', () => {
    const preview = {
      sheets: ['Sheet1'], activeSheet: 0, headers: ['First Name', 'Last Name', 'Phone'],
      rows: [['Alice', 'Johnson', '555-0100']],
      detectedColumns: [
        { index: 0, originalName: 'First Name', detectedType: 'text', samples: ['Alice'] },
        { index: 1, originalName: 'Last Name', detectedType: 'text', samples: ['Johnson'] },
        { index: 2, originalName: 'Phone', detectedType: 'phone', samples: ['555-0100'] },
      ],
      detectedHeaderRow: 0, headerDetectionConfidence: 'high', rawRowCount: 2,
    }
    beforeEach(() => {
      mockInvoke.mockImplementation((channel: string) => {
        switch (channel) {
          case 'app:show-file-dialog': return Promise.resolve({ ok: true, data: { canceled: false, filePaths: ['/home/me/list.csv'] } })
          case 'import:file-preview': return Promise.resolve({ ok: true, data: preview })
          case 'import:detect-columns': return Promise.resolve({ ok: true, data: [
            { sourceIndex: 0, action: 7 }, { sourceIndex: 1, action: 'create', newName: 'Last Name', newType: 'text' }, { sourceIndex: 2, action: 'create', newName: 'Phone', newType: 'phone' },
          ] })
          case 'grid:get': return Promise.resolve({ ok: true, data: { columns: [{ id: 7, name: 'Name', column_type: 'text', is_name_column: 1 }] } })
          case 'import:file': return Promise.resolve({ ok: true, data: { imported: 1, skipped: 0, warnings: [] } })
          default: return Promise.resolve({ ok: true, data: null })
        }
      })
    })

    async function toMapping() {
      render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
      fireEvent.click(screen.getByLabelText('Click to browse for a file, or drop a file here'))
      fireEvent.click(await screen.findByRole('button', { name: /Next/ }))
      await screen.findByText(/Choose where each column in your file goes/)
    }
    const importCall = () => mockInvoke.mock.calls.find(c => c[0] === 'import:file')?.[1] as { combineNames?: unknown; columnMappings: Array<{ sourceIndex: number; action: unknown }> }

    it('offers to combine them into Name, ticked, with an example, and leaves Last Name out', async () => {
      await toMapping()
      const box = screen.getByRole('checkbox', { name: /Combine "First Name" \+ "Last Name" into Name/ }) as HTMLInputElement
      expect(box.checked).toBe(true)
      expect(screen.getByText(/\(Alice Johnson\)/)).toBeTruthy()
      expect((screen.getByLabelText('Where "Last Name" goes') as HTMLSelectElement).value).toBe('skip')
      expect(screen.getByText(/Already part of Name/)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /Next/ }))
      fireEvent.click(await screen.findByRole('button', { name: /^Import/ }))
      await screen.findByText(/1 .* imported/)
      expect(importCall().combineNames).toEqual({ firstIndex: 0, lastIndex: 1 })
    })

    it('unticked, the last name comes back as its own column and nothing is combined', async () => {
      await toMapping()
      fireEvent.click(screen.getByRole('checkbox', { name: /Combine/ }))
      expect((screen.getByLabelText('Where "Last Name" goes') as HTMLSelectElement).value).toBe('create')
      fireEvent.click(screen.getByRole('button', { name: /Next/ }))
      fireEvent.click(await screen.findByRole('button', { name: /^Import/ }))
      await screen.findByText(/1 .* imported/)
      expect(importCall().combineNames).toBeUndefined()
      expect(importCall().columnMappings[1]!.action).toBe('create')
    })
  })

  describe('setting up deadlines after the import (UX-B-06)', () => {
    const preview = {
      sheets: ['Sheet1'], activeSheet: 0, headers: ['Name', 'Review Due'],
      rows: [['Al', '3/1/2027']],
      detectedColumns: [
        { index: 0, originalName: 'Name', detectedType: 'text', samples: ['Al'] },
        { index: 1, originalName: 'Review Due', detectedType: 'date', samples: ['3/1/2027'] },
      ],
      detectedHeaderRow: 0, headerDetectionConfidence: 'high', rawRowCount: 2,
    }
    let gridGets = 0
    beforeEach(() => {
      gridGets = 0
      useAlertStore.setState({ rules: [], isLoaded: true })
      mockInvoke.mockImplementation((channel: string) => {
        switch (channel) {
          case 'app:show-file-dialog': return Promise.resolve({ ok: true, data: { canceled: false, filePaths: ['/home/me/list.csv'] } })
          case 'import:file-preview': return Promise.resolve({ ok: true, data: preview })
          case 'import:detect-columns': return Promise.resolve({ ok: true, data: [{ sourceIndex: 0, action: 7 }, { sourceIndex: 1, action: 'create', newName: 'Review Due', newType: 'date' }] })
          case 'grid:get': {
            gridGets++
            const columns = [{ id: 7, name: 'Name', column_type: 'text', is_name_column: 1, config: null }]
            if (gridGets > 1) columns.push({ id: 9, name: 'Review Due', column_type: 'date', is_name_column: 0, config: null })
            return Promise.resolve({ ok: true, data: { columns } })
          }
          case 'import:file': return Promise.resolve({ ok: true, data: { imported: 1, skipped: 0, warnings: [], newRowIds: [41] } })
          case 'alert-rule:create': return Promise.resolve({ ok: true, data: 55 })
          case 'alert-rule:get-all': return Promise.resolve({ ok: true, data: [] })
          default: return Promise.resolve({ ok: true, data: null })
        }
      })
    })

    async function importIt(props: Partial<React.ComponentProps<typeof ImportWizard>> = {}) {
      render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} {...props} />)
      fireEvent.click(screen.getByLabelText('Click to browse for a file, or drop a file here'))
      fireEvent.click(await screen.findByRole('button', { name: /Next/ }))
      await screen.findByText(/Choose where each column in your file goes/)
      fireEvent.click(screen.getByRole('button', { name: /Next/ }))
      fireEvent.click(await screen.findByRole('button', { name: /^Import/ }))
      await screen.findByText(/1 .* imported/)
    }

    it('asks whether each new date column comes due, and gives it the rule', async () => {
      await importIt()
      expect(await screen.findByText('Set up deadlines')).toBeTruthy()
      expect(screen.getByText('"Review Due": does this date come due again?')).toBeTruthy()
      expect(screen.queryByText(/More options/)).toBeNull()
      fireEvent.click(screen.getByLabelText(/Yes, every/))
      fireEvent.click(screen.getByRole('button', { name: 'Save deadlines' }))
      expect(await screen.findByText(/That date column now colors as it comes due/)).toBeTruthy()
      expect(mockInvoke).toHaveBeenCalledWith('alert-rule:create', expect.objectContaining({ interval_months: 12 }))
      expect(mockInvoke).toHaveBeenCalledWith('column:update', 9, { config: JSON.stringify({ alert_rule_id: 55 }) })
    })

    it('an answer left unsaved is still saved on Done, before the list reloads', async () => {
      await importIt()
      await screen.findByText('Set up deadlines')
      fireEvent.click(screen.getByLabelText(/one-off due date/))
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
      await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
      expect(mockInvoke).toHaveBeenCalledWith('column:update', 9, expect.anything())
      expect(onImported).toHaveBeenCalled()
    })

    it('setup asks about dates on its own page, so it can leave the question out', async () => {
      await importIt({ askDeadlines: false })
      expect(screen.queryByText('Set up deadlines')).toBeNull()
    })
  })

  describe('warnings (UX-B-35)', () => {
    it('splits a warning into a short line and the reason', () => {
      expect(splitWarning('"DOB": 2 dates read as month/day, like 1/2/1960. They could be read either way.'))
        .toEqual({ line: '"DOB": 2 dates read as month/day, like 1/2/1960.', why: 'They could be read either way.' })
      expect(splitWarning('1 value in "Consent" wasn\'t clearly yes or no, so it was left unticked; check it in the list.').why).toBeNull()
    })
  })
})
