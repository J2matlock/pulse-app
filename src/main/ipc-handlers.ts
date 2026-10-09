/**
 * ipc-handlers.ts — Thin orchestrator. Registers all IPC channel handlers
 * by delegating to domain-specific modules in src/main/ipc/.
 * Called once at app startup after DB is initialized.
 */

import { registerAuthHandlers } from './ipc/ipc-auth'
import { registerSettingsHandlers } from './ipc/ipc-settings'
import { registerWorkspaceHandlers } from './ipc/ipc-workspace'
import { registerStarterHandlers } from './ipc/ipc-starters'
import { registerAppHandlers } from './ipc/ipc-app'
import { registerOnboardingHandlers } from './ipc/ipc-onboarding'
import { registerFileAssocHandlers } from './ipc/ipc-file-assoc'
import { registerGridHandlers } from './ipc/ipc-grid'
import { registerRowHandlers } from './ipc/ipc-row'
import { registerCellHandlers } from './ipc/ipc-cell'
import { registerDashboardHandlers } from './ipc/ipc-dashboard'
import { registerCaseLogHandlers } from './ipc/ipc-caselog'
import { registerActivityTypeHandlers } from './ipc/ipc-activity-types'
import { registerMeasureHandlers } from './ipc/ipc-measures'
import { registerDeadlineHandlers } from './ipc/ipc-deadlines'
import { registerReminderHandlers } from './ipc/ipc-reminders'
import { registerBackgroundHandlers } from './ipc/ipc-background'
import { registerLinkHandlers } from './ipc/ipc-links'
import { registerStageHandlers } from './ipc/ipc-stages'
import { registerAppointmentHandlers } from './ipc/ipc-appointments'
import { registerFormHandlers } from './ipc/ipc-forms'
import { registerAttachmentHandlers } from './ipc/ipc-attachments'
import { registerReportHandlers } from './ipc/ipc-reports'
import { registerComplianceHandlers } from './ipc/ipc-compliance'
import { registerAlertHandlers } from './ipc/ipc-alerts'
import { registerSavedFilterHandlers } from './ipc/ipc-saved-filters'
import { registerSavedViewHandlers } from './ipc/ipc-saved-views'
import { registerTagHandlers } from './ipc/ipc-tags'
import { registerChecklistHandlers } from './ipc/ipc-checklists'
import { registerAcuityHandlers } from './ipc/ipc-acuity'
import { registerTaskHandlers } from './ipc/ipc-tasks'
import { registerExportHandlers } from './ipc/ipc-export'
import { registerContactHandlers } from './ipc/ipc-contacts'

export function registerIpcHandlers(): void {
  registerAuthHandlers()
  registerSettingsHandlers()
  registerWorkspaceHandlers()
  registerStarterHandlers()
  registerAppHandlers()
  registerOnboardingHandlers()
  registerFileAssocHandlers()
  registerGridHandlers()
  registerRowHandlers()
  registerCellHandlers()
  registerDashboardHandlers()
  registerCaseLogHandlers()
  registerActivityTypeHandlers()
  registerMeasureHandlers()
  registerDeadlineHandlers()
  registerReminderHandlers()
  registerBackgroundHandlers()
  registerLinkHandlers()
  registerStageHandlers()
  registerAppointmentHandlers()
  registerFormHandlers()
  registerAttachmentHandlers()
  registerReportHandlers()
  registerComplianceHandlers()
  registerAlertHandlers()
  registerSavedFilterHandlers()
  registerSavedViewHandlers()
  registerTagHandlers()
  registerChecklistHandlers()
  registerAcuityHandlers()
  registerTaskHandlers()
  registerExportHandlers()
  registerContactHandlers()
}
