import type { AvailabilityStatus } from './types'

/** What each availability status is called everywhere: the app, the record page and printed PDFs. */
export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  accepting: 'Accepting',
  waitlist: 'Waitlist',
  full: 'Not Accepting',
  unknown: 'Unknown',
}

export function availabilityLabel(status: string | null | undefined): string {
  return AVAILABILITY_LABELS[(status ?? 'unknown') as AvailabilityStatus] ?? AVAILABILITY_LABELS.unknown
}
