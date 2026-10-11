/**
 * Gives each test run its own temp folder and removes it afterwards.
 *
 * Some tests never call cleanupTestDb, and thousands of leftover folders once
 * filled /tmp so far that the native module rebuild failed. Cleanup used to
 * delete every pulse-test-* folder made since the run started, which also
 * deleted the databases of another vitest run going at the same time and made
 * its tests fail at random (ENOENT, "disk I/O error"). Pointing TMPDIR at a
 * folder of this run's own keeps runs apart: os.tmpdir() in the test workers
 * returns it, so everything made with mkdtemp(tmpdir()) is removed with it.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/** Fixed names some tests use directly under the system temp folder */
const LEFTOVER = /^pulse-(test|newinstall|cipher-check)-/

export default function setup(): () => void {
  const systemTmp = tmpdir()
  const runDir = mkdtempSync(join(systemTmp, 'pulse-run-'))
  const previousTmpDir = process.env.TMPDIR
  process.env.TMPDIR = runDir
  const started = Date.now() - 1000
  return () => {
    if (previousTmpDir === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previousTmpDir
    try { rmSync(runDir, { recursive: true, force: true }) } catch { /* best effort */ }
    for (const name of readdirSync(systemTmp)) {
      if (!LEFTOVER.test(name)) continue
      const path = join(systemTmp, name)
      try { if (statSync(path).birthtimeMs >= started || statSync(path).mtimeMs >= started) rmSync(path, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }
}
