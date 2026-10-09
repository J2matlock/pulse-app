import { existsSync } from 'fs'
import { extname } from 'path'
import { execFileSync } from 'child_process'
import { PRODUCT_NAME } from '../shared/constants'

// ── Pending import state ─────────────────────────────────────────────────────

let pendingPulseImport: string | null = null

/**
 * Scan argv for a .pulse file path.
 * The OS passes the file path as the last non-flag argument when launching
 * the app via file association.
 */
export function extractPulseFileFromArgv(argv: string[]): string | null {
  for (let i = argv.length - 1; i >= 0; i--) {
    const arg = argv[i]!
    if (arg.startsWith('-')) continue
    if (extname(arg).toLowerCase() === '.pulse') return arg
  }
  return null
}

/**
 * Validate and store a file path as a pending .pulse import.
 * Returns true if the path was accepted.
 */
export function handleFileOpen(filePath: string): boolean {
  if (!filePath) return false
  if (extname(filePath).toLowerCase() !== '.pulse') return false
  if (!existsSync(filePath)) return false
  pendingPulseImport = filePath
  return true
}

/** Renderer calls this to check for a pending file-open request. */
export function getPendingImport(): string | null {
  return pendingPulseImport
}

/** Renderer calls this after handling the import preview. */
export function clearPendingImport(): void {
  pendingPulseImport = null
}

// ── Windows portable: registry-based file type association ───────────────────

export function registerPulseFileType(): void {
  if (process.platform !== 'win32') return
  const exePath = process.execPath
  // Use execFileSync with argument arrays — no shell interpolation, no injection risk
  execFileSync('reg', ['add', 'HKCU\\Software\\Classes\\.pulse', '/ve', '/d', 'PulseTemplate', '/f'])
  execFileSync('reg', ['add', 'HKCU\\Software\\Classes\\PulseTemplate', '/ve', '/d', `${PRODUCT_NAME} Template`, '/f'])
  execFileSync('reg', ['add', 'HKCU\\Software\\Classes\\PulseTemplate\\shell\\open\\command', '/ve', '/d', `"${exePath}" "%1"`, '/f'])
}

export function unregisterPulseFileType(): void {
  if (process.platform !== 'win32') return
  try {
    execFileSync('reg', ['delete', 'HKCU\\Software\\Classes\\.pulse', '/f'], { stdio: 'ignore' })
    execFileSync('reg', ['delete', 'HKCU\\Software\\Classes\\PulseTemplate', '/f'], { stdio: 'ignore' })
  } catch {
    // Keys may not exist — that's fine
  }
}

export function isPulseFileTypeRegistered(): boolean {
  if (process.platform !== 'win32') return false
  try {
    const result = execFileSync('reg', ['query', 'HKCU\\Software\\Classes\\.pulse', '/ve'], { encoding: 'utf8' })
    return result.includes('PulseTemplate')
  } catch {
    return false
  }
}
