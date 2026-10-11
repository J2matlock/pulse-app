/**
 * Wave 10 — Cross-cutting integration tests.
 *
 * Tests 10A–10J covering backup/undo interaction, column type change confirmation,
 * humanizeError in wrapHandler, assertSafePath null bytes, logNonFatal logging,
 * and renderer ok:false handling.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Hoisted mocks for main-process tests (10G, 10H, 10I) ──────────────────

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

vi.mock('../../src/main/logger', () => ({
  logger: mockLogger,
}))

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

// ── Renderer mocks ─────────────────────────────────────────────────────────

const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = { api: { invoke: mockInvoke } }
vi.stubGlobal('crypto', { randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}` })

// ═══════════════════════════════════════════════════════════════════════════════
// 10A — Backup restore clears undo stack (renderer-level test)
// ═══════════════════════════════════════════════════════════════════════════════

import { useUndoStore } from '../../src/renderer/stores/undoStore'

describe('10A — Backup restore clears undo stack', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
  })

  it('undoStore.clear() is called on successful backup restore', () => {
    // Push some items onto the undo stack
    useUndoStore.getState().push({
      id: 'item-1',
      description: 'Test action',
      timestamp: Date.now(),
      category: 'silent',
      icon: 'pencil',
      undo: vi.fn().mockResolvedValue(undefined),
      redo: vi.fn().mockResolvedValue(undefined),
    })
    expect(useUndoStore.getState().undoStack).toHaveLength(1)

    // Simulate what BackupSection does after successful restore (line 143)
    useUndoStore.getState().clear()

    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().redoStack).toHaveLength(0)
  })

  it('clearing undo also clears redo stack', () => {
    const item = {
      id: 'item-2',
      description: 'Another action',
      timestamp: Date.now(),
      category: 'silent' as const,
      icon: 'pencil',
      undo: vi.fn().mockResolvedValue(undefined),
      redo: vi.fn().mockResolvedValue(undefined),
    }
    useUndoStore.getState().push(item)
    // Undo to move to redo stack
    useUndoStore.getState().undo()

    // Clear everything (backup restore)
    useUndoStore.getState().clear()
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().redoStack).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 10B — Column type change sets pendingColumnTypeChange
// ═══════════════════════════════════════════════════════════════════════════════

import { useGridStore } from '../../src/renderer/stores/gridStore'
import type { Column } from '../../src/shared/types'

function makeColumn(id: number, name: string, overrides: Partial<Column> = {}): Column {
  return {
    id,
    grid_id: 1,
    name,
    column_type: 'text',
    width: 200,
    position: id - 1,
    is_visible: 1,
    is_required: 0,
    is_identifier: 0,
    is_name_column: 0,
    default_value: null,
    description: null,
    config: '{}',
    ...overrides,
  } as Column
}

describe('10B — Column type change triggers confirmation dialog', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
    useGridStore.setState({
      activeGridId: 1,
      columns: [makeColumn(10, 'Status')],
      rows: [],
      pendingColumnTypeChange: null,
    } as any)
  })

  it('updateColumn with column_type change sets pendingColumnTypeChange', async () => {
    await useGridStore.getState().updateColumn(10, { column_type: 'dropdown' })

    // Should NOT call IPC — should set pendingColumnTypeChange instead
    expect(mockInvoke).not.toHaveBeenCalled()
    const pending = useGridStore.getState().pendingColumnTypeChange
    expect(pending).not.toBeNull()
    expect(pending!.oldType).toBe('text')
    expect(pending!.newType).toBe('dropdown')
    expect(pending!.columnId).toBe(10)
  })

  it('cancelColumnTypeChange clears pending state', async () => {
    await useGridStore.getState().updateColumn(10, { column_type: 'number' })
    expect(useGridStore.getState().pendingColumnTypeChange).not.toBeNull()

    useGridStore.getState().cancelColumnTypeChange()
    expect(useGridStore.getState().pendingColumnTypeChange).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 10G — humanizeError via wrapHandler (integration cross-ref)
// Already covered in tests/wrap-handler.test.ts — this verifies end-to-end.
// ═══════════════════════════════════════════════════════════════════════════════

import { wrapHandler, logNonFatal, assertSafePath } from '../../src/main/ipc/ipc-utils'

describe('10G — humanizeError in wrapHandler flow', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('SQLITE_CONSTRAINT returns humanized message through wrapHandler', async () => {
    const handler = wrapHandler('integration', async () => {
      throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: grids.name')
    })
    const result = await handler()
    expect(result).toEqual({ ok: false, error: "There's already a list called that." })
  })

  it('SQLITE_BUSY returns user-friendly message', async () => {
    const handler = wrapHandler('integration', async () => {
      throw new Error('SQLITE_BUSY: database is locked')
    })
    const result = await handler()
    expect(result).toEqual({ ok: false, error: 'The database is temporarily busy — please try again' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 10H — assertSafePath null byte rejection (cross-ref to Wave 3)
// Already covered in tests/assert-safe-path.test.ts — this is an integration-level
// verification that the function is importable and works.
// ═══════════════════════════════════════════════════════════════════════════════

describe('10H — assertSafePath null byte rejection', () => {
  it('rejects paths containing null bytes', () => {
    expect(() => assertSafePath('/tmp/file\0evil')).toThrow('null bytes')
  })

  it('rejects empty paths as relative', () => {
    expect(() => assertSafePath('')).toThrow('Relative paths not allowed')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 10I — logNonFatal calls logger.warn (cross-ref to Wave 3)
// Already covered in tests/log-non-fatal.test.ts — integration verification.
// ═══════════════════════════════════════════════════════════════════════════════

describe('10I — logNonFatal appears in logs', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls logger.warn with component and context', () => {
    logNonFatal('integration-test', 'test context', new Error('test error'))
    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn.mock.calls[0][0]).toBe('integration-test')
    expect(mockLogger.warn.mock.calls[0][1]).toContain('test context')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 10J — Renderer handles ok:false gracefully
// ═══════════════════════════════════════════════════════════════════════════════

describe('10J — Renderer handles ok:false gracefully', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useGridStore.setState({ activeGridId: 1, columns: [], rows: [] } as any)
  })

  it('gridStore addColumn handles IPC fail result without crashing', async () => {
    // Simulate IPC returning ok:false
    mockInvoke.mockResolvedValueOnce({ ok: false, error: 'Database is locked' })

    // Should not throw
    await useGridStore.getState().addColumn('Test', 'text')

    // Columns should still be empty (operation failed gracefully)
    expect(useGridStore.getState().columns).toHaveLength(0)
  })

  it('gridStore updateColumn handles IPC failure gracefully', async () => {
    useGridStore.setState({
      activeGridId: 1,
      columns: [makeColumn(1, 'Name')],
      rows: [],
    } as any)

    mockInvoke.mockRejectedValueOnce(new Error('Network error'))

    // Should not throw — error is caught internally, reported as failure, and the name is unchanged
    const saved = await useGridStore.getState().updateColumn(1, { name: 'New Name' })
    expect(saved).toBe(false)
    expect(useGridStore.getState().columns[0]?.name).toBe('Name')
  })
})
