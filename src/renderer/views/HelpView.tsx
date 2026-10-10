/**
 * HelpView — Help Center with searchable FAQ, category filtering,
 * "Show me" mini-tours, and "Retake Full Tour" card.
 */
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Search, ChevronDown, Eye, BookOpen, Sparkles, ShieldCheck } from 'lucide-react'
import { STEPS } from '../components/shared/TourOverlay'
import { featureNow } from '../hooks/useFeature'
import type { TourStep } from '../components/shared/TourOverlay'
import { DEBOUNCE_SEARCH } from '../../shared/constants'
import type { FAQCategory } from './help/types'
import { CATEGORY_LABELS, ALL_CATEGORIES } from './help/types'
import { FAQ_ITEMS } from './help/faqData'
import { SecuritySummaryDialog } from '../components/shared/SecuritySummaryDialog'
import { highlightText } from './help/highlightText'
import { useVocab } from '../hooks/useVocab'
import toast from 'react-hot-toast'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { FEATURES, isOn, type FeatureKey } from '../../shared/features'

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onStartTour: () => void
  onStartMiniTour: (steps: TourStep[]) => void
}

/** A "Show me" tour's steps, leaving out switched-off features (no walk to a hidden page) */
export function showMeSteps(ids: string[]): TourStep[] {
  return ids
    .map(id => STEPS.find(s => s.id === id))
    .filter((s): s is TourStep => s != null && (!s.feature || featureNow(s.feature)))
}

// SessionStorage key for persisting state across mini-tour navigation
const HELP_STATE_KEY = 'pulse-help-view-state'

