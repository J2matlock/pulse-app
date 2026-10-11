import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { useMenuKeys } from '../../hooks/useMenuKeys'
import { createPortal } from 'react-dom'
import { ChevronUp, ChevronDown, ChevronsUpDown, MoreHorizontal, Trash2, Edit2, EyeOff, GripVertical, Bell, BellOff, Plus, Pencil, Activity, List, Palette, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Pin, PinOff, Asterisk, Link2, Columns3, Clock, IdCard, Settings2, Shapes } from 'lucide-react'
import { canBeRequired } from '../../../shared/requiredFields'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useAlertStore } from '../../stores/alertStore'
import type { Column, ParsedAlertRule } from '../../../shared/types'
import { takesDeadlineRule, canNameRecords } from '../../../shared/types'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { AlertRuleEditor } from '../alerts/AlertRuleEditor'
import { DeleteRuleConfirm } from '../alerts/DeleteRuleConfirm'
import { splitRulesByFit } from '../alerts/ruleFit'
import { ruleSummary } from '../../../shared/ruleSummary'
import { RuleColorKey } from '../alerts/RuleColorKey'
import { pulseEvents } from '../../events'
import { engineRuleFrom, needsDeadlineColumn } from '../../../shared/deadlineEngine'
import toast from 'react-hot-toast'
import { DoneChecklistPicker } from './DoneChecklistPicker'
import { NoteUpdatePicker } from './NoteUpdatePicker'
import { CellConditionalFormatPanel } from './CellConditionalFormatPanel'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Tooltip } from '../shared/Tooltip'
import { useFeature } from '../../hooks/useFeature'
import { useVocab } from '../../hooks/useVocab'
import { useLinkStore } from '../../stores/linkStore'
import { LinkSetupDialog } from '../links/LinkSetupDialog'
import { StageSettingsDialog } from '../stages/StageSettingsDialog'
import { EditOptionsDialog } from './EditOptionsDialog'
import { ChangeTypeDialog } from './ChangeTypeDialog'
import { CHANGEABLE_TYPES } from '../../../shared/columnTypes'
import { canBeStage, stageConfigOf } from '../../../shared/stages'

interface Props {
  column: Column
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>
}

/** A click on the name sorts after this long, unless it turns into a double-click (rename) */
const SORT_CLICK_DELAY = 250

