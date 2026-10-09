import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'

export function SnippetsSection(): React.ReactElement {
  const navigate = useNavigate()
  const [snippets, setSnippets] = useState<Array<{ id: number; trigger_text: string; expansion: string }>>([])

  useEffect(() => {
    async function loadSnippets() {
      const res = await safeInvoke(IPC.SNIPPET_GET_ALL)
      if (res.ok) setSnippets(res.data)
    }
    loadSnippets()
  }, [])

  return (
    <>
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Snippets</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Snippets let you type a short trigger (like <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded-sm text-sm">/hw</code>) and
        expand it into longer text. Manage your full snippet library from the Snippets page.
      </p>

      <button
        onClick={() => navigate('/snippets')}
        className="btn-primary flex items-center gap-2"
        style={{ minHeight: 44 }}
      >
        <FileText className="w-4 h-4" />
        Manage Snippets
      </button>

      {snippets.length > 0 ? (
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[120px_1fr] text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide border-b border-slate-200 dark:border-slate-700 px-3 py-2 bg-slate-50 dark:bg-slate-800">
            <span>Trigger</span>
            <span>Preview</span>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {snippets.map(s => (
              <div key={s.id} className="grid grid-cols-[120px_1fr] items-center px-3 py-2 border-b border-slate-100 dark:border-slate-700 last:border-0 min-w-0">
                <code className="text-sm font-mono text-blue-600 dark:text-blue-400">/{s.trigger_text}</code>
                <span className="text-sm text-slate-600 dark:text-slate-400 truncate min-w-0">
                  {s.expansion}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">No snippets yet. Create one from the Snippets page.</p>
      )}
    </>
  )
}
