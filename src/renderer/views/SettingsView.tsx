import React, { useEffect, useState } from 'react'
import {
  Monitor, Shield, Database,
  HardDrive, Info, User,
  Bell, Keyboard, FileText, NotebookPen,
  ToggleLeft,
} from 'lucide-react'
import { NotesSection } from '../components/settings/NotesSection'
import { useShallow } from 'zustand/react/shallow'
import { useSettingsStore } from '../stores/settingsStore'
import { IPC } from '../../shared/ipc-channels'
import type { Theme } from '../../shared/types'
import { safeInvoke } from '../utils/safeInvoke'
import toast from 'react-hot-toast'

import { ViewBreadcrumb } from '../components/shared/ViewBreadcrumb'
import { ProfileSection } from '../components/settings/ProfileSection'
import { AppearanceSection } from '../components/settings/AppearanceSection'
import { SecuritySection } from '../components/settings/SecuritySection'
import { BackupSection } from '../components/settings/BackupSection'
import { DataSection } from '../components/settings/DataSection'
import { AlertsSection } from '../components/settings/AlertsSection'
import { ShortcutsSection } from '../components/settings/ShortcutsSection'
import { SnippetsSection } from '../components/settings/SnippetsSection'
import { AboutSection } from '../components/settings/AboutSection'
import { useVocab } from '../hooks/useVocab'
import { useFeature } from '../hooks/useFeature'
import { WorkspaceSection } from '../components/settings/WorkspaceSection'

type Section = 'workspace' | 'profile' | 'appearance' | 'security' | 'backup' | 'data' | 'alerts' | 'notes' | 'shortcuts' | 'snippets' | 'about'

