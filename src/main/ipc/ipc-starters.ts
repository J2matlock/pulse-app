/**
 * ipc-starters.ts — STARTER_* IPC handlers: the example gallery, preview and
 * apply (generalization W01 §4.3), opening a template file and sharing your
 * own setup as one (§4.4).
 */
import { randomUUID } from 'crypto'
import { BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { summarizeStarter, type StarterSource } from '../../shared/starters/schema'
import { ok, fail, assertSafePath, rememberUserChosenPaths, PATH_REFUSED_MESSAGE } from './ipc-utils'
import { applyStarter, exportWorkspaceStarter, listBuiltinStarters, loadStarter, previewStarter, StarterError } from '../starters'
import { atomicWriteFileSync } from '../export-shared'
import { notifyWorkspaceChanged } from './ipc-workspace'
import { handlersFor } from './ipc-define'

// The window never handles file paths: a file opened through the dialog here
// gets a token, and the window refers to it by that token.
const fileTokens = new Map<string, string>()
const MAX_TOKENS = 10

/** Remember an opened template file; returns the token the window uses for it. */
export function registerStarterFile(filePath: string): string {
  const token = randomUUID()
  fileTokens.set(token, filePath)
  while (fileTokens.size > MAX_TOKENS) fileTokens.delete(fileTokens.keys().next().value!)
  return token
}

const KEY = /^[a-z0-9-]{1,40}$/
const refSchema = z.union([
  z.object({ builtinId: z.string().regex(KEY) }).strict(),
  z.object({ fileToken: z.string().uuid() }).strict(),
])
const variantSchema = z.string().regex(KEY).optional()
const optionsSchema = z.object({
  lists: z.array(z.string().regex(KEY)).max(50),
  applyWords: z.boolean(),
  applyFeatures: z.boolean(),
  sampleData: z.boolean(),
  variant: variantSchema,
}).strict()

/** A window reference → a source main can load, or null if unknown/expired */
function resolveRef(ref: unknown): StarterSource | null {
  const r = refSchema.safeParse(ref)
  if (!r.success) return null
  if ('builtinId' in r.data) return r.data
  const filePath = fileTokens.get(r.data.fileToken)
  return filePath ? { filePath } : null
}

/** StarterError messages are written for people; anything else gets a general one */
function failFrom(err: unknown, fallback: string) {
  return fail(err instanceof StarterError ? err.message : fallback)
}

const NOT_AVAILABLE = "That example isn't available. If you opened a file, open it again."

const define = handlersFor('ipc-starters')

// The window's references resolve against this module's file tokens, and each
// handler answers one message for a bad reference before it looks at the rest,
// so the checks stay in the bodies.
export function registerStarterHandlers(): void {
  define(IPC.STARTER_LIST, [], () => ok(listBuiltinStarters()))

  define(IPC.STARTER_PREVIEW, [z.unknown(), z.unknown()], (ref, variant) => {
    const src = resolveRef(ref)
    const v = variantSchema.safeParse(variant)
    if (!src || !v.success) return fail(NOT_AVAILABLE)
    try {
      return ok(previewStarter(src, v.data))
    } catch (err) {
      return failFrom(err, "We couldn't read that example.")
    }
  })

  define(IPC.STARTER_APPLY, [z.unknown(), z.unknown()], (ref, opts) => {
    const src = resolveRef(ref)
    if (!src) return fail(NOT_AVAILABLE)
    const o = optionsSchema.safeParse(opts)
    if (!o.success) return fail("We couldn't add that example. Please try again.")
    try {
      const result = applyStarter(src, o.data)
      if (result.workspaceChanged) notifyWorkspaceChanged()
      if (result.activityTypesChanged) {
        BrowserWindow.getAllWindows().forEach(w => { if (!w.isDestroyed()) w.webContents.send(IPC.ACTIVITY_TYPES_CHANGED) })
      }
      return ok(result)
    } catch (err) {
      return failFrom(err, "We couldn't add that example. Nothing was changed.")
    }
  }, { write: true })

  define(IPC.STARTER_OPEN_FILE, [], async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Open a template file',
      properties: ['openFile'],
      filters: [{ name: 'Pulse template', extensions: ['pulse', 'json'] }],
    })
    const filePath = filePaths[0]
    if (canceled || !filePath) return ok(null)
    // Picked in Pulse's own dialog, so it may be anywhere but a system folder
    rememberUserChosenPaths([filePath])
    try { assertSafePath(filePath) } catch { return fail(PATH_REFUSED_MESSAGE) }
    try {
      const starter = loadStarter({ filePath })
      return ok({ source: { fileToken: registerStarterFile(filePath) }, summary: summarizeStarter(starter) })
    } catch (err) {
      return failFrom(err, "We couldn't open that file.")
    }
  })

  define(IPC.WORKSPACE_EXPORT_TEMPLATE, [], async () => {
    let json: string
    try {
      json = JSON.stringify(exportWorkspaceStarter(), null, 2)
    } catch (err) {
      return failFrom(err, "We couldn't save your setup. Please try again.")
    }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Share my setup as a template',
      defaultPath: 'my-pulse-setup.pulse',
      filters: [{ name: 'Pulse template', extensions: ['pulse'] }],
    })
    if (canceled || !filePath) return ok(null)
    const dest = filePath.endsWith('.pulse') ? filePath : `${filePath}.pulse`
    rememberUserChosenPaths([dest])
    try { assertSafePath(dest) } catch { return fail(PATH_REFUSED_MESSAGE) }
    atomicWriteFileSync(dest, json, 'utf8')
    return ok({ filePath: dest })
  })
}
