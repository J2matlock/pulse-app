import { useState, useEffect, useRef } from 'react'
import { Search, Star, LayoutGrid, List, X as XIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useContactsStore } from '../../stores/contactsStore'
import type { AvailabilityStatus, ContactFilterParams } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'

type ViewMode = 'cards' | 'list'
type SortBy = ContactFilterParams['sortBy']

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'name', label: 'Name A\u2013Z' },
  { value: 'category', label: 'Category' },
  { value: 'availability', label: 'Availability' },
  { value: 'created_at', label: 'Recently added' },
  { value: 'updated_at', label: 'Recently updated' },
  { value: 'last_contacted', label: 'Recently contacted' },
]

const AVAILABILITY_FILTER_OPTIONS: { value: AvailabilityStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'accepting', label: 'Accepting' },
  { value: 'waitlist', label: 'Waitlist' },
  { value: 'full', label: 'Not accepting' },
  { value: 'unknown', label: 'Unknown' },
]

interface Props {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  searchInputRef?: React.RefObject<HTMLInputElement | null>
}

export function ContactFilterBar({ viewMode, onViewModeChange, searchInputRef }: Props) {
  const { t } = useVocab(null)
  const { categories, filterParams, setFilterParams } = useContactsStore(useShallow(s => ({
    categories: s.categories,
    filterParams: s.filterParams,
    setFilterParams: s.setFilterParams,
  })))

  const [search, setSearch] = useState(filterParams.search || '')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Debounced search — only update filter params if the search value actually changed
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const current = filterParams.search || ''
      if (search !== current) {
        setFilterParams({ ...filterParams, search: search || undefined })
      }
    }, 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps -- debounce pattern: filterParams/setFilterParams are stable store refs, only re-run on search input change

  const selectedCategoryIds = filterParams.categoryId != null ? [filterParams.categoryId] : []

  function toggleCategory(id: number) {
    if (selectedCategoryIds.includes(id)) {
      setFilterParams({ ...filterParams, categoryId: undefined })
    } else {
      setFilterParams({ ...filterParams, categoryId: id })
    }
  }

  return (
    <div className="space-y-2">
      {/* Search + view toggle + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            // The "/" shortcut is in the tooltip; in the placeholder it got cut off mid-word
            placeholder={`Search ${t('contact', { many: true })}…`}
            title={`Search ${t('contact', { many: true })} (/)`}
            aria-label={`Search ${t('contact', { many: true })}`}
            className="w-full pl-9 pr-8 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            style={{ fontSize: 15, minHeight: 44 }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="hit-44 absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700" title="Clear search" aria-label="Clear search">
              <XIcon size={14} className="text-slate-500 dark:text-slate-400" />
            </button>
          )}
        </div>

        {/* Availability filter */}
        <select
          value={filterParams.availabilityStatus || ''}
          onChange={e => setFilterParams({
            ...filterParams,
            availabilityStatus: (e.target.value || undefined) as AvailabilityStatus | undefined
          })}
          className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
          style={{ fontSize: 15, minHeight: 44 }}
          aria-label="Filter by availability"
          title="Filter by availability"
        >
          {AVAILABILITY_FILTER_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Starred toggle */}
        <button
          onClick={() => setFilterParams({ ...filterParams, starred: filterParams.starred ? undefined : true })}
          className={`p-2 rounded-md border transition-colors focus:outline-hidden focus:ring-3 focus:ring-blue-500 ${
            filterParams.starred
              ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20'
              : 'border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          style={{ minHeight: 44, minWidth: 44 }}
          title="Show starred only"
          aria-label="Show starred only"
          aria-pressed={!!filterParams.starred}
        >
          <Star size={16} className={filterParams.starred ? 'fill-amber-400 text-amber-400' : 'text-slate-500 dark:text-slate-400'} />
        </button>

        {/* Sort */}
        <select
          value={filterParams.sortBy || 'name'}
          onChange={e => setFilterParams({ ...filterParams, sortBy: e.target.value as SortBy })}
          className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
          style={{ fontSize: 15, minHeight: 44 }}
          aria-label={`Sort ${t('contact', { many: true })} by`}
          title={`Sort ${t('contact', { many: true })}`}
        >
          {SORT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* View toggle */}
        <div className="flex border border-slate-300 dark:border-slate-600 rounded-md overflow-hidden">
          <button
            onClick={() => onViewModeChange('cards')}
            className={`p-2 ${viewMode === 'cards' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            style={{ minHeight: 44, minWidth: 44 }}
            title="Show as cards"
            aria-label="Show as cards"
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            className={`p-2 ${viewMode === 'list' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            style={{ minHeight: 44, minWidth: 44 }}
            title="Show as a list"
            aria-label="Show as a list"
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Category chips: they wrap to a second line instead of a scrollbar under them */}
      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 py-1">
          <button
            onClick={() => setFilterParams({ ...filterParams, categoryId: undefined })}
            className={`hit-44 px-3 py-1 rounded-full text-base font-medium flex-shrink-0 transition-colors ${
              selectedCategoryIds.length === 0
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}
            style={{ minHeight: 32 }}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => toggleCategory(cat.id)}
              className={`hit-44 px-3 py-1 rounded-full text-base font-medium flex-shrink-0 transition-colors ${
                selectedCategoryIds.includes(cat.id)
                  ? 'ring-3 ring-offset-1'
                  : 'hover:opacity-80'
              }`}
              style={{
                minHeight: 32,
                backgroundColor: cat.color + '20',
                color: cat.color,
                ...(selectedCategoryIds.includes(cat.id) ? { ringColor: cat.color } : {}),
              }}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Active filter chips (non-category filters) */}
      {(filterParams.availabilityStatus || filterParams.starred || filterParams.search) && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">Active filters:</span>
          {filterParams.availabilityStatus && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300">
              Availability: {filterParams.availabilityStatus === 'full' ? 'Not accepting' : filterParams.availabilityStatus.charAt(0).toUpperCase() + filterParams.availabilityStatus.slice(1)}
              <button
                onClick={() => setFilterParams({ ...filterParams, availabilityStatus: undefined })}
                className="hit-44 ml-0.5 hover:text-teal-900 dark:hover:text-teal-100"
                aria-label="Clear availability filter"
              >
                <XIcon size={12} />
              </button>
            </span>
          )}
          {filterParams.starred && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
              Starred only
              <button
                onClick={() => setFilterParams({ ...filterParams, starred: undefined })}
                className="hit-44 ml-0.5 hover:text-amber-900 dark:hover:text-amber-100"
                aria-label="Clear starred filter"
              >
                <XIcon size={12} />
              </button>
            </span>
          )}
          {filterParams.search && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
              Search: {filterParams.search.length > 20 ? filterParams.search.slice(0, 20) + '…' : filterParams.search}
              <button
                onClick={() => { setSearch(''); setFilterParams({ ...filterParams, search: undefined }) }}
                className="hit-44 ml-0.5 hover:text-blue-900 dark:hover:text-blue-100"
                aria-label="Clear search filter"
              >
                <XIcon size={12} />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
