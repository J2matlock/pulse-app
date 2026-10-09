/**
 * app-identity.ts — pins the app's internal identity. Imported FIRST by
 * index.ts, so it runs before any module can read paths or the key store.
 *
 * Electron derives the data folder and the OS key-store (Keychain/libsecret)
 * entry from the app name. If the product is renamed (or package.json's name
 * changes), existing users would otherwise get a new, empty data folder and a
 * key store that can't decrypt their wrapped database key. Windows portable
 * data lives next to the exe (data-dir.ts) and isn't affected either way.
 */
import { app } from 'electron'
import { join } from 'path'
import { INTERNAL_APP_NAME } from '../shared/constants'

export function pinAppIdentity(): void {
  app.setName(INTERNAL_APP_NAME)
  // The data path is fixed at startup from the original name, so set it
  // explicitly too. Respect an explicit --user-data-dir (tests, debugging).
  if (!app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', join(app.getPath('appData'), INTERNAL_APP_NAME))
  }
}

pinAppIdentity()
