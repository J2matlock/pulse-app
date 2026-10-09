import type { FeatureKey } from '../../../shared/features'

export type FAQCategory =
  | 'getting-started' | 'caseload-grid' | 'client-profiles'
  | 'dashboard-deadlines' | 'tasks' | 'contacts'
  | 'import-export' | 'snippets-templates'
  | 'security-backups' | 'tips-shortcuts'

export interface FAQItem {
  id: string
  question: string
  answer: string
  category: FAQCategory
  /** Only applies with this feature on; otherwise listed under "More features you can turn on" */
  feature?: FeatureKey
  tourStepIds?: string[]
  demo?: React.ReactNode
}

/** Labels contain {word} tokens; show them through useVocab().f */
export const CATEGORY_LABELS: Record<FAQCategory, string> = {
  'getting-started': 'Getting Started',
  'caseload-grid': '{List} grid',
  'client-profiles': '{Record} profiles',
  'dashboard-deadlines': 'Dashboard & Deadlines',
  'tasks': 'Tasks',
  'contacts': 'Contacts',
  'import-export': 'Import & Export',
  'snippets-templates': 'Snippets & Templates',
  'security-backups': 'Security & Backups',
  'tips-shortcuts': 'Tips & Shortcuts',
}

export const ALL_CATEGORIES: FAQCategory[] = Object.keys(CATEGORY_LABELS) as FAQCategory[]
