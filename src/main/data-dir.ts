import { app } from 'electron'
import { join } from 'path'

/**
 * Get the app's data directory. Dependency-free so any module (including the
 * logger) can use it without import cycles.
 *
 * Windows portable exe (electron-builder "portable" target):
 *   The exe is a self-extracting archive that unpacks to a temp dir each launch.
 *   process.execPath points to the TEMP extraction, NOT where the user placed the exe.
 *   electron-builder sets PORTABLE_EXECUTABLE_DIR to the real location.
 *   Data goes next to the exe so it can run off a USB drive.
 *
 * Linux AppImage / macOS / dev: use standard userData (~/.config/Pulse etc.)
 */
export function getPortableDataDir(): string {
  // E2E tests set PULSE_DATA_DIR to an isolated temp directory
  if (process.env.PULSE_DATA_DIR) {
    return process.env.PULSE_DATA_DIR
  }
  if (app.isPackaged && process.platform === 'win32') {
    const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || join(process.execPath, '..')
    return join(exeDir, 'PulseData')
  }
  return app.getPath('userData')
}
