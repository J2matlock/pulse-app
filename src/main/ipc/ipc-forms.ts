/**
 * ipc-forms.ts — forms: save, submit, undo (generalization W08).
 */
import { IPC } from '../../shared/ipc-channels'
import type { FormChange } from '../../shared/forms'
import { dialog } from 'electron'
import { secureWrap, ok, fail, enforceWritable, validId, notifyCaseLogChanged, assertSafePath } from './ipc-utils'
import { buildFormPdf, FormPrintError } from '../export-forms'
import { atomicWriteFileAsync } from '../export-shared'
import { localDateString } from '../../shared/dates'
import { FormError, listForms, getForm, saveForm, deleteForm, submitForm, undoFormSubmit, redoFormSubmit, type FormValues } from '../forms'

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

export function registerFormHandlers(): void {
  secureWrap(IPC.FORM_LIST, 'ipc-forms', (_e, gridId: unknown) => {
    if (!validId(gridId)) return fail('Invalid ID')
    return ok(listForms(gridId))
  })

  secureWrap(IPC.FORM_SAVE, 'ipc-forms', (_e, input: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    return action(() => saveForm(input as never))
  })

  secureWrap(IPC.FORM_DELETE, 'ipc-forms', (_e, id: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    return action(() => deleteForm(id))
  })

  secureWrap(IPC.FORM_SUBMIT, 'ipc-forms', (_e, formId: unknown, rowId: unknown, values: unknown, noteAnswers?: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(formId) || (rowId !== null && !validId(rowId))) return fail('Invalid ID')
    if (!values || typeof values !== 'object' || Array.isArray(values)) return fail('Invalid answers')
    const notes = (noteAnswers && typeof noteAnswers === 'object' ? noteAnswers : {}) as Record<string, unknown>
    if (!Object.values(notes).every(v => typeof v === 'string' && v.length <= 20_000)) return fail('Invalid answers')
    const form = getForm(formId)
    if (!form) return fail('That form no longer exists.')
    const res = action(() => submitForm(formId, rowId as number | null, values as FormValues, notes as Record<string, string>))
    if (res.ok && res.data.noteId !== null) notifyCaseLogChanged(res.data.rowId)
    return res
  })

  secureWrap(IPC.FORM_UNDO, 'ipc-forms', (_e, change: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validChange(change)) return fail('Invalid request')
    const res = action(() => undoFormSubmit(change))
    if (res.ok && change.noteId !== null) notifyCaseLogChanged(change.rowId)
    return res
  })

  // Redo of a submit that made a record: bring it back from the Trash (false when it's gone)
  secureWrap(IPC.FORM_REDO, 'ipc-forms', (_e, change: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validChange(change)) return fail('Invalid request')
    const res = action(() => redoFormSubmit(change))
    if (res.ok && res.data) notifyCaseLogChanged(change.rowId)
    return res
  })

  secureWrap(IPC.FORM_PRINT, 'ipc-forms', async (_e, formId: unknown, rowId: unknown) => {
    if (!validId(formId) || (rowId !== null && !validId(rowId))) return fail('Invalid ID')
    let built: ReturnType<typeof buildFormPdf>
    try { built = buildFormPdf(formId, rowId as number | null) } catch (err) { if (err instanceof FormPrintError) return fail(err.message); throw err }
    const safe = built.name.replace(/[^\w -]+/g, '').trim() || 'form'
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: rowId === null ? 'Save blank form' : 'Save filled form',
      defaultPath: `${safe}${rowId === null ? ' (blank)' : ''}-${localDateString()}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    await atomicWriteFileAsync(filePath, Buffer.from(built.pdf.output('arraybuffer')))
    return ok(filePath)
  })
}
