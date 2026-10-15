/**
 * Buttons, menu items, headings, tabs, dialog titles (the app's and the
 * computer's own Open/Save boxes) and placeholders are in sentence case: "Add
 * task", "Save as template", "Letter templates". "+ Add Task" at the top of a
 * page and "Add task" in the dialog it opens look like two different things
 * (UX review F-07).
 *
 * Source scan of the renderer: JSX text and string literals with two
 * capitalised words in a row ("Save Changes") fail, unless one of them is a
 * proper noun (Pulse, Excel, the Trash, a weekday, a key) or the phrase is an
 * example name listed below. Text in double quotes inside a string names
 * another label ('Click "Download update" above') and isn't checked here.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(__dirname, '../../src/renderer')

/** Words that keep their capital wherever they are */
const PROPER = new Set([
  // Pulse and the programs, file kinds and places it talks about
  'Pulse', 'Excel', 'Word', 'Outlook', 'Google', 'Windows', 'Mac', 'Linux', 'GitHub', 'BaringaSoft', 'PDF', 'CSV',
  'GNU', 'General', 'Public', 'License', 'Privacy', 'Policy',
  // Screens named as places ("the Trash", "Settings → Backup", "Help Center")
  'Trash', 'Dashboard', 'Settings', 'Help', 'Center', 'Calendar', 'Reports', 'Tasks', 'Templates', 'Snippets', 'Letters', 'Contacts', 'Downloads',
  // Keys
  'Ctrl', 'Alt', 'Shift', 'Enter', 'Esc', 'Escape', 'Tab', 'Space', 'Caps', 'Lock',
  // Dates
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
])

/** Example names of people, places, organisations and columns, shown as placeholders or samples */
const EXAMPLES = [
  'Jane Smith', 'Sam Lee', 'Maria Rodriguez', 'Maria Johnson', 'Community Services', 'Services Agency',
  'Main St', 'Annual Review', 'Honda Civic',
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'help-demos' ? [] : sourceFiles(p) // demo data, not labels
    return /\.tsx?$/.test(name) ? [p] : []
  })
}

/** Pairs of capitalised words that aren't a proper noun or an example */
export function titleCasePairs(text: string): string[] {
  let t = text.replace(/\$\{[^}]*\}|\{[^}]*\}/g, 'x').replace(/"[^"]*"|“[^”]*”/g, 'x')
  for (const e of EXAMPLES) t = t.split(e).join('x')
  return [...t.matchAll(/(?=\b([A-Z][a-z]+) ([A-Z][a-z]+)\b)/g)]
    .filter(m => !PROPER.has(m[1]!) && !PROPER.has(m[2]!))
    .map(m => `${m[1]} ${m[2]}`)
}

function offenders(): string[] {
  const out: string[] = []
  for (const file of sourceFiles(ROOT)) {
    // Blank out comments, keeping line numbers
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/ .*$/gm, '')
    const texts: Array<[number, string]> = []
    for (const m of src.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) texts.push([m.index!, m[1]!])
    for (const m of src.matchAll(/'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g)) texts.push([m.index!, (m[1] ?? m[2] ?? m[3])!])
    for (const [at, text] of texts) {
      if (text.length > 160 || /=>|&&|\(\)|\bconst\b|\breturn\b/.test(text)) continue // code, not words
      const pairs = titleCasePairs(text)
      if (pairs.length) out.push(`${relative(ROOT, file)}:${src.slice(0, at).split('\n').length}: ${pairs.join(', ')}`)
    }
  }
  return out
}

describe('labels are in sentence case', () => {
  it('no button, heading, title or placeholder in the renderer is in Title Case', () => {
    expect(offenders()).toEqual([])
  })

  it('the check catches Title Case and lets proper nouns and examples through', () => {
    expect(titleCasePairs('Save Changes')).toEqual(['Save Changes'])
    expect(titleCasePairs('+ Add Task')).toEqual(['Add Task'])
    expect(titleCasePairs('Save changes')).toEqual([])
    expect(titleCasePairs('Empty the Trash')).toEqual([])
    expect(titleCasePairs('Open Pulse Settings')).toEqual([])
    expect(titleCasePairs('e.g. Jane Smith')).toEqual([])
    expect(titleCasePairs('Click "Download Update" above')).toEqual([])
    expect(titleCasePairs('Every Mar 31')).toEqual([])
  })
})
