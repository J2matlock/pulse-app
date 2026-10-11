import { DemoWrapper } from './DemoWrapper'

export function DemoFilterChips() {
  return (
    <DemoWrapper>
      <style>{`
        @keyframes fcChipIn {
          0%, 8% { opacity: 0; transform: translateY(-4px); }
          15%, 75% { opacity: 1; transform: translateY(0); }
          85%, 100% { opacity: 0; transform: translateY(-4px); }
        }
        @keyframes fcRowStay {
          0%, 20% { opacity: 1; }
          30%, 70% { opacity: 1; }
          80%, 100% { opacity: 1; }
        }
        @keyframes fcRowFade {
          0%, 20% { opacity: 1; height: 36px; }
          35%, 70% { opacity: 0.15; height: 36px; }
          85%, 100% { opacity: 1; height: 36px; }
        }
      `}</style>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Filter chips in action</div>
      {/* Chips */}
      <div className="flex gap-2 mb-3">
        <div
          className="px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-xs font-medium text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700"
          style={{ animation: 'fcChipIn 7s ease 0s infinite' }}
        >
          Status = Active
        </div>
        <div
          className="px-2.5 py-1 rounded-full bg-purple-100 dark:bg-purple-900/40 text-xs font-medium text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700"
          style={{ animation: 'fcChipIn 7s ease 0.8s infinite' }}
        >
          Program = Housing
        </div>
      </div>
      {/* Rows */}
      <div className="space-y-1" style={{ fontSize: 13 }}>
        <div
          className="flex gap-4 bg-white dark:bg-slate-800 rounded-sm px-3 py-2 border border-slate-200 dark:border-slate-700"
          style={{ animation: 'fcRowStay 7s ease infinite' }}
        >
          <span className="text-slate-700 dark:text-slate-300 font-medium">Johnson</span>
          <span className="text-green-600 dark:text-green-400">Active</span>
          <span className="text-slate-500">Housing</span>
        </div>
        <div
          className="flex gap-4 bg-white dark:bg-slate-800 rounded-sm px-3 py-2 border border-slate-200 dark:border-slate-700"
          style={{ animation: 'fcRowFade 7s ease 0.5s infinite' }}
        >
          <span className="text-slate-700 dark:text-slate-300 font-medium">Smith</span>
          <span className="text-red-500">Closed</span>
          <span className="text-slate-500">Medical</span>
        </div>
        <div
          className="flex gap-4 bg-white dark:bg-slate-800 rounded-sm px-3 py-2 border border-slate-200 dark:border-slate-700"
          style={{ animation: 'fcRowStay 7s ease infinite' }}
        >
          <span className="text-slate-700 dark:text-slate-300 font-medium">Garcia</span>
          <span className="text-green-600 dark:text-green-400">Active</span>
          <span className="text-slate-500">Housing</span>
        </div>
        <div
          className="flex gap-4 bg-white dark:bg-slate-800 rounded-sm px-3 py-2 border border-slate-200 dark:border-slate-700"
          style={{ animation: 'fcRowFade 7s ease 0.3s infinite' }}
        >
          <span className="text-slate-700 dark:text-slate-300 font-medium">Williams</span>
          <span className="text-yellow-600 dark:text-yellow-400">Pending</span>
          <span className="text-slate-500">Legal</span>
        </div>
      </div>
    </DemoWrapper>
  )
}
