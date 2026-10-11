/**
 * VariableInsertMenu — Grouped dropdown for inserting template placeholders.
 * Used in the letter template editor to let users pick variables without
 * memorizing the placeholder syntax.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useVocab } from '../../hooks/useVocab'

export interface VariableItem {
  key: string
  desc: string
}

export interface VariableGroup {
  label: string
  items: VariableItem[]
}

/** Always available; the list's own columns, deadlines and links come from main (PLACEHOLDER_FIELDS) */
export const VARIABLE_GROUPS: VariableGroup[] = [
  {
    label: '{Record}',
    items: [
      { key: '{{name}}', desc: 'Name of the {record}' },
    ],
  },
  {
    label: 'Your Profile',
    items: [
      { key: '{{my_name}}', desc: 'Your name' },
      { key: '{{my_title}}', desc: 'Your title' },
      { key: '{{my_org}}', desc: 'Your organization' },
      { key: '{{my_phone}}', desc: 'Your phone' },
      { key: '{{my_email}}', desc: 'Your email' },
    ],
  },
  {
    label: 'Dates',
    items: [
      { key: '{{today}}', desc: "Today's date, like Oct 2, 2026" },
      { key: '{{today:long}}', desc: "Today's date, like October 2, 2026" },
    ],
  },
]

interface VariableInsertMenuProps {
  open: boolean
  onClose: () => void
  onInsert: (variable: string) => void
  /** Anchor element to position relative to. Falls back to fixed center if not provided. */
  anchorRef?: React.RefObject<HTMLElement | null>
  /** Fields of the current list (columns, deadlines, links), shown after the fixed groups */
  extraGroups?: VariableGroup[]
}

export function VariableInsertMenu({ open, onClose, onInsert, anchorRef, extraGroups = [] }: VariableInsertMenuProps): React.ReactElement | null {
  const { f } = useVocab()
  const menuRef = useRef<HTMLDivElement>(null)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  // Build flat list for keyboard navigation
  const groups = [...VARIABLE_GROUPS, ...extraGroups]
  const allItems = groups.flatMap(g => g.items)

  // Position the menu below the anchor
  useEffect(() => {
    if (!open) return
    setFocusIndex(-1)
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      setPosition({
        top: rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - 280),
      })
    } else {
      setPosition(null)
    }
  }, [open, anchorRef])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIndex(prev => (prev + 1) % allItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIndex(prev => (prev <= 0 ? allItems.length - 1 : prev - 1))
    } else if (e.key === 'Enter') {
      const item = allItems[focusIndex]
      if (!item) return
      e.preventDefault()
      onInsert(item.key)
      onClose()
    }
  }, [allItems, focusIndex, onInsert, onClose])

  // Focus the menu when it opens
  useEffect(() => {
    if (open && menuRef.current) {
      menuRef.current.focus()
    }
  }, [open])

  if (!open) return null

  let flatIndex = 0

  return (
    <div
      ref={menuRef}
      role="listbox"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="fixed z-[60] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
                 rounded-lg shadow-lg p-2 w-72 max-h-72 overflow-y-auto
                 focus:outline-hidden"
      style={position ? { top: position.top, left: position.left } : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
    >
      {groups.map(group => {
        const groupItems = group.items.map(item => {
          const idx = flatIndex++
          const isFocused = idx === focusIndex
          return (
            <button
              key={item.key}
              role="option"
              aria-selected={isFocused}
              onClick={() => { onInsert(item.key); onClose() }}
              className={`w-full text-left px-3 py-2 rounded cursor-pointer flex flex-col gap-0.5
                          focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-blue-500 min-h-[44px] justify-center
                          ${isFocused
                            ? 'bg-blue-50 dark:bg-blue-900/30'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
            >
              <span className="font-mono text-sm text-blue-600 dark:text-blue-400">
                {item.key}
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {f(item.desc)}
              </span>
            </button>
          )
        })

        return (
          <div key={group.label} className="mb-1">
            <div className="px-3 py-1 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {f(group.label)}
            </div>
            {groupItems}
          </div>
        )
      })}

      <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 mt-1">
        <span className="text-sm text-slate-500 dark:text-slate-400 italic">
          Tip: Any column name works too, e.g. {'{{'}column_name{'}}'}
        </span>
      </div>
    </div>
  )
}
