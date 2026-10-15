import React from 'react'
import {
  LayoutDashboard,
  Table2,
  UserPlus,
  Search,
  Columns3,
  ClipboardList,
  BookUser,
  Settings,
  Palette,
  MousePointerClick,
  Upload,
  Download,
  Filter,
  Layers,
  RotateCcw,
  StickyNote,
  FileText,
  Clock,
  CalendarDays,
  HelpCircle,
  UserCheck,
  Shield,
  CheckSquare,
  Archive,
} from 'lucide-react'
import { useGridStore } from '../../stores/gridStore'
import { featureNow } from '../../hooks/useFeature'
import type { FeatureKey } from '../../../shared/features'

// The tour's steps: what each one points at, says, and which screen it opens

export interface TourStep {
  id: string
  target: string           // CSS selector for data-tour attribute
  title: string
  subtitle: string         // Short friendly tagline
  description: string      // Detailed explanation with real-world context
  tip?: string             // Optional "Pro tip" for keyboard shortcut etc.
  icon: React.ReactNode
  position: 'top' | 'bottom' | 'left' | 'right'
  route?: string           // Hash route to navigate to before showing this step
  skipIf?: () => boolean   // Skip step if condition is true
  feature?: FeatureKey     // Shown only while this feature is switched on
  /** The target is a column header: scroll it into view and light up the whole column (UX-A-03) */
  spotlight?: 'column'
}

/** The first-run tour: about seven steps, the core of the app (audit F-05) */
export const FIRST_RUN_TOUR = ['sidebar', 'add-client', 'deadline-colors', 'open-profile', 'dashboard', 'calendar', 'help']

/** Steps to play: switched-off features and steps that don't apply are left out */
export function tourSteps(steps: TourStep[]): TourStep[] {
  return steps.filter(s => (!s.feature || featureNow(s.feature)) && (!s.skipIf || !s.skipIf()))
}

function getFirstRowId(): number | null {
  const rows = useGridStore.getState().rows
  const first = rows[0]
  return first ? first.row_id : null
}

/** The first column with a deadline rule in the open list, if any */
export function firstRuleColumnId(): number | null {
  for (const c of useGridStore.getState().columns) {
    if (c.column_type === 'deadline') return c.id
    if (c.column_type !== 'date') continue
    try { if (JSON.parse(c.config || '{}').alert_rule_id) return c.id } catch { /* not a rule column */ }
  }
  return null
}

/** The header cell of that column (its width comes from a per-column CSS variable) */
export function ruleColumnTarget(): string {
  const id = firstRuleColumnId()
  return id === null ? '[data-tour="grid"]' : `[role="columnheader"][style*="--cw-${id})"]`
}

