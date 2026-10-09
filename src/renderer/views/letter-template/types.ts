export type { LetterTemplate } from '../../../shared/types'

export const AVAILABLE_PLACEHOLDERS = [
  { key: '{{client_name}}', desc: 'Full name of the {record}' },
  { key: '{{today_date}}', desc: "Today's date" },
  { key: '{{dob}}', desc: 'Date of birth' },
  { key: '{{age}}', desc: 'Current age' },
  { key: '{{case_manager_name}}', desc: 'Your name (from Settings \u2192 Profile)' },
  { key: '{{case_manager_title}}', desc: 'Your title (from Settings \u2192 Profile)' },
  { key: '{{case_manager_email}}', desc: 'Your email (from Settings \u2192 Profile)' },
  { key: '{{case_manager_phone}}', desc: 'Your phone (from Settings \u2192 Profile)' },
  { key: '{{case_manager_org}}', desc: 'Your organization (from Settings \u2192 Profile)' },
  { key: '{{medicaid_cin}}', desc: 'Medicaid CIN' },
]
