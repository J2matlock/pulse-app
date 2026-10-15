/**
 * ipc-forms.ts — forms: save, submit, undo (generalization W08).
 */
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import type { FormChange } from '../../shared/forms'
import { ok, fail, validId, notifyCaseLogChanged, assertSafePath, pickSavePath } from './ipc-utils'
import { handlersFor, idArg } from './ipc-define'
import { buildFormPdf, FormPrintError } from '../export-forms'
import { atomicWriteFileAsync } from '../export-shared'
import { localDateString } from '../../shared/dates'
import { FormError, listForms, getForm, saveForm, deleteForm, submitForm, undoFormSubmit, redoFormSubmit, type FormValues } from '../forms'
import { deleteKeepingCopy } from '../library-restore'

function action<T>(fn: () => T) {
  try { return ok(fn()) } catch (err) {
    if (err instanceof FormError) return fail(err.message)
    throw err
  }
}

function validChange(v: unknown): v is FormChange {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return validId(c.rowId) && typeof c.created === 'boolean' && (c.noteId === null || validId(c.noteId))
    && !!c.previous && typeof c.previous === 'object' && !!c.previousLinks && typeof c.previousLinks === 'object'
}

const define = handlersFor('ipc-forms')

const changeArg = () => z.custom<FormChange>(validChange, 'Invalid request')

export function registerFormHandlers(): void {
  define(IPC.FORM_LIST, [idArg()], (gridId) => ok(listForms(gridId)))

  define(IPC.FORM_SAVE, [z.unknown()], (input) => action(() => saveForm(input as never)), { write: true })

  // Keeps a copy for Undo, which puts it back under the same id (Q4)
  define(IPC.FORM_DELETE, [idArg()], (id) => action(() => ({ undoToken: deleteKeepingCopy('form', id, () => deleteForm(id)) })), { write: true })

  define(IPC.FORM_SUBMIT, [
    idArg(),
    idArg().nullable(),
    z.custom<FormValues>(v => !!v && typeof v === 'object' && !Array.isArray(v), 'Invalid answers'),
    z.unknown(),
  ], (formId, rowId, values, noteAnswers) => {
    const notes = (noteAnswers && typeof noteAnswers === 'object' ? noteAnswers : {}) as Record<string, unknown>
    if (!Object.values(notes).every(v => typeof v === 'string' && v.length <= 20_000)) return fail('Invalid answers')
    const form = getForm(formId)
    if (!form) return fail('That form no longer exists.')
    const res = action(() => submitForm(formId, rowId, values, notes as Record<string, string>))
    if (res.ok && res.data.noteId !== null) notifyCaseLogChanged(res.data.rowId)
    return res
  }, { write: true })

  define(IPC.FORM_UNDO, [changeArg()], (change) => {
    const res = action(() => undoFormSubmit(change))
    if (res.ok && change.noteId !== null) notifyCaseLogChanged(change.rowId)
    return res
  }, { write: true })

  // Redo of a submit that made a record: bring it back from the Trash (false when it's gone)
  define(IPC.FORM_REDO, [changeArg()], (change) => {
    const res = action(() => redoFormSubmit(change))
    if (res.ok && res.data) notifyCaseLogChanged(change.rowId)
    return res
  }, { write: true })

  define(IPC.FORM_PRINT, [idArg(), idArg().nullable()], async (formId, rowId) => {
    let built: ReturnType<typeof buildFormPdf>
    try { built = buildFormPdf(formId, rowId) } catch (err) { if (err instanceof FormPrintError) return fail(err.message); throw err }
    const safe = built.name.replace(/[^\w -]+/g, '').trim() || 'form'
    const filePath = await pickSavePath({
      title: rowId === null ? 'Save blank form' : 'Save filled form',
      defaultPath: `${safe}${rowId === null ? ' (blank)' : ''}-${localDateString()}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    await atomicWriteFileAsync(filePath, Buffer.from(built.pdf.output('arraybuffer')))
    return ok(filePath)
  })
}
