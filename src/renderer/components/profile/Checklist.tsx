import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { ChevronDown, ChevronRight, X, Plus, Trash2, Pencil, Check } from 'lucide-react'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { dndAccessibility } from '../../utils/dndAnnouncements'
import { IPC } from '../../../shared/ipc-channels'
import type { ChecklistItem as ChecklistItemType, ChecklistTemplate, ChecklistPriority, ChecklistGroup } from '../../../shared/types'
import { ChecklistItem, CompletedChecklistItem } from './ChecklistItem'
import { ChecklistToolbar } from './ChecklistToolbar'
import { GroupPicker } from '../shared/GroupPicker'
import { ChecklistGroupHeader } from './ChecklistGroupHeader'
import { ChecklistAddDialog } from './ChecklistAddDialog'
import { useUndoStore } from '../../stores/undoStore'
import { safeInvoke, mustInvoke } from '../../utils/safeInvoke'
import { rlog } from '../../utils/rendererLogger'
import { friendlyError } from '../../utils/friendlyError'
import { pulseEvents } from '../../events'
import { resolveGroupDrop, groupAwareCollision } from '../../views/tasks/groupDrag'
import { useVocab } from '../../hooks/useVocab'

interface Props {
  rowId: number
  clientName: string
  /** If provided, Checklist stores a focus-add-input callback here so the parent can call it. */
  focusAddRef?: React.MutableRefObject<(() => void) | null>
}

