import { ChecklistGroupHeader as GroupHeader, type GroupHeaderProps } from '../shared/GroupHeader'

/**
 * The checklist's group header: the shared one (components/shared/GroupHeader.tsx,
 * also the Tasks page's) calling it a heading, and asking for a new one's name (C-19).
 * The example stays neutral: workspaces with other words see it too (Decision Log 2026-10-01).
 */
export function ChecklistGroupHeader(props: GroupHeaderProps) {
  return <GroupHeader noun="heading" placeholder="Heading, e.g. Paperwork to collect" {...props} />
}
