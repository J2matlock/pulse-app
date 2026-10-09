/**
 * app-menu.ts — the macOS menu bar.
 *
 * On macOS, Cut/Copy/Paste/Select All only work in text fields when the menu
 * bar has them, so Pulse needs a real menu there (Windows and Linux keep the
 * hidden default). Undo/Redo don't register their shortcuts: the key press
 * goes to the page, which decides between undoing typing and undoing the
 * last change in Pulse (see useGlobalKeyboard).
 */
import type { MenuItemConstructorOptions } from 'electron'

export type MenuCommand = 'undo' | 'redo'

export function buildMacMenuTemplate(appName: string, send: (cmd: MenuCommand) => void): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: () => send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', registerAccelerator: false, click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    { role: 'windowMenu' },
  ]
}
