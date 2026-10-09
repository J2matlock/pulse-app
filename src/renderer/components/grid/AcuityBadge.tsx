import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { AcuityLevel } from '../../../shared/types'
import { dropdownVariants } from '../../utils/animations'
import { useVocab } from '../../hooks/useVocab'

const BADGE_WIDTH = 36

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

  // Determine text color for contrast against background
  function contrastText(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance > 0.55 ? '#1e293b' : '#ffffff'
  }

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(v => !v)
  }

  return (
    <div className="relative flex-shrink-0 flex items-center justify-center" style={{ width: BADGE_WIDTH, height: 44 }}>
      {bulkCount && bulkCount > 1 && (
        <span className="absolute -top-2 -right-2 bg-blue-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold z-10">
          {bulkCount > 9 ? '9+' : bulkCount}
        </span>
      )}
      {currentLevel ? (
        <button
          ref={btnRef}
          onClick={handleToggle}
          className="hit-44 rounded-full px-1.5 py-0.5 text-base font-semibold leading-none cursor-pointer select-none
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                     hover:opacity-80 transition-opacity"
          style={{
            backgroundColor: currentLevel.color,
            color: contrastText(currentLevel.color),
            minWidth: 20,
            textAlign: 'center',
          }}
          title={`${currentLevel.name} (${currentLevel.points} pts) — click to change`}
        >
          {currentLevel.abbreviation}
        </button>
      ) : (
        <motion.button
          ref={btnRef}
          onClick={handleToggle}
          className="w-6 h-6 rounded-full border-2 border-dashed border-blue-400 dark:border-blue-500
                     flex items-center justify-center
                     text-blue-400 dark:text-blue-400 text-sm font-bold leading-none
                     cursor-pointer
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          animate={{ opacity: [0.5, 1, 0.5], scale: [0.92, 1.1, 0.92] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          whileHover={{ opacity: 1, scale: 1.15 }}
          title={`Assign ${t('priority')}`}
        >+</motion.button>
      )}

      {createPortal(
        <AnimatePresence>
          {open && (
            <div
              ref={dropRef}
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
                    <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                    <button
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
