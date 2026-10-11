// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true })
Object.defineProperty(window, 'matchMedia', {
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  writable: true,
})

vi.mock('../../../../src/renderer/components/layout/Sidebar', () => ({
  Sidebar: ({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) => (
    <nav data-testid="sidebar" data-collapsed={String(collapsed)}><button onClick={onToggle}>Toggle sidebar</button></nav>
  ),
}))
vi.mock('../../../../src/renderer/components/layout/TopBar', () => ({ TopBar: () => <div data-testid="topbar" /> }))
vi.mock('../../../../src/renderer/components/layout/StatusBar', () => ({ StatusBar: () => null }))
vi.mock('../../../../src/renderer/components/shared/SampleDataBanner', () => ({ SampleDataBanner: () => null }))
vi.mock('../../../../src/renderer/components/shared/UpdateBanner', () => ({
  UpdateBanner: ({ version }: { version: string }) => <div data-testid="update-banner">{version}</div>,
}))
vi.mock('../../../../src/renderer/components/forms/FormFillHost', () => ({ FormFillHost: () => null }))
vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { MainLayout, resetMainLayoutSession } from '../../../../src/renderer/components/layout/MainLayout'

function Crash(): React.ReactElement { throw new Error('page crash') }

describe('MainLayout', () => {
  beforeEach(() => {
    resetMainLayoutSession()
    sessionStorage.clear()
    mockInvoke.mockReset()
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'app:check-for-updates') return Promise.resolve({ ok: true, data: { available: true, version: '9.9.9' } })
      return Promise.resolve({ ok: true, data: null })
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('keeps the sidebar and top bar when the page crashes', () => {
    render(<MemoryRouter><MainLayout><Crash /></MainLayout></MemoryRouter>)
    expect(screen.getByText('Something went wrong loading this page.')).toBeTruthy()
    expect(screen.getByTestId('sidebar')).toBeTruthy()
    expect(screen.getByTestId('topbar')).toBeTruthy()
  })

  it('checks for updates once per launch, not again after each unlock', async () => {
    const first = render(<MemoryRouter><MainLayout><p>page</p></MainLayout></MemoryRouter>)
    expect(await screen.findByTestId('update-banner')).toBeTruthy()
    first.unmount()
    // Locking unmounts the layout; unlocking mounts it again
    render(<MemoryRouter><MainLayout><p>page</p></MainLayout></MemoryRouter>)
    expect(await screen.findByTestId('update-banner')).toBeTruthy()
    const checks = mockInvoke.mock.calls.filter(c => c[0] === 'app:check-for-updates')
    expect(checks).toHaveLength(1)
  })

  it('does not keep an attempt made before setup finished, so it checks after setup (AUDIT-087)', async () => {
    let setupDone = false
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'app:check-for-updates') {
        return Promise.resolve({ ok: true, data: setupDone ? { available: true, version: '9.9.9' } : { available: false, setupPending: true } })
      }
      return Promise.resolve({ ok: true, data: null })
    })
    // The layout shows for a moment before setup opens on first launch
    const first = render(<MemoryRouter><MainLayout><p>page</p></MainLayout></MemoryRouter>)
    await waitFor(() => expect(mockInvoke.mock.calls.filter(c => c[0] === 'app:check-for-updates')).toHaveLength(1))
    first.unmount()
    setupDone = true
    render(<MemoryRouter><MainLayout><p>page</p></MainLayout></MemoryRouter>)
    expect(await screen.findByTestId('update-banner')).toBeTruthy()
    expect(mockInvoke.mock.calls.filter(c => c[0] === 'app:check-for-updates')).toHaveLength(2)
  })

  it('remembers a collapsed sidebar across a lock', async () => {
    const first = render(<MemoryRouter><MainLayout><p>page</p></MainLayout></MemoryRouter>)
    fireEvent.click(screen.getByText('Toggle sidebar'))
    expect(screen.getByTestId('sidebar').getAttribute('data-collapsed')).toBe('true')
    first.unmount()
    render(<MemoryRouter><MainLayout><p>page</p></MainLayout></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('sidebar').getAttribute('data-collapsed')).toBe('true'))
  })
})
