import { DemoWrapper } from './DemoWrapper'

export function DemoGrouping() {
  return (
    <DemoWrapper>
      <style>{`
        @keyframes grpHeader {
          0%, 15% { opacity: 0; transform: translateX(-12px); height: 0; }
          25%, 75% { opacity: 1; transform: translateX(0); height: 28px; }
          85%, 100% { opacity: 0; transform: translateX(-12px); height: 0; }
        }
        @keyframes grpRowIndent {
          0%, 20% { padding-left: 12px; }
          30%, 75% { padding-left: 28px; }
          85%, 100% { padding-left: 12px; }
        }
      `}</style>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Group by column value</div>
      <div className="space-y-0.5" style={{ fontSize: 13 }}>
        {/* Group 1 header */}
        <div
          className="font-semibold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-sm px-3 overflow-hidden"
          style={{ animation: 'grpHeader 8s ease infinite' }}
        >
          Active (3)
        </div>
        {['Johnson', 'Garcia', 'Lee'].map((name, i) => (
          <div
            key={name}
            className="flex gap-4 bg-white dark:bg-slate-800 rounded-sm py-1.5 border border-slate-100 dark:border-slate-700"
            style={{ animation: `grpRowIndent 8s ease ${i * 0.1}s infinite` }}
          >
            <span className="text-slate-700 dark:text-slate-300 font-medium">{name}</span>
            <span className="text-green-600 dark:text-green-400">Active</span>
          </div>
        ))}
        {/* Group 2 header */}
        <div
          className="font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm px-3 overflow-hidden"
          style={{ animation: 'grpHeader 8s ease 0.5s infinite' }}
        >
          Closed (2)
        </div>
        {['Smith', 'Williams'].map((name, i) => (
          <div
            key={name}
            className="flex gap-4 bg-white dark:bg-slate-800 rounded-sm py-1.5 border border-slate-100 dark:border-slate-700"
            style={{ animation: `grpRowIndent 8s ease ${0.5 + i * 0.1}s infinite` }}
          >
            <span className="text-slate-700 dark:text-slate-300 font-medium">{name}</span>
            <span className="text-red-500">Closed</span>
          </div>
        ))}
      </div>
    </DemoWrapper>
  )
}
