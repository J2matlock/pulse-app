/**
 * TourOverlay — Rich interactive tour shown after onboarding.
 * Highlights key UI areas with spotlight cutout, icons, and friendly descriptions.
 * Designed for non-tech-savvy users (care coordinators, social workers).
 *
 * Must be rendered INSIDE HashRouter and ALONGSIDE the main app layout
 * so that data-tour target elements exist in the DOM.
 *
 * Each step specifies a `route` — the tour navigates there before highlighting.
 */
import { DEBOUNCE_CELL_SAVE, DEBOUNCE_RESIZE } from '../../../shared/constants'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  LayoutDashboard,
  Table2,
  UserPlus,
  Search,
  Columns3,
  ClipboardList,
  BookUser,
  Settings,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  X,
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
  Sun,
  HelpCircle,
  UserCheck,
  Shield,
  CheckSquare,
  Archive,
} from 'lucide-react'
import { useGridStore } from '../../stores/gridStore'
import { useVocab } from '../../hooks/useVocab'

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
}

interface Props {
  onComplete: () => void
}

function getFirstRowId(): number | null {
  const rows = useGridStore.getState().rows
  const first = rows[0]
  return first ? first.row_id : null
}

export const STEPS: TourStep[] = [
  // ── Grid section (steps 1-12) ──
  {
    id: 'sidebar',
    target: '[data-tour="sidebar"]',
    title: 'Your navigation panel',
    subtitle: 'Everything starts here',
    description:
      'This sidebar is home base. All your {list:many} are listed at the bottom — click one to open it. Use the + button to create new {list:many} for different programs or groups.',
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
      'Each row is one {record}. Each column tracks a piece of information — names, dates, phone numbers, status, and more. Click any cell to edit it. Click the profile icon at the left edge of any row to open the full profile.',
    tip: 'Use arrow keys to move between cells. Press Enter or F2 to start editing. Press Escape to cancel.',
    icon: <Table2 className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'add-client',
    target: '[data-tour="add-client"]',
    title: 'Adding new {record:many}',
    subtitle: 'One click to add a row',
    description:
      'Click "Add {Record}" whenever you need to add to your {list}. A blank row appears — just start filling in the details.',
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
      'Need to track something new? Click "Add Column" to create columns for any type of information — text, dates, phone numbers, dropdowns, checkboxes, and more. You can rename, reorder, or hide columns at any time.',
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
      'Need to find someone fast? Start typing their name here to instantly filter your list. No need to scroll through hundreds of rows — just type a few letters.',
    tip: 'Press Ctrl+K from anywhere to open the full search palette, which can also navigate to other views.',
    icon: <Search className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'deadline-colors',
    target: '[data-tour="grid"]',
    title: 'Deadline alerts',
    subtitle: 'Never miss a due date again',
    description:
      'Any date column can become a deadline alert. Click the menu icon (⋯) on a date column header and choose "Deadline Alert" to set color-coded reminders — green when you have time, yellow as it approaches, orange when it\'s close, red when it\'s urgent, and pulsing red when overdue. Your dashboard uses these alerts to keep you on track.',
    icon: <Palette className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'right-click-rows',
    target: '[data-tour="grid"]',
    title: 'Right-click for more options',
    subtitle: 'Hidden power at your fingertips',
    description:
      'Right-click any row to see a context menu with quick actions: archive {a record}, duplicate the row, or move it to another {list}. You can also copy and paste cell values.',
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
      'Click the "Archived" button to toggle visibility of archived {record:many}. Archived {record:many} are hidden from your main view but not deleted — you can unarchive them at any time.',
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
      'Already tracking {record:many} in Excel or CSV? Click Import to bring that data in. The import wizard walks you through mapping your columns so everything lands in the right place.',
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
      'Need to share your {list}? Export as CSV for spreadsheets, PDF for printing, or make a summary report for your supervisor. You choose which columns to include.',
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
      'Use filters to narrow your view — show only {record:many} with a specific status, program, or date range. You can save filter combinations as presets to reuse them quickly.',
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
    title: '{Record} profiles',
    subtitle: 'Click the profile icon to see everything',
    description:
      'Every {record} has a dedicated profile page. Click the small profile icon at the left edge of any row to open it — you\'ll see the full details, notes, {activityLog}, deadlines, linked {contact:many}, and activity history all in one place. Let\'s take a look at what\'s inside a profile.',
    tip: 'Use the back arrow or breadcrumb to return to the grid after viewing a profile.',
    icon: <UserCheck className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'scratch-pad',
    target: '[data-tour="scratch-pad"]',
    title: 'Scratch pad',
    subtitle: 'Quick notes for each {record}',
    description:
      'Every {record} has a scratch pad for free-form notes. Use it for reminders, observations, or anything you want to remember. It supports rich text — bold, lists, and more.',
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
      'Every {record} gets a checklist for tracking action items — paperwork to file, referrals to make, forms to complete. Check items off as you go. You can use checklist templates to quickly add a standard set of items for new {record:many}.',
    icon: <CheckSquare className="w-6 h-6" />,
    position: 'right',
    get route() { const id = getFirstRowId(); return id ? `#/profile/${id}` : '#/grid' },
    skipIf: () => useGridStore.getState().rows.length === 0,
  },
  {
    id: 'case-log',
    target: '[data-tour="case-log"]',
    title: '{ActivityLog}',
    subtitle: 'Document every interaction',
    description:
      'Log phone calls, visits, emails, and notes with timestamps. Each entry is saved permanently so you have a complete record of your work with each {record}. Pin important entries to the top.',
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
      'The Dashboard shows what needs your attention right now — overdue deadlines in red, upcoming due dates this week, and completed tasks. Click any {record} name to jump straight to the profile.',
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
      'Switch between tabs to see different slices of your work: Priority List for what\'s most urgent, This Week and This Month for planning ahead, Completions to see your progress, and Recently Archived for {record:many} you\'ve closed.',
    icon: <LayoutDashboard className="w-6 h-6" />,
    position: 'bottom',
    route: '#/dashboard',
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
  },
  {
    id: 'tasks-area',
    target: '[data-tour="tasks-area"]',
    title: 'Create and manage tasks',
    subtitle: 'Due dates, priorities, and recurrence',
    description:
      'Click "Add Task" or press Ctrl+Shift+T to create a new task. Set a priority level (low, medium, high, urgent), assign a due date, and optionally make it recurring — daily, weekly, or monthly.',
    icon: <ClipboardList className="w-6 h-6" />,
    position: 'bottom',
    route: '#/tasks',
  },

  // ── Contacts section (steps 20-21) ──
  {
    id: 'contacts',
    target: '[data-tour="contacts"]',
    title: '{Contact} directory',
    subtitle: 'Your private contact book',
    description:
      'Build your own directory of {contact:many} — doctors, agencies, housing resources, legal aid. Track which {contact:many} are accepting new referrals, and link them to the {record:many} you\'ve referred.',
    tip: 'Press Ctrl+Shift+P from anywhere to jump straight to Contacts.',
    icon: <BookUser className="w-6 h-6" />,
    position: 'right',
    route: '#/contacts',
  },
  {
    id: 'add-provider',
    target: '[data-tour="add-provider"]',
    title: 'Add {contact:many}',
    subtitle: 'Track availability and referrals',
    description:
      'Click "Add {Contact}" to add a new contact. Track their availability status (Accepting, Waitlist, Full), referral process, phone numbers, and more. Link {contact:many} to {record:many} for easy reference.',
    icon: <UserCheck className="w-6 h-6" />,
    position: 'bottom',
    route: '#/contacts',
  },

  // ── Cross-cutting (steps 22-24) ──
  {
    id: 'theme-toggle',
    target: '[data-tour="theme-toggle"]',
    title: 'Light and dark mode',
    subtitle: 'Easy on the eyes',
    description:
      'Switch between light and dark themes to suit your preference and lighting. Dark mode is great for reducing eye strain during long sessions. Your choice is remembered between sessions.',
    icon: <Sun className="w-6 h-6" />,
    position: 'bottom',
    route: '#/grid',
  },
  {
    id: 'settings',
    target: '[data-tour="settings"]',
    title: 'Settings & help',
    subtitle: 'Make it yours',
    description:
      'Manage themes, backups, security, and data. Visit the Help Center anytime to search for answers, browse FAQs, or retake this tour.',
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
      'Click the Security tab to manage your password and auto-lock settings. This is where you change your password, set inactivity timeouts, and view your recovery key.',
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
      'Click the Backup tab to manage your backups. Create manual backups, restore from a previous backup, and configure backup reminders. Backups are encrypted with the same key as your database.',
    icon: <Shield className="w-6 h-6" />,
    position: 'right',
    route: '#/settings?tab=backup',
    skipIf: () => true, // mini-tour only
  },
]

