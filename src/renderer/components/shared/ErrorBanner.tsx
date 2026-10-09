import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface ErrorBannerProps {
  message: string
  onRetry?: () => void
  onDismiss?: () => void
}

export function ErrorBanner({ message, onRetry, onDismiss }: ErrorBannerProps): React.ReactElement {
  return (
    <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200" role="alert">
      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
      <span className="text-[15px] flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[15px] rounded bg-red-100 dark:bg-red-800 hover:bg-red-200 dark:hover:bg-red-700 transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-red-500"
          style={{ minHeight: 44 }}
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      )}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-red-400 hover:text-red-600 dark:hover:text-red-300 p-1 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-red-500 rounded"
          aria-label="Dismiss"
          style={{ minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          ✕
        </button>
      )}
    </div>
  )
}
