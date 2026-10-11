import React, { useState } from 'react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { formatDateTime } from '../../utils/formatTime'
import { localDateString, parseDbTimestamp } from '../../../shared/dates'
import { formatDate } from './CaseLogEntry'

interface Props {
  entryId: number
  editedAt: string
  /** First version, kept on the entry itself (all that older edits stored) */
  originalContent: string | null
}

/** "Edited … — show earlier versions": loads the full edit history when opened. */
export function CaseLogEditHistory({ entryId, editedAt, originalContent }: Props): React.ReactElement {
  const [versions, setVersions] = useState<Array<{ content: string; occurred_at?: string | null; replaced_at: string }> | null>(null)

  async function load() {
    if (versions) return
    const res = await safeInvoke(IPC.CASE_LOG_GET_EDITS, entryId)
    setVersions(res.ok ? res.data : [])
  }

  const shown = versions && versions.length > 0
    ? versions
    : originalContent ? [{ content: originalContent, replaced_at: '' }] : []

  return (
    <details className="mt-1" onToggle={e => { if ((e.target as HTMLDetailsElement).open) void load() }}>
      <summary className="text-sm text-slate-500 dark:text-slate-400 cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-300">
        Edited {formatDateTime(editedAt)} — show earlier versions
      </summary>
      <ol className="mt-1 space-y-1.5">
        {shown.map((v, i) => (
          <li key={i} className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed
                                bg-slate-50 dark:bg-slate-800 rounded-sm px-2 py-1.5 border-l-2 border-slate-300 dark:border-slate-600">
            <span className="block text-slate-500 dark:text-slate-400 mb-0.5">
              Version {i + 1}{v.occurred_at ? ` · dated ${formatDate(localDateString(parseDbTimestamp(v.occurred_at)))}` : ''}{v.replaced_at ? ` · replaced ${formatDateTime(v.replaced_at)}` : ''}
            </span>
            {v.content}
          </li>
        ))}
      </ol>
    </details>
  )
}
