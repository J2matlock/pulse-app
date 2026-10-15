/**
 * Undo, not "Are you sure?" (UX pass Q4). Something that can be got back
 * happens at once and shows "<what happened> · Undo"; a confirmation stays
 * only where nothing can bring the data back (C), for a choice, an unsaved
 * draft or a warning (D), or where the action changes things elsewhere that
 * the user can't see from here (the dependents rule). This keeps the list.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT = join(__dirname, '../../src/renderer')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(p) ? [p] : []
  })
}

const rel = (file: string) => relative(ROOT, file).split(sep).join('/')

type Kind = 'C' | 'D' | 'dependents' | 'pending B2'

/** Every file that may render <ConfirmDialog, and why it still asks */
const ALLOWED: Record<string, { kind: Kind; why: string; count?: number }> = {
  'views/TrashView.tsx': { kind: 'C', count: 4, why: 'Delete a record or a list forever, Empty Trash, and "restore the list first" (a choice)' },
  'components/grid/DeletedColumnsSection.tsx': { kind: 'C', why: 'Delete a column forever (type its name)' },
  'components/shared/TrashFiles.tsx': { kind: 'C', why: 'Delete a file forever' },
  'components/settings/BackupSection.tsx': { kind: 'C', why: 'Restore a backup over the current data (type RESTORE)' },
  'components/settings/DataSection.tsx': { kind: 'C', why: 'Delete all cell history' },
  'components/shared/UndoHistoryPanel.tsx': { kind: 'D', count: 2, why: 'Forget the undo history (C); undo several steps at once (Redo reverses it)' },
  'components/links/LinkSetupDialog.tsx': { kind: 'C', why: 'Remove a link type: its links and their columns have no undo yet' },
  'views/HelpView.tsx': { kind: 'D', why: 'Start the tour (harmless; the first-five-minutes plan, Q7, owns it)' },
  'views/PasswordSetupView.tsx': { kind: 'D', why: 'Skip the recovery key (a security warning)' },
  'views/ReportsView.tsx': { kind: 'D', why: 'Discard unsaved changes' },
  'views/letter-template/EditTemplateModal.tsx': { kind: 'D', why: 'Discard unsaved changes' },
  'components/contacts/ContactForm.tsx': { kind: 'D', why: 'Discard unsaved changes' },
  'components/forms/FillFormDialog.tsx': { kind: 'D', why: 'Discard unsaved changes' },
  'components/shared/SampleDataBanner.tsx': { kind: 'D', why: 'Remove the sample records: it also clears the undo history' },
  'views/GridView.tsx': { kind: 'D', why: 'Change column type: every caller passes skipConfirm and ChangeTypeDialog previews it with undo; looks unreachable, left for a cleanup' },
  'components/grid/ColumnHeader.tsx': { kind: 'dependents', why: 'Only when rules, forms or views use the column: the dialog lists them' },
  'components/alerts/DeleteRuleConfirm.tsx': { kind: 'dependents', why: 'Only when columns use the rule: the dialog lists them' },
}

const files = sourceFiles(ROOT).filter(f => !f.endsWith(join('shared', 'ConfirmDialog.tsx')))
const uses = new Map<string, number>()
for (const f of files) {
  const n = [...readFileSync(f, 'utf8').matchAll(/<ConfirmDialog\b/g)].length
  if (n > 0) uses.set(rel(f), n)
}

describe('confirmation policy (Q4)', () => {
  it('finds the confirmations', () => {
    expect(uses.size).toBeGreaterThan(10)
  })

  it('asks only where undo can\'t help; anything else happens at once with the Undo toast', () => {
    const stray = [...uses.keys()].filter(f => !ALLOWED[f])
    if (stray.length) {
      throw new Error(`${stray.join(', ')}: can this be undone? Then do it and show the Undo toast `
        + '(see plans/ux-review-2026-10/phase2/plan-Q4-undo-not-confirm.md). If it can\'t, add it here with the reason.')
    }
  })

  it('each allowed file asks as many times as listed, so a new question in it is noticed', () => {
    const off = Object.entries(ALLOWED)
      .filter(([f, a]) => uses.has(f) && (uses.get(f) ?? 0) > (a.count ?? 1))
      .map(([f, a]) => `${f}: ${uses.get(f)} (listed ${a.count ?? 1})`)
    expect(off).toEqual([])
  })

  it('the list has no stale entries', () => {
    expect(Object.keys(ALLOWED).filter(f => !uses.has(f))).toEqual([])
  })

  it('typing a word to confirm is kept for what can never come back', () => {
    const typed = files
      .filter(f => /variant=["']typed["']/.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort()
    expect(typed).toEqual(['components/grid/DeletedColumnsSection.tsx', 'components/settings/BackupSection.tsx', 'views/TrashView.tsx'])
  })

  it('no "click again to delete" confirmations', () => {
    const found = files.filter(f => /Click again to (delete|remove)/i.test(readFileSync(f, 'utf8'))).map(rel)
    expect(found).toEqual([])
  })
})
