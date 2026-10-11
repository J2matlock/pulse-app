// @vitest-environment jsdom
/** Ctrl+Tab leaves the list for the next control, in either direction (audit G-32). */
import { describe, it, expect } from 'vitest'
import { focusOutsideGrid } from '../../../../src/renderer/components/grid/gridKeyboardNav'

describe('focusOutsideGrid', () => {
  it('moves focus to the control after (or before) the list', () => {
    document.body.innerHTML = `
      <button id="before">Before</button>
      <div role="grid"><div role="gridcell" tabindex="0" id="cell">A</div><button id="inner">In row</button></div>
      <button id="after">After</button>`
    const cell = document.getElementById('cell')!
    cell.focus()
    focusOutsideGrid(cell, false)
    expect(document.activeElement?.id).toBe('after')
    cell.focus()
    focusOutsideGrid(cell, true)
    expect(document.activeElement?.id).toBe('before')
  })
})
