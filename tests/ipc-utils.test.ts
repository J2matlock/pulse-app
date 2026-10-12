/**
 * ipc-utils.ts — unit tests for secureHandle sender validation.
 * Pure logic tests, no Electron or DB dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

// Mock logger to avoid file system side effects
vi.mock('../src/main/logger', () => ({
  logger: mockLogger,
}))

import { secureHandle, secureWrap, fail, ok, wrapHandler } from '../src/main/ipc/ipc-utils'

describe('secureHandle', () => {
  beforeEach(() => {
    mockHandle.mockClear()
  })

  it('rejects when senderFrame is null/undefined (detached or destroyed frame)', async () => {
    const listener = vi.fn(() => ({ ok: true, data: 'success' }))
    secureHandle('test-channel', listener)

    const registeredHandler = mockHandle.mock.calls[0][1]

    // null senderFrame — explicitly rejected as potential detached frame
    const result = await registeredHandler({ senderFrame: null })
    expect(result).toEqual({ ok: false, error: 'Unauthorized IPC sender' })
    expect(listener).not.toHaveBeenCalled()

    // undefined senderFrame — same rejection
    const result2 = await registeredHandler({ senderFrame: undefined })
    expect(result2).toEqual({ ok: false, error: 'Unauthorized IPC sender' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('rejects when senderFrame has a parent (subframe)', async () => {
    const listener = vi.fn(() => ({ ok: true, data: 'success' }))
    secureHandle('test-channel-2', listener)

    const registeredHandler = mockHandle.mock.calls[0][1]
    const result = await registeredHandler({ senderFrame: { parent: {} } })

    expect(result).toEqual(fail('Unauthorized IPC sender'))
    expect(listener).not.toHaveBeenCalled()
  })

  it('allows when senderFrame exists with no parent', async () => {
    const listener = vi.fn(() => ({ ok: true, data: 'allowed' }))
    secureHandle('test-channel-3', listener)

    const registeredHandler = mockHandle.mock.calls[0][1]
    const result = await registeredHandler({ senderFrame: { parent: null } }, 'arg1')

    expect(result).toEqual({ ok: true, data: 'allowed' })
    expect(listener).toHaveBeenCalled()
  })

  it('rejects a top frame with an empty URL, which has not loaded Pulse (Q-058)', async () => {
    const listener = vi.fn(() => ({ ok: true, data: 'allowed' }))
    secureHandle('test-channel-empty-url', listener)
    const registeredHandler = mockHandle.mock.calls[0][1]
    expect(await registeredHandler({ senderFrame: { parent: null, url: '' } })).toEqual({ ok: false, error: 'Unauthorized IPC sender' })
    expect(await registeredHandler({ senderFrame: { parent: null, url: 'app://bundle/index.html' } })).toEqual({ ok: true, data: 'allowed' })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

// ── secureWrap integration tests ──────────────────────────────────────────

describe('secureWrap', () => {
  beforeEach(() => {
    mockHandle.mockClear()
    mockLogger.error.mockClear()
  })

  it('rejects when senderFrame is null (explicitly rejected as potential detached frame)', async () => {
    secureWrap('sw-channel-1', 'test-comp', async () => ok('data'))

    const registeredHandler = mockHandle.mock.calls[0][1]
    // null senderFrame = destroyed/detached frame, must be rejected
    const result = await registeredHandler({ senderFrame: null })
    expect(result).toEqual({ ok: false, error: 'Unauthorized IPC sender' })
  })

  it('rejects subframe (senderFrame has parent)', async () => {
    secureWrap('sw-channel-2', 'test-comp', async () => ok('data'))

    const registeredHandler = mockHandle.mock.calls[0][1]
    const result = await registeredHandler({ senderFrame: { parent: {} } })
    expect(result).toEqual(fail('Unauthorized IPC sender'))
  })

  it('catches handler errors and returns humanized fail', async () => {
    secureWrap('sw-channel-3', 'test-comp', async () => {
      throw new Error('SQLITE_BUSY: database is locked')
    })

    const registeredHandler = mockHandle.mock.calls[0][1]
    const result = await registeredHandler({ senderFrame: { parent: null } })
    expect(result).toEqual({ ok: false, error: 'Pulse is busy for a moment. Please try again.' })
  })

  it('passes through successful results from handler', async () => {
    secureWrap('sw-channel-4', 'test-comp', async () => ok({ name: 'Alice' }))

    const registeredHandler = mockHandle.mock.calls[0][1]
    const result = await registeredHandler({ senderFrame: { parent: null } })
    expect(result).toEqual({ ok: true, data: { name: 'Alice' } })
  })

  it('logs errors via logger.error on handler failure', async () => {
    secureWrap('sw-channel-5', 'my-component', async () => {
      throw new Error('test error for logging')
    })

    const registeredHandler = mockHandle.mock.calls[0][1]
    await registeredHandler({ senderFrame: { parent: null } })
    expect(mockLogger.error).toHaveBeenCalledWith(
      'my-component',
      'IPC handler failed',
      { error: 'test error for logging', channel: 'sw-channel-5' }
    )
  })
})

describe('isTrustedSenderUrl', () => {
  it('trusts only the app bundle in packaged-style checks', async () => {
    const { isTrustedSenderUrl } = await import('../src/main/ipc/ipc-utils')
    expect(isTrustedSenderUrl('app://bundle/index.html')).toBe(true)
    expect(isTrustedSenderUrl('https://evil.example/index.html')).toBe(false)
    expect(isTrustedSenderUrl('file:///etc/passwd')).toBe(false)
    expect(isTrustedSenderUrl('app://bundle.evil/index.html')).toBe(false)
  })
})
