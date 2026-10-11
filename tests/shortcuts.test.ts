/** The one shortcut list is true: every listed key has a handler (audit 2.14 / N-08). */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { SHORTCUT_SECTIONS, shortcutText, keyLabel } from '../src/shared/shortcuts'

describe('shortcut list', () => {
  const rows = SHORTCUT_SECTIONS.flatMap(s => s.shortcuts)

  it('includes undo, redo, search, record-to-record and saving a note', () => {
    const text = rows.map(r => `${r.keys.join('+')} ${r.description}`)
    for (const k of ['Mod+Z', 'Mod+Y', 'Mod+F', 'Alt+←', 'Alt+→', 'Mod+Enter', 'Mod+Shift+D']) {
      expect(text.some(t => t.startsWith(`${k} `))).toBe(true)
    }
  })

  it('every listed key is checked in the file that handles it', () => {
    const root = join(__dirname, '../src/renderer')
    const missing: string[] = []
    for (const r of rows) {
      if (!r.handledIn) continue
      const src = readFileSync(join(root, r.handledIn), 'utf8')
      const last = r.keys[r.keys.length - 1]!
      // How the handler spells the key: e.key === 'k', 'ArrowLeft', '\\'…
      const plain = last === '\\' ? "'\\\\'" : last === '←' ? "'ArrowLeft'" : last === '→' ? "'ArrowRight'" : `'${last}'`
      const found = src.includes(plain) || src.includes(plain.toLowerCase())
      if (!found) missing.push(`${r.keys.join('+')} in ${r.handledIn}`)
    }
    expect(missing).toEqual([])
  })

  it('writes ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(shortcutText(['Mod', 'Shift', 'T'], false)).toBe('Ctrl+Shift+T')
    expect(shortcutText(['Mod', 'Shift', 'T'], true)).toBe('⌘+Shift+T')
    expect(keyLabel('Alt', true)).toBe('⌥')
  })
})
