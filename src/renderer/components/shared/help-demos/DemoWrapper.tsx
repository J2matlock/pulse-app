import React from 'react'

export function DemoWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="my-3 rounded-xl border border-slate-200 dark:border-slate-700
                 bg-slate-50 dark:bg-slate-800/50 p-4 overflow-hidden"
      style={{ maxHeight: 280 }}
    >
      {children}
    </div>
  )
}