/**
 * Compute tooltip positioning given target rect, preferred position, tooltip height,
 * and viewport dimensions. Shared between TourOverlay and MiniTour.
 */
export function computeTooltipPosition(
  rect: DOMRect | null,
  position: 'top' | 'bottom' | 'left' | 'right',
  tooltipHeight: number,
  viewport: { width: number; height: number },
  maxWidth: number = 420,
  padding: number = 16,
): React.CSSProperties {
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 10001,
    maxWidth,
    width: Math.min(maxWidth, viewport.width - 48),
  }

  if (!rect) {
    style.left = '50%'
    style.top = '50%'
    style.transform = 'translate(-50%, -50%)'
    return style
  }

  const effectiveHeight = tooltipHeight || 350
  const vh = viewport.height
  const vw = viewport.width

  switch (position) {
    case 'right': {
      const idealLeft = rect.right + padding
      const idealTop = rect.top
      style.left = Math.min(idealLeft, vw - maxWidth - 16)
      style.top = Math.max(16, Math.min(idealTop, vh - effectiveHeight - 16))
      break
    }
    case 'left': {
      style.right = Math.min(vw - rect.left + padding, vw - 40)
      style.top = Math.max(16, Math.min(rect.top, vh - effectiveHeight - 16))
      break
    }
    case 'bottom': {
      const idealTop = rect.bottom + padding
      if (idealTop + effectiveHeight > vh - 16) {
        style.bottom = vh - rect.top + padding
        if (rect.top - padding - effectiveHeight < 0) {
          style.bottom = undefined as unknown as number
          style.top = 16
        }
      } else {
        style.top = idealTop
      }
      style.left = Math.max(16, Math.min(rect.left, vw - maxWidth - 16))
      break
    }
    case 'top': {
      style.bottom = vh - rect.top + padding
      style.left = Math.max(16, Math.min(rect.left, vw - maxWidth - 16))
      break
    }
  }

  return style
}

