import toast from 'react-hot-toast'
import React, { useEffect, useId, useRef, useState } from 'react'
import { FileText, X, AlertTriangle, ChevronDown, Copy, Check, FileDown } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { Column, Grid, GridRow } from '../../../shared/types'
import { getClientName } from '../../utils/clientName'
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
import { friendlyError } from '../../utils/friendlyError'

const SHOWN = 50

/** The Settings → Profile details a letter can use, by placeholder ending (my_name, case_manager_name, …) */
const PROFILE_DETAILS = { name: 'name', title: 'title', org: 'organization', phone: 'phone', email: 'email' } as const
type ProfileDetail = keyof typeof PROFILE_DETAILS

/**
 * The profile details this template uses that are empty, so the letter would print
 * "My name is ," (UX review E-08). Worked out here from the template text; a shared
 * empty-placeholder signal may replace it.
 */
export function emptyProfileDetails(content: string, profile: Record<string, string> | null): string[] {
  const used = new Set<ProfileDetail>()
  for (const m of content.matchAll(/\{\{\s*(?:my|case_manager)_(name|title|org|phone|email)\s*\}\}/g)) used.add(m[1] as ProfileDetail)
  return (Object.keys(PROFILE_DETAILS) as ProfileDetail[])
    .filter(k => used.has(k) && !(profile?.[`profile_${k}`] ?? '').trim())
    .map(k => PROFILE_DETAILS[k])
}

function listWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

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
  const [missingProfile, setMissingProfile] = useState<string[]>([])
  const { copied, copyToClipboard: doCopy, resetCopied } = useCopyFeedback()
  const resultRef = useRef<HTMLTextAreaElement>(null)
  const trapRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useFocusTrap(trapRef, true)

  // Load client names when grid selection changes
  useEffect(() => {
    if (!selectedGridId) { setClientRows([]); return }
    let cancelled = false
    ;(async () => {
      setLoadingClients(true)
      try {
        const res = await safeInvoke<{
          columns: Column[]
          hiddenColumns?: Column[]
          rows: GridRow[]
        }>(IPC.GRID_GET, Number(selectedGridId))
        if (cancelled) return
        if (res.ok) {
          // The full name (display format, or first + last name) so two "Maria"s can be told apart
          const cols = [...res.data.columns, ...(res.data.hiddenColumns ?? [])]
          const items = res.data.rows
            .map(r => ({ row_id: r.row_id, name: getClientName(r, cols, `${t('record', { cap: true })} #${r.row_id}`) }))
            .sort((a, b) => a.name.localeCompare(b.name))
          setClientRows(items)
        }
      } catch (err) { rlog.error('GenerateLetterModal', 'Failed to load clients for letter generation', err) }
      finally { if (!cancelled) setLoadingClients(false) }
    })()
    return () => { cancelled = true }
  }, [selectedGridId, t])

  // Which of the template's "your name / title / …" details Settings → Profile leaves empty
  useEffect(() => {
    if (!/\{\{\s*(?:my|case_manager)_/.test(template.content)) { setMissingProfile([]); return }
    let cancelled = false
    void safeInvoke<Record<string, string> | null>(IPC.SETTINGS_GET_ALL).then(res => {
      if (!cancelled) setMissingProfile(emptyProfileDetails(template.content, res.ok ? res.data : null))
    })
    return () => { cancelled = true }
  }, [template.content])

  function openProfileSettings() {
    onClose()
    window.location.hash = '#/settings?tab=profile'
  }

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleGenerate() {
    if (!selectedGridId) { setError(`Choose ${t('list', { article: true })}.`); return }
    const rowId = clientRowId ? parseInt(clientRowId, 10) : NaN
    if (isNaN(rowId) || rowId < 1) {
      setError(`Choose ${t('record', { article: true })}.`)
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
        setError(friendlyError(res.error, `We couldn't make the letter — check the ${t('record')} and try again`))
      } else {
        setResult(res.data.text)
        setUnknown(res.data.unknown)
      }
    } catch {
      setError("We couldn't make the letter — try again")
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
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <FileText className="w-5 h-5 text-blue-500 flex-shrink-0" />
          <h2 id={titleId} className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex-1 truncate">
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
            <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-base text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {missingProfile.length > 0 && (
            <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700">
              <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-400 flex-shrink-0" aria-hidden="true" />
              <p className="flex-1 min-w-0 text-base text-amber-900 dark:text-amber-100">
                Your {listWords(missingProfile)} {missingProfile.length === 1 ? "isn't" : "aren't"} set, so the letter will have a blank where {missingProfile.length === 1 ? 'it goes' : 'they go'}.
              </p>
              <button type="button" onClick={openProfileSettings}
                className="text-base font-medium text-blue-700 dark:text-blue-300 underline min-h-[44px] focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm">
                Fill in Settings → Profile
              </button>
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
                          toast.error("We couldn't save the letter as a PDF — try again")
                        }
                      } catch (err) { rlog.error('GenerateLetterModal', 'PDF export failed', err) }
                    }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                               text-base text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700
                               focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px]"
                  >
                    <FileDown className="w-4 h-4" />
                    Save as PDF…
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
