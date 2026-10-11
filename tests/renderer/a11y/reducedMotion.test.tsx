// @vitest-environment jsdom
/**
 * Settings → Reduce motion reaches motion/react, not just the CSS class
 * (audit A06-16): with it on, MotionConfig reports reduced motion even when
 * the computer's own setting is off.
 */
import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup, act } from '@testing-library/react'
import { useReducedMotionConfig } from 'motion/react'

Object.defineProperty(window, 'matchMedia', {
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
  writable: true,
})

import { AppMotionConfig } from '../../../src/renderer/components/layout/AppMotionConfig'
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore'

function Probe(): React.ReactElement {
  return <p data-testid="reduced">{String(useReducedMotionConfig() ?? false)}</p>
}

afterEach(() => { cleanup(); useSettingsStore.setState({ reducedMotion: false }) })

describe('reduce motion setting', () => {
  it('turns motion animations down when the in-app switch is on', () => {
    useSettingsStore.setState({ reducedMotion: false })
    const { getByTestId } = render(<AppMotionConfig><Probe /></AppMotionConfig>)
    expect(getByTestId('reduced').textContent).toBe('false')
    act(() => useSettingsStore.setState({ reducedMotion: true }))
    expect(getByTestId('reduced').textContent).toBe('true')
  })
})
