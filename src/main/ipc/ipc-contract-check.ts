/**
 * Compile-time checks that src/shared/ipc-contract.ts tells the truth about
 * the main-process functions behind each channel (audit A08-4).
 *
 * Nothing here runs. If a function's return type drifts away from what the
 * contract promises the renderer, `npm run typecheck` fails on the line below
 * that names the channel. Handlers that build their result inline (the export
 * and save-dialog ones) are checked by reading, not here.
 */
import type { IPCContract, ContractChannel, DeadlineListItem, MeterDoneResult as ContractMeterDone, MarkDoneResult as ContractMarkDone, DoneChoice as ContractDoneChoice, ApptStatusChange, ApptStatusOptions, AttachmentAddResult, ComplianceSummary as ContractCompliance, PlaceholderFieldGroup, DocTarget as ContractDocTarget, AuditScope as ContractAuditScope, HandoffOptions as ContractHandoff, FormValues as ContractFormValues } from '../../shared/ipc-contract'
import type { listLinkTypes, saveLinkType, setupLink, deleteLinkType, countLinks, getLinksForRow, addLink, removeLink, searchLinkTargets, createLinkedRecord, linkValuesForGrid, linksThatWontFit, linkCountsForGrid } from '../links'
import type { saveStageConfig, moveStage, stageDurations, stageSummary } from '../stages'
import type { listAppointments, recordAppointments, createAppointment, updateAppointment, deleteAppointment, setAppointmentStatus, countUpcomingForRecords, cancelUpcomingForRecords, endSeriesOn, ApptSnapshot, StatusChange, StatusOptions } from '../appointments'
import type { calendarItems, deadlineOptionsForDay } from '../calendar'
import type { listForms, saveForm, submitForm, redoFormSubmit, FormValues } from '../forms'
import type { listAttachments, describeAttachment, attachmentUsage, purgeDeletedAttachments, trashedAttachments, AddResult } from '../attachments'
import type { previewAttachment } from '../attachment-files'
import type { reportFields, runReport, listReports, saveReport } from '../report-builder'
import type { getReminderSettings, setReminderSettings } from '../reminders'
import type { getRequirements, getRequirementStatus } from '../contact-requirements'
import type { getMissingInfo } from '../missing-info'
import type { getComplianceSummary, ComplianceSummary } from '../compliance'
import type { getTotals } from '../totals'
import type { loadDeadlines, loadGridDeadlineContext, DeadlineItem } from '../deadlines'
import type { markMeterDone, markStepDone, reanchorProgress, markDone, extendDeadline, revokeExtension, MeterDoneResult, MarkDoneResult, DoneChoice } from '../deadline-actions'
import type { placeholderFields, FieldGroup } from '../placeholders'
import type { numberSeries } from '../number-history'
import type { getMigrationFailure } from '../database'
import type { DocTarget } from '../export-documents'
import type { AuditScope } from '../export-audit'
import type { HandoffOptions } from '../export-handoff'
import type { getDraft, putDraft, listDrafts } from '../note-drafts'

/** A fits where the contract says B */
type Fits<A, B> = [A] extends [B] ? true : false
/** The same shape both ways */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Expect<T extends true> = T
type Ret<C extends ContractChannel> = IPCContract[C]['return']

