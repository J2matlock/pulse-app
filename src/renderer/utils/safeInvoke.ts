/**
 * safeInvoke — transport-safe, type-safe IPC wrapper.
 *
 * Wraps `window.api.invoke` with a try/catch so callers never see
 * uncaught transport-level errors (channel not found, renderer crash, etc.).
 * Business-level errors are still returned as `{ ok: false, error }`.
 *
 * For channels defined in IPCContract, argument types and return types
 * are checked at compile time. Untyped channels fall through to unknown.
 */
import type { IPCResult } from '../../shared/types'
import type { IPCChannel } from '../../shared/ipc-channels'
import type { IPCContract, ContractChannel } from '../../shared/ipc-contract'
import toast from 'react-hot-toast'
import { rlog } from './rendererLogger'
import { IPC_READ_ONLY } from '../../shared/constants'

// ── safeInvoke — returns IPCResult<T>, never throws ─────────────────────

/** Overload 1: typed channels from IPCContract — args and return auto-inferred. */
export async function safeInvoke<C extends ContractChannel>(
  channel: C,
  ...args: IPCContract[C]['args']
): Promise<IPCResult<IPCContract[C]['return']>>

/** Overload 2: fallback for unmapped channels (backward compat). */
export async function safeInvoke<T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<IPCResult<T>>

/** Implementation (unchanged logic). */
export async function safeInvoke(
  channel: string,
  ...args: unknown[]
): Promise<IPCResult<unknown>> {
  try {
    return await window.api.invoke(channel as IPCChannel, ...args) as IPCResult<unknown>
  } catch (err) {
    rlog.error('SafeInvoke', `IPC transport error [${channel}]`, err)
    return { ok: false, error: err instanceof Error ? err.message : 'IPC communication error' }
  }
}

// ── storeInvoke — throw-on-error variant for Zustand stores ─────────────

/** Sentinel error so callers can tell a read-only block from a real error. */
export class ReadOnlyError extends Error {
  constructor() { super(IPC_READ_ONLY) }
}

/** Debounce read-only toasts (5 s cooldown). */
let lastReadOnlyToast = 0

/** Overload 1: typed channels from IPCContract — args and return auto-inferred. */
export async function storeInvoke<C extends ContractChannel>(
  channel: C,
  ...args: IPCContract[C]['args']
): Promise<IPCContract[C]['return']>

/** Overload 2: fallback for unmapped channels (backward compat). */
export async function storeInvoke<T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<T>

/**
 * Throw-on-error IPC wrapper for Zustand stores.
 *
 * - On transport error: logs via rlog and re-throws.
 * - On READ_ONLY: shows a debounced toast and throws ReadOnlyError.
 * - On any other business error: throws Error with the message.
 * - On success: returns result.data.
 */
export async function storeInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  let result: IPCResult<unknown>
  try {
    result = await window.api.invoke(channel as IPCChannel, ...args) as IPCResult<unknown>
  } catch (err) {
    rlog.error('storeInvoke', `IPC transport error [${channel}]`, err)
    throw err instanceof Error ? err : new Error('IPC communication error')
  }
  if (!result.ok) {
    if (result.error === IPC_READ_ONLY) {
      const now = Date.now()
      if (now - lastReadOnlyToast > 5000) {
        lastReadOnlyToast = now
        toast.error("Pulse can't save changes right now.", { duration: 5000 })
      }
      throw new ReadOnlyError()
    }
    throw new Error(result.error)
  }
  return result.data
}

// ── mustInvoke — for undo/redo callbacks ────────────────────────────────

/**
 * Like safeInvoke, but a failure throws (with the handler's plain-English
 * reason), so the undo store reports it and keeps the item where it was
 * instead of announcing an undo that didn't happen (audit L-08). Returns the
 * same shape as safeInvoke, so `res.ok` checks keep working.
 */
export async function mustInvoke<C extends ContractChannel>(
  channel: C,
  ...args: IPCContract[C]['args']
): Promise<{ ok: true; data: IPCContract[C]['return'] }>

export async function mustInvoke<T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<{ ok: true; data: T }>

export async function mustInvoke(channel: string, ...args: unknown[]): Promise<{ ok: true; data: unknown }> {
  const res = await safeInvoke(channel, ...args)
  if (!res.ok) throw new Error(res.error === IPC_READ_ONLY ? "Pulse can't save changes right now." : res.error)
  return res
}
