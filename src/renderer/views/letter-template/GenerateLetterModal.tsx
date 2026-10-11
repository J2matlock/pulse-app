import toast from 'react-hot-toast'
import React, { useEffect, useRef, useState } from 'react'
import { FileText, X, AlertTriangle, ChevronDown, Copy, Check, FileDown } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { Grid } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import type { LetterTemplate } from './types'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { rlog } from '../../utils/rendererLogger'
import { noteUnencryptedExport } from '../../utils/exportNotice'
import { useVocab } from '../../hooks/useVocab'
import { UnknownPlaceholders } from '../../components/shared/UnknownPlaceholders'
import { useGridStore } from '../../stores/gridStore'
import { rememberedList, rememberList } from './templateList'

const SHOWN = 50

interface GenerateModalProps {
  template: LetterTemplate
  grids: Grid[]
  onClose: () => void
}

export function GenerateLetterModal({ template, grids, onClose }: GenerateModalProps): React.ReactElement {
  const { t } = useVocab(null)
  // The list this template was last used with, else the open one
  const activeGridId = useGridStore(s => s.activeGridId)
  const [selectedGridId, setSelectedGridId] = useState<number | ''>(() => {
    const pick = [rememberedList(template.id), activeGridId].find(id => id != null && grids.some(g => g.id === id))
    return pick ?? grids[0]?.id ?? ''
  })
  const [query, setQuery] = useState('')
  const [clientRowId, setClientRowId] = useState('')
  const [clientRows, setClientRows] = useState<{ row_id: number; name: string }[]>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [unknown, setUnknown] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const { copied, copyToClipboard: doCopy, resetCopied } = useCopyFeedback()
  const resultRef = useRef<HTMLTextAreaElement>(null)
  const trapRef = useRef<HTMLDivElement>(null)

  useFocusTrap(trapRef, true)

  // Load client names when grid selection changes
  useEffect(() => {
    if (!selectedGridId) { setClientRows([]); return }
    let cancelled = false
    ;(async () => {
      setLoadingClients(true)
      try {
        const res = await safeInvoke<{
          columns: { id: number; is_name_column: number }[]
          rows: Record<string, unknown>[]
        }>(IPC.GRID_GET, Number(selectedGridId))
        if (cancelled) return
        if (res.ok) {
          const nameCol = res.data.columns.find(c => c.is_name_column === 1)
          if (nameCol) {
            const key = `col_${nameCol.id}`
            const items = res.data.rows
              .map(r => ({
                row_id: r.row_id as number,
                name: (r[key] as string | null) || '(unnamed)',
              }))
              .sort((a, b) => a.name.localeCompare(b.name))
            setClientRows(items)
          } else {
            setClientRows(res.data.rows.map(r => ({
              row_id: r.row_id as number,
              name: `Row ${r.row_id}`,
            })))
          }
        }
      } catch (err) { rlog.error('GenerateLetterModal', 'Failed to load clients for letter generation', err) }
      finally { if (!cancelled) setLoadingClients(false) }
    })()
    return () => { cancelled = true }
  }, [selectedGridId])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleGenerate() {
    if (!selectedGridId) { setError(`Please select ${t('list', { article: true })}.`); return }
    const rowId = clientRowId ? parseInt(clientRowId, 10) : NaN
    if (isNaN(rowId) || rowId < 1) {
      setError(`Please select ${t('record', { article: true })}.`)
      return
    }
    setGenerating(true)
    setError(null)
    setResult(null)
    rememberList(template.id, Number(selectedGridId))
    try {
      const res = await safeInvoke<{ text: string; unknown: string[] }>(
        IPC.LETTER_TEMPLATE_GENERATE, template.id, rowId, Number(selectedGridId)
      )
      if (!res.ok) {
        setError(res.error ?? `Could not generate the letter. Please check the ${t('record')} and try again.`)
      } else {
        setResult(res.data.text)
        setUnknown(res.data.unknown)
      }
    } catch {
      setError('Something went wrong while generating the letter. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleCopy(text: string) {
    try {
      await doCopy(text)
    } catch (err) {
      rlog.error('GenerateLetterModal', 'Copy to clipboard failed', err)
      // Fallback: select the textarea
      resultRef.current?.select()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div ref={trapRef} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <FileText className="w-5 h-5 text-blue-500 flex-shrink-0" />
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex-1 truncate">
            Generate: {template.name}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-sm text-slate-500 hover:text-slate-600 dark:hover:text-slate-200
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px] min-w-[44px]
                       flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-base text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {!result && (
            <>
              <div>
                <label htmlFor="letter-preview-grid" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t('list', { cap: true })}
                </label>
                <div className="relative">
                  <select
                    id="letter-preview-grid"
                    value={selectedGridId}
                    onChange={e => { setSelectedGridId(Number(e.target.value)); setClientRowId(''); setQuery('') }}
                    className="w-full appearance-none rounded-lg border border-slate-300 dark:border-slate-600
                               bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100
                               px-3 py-2 pr-8 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px]"
                  >
                    {grids.length === 0 && <option value="">No {t('list', { many: true })} available</option>}
                    {grids.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
                </div>
              </div>

              <div>
                {/* A search box instead of one long select: 200 names don't fit a dropdown */}
                <label htmlFor="letter-preview-client" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t('record', { cap: true })}
                </label>
                <input
                  id="letter-preview-client"
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  disabled={loadingClients}
                  placeholder={loadingClients ? `Loading ${t('record', { many: true })}…` : `Type a name to find ${t('record', { article: true })}`}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800
                             text-slate-800 dark:text-slate-100 px-3 py-2 text-base focus:outline-hidden focus:ring-3
                             focus:ring-blue-500 min-h-[44px] disabled:opacity-50"
                />
                {(() => {
                  const q = query.trim().toLowerCase()
                  const matches = q ? clientRows.filter(c => c.name.toLowerCase().includes(q)) : clientRows
                  if (loadingClients) return null
                  if (matches.length === 0) return <p className="text-base text-slate-500 dark:text-slate-400 mt-2">No {t('record', { many: true })} match "{query}".</p>
                  return (
                    <>
                      <div role="listbox" aria-label={`Choose ${t('record', { article: true })}`} className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-300 dark:border-slate-600">
                        {matches.slice(0, SHOWN).map(c => {
                          const on = String(c.row_id) === clientRowId
                          return (
                            <button key={c.row_id} type="button" role="option" aria-selected={on} onClick={() => setClientRowId(String(c.row_id))}
                              className={`block w-full text-left px-3 text-base min-h-[44px] focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                                ${on ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 font-medium' : 'text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                              {c.name}
                            </button>
                          )
                        })}
                      </div>
                      {matches.length > SHOWN && (
                        <p className="text-base text-slate-500 dark:text-slate-400 mt-1">Showing {SHOWN} of {matches.length}. Type more of the name to narrow it down.</p>
                      )}
                    </>
                  )
                })()}
              </div>
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-base font-medium text-slate-700 dark:text-slate-200">Generated letter:</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopy(result)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                               text-base text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700
                               focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px]"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied' : 'Copy to Clipboard'}
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const res = await safeInvoke<string | null>(IPC.LETTER_TEMPLATE_EXPORT_PDF, { text: result })
                        if (res.ok && res.data) {
                          resetCopied()
                          noteUnencryptedExport()
                        } else if (!res.ok) {
                          toast.error("We couldn't save the letter as a PDF. Please try again.")
                        }
                      } catch (err) { rlog.error('GenerateLetterModal', 'PDF export failed', err) }
                    }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                               text-base text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700
                               focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px]"
                  >
                    <FileDown className="w-4 h-4" />
                    Export PDF
                  </button>
                </div>
              </div>
              <UnknownPlaceholders unknown={unknown} />
              <textarea
                ref={resultRef}
                value={result}
                readOnly
                rows={18}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700
                           bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200
                           px-3 py-3 text-base font-mono resize-y focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                style={{ fontSize: 15 }}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                       text-base text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px]"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleGenerate}
              disabled={generating || !selectedGridId}
              className="px-5 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-base font-medium
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:ring-offset-3
                         disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
            >
              {generating ? 'Generating...' : 'Generate'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
