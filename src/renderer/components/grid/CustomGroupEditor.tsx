/**
 * CustomGroupEditor — modal dialog for creating or editing a custom group bucket definition.
 * Users assign discrete column values into named buckets, each with an optional accent color.
 */
import React, { useRef, useState, useMemo } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { ACUITY_GROUP_KEY } from '../../../shared/types'
import type { CustomGroupDef, CustomGroupBucket } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'

// Only these column types produce discrete groupable values
const GROUPABLE_TYPES = new Set(['dropdown', 'status', 'tag', 'checkbox', 'text'])

interface CustomGroupEditorProps {
  gridId: number
  initialDef?: CustomGroupDef
  onClose: () => void
}

interface BucketState {
  label: string
  values: string[]
  color: string
}

export function CustomGroupEditor({ gridId, initialDef, onClose }: CustomGroupEditorProps): React.ReactElement {
  const { t } = useVocab()
  const { columns, rows, acuityEnabled: acuityFlag, acuityLevels, saveCustomGroup } = useGridStore(useShallow(s => ({
    columns: s.columns,
    rows: s.rows,
    acuityEnabled: s.acuityEnabled,
    acuityLevels: s.acuityLevels,
    saveCustomGroup: s.saveCustomGroup,
  })))
  // A list's own setting, shown only while the feature is switched on
  const priorityOn = useFeature('priority')
  const acuityEnabled = acuityFlag && priorityOn

  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true, { onEscape: onClose })

  const groupableColumns = useMemo(() => columns.filter(c => GROUPABLE_TYPES.has(c.column_type)), [columns])

  // Derive initial column selection
  const initialColId: number | string = initialDef?.columnId ??
    (acuityEnabled ? ACUITY_GROUP_KEY : (groupableColumns[0]?.id ?? ACUITY_GROUP_KEY))

  const [name, setName] = useState(initialDef?.name ?? '')
  const [selectedColId, setSelectedColId] = useState<number | string>(initialColId)
  const [buckets, setBuckets] = useState<BucketState[]>(() => {
    if (initialDef && initialDef.buckets.length >= 2) {
      return initialDef.buckets.map(b => ({
        label: b.label,
        values: [...b.values],
        color: b.color ?? '#6366f1',
      }))
    }
    return [
      { label: '', values: [], color: '#6366f1' },
      { label: '', values: [], color: '#10b981' },
    ]
  })
  const [focusedBucketIdx, setFocusedBucketIdx] = useState<number>(0)
  const [errors, setErrors] = useState<string[]>([])

  // For acuity: stored value is the ID string, but we show the level name in the UI
  function acuityDisplayLabel(idStr: string): string {
    const level = acuityLevels.find(l => String(l.id) === idStr)
    return level ? level.name : idStr
  }

  // Derive all unique values for the selected column
  const allValues = useMemo<string[]>(() => {
    if (selectedColId === ACUITY_GROUP_KEY) {
      // Acuity level IDs as strings (stored value), sorted by level points desc
      const seen = new Set<string>()
      rows.forEach(r => {
        if (r.acuity_level_id !== null) seen.add(String(r.acuity_level_id))
      })
      return Array.from(seen).sort((a, b) => {
        const la = acuityLevels.find(l => String(l.id) === a)
        const lb = acuityLevels.find(l => String(l.id) === b)
        return (lb?.points ?? 0) - (la?.points ?? 0)
      })
    }
    const colKey = `col_${selectedColId}` as `col_${number}`
    const seen = new Set<string>()
    rows.forEach(r => {
      const v = r[colKey]
      if (v !== null && v !== undefined && v !== '') seen.add(v)
    })
    return Array.from(seen).sort()
  }, [selectedColId, rows])

  // Values not assigned to any bucket
  const assignedValues = useMemo<Set<string>>(() => {
    const s = new Set<string>()
    buckets.forEach(b => b.values.forEach(v => s.add(v)))
    return s
  }, [buckets])

  const unassignedValues = useMemo<string[]>(
    () => allValues.filter(v => !assignedValues.has(v)),
    [allValues, assignedValues]
  )

  // When column changes, clear all bucket value assignments (labels and colors stay)
  function handleColumnChange(raw: string) {
    const id = raw === ACUITY_GROUP_KEY ? ACUITY_GROUP_KEY : Number(raw)
    setSelectedColId(id)
    setBuckets(prev => prev.map(b => ({ ...b, values: [] })))
  }

  function assignValueToBucket(value: string, bucketIdx: number) {
    setBuckets(prev => prev.map((b, i) =>
      i === bucketIdx ? { ...b, values: [...b.values, value] } : b
    ))
  }

  function removeValueFromBucket(value: string, bucketIdx: number) {
    setBuckets(prev => prev.map((b, i) =>
      i === bucketIdx ? { ...b, values: b.values.filter(v => v !== value) } : b
    ))
  }

  function updateBucketLabel(idx: number, label: string) {
    setBuckets(prev => prev.map((b, i) => i === idx ? { ...b, label } : b))
  }

  function updateBucketColor(idx: number, color: string) {
    setBuckets(prev => prev.map((b, i) => i === idx ? { ...b, color } : b))
  }

  function addBucket() {
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']
    setBuckets(prev => [
      ...prev,
      { label: '', values: [], color: colors[prev.length % colors.length] ?? '#6366f1' },
    ])
    setFocusedBucketIdx(buckets.length)
  }

  function removeBucket(idx: number) {
    if (buckets.length <= 2) return
    setBuckets(prev => prev.filter((_, i) => i !== idx))
    setFocusedBucketIdx(Math.min(focusedBucketIdx, buckets.length - 2))
  }

  async function handleSave() {
    const errs: string[] = []
    if (!name.trim()) errs.push('Group name is required.')
    if (buckets.length < 2) errs.push('At least 2 buckets are required.')
    buckets.forEach((b, i) => {
      if (!b.label.trim()) errs.push(`Bucket ${i + 1} needs a label.`)
    })
    if (errs.length > 0) { setErrors(errs); return }

    const def: CustomGroupDef = {
      id: initialDef?.id ?? `cg_${Date.now()}`,
      name: name.trim(),
      columnId: selectedColId,
      buckets: buckets.map((b): CustomGroupBucket => ({
        label: b.label.trim(),
        values: b.values,
        color: b.color,
      })),
    }

    await saveCustomGroup(gridId, def)
    onClose()
  }

  const selectedColName =
    selectedColId === ACUITY_GROUP_KEY
      ? t('priority', { cap: true })
      : groupableColumns.find(c => c.id === selectedColId)?.name ?? ''

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div ref={trapRef} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {initialDef ? 'Edit Custom Group' : 'New Custom Group'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            style={{ minHeight: 44, minWidth: 44 }}
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error summary */}
        {errors.length > 0 && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700">
            {errors.map((e, i) => (
              <p key={i} className="text-sm text-red-700 dark:text-red-300" style={{ fontSize: 15 }}>{e}</p>
            ))}
          </div>
        )}

        {/* Group Name */}
        <div className="mb-4">
          <label className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1" style={{ fontSize: 15 }}>
            Group name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Active and on hold"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-3 focus:ring-indigo-500"
            style={{ minHeight: 44, fontSize: 15 }}
          />
        </div>

        {/* Column selector */}
        <div className="mb-5">
          <label className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1" style={{ fontSize: 15 }}>
            Group by column
          </label>
          <select
            value={String(selectedColId)}
            onChange={e => handleColumnChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-3 focus:ring-indigo-500"
            style={{ minHeight: 44, fontSize: 15 }}
          >
            {acuityEnabled && (
              <option value={ACUITY_GROUP_KEY}>{t('priority', { cap: true })}</option>
            )}
            {groupableColumns.map(col => (
              <option key={col.id} value={String(col.id)}>{col.name}</option>
            ))}
          </select>
        </div>

        {/* Two-column layout: Unassigned values | Buckets */}
        <div className="grid grid-cols-[1fr_2fr] gap-4 mb-5">
          {/* Unassigned values pool */}
          <div>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2" style={{ fontSize: 15 }}>
              Unassigned values
              <span className="ml-1 text-sm text-slate-500 dark:text-slate-400">({unassignedValues.length})</span>
            </p>
            <div className="min-h-24 p-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 flex flex-wrap gap-1.5 content-start">
              {unassignedValues.length === 0 && (
                <p className="text-sm text-slate-500 dark:text-slate-400 italic w-full text-center py-4">
                  {allValues.length === 0 ? `No values found in "${selectedColName}"` : 'All values assigned'}
                </p>
              )}
              {unassignedValues.map(v => (
                <button
                  key={v}
                  onClick={() => assignValueToBucket(v, focusedBucketIdx)}
                  title={`Add to bucket ${focusedBucketIdx + 1}: ${buckets[focusedBucketIdx]?.label || '(unlabeled)'}`}
                  className="hit-44 px-2 py-1 rounded-md text-base bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-500 text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:border-indigo-400 transition-colors cursor-pointer"
                  style={{ minHeight: 30 }}
                >
                  {selectedColId === ACUITY_GROUP_KEY ? acuityDisplayLabel(v) : v}
                </button>
              ))}
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Click a value to add it to the selected bucket
            </p>
          </div>

          {/* Buckets */}
          <div className="flex flex-col gap-3">
            {buckets.map((bucket, idx) => (
              <div
                key={idx}
                onClick={() => setFocusedBucketIdx(idx)}
                className={`p-3 rounded-lg border-2 transition-colors cursor-pointer ${
                  focusedBucketIdx === idx
                    ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/10'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {/* Color swatch */}
                  <input
                    type="color"
                    value={bucket.color}
                    onChange={e => { e.stopPropagation(); updateBucketColor(idx, e.target.value) }}
                    onClick={e => e.stopPropagation()}
                    title="Bucket accent color"
                    className="w-7 h-7 rounded cursor-pointer border border-slate-300 dark:border-slate-600 p-0.5 bg-transparent"
                    style={{ minHeight: 28 }}
                  />
                  {/* Label input */}
                  <input
                    type="text"
                    value={bucket.label}
                    onChange={e => { e.stopPropagation(); updateBucketLabel(idx, e.target.value) }}
                    onClick={e => { e.stopPropagation(); setFocusedBucketIdx(idx) }}
                    placeholder={`Bucket ${idx + 1} label`}
                    className="flex-1 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-3 focus:ring-indigo-500"
                    style={{ fontSize: 15, minHeight: 34 }}
                  />
                  {/* Remove bucket */}
                  <button
                    onClick={e => { e.stopPropagation(); removeBucket(idx) }}
                    disabled={buckets.length <= 2}
                    className="hit-44 p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    style={{ minHeight: 34, minWidth: 34 }}
                    title="Remove bucket"
                    aria-label="Remove bucket"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Assigned values in this bucket */}
                <div className="flex flex-wrap gap-1.5 min-h-8">
                  {bucket.values.length === 0 && (
                    <span className="text-sm text-slate-500 dark:text-slate-400 italic self-center">
                      {focusedBucketIdx === idx ? 'Click values on the left to add them here' : 'No values'}
                    </span>
                  )}
                  {bucket.values.map(v => (
                    <button
                      key={v}
                      onClick={e => { e.stopPropagation(); removeValueFromBucket(v, idx) }}
                      title="Remove from bucket"
                      className="hit-44 px-2 py-0.5 rounded-md text-base text-white flex items-center gap-1 hover:opacity-80 transition-opacity"
                      style={{ minHeight: 26, backgroundColor: bucket.color }}
                    >
                      {selectedColId === ACUITY_GROUP_KEY ? acuityDisplayLabel(v) : v}
                      <X className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Add bucket */}
            <button
              onClick={addBucket}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors w-full"
              style={{ minHeight: 44, fontSize: 15 }}
            >
              <Plus className="w-4 h-4" />
              Add bucket
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
          <button onClick={onClose} className="btn btn-secondary" style={{ minHeight: 44, fontSize: 15 }}>
            Cancel
          </button>
          <button onClick={handleSave} className="btn btn-primary" style={{ minHeight: 44, fontSize: 15 }}>
            {initialDef ? 'Save changes' : 'Create group'}
          </button>
        </div>
      </div>
    </div>
  )
}
