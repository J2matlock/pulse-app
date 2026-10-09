import { useCallback, useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useUndoStore } from '../stores/undoStore'
import { useGridStore } from '../stores/gridStore'
import { isEditableElement } from '../utils/domHelpers'
import { pulseEvents } from '../events'
import { isMod, IS_MAC } from '../utils/keys'
import { IPC } from '../../shared/ipc-channels'
import { featureNow } from './useFeature'

/**
 * Global keyboard shortcuts: Ctrl+K (command palette), ? (shortcuts modal),
 * Ctrl+Z (undo), Ctrl+Y/Ctrl+Shift+Z (redo), Ctrl+Shift+P (contacts),
 * Ctrl+Shift+T (new task), Ctrl+Shift+F (focus mode toggle),
 * Ctrl+H (find and replace), Ctrl+N (add new client).
 */
/**
 * Undo or redo. In a text field, that's the field's own typing history: the
 * browser does it on Windows and Linux; on a Mac (where the menu bar doesn't
 * grab Cmd+Z, see app-menu.ts) Pulse asks for it. Elsewhere it's Pulse's undo.
 * Returns true when the key press was handled here.
 */
function runUndo(kind: 'undo' | 'redo'): boolean {
  if (isEditableElement(document.activeElement)) {
    if (!IS_MAC) return false
    document.execCommand(kind)
    return true
  }
  void (kind === 'undo' ? useUndoStore.getState().undo() : useUndoStore.getState().redo())
  return true
}

export function useGlobalKeyboard(
  setCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>,
  setShortcutsOpen: React.Dispatch<React.SetStateAction<boolean>>,
  setGlobalTaskOpen: React.Dispatch<React.SetStateAction<boolean>>,
): void {
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl+K — command palette
    if (isMod(e) && e.key === 'k') {
      e.preventDefault()
      setCommandPaletteOpen(v => !v)
    }
    // Ctrl+Shift+P — Contacts / Provider Directory
    if (isMod(e) && e.shiftKey && e.key === 'P' && featureNow('contactsDirectory')) {
      e.preventDefault()
      window.location.hash = '#/contacts'
    }
    // Ctrl+Shift+T — New Task (global overlay)
    if (isMod(e) && e.shiftKey && e.key === 'T' && featureNow('tasks')) {
      e.preventDefault()
      setGlobalTaskOpen(true)
    }
    // Ctrl+Shift+F — Focus Mode toggle
    if (isMod(e) && e.shiftKey && e.key === 'F' && featureNow('focusMode')) {
      e.preventDefault()
      const cur = useSettingsStore.getState().focusModeOpen
      useSettingsStore.getState().setFocusModeOpen(!cur)
    }
    // Ctrl+Z — Undo; Ctrl+Y or Ctrl+Shift+Z — Redo (Cmd on a Mac)
    const isUndo = isMod(e) && !e.shiftKey && e.key === 'z'
    const isRedo = isMod(e) && (e.key === 'y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))
    if (isUndo || isRedo) {
      if (runUndo(isRedo ? 'redo' : 'undo')) e.preventDefault()
    }
    // Ctrl+H — Find and Replace (grid view only)
    if (isMod(e) && !e.shiftKey && e.key === 'h') {
      const active = document.activeElement
      if (!isEditableElement(active)) {
        e.preventDefault()
        const route = window.location.hash.split('?')[0] ?? ''
        if (route === '#/' || route === '#/grid' || route.startsWith('#/grid/')) {
          pulseEvents.emit('toggle-find-replace')
        }
      }
    }
    // Ctrl+N — Add new client (grid view only)
    if (isMod(e) && !e.shiftKey && e.key === 'n') {
      const active = document.activeElement
      if (!isEditableElement(active)) {
        const hash = window.location.hash.split('?')[0] ?? ''
        if (hash === '#/' || hash === '#/grid' || hash.startsWith('#/grid/')) {
          e.preventDefault()
          void useGridStore.getState().addRow()
        }
      }
    }
    // '?' shortcut — only when not in an input/textarea to avoid interfering with typing
    if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
      const active = document.activeElement
      if (!isEditableElement(active)) {
        e.preventDefault()
        setShortcutsOpen(v => !v)
      }
    }
  }, [setCommandPaletteOpen, setShortcutsOpen, setGlobalTaskOpen])

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [handleGlobalKeyDown])

  // macOS menu bar: Edit → Undo / Redo clicked with the mouse
  useEffect(() => window.api.on(IPC.MENU_COMMAND, (cmd: unknown) => {
    if (cmd === 'undo' || cmd === 'redo') runUndo(cmd)
  }), [])
}
