/**
 * ipc-measures.ts — MEASURE_* handlers: people's own numbers on notes
 * (generalization W03 §3). Definitions travel with the workspace state.
 */
import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, enforceWritable } from './ipc-utils'
import { MeasureError, saveMeasure, setMeasureArchived } from '../measures'
import { getWorkspaceState } from '../vocab'
import { notifyWorkspaceChanged } from './ipc-workspace'

function change(fn: () => void) {
  try {
    fn()
    notifyWorkspaceChanged()
    return ok(getWorkspaceState())
  } catch (err) {
    if (err instanceof MeasureError) return fail(err.message)
    throw err
  }
}

export function registerMeasureHandlers(): void {
  secureWrap(IPC.MEASURE_SAVE, 'ipc-measures', (_e, input: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!input || typeof input !== 'object') return fail('Invalid number')
    const { key, label, unit, kind, decimals } = input as Record<string, unknown>
    return change(() => { saveMeasure({ key, label, unit, kind, decimals }) })
  })

  secureWrap(IPC.MEASURE_ARCHIVE, 'ipc-measures', (_e, key: unknown, archived: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (typeof key !== 'string' || typeof archived !== 'boolean') return fail('Invalid number')
    return change(() => setMeasureArchived(key, archived))
  })
}
