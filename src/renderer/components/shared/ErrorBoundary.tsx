import React from 'react'
import { rlog } from '../../utils/rendererLogger'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
  /** When this changes (e.g. the page's path), a caught error is cleared and the children render again */
  resetKey?: unknown
  /** Called once when a render error is caught, e.g. to close the overlay that crashed */
  onError?: (error: Error) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Catches synchronous render errors in any child component tree.
 * Without this, a single thrown error in any route component crashes
 * the entire app to a blank screen with no recovery path.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    rlog.error('ErrorBoundary', 'Render error caught', { error, componentStack: info.componentStack })
    try { this.props.onError?.(error) } catch (err) { rlog.error('ErrorBoundary', 'onError failed', err) }
  }

  componentDidUpdate(prevProps: Props): void {
    if (this.state.hasError && !Object.is(prevProps.resetKey, this.props.resetKey)) {
      this.setState({ hasError: false, error: null })
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback
      // "The start" opens the list, which may be the page that crashed: offer
      // the dashboard, or the start when the dashboard is what crashed
      const onDashboard = (window.location.hash.split('?')[0] ?? '') === '#/dashboard'
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-64 gap-4 p-8 text-center">
          <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Something went wrong loading this page.
          </p>
          <p className="text-base text-slate-600 dark:text-slate-300 max-w-sm">
            Your saved work is safe. Try the page again, or open another one.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              className="btn btn-secondary"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.hash = onDashboard ? '#/' : '#/dashboard'
              }}
            >
              {onDashboard ? 'Go back to the start' : 'Open the dashboard'}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
