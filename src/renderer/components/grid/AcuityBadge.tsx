import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { AcuityLevel } from '../../../shared/types'
import { dropdownVariants } from '../../utils/animations'
import { useVocab } from '../../hooks/useVocab'
import { useMenuKeys } from '../../hooks/useMenuKeys'

// Wide enough for "Set…" in a record with no level yet (UX-B-21)
const BADGE_WIDTH = 52

function luminance(hex: string): number {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5)
}

/** Dark or white text, whichever reads better on this color by the WCAG contrast ratio (AUDIT-045) */
export function badgeTextColor(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#1e293b'
  const bg = luminance(hex)
  const onWhite = 1.05 / (bg + 0.05)
  const onDark = (bg + 0.05) / (luminance('#1e293b') + 0.05)
  return onDark >= onWhite ? '#1e293b' : '#ffffff'
}

/** From a priority badge, the arrows move like the rest of the list (AUDIT-045) */
function handleBadgeNavKey(e: React.KeyboardEvent<HTMLButtonElement>): void {
  const row = e.currentTarget.closest('[role="row"]')
  if (!row) return
  if (e.key === 'ArrowRight') {
    const cell = row.querySelector<HTMLElement>('[role="gridcell"][data-col-id]')
    if (cell) { e.preventDefault(); cell.focus() }
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    let sib = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling
    while (sib && !sib.querySelector('[data-acuity-badge]')) {
      sib = e.key === 'ArrowDown' ? sib.nextElementSibling : sib.previousElementSibling
    }
    const badge = sib?.querySelector<HTMLElement>('[data-acuity-badge]')
    if (badge) { e.preventDefault(); badge.focus(); badge.scrollIntoView({ block: 'nearest' }) }
  }
}

interface AcuityBadgeProps {
  levels: AcuityLevel[]
  currentLevelId: number | null
  onSetLevel: (levelId: number | null) => void
  bulkCount?: number
}

export { BADGE_WIDTH }

export function AcuityBadge({ levels, currentLevelId, onSetLevel, bulkCount }: AcuityBadgeProps): React.ReactElement {
  const { t } = useVocab()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  // The pick list takes focus, moves with the arrows, closes on Escape and gives focus back
  const onMenuKeyDown = useMenuKeys(dropRef, open, useCallback(() => setOpen(false), []))
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const updatePos = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePos()
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open, updatePos])

  const currentLevel = levels.find(l => l.id === currentLevelId)

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(v => !v)
  }

  return (
    <div className="relative flex-shrink-0 flex items-center justify-center" style={{ width: BADGE_WIDTH, height: 44 }}>
      {bulkCount && bulkCount > 1 && (
        <span className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs rounded-full min-w-5 h-5 px-1 flex items-center justify-center font-bold z-10">
          {bulkCount > 9 ? '9+' : bulkCount}
        </span>
      )}
      {/* One button either way, so focus can come back to it after a pick. It isn't its own
          Tab stop: Left arrow from the first cell reaches it, and Enter or Space opens it */}
      <button
        ref={btnRef}
        type="button"
        tabIndex={-1}
        data-acuity-badge
        onClick={handleToggle}
        onKeyDown={handleBadgeNavKey}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={currentLevel ? `${t('priority', { cap: true })}: ${currentLevel.name}` : `Set ${t('priority')}`}
        className={currentLevel
          ? `hit-44 rounded-full px-1.5 py-0.5 text-base font-semibold leading-none cursor-pointer select-none
             focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
             hover:opacity-80 transition-opacity`
          : `hit-44 rounded-sm px-1 py-0.5 text-base leading-none whitespace-nowrap
             text-blue-700 dark:text-blue-300 hover:underline cursor-pointer
             focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500`}
        style={currentLevel ? {
          backgroundColor: currentLevel.color,
          color: badgeTextColor(currentLevel.color),
          minWidth: 20,
          textAlign: 'center',
        } : undefined}
        title={currentLevel ? `${currentLevel.name} (${currentLevel.points} pts) — click to change` : `Set ${t('priority')}`}
      >
        {currentLevel ? currentLevel.abbreviation : 'Set…'}
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <div
              ref={dropRef}
              role="menu"
              aria-label={t('priority', { cap: true })}
              onKeyDown={onMenuKeyDown}
              style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
            >
              <motion.div
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 w-44"
                variants={dropdownVariants}
                initial="hidden" animate="visible" exit="exit"
              >
                {levels.map(level => (
                  <button
                    key={level.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={level.id === currentLevelId}
                    onClick={e => { e.stopPropagation(); onSetLevel(level.id); setOpen(false) }}
                    className={`flex items-center gap-2.5 w-full px-3 text-left text-base hover:bg-slate-50 dark:hover:bg-slate-700
                      ${level.id === currentLevelId ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                    style={{ minHeight: 44 }}
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: level.color }}
                    />
                    <span className="flex-1 text-slate-700 dark:text-slate-200">{level.name}</span>
                    <span className="text-sm text-slate-500 dark:text-slate-400">{level.points} pts</span>
                  </button>
                ))}
                {currentLevelId != null && (
                  <>
                    <div role="separator" className="my-1 border-t border-slate-100 dark:border-slate-700" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={e => { e.stopPropagation(); onSetLevel(null); setOpen(false) }}
                      className="flex items-center gap-2.5 w-full px-3 text-left text-base text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                      style={{ minHeight: 44 }}
                    >
                      None
                    </button>
                  </>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
