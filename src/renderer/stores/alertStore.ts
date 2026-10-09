import { create } from 'zustand'
import { IPC } from '../../shared/ipc-channels'
import type { ParsedAlertRule, AlertRule, AlertThreshold } from '../../shared/types'
import { rlog } from '../utils/rendererLogger'
import toast from 'react-hot-toast'
import { storeInvoke } from '../utils/safeInvoke'

interface AlertState {
  rules: ParsedAlertRule[]
  isLoaded: boolean
  loadError: string | null
  loadRules: () => Promise<void>
  createRule: (rule: Omit<AlertRule, 'id' | 'created_at'>) => Promise<number | null>
  updateRule: (id: number, updates: Partial<Omit<AlertRule, 'id' | 'created_at'>>) => Promise<boolean>
  deleteRule: (id: number) => Promise<boolean>
  getRuleById: (id: number) => ParsedAlertRule | undefined
}

function parseRule(r: AlertRule): ParsedAlertRule {
  let thresholds: AlertThreshold[] = []
  try { thresholds = JSON.parse(r.thresholds || '[]') } catch (e) { rlog.warn('AlertStore', `Invalid alert rule thresholds JSON for rule ${r.id}`, e) }
  return { ...r, thresholds }
}

export const useAlertStore = create<AlertState>((set, get) => ({
  rules: [],
  isLoaded: false,
  loadError: null,

  loadRules: async () => {
    try {
      const data = await storeInvoke<AlertRule[]>(IPC.ALERT_RULE_GET_ALL)
      set({ rules: data.map(parseRule), isLoaded: true, loadError: null })
    } catch (err) {
      set({ loadError: err instanceof Error ? err.message : 'Failed to load alert rules' })
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
      return true
    } catch {
      toast.error('Could not save rule — please try again')
      return false
    }
  },

  deleteRule: async (id) => {
    try {
      await storeInvoke(IPC.ALERT_RULE_DELETE, id)
      set(s => ({ rules: s.rules.filter(r => r.id !== id) }))
      return true
    } catch {
      toast.error('Could not delete rule — please try again')
      return false
    }
  },

  getRuleById: (id) => get().rules.find(r => r.id === id),
}))