export default function SettingsView(): React.ReactElement {
  const { t } = useVocab(null)
  const {
    theme, setTheme,
    uiScale, setUiScale,
    gridDensity, setGridDensity,
    sidebarWidth, setSidebarWidth,
    rowStriping, setRowStriping,
    gridLines, setGridLines,
    reducedMotion, setReducedMotion,
    highContrast, setHighContrast,
    clockFormat, setClockFormat,
    weekStart, setWeekStart,
  } = useSettingsStore(useShallow(s => ({
    theme: s.theme, setTheme: s.setTheme,
    uiScale: s.uiScale, setUiScale: s.setUiScale,
    gridDensity: s.gridDensity, setGridDensity: s.setGridDensity,
    sidebarWidth: s.sidebarWidth, setSidebarWidth: s.setSidebarWidth,
    rowStriping: s.rowStriping, setRowStriping: s.setRowStriping,
    gridLines: s.gridLines, setGridLines: s.setGridLines,
    reducedMotion: s.reducedMotion, setReducedMotion: s.setReducedMotion,
    highContrast: s.highContrast, setHighContrast: s.setHighContrast,
    clockFormat: s.clockFormat, setClockFormat: s.setClockFormat,
    weekStart: s.weekStart, setWeekStart: s.setWeekStart,
  })))

  // Support ?tab=security (etc.) from tour/deep links
  const rawHash = window.location.hash
  const hashQIndex = rawHash.indexOf('?')
  const hashSearch = hashQIndex >= 0 ? rawHash.slice(hashQIndex) : ''
  const tabParam = new URLSearchParams(hashSearch).get('tab') as Section | null

  const [activeSection, setActiveSection] = useState<Section>(tabParam || 'appearance')

  useEffect(() => {
    if (tabParam && tabParam !== activeSection) {
      setActiveSection(tabParam)
    }
  }, [tabParam]) // eslint-disable-line react-hooks/exhaustive-deps -- only sync from URL param to local state; activeSection is the controlled value, not a dependency

  const [dateFormat, setDateFormatState] = useState('us')
  const [profileName, setProfileName] = useState('')
  const [profileTitle, setProfileTitle] = useState('')
  const [profileEmail, setProfileEmail] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [profileOrg, setProfileOrg] = useState('')

  // Load persisted settings on mount
  useEffect(() => {
    async function loadSettings() {
      const res = await safeInvoke<Record<string, string>>(IPC.SETTINGS_GET_ALL)
      if (res.ok) {
        if (res.data.date_format) setDateFormatState(res.data.date_format)
        if (res.data.profile_name) setProfileName(res.data.profile_name)
        if (res.data.profile_title) setProfileTitle(res.data.profile_title)
        if (res.data.profile_email) setProfileEmail(res.data.profile_email)
        if (res.data.profile_phone) setProfilePhone(res.data.profile_phone)
        if (res.data.profile_org) setProfileOrg(res.data.profile_org)
      }
    }
    loadSettings()
  }, [])

  async function saveSetting(key: string, value: string) {
    try {
      const res = await safeInvoke<boolean>(IPC.SETTINGS_UPDATE, key, value)
      if (!res.ok) toast.error('Failed to save setting.')
    } catch { toast.error('Failed to save setting.') }
  }

  async function handleThemeChange(newTheme: Theme) {
    setTheme(newTheme)
    await saveSetting('theme', newTheme)
  }

  const showSnippets = useFeature('snippets')
  const navItems: Array<{ id: Section; label: string; desc: string; icon: React.ElementType }> = ([
    { id: 'workspace', label: 'Workspace', desc: 'Words, features and ready-made examples', icon: ToggleLeft },
    { id: 'profile', label: 'Profile', desc: 'Your name, title, and contact info', icon: User },
    { id: 'appearance', label: 'Appearance', desc: 'Theme, font size, and display options', icon: Monitor },
    { id: 'security', label: 'Security', desc: 'Password and encryption settings', icon: Shield },
    { id: 'backup', label: 'Backup', desc: 'Automatic and manual backup configuration', icon: HardDrive },
    { id: 'data', label: 'Data', desc: 'Import, export, and data management', icon: Database },
    { id: 'alerts', label: 'Alerts', desc: 'Deadline alert rules and notifications', icon: Bell },
    { id: 'notes', label: t('activity', { many: true, cap: true }), desc: 'Kinds, time, mileage, and formats', icon: NotebookPen },
    { id: 'shortcuts', label: 'Shortcuts', desc: 'Keyboard shortcut reference', icon: Keyboard },
    { id: 'snippets', label: 'Snippets', desc: 'Text expansion shortcuts', icon: FileText },
    { id: 'about', label: 'About', desc: 'Version info and credits', icon: Info },
  ] as Array<{ id: Section; label: string; desc: string; icon: React.ElementType }>).filter(item => item.id !== 'snippets' || showSnippets)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0"
        style={{ minHeight: 48 }}
      >
        <ViewBreadcrumb items={[{ label: 'Home', to: '/grid' }, { label: 'Settings' }]} />
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar nav */}
        <nav aria-label="Settings tabs" className="w-56 flex-shrink-0 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 py-4" role="tablist" aria-orientation="vertical">
          {navItems.map(item => (
            <button
              key={item.id}
              role="tab"
              id={`settings-tab-${item.id}`}
              aria-selected={activeSection === item.id}
              aria-controls={`settings-panel-${item.id}`}
              onClick={() => setActiveSection(item.id)}
              className={`flex items-start gap-3 w-full px-4 py-2 text-left transition-colors
                hover:bg-slate-200 dark:hover:bg-slate-700
                focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                ${activeSection === item.id
                  ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-slate-700 dark:text-slate-300'}`}
              style={{ minHeight: 44 }}
              {...(item.id === 'security' ? { 'data-tour': 'settings-security-tab' } : item.id === 'backup' ? { 'data-tour': 'settings-backup-tab' } : {})}
            >
              <item.icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-base">{item.label}</span>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-normal">{item.desc}</p>
              </div>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div
          role="tabpanel"
          id={`settings-panel-${activeSection}`}
          aria-labelledby={`settings-tab-${activeSection}`}
          tabIndex={0}
          className="flex-1 overflow-y-auto focus:outline-hidden"
        >
          <div className="max-w-xl mx-auto px-8 py-8 space-y-8">

            {activeSection === 'profile' && (
              <ProfileSection
                profileName={profileName} setProfileName={setProfileName}
                profileTitle={profileTitle} setProfileTitle={setProfileTitle}
                profileOrg={profileOrg} setProfileOrg={setProfileOrg}
                profileEmail={profileEmail} setProfileEmail={setProfileEmail}
                profilePhone={profilePhone} setProfilePhone={setProfilePhone}
                saveSetting={saveSetting}
              />
            )}

            {activeSection === 'appearance' && (
              <AppearanceSection
                theme={theme} handleThemeChange={handleThemeChange}
                uiScale={uiScale} setUiScale={setUiScale}
                gridDensity={gridDensity} setGridDensity={setGridDensity}
                rowStriping={rowStriping} setRowStriping={setRowStriping}
                gridLines={gridLines} setGridLines={setGridLines}
                sidebarWidth={sidebarWidth} setSidebarWidth={setSidebarWidth}
                dateFormat={dateFormat} setDateFormatState={setDateFormatState}
                clockFormat={clockFormat} setClockFormat={setClockFormat}
                weekStart={weekStart} setWeekStart={setWeekStart}
                reducedMotion={reducedMotion} setReducedMotion={setReducedMotion}
                highContrast={highContrast} setHighContrast={setHighContrast}
                saveSetting={saveSetting}
              />
            )}

            {activeSection === 'security' && (
              <SecuritySection saveSetting={saveSetting} onGoToSection={setActiveSection} />
            )}

            {activeSection === 'backup' && (
              <BackupSection saveSetting={saveSetting} onGoToSection={setActiveSection} />
            )}

            {activeSection === 'data' && (
              <DataSection />
            )}

            {activeSection === 'alerts' && <AlertsSection />}
            {activeSection === 'notes' && <NotesSection />}

            {activeSection === 'shortcuts' && <ShortcutsSection />}

            {activeSection === 'workspace' && <WorkspaceSection />}
            {activeSection === 'snippets' && showSnippets && <SnippetsSection />}


            {activeSection === 'about' && <AboutSection />}

          </div>
        </div>
      </div>
    </div>
  )
}
