/**
 * ipc-measures.ts — MEASURE_* handlers: people's own numbers on notes
 * (generalization W03 §3). Definitions travel with the workspace state.
 */
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { ok, fail } from './ipc-utils'
import { handlersFor } from './ipc-define'
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

const define = handlersFor('ipc-measures')

/** Any object: saveMeasure checks each field itself */
const measureInput = z.custom<Record<string, unknown>>(v => !!v && typeof v === 'object', 'Invalid number')

export function registerMeasureHandlers(): void {
  define(IPC.MEASURE_SAVE, [measureInput], (input) => {
    const { key, label, unit, kind, decimals } = input
    return change(() => { saveMeasure({ key, label, unit, kind, decimals }) })
  }, { write: true })

  define(IPC.MEASURE_ARCHIVE, [z.string('Invalid number'), z.boolean('Invalid number')],
    (key, archived) => change(() => setMeasureArchived(key, archived)), { write: true })
}
