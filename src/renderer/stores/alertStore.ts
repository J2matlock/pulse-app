import { create } from 'zustand'
import { IPC } from '../../shared/ipc-channels'
import type { ParsedAlertRule, AlertRule, AlertThreshold, AlertRuleUse, DeletedAlertRule } from '../../shared/types'
import { rlog } from '../utils/rendererLogger'
import toast from 'react-hot-toast'
import { storeInvoke } from '../utils/safeInvoke'
import { useUndoStore } from './undoStore'
import { useGridStore } from './gridStore'

interface AlertState {
  rules: ParsedAlertRule[]
  /** Columns that use each rule (rules are shared between columns and lists) */
  usage: AlertRuleUse[]
  isLoaded: boolean
  loadError: string | null
  loadRules: () => Promise<void>
  loadUsage: () => Promise<void>
  createRule: (rule: Omit<AlertRule, 'id' | 'created_at'>) => Promise<number | null>
  updateRule: (id: number, updates: Partial<Omit<AlertRule, 'id' | 'created_at'>>) => Promise<boolean>
  /** Deletes the rule and unlinks every column that used it, with Undo */
  deleteRule: (id: number) => Promise<boolean>
  getRuleById: (id: number) => ParsedAlertRule | undefined
  usageOf: (id: number) => AlertRuleUse[]
}

function parseRule(r: AlertRule): ParsedAlertRule {
  let thresholds: AlertThreshold[] = []
  try { thresholds = JSON.parse(r.thresholds || '[]') } catch (e) { rlog.warn('AlertStore', `Invalid alert rule thresholds JSON for rule ${r.id}`, e) }
  return { ...r, thresholds }
}

/** Keep the open list's columns in step with a rule being unlinked or linked again. */
function setColumnsRule(columnIds: number[], ruleId: number | null): void {
  if (columnIds.length === 0) return
  const ids = new Set(columnIds)
  const patch = <T extends { id: number; config: string | null }>(cols: T[]): T[] => cols.map(c => {
    if (!ids.has(c.id)) return c
    let cfg: Record<string, unknown> = {}
    try { cfg = JSON.parse(c.config || '{}') as Record<string, unknown> } catch { /* start fresh */ }
    if (ruleId === null) { delete cfg.alert_rule_id; delete cfg.alert_rule_name } else if (cfg.alert_rule_id == null) cfg.alert_rule_id = ruleId
    return { ...c, config: JSON.stringify(cfg) } as T
  })
  useGridStore.setState(s => ({ columns: patch(s.columns), hiddenColumns: patch(s.hiddenColumns) }))
}

/** "Used by 4 columns in 2 lists" */
export function describeRuleUsage(uses: AlertRuleUse[]): string {
  if (uses.length === 0) return 'Not used by any column.'
  const lists = new Set(uses.map(u => u.grid_id)).size
  if (lists === 1) return `Used by ${uses.length === 1 ? `"${uses[0]!.column_name}"` : `${uses.length} columns`} in ${uses[0]!.grid_name}.`
  return `Used by ${uses.length} columns in ${lists} lists.`
}

export const useAlertStore = create<AlertState>((set, get) => ({
  rules: [],
  usage: [],
  isLoaded: false,
  loadError: null,

  loadRules: async () => {
    try {
      const data = await storeInvoke<AlertRule[]>(IPC.ALERT_RULE_GET_ALL)
      set({ rules: data.map(parseRule), isLoaded: true, loadError: null })
    } catch (err) {
      set({ loadError: err instanceof Error ? err.message : 'Failed to load alert rules' })
      return
    }
    await get().loadUsage()
  },

  loadUsage: async () => {
    try {
      const data = await storeInvoke<AlertRuleUse[]>(IPC.ALERT_RULE_USAGE)
      if (Array.isArray(data)) set({ usage: data.filter(u => u && typeof u.rule_id === 'number') })
    } catch (err) {
      rlog.warn('AlertStore', 'Could not load which columns use each rule', err)
    }
  },

  createRule: async (rule) => {
    try {
      const data = await storeInvoke<number>(IPC.ALERT_RULE_CREATE, rule)
      await get().loadRules()
      return data
    } catch {
      toast.error('Could not save rule — please try again')
      return null
    }
  },

  updateRule: async (id, updates) => {
    try {
      await storeInvoke(IPC.ALERT_RULE_UPDATE, id, updates)
      await get().loadRules()
      // Main may have made the rule's Date columns Deadline columns (Decision E1): show that
      const g = useGridStore.getState()
      const usesIt = (c: { column_type: string; config: string | null }) => {
        try { return c.column_type === 'date' && (JSON.parse(c.config || '{}') as { alert_rule_id?: number }).alert_rule_id === id } catch { return false }
      }
      if (g.activeGridId && [...g.columns, ...g.hiddenColumns].some(usesIt)) await g.loadGrid(g.activeGridId)
      return true
    } catch {
      toast.error('Could not save rule — please try again')
      return false
    }
  },

  deleteRule: async (id) => {
    let snapshot: DeletedAlertRule
    try {
      snapshot = await storeInvoke<DeletedAlertRule>(IPC.ALERT_RULE_DELETE, id)
    } catch {
      toast.error('Could not delete rule — please try again')
      return false
    }
    set(s => ({ rules: s.rules.filter(r => r.id !== id), usage: s.usage.filter(u => u.rule_id !== id) }))
    const columnIds = snapshot?.columnIds ?? []
    setColumnsRule(columnIds, null)
    if (snapshot?.rule) {
      let current = snapshot
      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(),
        description: `Deleted deadline rule "${snapshot.rule.name}"`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'bell',
        undo: async () => {
          const newId = await storeInvoke<number>(IPC.ALERT_RULE_RESTORE, current)
          current = { ...current, rule: { ...current.rule, id: newId } }
          setColumnsRule(current.columnIds, newId)
          await get().loadRules()
        },
        redo: async () => {
          current = await storeInvoke<DeletedAlertRule>(IPC.ALERT_RULE_DELETE, current.rule.id)
          setColumnsRule(current.columnIds, null)
          await get().loadRules()
        },
      })
    }
    return true
  },

  getRuleById: (id) => get().rules.find(r => r.id === id),
  usageOf: (id) => get().usage.filter(u => u.rule_id === id),
}))
