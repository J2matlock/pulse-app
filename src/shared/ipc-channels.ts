export const IPC = {
  // Grid
  GRID_GET_ALL: 'grid:get-all',
  GRID_GET: 'grid:get',
  GRID_GET_FULL: 'grid:get-full',
  GRID_CREATE: 'grid:create',
  GRID_UPDATE: 'grid:update',
  GRID_DELETE: 'grid:delete',
  GRID_REORDER: 'grid:reorder',

  // Columns
  COLUMN_CREATE: 'column:create',
  COLUMN_UPDATE: 'column:update',
  COLUMN_BATCH_UPDATE_VISIBILITY: 'column:batch-update-visibility',
  COLUMN_BATCH_UPDATE_WIDTHS: 'column:batch-update-widths',
  COLUMN_DELETE: 'column:delete',
  COLUMN_REORDER: 'column:reorder',
  COLUMN_NUMBER_EXISTING: 'column:number-existing',

  // Rows
  ROW_CREATE: 'row:create',
  ROW_UPDATE: 'row:update',
  ROW_DELETE: 'row:delete',
  ROW_ARCHIVE: 'row:archive',
  ROW_UNARCHIVE: 'row:unarchive',
  ROW_REORDER: 'row:reorder',
  ROW_DUPLICATE: 'row:duplicate',
  ROW_BULK_ACTION: 'row:bulk-action',
  ROW_HARD_DELETE: 'row:hard-delete',
  ROW_RESTORE_DELETED: 'row:restore-deleted',
  ROW_PURGE: 'row:purge',
  ROW_GET_DELETED: 'row:get-deleted',
  ROW_GET: 'row:get',
  ROW_MOVE_TO_GRID: 'row:move-to-grid',
  ROW_COPY_TO_GRID: 'row:copy-to-grid',
  ROW_GET_MANUAL_CONTACTS: 'row:get-manual-contacts',
  ROW_SET_MANUAL_CONTACTS: 'row:set-manual-contacts',

  // Cells
  CELL_UPDATE: 'cell:update',
  CELL_GET_HISTORY: 'cell:get-history',
  CELL_FORMAT_GET_FOR_GRID: 'cell-format:get-for-grid',
  CELL_FORMAT_SET: 'cell-format:set',
  CELL_FORMAT_BATCH_SET: 'cell-format:batch-set',

  // Sort & Filter
  SORT_UPDATE: 'sort:update',
  SORT_CLEAR: 'sort:clear',
  SAVED_FILTER_GET_ALL: 'saved-filter:get-all',
  SAVED_FILTER_CREATE: 'saved-filter:create',
  SAVED_FILTER_DELETE: 'saved-filter:delete',
  SAVED_VIEW_GET_ALL: 'saved-view:get-all',
  SAVED_VIEW_CREATE: 'saved-view:create',
  SAVED_VIEW_UPDATE: 'saved-view:update',
  SAVED_VIEW_DELETE: 'saved-view:delete',

  // Alerts
  ALERT_RULE_GET_ALL: 'alert-rule:get-all',
  ALERT_RULE_CREATE: 'alert-rule:create',
  ALERT_RULE_UPDATE: 'alert-rule:update',
  ALERT_RULE_DELETE: 'alert-rule:delete',

  // Checklists
  CHECKLIST_GET: 'checklist:get',
  CHECKLIST_CREATE_ITEM: 'checklist:create-item',
  CHECKLIST_UPDATE_ITEM: 'checklist:update-item',
  CHECKLIST_DELETE_ITEM: 'checklist:delete-item',
  CHECKLIST_APPLY_TEMPLATE: 'checklist:apply-template',
  CHECKLIST_REORDER: 'checklist:reorder',
  CHECKLIST_GET_URGENT: 'checklist:get-urgent',
  CHECKLIST_RESET_CYCLE: 'checklist:reset-cycle',
  CHECKLIST_RESTORE_ITEM: 'checklist:restore-item',
  CHECKLIST_GET_DUE: 'checklist:get-due',

  // Checklist Groups
  CHECKLIST_GROUP_GET_ALL: 'checklist:group-get-all',
  CHECKLIST_GROUP_CREATE: 'checklist:group-create',
  CHECKLIST_GROUP_UPDATE: 'checklist:group-update',
  CHECKLIST_GROUP_DELETE: 'checklist:group-delete',
  CHECKLIST_GROUP_REORDER: 'checklist:group-reorder',
  CHECKLIST_MOVE_ITEM_TO_GROUP: 'checklist:move-item-group',

  // Case Log
  CASE_LOG_GET: 'case-log:get',
  CASE_LOG_CREATE: 'case-log:create',
  CASE_LOG_UPDATE: 'case-log:update',
  CASE_LOG_DELETE: 'case-log:delete',
  CASE_LOG_TOGGLE_PIN: 'case-log:toggle-pin',
  CASE_LOG_COMPLETE_FOLLOWUP: 'case-log:complete-followup',
  CASE_LOG_UNCOMPLETE_FOLLOWUP: 'case-log:uncomplete-followup',
  CASE_LOG_VOID: 'case-log:void',
  CASE_LOG_UNVOID: 'case-log:unvoid',
  CASE_LOG_RESTORE: 'case-log:restore',
  CASE_LOG_GET_EDITS: 'case-log:get-edits',
  CASE_LOG_SET_MEASURES: 'case-log:set-measures',
  MENU_COMMAND: 'menu:command', // push: main → renderer, arg: 'undo' | 'redo' (macOS menu bar)
  CASE_LOG_CHANGED: 'case-log:changed', // push: main → renderer, arg: rowId

  // Scrap Notes
  SCRAP_NOTE_GET: 'scrap-note:get',
  SCRAP_NOTE_UPDATE: 'scrap-note:update',
  GLOBAL_NOTE_GET: 'global-note:get',
  GLOBAL_NOTE_UPDATE: 'global-note:update',


  // Tags
  TAG_GET_ALL: 'tag:get-all',
  TAG_GET_FOR_ROW: 'tag:get-for-row',
  TAG_GET_ROWS_FOR_GRID: 'tag:get-rows-for-grid',
  TAG_CREATE: 'tag:create',
  TAG_UPDATE: 'tag:update',
  TAG_DELETE: 'tag:delete',
  TAG_ASSIGN: 'tag:assign',
  TAG_UNASSIGN: 'tag:unassign',

  // Templates
  SETUP_TEMPLATE_GET_ALL: 'setup-template:get-all',
  SETUP_TEMPLATE_IMPORT: 'setup-template:import',
  SETUP_TEMPLATE_EXPORT: 'setup-template:export',
  SETUP_TEMPLATE_APPLY: 'setup-template:apply',
  SETUP_TEMPLATE_CREATE: 'setup-template:create',
  SETUP_TEMPLATE_DELETE: 'setup-template:delete',
  CL_TEMPLATE_GET_ALL: 'cl-template:get-all',
  CL_TEMPLATE_CREATE: 'cl-template:create',
  CL_TEMPLATE_UPDATE: 'cl-template:update',
  CL_TEMPLATE_DELETE: 'cl-template:delete',
  CL_TEMPLATE_EXPORT: 'cl-template:export',
  CL_TEMPLATE_IMPORT: 'cl-template:import',
  LETTER_TEMPLATE_GET_ALL: 'letter-template:get-all',
  LETTER_TEMPLATE_CREATE: 'letter-template:create',
  LETTER_TEMPLATE_UPDATE: 'letter-template:update',
  LETTER_TEMPLATE_DELETE: 'letter-template:delete',
  LETTER_TEMPLATE_GENERATE: 'letter-template:generate',
  PLACEHOLDER_FIELDS: 'letter-template:placeholder-fields',
  DOC_BATCH: 'documents:batch',
  DOC_LABELS: 'documents:labels',
  LETTER_TEMPLATE_EXPORT_PDF: 'letter-template:export-pdf',

  // Snippets
  SNIPPET_GET_ALL: 'snippet:get-all',
  SNIPPET_CREATE: 'snippet:create',
  SNIPPET_UPDATE: 'snippet:update',
  SNIPPET_DELETE: 'snippet:delete',

  // Dashboard
  DASHBOARD_GET_ALL: 'dashboard:get-all',
  DASHBOARD_GET_DEADLINES: 'dashboard:get-deadlines',
  DASHBOARD_GET_STATS: 'dashboard:get-stats',
  DASHBOARD_RECENT_ACTIVITY: 'dashboard:recent-activity',
  DASHBOARD_GET_COMPLETED: 'dashboard:get-completed',
  DASHBOARD_GET_FOLLOWUPS: 'dashboard:get-followups',
  DASHBOARD_GET_ARCHIVED: 'dashboard:get-archived',
  DASHBOARD_GET_BRIEFING: 'dashboard:get-briefing',
  EXPORT_WEEKLY_PLANNER: 'export:weekly-planner',
  EXPORT_AUDIT_REPORT: 'export:audit-report',
  EXPORT_HANDOFF_PACKET: 'export:handoff-packet',
  EXPORT_ICS: 'export:ics',

  // Monthly contact requirements (per caseload)
  CONTACT_REQ_GET: 'contact-req:get',
  CONTACT_REQ_SAVE: 'contact-req:save',
  CONTACT_REQ_STATUS: 'contact-req:status',

  // Missing information report (required fields)
  MISSING_INFO_GET: 'missing-info:get',
  MISSING_INFO_EXPORT_CSV: 'missing-info:export-csv',

  // Monthly compliance summary
  COMPLIANCE_SUMMARY_GET: 'compliance:summary',
  EXPORT_COMPLIANCE_SUMMARY: 'compliance:export-summary',

  // Totals: time, mileage and your own numbers on notes
  TOTALS_GET: 'totals:get',
  TOTALS_EXPORT_CSV: 'totals:export-csv',

  // Backup (3 layers)
  BACKUP_AUTO_LIST: 'backup:auto-list',
  BACKUP_SCHEDULED_RUN: 'backup:scheduled-run',
  BACKUP_MANUAL_CREATE: 'backup:manual-create',
  BACKUP_RESTORE_AUTO: 'backup:restore-auto',
  BACKUP_RESTORE_FILE: 'backup:restore-file',
  BACKUP_GET_INFO: 'backup:get-info',
  BACKUP_VERIFY: 'backup:verify',
  BACKUP_SCHEDULED_GET_CONFIG: 'backup:scheduled-get-config',
  BACKUP_SCHEDULED_SET_CONFIG: 'backup:scheduled-set-config',
  BACKUP_GET_STATUS: 'backup:get-status',
  BACKUP_VALIDATE_DESTINATION: 'backup:validate-destination',
  BACKUP_PREVIEW: 'backup:preview',

  // Export / Import
  EXPORT_CSV: 'export:csv',
  EXPORT_PDF_PROFILE: 'export:pdf-profile',
  EXPORT_PDF_GRID: 'export:pdf-grid',
  EXPORT_PDF_BATCH: 'export:pdf-batch',
  EXPORT_SUPERVISOR_REPORT: 'export:supervisor-report',
  EXPORT_PDF_CONTACT: 'export:pdf-contact',
  EXPORT_PDF_DIRECTORY: 'export:pdf-directory',
  EXPORT_ALL_CSV: 'export:all-csv',
  IMPORT_FILE: 'import:file',
  IMPORT_FILE_PREVIEW: 'import:file-preview',
  IMPORT_DETECT_COLUMNS: 'import:detect-columns',
  IMPORT_PROGRESS: 'import:progress',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_GET_ALL: 'settings:get-all',
  SETTINGS_UPDATE: 'settings:update',

  // Workspace (words and feature switches)
  WORKSPACE_GET: 'workspace:get',
  WORKSPACE_UPDATE: 'workspace:update',
  WORKSPACE_CHANGED: 'workspace:changed', // push: main → renderer, no args
  GRID_SETTINGS_UPDATE: 'grid:settings-update',

  // Note types (activity types)
  ACTIVITY_TYPE_GET_ALL: 'activity-type:get-all',
  ACTIVITY_TYPE_SAVE: 'activity-type:save',
  ACTIVITY_TYPE_ARCHIVE: 'activity-type:archive',
  ACTIVITY_TYPE_DELETE: 'activity-type:delete',
  ACTIVITY_TYPE_REORDER: 'activity-type:reorder',
  ACTIVITY_TYPES_CHANGED: 'activity-types:changed', // push: main → renderer, no args

  // Your own numbers on notes (definitions come with WORKSPACE_GET)
  MEASURE_SAVE: 'measure:save',
  MEASURE_ARCHIVE: 'measure:archive',

  // Days off for business-day deadlines (read with WORKSPACE_GET)
  HOLIDAYS_SET: 'holidays:set',

  // Deadline engine (W05)
  DEADLINES_GET: 'deadlines:get',
  GRID_DEADLINE_CONTEXT: 'deadlines:grid-context',
  DEADLINE_METER_DONE: 'deadlines:meter-done',
  DEADLINE_STEP_DONE: 'deadlines:step-done',
  DEADLINE_STEP_UNDO: 'deadlines:step-undo',
  DEADLINE_EXTEND: 'deadlines:extend',
  DEADLINE_EXTENSION_REVOKE: 'deadlines:extension-revoke',
  DEADLINE_EXTENSION_RESTORE: 'deadlines:extension-restore',

  // Linked records (W04)
  LINK_TYPE_GET_ALL: 'links:types-get-all',
  LINK_TYPE_SAVE: 'links:type-save',
  LINK_SETUP: 'links:setup',
  LINK_TYPE_DELETE: 'links:type-delete',
  LINK_TYPE_COUNT: 'links:type-count',
  RECORD_LINKS_GET: 'links:get',
  RECORD_LINK_ADD: 'links:add',
  RECORD_LINK_REMOVE: 'links:remove',
  RECORD_LINK_SEARCH: 'links:search',
  RECORD_LINK_CREATE: 'links:create-record',
  GRID_LINK_VALUES: 'links:grid-values',
  RECORD_LINKS_MOVE_CHECK: 'links:move-check',
  LINK_COUNTS_FOR_GRID: 'links:counts-for-grid',
  /** main → window: links on these records changed */
  RECORD_LINKS_CHANGED: 'links:changed',

  // Stages and the board (W06)
  STAGE_CONFIG_SAVE: 'stages:config-save',
  STAGE_MOVE: 'stages:move',
  STAGE_UNDO: 'stages:undo',
  STAGE_DURATIONS: 'stages:durations',
  STAGE_SUMMARY: 'stages:summary',

  // Appointments and the calendar (W07)
  APPT_LIST: 'appointments:list',
  APPT_FOR_RECORD: 'appointments:for-record',
  APPT_CREATE: 'appointments:create',
  APPT_UPDATE: 'appointments:update',
  APPT_DELETE: 'appointments:delete',
  APPT_RESTORE: 'appointments:restore',
  APPT_SET_STATUS: 'appointments:set-status',
  APPT_UPCOMING_COUNT: 'appointments:upcoming-count',
  APPT_CANCEL_UPCOMING: 'appointments:cancel-upcoming',
  CALENDAR_ITEMS: 'calendar:items',
  /** main → window: appointments changed */
  APPOINTMENTS_CHANGED: 'appointments:changed',

  // Forms (W08)
  FORM_LIST: 'forms:list',
  FORM_SAVE: 'forms:save',
  FORM_DELETE: 'forms:delete',
  FORM_SUBMIT: 'forms:submit',
  FORM_UNDO: 'forms:undo',
  FORM_PRINT: 'forms:print',

  // Attachments (W09)
  ATTACHMENT_ADD: 'attachments:add',
  ATTACHMENT_ADD_PATHS: 'attachments:add-paths',
  ATTACHMENT_LIST: 'attachments:list',
  ATTACHMENT_DESCRIBE: 'attachments:describe',
  ATTACHMENT_DELETE: 'attachments:delete',
  ATTACHMENT_RESTORE: 'attachments:restore',
  ATTACHMENT_USAGE: 'attachments:usage',
  ATTACHMENT_PURGE: 'attachments:purge',
  ATTACHMENT_TRASH_LIST: 'attachments:trash-list',
  ATTACHMENT_OPEN: 'attachments:open',
  ATTACHMENT_SAVE_AS: 'attachments:save-as',
  ATTACHMENT_PREVIEW: 'attachments:preview',
  /** main → window: files on these records changed */
  ATTACHMENTS_CHANGED: 'attachments:changed',

  // Report builder (W10 §6)
  REPORT_FIELDS: 'reports:fields',
  REPORT_RUN: 'reports:run',
  REPORT_RUN_SAVED: 'reports:run-saved',
  REPORT_LIST: 'reports:list',
  REPORT_SAVE: 'reports:save',
  REPORT_DELETE: 'reports:delete',
  REPORT_EXPORT: 'reports:export',

  // Desktop reminders (W11)
  REMINDERS_GET: 'reminders:get',
  REMINDERS_SET: 'reminders:set',
  REMINDERS_TEST: 'reminders:test',
  /** main → window: a reminder was clicked; open this route */
  REMINDER_OPEN: 'reminders:open',
  /** Background mode and start with the computer (W11 §3–4) */
  BACKGROUND_GET: 'background:get',
  BACKGROUND_SET: 'background:set',

  // Starter templates (examples)
  STARTER_LIST: 'starter:list',
  STARTER_PREVIEW: 'starter:preview',
  STARTER_APPLY: 'starter:apply',
  STARTER_OPEN_FILE: 'starter:open-file',
  WORKSPACE_EXPORT_TEMPLATE: 'workspace:export-template',

  // Onboarding
  ONBOARDING_CHECK: 'onboarding:check',
  ONBOARDING_COMPLETE: 'onboarding:complete',
  ONBOARDING_SETUP_GRID: 'onboarding:setup-grid',
  ONBOARDING_DATE_RULES: 'onboarding:date-rules',
  SAMPLE_DATA_STATUS: 'sample-data:status',
  SAMPLE_DATA_CREATE: 'sample-data:create',
  SAMPLE_DATA_REMOVE: 'sample-data:remove',

  // App utilities
  APP_GET_INFO: 'app:get-info',
  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_SHOW_FILE_DIALOG: 'app:show-file-dialog',
  APP_SHOW_SAVE_DIALOG: 'app:show-save-dialog',
  APP_FACTORY_RESET: 'app:factory-reset',
  APP_CHECK_FOR_UPDATES: 'app:check-for-updates',
  APP_INTEGRITY_CHECK: 'app:integrity-check',
  APP_RELAUNCH: 'app:relaunch',
  APP_MIGRATION_STATUS: 'app:migration-status',
  CELL_HISTORY_COMPACT: 'cell-history:compact',
  CELL_HISTORY_SERIES: 'cell-history:series',

  // File association
  FILE_ASSOC_GET_PENDING: 'file-assoc:get-pending',
  FILE_ASSOC_CLEAR_PENDING: 'file-assoc:clear-pending',
  FILE_ASSOC_REGISTER: 'file-assoc:register',
  FILE_ASSOC_IS_REGISTERED: 'file-assoc:is-registered',
  FILE_ASSOC_PENDING_ARRIVED: 'file-assoc:pending-arrived',

  // Auth & Security
  AUTH_SETUP_PASSWORD: 'auth:setup-password',
  AUTH_VERIFY_PASSWORD: 'auth:verify-password',
  AUTH_CHANGE_PASSWORD: 'auth:change-password',
  AUTH_LOCK: 'auth:lock',
  AUTH_FORCE_LOCK: 'auth:force-lock',
  AUTH_ACTIVITY_PING: 'auth:activity-ping',
  AUTH_GET_HINT: 'auth:get-hint',
  AUTH_IS_SETUP: 'auth:is-setup',
  AUTH_GENERATE_RECOVERY_KEY: 'auth:generate-recovery-key',
  AUTH_VERIFY_RECOVERY_KEY: 'auth:verify-recovery-key',
  AUTH_REVOKE_RECOVERY_KEY: 'auth:revoke-recovery-key',
  AUTH_HAS_RECOVERY_KEY: 'auth:has-recovery-key',
  AUTH_RESET_PASSWORD_AFTER_RECOVERY: 'auth:reset-password-after-recovery',
  AUTH_CREDENTIALS_UNREADABLE: 'auth:credentials-unreadable',
  AUTH_RESTORE_FROM_BACKUP: 'auth:restore-from-backup',

  // Caseload tasks
  TASK_GET_ALL: 'task:get-all',
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',
  TASK_COMPLETE: 'task:complete',
  TASK_SNOOZE: 'task:snooze',
  TASK_GET_HISTORY: 'task:get-history',
  TASK_GET_DUE: 'task:get-due',
  TASK_REORDER: 'task:reorder',
  TASK_RESTORE: 'task:restore',
  TASK_UNCOMPLETE: 'task:uncomplete',
  TASK_GROUP_GET_ALL: 'task:group-get-all',
  TASK_GROUP_CREATE: 'task:group-create',
  TASK_GROUP_UPDATE: 'task:group-update',
  TASK_GROUP_DELETE: 'task:group-delete',
  TASK_GROUP_REORDER: 'task:group-reorder',
  TASK_MOVE_TO_GROUP: 'task:move-to-group',
  TASK_APPLY_TEMPLATE: 'task:apply-template',

  // ── Contacts / Provider Directory ──────────────────────────────────────────
  CONTACTS_GET_ALL: 'contacts:get-all',
  CONTACTS_GET_ONE: 'contacts:get-one',
  CONTACTS_CREATE: 'contacts:create',
  CONTACTS_UPDATE: 'contacts:update',
  CONTACTS_DELETE: 'contacts:delete',
  CONTACTS_GET_CATEGORIES: 'contacts:get-categories',
  CONTACTS_CREATE_CATEGORY: 'contacts:create-category',
  CONTACTS_UPDATE_CATEGORY: 'contacts:update-category',
  CONTACTS_DELETE_CATEGORY: 'contacts:delete-category',
  CONTACTS_ADD_TAG: 'contacts:add-tag',
  CONTACTS_REMOVE_TAG: 'contacts:remove-tag',
  CONTACTS_GET_CLIENT_LINKS: 'contacts:get-client-links',
  CONTACTS_LINK_CLIENT: 'contacts:link-client',
  CONTACTS_UNLINK_CLIENT: 'contacts:unlink-client',
  CONTACTS_ADD_INTERACTION: 'contacts:add-interaction',
  CONTACTS_UPDATE_INTERACTION: 'contacts:update-interaction',
  CONTACTS_DELETE_INTERACTION: 'contacts:delete-interaction',
  CONTACTS_GET_INTERACTIONS: 'contacts:get-interactions',
  CONTACTS_MARK_AVAILABILITY_CHECKED: 'contacts:mark-availability-checked',
  CONTACTS_GET_CUSTOM_FIELDS: 'contacts:get-custom-fields',
  CONTACTS_CREATE_CUSTOM_FIELD: 'contacts:create-custom-field',
  CONTACTS_DELETE_CUSTOM_FIELD: 'contacts:delete-custom-field',
  CONTACTS_GET_CUSTOM_VALUES: 'contacts:get-custom-values',
  CONTACTS_SAVE_CUSTOM_VALUE: 'contacts:save-custom-value',
  CONTACTS_IMPORT_VCF: 'contacts:import-vcf',
  CONTACTS_CONFIRM_IMPORT_VCF: 'contacts:confirm-import-vcf',
  CONTACTS_EXPORT_VCF: 'contacts:export-vcf',


  // Acuity
  ACUITY_GET_LEVELS: 'acuity:get-levels',
  ACUITY_CREATE_LEVEL: 'acuity:create-level',
  ACUITY_UPDATE_LEVEL: 'acuity:update-level',
  ACUITY_DELETE_LEVEL: 'acuity:delete-level',
  ACUITY_REORDER_LEVELS: 'acuity:reorder-levels',
  ACUITY_SET_ROW_LEVEL: 'acuity:set-row-level',
  ACUITY_BULK_SET_LEVEL: 'acuity:bulk-set-level',
  ACUITY_TOGGLE: 'acuity:toggle',

  // Clipboard
  CLIPBOARD_WRITE: 'clipboard:write',

  // Cross-grid search
  SEARCH_CLIENTS_CROSS_GRID: 'search:clients-cross-grid',

  // Logging
  LOG_FORWARD: 'log:forward',
} as const

export type IPCChannel = typeof IPC[keyof typeof IPC]
