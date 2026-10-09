/**
 * Removes the temporary test databases a run leaves behind. Some tests never
 * call cleanupTestDb, and thousands of leftover folders once filled /tmp so
 * far that the native module rebuild failed. Only folders made during this
 * run are removed.
 */
import { readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const LEFTOVER = /^pulse-(test|newinstall|cipher-check)-/

export default function setup(): () => void {
  const started = Date.now() - 1000
  return () => {
    const dir = tmpdir()
    for (const name of readdirSync(dir)) {
      if (!LEFTOVER.test(name)) continue
      const path = join(dir, name)
      try { if (statSync(path).birthtimeMs >= started || statSync(path).mtimeMs >= started) rmSync(path, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }
}
