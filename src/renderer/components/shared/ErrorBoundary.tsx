import React from 'react'
import { rlog } from '../../utils/rendererLogger'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
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
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-64 gap-4 p-8 text-center">
          <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Something went wrong loading this page.
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            className="btn btn-secondary"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.hash = '#/'
            }}
          >
            Go back to the start
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
