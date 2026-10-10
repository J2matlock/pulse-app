import React, { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronUp, ChevronDown, ChevronsUpDown, MoreHorizontal, Trash2, Edit2, EyeOff, GripVertical, Bell, BellOff, Plus, Pencil, Activity, List, Palette, ArrowUp, ArrowDown, Pin, PinOff, Asterisk, Link2, Columns3 } from 'lucide-react'
import { canBeRequired } from '../../../shared/requiredFields'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useAlertStore } from '../../stores/alertStore'
import type { Column, ParsedAlertRule } from '../../../shared/types'
import { takesDeadlineRule } from '../../../shared/types'
import { AlertRuleEditor } from '../alerts/AlertRuleEditor'
import { DeleteRuleConfirm } from '../alerts/DeleteRuleConfirm'
import { DoneChecklistPicker } from './DoneChecklistPicker'
import { NoteUpdatePicker } from './NoteUpdatePicker'
import { CellConditionalFormatPanel } from './CellConditionalFormatPanel'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Tooltip } from '../shared/Tooltip'
import { dropdownVariants } from '../../utils/animations'
import { useFeature } from '../../hooks/useFeature'
import { useVocab } from '../../hooks/useVocab'
import { useLinkStore } from '../../stores/linkStore'
import { LinkSetupDialog } from '../links/LinkSetupDialog'
import { StageSettingsDialog } from '../stages/StageSettingsDialog'
import { canBeStage, stageConfigOf } from '../../../shared/stages'

interface Props {
  column: Column
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>
}

