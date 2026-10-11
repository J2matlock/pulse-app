/**
 * The one list of keyboard shortcuts (audit 2.14 / N-08). It feeds the "?"
 * panel, Settings → Shortcuts and the command palette's labels, and a test
 * checks each key against the file that handles it.
 *
 * "Mod" is Ctrl on Windows and Linux and ⌘ on a Mac (isMod accepts both).
 * Descriptions may contain {word} tokens (show them through useVocab().f).
 */
import type { FeatureKey } from './features'

export interface ShortcutRow {
  keys: string[]
  description: string
  /** Shown only while this feature is on */
  feature?: FeatureKey
  /** Where the key is handled (relative to src/renderer), for the test */
  handledIn?: string
}

export interface ShortcutSection {
  title: string
  shortcuts: ShortcutRow[]
}

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'Everywhere',
    shortcuts: [
      { keys: ['Mod', 'K'], description: 'Open the command palette', handledIn: 'hooks/useGlobalKeyboard.ts' },
      { keys: ['Mod', 'Z'], description: 'Undo', handledIn: 'hooks/useGlobalKeyboard.ts' },
      { keys: ['Mod', 'Y'], description: 'Redo (or Mod+Shift+Z)', handledIn: 'hooks/useGlobalKeyboard.ts' },
      { keys: ['Mod', 'Shift', 'D'], description: 'Go to the dashboard', handledIn: 'hooks/useGlobalKeyboard.ts' },
      { keys: ['Mod', 'Shift', 'F'], description: 'Focus mode: only what needs attention today', feature: 'focusMode', handledIn: 'hooks/useGlobalKeyboard.ts' },
      { keys: ['Mod', 'L'], description: 'Lock the app', handledIn: 'hooks/useAutoLock.ts' },
      { keys: ['Mod', '\\'], description: 'Show or hide the sidebar', handledIn: 'components/layout/Sidebar.tsx' },
      { keys: ['?'], description: 'Show keyboard shortcuts', handledIn: 'hooks/useGlobalKeyboard.ts' },
      { keys: ['Mod', '='], description: 'Zoom in', handledIn: 'hooks/useZoom.ts' },
      { keys: ['Mod', '-'], description: 'Zoom out', handledIn: 'hooks/useZoom.ts' },
      { keys: ['Mod', '0'], description: 'Reset zoom', handledIn: 'hooks/useZoom.ts' },
    ],
  },
  {
    title: 'In a {list}',
    shortcuts: [
      { keys: ['Mod', 'F'], description: 'Search the {list}', handledIn: 'components/layout/TopBar.tsx' },
      { keys: ['Mod', 'N'], description: 'Add {a record}', handledIn: 'hooks/useGlobalKeyboard.ts' },
      { keys: ['Mod', 'H'], description: 'Find and replace', handledIn: 'hooks/useGlobalKeyboard.ts' },
      { keys: ['Arrow keys'], description: 'Move between cells' },
      { keys: ['Tab'], description: 'Move to the next cell (wraps to the next row)' },
      { keys: ['Shift', 'Tab'], description: 'Move to the previous cell' },
      { keys: ['Home'], description: 'Jump to the first column in the row' },
      { keys: ['End'], description: 'Jump to the last column in the row' },
      { keys: ['Enter'], description: 'Start editing the cell' },
      { keys: ['F2'], description: 'Start editing the cell' },
      { keys: ['Escape'], description: 'Cancel the edit' },
      { keys: ['Shift', 'Space'], description: 'Select or unselect the {record}, for bulk actions' },
      { keys: ['←'], description: 'From the first column: set the {priority} (Enter opens the list)', feature: 'priority' },
      { keys: ['Mod', 'A'], description: 'Select all the {record:many} shown' },
      { keys: ['Mod', 'C'], description: "Copy the cell's value" },
      { keys: ['Mod', 'Shift', 'C'], description: 'Copy "Column: Value"' },
      { keys: ['Mod', 'V'], description: 'Paste into the cell' },
    ],
  },
  {
    title: 'On {a record} page',
    shortcuts: [
      { keys: ['Alt', '←'], description: 'Previous {record}', handledIn: 'views/ProfileView.tsx' },
      { keys: ['Alt', '→'], description: 'Next {record}', handledIn: 'views/ProfileView.tsx' },
      { keys: ['Mod', 'Enter'], description: 'Save the {activity} you are writing', handledIn: 'components/profile/CaseLog.tsx' },
    ],
  },
  {
    title: 'Tasks',
    shortcuts: [
      { keys: ['Mod', 'Shift', 'T'], description: 'Add a task', feature: 'tasks', handledIn: 'hooks/useGlobalKeyboard.ts' },
    ],
  },
  {
    title: '{ContactDirectory}',
    shortcuts: [
      { keys: ['Mod', 'Shift', 'P'], description: 'Go to {ContactDirectory}', feature: 'contactsDirectory', handledIn: 'hooks/useGlobalKeyboard.ts' },
      { keys: ['N'], description: 'Add {a contact}', feature: 'contactsDirectory', handledIn: 'views/ContactsView.tsx' },
      { keys: ['/'], description: 'Search {contact:many}', feature: 'contactsDirectory', handledIn: 'views/ContactsView.tsx' },
    ],
  },
]

/** One key as this computer writes it: Mod → ⌘ or Ctrl, Alt → ⌥ on a Mac */
export function keyLabel(key: string, mac: boolean): string {
  if (key === 'Mod') return mac ? '⌘' : 'Ctrl'
  if (key === 'Alt' && mac) return '⌥'
  return key
}

/** A whole shortcut as text: "Ctrl+Shift+T" or "⌘+Shift+T" */
export function shortcutText(keys: string[], mac: boolean): string {
  return keys.map(k => keyLabel(k, mac)).join('+')
}

/**
 * Help text written with "Ctrl+…" for the Mod key, as it reads on this
 * computer: "Ctrl+K" stays on Windows and Linux and becomes "⌘+K" on a Mac.
 * Only for shortcuts handled with isMod; a key that needs Ctrl itself on a
 * Mac shouldn't go through here.
 */
export function modText(text: string, mac: boolean): string {
  return mac ? text.replace(/\bCtrl\+/g, `${keyLabel('Mod', mac)}+`) : text
}