export type IPCContractChecks = [
  // Shapes the contract restates from main
  Expect<Same<DeadlineItem, DeadlineListItem>>,
  Expect<Same<MeterDoneResult, ContractMeterDone>>,
  Expect<Same<MarkDoneResult, ContractMarkDone>>,
  Expect<Same<DoneChoice, ContractDoneChoice>>,
  Expect<Same<StatusChange, ApptStatusChange>>,
  Expect<Same<StatusOptions, ApptStatusOptions>>,
  Expect<Same<AddResult, AttachmentAddResult>>,
  Expect<Same<ComplianceSummary, ContractCompliance>>,
  Expect<Same<FieldGroup, PlaceholderFieldGroup>>,
  Expect<Same<DocTarget, ContractDocTarget>>,
  Expect<Same<AuditScope, ContractAuditScope>>,
  Expect<Same<HandoffOptions, ContractHandoff>>,
  Expect<Same<FormValues, ContractFormValues>>,
  Expect<Fits<ApptSnapshot, IPCContract['appointments:restore']['args'][0]>>,

  // Linked records
  Expect<Fits<ReturnType<typeof listLinkTypes>, Ret<'links:types-get-all'>>>,
  Expect<Fits<ReturnType<typeof saveLinkType>, Ret<'links:type-save'>>>,
  Expect<Fits<ReturnType<typeof setupLink>, Ret<'links:setup'>>>,
  Expect<Fits<ReturnType<typeof deleteLinkType>, Ret<'links:type-delete'>>>,
  Expect<Fits<ReturnType<typeof countLinks>, Ret<'links:type-count'>>>,
  Expect<Fits<ReturnType<typeof getLinksForRow>, Ret<'links:get'>>>,
  Expect<Fits<ReturnType<typeof addLink>, Ret<'links:add'>>>,
  Expect<Fits<ReturnType<typeof removeLink>, Ret<'links:remove'>>>,
  Expect<Fits<ReturnType<typeof searchLinkTargets>, Ret<'links:search'>>>,
  Expect<Fits<ReturnType<typeof createLinkedRecord>, Ret<'links:create-record'>>>,
  Expect<Fits<ReturnType<typeof linkValuesForGrid>, Ret<'links:grid-values'>>>,
  Expect<Fits<ReturnType<typeof linksThatWontFit>, Ret<'links:move-check'>>>,
  Expect<Fits<ReturnType<typeof linkCountsForGrid>, Ret<'links:counts-for-grid'>>>,

  // Stages
  Expect<Fits<ReturnType<typeof saveStageConfig>, Ret<'stages:config-save'>>>,
  Expect<Fits<ReturnType<typeof moveStage>, Ret<'stages:move'>>>,
  Expect<Fits<ReturnType<typeof stageDurations>, Ret<'stages:durations'>>>,
  Expect<Fits<ReturnType<typeof stageSummary>, Ret<'stages:summary'>>>,

  // Appointments and calendar
  Expect<Fits<ReturnType<typeof listAppointments>, Ret<'appointments:list'>>>,
  Expect<Fits<ReturnType<typeof recordAppointments>, Ret<'appointments:for-record'>>>,
  Expect<Fits<ReturnType<typeof createAppointment>, Ret<'appointments:create'>>>,
  Expect<Fits<ReturnType<typeof updateAppointment>, Ret<'appointments:update'>>>,
  Expect<Fits<ReturnType<typeof deleteAppointment>, Ret<'appointments:delete'>>>,
  Expect<Fits<ReturnType<typeof setAppointmentStatus>, Ret<'appointments:set-status'>>>,
  Expect<Fits<ReturnType<typeof countUpcomingForRecords>, Ret<'appointments:upcoming-count'>>>,
  Expect<Fits<ReturnType<typeof cancelUpcomingForRecords>, Ret<'appointments:cancel-upcoming'>>>,
  Expect<Fits<ReturnType<typeof endSeriesOn>, Ret<'appointments:end-series'>>>,
  Expect<Fits<ReturnType<typeof calendarItems>, Ret<'calendar:items'>>>,
  Expect<Fits<NonNullable<ReturnType<typeof deadlineOptionsForDay>>, Ret<'calendar:deadline-options'>>>,

  // Forms
  Expect<Fits<ReturnType<typeof listForms>, Ret<'forms:list'>>>,
  Expect<Fits<ReturnType<typeof saveForm>, Ret<'forms:save'>>>,
  Expect<Fits<ReturnType<typeof submitForm>, Ret<'forms:submit'>>>,
  Expect<Fits<ReturnType<typeof redoFormSubmit>, Ret<'forms:redo'>>>,

  // Attachments
  Expect<Fits<ReturnType<typeof listAttachments>, Ret<'attachments:list'>>>,
  Expect<Fits<ReturnType<typeof describeAttachment>, Ret<'attachments:describe'>>>,
  Expect<Fits<ReturnType<typeof attachmentUsage> & { text: string }, Ret<'attachments:usage'>>>,
  Expect<Fits<ReturnType<typeof purgeDeletedAttachments>, Ret<'attachments:purge'>>>,
  Expect<Fits<ReturnType<typeof trashedAttachments>, Ret<'attachments:trash-list'>>>,
  Expect<Fits<ReturnType<typeof previewAttachment>, Ret<'attachments:preview'>>>,

  // Reports
  Expect<Fits<ReturnType<typeof reportFields>, Ret<'reports:fields'>>>,
  Expect<Fits<ReturnType<typeof runReport>, Ret<'reports:run'>>>,
  Expect<Fits<ReturnType<typeof listReports>, Ret<'reports:list'>>>,
  Expect<Fits<ReturnType<typeof saveReport>, Ret<'reports:save'>>>,

  // Reminders
  Expect<Fits<ReturnType<typeof getReminderSettings>, Ret<'reminders:get'>>>,
  Expect<Fits<ReturnType<typeof setReminderSettings>, Ret<'reminders:set'>>>,

  // Requirements, missing information, totals
  Expect<Fits<ReturnType<typeof getRequirements>, Ret<'contact-req:get'>>>,
  Expect<Fits<ReturnType<typeof getRequirements>, Ret<'contact-req:save'>>>,
  Expect<Fits<ReturnType<typeof getRequirementStatus>, Ret<'contact-req:status'>>>,
  Expect<Fits<ReturnType<typeof getMissingInfo>, Ret<'missing-info:get'>>>,
  Expect<Fits<ReturnType<typeof getComplianceSummary>, Ret<'compliance:summary'>>>,
  Expect<Fits<ReturnType<typeof getTotals>, Ret<'totals:get'>>>,

  // Deadlines
  Expect<Fits<ReturnType<typeof loadDeadlines>, Ret<'deadlines:get'>>>,
  Expect<Fits<ReturnType<typeof loadGridDeadlineContext>, Ret<'deadlines:grid-context'>>>,
  Expect<Fits<ReturnType<typeof markMeterDone>, Ret<'deadlines:meter-done'>>>,
  Expect<Fits<ReturnType<typeof markStepDone>, Ret<'deadlines:step-done'>>>,
  Expect<Fits<ReturnType<typeof reanchorProgress>, Ret<'deadlines:progress-reanchor'>>>,
  Expect<Fits<ReturnType<typeof markDone>, Ret<'deadlines:mark-done'>>>,
  Expect<Fits<ReturnType<typeof extendDeadline>, Ret<'deadlines:extend'>>>,
  Expect<Fits<ReturnType<typeof revokeExtension>, Ret<'deadlines:extension-revoke'>>>,

  // Everything else
  Expect<Fits<ReturnType<typeof placeholderFields>, Ret<'letter-template:placeholder-fields'>>>,
  Expect<Fits<ReturnType<typeof numberSeries>, Ret<'cell-history:series'>>>,
  Expect<Fits<ReturnType<typeof getMigrationFailure>, Ret<'app:migration-status'>>>,
  Expect<Same<ReturnType<typeof getDraft>, Ret<'note-draft:get'>>>,
  Expect<Same<ReturnType<typeof putDraft>, Ret<'note-draft:put'>>>,
  Expect<Same<ReturnType<typeof listDrafts>, Ret<'note-draft:list'>>>,
]