export function ColumnHeader({ column, dragHandleProps }: Props): React.ReactElement {
  const checklistsOn = useFeature('checklists')
  const { sortConfig, columns: allColumns, frozenColumnCount } = useGridStore(useShallow(s => ({
    sortConfig: s.sortConfig,
    columns: s.columns,
    frozenColumnCount: s.frozenColumnCount,
  })))
  const { setSortConfig, updateColumn, deleteColumn, toggleColumnVisibility, setFrozenColumnCount } = useGridStore(useShallow(s => ({
    setSortConfig: s.setSortConfig,
    updateColumn: s.updateColumn,
    deleteColumn: s.deleteColumn,
    toggleColumnVisibility: s.toggleColumnVisibility,
    setFrozenColumnCount: s.setFrozenColumnCount,
  })))
  const alertRules = useAlertStore(s => s.rules)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameName, setRenameName] = useState(column.name)
  const [showMenu, setShowMenu] = useState(false)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [showAlertPicker, setShowAlertPicker] = useState(false)
  const [showAlertEditor, setShowAlertEditor] = useState(false)
  const [showLinkSettings, setShowLinkSettings] = useState(false)
  const [showStageSettings, setShowStageSettings] = useState(false)
  const stagesOn = useFeature('stages')
  const { t } = useVocab()
  const [editingRule, setEditingRule] = useState<ParsedAlertRule | undefined>(undefined)
  const [showDeleteColConfirm, setShowDeleteColConfirm] = useState(false)
  const [deleteAlertRuleTarget, setDeleteAlertRuleTarget] = useState<ParsedAlertRule | null>(null)
  const [showEditOptions, setShowEditOptions] = useState(false)
  const [editOptionsText, setEditOptionsText] = useState('')
  const [showColFormat, setShowColFormat] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)

  // Current alert rule for this column (date columns only)
  const colConfig = (() => { try { return JSON.parse(column.config || '{}') } catch { return {} } })()
  const linkType = useLinkStore(s => column.column_type === 'link' ? s.types.find(lt => lt.id === (colConfig as { link_type_id?: number }).link_type_id) : undefined)
  const currentAlertRuleId: number | null = colConfig.alert_rule_id ?? null
  const currentAlertRule = alertRules.find(r => r.id === currentAlertRuleId)

  // Freeze/pin column state
  const colIndex = allColumns.findIndex(c => c.id === column.id)
  const isColumnFrozen = colIndex >= 0 && colIndex < frozenColumnCount

  async function handleToggleLogChanges() {
    const newConfig = JSON.stringify({ ...colConfig, log_changes: !colConfig.log_changes })
    await updateColumn(column.id, { config: newConfig })
    setShowMenu(false)
  }

  async function handleSetAlertRule(ruleId: number | null) {
    const newConfig = JSON.stringify({ ...colConfig, alert_rule_id: ruleId ?? undefined })
    await updateColumn(column.id, { config: newConfig })
    setShowAlertPicker(false)
    setShowMenu(false)
  }

  async function handleSetDoneChecklist(templateId: number | null) {
    await updateColumn(column.id, { config: JSON.stringify({ ...colConfig, done_checklist_id: templateId ?? undefined }) })
  }

  const currentSort = sortConfig.find(s => s.columnId === column.id)
  const sortPriority = sortConfig.length > 1 ? sortConfig.findIndex(s => s.columnId === column.id) + 1 : null

  function handleSortClick(e: React.MouseEvent) {
    if (isRenaming) return
    const isMulti = e.shiftKey

    if (isMulti) {
      const existing = sortConfig.find(s => s.columnId === column.id)
      let newConfig = [...sortConfig]
      if (!existing) {
        newConfig.push({ columnId: column.id, direction: 'asc', priority: newConfig.length + 1 })
      } else if (existing.direction === 'asc') {
        newConfig = newConfig.map(s => s.columnId === column.id ? { ...s, direction: 'desc' } : s)
      } else {
        newConfig = newConfig.filter(s => s.columnId !== column.id)
      }
      setSortConfig(newConfig)
    } else {
      if (!currentSort) {
        setSortConfig([{ columnId: column.id, direction: 'asc', priority: 1 }])
      } else if (currentSort.direction === 'asc') {
        setSortConfig([{ columnId: column.id, direction: 'desc', priority: 1 }])
      } else {
        setSortConfig([])
      }
    }
  }

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = renameName.trim()
    if (name && name !== column.name) {
      await updateColumn(column.id, { name })
    }
    setIsRenaming(false)
  }

  function handleDelete() {
    setShowMenu(false)
    setShowDeleteColConfirm(true)
  }

  async function handleHide() {
    await toggleColumnVisibility(column.id, false)
    setShowMenu(false)
  }

  function handleOpenEditOptions() {
    // Pre-populate textarea with current options
    if (column.column_type === 'dropdown') {
      const opts: string[] = colConfig.options ?? []
      setEditOptionsText(opts.join('\n'))
    } else if (column.column_type === 'status') {
      const opts: Array<{ label: string }> = colConfig.options ?? []
      setEditOptionsText(opts.map(o => o.label).join('\n'))
    }
    setShowMenu(false)
    setShowEditOptions(true)
  }

  async function handleSaveOptions() {
    const lines = editOptionsText.split('\n').map(l => l.trim()).filter(Boolean)
    let newConfig: string
    if (column.column_type === 'status') {
      const STATUS_COLORS = ['#22c55e', '#3b82f6', '#eab308', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']
      // Preserve existing colors for options that haven't changed
      const existing: Array<{ label: string; color: string }> = colConfig.options ?? []
      const existingMap = new Map(existing.map(o => [o.label, o.color]))
      const options = lines.map((label, i) => ({
        label,
        color: existingMap.get(label) ?? STATUS_COLORS[i % STATUS_COLORS.length],
      }))
      newConfig = JSON.stringify({ ...colConfig, options })
    } else {
      newConfig = JSON.stringify({ ...colConfig, options: lines })
    }
    await updateColumn(column.id, { config: newConfig })
    setShowEditOptions(false)
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setShowMenu(true)
  }

  return (
    <div className="flex items-center h-full px-1 gap-0.5 relative group" onContextMenu={handleContextMenu}>
      {/* Drag handle — always visible at low opacity, full on hover */}
      {dragHandleProps && (
        <button
          {...dragHandleProps}
          className="hit-44 flex-shrink-0 p-0.5 rounded-sm text-slate-300 dark:text-slate-500 hover:text-slate-500 dark:hover:text-slate-400
                     opacity-40 group-hover:opacity-100 cursor-grab active:cursor-grabbing touch-none
                     focus:outline-hidden transition-opacity"
          tabIndex={-1}
          aria-label="Drag to reorder column"
          onPointerDown={e => { dragHandleProps.onPointerDown?.(e); e.stopPropagation() }}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      )}

      {isRenaming ? (
        <form onSubmit={handleRenameSubmit} className="flex-1">
          <input
            ref={renameRef}
            autoFocus
            type="text"
            className="w-full bg-transparent border-b border-blue-500 outline-hidden text-base font-semibold"
            value={renameName}
            onChange={e => setRenameName(e.target.value)}
            onBlur={e => {
              if (e.relatedTarget === null && !document.hasFocus()) return
              handleRenameSubmit(e)
            }}
            onKeyDown={e => e.key === 'Escape' && setIsRenaming(false)}
          />
        </form>
      ) : (
        <Tooltip content="Click to sort · Shift+click for multi-sort" placement="bottom" delay={600}>
          <button
            className="hit-44 flex-1 text-left text-base font-semibold text-slate-700 dark:text-slate-200 truncate focus:outline-hidden min-w-0 px-1"
            onClick={handleSortClick}
          >
            {column.name}
          </button>
        </Tooltip>
      )}

      {/* Log changes indicator */}
      {colConfig.log_changes && (
        <span title="Log changes in timeline"><Activity className="w-3 h-3 text-green-500 dark:text-green-400 flex-shrink-0 opacity-70" /></span>
      )}

      {/* Alert rule indicator for date columns */}
      {takesDeadlineRule(column.column_type) && currentAlertRule && (
        <span title={`Alert: ${currentAlertRule.name}`}><Bell className="w-3 h-3 text-blue-400 flex-shrink-0 opacity-70" /></span>
      )}

      {/* Sort indicator — always visible */}
      {currentSort ? (
        <div className="flex items-center flex-shrink-0">
          {currentSort.direction === 'asc'
            ? <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            : <ChevronDown className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
          {sortPriority && sortPriority > 0 && (
            <span className="text-sm text-blue-600 dark:text-blue-400 font-bold">{sortPriority}</span>
          )}
        </div>
      ) : (
        <ChevronsUpDown className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 flex-shrink-0 opacity-30 group-hover:opacity-100 transition-opacity" />
      )}

      {/* Column menu */}
      <div className="relative flex-shrink-0">
        <button
          className="p-0.5 rounded-sm text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          onClick={e => {
            e.stopPropagation()
            const rect = e.currentTarget.getBoundingClientRect()
            setMenuPos({ x: rect.left, y: rect.bottom })
            setShowMenu(v => !v)
          }}
          title="Column options"
          aria-label="Column options"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>

        {showMenu && createPortal(
            <>
              {/* Click-away backdrop */}
              <div className="fixed inset-0 z-[9998]" onClick={() => { setShowMenu(false); setShowAlertPicker(false) }} />
              <div
                className="fixed w-52 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-[9999] overflow-y-auto"
                style={{
                  ...((() => {
                    const rawY = menuPos?.y ?? 0
                    const rawX = menuPos?.x ?? 0
                    const menuW = 220 // w-52 ≈ 208px + border/shadow
                    const menuH = 400 // estimated max height
                    const clampedX = Math.min(rawX, window.innerWidth - menuW)
                    if (rawY + menuH > window.innerHeight - 8) {
                      // Flip upward: anchor bottom to click point
                      return { bottom: Math.max(8, window.innerHeight - rawY), left: Math.max(8, clampedX), maxHeight: rawY - 8 }
                    }
                    return { top: rawY, left: Math.max(8, clampedX), maxHeight: window.innerHeight - rawY - 8 }
                  })()),
                }}
              >
              {/* Sort ascending/descending buttons */}
              <button
                className={`hit-44 flex items-center gap-2 w-full px-3 py-2 text-base hover:bg-slate-100 dark:hover:bg-slate-700 ${
                  currentSort?.direction === 'asc' ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-slate-700 dark:text-slate-300'
                }`}
                onClick={() => { setSortConfig([{ columnId: column.id, direction: 'asc', priority: 1 }]); setShowMenu(false) }}
              >
                <ArrowUp className="w-4 h-4" />
                Sort ascending
              </button>
              <button
                className={`hit-44 flex items-center gap-2 w-full px-3 py-2 text-base hover:bg-slate-100 dark:hover:bg-slate-700 ${
                  currentSort?.direction === 'desc' ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-slate-700 dark:text-slate-300'
                }`}
                onClick={() => { setSortConfig([{ columnId: column.id, direction: 'desc', priority: 1 }]); setShowMenu(false) }}
              >
                <ArrowDown className="w-4 h-4" />
                Sort descending
              </button>
              <hr className="my-1 border-slate-200 dark:border-slate-700" />
              <button
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={() => { setIsRenaming(true); setRenameName(column.name); setShowMenu(false) }}
              >
                <Edit2 className="w-4 h-4" />
                Rename
              </button>
              <button
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={handleHide}
              >
                <EyeOff className="w-4 h-4" />
                Hide column
              </button>
              <button
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={() => {
                  if (isColumnFrozen) {
                    // Unpin: set frozen count to this column's index (exclude it)
                    setFrozenColumnCount(colIndex)
                  } else {
                    // Pin: set frozen count to include this column
                    setFrozenColumnCount(colIndex + 1)
                  }
                  setShowMenu(false)
                }}
              >
                {isColumnFrozen ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                {isColumnFrozen ? 'Unpin column' : 'Pin column'}
              </button>
              <button
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={handleToggleLogChanges}
              >
                <Activity className="w-4 h-4" />
                <span className="flex-1 text-left">Log changes in timeline</span>
                <span className={`text-sm font-medium ${colConfig.log_changes ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  {colConfig.log_changes ? 'On' : 'Off'}
                </span>
              </button>

              {canBeRequired(column.column_type) && (
                <button
                  className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => { void updateColumn(column.id, { config: JSON.stringify({ ...colConfig, required: colConfig.required ? undefined : true }) }); setShowMenu(false) }}
                  title="Empty cells show 'Missing' and appear in the Missing information list"
                >
                  <Asterisk className="w-4 h-4" />
                  <span className="flex-1 text-left">Required field</span>
                  <span className={`text-sm font-medium ${colConfig.required ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    {colConfig.required ? 'On' : 'Off'}
                  </span>
                </button>
              )}

              <button
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={() => { setShowColFormat(true); setShowMenu(false) }}
              >
                <Palette className="w-4 h-4" />
                Column format rules…
              </button>

              {/* Edit options — only for dropdown/status columns */}
              {(column.column_type === 'dropdown' || column.column_type === 'status') && (
                <button
                  className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={handleOpenEditOptions}
                >
                  <List className="w-4 h-4" />
                  Edit options…
                </button>
              )}

              {/* Stage (W06): one status or dropdown column per list drives the board */}
              {stagesOn && canBeStage(column.column_type) && (
                <button
                  className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => { setShowMenu(false); setShowStageSettings(true) }}
                >
                  <Columns3 className="w-4 h-4" />
                  {stageConfigOf(column) ? `${t('stage', { cap: true })} settings…` : `Use as the ${t('stage')}…`}
                </button>
              )}

              {/* Link columns (W04): names, how many, or remove the link */}
              {linkType && (
                <button
                  className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => { setShowMenu(false); setShowLinkSettings(true) }}
                >
                  <Link2 className="w-4 h-4" />
                  Link settings…
                </button>
              )}

              {/* Alert rule picker — only for date columns */}
              {takesDeadlineRule(column.column_type) && (
                <>
                  <hr className="my-1 border-slate-200 dark:border-slate-700" />
                  <button
                    className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                    onClick={() => setShowAlertPicker(v => !v)}
                  >
                    <Bell className="w-4 h-4 text-blue-500" />
                    <span className="flex-1 text-left">Alert Rule</span>
                    {currentAlertRule && (
                      <span className="text-sm text-blue-600 dark:text-blue-400 truncate max-w-20">{currentAlertRule.name}</span>
                    )}
                  </button>

                  {showAlertPicker && (
                    <div className="px-2 pb-2">
                      {currentAlertRule && (
                        <button
                          className="hit-44 flex items-center gap-2 w-full px-2 py-1.5 text-base text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-sm"
                          onClick={() => handleSetAlertRule(null)}
                        >
                          <BellOff className="w-3.5 h-3.5" />
                          Remove alert
                        </button>
                      )}
                      {alertRules.length === 0 && !currentAlertRule && (
                        <p className="px-2 py-1.5 text-sm text-slate-500 dark:text-slate-400">
                          No alert rules yet.
                        </p>
                      )}
                      {alertRules.map(rule => (
                        <div
                          key={rule.id}
                          className={`flex items-center gap-1 w-full rounded-sm ${
                            rule.id === currentAlertRuleId
                              ? 'bg-blue-50 dark:bg-blue-900/40'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          <button
                            className={`hit-44 flex items-center gap-2 flex-1 px-2 py-1.5 text-base text-left min-w-0 ${
                              rule.id === currentAlertRuleId
                                ? 'text-blue-700 dark:text-blue-300 font-medium'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                            onClick={() => handleSetAlertRule(rule.id)}
                          >
                            <Bell className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{rule.name}</span>
                          </button>
                          <button
                            className="hit-44 p-1 text-slate-500 dark:text-slate-400 hover:text-blue-500 rounded-sm flex-shrink-0"
                            title="Edit rule"
                            aria-label="Edit rule"
                            onClick={e => { e.stopPropagation(); setEditingRule(rule); setShowAlertEditor(true); setShowMenu(false); setShowAlertPicker(false) }}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            className="hit-44 p-1 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-sm flex-shrink-0 mr-1"
                            title="Delete rule"
                            aria-label="Delete rule"
                            onClick={e => {
                              e.stopPropagation()
                              setDeleteAlertRuleTarget(rule)
                              setShowAlertPicker(false)
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <hr className="my-1 border-slate-200 dark:border-slate-700" />
                      <button
                        className="hit-44 flex items-center gap-2 w-full px-2 py-1.5 text-base text-blue-600 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-sm"
                        onClick={() => { setEditingRule(undefined); setShowAlertEditor(true); setShowMenu(false); setShowAlertPicker(false) }}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Create alert rule…
                      </button>
                    </div>
                  )}
                  <NoteUpdatePicker
                    value={Array.isArray(colConfig.note_updates) ? colConfig.note_updates : []}
                    onChange={types => void updateColumn(column.id, { config: JSON.stringify({ ...colConfig, note_updates: types.length ? types : undefined }) })}
                  />
                  {currentAlertRule && checklistsOn && (
                    <DoneChecklistPicker value={colConfig.done_checklist_id ?? null} onChange={id => void handleSetDoneChecklist(id)} />
                  )}
                </>
              )}

              <hr className="my-1 border-slate-200 dark:border-slate-700" />
              <button
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                onClick={handleDelete}
              >
                <Trash2 className="w-4 h-4" />
                Delete column
              </button>
            </div>
          </>, document.body
        )}

        {/* Alert rule editor modal (create or edit) */}
        {showAlertEditor && (
          <AlertRuleEditor
            rule={editingRule}
            columnId={column.id}
            onClose={async (createdRuleId?: number) => {
              setShowAlertEditor(false)
              // If a new rule was created from this column, auto-apply it
              if (createdRuleId && !editingRule) {
                await handleSetAlertRule(createdRuleId)
              }
              setEditingRule(undefined)
            }}
          />
        )}

        {/* Edit options panel for dropdown/status columns */}
        <AnimatePresence>
          {showEditOptions && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowEditOptions(false)} />
              <motion.div
                className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-4 z-50"
                variants={dropdownVariants}
                initial="hidden" animate="visible" exit="exit"
              >
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                  {column.column_type === 'status' ? 'Edit statuses' : 'Edit options'}
                </p>
                <textarea
                  autoFocus
                  className="input resize-none w-full"
                  rows={5}
                  value={editOptionsText}
                  onChange={e => setEditOptionsText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setShowEditOptions(false)
                  }}
                  placeholder={column.column_type === 'status' ? 'Active\nPending\nClosed' : 'Option A\nOption B\nOption C'}
                  style={{ minHeight: 'unset', height: 'auto', padding: '8px 12px' }}
                />
                {column.column_type === 'status' && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-2">Colors are preserved for existing statuses.</p>
                )}
                <div className="flex gap-2 mt-3">
                  <button
                    className="btn-primary flex-1"
                    style={{ minHeight: 36, fontSize: 15 }}
                    onClick={() => void handleSaveOptions()}
                  >
                    Save
                  </button>
                  <button
                    className="btn-secondary flex-1"
                    style={{ minHeight: 36, fontSize: 15 }}
                    onClick={() => setShowEditOptions(false)}
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {showLinkSettings && linkType && <LinkSetupDialog mode="edit" type={linkType} onClose={() => setShowLinkSettings(false)} />}
        {showStageSettings && <StageSettingsDialog column={column} onClose={() => setShowStageSettings(false)} />}

        {/* Delete column confirmation */}
        <ConfirmDialog
          open={showDeleteColConfirm}
          variant="typed"
          requiredPhrase={column.name}
          title={`Delete column "${column.name}"?`}
          message={`This will permanently remove all data in this column. Type "${column.name}" to confirm.`}
          confirmLabel="Delete Column"
          onConfirm={async () => {
            setShowDeleteColConfirm(false)
            await deleteColumn(column.id)
          }}
          onCancel={() => setShowDeleteColConfirm(false)}
        />

        {/* Delete alert rule confirmation: unlinks it from every column that uses it */}
        <DeleteRuleConfirm rule={deleteAlertRuleTarget} onDone={() => setDeleteAlertRuleTarget(null)} />

        {/* Column-level conditional format panel */}
        {showColFormat && (
          <CellConditionalFormatPanel
            columnId={column.id}
            mode="column"
            onClose={() => setShowColFormat(false)}
          />
        )}
      </div>
    </div>
  )
}
