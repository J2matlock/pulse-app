import { DemoWrapper } from './DemoWrapper'
import { modHelp } from '../../../utils/keys'

export function DemoUndoRedo() {
  return (
    <DemoWrapper>
      <style>{`
        @keyframes urOld {
          0%, 15% { opacity: 1; }
          25%, 55% { opacity: 0; }
          70%, 100% { opacity: 1; }
        }
        @keyframes urNew {
          0%, 20% { opacity: 0; }
          30%, 50% { opacity: 1; }
          60%, 100% { opacity: 0; }
        }
        @keyframes urStrike {
          0%, 20% { width: 0; }
          28% { width: 100%; }
          55% { width: 100%; }
          60%, 100% { width: 0; }
        }
        @keyframes urUndoBtn {
          0%, 50% { transform: scale(1); color: inherit; }
          55% { transform: scale(1.3); }
          60% { transform: scale(1); }
          65%, 100% { transform: scale(1); }
        }
      `}</style>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Undo / redo in action</div>
      <div className="flex items-center gap-4 mb-4">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 relative" style={{ minWidth: 120 }}>
          <span className="text-[15px] text-green-600 dark:text-green-400 font-medium" style={{ animation: 'urOld 7s ease infinite' }}>Active</span>
          <span className="text-[15px] text-red-500 font-medium absolute left-4 top-3" style={{ animation: 'urNew 7s ease infinite' }}>Closed</span>
          <div className="absolute left-4 top-1/2 h-0.5 bg-red-400" style={{ animation: 'urStrike 7s ease infinite', transform: 'translateY(-50%)' }} />
        </div>
        <div
          className="flex items-center gap-1 text-blue-600 dark:text-blue-400"
          style={{ animation: 'urUndoBtn 7s ease infinite' }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M5 10l4-4M5 10l4 4M5 10h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-xs font-medium">Undo</span>
        </div>
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 text-center">{modHelp('Cell value reverts instantly with Ctrl+Z')}</div>
    </DemoWrapper>
  )
}
