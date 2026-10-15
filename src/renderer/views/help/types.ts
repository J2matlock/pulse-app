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
  /** Other ways people say it ("contacts per month"); searched like the question (E-06) */
  keywords?: string[]
  tourStepIds?: string[]
  demo?: React.ReactNode
}

/** Labels contain {word} tokens; show them through useVocab().f */
/** Grouped by the job people came to do (audit N-22) */
export const CATEGORY_LABELS: Record<FAQCategory, string> = {
  'getting-started': 'Getting started',
  'caseload-grid': 'Set up my {list:many}',
  'client-profiles': 'Write {activity:many} and keep details',
  'dashboard-deadlines': 'Track deadlines and schedule',
  'tasks': 'Tasks and to-dos',
  'contacts': '{ContactDirectory}',
  'import-export': 'Reports, printing and sharing',
  'snippets-templates': 'Letters and templates',
  'security-backups': 'Keep my data safe',
  'tips-shortcuts': 'Tips and shortcuts',
}

export const ALL_CATEGORIES: FAQCategory[] = Object.keys(CATEGORY_LABELS) as FAQCategory[]
