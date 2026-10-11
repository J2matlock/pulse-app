import React, { useState, useRef, useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Trash2, ChevronUp, ChevronDown, Plus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { dropdownVariants } from '../../utils/animations'
import type { AcuityLevel } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'

const DEFAULT_LEVELS: Array<{ name: string; abbreviation: string; points: number; color: string }> = [
  { name: 'Low', abbreviation: 'L', points: 1, color: '#22c55e' },
  { name: 'Medium', abbreviation: 'M', points: 3, color: '#eab308' },
  { name: 'High', abbreviation: 'H', points: 5, color: '#ef4444' },
]

const SWATCH_COLORS = [
  '#22c55e', '#eab308', '#f97316', '#ef4444',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
]

interface AcuityConfigPanelProps {
  onClose: () => void
}

export function AcuityConfigPanel({ onClose }: AcuityConfigPanelProps): React.ReactElement {
  const { t } = useVocab()
  const {
    acuityEnabled, acuityLevels, toggleAcuity,
    createAcuityLevel, updateAcuityLevel, deleteAcuityLevel, reorderAcuityLevels,
  } = useGridStore(useShallow(s => ({
    acuityEnabled: s.acuityEnabled, acuityLevels: s.acuityLevels, toggleAcuity: s.toggleAcuity,
    createAcuityLevel: s.createAcuityLevel, updateAcuityLevel: s.updateAcuityLevel,
    deleteAcuityLevel: s.deleteAcuityLevel, reorderAcuityLevels: s.reorderAcuityLevels,
  })))
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  async function handleToggle() {
    const newEnabled = !acuityEnabled
    await toggleAcuity(newEnabled)
    // Auto-create default levels on first enable when none exist
    // Read fresh from store (toggleAcuity reloads from DB when enabling)
    if (newEnabled && useGridStore.getState().acuityLevels.length === 0) {
      for (const def of DEFAULT_LEVELS) {
        await createAcuityLevel(def)
      }
    }
  }

  function handleMoveUp(index: number) {
    if (index === 0) return
    const ids = acuityLevels.map(l => l.id)
    const temp = ids[index]!
    ids[index] = ids[index - 1]!
    ids[index - 1] = temp
    reorderAcuityLevels(ids)
  }

  function handleMoveDown(index: number) {
    if (index >= acuityLevels.length - 1) return
    const ids = acuityLevels.map(l => l.id)
    const temp = ids[index]!
    ids[index] = ids[index + 1]!
    ids[index + 1] = temp
    reorderAcuityLevels(ids)
  }

  async function handleAddLevel() {
    await createAcuityLevel({
      name: 'New Level',
      abbreviation: 'N',
      points: 1,
      color: '#6b7280',
    })
  }

  return (
    <div ref={panelRef} className="absolute right-0 top-full mt-1 w-80 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('priority', { many: true, cap: true })}</span>
        <button
          onClick={handleToggle}
          className={`hit-44 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
            ${acuityEnabled ? 'bg-blue-500' : 'bg-slate-500 dark:bg-slate-500'}`}
          role="switch"
          aria-checked={acuityEnabled}
          aria-label={t('priority', { many: true, cap: true })}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform
              ${acuityEnabled ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
      </div>

      {acuityEnabled && (
        <>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            Give each {t('record')} {t('priority', { article: true })}. Points are totaled in the status bar.
          </p>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {acuityLevels.map((level, i) => (
              <LevelRow
                key={level.id}
                level={level}
                index={i}
                total={acuityLevels.length}
                onUpdate={updateAcuityLevel}
                onDelete={deleteAcuityLevel}
                onMoveUp={() => handleMoveUp(i)}
                onMoveDown={() => handleMoveDown(i)}
              />
            ))}
          </div>

          <button
            onClick={handleAddLevel}
            className="hit-44 flex items-center gap-1.5 mt-3 text-base text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Level
          </button>
        </>
      )}
    </div>
  )
}

interface LevelRowProps {
  level: AcuityLevel
  index: number
  total: number
  onUpdate: (id: number, updates: Partial<{ name: string; abbreviation: string; points: number; color: string }>) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onMoveUp: () => void
  onMoveDown: () => void
}

function LevelRow({ level, index, total, onUpdate, onDelete, onMoveUp, onMoveDown }: LevelRowProps): React.ReactElement {
  const [showColorPicker, setShowColorPicker] = useState(false)
  const swatchRef = useRef<HTMLButtonElement>(null)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [localName, setLocalName] = useState(level.name)
  const [localAbbr, setLocalAbbr] = useState(level.abbreviation)
  const [localPoints, setLocalPoints] = useState(String(level.points))

  // Sync from store when level changes externally
  useEffect(() => { setLocalName(level.name) }, [level.name])
  useEffect(() => { setLocalAbbr(level.abbreviation) }, [level.abbreviation])
  useEffect(() => { setLocalPoints(String(level.points)) }, [level.points])

  function commitName() {
    const trimmed = localName.trim()
    if (trimmed && trimmed !== level.name) {
      // Auto-update abbreviation to first char of new name if abbreviation still matches old name's first char
      const updates: Partial<{ name: string; abbreviation: string }> = { name: trimmed }
      if (level.abbreviation === level.name.charAt(0).toUpperCase()) {
        const newAbbr = trimmed.charAt(0).toUpperCase()
        updates.abbreviation = newAbbr
        setLocalAbbr(newAbbr)
      }
      onUpdate(level.id, updates)
    }
  }

  function commitAbbr() {
    const trimmed = localAbbr.trim().slice(0, 4)
    if (trimmed && trimmed !== level.abbreviation) onUpdate(level.id, { abbreviation: trimmed })
  }

  function commitPoints() {
    const n = parseInt(localPoints, 10)
    if (!isNaN(n) && n !== level.points) onUpdate(level.id, { points: n })
  }

  return (
    <div className="flex items-center gap-1.5 p-1.5 rounded-sm bg-slate-50 dark:bg-slate-700/50">
      {/* Color swatch */}
      <div className="relative">
        <button
          ref={swatchRef}
          onClick={() => {
            if (!showColorPicker && swatchRef.current) {
              const rect = swatchRef.current.getBoundingClientRect()
              setPickerPos({ top: rect.bottom + 4, left: rect.left })
            }
            setShowColorPicker(v => !v)
          }}
          className="hit-44 w-6 h-6 rounded-sm border border-slate-300 dark:border-slate-600 flex-shrink-0 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          style={{ backgroundColor: level.color }}
          title="Change color"
        />
        <AnimatePresence>
          {showColorPicker && (
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setShowColorPicker(false)} />
              <motion.div
                className="fixed bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-2 z-[60] grid grid-cols-4 gap-1.5"
                style={{ top: pickerPos.top, left: pickerPos.left }}
                variants={dropdownVariants}
                initial="hidden" animate="visible" exit="exit"
              >
                {SWATCH_COLORS.map(c => (
                  <button
                    key={c}
                    className={`hit-44 w-6 h-6 rounded-sm border-2 ${c === level.color ? 'border-blue-500' : 'border-transparent'} focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500`}
                    style={{ backgroundColor: c }}
                    onClick={() => { onUpdate(level.id, { color: c }); setShowColorPicker(false) }}
                  />
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Name */}
      <input
        type="text"
        value={localName}
        onChange={e => setLocalName(e.target.value)}
        onBlur={commitName}
        onKeyDown={e => { if (e.key === 'Enter') commitName() }}
        className="flex-1 min-w-0 text-base bg-transparent border-b border-transparent hover:border-slate-300 dark:hover:border-slate-500 focus:border-blue-500 px-1 py-0.5 text-slate-700 dark:text-slate-200"
        style={{ maxWidth: 80 }}
        title="Level name"
      />

      {/* Abbreviation */}
      <input
        type="text"
        value={localAbbr}
        onChange={e => setLocalAbbr(e.target.value.slice(0, 4))}
        onBlur={commitAbbr}
        onKeyDown={e => { if (e.key === 'Enter') commitAbbr() }}
        className="w-10 text-base text-center bg-transparent border-b border-transparent hover:border-slate-300 dark:hover:border-slate-500 focus:border-blue-500 px-0.5 py-0.5 text-slate-700 dark:text-slate-200"
        title="Abbreviation (1-4 chars)"
        maxLength={4}
      />

      {/* Points */}
      <input
        type="number"
        value={localPoints}
        onChange={e => setLocalPoints(e.target.value)}
        onBlur={commitPoints}
        onKeyDown={e => { if (e.key === 'Enter') commitPoints() }}
        className="w-12 text-base text-center bg-transparent border-b border-transparent hover:border-slate-300 dark:hover:border-slate-500 focus:border-blue-500 px-0.5 py-0.5 text-slate-700 dark:text-slate-200"
        title="Points"
        min={0}
      />
      <span className="text-sm text-slate-500 dark:text-slate-400">pts</span>

      {/* Reorder arrows */}
      <div className="flex flex-col">
        <button
          onClick={onMoveUp}
          disabled={index === 0}
          className="hit-44 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 disabled:cursor-default"
          title="Move up"
        >
          <ChevronUp className="w-3 h-3" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={index >= total - 1}
          className="hit-44 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 disabled:cursor-default"
          title="Move down"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Delete */}
      <button
        onClick={() => onDelete(level.id)}
        className="hit-44 text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 flex-shrink-0"
        title="Delete level"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
