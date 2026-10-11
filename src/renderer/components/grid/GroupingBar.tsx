/**
 * GroupingBar — toolbar control for grouping the grid by a dropdown/status/tag column or acuity.
 * Shown inside GridToolbar when grouping is active or when user opens the picker.
 * Also supports custom group bucket definitions.
 */
import React, { useRef, useState, useEffect } from 'react'
import { edgeAwareRefCallback } from '../../utils/domHelpers'
import { Layers, X, ChevronDown, Shield, Star, Settings, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { ACUITY_GROUP_KEY } from '../../../shared/types'
import type { Column, CustomGroupDef } from '../../../shared/types'
import { CustomGroupEditor } from './CustomGroupEditor'
import { Tooltip } from '../shared/Tooltip'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'

// Only these column types support grouping (discrete values)
const GROUPABLE_TYPES = new Set(['dropdown', 'status', 'tag', 'checkbox', 'text', 'link'])

function isGroupable(col: Column) {
  return GROUPABLE_TYPES.has(col.column_type)
}

export function GroupingBar(): React.ReactElement {
  const { t } = useVocab()
  const { columns, groupByColumnId, acuityEnabled: acuityFlag, customGroups, activeCustomGroupId, activeGridId } = useGridStore(useShallow(s => ({
    columns: s.columns,
    groupByColumnId: s.groupByColumnId,
    acuityEnabled: s.acuityEnabled,
    customGroups: s.customGroups,
    activeCustomGroupId: s.activeCustomGroupId,
    activeGridId: s.activeGridId,
  })))
  // A list's own setting, shown only while the feature is switched on
  const priorityOn = useFeature('priority')
  const acuityEnabled = acuityFlag && priorityOn
  const { setGroupByColumnId, setActiveCustomGroupId, deleteCustomGroup } = useGridStore(useShallow(s => ({
    setGroupByColumnId: s.setGroupByColumnId,
    setActiveCustomGroupId: s.setActiveCustomGroupId,
    deleteCustomGroup: s.deleteCustomGroup,
  })))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [showCustomGroupEditor, setShowCustomGroupEditor] = useState(false)
  const [editingCustomGroup, setEditingCustomGroup] = useState<CustomGroupDef | undefined>(undefined)
  const pickerRef = useRef<HTMLDivElement>(null)

  const isAcuityGrouped = groupByColumnId === ACUITY_GROUP_KEY && acuityEnabled
  const activeCol = isAcuityGrouped ? null : columns.find(c => c.id === groupByColumnId)
  const groupableColumns = columns.filter(isGroupable)

  // Determine the active custom group object (if any)
  const activeCustomGroup = customGroups.find(g => g.id === activeCustomGroupId) ?? null

  // Whether any grouping is active (standard or custom)
  const isGroupingActive = Boolean(groupByColumnId) || Boolean(activeCustomGroupId)

  function selectCustomGroup(def: CustomGroupDef) {
    setGroupByColumnId(null)
    setActiveCustomGroupId(def.id)
    setPickerOpen(false)
  }

  function clearAllGrouping() {
    setGroupByColumnId(null)
    setActiveCustomGroupId(null)
    setPickerOpen(false)
  }

  function openNewCustomGroup() {
    setEditingCustomGroup(undefined)
    setShowCustomGroupEditor(true)
    setPickerOpen(false)
  }

  function openEditCustomGroup(def: CustomGroupDef, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingCustomGroup(def)
    setShowCustomGroupEditor(true)
    setPickerOpen(false)
  }

  // Close picker on outside click.
  // Early return when pickerOpen is false means no listener is registered,
  // so no cleanup function is needed — this is intentional, not a leak.
  useEffect(() => {
    if (!pickerOpen) return
    function handler(e: MouseEvent) {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pickerOpen])

  if (groupableColumns.length === 0 && !acuityEnabled && customGroups.length === 0) return <></>

  // Determine label for trigger button
  const triggerLabel = activeCustomGroup
    ? activeCustomGroup.name
    : groupByColumnId
      ? (isAcuityGrouped ? t('priority', { cap: true }) : activeCol?.name ?? 'Group')
      : null

  return (
    <>
    <div className="relative flex items-center gap-2" data-tour="grouping-btn" ref={pickerRef}>
      {/* Trigger button */}
      <Tooltip content="Group rows by a column value (e.g., by Status or Category)" placement="bottom">
        <button
          onClick={() => setPickerOpen(v => !v)}
          className={`btn-secondary flex items-center gap-2 ${
            isGroupingActive
              ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
              : ''
          }`}
          style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
          title={isGroupingActive ? `Grouped by: ${triggerLabel ?? '—'}` : 'Group rows by column'}
          aria-expanded={pickerOpen}
          aria-haspopup="listbox"
        >
          <Layers className="w-4 h-4" />
          {isGroupingActive ? (
            <>
              {triggerLabel}
              <Tooltip content="Remove grouping" placement="top">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    clearAllGrouping()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      clearAllGrouping()
                    }
                  }}
                  className="ml-1 text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 cursor-pointer focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
                  aria-label="Remove grouping"
                >
                  <X className="w-3 h-3" />
                </span>
              </Tooltip>
            </>
          ) : (
            <>
              Group
              <ChevronDown className="w-3 h-3 text-slate-500 dark:text-slate-400" />
            </>
          )}
        </button>
      </Tooltip>
      {isGroupingActive && triggerLabel && (
        <span className="text-sm text-slate-500 dark:text-slate-400">
          Grouped by: <span className="font-medium text-slate-500 dark:text-slate-400">{triggerLabel}</span>
        </span>
      )}

      {/* Column picker dropdown */}
      {pickerOpen && (
        <div ref={edgeAwareRefCallback} className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 min-w-52">
          <p className="px-3 py-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Group by
          </p>
          {isGroupingActive && (
            <button
              onClick={clearAllGrouping}
              className="flex items-center gap-2 w-full px-3 py-2 text-base text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
              style={{ minHeight: 44, fontSize: 15 }}
            >
              <X className="w-4 h-4" />
              Remove grouping
            </button>
          )}
          {acuityEnabled && (
            <button
              onClick={() => {
                setActiveCustomGroupId(null)
                setGroupByColumnId(ACUITY_GROUP_KEY)
                setPickerOpen(false)
              }}
              className={`flex items-center gap-2 w-full px-3 py-2 text-base transition-colors ${
                isAcuityGrouped && !activeCustomGroupId
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              style={{ minHeight: 44, fontSize: 15 }}
            >
              <Shield className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 text-left truncate">{t('priority', { cap: true })}</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">level</span>
            </button>
          )}
          {groupableColumns.map(col => (
            <button
              key={col.id}
              onClick={() => {
                setActiveCustomGroupId(null)
                setGroupByColumnId(col.id)
                setPickerOpen(false)
              }}
              className={`flex items-center gap-2 w-full px-3 py-2 text-base transition-colors ${
                col.id === groupByColumnId && !activeCustomGroupId
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              style={{ minHeight: 44, fontSize: 15 }}
            >
              <span className="flex-1 text-left truncate">{col.name}</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">{col.column_type}</span>
            </button>
          ))}

          {/* Custom groups section */}
          {customGroups.length > 0 && (
            <>
              <div className="mx-3 my-1 border-t border-slate-200 dark:border-slate-700" />
              <p className="px-3 py-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                Custom
              </p>
              {customGroups.map(def => (
                <button
                  key={def.id}
                  onClick={() => selectCustomGroup(def)}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-base transition-colors group ${
                    def.id === activeCustomGroupId
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                  style={{ minHeight: 44, fontSize: 15 }}
                >
                  <Star className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                  <span className="flex-1 text-left truncate">{def.name}</span>
                  <span className="text-sm text-slate-500 dark:text-slate-400 mr-1">custom</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => openEditCustomGroup(def, e)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        setEditingCustomGroup(def)
                        setShowCustomGroupEditor(true)
                        setPickerOpen(false)
                      }
                    }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-opacity focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-blue-500"
                    aria-label={`Edit custom group: ${def.name}`}
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation()
                      if (activeGridId !== null) void deleteCustomGroup(activeGridId, def.id)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        if (activeGridId !== null) void deleteCustomGroup(activeGridId, def.id)
                      }
                    }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 text-slate-500 dark:text-slate-400 hover:text-red-500 transition-opacity focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-red-500"
                    aria-label={`Delete custom group: ${def.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </span>
                </button>
              ))}
            </>
          )}

          {/* Manage custom groups */}
          <div className="mx-3 my-1 border-t border-slate-200 dark:border-slate-700" />
          <button
            onClick={openNewCustomGroup}
            className="flex items-center gap-2 w-full px-3 py-2 text-base text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
            style={{ minHeight: 44, fontSize: 15 }}
          >
            <Settings className="w-4 h-4" />
            New custom group…
          </button>
        </div>
      )}
    </div>

    {/* Custom Group Editor modal */}
    {showCustomGroupEditor && activeGridId !== null && (
      <CustomGroupEditor
        gridId={activeGridId}
        initialDef={editingCustomGroup}
        onClose={() => {
          setShowCustomGroupEditor(false)
          setEditingCustomGroup(undefined)
        }}
      />
    )}
    </>
  )
}
