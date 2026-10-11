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

  it('displays the error message', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Database connection failed" />
      </ErrorBoundary>
    )
    expect(screen.getByText('Database connection failed')).toBeDefined()
  })

  it('shows a recovery button', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Oops" />
      </ErrorBoundary>
    )
    const btn = screen.getByText('Go back to the start')
    expect(btn).toBeDefined()
    expect(btn.tagName).toBe('BUTTON')
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
