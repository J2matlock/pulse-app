/**
 * wrapHandler — tests for IPC handler error wrapping.
 * Verifies: successful passthrough, error catch with humanized message,
 * logger.error call, SQLITE error humanization, sync handler support.
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

import { wrapHandler, ok, fail } from '../src/main/ipc/ipc-utils'

describe('wrapHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes through successful ok result', async () => {
    const handler = wrapHandler('test', async () => ok({ name: 'Alice' }))
    const result = await handler()
    expect(result).toEqual({ ok: true, data: { name: 'Alice' } })
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('passes through successful fail result (explicit fail)', async () => {
    const handler = wrapHandler('test', async () => fail('Not found'))
    const result = await handler()
    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('catches thrown Error and returns fail with humanized message', async () => {
    const handler = wrapHandler('test-comp', async () => {
      throw new Error('SQLITE_BUSY: database is locked')
    })
    const result = await handler()
    expect(result).toEqual({ ok: false, error: 'The database is temporarily busy — please try again' })
  })

  it('logs via logger.error when handler throws', async () => {
    const handler = wrapHandler('grid-crud', async () => {
      throw new Error('Something broke')
    })
    await handler()
    expect(mockLogger.error).toHaveBeenCalledWith(
      'grid-crud',
      'IPC handler failed',
      { error: 'Something broke' }
    )
  })

  it('humanizes SQLITE_CONSTRAINT UNIQUE errors', async () => {
    const handler = wrapHandler('test', async () => {
      throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: grids.name')
    })
    const result = await handler()
    expect(result).toEqual({ ok: false, error: 'A record with that name already exists' })
  })

  it('humanizes ENOENT errors', async () => {
    const handler = wrapHandler('test', async () => {
      throw new Error("ENOENT: no such file or directory, open '/path'")
    })
    const result = await handler()
    expect(result).toEqual({ ok: false, error: 'The requested file was not found' })
  })

  it('works with sync handlers', async () => {
    const handler = wrapHandler('sync-test', () => ok(42))
    const result = await handler()
    expect(result).toEqual({ ok: true, data: 42 })
  })

  it('works with sync handlers that throw', async () => {
    const handler = wrapHandler('sync-err', () => {
      throw new Error('sync failure')
    })
    const result = await handler()
    expect(result).toEqual({ ok: false, error: 'sync failure' })
    expect(mockLogger.error).toHaveBeenCalledWith(
      'sync-err',
      'IPC handler failed',
      { error: 'sync failure' }
    )
  })

  it('handles non-Error thrown values', async () => {
    const handler = wrapHandler('test', async () => {
      throw 'string error'  // eslint-disable-line no-throw-literal
    })
    const result = await handler()
    expect(result).toEqual({ ok: false, error: 'string error' })
  })

  it('passes arguments through to the inner handler', async () => {
    const inner = vi.fn(async (a: number, b: string) => ok({ a, b }))
    const handler = wrapHandler('test', inner)
    const result = await handler(42, 'hello')
    expect(inner).toHaveBeenCalledWith(42, 'hello')
    expect(result).toEqual({ ok: true, data: { a: 42, b: 'hello' } })
  })
})