export function Checklist({ rowId, clientName, focusAddRef }: Props) {
  const [items, setItems] = useState<ChecklistItemType[]>([])
  const [groups, setGroups] = useState<ChecklistGroup[]>([])
  /** The group just added here, whose name opens for typing once (bug sweep S2) */
  const [justAddedGroupId, setJustAddedGroupId] = useState<number | null>(null)
  // Its header has opened by now (child effects run first); a later remount shouldn't reopen it
  useEffect(() => { if (justAddedGroupId != null) setJustAddedGroupId(null) }, [justAddedGroupId])
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [completedExpanded, setCompletedExpanded] = useState(false)
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [groupAddTitles, setGroupAddTitles] = useState<Record<number, string>>({})
  const [recentlyCheckedIds, setRecentlyCheckedIds] = useState<Set<number>>(new Set())
  const addInputRef = useRef<HTMLInputElement>(null)
  const [addFlash, setAddFlash] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<{ id: number; name: string } | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [pendingTemplateId, setPendingTemplateId] = useState<number | null>(null)
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Items and groups move from the keyboard too: Space on a handle, arrows, Space (AUDIT-049)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const dragA11y = useMemo(() => dndAccessibility(id => {
    const s = String(id)
    if (s.startsWith('group-')) {
      const g = groups.find(x => `group-${x.id}` === s)
      return g ? `${g.name} group` : null
    }
    return items.find(i => i.id === id)?.title
  }), [items, groups])

  // Expose focus callback to parent
  useEffect(() => {
    if (focusAddRef) {
      focusAddRef.current = () => {
        addInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        addInputRef.current?.focus()
        // Flash the input area to call attention
        setAddFlash(true)
        setTimeout(() => setAddFlash(false), 700)
      }
    }
    return () => { if (focusAddRef) focusAddRef.current = null }
  }, [focusAddRef])

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const [itemsResult, groupsResult] = await Promise.all([
        safeInvoke<ChecklistItemType[]>(IPC.CHECKLIST_GET, rowId),
        safeInvoke<ChecklistGroup[]>(IPC.CHECKLIST_GROUP_GET_ALL, rowId),
      ])
      if (itemsResult.ok) setItems(itemsResult.data)
      if (groupsResult.ok) {
        setGroups(groupsResult.data)
        // Initialize collapse state from DB
        setCollapsedGroups(new Set(groupsResult.data.filter(g => g.is_collapsed === 1).map(g => g.id)))
      }
    } finally {
      setLoading(false)
    }
  }, [rowId])

  // Load items when rowId changes
  useEffect(() => { void loadItems() }, [loadItems])

  // Reload when undo/redo updates checklist data externally (cross-mount)
  useEffect(() => {
    const unsub = pulseEvents.on('checklist:changed', (data) => {
      if (data.rowId === rowId) void loadItems()
    })
    return unsub
  }, [rowId, loadItems])

  const activeItems = useMemo(() => {
    const active = items.filter(i => i.is_completed === 0 || recentlyCheckedIds.has(i.id))
    return [...active].sort((a, b) => a.position - b.position)
  }, [items, recentlyCheckedIds])

  const completedItems = useMemo(() =>
    items.filter(i => i.is_completed === 1 && !recentlyCheckedIds.has(i.id))
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')),
    [items, recentlyCheckedIds]
  )

  const total = activeItems.length + completedItems.length
  const doneCount = completedItems.length
  const progressPct = total > 0 ? Math.round((doneCount / total) * 100) : 0
  const progressColor = progressPct === 100 ? '#22c55e' : progressPct >= 50 ? '#eab308' : '#94a3b8'

  // ── Grouped items memo ──────────────────────────────────────────────────
  const groupedActiveItems = useMemo(() => {
    const map = new Map<number | null, ChecklistItemType[]>()
    // An item whose group is gone shows ungrouped instead of nowhere (bug sweep S2)
    const groupIds = new Set(groups.map(g => g.id))
    for (const item of activeItems) {
      const key = item.group_id != null && groupIds.has(item.group_id) ? item.group_id : null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return map
  }, [activeItems, groups])

  const hasGroups = groups.length > 0

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAddItem = useCallback(async (title: string, groupId?: number | null, extraFields?: { description?: string | null; priority?: string; due_date?: string | null; recurrence_rule?: string | null }) => {
    const extra: Record<string, unknown> = {}
    if (groupId != null) extra.group_id = groupId
    if (extraFields?.description) extra.description = extraFields.description
    if (extraFields?.priority) extra.priority = extraFields.priority
    if (extraFields?.due_date) extra.due_date = extraFields.due_date
    if (extraFields?.recurrence_rule) extra.recurrence_rule = extraFields.recurrence_rule
    const result = await safeInvoke<ChecklistItemType>(IPC.CHECKLIST_CREATE_ITEM, rowId, title, Object.keys(extra).length > 0 ? extra : undefined)
    if (result.ok) {
      const created = result.data
      setItems(prev => [...prev, created])
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Added checklist item "${title}"`,
        timestamp: Date.now(),
        category: 'logged',
        icon: 'plus-circle',
        undo: async () => {
          await mustInvoke(IPC.CHECKLIST_DELETE_ITEM, created.id)
          pulseEvents.emit('checklist:changed', { rowId })
        },
        redo: async () => {
          await mustInvoke(IPC.CHECKLIST_RESTORE_ITEM, created)
          pulseEvents.emit('checklist:changed', { rowId })
        },
      })
    }
  }, [rowId])

  const handleToggle = useCallback(async (id: number, isCompleted: boolean) => {
    const now = isCompleted ? new Date().toISOString() : null
    // Capture previous state for undo before touching anything
    const prevItem = items.find(i => i.id === id)
    const prevCompleted = prevItem?.is_completed ?? 0
    const prevCompletedAt = prevItem?.completed_at ?? null
    const itemTitle = prevItem?.title ?? 'checklist item'

    if (isCompleted) {
      // Keep item in active list briefly so the pop animation plays
      setRecentlyCheckedIds(prev => new Set(prev).add(id))
      setTimeout(() => {
        setRecentlyCheckedIds(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 400)
    }
    setItems(prev => prev.map(i => i.id === id
      ? { ...i, is_completed: isCompleted ? 1 : 0, completed_at: now }
      : i
    ))
    const res = await safeInvoke(IPC.CHECKLIST_UPDATE_ITEM, id, {
      is_completed: isCompleted ? 1 : 0,
      completed_at: now,
    })
    if (!res.ok) {
      // Put the tick back as it was, so the list doesn't show something that wasn't saved (audit L-28)
      setItems(prev => prev.map(i => i.id === id ? { ...i, is_completed: prevCompleted, completed_at: prevCompletedAt } : i))
      setRecentlyCheckedIds(prev => { const next = new Set(prev); next.delete(id); return next })
      toast.error(`We couldn't ${isCompleted ? 'tick off' : 'reopen'} "${itemTitle}" — try again`)
      return
    }
    const sysLogId = res.data.sysLogId
    // A repeating item came straight back, due again (audit 1.26)
    const repeat = res.data.repeat ?? null
    // What the item looked like before and after, so undo and redo can put it back silently
    // (the log entry is voided or restored by the side effect, not written again; audit S-23)
    const before = { is_completed: prevCompleted, completed_at: prevCompletedAt, ...(repeat ? { due_date: repeat.previousDue } : {}) }
    const afterState = repeat
      ? { is_completed: 0 as const, completed_at: null, completed_by: null, due_date: repeat.nextDue }
      : { is_completed: (isCompleted ? 1 : 0) as 0 | 1, completed_at: now }
    if (repeat) setItems(prev => prev.map(i => i.id === id ? { ...i, ...afterState } : i))
    const nextText = repeat ? ` · next due ${new Date(`${repeat.nextDue}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''
    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(),
      description: isCompleted ? `Completed "${itemTitle}"${nextText}` : `Reopened "${itemTitle}"`,
      timestamp: Date.now(),
      category: sysLogId != null ? 'logged' : 'silent',
      icon: 'check-square',
      contextLabel: clientName,
      contextId: rowId,
      sideEffects: sysLogId != null ? [{ type: 'void_case_log', caseLogId: sysLogId }] : undefined,
      undo: async () => {
        setItems(prev => prev.map(i => i.id === id ? { ...i, ...before } : i))
        await mustInvoke(IPC.CHECKLIST_UPDATE_ITEM, id, before, { silent: true })
        pulseEvents.emit('checklist:changed', { rowId })
      },
      redo: async () => {
        setItems(prev => prev.map(i => i.id === id ? { ...i, ...afterState } : i))
        await mustInvoke(IPC.CHECKLIST_UPDATE_ITEM, id, afterState, { silent: true })
        pulseEvents.emit('checklist:changed', { rowId })
      },
    })
  }, [items, clientName, rowId])

  const handleUpdate = useCallback(async (id: number, updates: Partial<ChecklistItemType>) => {
    const prevItem = items.find(i => i.id === id)
    const prevValues = prevItem
      ? Object.fromEntries(
          (Object.keys(updates) as Array<keyof ChecklistItemType>).map(k => [k, prevItem[k]])
        ) as Partial<ChecklistItemType>
      : null
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i))
    const res = await safeInvoke(IPC.CHECKLIST_UPDATE_ITEM, id, updates)
    if (!res.ok) {
      // Put the item back as it was, and push no undo for a change that didn't happen (audit A08-5)
      if (prevValues) setItems(prev => prev.map(i => i.id === id ? { ...i, ...prevValues } : i))
      toast.error(friendlyError(res.error, "We couldn't save your change to that item — try again"))
      return
    }
    if (prevValues) {
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: 'Updated checklist item',
        timestamp: Date.now(),
        category: 'logged',
        icon: 'edit',
        undo: async () => {
          await mustInvoke(IPC.CHECKLIST_UPDATE_ITEM, id, prevValues)
          pulseEvents.emit('checklist:changed', { rowId })
        },
        redo: async () => {
          await mustInvoke(IPC.CHECKLIST_UPDATE_ITEM, id, updates)
          pulseEvents.emit('checklist:changed', { rowId })
        },
      })
    }
  }, [items, rowId])

  const handleDelete = useCallback(async (id: number) => {
    const item = items.find(i => i.id === id)
    setItems(prev => prev.filter(i => i.id !== id))
    const res = await safeInvoke(IPC.CHECKLIST_DELETE_ITEM, id)
    if (!res.ok) {
      if (item) setItems(prev => prev.some(i => i.id === id) ? prev : [...prev, item])
      toast.error(friendlyError(res.error, "We couldn't delete that item — try again"))
      return
    }
    if (item) {
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: 'Deleted checklist item',
        timestamp: Date.now(),
        category: 'logged',
        icon: 'trash',
        undo: async () => {
          await mustInvoke(IPC.CHECKLIST_RESTORE_ITEM, item)
          pulseEvents.emit('checklist:changed', { rowId })
        },
        redo: async () => {
          await mustInvoke(IPC.CHECKLIST_DELETE_ITEM, id)
          pulseEvents.emit('checklist:changed', { rowId })
        },
      })
    }
  }, [items, rowId])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const drop = resolveGroupDrop(active.id, over.id, activeItems, groups)
    if (!drop) return

    if (drop.kind === 'groups') {
      const byId = new Map(groups.map(g => [g.id, g]))
      const before = groups
      setGroups(drop.order.map((id, i) => ({ ...byId.get(id)!, position: i })))
      const res = await safeInvoke(IPC.CHECKLIST_GROUP_REORDER, rowId, drop.order)
      if (!res.ok) {
        setGroups(before)
        toast.error(friendlyError(res.error, "We couldn't move that group — try again"))
      }
      return
    }

    const oldOrder = activeItems.map(i => i.id)
    const newOrder = drop.order
    const moved = drop.moved
    const fromGroup = moved ? (activeItems.find(i => i.id === moved.id)?.group_id ?? null) : null
    setItems(prev => prev.map(item => {
      const newPos = newOrder.indexOf(item.id)
      const next = newPos === -1 ? item : { ...item, position: newPos }
      return moved && item.id === moved.id ? { ...next, group_id: moved.groupId } : next
    }))
    // Dropped in another group: it moves there (bug sweep S2)
    if (moved) {
      const res = await safeInvoke(IPC.CHECKLIST_MOVE_ITEM_TO_GROUP, moved.id, moved.groupId)
      if (!res.ok) {
        toast.error("We couldn't move that item — try again")
        pulseEvents.emit('checklist:changed', { rowId })
        return
      }
    }
    const reordered = await safeInvoke(IPC.CHECKLIST_REORDER, rowId, newOrder)
    if (!reordered.ok) {
      // Reload so the list shows the order that was actually saved
      toast.error(friendlyError(reordered.error, "We couldn't save the new order — try again"))
      pulseEvents.emit('checklist:changed', { rowId })
      return
    }
    useUndoStore.getState().push({
      id: crypto.randomUUID(),
      description: moved ? 'Moved a checklist item to another group' : 'Reordered checklist items',
      timestamp: Date.now(),
      category: 'logged',
      icon: 'reorder',
      undo: async () => {
        if (moved) await mustInvoke(IPC.CHECKLIST_MOVE_ITEM_TO_GROUP, moved.id, fromGroup)
        await mustInvoke(IPC.CHECKLIST_REORDER, rowId, oldOrder)
        pulseEvents.emit('checklist:changed', { rowId })
      },
      redo: async () => {
        if (moved) await mustInvoke(IPC.CHECKLIST_MOVE_ITEM_TO_GROUP, moved.id, moved.groupId)
        await mustInvoke(IPC.CHECKLIST_REORDER, rowId, newOrder)
        pulseEvents.emit('checklist:changed', { rowId })
      },
    })
  }, [activeItems, groups, rowId])

  const doResetCycle = useCallback(async () => {
    const completedSnapshot = items.filter(i => i.is_completed === 1)
    const res = await safeInvoke(IPC.CHECKLIST_RESET_CYCLE, rowId)
    if (!res.ok) {
      toast.error(friendlyError(res.error, "We couldn't reset the checklist — try again"))
      return
    }
    setItems(prev => prev.map(i => ({ ...i, is_completed: 0 as const, completed_at: null })))
    setCompletedExpanded(false)
    if (completedSnapshot.length > 0) {
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: 'Reset checklist cycle',
        timestamp: Date.now(),
        category: 'logged',
        icon: 'reset',
        // Ticked again quietly: they were done before, so no new "Completed" entries (audit S-23)
        undo: async () => {
          await Promise.all(completedSnapshot.map(i =>
            mustInvoke(IPC.CHECKLIST_UPDATE_ITEM, i.id, { is_completed: 1, completed_at: i.completed_at }, { silent: true })
          ))
          pulseEvents.emit('checklist:changed', { rowId })
        },
        redo: async () => {
          await mustInvoke(IPC.CHECKLIST_RESET_CYCLE, rowId)
          pulseEvents.emit('checklist:changed', { rowId })
        },
      })
    }
  }, [rowId, items])

  const doClearCompleted = useCallback(async () => {
    const toDelete = items.filter(i => i.is_completed === 1)
    if (toDelete.length === 0) return
    setItems(prev => prev.filter(i => i.is_completed !== 1))
    setCompletedExpanded(false)
    const results = await Promise.all(toDelete.map(i => safeInvoke(IPC.CHECKLIST_DELETE_ITEM, i.id)))
    const failed = toDelete.filter((_, idx) => results[idx]?.ok !== true)
    const cleared = toDelete.filter((_, idx) => results[idx]?.ok === true)
    if (failed.length > 0) {
      // The ones that weren't deleted come back
      setItems(prev => [...prev, ...failed.filter(f => !prev.some(i => i.id === f.id))])
      const firstError = results.find(r => !r.ok)
      toast.error(friendlyError(firstError && !firstError.ok ? firstError.error : null,
        cleared.length === 0 ? "We couldn't clear the completed items — try again" : `We couldn't clear ${failed.length} of the completed items — try again`))
    }
    if (cleared.length === 0) return
    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(),
      description: `Cleared ${cleared.length} completed item${cleared.length === 1 ? '' : 's'}`,
      timestamp: Date.now(),
      category: 'structural',
      icon: 'trash',
      undo: async () => {
        await Promise.all(cleared.map(i => mustInvoke(IPC.CHECKLIST_RESTORE_ITEM, i)))
        pulseEvents.emit('checklist:changed', { rowId })
      },
      redo: async () => {
        await Promise.all(cleared.map(i => mustInvoke(IPC.CHECKLIST_DELETE_ITEM, i.id)))
        pulseEvents.emit('checklist:changed', { rowId })
      },
    })
  }, [items, rowId])

  // ── Group handlers ─────────────────────────────────────────────────────

  const handleAddGroup = useCallback(async () => {
    const result = await safeInvoke<ChecklistGroup>(IPC.CHECKLIST_GROUP_CREATE, rowId, 'New heading')
    if (result.ok) {
      const created = result.data
      setGroups(prev => [...prev, created])
      setJustAddedGroupId(created.id)
      // Redo makes the group again under a new id; undo must delete that one (bug sweep S2)
      let currentId = created.id
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: 'Added checklist group',
        timestamp: Date.now(),
        category: 'structural',
        icon: 'folder-plus',
        undo: async () => {
          await mustInvoke(IPC.CHECKLIST_GROUP_DELETE, currentId)
          pulseEvents.emit('checklist:changed', { rowId })
        },
        redo: async () => {
          const again = await mustInvoke<ChecklistGroup>(IPC.CHECKLIST_GROUP_CREATE, rowId, created.name)
          currentId = again.data.id
          pulseEvents.emit('checklist:changed', { rowId })
        },
      })
    }
  }, [rowId])

  const handleRenameGroup = useCallback(async (groupId: number, name: string) => {
    const prevGroup = groups.find(g => g.id === groupId)
    const prevName = prevGroup?.name ?? ''
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, name } : g))
    const res = await safeInvoke(IPC.CHECKLIST_GROUP_UPDATE, groupId, { name })
    if (!res.ok) {
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, name: prevName } : g))
      toast.error(friendlyError(res.error, "We couldn't rename that group — try again"))
      return
    }
    useUndoStore.getState().push({
      id: crypto.randomUUID(),
      description: `Renamed group to "${name}"`,
      timestamp: Date.now(),
      category: 'logged',
      icon: 'edit',
      undo: async () => {
        await mustInvoke(IPC.CHECKLIST_GROUP_UPDATE, groupId, { name: prevName })
        pulseEvents.emit('checklist:changed', { rowId })
      },
      redo: async () => {
        await mustInvoke(IPC.CHECKLIST_GROUP_UPDATE, groupId, { name })
        pulseEvents.emit('checklist:changed', { rowId })
      },
    })
  }, [groups, rowId])

  const handleDeleteGroup = useCallback(async (groupId: number) => {
    const deletedGroup = groups.find(g => g.id === groupId)
    if (!deletedGroup) return
    const affectedItems = items.filter(i => i.group_id === groupId)
    setGroups(prev => prev.filter(g => g.id !== groupId))
    setItems(prev => prev.map(i => i.group_id === groupId ? { ...i, group_id: null } : i))
    const res = await safeInvoke(IPC.CHECKLIST_GROUP_DELETE, groupId)
    if (!res.ok) {
      const affectedIds = new Set(affectedItems.map(i => i.id))
      setGroups(prev => prev.some(g => g.id === groupId) ? prev : [...prev, deletedGroup])
      setItems(prev => prev.map(i => affectedIds.has(i.id) ? { ...i, group_id: groupId } : i))
      toast.error(friendlyError(res.error, "We couldn't delete that group — try again"))
      return
    }
    // Undo brings the group back under a new id; redo must delete that one (bug sweep S2)
    let currentId = groupId
    useUndoStore.getState().push({
      id: crypto.randomUUID(),
      description: `Deleted group "${deletedGroup.name}"`,
      timestamp: Date.now(),
      category: 'structural',
      icon: 'trash',
      undo: async () => {
        // Recreate group and reassign items
        const res = await mustInvoke<ChecklistGroup>(IPC.CHECKLIST_GROUP_CREATE, rowId, deletedGroup.name)
        currentId = res.data.id
        await Promise.all(affectedItems.map(i =>
          mustInvoke(IPC.CHECKLIST_MOVE_ITEM_TO_GROUP, i.id, currentId)
        ))
        pulseEvents.emit('checklist:changed', { rowId })
      },
      redo: async () => {
        await mustInvoke(IPC.CHECKLIST_GROUP_DELETE, currentId)
        pulseEvents.emit('checklist:changed', { rowId })
      },
    })
  }, [groups, items, rowId])

  const handleToggleCollapse = useCallback((groupId: number) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      const newState = !next.has(groupId)
      if (newState) next.add(groupId)
      else next.delete(groupId)
      // Debounce-save to DB
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = setTimeout(() => {
        // Only the open/closed look; the screen keeps it for this visit either way
        void safeInvoke(IPC.CHECKLIST_GROUP_UPDATE, groupId, { is_collapsed: newState ? 1 : 0 }).then(res => {
          if (!res.ok) rlog.warn('Checklist', 'Could not save group collapse state', res.error)
        })
      }, 500)
      return next
    })
  }, [])

  const handleApplyTemplate = useCallback(async (templateId: number, groupId?: number | null, createdGroupName?: string) => {
    const result = await safeInvoke(IPC.CHECKLIST_APPLY_TEMPLATE, rowId, templateId, groupId ?? null)
    if (result.ok) {
      // Redo makes new items (and a new group), so undo and redo track the current ids (bug sweep S2)
      let createdIds = result.data.createdIds
      let targetGroupId = groupId ?? null
      // Reload items from DB to get full item objects
      const reloaded = await safeInvoke<ChecklistItemType[]>(IPC.CHECKLIST_GET, rowId)
      if (reloaded.ok) setItems(reloaded.data)
      if (createdIds.length > 0) {
        useUndoStore.getState().push({
          id: crypto.randomUUID(),
          description: `Applied template (${createdIds.length} item${createdIds.length === 1 ? '' : 's'} added)`,
          timestamp: Date.now(),
          category: 'structural',
          icon: 'check-square',
          undo: async () => {
            await Promise.all(createdIds.map(id => mustInvoke(IPC.CHECKLIST_DELETE_ITEM, id)))
            if (createdGroupName !== undefined && targetGroupId != null) await mustInvoke(IPC.CHECKLIST_GROUP_DELETE, targetGroupId)
            pulseEvents.emit('checklist:changed', { rowId })
          },
          redo: async () => {
            if (createdGroupName !== undefined) {
              const group = await mustInvoke<ChecklistGroup>(IPC.CHECKLIST_GROUP_CREATE, rowId, createdGroupName)
              targetGroupId = group.data.id
            }
            const again = await mustInvoke(IPC.CHECKLIST_APPLY_TEMPLATE, rowId, templateId, targetGroupId)
            createdIds = again.data.createdIds
            pulseEvents.emit('checklist:changed', { rowId })
          },
        })
      }
    } else {
      toast.error(friendlyError(result.error, "We couldn't add the template's items — try again"))
    }
    setShowTemplateManager(false)
  }, [rowId])

  return (
    <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      {/* Header */}
      <ChecklistToolbar
        loading={loading}
        total={total}
        doneCount={doneCount}
        onOpenTemplates={() => setShowTemplateManager(true)}
        onAddTask={() => setShowAddDialog(true)}
        onAddGroup={handleAddGroup}
      />

      {/* Progress bar */}
      {!loading && total > 0 && (
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50">
          <progress
            value={doneCount}
            max={total}
            aria-label={`${doneCount} of ${total} checklist items complete`}
            className="w-full h-2 rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-slate-200 dark:[&::-webkit-progress-bar]:bg-slate-700 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:transition-all [&::-webkit-progress-value]:duration-500"
            style={{ ['--progress-color' as string]: progressColor }}
          />
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {doneCount} of {total} completed{progressPct === 100 ? ' — all done!' : ''}
          </p>
        </div>
      )}

      {/* Active items */}
      <div className="px-1 py-1">
        {loading ? (
          <div className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>
        ) : activeItems.length === 0 && completedItems.length === 0 && !hasGroups ? (
          <div className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            No checklist items yet. Type below and press Enter to add one, or use Templates.
          </div>
        ) : !hasGroups ? (
          /* ── Flat mode (no groups) — identical to previous behavior ── */
          <DndContext sensors={sensors} collisionDetection={groupAwareCollision} onDragEnd={handleDragEnd} accessibility={dragA11y}>
            <SortableContext items={activeItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
              {activeItems.map(item => (
                <ChecklistItem
                  key={item.id}
                  item={item}
                  isDragDisabled={false}
                  onToggle={() => handleToggle(item.id, true)}
                  onUpdate={updates => handleUpdate(item.id, updates)}
                  onDelete={() => handleDelete(item.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          /* ── Grouped mode ── */
          <DndContext sensors={sensors} collisionDetection={groupAwareCollision} onDragEnd={handleDragEnd} accessibility={dragA11y}>
            {/* Ungrouped items first */}
            {(groupedActiveItems.get(null) ?? []).length > 0 && (
              <div className="mb-1">
                <SortableContext items={(groupedActiveItems.get(null) ?? []).map(i => i.id)} strategy={verticalListSortingStrategy}>
                  {(groupedActiveItems.get(null) ?? []).map(item => (
                    <ChecklistItem
                      key={item.id}
                      item={item}
                      isDragDisabled={false}
                      onToggle={() => handleToggle(item.id, true)}
                      onUpdate={updates => handleUpdate(item.id, updates)}
                      onDelete={() => handleDelete(item.id)}
                    />
                  ))}
                </SortableContext>
              </div>
            )}

            {/* Ungrouped add item input — placed above groups */}
            <div className={`mx-2 mb-1 rounded-lg transition-all duration-700
                            ${addFlash
                              ? 'bg-blue-50 dark:bg-blue-900/25 ring-3 ring-blue-400 dark:ring-blue-500'
                              : 'bg-transparent ring-0'}`}>
              <input
                ref={addInputRef}
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newTitle.trim()) {
                    void handleAddItem(newTitle.trim())
                    setNewTitle('')
                  }
                }}
                placeholder="+ Add an item… (press Enter)"
                style={{ fontSize: 15 }}
                spellCheck={false}
                className="w-full px-3 py-2 text-slate-600 dark:text-slate-400
                           placeholder-slate-500 dark:placeholder-slate-400
                           bg-transparent focus:outline-hidden focus:ring-3 focus:ring-blue-500 rounded-sm border-0"
              />
            </div>

            {/* Groups sorted by position — wrapped in SortableContext for group header drag */}
            <SortableContext
              items={[...groups].sort((a, b) => a.position - b.position).map(g => `group-${g.id}`)}
              strategy={verticalListSortingStrategy}
            >
            {[...groups].sort((a, b) => a.position - b.position).map(group => {
              const groupItems = groupedActiveItems.get(group.id) ?? []
              const allGroupItems = items.filter(i => i.group_id === group.id)
              const groupCompleted = allGroupItems.filter(i => i.is_completed === 1).length
              const groupTotal = allGroupItems.length
              const isCollapsed = collapsedGroups.has(group.id)

              return (
                <div key={group.id}>
                  <ChecklistGroupHeader
                    group={group}
                    totalItems={groupTotal}
                    completedItems={groupCompleted}
                    isCollapsed={isCollapsed}
                    onToggleCollapse={() => handleToggleCollapse(group.id)}
                    onRename={(name) => void handleRenameGroup(group.id, name)}
                    onDelete={() => setConfirmDeleteGroup({ id: group.id, name: group.name })}
                    isDragDisabled={false}
                    autoEdit={group.id === justAddedGroupId}
                  />

                  {!isCollapsed && (
                    <div className="ml-3 border-l-2 border-slate-200 dark:border-slate-600 pl-1">
                      <SortableContext items={groupItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                        {groupItems.map(item => (
                          <ChecklistItem
                            key={item.id}
                            item={item}
                            isDragDisabled={false}
                            onToggle={() => handleToggle(item.id, true)}
                            onUpdate={updates => handleUpdate(item.id, updates)}
                            onDelete={() => handleDelete(item.id)}
                          />
                        ))}
                      </SortableContext>

                      {/* Per-group add item input */}
                      <input
                        type="text"
                        value={groupAddTitles[group.id] ?? ''}
                        onChange={e => setGroupAddTitles(prev => ({ ...prev, [group.id]: e.target.value }))}
                        onKeyDown={e => {
                          const val = (groupAddTitles[group.id] ?? '').trim()
                          if (e.key === 'Enter' && val) {
                            void handleAddItem(val, group.id)
                            setGroupAddTitles(prev => ({ ...prev, [group.id]: '' }))
                          }
                        }}
                        placeholder="+ Add an item… (press Enter)"
                        style={{ fontSize: 15 }}
                        spellCheck={false}
                        className="w-full px-3 py-1.5 text-base text-slate-500 dark:text-slate-400
                                   placeholder-slate-500 dark:placeholder-slate-400
                                   bg-transparent focus:outline-hidden focus:ring-3 focus:ring-blue-500 rounded-sm border-0"
                      />
                    </div>
                  )}
                </div>
              )
            })}
            </SortableContext>
          </DndContext>
        )}

        {/* Add item input (flat/no-groups mode only — grouped mode has its own above the groups) */}
        {!hasGroups && (
          <div className={`mx-2 mb-1 rounded-lg transition-all duration-700
                          ${addFlash
                            ? 'bg-blue-50 dark:bg-blue-900/25 ring-3 ring-blue-400 dark:ring-blue-500'
                            : 'bg-transparent ring-0'}`}>
            <input
              ref={addInputRef}
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newTitle.trim()) {
                  void handleAddItem(newTitle.trim())
                  setNewTitle('')
                }
              }}
              placeholder="+ Add an item… (press Enter)"
              style={{ fontSize: 15 }}
              spellCheck={false}
              className="w-full px-3 py-2 text-slate-600 dark:text-slate-400
                         placeholder-slate-500 dark:placeholder-slate-400
                         bg-transparent focus:outline-hidden focus:ring-3 focus:ring-blue-500 rounded-sm border-0"
            />
          </div>
        )}
      </div>

      {/* Completed section */}
      {completedItems.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-700">
          <div className="flex items-center">
            <button
              onClick={() => setCompletedExpanded(prev => !prev)}
              aria-expanded={completedExpanded}
              aria-controls="completed-items-list"
              className="flex-1 flex items-center gap-2 px-4 py-2.5 text-base
                         text-slate-500 dark:text-slate-400
                         hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            >
              {completedExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Completed ({completedItems.length})
            </button>
            <button
              onClick={() => setConfirmReset(true)}
              title="Uncheck all completed items so they can be done again"
              className="hit-44 px-3 py-1.5 mr-1 text-base text-slate-500 dark:text-slate-400
                         hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20
                         rounded-sm transition-colors
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-400"
            >
              Uncheck all
            </button>
            <button
              onClick={() => setConfirmClear(true)}
              title="Remove all completed items from the checklist"
              className="hit-44 px-3 py-1.5 mr-3 text-base text-slate-500 dark:text-slate-400
                         hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20
                         rounded-sm transition-colors
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-red-400"
            >
              Remove done items
            </button>
          </div>

          {completedExpanded && (
            <div id="completed-items-list" className="px-1 pb-1">
              {completedItems.map(item => (
                <CompletedChecklistItem
                  key={item.id}
                  item={item}
                  onUncheck={() => handleToggle(item.id, false)}
                  onDelete={() => handleDelete(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add task dialog */}
      {showAddDialog && (
        <ChecklistAddDialog
          groups={groups}
          onClose={() => setShowAddDialog(false)}
          onSave={({ title, description, priority, due_date, group_id, recurrence_rule }) => {
            void handleAddItem(title, group_id, { description, priority, due_date, recurrence_rule })
          }}
        />
      )}

      {/* Template manager modal */}
      {showTemplateManager && (
        <TemplateManager
          onApply={(templateId) => {
            setPendingTemplateId(templateId)
            setShowTemplateManager(false)
          }}
          onClose={() => setShowTemplateManager(false)}
        />
      )}

      {/* GroupPicker for template apply */}
      {pendingTemplateId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <GroupPicker
            groups={groups}
            onSelect={(groupId) => {
              const tid = pendingTemplateId
              setPendingTemplateId(null)
              void handleApplyTemplate(tid, groupId)
            }}
            onCreateAndSelect={async (name) => {
              const res = await safeInvoke<ChecklistGroup>(IPC.CHECKLIST_GROUP_CREATE, rowId, name)
              if (res.ok) {
                setGroups(prev => [...prev, res.data])
                const tid = pendingTemplateId
                setPendingTemplateId(null)
                void handleApplyTemplate(tid, res.data.id, res.data.name)
              }
            }}
            onCancel={() => setPendingTemplateId(null)}
          />
        </div>
      )}

      {/* Uncheck all confirmation */}
      <ConfirmDialog
        open={confirmReset}
        title="Uncheck all completed items?"
        message={`Uncheck ${completedItems.length} completed item${completedItems.length === 1 ? '' : 's'} for ${clientName} so ${completedItems.length === 1 ? 'it' : 'they'} can be done again? This can be undone.`}
        confirmLabel="Uncheck all"
        onConfirm={() => { setConfirmReset(false); void doResetCycle() }}
        onCancel={() => setConfirmReset(false)}
      />

      {/* Remove done items confirmation */}
      <ConfirmDialog
        open={confirmClear}
        title="Remove done items"
        message={`Delete ${completedItems.length} completed item${completedItems.length === 1 ? '' : 's'}? You can undo this.`}
        confirmLabel={`Delete ${completedItems.length} item${completedItems.length === 1 ? '' : 's'}`}
        destructive={true}
        onConfirm={() => { setConfirmClear(false); void doClearCompleted() }}
        onCancel={() => setConfirmClear(false)}
      />

      {/* Delete group confirmation */}
      <ConfirmDialog
        open={!!confirmDeleteGroup}
        title="Delete group"
        message={`Delete the group "${confirmDeleteGroup?.name}"? Items in this group will become ungrouped. This can be undone.`}
        confirmLabel="Delete group"
        destructive={true}
        onConfirm={() => { if (confirmDeleteGroup) { void handleDeleteGroup(confirmDeleteGroup.id); setConfirmDeleteGroup(null) } }}
        onCancel={() => setConfirmDeleteGroup(null)}
      />
    </section>
  )
}

// ── Template Manager ───────────────────────────────────────────────────────────

interface TemplateItemDraft {
  key: string
  title: string
  priority: ChecklistPriority
}

interface TemplateDraft {
  name: string
  description: string
  isRecurring: boolean
  recurrenceDays: string
  items: TemplateItemDraft[]
}

function emptyDraft(): TemplateDraft {
  return { name: '', description: '', isRecurring: false, recurrenceDays: '30', items: [] }
}

function templateToDraft(tpl: ChecklistTemplate): TemplateDraft {
  let rawItems: Array<{ title?: string; priority?: string }> = []
  try { rawItems = JSON.parse(tpl.items) } catch { /* ignore */ }
  return {
    name: tpl.name,
    description: tpl.description ?? '',
    isRecurring: tpl.is_recurring === 1,
    recurrenceDays: tpl.recurrence_days?.toString() ?? '30',
    items: rawItems.map((it, i) => ({
      key: String(i),
      title: it.title ?? '',
      priority: (it.priority as ChecklistPriority) ?? 'normal',
    })),
  }
}

export function TemplateManager({ onApply, onClose, title = 'Checklist Templates', footer = 'Templates add items to the existing checklist without replacing them.' }: {
  onApply: (templateId: number) => void
  onClose: () => void
  /** The Tasks page calls them a set of tasks (UX D-33) */
  title?: string
  footer?: string
}) {
  const { t } = useVocab(null)
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { void loadTemplates() }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.preventDefault(); if (view !== 'list') setView('list'); else onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, onClose])

  useEffect(() => {
    if (view !== 'list') setTimeout(() => nameInputRef.current?.focus(), 50)
  }, [view])

  async function loadTemplates() {
    setLoading(true)
    const result = await safeInvoke<ChecklistTemplate[]>(IPC.CL_TEMPLATE_GET_ALL)
    if (result.ok) setTemplates(result.data)
    setLoading(false)
  }

  function openCreate() {
    setDraft(emptyDraft())
    setEditingId(null)
    setError('')
    setView('create')
  }

  function openEdit(tpl: ChecklistTemplate) {
    setDraft(templateToDraft(tpl))
    setEditingId(tpl.id)
    setError('')
    setView('edit')
  }

  async function handleSave() {
    if (!draft.name.trim()) { setError('Template name is required.'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        is_recurring: (draft.isRecurring ? 1 : 0) as 0 | 1,
        recurrence_days: draft.isRecurring ? (parseInt(draft.recurrenceDays, 10) || 30) : null,
        is_system: 0 as 0 | 1,
        items: JSON.stringify(draft.items.map(it => ({
          title: it.title.trim(),
          priority: it.priority,
        })).filter(it => it.title)),
      }

      if (view === 'create') {
        const result = await safeInvoke<ChecklistTemplate>(IPC.CL_TEMPLATE_CREATE, payload)
        if (!result.ok) throw new Error(result.error)
        setTemplates(prev => [...prev, result.data].sort((a, b) => a.name.localeCompare(b.name)))
      } else if (editingId != null) {
        const result = await safeInvoke<ChecklistTemplate>(IPC.CL_TEMPLATE_UPDATE, editingId, payload)
        if (!result.ok) throw new Error(result.error)
        setTemplates(prev => prev.map(t => t.id === editingId ? result.data : t))
      }
      setView('list')
    } catch (err) {
      rlog.error('Checklist', 'Failed to save template', err)
      setError('Failed to save template. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    const result = await safeInvoke<boolean>(IPC.CL_TEMPLATE_DELETE, id)
    if (result.ok) setTemplates(prev => prev.filter(t => t.id !== id))
    else toast.error(friendlyError(result.error, "We couldn't delete that template — try again"))
  }

  // Draft item helpers
  function addDraftItem() {
    setDraft(d => ({ ...d, items: [...d.items, { key: Date.now().toString(), title: '', priority: 'normal' }] }))
  }

  function updateDraftItem(key: string, updates: Partial<TemplateItemDraft>) {
    setDraft(d => ({ ...d, items: d.items.map(it => it.key === key ? { ...it, ...updates } : it) }))
  }

  function removeDraftItem(key: string) {
    setDraft(d => ({ ...d, items: d.items.filter(it => it.key !== key) }))
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return createPortal(
    <div
      ref={trapRef}
      className="fixed inset-0 bg-black/40 dark:bg-black/60 z-50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-2xl
                     border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col"
           style={{ maxHeight: '85vh' }}>

        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            {view !== 'list' && (
              <button
                onClick={() => setView('list')}
                aria-label="Back to templates"
                className="hit-44 text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 mr-1
                           focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
              >
                <ChevronRight className="w-5 h-5 rotate-180" />
              </button>
            )}
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
              {view === 'list' ? title : view === 'create' ? 'New Template' : 'Edit Template'}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="hit-44 text-slate-500 hover:text-slate-600 dark:hover:text-slate-300
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {view === 'list' ? (
            /* ── List view ── */
            <>
              {loading ? (
                <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">Loading…</div>
              ) : templates.length === 0 ? (
                <div className="py-12 text-center px-6">
                  <p className="text-base text-slate-500 dark:text-slate-400 mb-4">
                    No templates yet. A template is a ready-made set of checklist items (e.g. "New {t('record')} intake") you can add to any {t('record')} in one click. The Templates page in the sidebar shows the same list.
                  </p>
                  <button
                    onClick={openCreate}
                    className="hit-44 px-4 py-2 rounded-lg bg-blue-500 text-white text-base font-medium hover:bg-blue-600 transition-colors"
                  >
                    Create your first template
                  </button>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                  {templates.map(tpl => {
                    let itemCount = 0
                    try { itemCount = (JSON.parse(tpl.items) as unknown[]).length } catch { /* ignore */ }
                    return (
                      <li key={tpl.id} className="flex items-center gap-3 px-5 py-4
                                                   hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="text-base font-medium text-slate-800 dark:text-slate-200 truncate">
                            {tpl.name}
                          </div>
                          {tpl.description && (
                            <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                              {tpl.description}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-sm text-slate-500 dark:text-slate-400">
                              {itemCount} item{itemCount !== 1 ? 's' : ''}
                            </span>
                            {tpl.is_recurring === 1 && tpl.recurrence_days && (
                              <span className="text-sm text-blue-500 dark:text-blue-400">
                                · Repeats every {tpl.recurrence_days} days
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => openEdit(tpl)}
                            className="hit-44 p-1.5 rounded-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300
                                       hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors
                                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                            title="Edit template"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ id: tpl.id, name: tpl.name })}
                            className="hit-44 p-1.5 rounded-sm text-slate-500 hover:text-red-500
                                       hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors
                                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-red-400"
                            title="Delete template"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onApply(tpl.id)}
                            className="hit-44 ml-1 px-3 py-1.5 rounded-md text-base font-medium
                                       bg-blue-500 text-white hover:bg-blue-600 transition-colors
                                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                          >
                            Apply
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          ) : (
            /* ── Create / Edit view ── */
            <div className="p-5 space-y-4">
              {error && (
                <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
                  {error}
                </div>
              )}

              {/* Name */}
              <div>
                <label htmlFor="checklist-save-name" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Template Name <span className="text-red-600 dark:text-red-400">*</span>
                </label>
                <input
                  id="checklist-save-name"
                  ref={nameInputRef}
                  type="text"
                  value={draft.name}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder={`e.g. Annual review, New ${t('record')} intake…`}
                  style={{ fontSize: 15 }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                             bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                             focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="checklist-save-desc" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Description <span className="text-slate-500 dark:text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  id="checklist-save-desc"
                  type="text"
                  value={draft.description}
                  onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  placeholder="Brief description of when to use this template"
                  style={{ fontSize: 15 }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                             bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                             focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                />
              </div>

              {/* Recurring */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setDraft(d => ({ ...d, isRecurring: !d.isRecurring }))}
                  className={`hit-44 relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                             focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                             ${draft.isRecurring ? 'bg-blue-500' : 'bg-slate-500 dark:bg-slate-500'}`}
                  role="switch"
                  aria-checked={draft.isRecurring}
                  aria-label="Items repeat"
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform
                                   ${draft.isRecurring ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="text-base text-slate-700 dark:text-slate-300">
                  Items repeat
                </span>
                {draft.isRecurring && (
                  <div className="flex items-center gap-1.5 ml-2">
                    <span className="text-base text-slate-500 dark:text-slate-400">each comes back</span>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={draft.recurrenceDays}
                      onChange={e => setDraft(d => ({ ...d, recurrenceDays: e.target.value }))}
                      className="w-16 px-2 py-1 text-base rounded-sm border border-slate-300 dark:border-slate-600
                                 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                                 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                    />
                    <span className="text-base text-slate-500 dark:text-slate-400">days after it's ticked off</span>
                  </div>
                )}
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-base font-medium text-slate-700 dark:text-slate-300">
                    Items ({draft.items.length})
                  </label>
                </div>

                {draft.items.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {draft.items.map((item, idx) => (
                      <div key={item.key} className="flex items-center gap-2">
                        <span className="text-sm text-slate-500 dark:text-slate-400 w-5 text-right flex-shrink-0">{idx + 1}.</span>
                        <input
                          type="text"
                          value={item.title}
                          onChange={e => updateDraftItem(item.key, { title: e.target.value })}
                          placeholder="Item title"
                          style={{ fontSize: 15 }}
                          className="flex-1 px-2 py-1.5 rounded-sm border border-slate-300 dark:border-slate-600
                                     bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                                     focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                        />
                        <select
                          value={item.priority}
                          onChange={e => updateDraftItem(item.key, { priority: e.target.value as ChecklistPriority })}
                          style={{ fontSize: 15 }}
                          className="w-24 px-1.5 py-1.5 rounded-sm border border-slate-300 dark:border-slate-600
                                     bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                                     focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                        >
                          <option value="low">Low</option>
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                        <button
                          onClick={() => removeDraftItem(item.key)}
                          aria-label="Remove item"
                          className="hit-44 p-1.5 text-slate-500 hover:text-red-500 rounded-sm
                                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-red-400"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={addDraftItem}
                  className="hit-44 flex items-center gap-1.5 px-3 py-2 rounded-lg text-base
                             text-blue-600 dark:text-blue-400 border border-dashed border-blue-300 dark:border-blue-700
                             hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors w-full justify-center"
                >
                  <Plus className="w-4 h-4" />
                  Add Item
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700 flex-shrink-0 flex items-center justify-between">
          {view === 'list' ? (
            <>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {footer}
              </p>
              <button
                onClick={openCreate}
                className="hit-44 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-base font-medium
                           bg-blue-500 text-white hover:bg-blue-600 transition-colors
                           focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              >
                <Plus className="w-4 h-4" />
                New Template
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setView('list')}
                className="hit-44 px-3 py-1.5 rounded-lg text-base text-slate-600 dark:text-slate-400
                           hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="hit-44 flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-base font-medium
                           bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors
                           focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              >
                <Check className="w-4 h-4" />
                {saving ? 'Saving…' : 'Save Template'}
              </button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete template"
        message={`Delete the template "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete template"
        destructive
        onConfirm={() => { if (deleteTarget) { void handleDelete(deleteTarget.id); setDeleteTarget(null) } }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>,
    document.body
  )
}