export const STEPS: TourStep[] = [
  // ── Grid section (steps 1-12) ──
  {
    id: 'sidebar',
    target: '[data-tour="sidebar"]',
    title: 'The sidebar',
    subtitle: 'Your way around Pulse',
    description:
      'All your {list:many} are listed here — click one to open it. Use the + button to create new {list:many} for different programs or groups. The pages below them are tools you can use with any {list}.',
    tip: 'Press Ctrl+\\ to collapse or expand this panel if you need more screen space.',
    icon: <LayoutDashboard className="w-6 h-6" />,
    position: 'right',
    route: '#/grid',
  },
  {
    id: 'new-caseload',
    target: '[data-tour="new-caseload"]',
    title: 'Create a new {list}',
    subtitle: 'Add as many as you need',
    description:
      'Click this + button to create a new {list}. You can have as many {list:many} as you need — for different programs, teams, or groups.',
    icon: <LayoutDashboard className="w-6 h-6" />,
    position: 'right',
    route: '#/grid',
  },
  {
    id: 'grid',
    target: '[data-tour="grid"]',
    title: 'Your {record} list',
    subtitle: 'Like a spreadsheet, but smarter',
    description:
      'Each line is one {record}. Each column tracks a piece of information — names, dates, phone numbers, status, and more. Click any cell to edit it. Click the small person icon at the left edge of any {record} to open that {record}\'s page.',
    tip: 'Use arrow keys to move between cells. Press Enter or F2 to start editing. Press Escape to cancel.',
    icon: <Table2 className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'add-client',
    target: '[data-tour="add-client"]',
    title: 'Adding new {record:many}',
    subtitle: 'One click to add {a record}',
    description:
      'Click "Add {Record}" whenever you need to add to your {list}. A blank line appears — just start filling in the details.',
    icon: <UserPlus className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'add-column',
    target: '[data-tour="add-column"]',
    title: 'Customize your columns',
    subtitle: 'Track exactly what you need',
    description:
      'Need to track something new? Click "More" and then "Add a column…" to create columns for any type of information — text, dates, phone numbers, dropdowns, checkboxes, and more. You can rename, reorder, or hide columns at any time.',
    icon: <Columns3 className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'search',
    target: '[data-tour="search"]',
    title: 'Find any {record} instantly',
    subtitle: 'Search as you type',
    description:
      'Looking for one {record}? Start typing its name here to filter your {list} as you type. No need to scroll through hundreds of {record:many} — just type a few letters.',
    tip: 'Press Ctrl+K from anywhere to open a search box that can also open any page.',
    icon: <Search className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'deadline-colors',
    // The first column with a rule, scrolled into view and lit up, so the colours the step
    // talks about are on screen (UX-A-03, UX-A-10); the whole list when there is none
    get target() { return ruleColumnTarget() },
    spotlight: 'column',
    title: 'Deadline colors',
    subtitle: 'Never miss a due date again',
    get description() {
      const colors = 'A date column with a deadline rule changes color as each date comes due: green when there\'s time, yellow as it gets close, orange, then red, and pulsing red when it\'s overdue.'
      const how = 'To give a date column a rule, open its menu (⋯) and pick one under "Deadline rule". The dashboard uses the same colors.'
      return firstRuleColumnId() !== null
        ? `${colors} This column has a rule — the colors you see are its dates coming due. ${how}`
        : `${colors} None of your date columns has a rule yet. ${how}`
    },
    icon: <Palette className="w-6 h-6" />,
    // Beside the lit-up column, which runs the height of the list
    get position() { return firstRuleColumnId() !== null ? 'right' as const : 'bottom' as const },
    route: '#/grid',
  },
  {
    id: 'right-click-rows',
    target: '[data-tour="grid"]',
    title: 'Right-click for more options',
    subtitle: 'Archive, duplicate, move',
    description:
      'Right-click any {record} for quick actions: archive it, duplicate it, or move it to another {list}. The same actions are on each {record}\'s page under More. You can also copy and paste cell values.',
    icon: <MousePointerClick className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'archived-toggle',
    target: '[data-tour="archived-toggle"]',
    title: 'Show archived {record:many}',
    subtitle: 'Hidden but not forgotten',
    description:
      'Open "Show" and choose "Show archived {record:many}" to see them. Archived {record:many} are hidden from your {list} but not deleted — you can unarchive them at any time.',
    icon: <Archive className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'import-btn',
    target: '[data-tour="import-btn"]',
    title: 'Import your existing data',
    subtitle: 'Bring in your spreadsheets',
    description:
      'Already tracking {record:many} in Excel or CSV? Click "More" and then "Import from CSV or Excel…" to bring that data in. The import wizard walks you through mapping your columns so everything lands in the right place.',
    icon: <Upload className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'export-btn',
    target: '[data-tour="export-btn"]',
    title: 'Export your data',
    subtitle: 'CSV, PDF, and summary reports',
    description:
      'Need to share your {list}? Export as CSV for spreadsheets, PDF for printing, or make a summary report to share. You choose which columns to include.',
    icon: <Download className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'filter-controls',
    target: '[data-tour="filter-controls"]',
    title: 'Filter your {list}',
    subtitle: 'See only what matters right now',
    description:
      'Use filters to narrow your view — show only {record:many} with a specific status, program, or date range. You can keep a filter you use often as a saved filter.',
    icon: <Filter className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'grouping-btn',
    target: '[data-tour="grouping-btn"]',
    title: 'Group by column',
    subtitle: 'Organize {record:many} into sections',
    description:
      'Group your {list} by any column — like status, program, or assigned worker — to see {record:many} organized into collapsible sections. Great for team meetings and {list} reviews.',
    icon: <Layers className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'undo-redo',
    target: '[data-tour="undo-redo"]',
    title: 'Undo and redo',
    subtitle: 'Every change is reversible',
    description:
      'Made a mistake? Click Undo to reverse your last change, or use the dropdown arrow to see your full action history. You can undo multiple steps at once by jumping to any point in your history.',
    tip: 'Ctrl+Z to undo, Ctrl+Y to redo — works anywhere in the app.',
    icon: <RotateCcw className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },

  // ── Profile section ──
  {
    id: 'open-profile',
    target: '[data-tour="profile-icon"]',
    title: 'Each {record}\'s page',
    subtitle: 'The small icon beside each name',
    description:
      'Every {record} has a page of its own: the full details, scratch notes, {activityLog}, deadlines and linked {contact:many}, all in one place. Click the small icon at the left edge of {a record} to open its page, any time you want to see everything about it.',
    tip: 'Use the back arrow or breadcrumb to return to the {list} after viewing {a record}.',
    icon: <UserCheck className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'scratch-pad',
    target: '[data-tour="scratch-pad"]',
    title: 'Scratch notes',
    subtitle: 'Quick scratch notes for each {record}',
    description:
      'Every {record} has scratch notes, a free-form space for reminders, observations, or anything you want to remember. It supports rich text — bold, lists, and more.',
    icon: <StickyNote className="w-6 h-6" />,
    position: 'right',
    get route() { const id = getFirstRowId(); return id ? `#/profile/${id}` : '#/grid' },
    skipIf: () => useGridStore.getState().rows.length === 0,
  },
  {
    id: 'checklist',
    target: '[data-tour="checklist"]',
    title: 'Checklist',
    subtitle: 'Track steps and to-dos per {record}',
    description:
      'Every {record} gets a checklist for tracking action items — steps to finish, forms to complete, things to order. Check items off as you go. You can use checklist templates to quickly add a standard set of items for new {record:many}.',
    icon: <CheckSquare className="w-6 h-6" />,
    position: 'right',
    get route() { const id = getFirstRowId(); return id ? `#/profile/${id}` : '#/grid' },
    skipIf: () => useGridStore.getState().rows.length === 0,
    feature: 'checklists',
  },
  {
    id: 'case-log',
    target: '[data-tour="case-log"]',
    title: '{ActivityLog}',
    subtitle: 'Document every interaction',
    description:
      'Write down calls, visits and anything else that happened, with the date. Each entry is kept so you have a complete record of your work with each {record}. Pin important entries to the top.',
    icon: <FileText className="w-6 h-6" />,
    position: 'left',
    get route() { const id = getFirstRowId(); return id ? `#/profile/${id}` : '#/grid' },
    skipIf: () => useGridStore.getState().rows.length === 0,
  },
  {
    id: 'deadline-panel',
    target: '[data-tour="deadline-panel"]',
    title: 'Deadline countdown',
    subtitle: 'Color-coded due dates for this {record}',
    description:
      'See all upcoming deadlines for this {record} in one place, color-coded by urgency. Click any date to update it. This panel pulls from all your date columns automatically.',
    icon: <Clock className="w-6 h-6" />,
    position: 'left',
    get route() { const id = getFirstRowId(); return id ? `#/profile/${id}` : '#/grid' },
    skipIf: () => useGridStore.getState().rows.length === 0,
  },
  // Return to grid after profile section — invisible navigation step handled in component

  // ── Dashboard section (steps 16-17) ──
  {
    id: 'dashboard',
    target: '[data-tour="dashboard"]',
    title: 'Your daily overview',
    subtitle: 'Start each day here',
    description:
      'The Dashboard shows what needs your attention right now — overdue deadlines in red, upcoming due dates this week, and completed tasks. Click any {record} name to open that {record}\'s page.',
    icon: <LayoutDashboard className="w-6 h-6" />,
    position: 'right',
    route: '#/dashboard',
  },
  {
    id: 'dashboard-tabs',
    target: '[data-tour="dashboard-tabs"]',
    title: 'Dashboard views',
    subtitle: 'Multiple ways to see your workload',
    description:
      'Switch between tabs to see different slices of your work: What\'s due for the most urgent, Overdue, and This week and This month for planning ahead. Recently archived {record:many} are a link beside the tabs.',
    icon: <LayoutDashboard className="w-6 h-6" />,
    position: 'bottom',
    route: '#/dashboard',
  },
  {
    id: 'calendar',
    target: '[data-tour="calendar"]',
    title: 'Calendar',
    subtitle: 'Everything that\'s due, by day',
    description:
      'The calendar shows every deadline by day, week or month, so you can see a busy week coming. Click a day to see what\'s due and open any {record} from there.',
    icon: <CalendarDays className="w-6 h-6" />,
    position: 'right',
    route: '#/calendar',
  },

  // ── Tasks section (steps 18-19) ──
  {
    id: 'tasks',
    target: '[data-tour="tasks"]',
    title: 'Your to-do list',
    subtitle: 'Track follow-ups and recurring tasks',
    description:
      'Tasks lets you manage work that isn\'t tied to one specific {record} — like "Submit monthly report" or "Schedule team meeting." Set due dates, priorities, and recurring schedules so nothing slips through the cracks.',
    icon: <ClipboardList className="w-6 h-6" />,
    position: 'right',
    route: '#/tasks',
    feature: 'tasks',
  },
  {
    id: 'tasks-area',
    target: '[data-tour="tasks-area"]',
    title: 'Create and manage tasks',
    subtitle: 'Due dates, priorities, and recurrence',
    description:
      'Click "+ Add task" or press Ctrl+Shift+T to create a new task. Set a priority level (low, medium, high, urgent), assign a due date, and optionally make it recurring — daily, weekly, or monthly.',
    icon: <ClipboardList className="w-6 h-6" />,
    position: 'bottom',
    route: '#/tasks',
    feature: 'tasks',
  },

  // ── Contacts section (steps 20-21) ──
  {
    id: 'contacts',
    target: '[data-tour="contacts"]',
    title: '{Contact} directory',
    subtitle: 'Your private contact book',
    description:
      'Build your own directory of {contact:many} — the people and places you work with. Keep their details in one place and link them to the {record:many} they help with.',
    tip: 'Press Ctrl+Shift+P from anywhere to jump straight to {contactDirectory}.',
    icon: <BookUser className="w-6 h-6" />,
    position: 'right',
    route: '#/contacts',
    feature: 'contactsDirectory',
  },
  {
    id: 'add-provider',
    target: '[data-tour="add-provider"]',
    title: 'Add {contact:many}',
    subtitle: 'Phone numbers, availability and more',
    description:
      'Click "Add {Contact}" to add someone new. Keep their phone numbers, whether they\'re available, how to reach them, and more. Link {contact:many} to {record:many} for easy reference.',
    icon: <UserCheck className="w-6 h-6" />,
    position: 'bottom',
    route: '#/contacts',
    feature: 'contactsDirectory',
  },

  // ── Cross-cutting ──
  {
    id: 'settings',
    target: '[data-tour="settings"]',
    title: 'Settings',
    subtitle: 'Make it yours',
    description:
      'Light or dark mode (under Appearance), backups, security, the words and features Pulse uses, and your data.',
    tip: 'Press ? at any time to see all keyboard shortcuts.',
    icon: <Settings className="w-6 h-6" />,
    position: 'right',
  },
  {
    id: 'help',
    target: '[data-tour="help"]',
    title: 'Help Center',
    subtitle: 'Answers are always nearby',
    description:
      'Have a question? The Help Center has searchable answers for everything Pulse can do. Browse by category, search by keyword, or click "Show me" to get a quick mini-tour of any feature.',
    icon: <HelpCircle className="w-6 h-6" />,
    position: 'right',
  },

  // ── Mini-tour-only steps (excluded from main tour via skipIf) ──
  // These are referenced by FAQ "Show me" buttons for multi-step walkthroughs.
  {
    id: 'settings-security-tab',
    target: '[data-tour="settings-security-tab"]',
    title: 'Security tab',
    subtitle: 'Password, auto-lock, and more',
    description:
      'Click the Security tab to manage your password and auto-lock settings. This is where you change your password, choose how soon Pulse locks itself, and view your recovery key.',
    icon: <Shield className="w-6 h-6" />,
    position: 'right',
    route: '#/settings?tab=security',
    skipIf: () => true, // mini-tour only
  },
  {
    id: 'settings-change-password',
    target: '[data-tour="settings-change-password"]',
    title: 'Change your password',
    subtitle: 'Enter current, then new',
    description:
      'Click "Change…" to expand the password form. Enter your current password, then type your new password twice. Your data stays the same — only the encryption wrapper changes. Your recovery key remains valid.',
    icon: <Shield className="w-6 h-6" />,
    position: 'right',
    route: '#/settings?tab=security',
    skipIf: () => true, // mini-tour only
  },
  {
    id: 'settings-backup-tab',
    target: '[data-tour="settings-backup-tab"]',
    title: 'Backup tab',
    subtitle: 'Keep your data safe',
    description:
      'Click the Backup tab to manage your backups. Create manual backups, restore from a previous backup, and choose when to be reminded to back up. Backups are encrypted with the same key as your database.',
    icon: <Shield className="w-6 h-6" />,
    position: 'right',
    route: '#/settings?tab=backup',
    skipIf: () => true, // mini-tour only
  },
]
