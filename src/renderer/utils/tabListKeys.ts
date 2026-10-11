import type { KeyboardEvent } from 'react'

/**
 * Arrow keys, Home and End for a role="tablist" (WAI-ARIA tabs pattern).
 * Moves focus to the next tab and selects it, so keyboard users can switch
 * tabs the way a screen reader tells them they can. Put it on the tablist's
 * onKeyDown, and give each tab tabIndex={selected ? 0 : -1}.
 */
export function onTabListKeyDown(e: KeyboardEvent<HTMLElement>): void {
  const vertical = e.currentTarget.getAttribute('aria-orientation') === 'vertical'
  const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft'
  const nextKey = vertical ? 'ArrowDown' : 'ArrowRight'
  if (![prevKey, nextKey, 'Home', 'End'].includes(e.key)) return

  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'))
    .filter(t => !t.hasAttribute('disabled'))
  if (tabs.length === 0) return
  const current = tabs.findIndex(t => t === document.activeElement)
  if (current === -1) return

  let next = current
  if (e.key === prevKey) next = (current - 1 + tabs.length) % tabs.length
  else if (e.key === nextKey) next = (current + 1) % tabs.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = tabs.length - 1

  e.preventDefault()
  const target = tabs[next]
  if (!target) return
  target.focus()
  target.click()
}