function loadPersistedState(): { search: string; category: FAQCategory | 'all'; openIds: string[]; scrollTop: number } | null {
  try {
    const raw = sessionStorage.getItem(HELP_STATE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return null
}

export default function HelpView({ onStartTour, onStartMiniTour }: Props): React.ReactElement {
  const { t, f } = useVocab(null)
  // Help text carries {word} tokens; fill them before searching so search matches what's shown
  const faqItems = useMemo(() => FAQ_ITEMS.map(it => ({ ...it, question: f(it.question), answer: f(it.answer) })), [f])
  const persisted = useRef(loadPersistedState())
  const [search, setSearch] = useState(persisted.current?.search ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(persisted.current?.search ?? '')
  const [activeCategory, setActiveCategory] = useState<FAQCategory | 'all'>(persisted.current?.category ?? 'all')
  const [showSecuritySummary, setShowSecuritySummary] = useState(false)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(persisted.current?.openIds ?? []))
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Restore scroll position after mount
  useEffect(() => {
    if (persisted.current?.scrollTop && scrollRef.current) {
      scrollRef.current.scrollTop = persisted.current.scrollTop
    }
    // Clear persisted state after restoring so a normal navigation starts fresh
    sessionStorage.removeItem(HELP_STATE_KEY)
  }, [])

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), DEBOUNCE_SEARCH)
    return () => clearTimeout(id)
  }, [search])

  // Filter items
  const filteredItems = useMemo(() => {
    let items = faqItems
    if (activeCategory !== 'all') {
      items = items.filter(it => it.category === activeCategory)
    }
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      items = items.filter(it =>
        it.question.toLowerCase().includes(q) || it.answer.toLowerCase().includes(q)
      )
    }
    return items
  }, [activeCategory, debouncedSearch, faqItems])

  // Topics for switched-off features go in their own section, with a way to turn them on
  const features = useWorkspaceStore(s => s.features)
  const updateWorkspace = useWorkspaceStore(s => s.update)
  const offItems = useMemo(() => filteredItems.filter(it => it.feature && !isOn(features, it.feature)), [filteredItems, features])

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<FAQCategory, typeof FAQ_ITEMS>()
    for (const item of filteredItems) {
      if (item.feature && !isOn(features, item.feature)) continue
      const list = map.get(item.category) || []
      list.push(item)
      map.set(item.category, list)
    }
    return map
  }, [filteredItems, features])

  async function turnOn(key: FeatureKey) {
    const label = FEATURES.find(x => x.key === key)?.label ?? 'That feature'
    try {
      await updateWorkspace({ features: { [key]: true } })
      toast.success(`${f(label)} is on. You can turn it off in Settings → Workspace.`)
    } catch {
      toast.error("We couldn't turn that on. Try Settings → Workspace.")
    }
  }

  function renderItem(item: (typeof FAQ_ITEMS)[number]): React.ReactElement {
    const isOpen = openIds.has(item.id)
    const off = item.feature && !isOn(features, item.feature) ? item.feature : null
    return (
      <div key={item.id}>
        <button
          onClick={() => toggleItem(item.id)}
          className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
          style={{ minHeight: 44 }}
          aria-expanded={isOpen}
        >
          <ChevronDown className={`w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          <span className="text-[15px] font-medium text-slate-800 dark:text-slate-200 flex-1">
            {highlightText(item.question, debouncedSearch)}
          </span>
        </button>
        {isOpen && (
          <div className="px-4 pb-4 pt-0 pl-11">
            <p className="text-[15px] leading-relaxed text-slate-600 dark:text-slate-400 mb-2">
              {highlightText(item.answer, debouncedSearch)}
            </p>
            {item.demo && item.demo}
            {off && (
              <button type="button" className="btn-compact-primary" onClick={() => void turnOn(off)}>
                Turn on {f(FEATURES.find(x => x.key === off)?.label ?? '')}
              </button>
            )}
            {item.tourStepIds && showMeSteps(item.tourStepIds).length > 0 && (
              <button
                onClick={() => handleShowMe(item.tourStepIds!)}
                className="hit-44 inline-flex items-center gap-1.5 px-3 py-1.5 text-base font-medium
                           text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30
                           rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                Show me
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  function toggleItem(id: string) {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleShowMe(tourStepIds: string[]) {
    const steps = showMeSteps(tourStepIds)
    if (steps.length > 0) {
      // Persist current state so it restores when we return from the tour
      try {
        sessionStorage.setItem(HELP_STATE_KEY, JSON.stringify({
          search,
          category: activeCategory,
          openIds: Array.from(openIds),
          scrollTop: scrollRef.current?.scrollTop ?? 0,
        }))
      } catch { /* ignore */ }
      onStartMiniTour(steps)
    }
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-slate-50 dark:bg-slate-900">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Help Center</h1>
          </div>
          {/* Search */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400 pointer-events-none" />
            <input
              ref={searchRef}
              type="search"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600
                         bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100
                         text-[15px] placeholder-slate-500
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Search help..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ minHeight: 44 }}
            />
          </div>
        </div>

        {/* Security summary for supervisors / IT */}
        <div className="flex items-center gap-4 rounded-xl border-2 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
          <ShieldCheck className="w-8 h-8 text-green-700 dark:text-green-300 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-slate-800 dark:text-slate-100">Need your supervisor's or IT's OK?</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">A one-page, plain-English summary of how Pulse protects {t('record')} information, ready to copy into an email.</p>
          </div>
          <button type="button" className="btn-secondary flex-shrink-0" onClick={() => setShowSecuritySummary(true)}>
            Security &amp; privacy
          </button>
        </div>
        <SecuritySummaryDialog open={showSecuritySummary} onClose={() => setShowSecuritySummary(false)} />

        {/* Retake Full Tour card */}
        <button
          onClick={onStartTour}
          className="w-full text-left bg-linear-to-r from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/20
                     border border-blue-200 dark:border-blue-700 rounded-xl p-4 flex items-center gap-4
                     hover:from-blue-100 hover:to-blue-150 dark:hover:from-blue-900/40 dark:hover:to-blue-800/30
                     transition-colors group"
          style={{ minHeight: 44 }}
        >
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold text-blue-800 dark:text-blue-200">
              Retake the full tour
            </div>
            <div className="text-sm text-blue-600 dark:text-blue-400">
              Want a refresher? Walk through every part of Pulse you have switched on, step by step.
            </div>
          </div>
        </button>

        {/* Category chips */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveCategory('all')}
            className={`hit-44 px-3 py-1.5 rounded-full text-base font-medium whitespace-nowrap transition-colors ${
              activeCategory === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
            style={{ minHeight: 36 }}
          >
            All
          </button>
          {ALL_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`hit-44 px-3 py-1.5 rounded-full text-base font-medium whitespace-nowrap transition-colors ${
                activeCategory === cat
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              style={{ minHeight: 36 }}
            >
              {f(CATEGORY_LABELS[cat])}
            </button>
          ))}
        </div>

        {/* FAQ Accordion — grouped by category */}
        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <Search className="w-10 h-10 text-slate-300 dark:text-slate-500 mx-auto mb-3" />
            <p className="text-base text-slate-500 dark:text-slate-400">
              No questions match your search. Try different keywords, or browse the categories above.
            </p>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category} className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide px-1 pt-2">
                {f(CATEGORY_LABELS[category])}
              </h2>
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700">
                {items.map(item => renderItem(item))}
              </div>
            </div>
          ))
        )}

        {offItems.length > 0 && (
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide px-1 pt-2">More features you can turn on</h2>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700">
              {offItems.map(item => renderItem(item))}
            </div>
          </div>
        )}

        {/* Bottom spacer */}
        <div className="h-8" />
      </div>
    </div>
  )
}
