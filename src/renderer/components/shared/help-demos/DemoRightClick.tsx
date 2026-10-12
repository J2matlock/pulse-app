import { DemoWrapper } from './DemoWrapper'
import { useVocab } from '../../../hooks/useVocab'

export function DemoRightClick() {
  // Matches the real right-click menu
  const { t } = useVocab(null)
  return (
    <DemoWrapper>
      <style>{`
        @keyframes rcCursorMove {
          0%, 10% { left: 10%; top: 20%; opacity: 0; }
          20% { left: 50%; top: 55%; opacity: 1; }
          30%, 70% { left: 50%; top: 55%; opacity: 1; }
          85%, 100% { left: 50%; top: 55%; opacity: 0; }
        }
        @keyframes rcClickPulse {
          0%, 25% { transform: scale(0); opacity: 0; }
          30% { transform: scale(1.5); opacity: 0.5; }
          35%, 70% { transform: scale(0); opacity: 0; }
          100% { transform: scale(0); opacity: 0; }
        }
        @keyframes rcMenuIn {
          0%, 32% { transform: scale(0.9); opacity: 0; }
          38%, 70% { transform: scale(1); opacity: 1; }
          78%, 100% { transform: scale(0.9); opacity: 0; }
        }
      `}</style>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Right-click context menu</div>
      <div className="relative" style={{ height: 180 }}>
        {/* Fake row */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 mt-6 flex gap-4" style={{ fontSize: 15 }}>
          <span className="text-slate-700 dark:text-slate-300 font-medium">Johnson, Maria</span>
          <span className="text-slate-500">Active</span>
          <span className="text-green-600 dark:text-green-400">Due: 03/15</span>
        </div>
        {/* Cursor */}
        <div
          className="absolute w-4 h-4 pointer-events-none"
          style={{ animation: 'rcCursorMove 7s ease infinite' }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
            <path d="M2 2l5 12 2-5 5-2L2 2z" fill="currentColor" className="text-slate-700 dark:text-slate-200" />
          </svg>
          {/* Click pulse */}
          <div
            className="absolute -left-2 -top-2 w-8 h-8 rounded-full bg-blue-400"
            style={{ animation: 'rcClickPulse 7s ease infinite' }}
          />
        </div>
        {/* Context menu */}
        <div
          className="absolute left-[52%] top-[62%] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ animation: 'rcMenuIn 7s ease infinite', transformOrigin: 'top left', fontSize: 15 }}
        >
          {['Archive', `Duplicate ${t('record')}`, 'Color rules…', 'Move to…'].map(item => (
            <div key={item} className="px-3 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
              {item}
            </div>
          ))}
        </div>
      </div>
    </DemoWrapper>
  )
}
