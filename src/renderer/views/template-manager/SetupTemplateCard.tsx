import React, { useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import type { Grid } from '../../../shared/types'
import type { SetupTemplate } from './types'
import { Badge } from './Badge'
import { ApplyTemplateDialog } from './ApplyTemplateDialog'
import { PrimaryButton } from '../../components/ui/Button'

interface SetupTemplateCardProps {
  template: SetupTemplate
  grids: Grid[]
  onDelete: (id: number) => void
  onExport: (id: number) => void
  onRefresh: () => void
}

export function SetupTemplateCard({ template, grids, onDelete, onExport, onRefresh }: SetupTemplateCardProps): React.ReactElement {
  const [showApply, setShowApply] = useState(false)

  // Parse metadata from pulse_json for badge counts
  const meta = (() => {
    try {
      const parsed = JSON.parse(template.pulse_json) as {
        columns?: unknown[]
        alert_rules?: unknown[]
        checklist_templates?: unknown[]
      }
      return {
        columnCount: Array.isArray(parsed.columns) ? parsed.columns.length : 0,
        alertRuleCount: Array.isArray(parsed.alert_rules) ? parsed.alert_rules.length : 0,
        checklistCount: Array.isArray(parsed.checklist_templates) ? parsed.checklist_templates.length : 0,
      }
    } catch {
      return { columnCount: 0, alertRuleCount: 0, checklistCount: 0 }
    }
  })()

  return (
    <>
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{template.name}</h3>
            {template.description && (
              <p className="mt-1 text-base text-slate-500 dark:text-slate-400 line-clamp-2">{template.description}</p>
            )}
          </div>
          {template.is_system === 1 && <Badge variant="blue">Built-in</Badge>}
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          {meta.columnCount > 0 && <Badge>{meta.columnCount} column{meta.columnCount !== 1 ? 's' : ''}</Badge>}
          {meta.alertRuleCount > 0 && <Badge>{meta.alertRuleCount} deadline rule{meta.alertRuleCount !== 1 ? 's' : ''}</Badge>}
          {meta.checklistCount > 0 && <Badge>{meta.checklistCount} checklist{meta.checklistCount !== 1 ? 's' : ''}</Badge>}
          {meta.columnCount === 0 && meta.alertRuleCount === 0 && meta.checklistCount === 0 && (
            <span className="text-sm text-slate-500 dark:text-slate-400">No preview data</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-auto pt-1">
          <PrimaryButton onClick={() => setShowApply(true)} className="flex-1">
            Apply
          </PrimaryButton>

          <>
            <button
              type="button"
              onClick={() => onExport(template.id)}
              title="Export as .pulse file"
              aria-label="Export as .pulse file"
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                         text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700
                         min-h-[44px] min-w-[44px] flex items-center justify-center
                         focus:outline-hidden focus:ring-3 focus:ring-slate-400 transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Deletes at once; the Undo toast brings it back (Q4) */}
            <button
              type="button"
              onClick={() => onDelete(template.id)}
              title="Delete template"
              aria-label="Delete template"
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                         text-slate-500 hover:text-red-500 hover:border-red-300 dark:hover:border-red-700
                         min-h-[44px] min-w-[44px] flex items-center justify-center
                         focus:outline-hidden focus:ring-3 focus:ring-red-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        </div>
      </div>

      {showApply && (
        <ApplyTemplateDialog
          template={template}
          grids={grids}
          onClose={() => setShowApply(false)}
          onApplied={() => { setShowApply(false); onRefresh() }}
        />
      )}
    </>
  )
}
