import { DemoWrapper } from './DemoWrapper'

export function DemoKeyboardNav() {
  return (
    <DemoWrapper>
      <style>{`
        @keyframes knMove {
          0%, 10% { grid-column: 1; grid-row: 2; }
          20%, 30% { grid-column: 2; grid-row: 2; }
          40%, 50% { grid-column: 3; grid-row: 2; }
          60%, 70% { grid-column: 3; grid-row: 3; }
          80%, 90% { grid-column: 2; grid-row: 3; }
          95%, 100% { grid-column: 1; grid-row: 2; }
        }
        @keyframes knKey {
          0%, 8% { opacity: 0; }
          10%, 18% { opacity: 1; }
          20%, 28% { opacity: 0; }
          30%, 38% { opacity: 1; }
          40%, 100% { opacity: 0; }
        }
      `}</style>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Keyboard navigation</div>
      <div className="relative">
        <div className="grid grid-cols-3 gap-px bg-slate-300 dark:bg-slate-600 rounded-lg overflow-hidden" style={{ fontSize: 15 }}>
          {['Name', 'Status', 'Due'].map(h => (
            <div key={h} className="bg-slate-200 dark:bg-slate-700 px-2 py-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{h}</div>
          ))}
          {['Johnson', 'Active', '03/15', 'Smith', 'Pending', '04/01'].map((v, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 px-2 py-1.5 text-slate-700 dark:text-slate-300">{v}</div>
          ))}
          {/* Moving highlight */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'auto repeat(2, 1fr)' }}
          >
            <div
              className="border-2 border-blue-500 rounded-sm m-px"
              style={{ animation: 'knMove 6s steps(1) infinite' }}
            />
          </div>
        </div>
      </div>
      <div className="flex justify-center gap-3 mt-2">
        {['Tab', '↑', '↓', '←', '→'].map(key => (
          <kbd key={key} className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 rounded-sm text-xs font-mono text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-600">
            {key}
          </kbd>
        ))}
      </div>
    </DemoWrapper>
  )
}
