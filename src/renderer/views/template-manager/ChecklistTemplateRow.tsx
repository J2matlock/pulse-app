import React from 'react'
import { Pencil, Trash2, Download } from 'lucide-react'
import type { ChecklistTemplate } from '../../../shared/types'
import { Badge } from './Badge'
import { IconButton } from '../../components/ui/Button'

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
          <IconButton label="Export template" icon={<Download className="w-4 h-4" />} onClick={() => onExport(template)} />
          <IconButton label="Edit template" icon={<Pencil className="w-4 h-4" />} onClick={() => onEdit(template)} />
          <IconButton label="Delete template" icon={<Trash2 className="w-4 h-4" />} onClick={() => onDelete(template.id)}
            className="hover:text-red-700! dark:hover:text-red-300!" />
        </div>
      </td>
    </tr>
  )
}
