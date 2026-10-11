/** Error toasts never show developer text (audit 2.15 / N-28, AUDIT-061). */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { friendlyError, DEFAULT_ERROR } from '../../src/renderer/utils/friendlyError'

describe('friendlyError', () => {
  it('passes through messages written for people', () => {
    expect(friendlyError('That record is no longer available.')).toBe('That record is no longer available.')
    expect(friendlyError("There's already a tag called that.")).toBe("There's already a tag called that.")
    expect(friendlyError('Minutes must be a whole number up to 1,440.')).toBe('Minutes must be a whole number up to 1,440.')
    expect(friendlyError('Nothing was imported, because row 4 couldn\'t be saved. Check that row in the file, then try again.'))
      .toMatch(/^Nothing was imported/)
    expect(friendlyError('Import (vCard) works with files from macOS or iCloud.')).toMatch(/^Import/)
  })

  it('replaces validation codes and raw system text with the fallback', () => {
    for (const raw of ['Invalid ID', 'Row not found', 'Grid 12 not found', 'Invalid reorder payload', 'Unknown settings key',
      'UNIQUE constraint failed: tags.name', "Error invoking remote method 'x': Error", '', 'ENOENT', 'IPC communication error',
      // Shown word for word before AUDIT-061
      'Bulk action limited to 1000 rows', 'No rows specified', 'Invalid provider ID in list', 'Expected an array of provider IDs',
      'created_at out of valid range', 'is_completed must be 0 or 1', 'Invalid log type: visit', 'Unknown settings key: foo',
      'Cell value must be a string under 100k characters', 'Template items must be a JSON array',
      'Invalid due_date (must be ISO date string)', 'Grid name is required', 'Only http/https URLs are allowed', 'Config too large',
      'Invalid visibility entry — each must have integer columnId and isVisible 0|1',
      'retentionMonths must be an integer >= 1. To delete all history, use a dedicated purge operation.',
      "Could not write file: EACCES: permission denied, open 'C:\\Users\\x\\a.pulse-checklist'",
      'TypeError: Cannot read properties of undefined (reading \'id\')', 'Column width exceeds maximum (2000px)',
      'Content too large', 'Tag is required (max 200 chars)', 'Too many headers (max 200)']) {
      expect(friendlyError(raw), raw).toBe(DEFAULT_ERROR)
    }
    expect(friendlyError(undefined, 'Could not save.')).toBe('Could not save.')
  })

  it('explains a read-only database', () => {
    expect(friendlyError('READ_ONLY')).toMatch(/can't be saved right now/)
  })
})

/**
 * Every message main can send (fail('…') and the messages of its own error
 * classes like StageError) is either written for people — listed here and
 * passed through — or developer text that friendlyError replaces. A new
 * message that is neither fails this test: write it for people and add it
 * here, or make sure the filter catches it.
 */
const PLAIN = new Set<string>([
  'READ_ONLY', // friendlyError turns it into its own sentence
  '${msg} Nothing was erased.',
  "${n} new file${n === 1 ? ' was' : 's were'} added, but the ones already attached weren't added again. ${again.error}",
  "${word('activity', { cap: true })} can't be empty. To remove one, use Void.",
  "${word('contact', { cap: true })} name is required (max 500 characters).",
  "${word('priority', { cap: true })} name is required (max 100 characters).",
  "A Files column can't be changed to another type, or made from one. Add a new column instead.",
  'A repeating task needs a due date. Turn off Repeat to remove the date.',
  'Abbreviation is required',
  'An item can only move to a group on the same checklist.',
  'Save it as a Pulse checklist file (the name ends in .pulse-checklist).',
  'Choose a Pulse checklist file (the name ends in .pulse-checklist).',
  "Pulse couldn't open that file. It may have been moved or deleted.",
  'That file is too large to be a Pulse checklist.',
  'This checklist was made by a newer version of Pulse. Update Pulse, then try again.',
  'That checklist has more than 500 items, which is more than Pulse can bring in.',
  'That checklist is too large for Pulse to bring in.',
  "Built-in deadline rules can't be deleted.",
  'Change words and features from Settings → Workspace',
  'Choose a backup file',
  'Choose the day it was done.',
  'Choose the new date and say why.',
  'Choose the options first.',
  'Choose where to save it',
  'Could not decrypt backup',
  'Could not read file',
  'Each item must have a title',
  'Enter the password or recovery key used with this backup',
  'Enter the reading as a number.',
  'Enter your password to confirm.',
  'Keep at least one working day in the week.',
  "Link columns can't be changed to another type, or made from one.",
  'Maximum of 20 saved views reached',
  'Not supported on this platform',
  'Nothing to undo',
  "Numbers are filled in automatically and can't be changed.",
  'Password is already configured',
  'Points must be a number between 0 and 1000',
  "Pulse couldn't check your password, so nothing was erased.",
  'Pulse is already set up on this computer. Unlock it, then use Settings → Backup to restore.',
  "Pulse's own entries keep their date.",
  'Some of those dates could not be read.',
  'Template has no items',
  'Template is missing a name',
  'Template items are corrupted',
  "That ${word('activity')} is too long (max 100,000 characters).",
  "That ${word('activity')} is already there.",
  "${word('activity', { many: true, cap: true })} older than ${CASE_NOTE_DELETE_WINDOW_MINUTES} minutes can't be deleted. Void it instead: it's kept but hidden.",
  "That ${word('contact')} no longer exists.",
  "That backup couldn't be opened, and Pulse couldn't put your previous data back on its own. A copy of it is saved at ${safetyPath}. Close Pulse, open it again, and restore that copy from Settings → Backup.",
  "That backup couldn't be opened, so Pulse put your previous data back. Nothing was lost.",
  "That backup couldn't be opened. Close Pulse and open it again. If your data is missing, restore a different backup from Settings → Backup.",
  "That can't be undone any more.",
  "That column doesn't number automatically.",
  'That column shows links. Use the link picker to change it.',
  'That file is no longer available.',
  'That form no longer exists.',
  "That kind of ${word('activity')} isn't available any more. Pick another and try again.",
  'That link no longer exists.',
  "That list doesn't exist any more.",
  "That list isn't in the Trash.",
  'That list no longer exists. It may have been deleted.',
  "That password didn't work. Nothing was erased.",
  "That reminder setting isn't valid.",
  'That report is no longer available.',
  "That setting isn't valid.",
  "That template doesn't exist any more.",
  'That text is too long',
  "The backup was restored, but Pulse couldn't open it. Close Pulse, open it again and sign in with your new password.",
  "This computer isn't showing notifications from Pulse. Check that notifications are allowed for Pulse in your system settings.",
  "This kind of column can't be used as the name.",
  "Those ${word('contact')} details couldn't be saved.",
  "Those list settings couldn't be saved.",
  "Those repeat settings couldn't be saved.",
  'To number each one automatically, add a new auto-number column.',
  'Up to ${MAX_HOLIDAYS} days off can be saved.',
  'Use "Link to another list" to add a link column.',
  "We couldn't add that example. Please try again.",
  "We couldn't find that ${word('record')} or ${word('list')}.",
  "We couldn't find that ${word('record')}.",
  "We couldn't find the license file in this copy of Pulse.",
  "We couldn't open the license file. Your computer may not have an app for text files.",
  "We couldn't remove the sample data. Nothing was changed; please try again.",
  "We couldn't save that answer.",
  "We couldn't save that change — the ${word('record')} or column no longer exists. Reopen the list and try again.",
  "We couldn't save your place in setup.",
])

/** fail('…') literals and new XxxError('…') literals (not plain Error), as written in the source */
function mainMessages(): string[] {
  const out = new Set<string>()
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!p.endsWith('.ts')) continue
      const src = readFileSync(p, 'utf8')
      for (const m of src.matchAll(/\bfail\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) out.add(m[2])
      for (const m of src.matchAll(/new ([A-Z]\w*Error)\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g)) {
        if (!['Error', 'TypeError', 'RangeError', 'DatabaseOpenError'].includes(m[1])) out.add(`${m[1]}|${m[3]}`)
      }
    }
  }
  walk(join(__dirname, '../../src/main'))
  return [...out].map(s => s.replace(/\\(['"`])/g, '$1'))
}

/** Fill ${…} with a sample word so the message reads as it would at run time */
function sample(literal: string): string {
  let out = ''
  for (let i = 0; i < literal.length; i++) {
    if (literal[i] === '$' && literal[i + 1] === '{') {
      let depth = 0
      let j = i + 1
      for (; j < literal.length; j++) {
        if (literal[j] === '{') depth++
        else if (literal[j] === '}' && --depth === 0) break
      }
      out += 'sample'
      i = j
    } else out += literal[i]
  }
  return out
}

describe('every main-process message', () => {
  const messages = mainMessages()

  it('finds the messages to check', () => {
    expect(messages.length).toBeGreaterThan(200)
  })

  it('is written for people or replaced by the fallback', () => {
    const wrong: string[] = []
    for (const literal of messages) {
      const [cls, text] = literal.includes('|') && /^[A-Z]\w*Error\|/.test(literal) ? literal.split(/\|(.*)/s) : [null, literal]
      // An app's own error class carries a message written for people unless it says otherwise
      const plain = cls ? !/^(Template not found|Invalid template items format)$/.test(text) : PLAIN.has(text)
      const shown = friendlyError(sample(text), 'FALLBACK')
      if (plain ? shown === 'FALLBACK' : shown !== 'FALLBACK') wrong.push(`${plain ? 'hidden' : 'shown'}: ${text}`)
    }
    expect(wrong).toEqual([])
  })
})
