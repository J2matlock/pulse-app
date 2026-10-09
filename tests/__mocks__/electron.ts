/**
 * Mock for the 'electron' module — used by tests that transitively import
 * modules depending on Electron APIs (auth.ts, database.ts, etc.)
 */
export const app = {
  isPackaged: false,
  getPath: (name: string) => {
    const { tmpdir } = require('os')
    const { join } = require('path')
    return join(tmpdir(), 'pulse-test-electron-mock')
  },
  getName: () => 'Pulse by BaringaSoft',
  getVersion: () => '0.0.0-test',
}

export const ipcMain = {
  handle: () => {},
  on: () => {},
}

export const BrowserWindow = class {
  static getAllWindows() { return [] }
}

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
}

export const shell = {
  openPath: async () => '',
}

export default { app, ipcMain, BrowserWindow, dialog, shell }
