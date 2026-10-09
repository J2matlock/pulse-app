import { DemoWrapper } from './DemoWrapper'

export function DemoSearchFilter() {
  return (
    <DemoWrapper>
      <style>{`
        @keyframes sfType {
          0%, 10% { width: 0; }
          20% { width: 1ch; }
          30% { width: 2ch; }
          40%, 75% { width: 3ch; }
          85%, 100% { width: 0; }
        }
        @keyframes sfMatch {
          0%, 25% { opacity: 0.4; }
          35%, 70% { opacity: 1; background: rgba(59,130,246,0.08); }
          80%, 100% { opacity: 0.4; }
        }
        @keyframes sfNoMatch {
          0%, 25% { opacity: 1; height: 36px; }
          40%, 70% { opacity: 0.1; height: 36px; }
          85%, 100% { opacity: 1; height: 36px; }
        }
      `}</style>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Live search filtering</div>
      {/* Search bar */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
        <span className="text-slate-500 dark:text-slate-400 text-sm">🔍</span>
        <span
          className="inline-block overflow-hidden whitespace-nowrap text-[15px] text-slate-700 dark:text-slate-300 font-mono"
          style={{ animation: 'sfType 7s steps(3) infinite' }}
        >
          Joh
        </span>
        <span className="w-0.5 h-4 bg-blue-500 animate-pulse" />
      </div>
      {/* Results */}
      <div className="space-y-1" style={{ fontSize: 13 }}>
        <div
          className="flex gap-4 rounded-sm px-3 py-2 border border-slate-200 dark:border-slate-700"
          style={{ animation: 'sfMatch 7s ease infinite' }}
        >
          <span className="text-slate-700 dark:text-slate-300 font-medium"><mark className="bg-yellow-200 dark:bg-yellow-800 rounded-sm px-0.5">Joh</mark>nson</span>
          <span className="text-slate-500">Active</span>
        </div>
        <div
          className="flex gap-4 bg-white dark:bg-slate-800 rounded-sm px-3 py-2 border border-slate-200 dark:border-slate-700"
          style={{ animation: 'sfNoMatch 7s ease infinite' }}
        >
          <span className="text-slate-700 dark:text-slate-300 font-medium">Smith</span>
          <span className="text-slate-500">Pending</span>
        </div>
        <div
          className="flex gap-4 rounded-sm px-3 py-2 border border-slate-200 dark:border-slate-700"
          style={{ animation: 'sfMatch 7s ease 0.2s infinite' }}
        >
          <span className="text-slate-700 dark:text-slate-300 font-medium"><mark className="bg-yellow-200 dark:bg-yellow-800 rounded-sm px-0.5">Joh</mark>nston</span>
          <span className="text-slate-500">Active</span>
        </div>
      </div>
    </DemoWrapper>
  )
}
