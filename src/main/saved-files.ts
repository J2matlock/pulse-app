/**
 * Files Pulse itself wrote this session (backups saved where the person chose),
 * so "Show" can reveal one in the file manager without trusting a path the
 * renderer built. In memory only and capped.
 */
import { resolve } from 'path'

const saved: string[] = []
const MAX_SAVED = 20

export function rememberSavedFile(filePath: string): void {
  const p = resolve(filePath)
  const i = saved.indexOf(p)
  if (i !== -1) saved.splice(i, 1)
  saved.push(p)
  if (saved.length > MAX_SAVED) saved.shift()
}

export function wasSavedByPulse(filePath: string): boolean {
  return saved.includes(resolve(filePath))
}

/** Test seam */
export function clearSavedFiles(): void { saved.length = 0 }
