/** The one shortcut list is true: every listed key has a handler (audit 2.14 / N-08). */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { SHORTCUT_SECTIONS, shortcutText, keyLabel, modText } from '../src/shared/shortcuts'

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

  it('never shows the code name "Mod" in a description (E-36)', () => {
    expect(rows.filter(r => /\bMod\b/.test(r.description)).map(r => r.description)).toEqual([])
  })

  it('writes ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(shortcutText(['Mod', 'Shift', 'T'], false)).toBe('Ctrl+Shift+T')
    expect(shortcutText(['Mod', 'Shift', 'T'], true)).toBe('⌘+Shift+T')
    expect(keyLabel('Alt', true)).toBe('⌥')
  })

  it('help text says ⌘ instead of Ctrl on a Mac', () => {
    expect(modText('Press Ctrl+K, then Ctrl+Shift+T', false)).toBe('Press Ctrl+K, then Ctrl+Shift+T')
    expect(modText('Press Ctrl+K, then Ctrl+Shift+T', true)).toBe('Press ⌘+K, then ⌘+Shift+T')
  })

  // Tooltips and help used to hard-code "Ctrl+", so a Mac showed two answers (R7)
  it('screen text names shortcuts through modHelp, not a bare "Ctrl+"', () => {
    const root = join(__dirname, '../src/renderer')
    // Text these files hold is shown through modHelp where it's rendered (HelpView, TourOverlay's steps);
    // What's New lists past releases as they were written.
    const shownElsewhere = new Set(['views/help/faqData.tsx', 'components/shared/tourSteps.tsx', 'components/shared/WhatsNewModal.tsx'])
    const bare: string[] = []
    const walk = (dir: string): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name)
        if (ent.isDirectory()) { walk(full); continue }
        if (!/\.tsx?$/.test(ent.name)) continue
        const rel = full.slice(root.length + 1).replace(/\\/g, '/')
        if (shownElsewhere.has(rel)) continue
        readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
          const code = line.trim()
          if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return
          if (/Ctrl\+/.test(code.replace(/\/\/.*$/, '').replace(/\{?\s*\/\*.*?\*\/\s*\}?/g, '')) && !/modHelp\(|IS_MAC \?/.test(code)) bare.push(`${rel}:${i + 1}`)
        })
      }
    }
    walk(root)
    expect(bare).toEqual([])
  })
})
