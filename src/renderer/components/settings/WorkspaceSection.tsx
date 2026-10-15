import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { LayoutTemplate, Share2, FolderOpen } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { StarterRef, StarterSummary } from '../../../shared/starters/schema'
import { safeInvoke } from '../../utils/safeInvoke'
import { FeaturesSection } from './FeaturesSection'
import { ApplyStarterDialog } from '../starters/ApplyStarterDialog'
import { useVocab } from '../../hooks/useVocab'
import { WordsEditor } from './WordsEditor'
import { friendlyError } from '../../utils/friendlyError'

/**
 * Settings → Workspace (W01 §6): words, feature switches, adding lists from
 * an example, and sharing your setup as a template file.
 */
export function WorkspaceSection(): React.ReactElement {
  const { t } = useVocab(null)
  const [adding, setAdding] = useState(false)
  const [opened, setOpened] = useState<{ source: StarterRef; summary: StarterSummary } | null>(null)
  const [busy, setBusy] = useState(false)

  async function exportSetup() {
    setBusy(true)
    try {
      const r = await safeInvoke(IPC.WORKSPACE_EXPORT_TEMPLATE)
      if (!r.ok) toast.error(friendlyError(r.error))
      else if (r.data) toast.success(`Saved your whole setup. Only ${t('list', { many: true })}, columns and rules are in it, no ${t('record', { many: true })} or ${t('activity', { many: true })}.`)
    } finally { setBusy(false) }
  }

  async function openFile() {
    setBusy(true)
    try {
      const r = await safeInvoke(IPC.STARTER_OPEN_FILE)
      if (!r.ok) toast.error(friendlyError(r.error))
      else if (r.data) setOpened(r.data)
    } finally { setBusy(false) }
  }
  return (
    <div className="space-y-8">
      <WordsEditor />
      <div className="pt-6 border-t border-slate-200 dark:border-slate-700">
        <FeaturesSection />
      </div>
      <section className="space-y-2 pt-6 border-t border-slate-200 dark:border-slate-700" aria-labelledby="add-from-example">
        <h2 id="add-from-example" className="text-xl font-semibold text-slate-800 dark:text-slate-100">Add {t('list', { many: true })} from an example</h2>
        <p className="text-base text-slate-600 dark:text-slate-300">
          Add ready-made {t('list', { many: true })} with their columns and deadline rules. Nothing you already have is changed.
        </p>
        <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setAdding(true)}>
          <LayoutTemplate className="w-4 h-4" aria-hidden="true" />
          Browse examples…
        </button>
      </section>
      <section className="space-y-2 pt-6 border-t border-slate-200 dark:border-slate-700" aria-labelledby="share-setup">
        <h2 id="share-setup" className="text-xl font-semibold text-slate-800 dark:text-slate-100">Share my whole setup</h2>
        <p className="text-base text-slate-600 dark:text-slate-300">
          Save your {t('list', { many: true })}, columns, deadline rules, checklists and words as one file a coworker can open.
          It never includes {t('record', { many: true })}, {t('activity', { many: true })} or anything about you.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={busy} onClick={() => void exportSetup()}>
            <Share2 className="w-4 h-4" aria-hidden="true" />
            Save my whole setup…
          </button>
          <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={busy} onClick={() => void openFile()}>
            <FolderOpen className="w-4 h-4" aria-hidden="true" />
            Open a setup file…
          </button>
        </div>
      </section>
      {adding && <ApplyStarterDialog mode="add" onClose={() => setAdding(false)} />}
      {opened && <ApplyStarterDialog mode="add" initial={opened} onClose={() => setOpened(null)} />}
    </div>
  )
}
