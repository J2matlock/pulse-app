// @vitest-environment jsdom
/** Grid accessibility (batch B11): names, roles and keyboard paths a screen reader or keyboard user needs. */
import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { alertShapeForBand } from '../../../../src/renderer/components/grid/gridConstants'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

const bands = [
  { daysBefore: 30, bgClass: '#facc15', label: 'Due Soon' },
  { daysBefore: 14, bgClass: '#fb923c', label: 'Urgent' },
  { daysBefore: 0, bgClass: '#dc2626', label: 'Due Today' },
  { daysBefore: -1, bgClass: 'alert-pulse-dark', label: 'Overdue' },
]

describe('deadline shapes (AUDIT-146)', () => {
  it('are images with a name, not plain spans carrying aria-label', () => {
    render(<>
      {alertShapeForBand(-2, bands[3]!, bands)}
      {alertShapeForBand(0, bands[2]!, bands)}
      {alertShapeForBand(10, bands[1]!, bands)}
      {alertShapeForBand(20, bands[0]!, bands)}
      {alertShapeForBand(90, { daysBefore: 90, bgClass: '#000', label: 'Later' }, [...bands, { daysBefore: 90 }])}
    </>)
    for (const name of ['Overdue: 2 days overdue', 'Due Today', 'Urgent', 'Due Soon', 'Later']) {
      expect(screen.getByRole('img', { name })).toBeTruthy()
    }
  })
})
