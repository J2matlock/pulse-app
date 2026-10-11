/**
 * render() and then let the component's mount effects finish (loads that
 * resolve a mocked IPC call and set state), inside act(). Without this the
 * state updates land after the test's assertions and React warns "not wrapped
 * in act(...)" — and an update can leak into the next test.
 */
import { act } from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'

export async function flushEffects(ticks = 10): Promise<void> {
  await act(async () => { for (let i = 0; i < ticks; i++) await Promise.resolve() })
}

export async function renderSettled(ui: ReactElement, options?: RenderOptions): Promise<RenderResult> {
  const result = render(ui, options)
  await flushEffects()
  return result
}
