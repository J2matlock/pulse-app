/**
 * The header row is one Tab stop (persona study, Mark: 66 Tabs to the first cell, three
 * per column header). Each header's name button, the Tags column's Hide and the "+" are
 * stops in a roving group: only the last one used takes Tab, and Left/Right move between
 * them (GridHeaderRow). Outside a header row (a header drawn on its own) every stop takes Tab.
 */
import { createContext, useContext } from 'react'

export interface HeaderStops {
  /** The stop that takes Tab: "col-<id>", "tags" or "add" */
  active: string
  setActive: (key: string) => void
}

export const HeaderStopsContext = createContext<HeaderStops | null>(null)

/** tabIndex and focus tracking for one stop in the header row */
export function useHeaderStop(key: string): { tabIndex: 0 | -1; 'data-header-stop': string; onFocus: () => void } {
  const stops = useContext(HeaderStopsContext)
  return {
    tabIndex: !stops || stops.active === key ? 0 : -1,
    'data-header-stop': key,
    onFocus: () => { if (stops && stops.active !== key) stops.setActive(key) },
  }
}

/** The stop Left/Right lands on: the previous or next one in the row, stopping at the ends */
export function neighbourStop(row: HTMLElement, from: Element, by: -1 | 1): HTMLElement | null {
  const stops = Array.from(row.querySelectorAll<HTMLElement>('[data-header-stop]'))
  const i = stops.findIndex(s => s === from)
  if (i < 0) return null
  return stops[i + by] ?? null
}
