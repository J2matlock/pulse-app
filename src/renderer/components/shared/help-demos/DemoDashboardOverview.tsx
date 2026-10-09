import { DemoWrapper } from './DemoWrapper'

export function DemoDashboardOverview() {
  const cards = [
    { label: 'Overdue', count: 3, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' },
    { label: 'This Week', count: 8, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20' },
    { label: 'Active Tasks', count: 12, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
    { label: 'Completed', count: 5, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
  ]
  const tabs = ['Priority', 'This Week', 'This Month', 'Completions', 'Archived']
  return (
    <DemoWrapper>
      <style>{`
        @keyframes dbCardPop {
          0%, 5% { opacity: 0; transform: scale(0.85); }
          15%, 80% { opacity: 1; transform: scale(1); }
          90%, 100% { opacity: 0; transform: scale(0.85); }
        }
        @keyframes dbTabSlide {
          0%, 20% { left: 0; }
          30%, 45% { left: 20%; }
          55%, 70% { left: 40%; }
          80%, 100% { left: 0; }
        }
      `}</style>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Dashboard at a glance</div>
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {cards.map((c, i) => (
          <div
            key={c.label}
            className={`${c.bg} rounded-lg p-2 text-center`}
            style={{ animation: `dbCardPop 8s ease ${i * 0.4}s infinite` }}
          >
            <div className={`text-lg font-bold ${c.color}`}>{c.count}</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">{c.label}</div>
          </div>
        ))}
      </div>
      {/* Tab bar */}
      <div className="relative flex gap-1 bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 overflow-hidden">
        {/* Sliding indicator */}
        <div
          className="absolute top-0.5 h-[calc(100%-4px)] w-[20%] bg-white dark:bg-slate-600 rounded-md shadow-xs transition-all"
          style={{ animation: 'dbTabSlide 8s ease infinite' }}
        />
        {tabs.map(tab => (
          <div
            key={tab}
            className="relative z-10 flex-1 text-center py-1 text-[10px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap"
          >
            {tab}
          </div>
        ))}
      </div>
    </DemoWrapper>
  )
}
