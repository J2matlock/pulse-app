import React from 'react'
import { DemoWrapper } from './DemoWrapper'

export function DemoImportFlow() {
  const steps = [
    { icon: '📄', label: 'Select file' },
    { icon: '🔗', label: 'Map columns' },
    { icon: '⏳', label: 'Importing...' },
    { icon: '✅', label: 'Done!' },
  ]
  return (
    <DemoWrapper>
      <style>{`
        @keyframes impStep {
          0%, 5% { opacity: 0.3; transform: scale(0.9); }
          15%, 70% { opacity: 1; transform: scale(1); }
          80%, 100% { opacity: 0.3; transform: scale(0.9); }
        }
        @keyframes impProgress {
          0%, 30% { width: 0%; }
          55%, 70% { width: 100%; }
          85%, 100% { width: 0%; }
        }
        @keyframes impArrow {
          0%, 10% { opacity: 0; }
          20%, 70% { opacity: 1; }
          80%, 100% { opacity: 0; }
        }
      `}</style>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3">Import wizard flow</div>
      <div className="flex items-center justify-between gap-1 mb-4">
        {steps.map((s, i) => (
          <React.Fragment key={i}>
            <div
              className="flex flex-col items-center gap-1"
              style={{ animation: `impStep 8s ease ${i * 1.5}s infinite` }}
            >
              <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-xl">
                {s.icon}
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div
                className="text-slate-500 dark:text-slate-400 text-lg flex-shrink-0 -mt-4"
                style={{ animation: `impArrow 8s ease ${i * 1.5 + 0.5}s infinite` }}
              >
                →
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      {/* Progress bar */}
      <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full"
          style={{ animation: 'impProgress 8s ease infinite' }}
        />
      </div>
    </DemoWrapper>
  )
}