export function ColumnHeader({ column, dragHandleProps }: Props): React.ReactElement {
  const checklistsOn = useFeature('checklists')
  const { sortConfig, columns: allColumns, frozenColumnCount } = useGridStore(useShallow(s => ({
    sortConfig: s.sortConfig,
    columns: s.columns,
    frozenColumnCount: s.frozenColumnCount,
  })))
  const { setSortConfig, updateColumn, deleteColumn, setNameColumn, toggleColumnVisibility, setFrozenColumnCount, reorderColumns } = useGridStore(useShallow(s => ({
    reorderColumns: s.reorderColumns,
    setSortConfig: s.setSortConfig,
    updateColumn: s.updateColumn,
    deleteColumn: s.deleteColumn,
    setNameColumn: s.setNameColumn,
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
  const [showColumnSettings, setShowColumnSettings] = useState(false)
  const [showChangeType, setShowChangeType] = useState(false)
  // What uses this column (rules, forms, views…), listed before a delete
  const [dependents, setDependents] = useState<string[]>([])
  const [deleteAlertRuleTarget, setDeleteAlertRuleTarget] = useState<ParsedAlertRule | null>(null)
  const [showEditOptions, setShowEditOptions] = useState(false)
  const [showColFormat, setShowColFormat] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)
  const sortClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (sortClickTimer.current) clearTimeout(sortClickTimer.current) }, [])

  // Current alert rule for this column (date columns only)
  const colConfig = (() => { try { return JSON.parse(column.config || '{}') } catch { return {} } })()
  const linkType = useLinkStore(s => column.column_type === 'link' ? s.types.find(lt => lt.id === (colConfig as { link_type_id?: number }).link_type_id) : undefined)
  const currentAlertRuleId: number | null = colConfig.alert_rule_id ?? null
  const currentAlertRule = alertRules.find(r => r.id === currentAlertRuleId)
  // Only rules that can work on this list's columns are offered (D-10); the current one always is
  const hiddenColumns = useGridStore(s => s.hiddenColumns)
  const { fits: fittingRules, others: otherListRules } = splitRulesByFit(alertRules, new Set([...allColumns, ...hiddenColumns].map(c => c.id)))
  if (currentAlertRule && !fittingRules.includes(currentAlertRule)) {
    fittingRules.push(currentAlertRule)
    otherListRules.splice(otherListRules.indexOf(currentAlertRule), 1)
  }

  // Freeze/pin column state
  const colIndex = allColumns.findIndex(c => c.id === column.id)
  const menuRef = useRef<HTMLDivElement>(null)
  const onMenuKeyDown = useMenuKeys(menuRef, showMenu, () => { setShowMenu(false); setShowAlertPicker(false) })

  // Move left / right among the shown columns, so columns can be reordered without dragging (G-32)
  const shownColumns = allColumns.filter(c => c.is_visible !== 0)
  const shownIndex = shownColumns.findIndex(c => c.id === column.id)
  function moveColumn(by: -1 | 1) {
    setShowMenu(false)
    const neighbour = shownColumns[shownIndex + by]
    if (!neighbour) return
    const ids = allColumns.map(c => c.id)
    const to = ids.indexOf(neighbour.id)
    ids.splice(ids.indexOf(column.id), 1)
    ids.splice(to, 0, column.id)
    void reorderColumns(ids)
  }
  const isColumnFrozen = colIndex >= 0 && colIndex < frozenColumnCount

  async function handleToggleLogChanges() {
    const newConfig = JSON.stringify({ ...colConfig, log_changes: !colConfig.log_changes })
    await updateColumn(column.id, { config: newConfig })
    setShowMenu(false)
  }

  async function handleSetAlertRule(ruleId: number | null) {
    const newConfig = JSON.stringify({ ...colConfig, alert_rule_id: ruleId ?? undefined })
    // A rule that reads the done date, not a due date, needs a Deadline column (Decision E1)
    const rule = ruleId != null ? useAlertStore.getState().rules.find(r => r.id === ruleId) : undefined
    if (rule && column.column_type === 'date' && needsDeadlineColumn(engineRuleFrom(rule))) {
      await updateColumn(column.id, { config: newConfig, column_type: 'deadline' })
      toast(`"${column.name}" is now a Deadline column: it shows when it's due, and when it was done.`, { duration: 8000 })
    } else {
      await updateColumn(column.id, { config: newConfig })
    }
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

  async function handleDelete() {
    setShowMenu(false)
    const res = await safeInvoke(IPC.COLUMN_DEPENDENTS, column.id)
    setDependents(res.ok ? res.data : [])
    setShowDeleteColConfirm(true)
  }

  async function handleHide() {
    await toggleColumnVisibility(column.id, false)
    setShowMenu(false)
  }

  function handleOpenEditOptions() {
    setShowMenu(false)
    setShowEditOptions(true)
  }

  // A "Choose a deadline rule" cell opens this column's rule picker (G-20)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => pulseEvents.on('column:choose-rule', ({ columnId }) => {
    if (columnId !== column.id) return
    const rect = rootRef.current?.getBoundingClientRect()
    setMenuPos({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 })
    setShowMenu(true)
    setShowAlertPicker(true)
  }), [column.id])

  // The menu is taller than the room below a header near the bottom of the window, so the
  // last items ("Delete column") ended up behind a scrollbar. Move it up until it all fits.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!showMenu || !el) return
    const room = window.innerHeight - 16
    const height = el.scrollHeight + 2
    const top = el.getBoundingClientRect().top
    if (top + height <= window.innerHeight - 8 && top >= 8) return
    el.style.bottom = 'auto'
    el.style.top = `${Math.max(8, window.innerHeight - 8 - height)}px`
    el.style.maxHeight = `${room}px`
  })

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setShowMenu(true)
  }

  return (
    <div ref={rootRef} className="flex items-center h-full px-1 gap-0.5 relative group" onContextMenu={handleContextMenu}>
      {/* Drag handle: shown on hover only, so the column's name gets the room the rest of the time */}
      {dragHandleProps && (
        <button
          {...dragHandleProps}
          className="hit-44 hidden group-hover:inline-flex flex-shrink-0 p-0.5 rounded-sm text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300
                     cursor-grab active:cursor-grabbing touch-none"
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
            className="w-full bg-transparent border-b border-blue-500 text-base font-semibold"
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
        <Tooltip content="Click to sort · Double-click to rename" placement="bottom" delay={600}>
          <button
            className="hit-44 flex-1 text-left text-base font-semibold text-slate-700 dark:text-slate-200 truncate min-w-0 px-1"
            onClick={e => {
              // Wait a moment, so a double-click renames instead of sorting twice
              const shift = e.shiftKey
              if (sortClickTimer.current) clearTimeout(sortClickTimer.current)
              sortClickTimer.current = setTimeout(() => { sortClickTimer.current = null; handleSortClick({ shiftKey: shift } as React.MouseEvent) }, SORT_CLICK_DELAY)
            }}
            onDoubleClick={() => {
              if (sortClickTimer.current) { clearTimeout(sortClickTimer.current); sortClickTimer.current = null }
              setIsRenaming(true); setRenameName(column.name)
            }}
          >
            {column.name}
          </button>
        </Tooltip>
      )}

      {/* Log changes indicator */}
      {colConfig.log_changes && (
        <span title="Log changes in timeline"><Activity className="w-3 h-3 text-green-500 dark:text-green-400 flex-shrink-0 opacity-70" /></span>
      )}

      {/* Deadline rule badge: a clock, with what the rule does in the tooltip (D-15) */}
      {takesDeadlineRule(column.column_type) && currentAlertRule && (
        <span title={`Deadline rule: ${currentAlertRule.name} · ${ruleSummary(currentAlertRule, id => allColumns.find(c => c.id === id)?.name)}`}
          aria-label={`Deadline rule: ${currentAlertRule.name}`} role="img"
          className="flex-shrink-0 inline-flex items-center rounded-sm bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-0.5">
          <Clock className="w-3.5 h-3.5" />
        </span>
      )}

      {/* Sort indicator */}
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
        // Unsorted: the hint shows on hover only, leaving the name its room
        <span className="hidden group-hover:inline-flex flex-shrink-0" data-testid="sort-hint">
          <ChevronsUpDown className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
        </span>
      )}

      {/* Column menu */}
      <div className="relative flex-shrink-0">
        <button
          className="hit-44 p-1 rounded-sm text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 opacity-60 group-hover:opacity-100 focus:opacity-100 transition-opacity"
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
                ref={menuRef}
                onKeyDown={onMenuKeyDown}
                className="fixed w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-[9999] overflow-y-auto"
                style={{
                  ...((() => {
                    const rawY = menuPos?.y ?? 0
                    const rawX = menuPos?.x ?? 0
                    const menuW = 270 // w-64 ≈ 256px + border/shadow
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
              {CHANGEABLE_TYPES.has(column.column_type) && (
                <button
                  className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => { setShowMenu(false); setShowChangeType(true) }}
                >
                  <Shapes className="w-4 h-4" />
                  Change type…
                </button>
              )}
              <button
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={handleHide}
              >
                <EyeOff className="w-4 h-4" />
                Hide column
              </button>
              {shownIndex > 0 && (
                <button className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700" onClick={() => moveColumn(-1)}>
                  <ArrowLeft className="w-4 h-4" />
                  Move left
                </button>
              )}
              {shownIndex >= 0 && shownIndex < shownColumns.length - 1 && (
                <button className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700" onClick={() => moveColumn(1)}>
                  <ArrowRight className="w-4 h-4" />
                  Move right
                </button>
              )}
              <button
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-left"
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
                {isColumnFrozen ? 'Stop keeping these columns in view' : 'Keep columns up to here in view'}
              </button>
              {column.is_name_column !== 1 && canNameRecords(column.column_type) && (
                <button
                  className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => { setShowMenu(false); void setNameColumn(column.id) }}
                  title={`Show this column as each ${t('record')}'s name everywhere`}
                >
                  <IdCard className="w-4 h-4" />
                  Use as name
                </button>
              )}
              {/* Everything else lives in one dialog, so the menu stays short (G-21) */}
              <button
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={() => { setShowMenu(false); setShowColumnSettings(true) }}
              >
                <Settings2 className="w-4 h-4" />
                Column settings…
              </button>

              {/* Alert rule picker — only for date columns */}
              {takesDeadlineRule(column.column_type) && (
                <>
                  <hr className="my-1 border-slate-200 dark:border-slate-700" />
                  <button
                    className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                    onClick={() => setShowAlertPicker(v => !v)}
                  >
                    <Bell className="w-4 h-4 text-blue-500" />
                    <span className="flex-1 text-left whitespace-nowrap">Deadline rule</span>
                    {currentAlertRule && (
                      <span className="text-sm text-blue-600 dark:text-blue-400 truncate max-w-28" title={currentAlertRule.name}>{currentAlertRule.name}</span>
                    )}
                  </button>

                  {showAlertPicker && (
                    <div className="px-2 pb-2">
                      {currentAlertRule && (
                        <div className="px-2 py-1.5 mb-1 rounded-sm bg-slate-50 dark:bg-slate-900/40">
                          <RuleColorKey rule={currentAlertRule} compact />
                        </div>
                      )}
                      {currentAlertRule && (
                        <button
                          className="hit-44 flex items-center gap-2 w-full px-2 py-1.5 text-base text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-sm"
                          onClick={() => handleSetAlertRule(null)}
                        >
                          <BellOff className="w-3.5 h-3.5" />
                          Remove deadline rule
                        </button>
                      )}
                      {alertRules.length === 0 && !currentAlertRule && (
                        <p className="px-2 py-1.5 text-sm text-slate-500 dark:text-slate-400">
                          No deadline rules yet.
                        </p>
                      )}
                      {fittingRules.map(rule => (
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
                      {otherListRules.length > 0 && (
                        <details className="mt-1">
                          <summary className="hit-44 flex items-center px-2 py-1.5 text-base text-slate-600 dark:text-slate-300 cursor-pointer rounded-sm hover:bg-slate-50 dark:hover:bg-slate-700">
                            Rules from other {t('list', { many: true })} (won't work here)
                          </summary>
                          <ul className="pl-2">
                            {otherListRules.map(rule => (
                              <li key={rule.id} className="px-2 py-1.5 text-base text-slate-500 dark:text-slate-400 truncate" title={`This rule reads columns this ${t('list')} doesn't have`}>
                                {rule.name}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <hr className="my-1 border-slate-200 dark:border-slate-700" />
                      <button
                        className="hit-44 flex items-center gap-2 w-full px-2 py-1.5 text-base text-blue-600 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-sm"
                        onClick={() => { setEditingRule(undefined); setShowAlertEditor(true); setShowMenu(false); setShowAlertPicker(false) }}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        New deadline rule…
                      </button>
                    </div>
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


        {/* Column settings (G-21): required, choices, colors, changes in notes, stage, links, deadline extras */}
        {showColumnSettings && createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={`col-settings-${column.id}`}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setShowColumnSettings(false) } }}>
            <div className="fixed inset-0 bg-black/50" onClick={() => setShowColumnSettings(false)} />
            <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-4">
              <h2 id={`col-settings-${column.id}`} className="text-lg font-semibold text-slate-800 dark:text-slate-100 px-3 mb-2">“{column.name}” settings</h2>
              <div onClick={e => { if ((e.target as HTMLElement).closest('button[data-opens]')) setShowColumnSettings(false) }}>
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
                data-opens
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={() => { setShowColFormat(true); setShowMenu(false) }}
              >
                <Palette className="w-4 h-4" />
                Color rules for this column…
              </button>

              {/* Edit options — only for dropdown/status columns */}
              {(column.column_type === 'dropdown' || column.column_type === 'status') && (
                <button
                data-opens
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
                data-opens
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
                data-opens
                  className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => { setShowMenu(false); setShowLinkSettings(true) }}
                >
                  <Link2 className="w-4 h-4" />
                  Link settings…
                </button>
              )}


              {takesDeadlineRule(column.column_type) && (
                <div className="mt-2 border-t border-slate-200 dark:border-slate-700 pt-2">
                  <NoteUpdatePicker
                    value={Array.isArray(colConfig.note_updates) ? colConfig.note_updates : []}
                    onChange={types => void updateColumn(column.id, { config: JSON.stringify({ ...colConfig, note_updates: types.length ? types : undefined }) })}
                  />
                  {currentAlertRule && checklistsOn && (
                    <DoneChecklistPicker value={colConfig.done_checklist_id ?? null} onChange={id => void handleSetDoneChecklist(id)} />
                  )}
                </div>
              )}
              </div>
              <div className="flex justify-end mt-4 px-3">
                <button type="button" className="btn-secondary" onClick={() => setShowColumnSettings(false)}>Close</button>
              </div>
            </div>
          </div>, document.body
        )}

        {showChangeType && <ChangeTypeDialog column={column} onClose={() => setShowChangeType(false)} />}

        {/* Alert rule editor modal (create or edit) */}
        {showAlertEditor && (
          <AlertRuleEditor
            rule={editingRule}
            columnId={column.id}
            onClose={async (createdRuleId?: number) => {
              setShowAlertEditor(false)
              // A new rule made from this column, or a copy of a shared one just for it: this column uses it
              if (createdRuleId) {
                await handleSetAlertRule(createdRuleId)
              }
              setEditingRule(undefined)
            }}
          />
        )}

        {/* Edit options for dropdown/status columns: a real dialog, so nothing clips it (G-36) */}
        {showEditOptions && (
          <EditOptionsDialog
            column={column}
            onClose={() => setShowEditOptions(false)}
            onSaved={async updated => {
              const gridId = useGridStore.getState().activeGridId
              if (gridId) await useGridStore.getState().loadGrid(gridId)
              if (updated > 0) toast.success(`Changed ${updated} ${t('record', { count: updated })}`)
            }}
          />
        )}

        {showLinkSettings && linkType && <LinkSetupDialog mode="edit" type={linkType} onClose={() => setShowLinkSettings(false)} />}
        {showStageSettings && <StageSettingsDialog column={column} onClose={() => setShowStageSettings(false)} />}

        {/* Delete column confirmation */}
        <ConfirmDialog
          open={showDeleteColConfirm}
          title={`Delete column "${column.name}"?`}
          message={`The column and its values go to the Trash. You can undo this, or bring it back from ${t('list', { cap: true })} settings for 30 days.`}
          confirmLabel="Delete column"
          onConfirm={async () => {
            setShowDeleteColConfirm(false)
            await deleteColumn(column.id)
          }}
          onCancel={() => setShowDeleteColConfirm(false)}
        >
          {dependents.length > 0 && (
            <div className="mb-3 rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3" data-testid="column-dependents">
              <p className="text-base font-medium text-amber-900 dark:text-amber-200">These use this column and will stop working as they do now:</p>
              <ul className="mt-1 list-disc pl-5 text-base text-amber-900 dark:text-amber-200">
                {dependents.slice(0, 8).map(d => <li key={d}>{d}</li>)}
                {dependents.length > 8 && <li>and {dependents.length - 8} more</li>}
              </ul>
            </div>
          )}
        </ConfirmDialog>

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
