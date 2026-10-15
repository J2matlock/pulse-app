import React from 'react'
import { Pencil, Trash2, Download } from 'lucide-react'
import type { ChecklistTemplate } from '../../../shared/types'
import { Badge } from './Badge'

interface CL_RowProps {
  template: ChecklistTemplate
  onEdit: (template: ChecklistTemplate) => void
  onDelete: (id: number) => void
  onExport: (template: ChecklistTemplate) => void
}

export function ChecklistTemplateRow({ template, onEdit, onDelete, onExport }: CL_RowProps): React.ReactElement {
  const itemCount = (() => {
    try {
      const parsed = JSON.parse(template.items) as unknown[]
      return Array.isArray(parsed) ? parsed.length : 0
    } catch { return 0 }
  })()

  return (
    <tr className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-medium text-slate-800 dark:text-slate-100">{template.name}</span>
          {template.is_system === 1 && <Badge variant="blue">Built-in</Badge>}
        </div>
        {template.description && (
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{template.description}</p>
        )}
      </td>
      <td className="px-4 py-3 text-base text-slate-600 dark:text-slate-300 whitespace-nowrap">
        {itemCount} item{itemCount !== 1 ? 's' : ''}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {template.is_recurring === 1 ? (
          <span className="text-base text-slate-600 dark:text-slate-300">
            Every {template.recurrence_days ?? '?'} days
          </span>
        ) : (
          <span className="text-sm text-slate-500 dark:text-slate-400">No</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
          <button
            type="button"
            onClick={() => onExport(template)}
            className="p-2 rounded-lg text-slate-500 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20
                       min-h-[44px] min-w-[44px] flex items-center justify-center
                       focus:outline-hidden focus:ring-3 focus:ring-green-500 transition-colors"
            title="Export as .pulse-checklist file"
            aria-label="Export template"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onEdit(template)}
            className="p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20
                       min-h-[44px] min-w-[44px] flex items-center justify-center
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 transition-colors"
            title="Edit template"
            aria-label="Edit template"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(template.id)}
            className="p-2 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20
                       min-h-[44px] min-w-[44px] flex items-center justify-center
                       focus:outline-hidden focus:ring-3 focus:ring-red-400 transition-colors"
            title="Delete template"
            aria-label="Delete template"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  )
}
