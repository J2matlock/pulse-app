/**
 * "Print & export ▾" on the dashboard (UX D-19): the occasional actions
 * (weekly planner, monthly summary, calendar file, reminder letters) under
 * one button, so only Customize stays beside the title.
 */
import React from 'react'
import { Printer } from 'lucide-react'
import { MenuButton } from '../../components/ui/RowMenu'

export interface PrintExportItem {
  label: string
  /** One line under the label saying what comes out */
  hint: string
  icon: React.ReactNode
  onSelect: () => void
}

export function PrintExportMenu({ items }: { items: PrintExportItem[] }): React.ReactElement {
  return (
    <MenuButton
      label="Print & export"
      menuLabel="Print and export"
      icon={<Printer className="w-4 h-4" />}
      size="compact"
      align="end"
      items={items.map(item => ({ label: item.label, description: item.hint, icon: item.icon, onSelect: item.onSelect }))}
    />
  )
}
