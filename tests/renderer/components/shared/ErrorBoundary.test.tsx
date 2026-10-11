// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { ErrorBoundary } from '../../../../src/renderer/components/shared/ErrorBoundary'

// Helper that throws on render
function ThrowingComponent({ message }: { message: string }): React.ReactElement {
  throw new Error(message)
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Suppress console.error from React's error boundary logging
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <p>Hello world</p>
      </ErrorBoundary>
    )
    expect(screen.getByText('Hello world')).toBeDefined()
  })

  it('shows error UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Test crash" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong loading this page.')).toBeDefined()
  })

  it('shows a plain sentence, not the raw error message', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Database connection failed" />
      </ErrorBoundary>
    )
    expect(screen.queryByText('Database connection failed')).toBeNull()
    expect(screen.getByText(/Your saved work is safe/)).toBeDefined()
  })

  it('offers the dashboard, so a crashing list page is not a dead end', () => {
    window.location.hash = '#/grid/3'
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Oops" />
      </ErrorBoundary>
    )
    const btn = screen.getByText('Open the dashboard')
    expect(btn.tagName).toBe('BUTTON')
    fireEvent.click(btn)
    expect(window.location.hash).toBe('#/dashboard')
  })

  it('offers the start when the dashboard is what crashed', () => {
    window.location.hash = '#/dashboard'
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Oops" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Go back to the start').tagName).toBe('BUTTON')
    expect(screen.queryByText('Open the dashboard')).toBeNull()
  })

  it('clears the error when its reset key changes (moving to another page)', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/grid">
        <ThrowingComponent message="Oops" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong loading this page.')).toBeDefined()
    rerender(
      <ErrorBoundary resetKey="/dashboard">
        <p>Dashboard</p>
      </ErrorBoundary>
    )
    expect(screen.getByText('Dashboard')).toBeDefined()
  })

  it('tells its owner about the crash once', () => {
    const onError = vi.fn()
    render(
      <ErrorBoundary fallback={null} onError={onError}>
        <ThrowingComponent message="Focus crash" />
      </ErrorBoundary>
    )
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]![0].message).toBe('Focus crash')
  })

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingComponent message="crash" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Custom fallback')).toBeDefined()
    expect(screen.queryByText('Something went wrong loading this page.')).toBeNull()
  })
})
