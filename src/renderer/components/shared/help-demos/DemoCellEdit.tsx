import { DemoWrapper } from './DemoWrapper'

export function DemoCellEdit() {
  return (
    <DemoWrapper>
      <style>{`
        @keyframes cellEditCycle {
          0%, 10% { opacity: 0; }
          15% { opacity: 1; }
          20%, 60% { opacity: 1; }
          70% { opacity: 1; }
          85%, 100% { opacity: 0; }
        }
        @keyframes cellHighlight {
          0%, 14% { background: transparent; }
          15%, 75% { background: rgba(59,130,246,0.15); }
          80%, 100% { background: transparent; }
        }
        @keyframes typeText {
          0%, 20% { width: 0; }
          25% { width: 1ch; }
          30% { width: 2ch; }
          35% { width: 3ch; }
          40% { width: 4ch; }
          45%, 70% { width: 6ch; }
          80%, 100% { width: 0; }
        }
        @keyframes showCheck {
          0%, 55% { opacity: 0; transform: scale(0.5); }
          65%, 75% { opacity: 1; transform: scale(1); }
          85%, 100% { opacity: 0; transform: scale(0.5); }
        }
      `}</style>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Inline cell editing</div>
      <div className="grid grid-cols-3 gap-px bg-slate-300 dark:bg-slate-600 rounded-lg overflow-hidden" style={{ fontSize: 13 }}>
        {['Name', 'Status', 'Due Date'].map(h => (
          <div key={h} className="bg-slate-200 dark:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">{h}</div>
        ))}
        <div className="bg-white dark:bg-slate-800 px-3 py-2 text-slate-700 dark:text-slate-300">Johnson</div>
        <div
          className="bg-white dark:bg-slate-800 px-3 py-2 text-slate-700 dark:text-slate-300 relative"
          style={{ animation: 'cellHighlight 6s ease infinite' }}
        >
          <span
            className="inline-block overflow-hidden whitespace-nowrap text-blue-600 dark:text-blue-400 font-medium"
            style={{ animation: 'typeText 6s steps(6) infinite' }}
          >
            Active
          </span>
          <span
            className="absolute right-2 top-1/2 -translate-y-1/2 text-green-500"
            style={{ animation: 'showCheck 6s ease infinite' }}
          >
            ✓
          </span>
        </div>
        <div className="bg-white dark:bg-slate-800 px-3 py-2 text-slate-700 dark:text-slate-300">03/15</div>
        <div className="bg-white dark:bg-slate-800 px-3 py-2 text-slate-700 dark:text-slate-300">Smith</div>
        <div className="bg-white dark:bg-slate-800 px-3 py-2 text-slate-700 dark:text-slate-300">Pending</div>
        <div className="bg-white dark:bg-slate-800 px-3 py-2 text-slate-700 dark:text-slate-300">04/01</div>
      </div>
    </DemoWrapper>
  )
}