export function TourOverlay({ onComplete }: Props): React.ReactElement {
  const { f } = useVocab(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [isAnimating, setIsAnimating] = useState(false)
  const [tooltipHeight, setTooltipHeight] = useState(350)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const prevStepRef = useRef(0)

  // Build filtered steps (skip steps whose skipIf returns true)
  const activeSteps = STEPS.filter(s => !s.skipIf || !s.skipIf())
  const step = activeSteps[stepIndex]

  // Navigate to the step's route if specified
  useEffect(() => {
    if (!step) return
    if (step.route && window.location.hash !== step.route) {
      window.location.hash = step.route
    }
  }, [step])

  // Find and measure the target element, with retry for route transitions
  const measureTarget = useCallback(() => {
    if (!step) return
    const el = document.querySelector(step.target)
    if (el) {
      setRect(el.getBoundingClientRect())
    } else {
      setRect(null)
    }
  }, [step])

  useEffect(() => {
    // Wait for route transition + DOM render, then measure
    const timers = [
      setTimeout(measureTarget, 100),
      setTimeout(measureTarget, DEBOUNCE_CELL_SAVE),
      setTimeout(() => {
        measureTarget()
        setIsAnimating(false)
      }, DEBOUNCE_RESIZE),
    ]
    window.addEventListener('resize', measureTarget)
    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', measureTarget)
    }
  }, [measureTarget])

  // Measure tooltip height after render for accurate positioning
  useEffect(() => {
    if (tooltipRef.current) {
      setTooltipHeight(tooltipRef.current.offsetHeight)
    }
  }, [stepIndex, isAnimating])

  function goTo(index: number) {
    setIsAnimating(true)
    prevStepRef.current = stepIndex
    setStepIndex(index)
  }

  function next() {
    if (stepIndex < activeSteps.length - 1) {
      goTo(stepIndex + 1)
    } else {
      // Navigate back to grid before completing
      window.location.hash = '#/grid'
      onComplete()
    }
  }

  function prev() {
    if (stepIndex > 0) {
      goTo(stepIndex - 1)
    }
  }

  // Handle keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.location.hash = '#/grid'
        onComplete()
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter') { next() }
      if (e.key === 'ArrowLeft') { prev() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  if (!step) return <></>

  const vh = window.innerHeight
  const vw = window.innerWidth

  const basePosition = computeTooltipPosition(rect, step.position, tooltipHeight, { width: vw, height: vh })
  const tooltipStyle: React.CSSProperties = {
    ...basePosition,
    transition: 'all 0.3s ease-out',
    opacity: isAnimating ? 0 : 1,
  }

  // Spotlight cutout
  const spotlightStyle: React.CSSProperties = rect
    ? {
        position: 'fixed',
        top: rect.top - 6,
        left: rect.left - 6,
        width: rect.width + 12,
        height: rect.height + 12,
        borderRadius: 10,
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
        zIndex: 10000,
        pointerEvents: 'none',
        transition: 'all 0.3s ease-out',
      }
    : {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 10000,
        pointerEvents: 'none',
      }

  // Pulsing ring around spotlight
  const pulseRingStyle: React.CSSProperties = rect
    ? {
        position: 'fixed',
        top: rect.top - 10,
        left: rect.left - 10,
        width: rect.width + 20,
        height: rect.height + 20,
        borderRadius: 12,
        border: '2px solid rgba(59, 130, 246, 0.5)',
        zIndex: 10000,
        pointerEvents: 'none',
        animation: 'tour-pulse 2s ease-in-out infinite',
        transition: 'all 0.3s ease-out',
      }
    : { display: 'none' }

  return (
    <>
      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes tour-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.02); }
        }
      `}</style>

      <div className="fixed inset-0 z-[9999]" onClick={next}>
        {/* Spotlight cutout */}
        <div style={spotlightStyle} />
        {/* Pulse ring */}
        <div style={pulseRingStyle} />

        {/* Tooltip card */}
        <div
          ref={tooltipRef}
          style={tooltipStyle}
          className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Header with icon and step counter */}
          <div className="bg-linear-to-r from-blue-600 to-blue-700 dark:from-blue-700 dark:to-blue-800 px-5 py-3 flex items-center gap-3">
            <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center text-white flex-shrink-0">
              {step.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white/70 text-sm font-medium">
                Step {stepIndex + 1} of {activeSteps.length}
              </div>
              <div className="text-white text-base font-bold leading-tight truncate">
                {f(step.title)}
              </div>
            </div>
            <button
              onClick={() => { window.location.hash = '#/grid'; onComplete() }}
              className="hit-44 w-8 h-8 flex items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
              title="Skip tour (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                {f(step.subtitle)}
              </span>
            </div>

            <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 mb-3">
              {f(step.description)}
            </p>

            {step.tip && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded-lg px-3 py-2 mb-3">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  <span className="font-semibold">Tip:</span> {f(step.tip)}
                </p>
              </div>
            )}

            {/* Step indicator — text for many steps */}
            <div className="flex justify-center mb-3">
              <span className="text-sm text-slate-500 dark:text-slate-400">
                Step {stepIndex + 1} of {activeSteps.length}
              </span>
            </div>

            {/* Navigation buttons */}
            <div className="flex items-center justify-between">
              <button
                onClick={prev}
                disabled={stepIndex === 0}
                className={`hit-44 flex items-center gap-1.5 px-3 py-2 text-base font-medium rounded-xl transition-colors ${
                  stepIndex === 0
                    ? 'text-slate-300 dark:text-slate-500 cursor-not-allowed'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => { window.location.hash = '#/grid'; onComplete() }}
                  className="hit-44 px-3 py-2 text-base text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                  Skip tour
                </button>
                <button
                  onClick={next}
                  className="hit-44 flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold rounded-xl transition-colors shadow-xs"
                >
                  {stepIndex < activeSteps.length - 1 ? (
                    <>Next <ArrowRight className="w-4 h-4" /></>
                  ) : (
                    <>Get started! <Sparkles className="w-4 h-4" /></>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
