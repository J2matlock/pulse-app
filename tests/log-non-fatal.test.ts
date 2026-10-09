/**
 * logNonFatal — tests for non-fatal error logging utility.
 * Verifies: calls logger.warn (not debug), includes component and context,
 * handles non-Error values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

vi.mock('../src/main/logger', () => ({
  logger: mockLogger,
}))

import { logNonFatal } from '../src/main/ipc/ipc-utils'

describe('logNonFatal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls logger.warn (not debug or error)', () => {
    logNonFatal('backup', 'checkpoint failed', new Error('WAL error'))
    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
    expect(mockLogger.debug).not.toHaveBeenCalled()
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('includes component as first argument', () => {
    logNonFatal('import', 'row parse failed', new Error('bad data'))
    expect(mockLogger.warn.mock.calls[0][0]).toBe('import')
  })

  it('includes context in message', () => {
    logNonFatal('export', 'PDF generation slow', new Error('timeout'))
    const message = mockLogger.warn.mock.calls[0][1] as string
    expect(message).toContain('PDF generation slow')
  })

  it('extracts Error message into data object', () => {
    logNonFatal('backup', 'test context', new Error('specific error msg'))
    const data = mockLogger.warn.mock.calls[0][2] as { error: string }
    expect(data.error).toBe('specific error msg')
  })

  it('handles string error values', () => {
    logNonFatal('grid', 'save failed', 'string error message')
    const data = mockLogger.warn.mock.calls[0][2] as { error: string }
    expect(data.error).toBe('string error message')
  })

  it('handles number error values', () => {
    logNonFatal('grid', 'error code', 404)
    const data = mockLogger.warn.mock.calls[0][2] as { error: string }
    expect(data.error).toBe('404')
  })

  it('handles null error values', () => {
    logNonFatal('grid', 'null error', null)
    const data = mockLogger.warn.mock.calls[0][2] as { error: string }
    expect(data.error).toBe('null')
  })

  it('handles undefined error values', () => {
    logNonFatal('grid', 'undefined error', undefined)
    const data = mockLogger.warn.mock.calls[0][2] as { error: string }
    expect(data.error).toBe('undefined')
  })
})
