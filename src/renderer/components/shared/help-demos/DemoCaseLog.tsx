import { DemoWrapper } from './DemoWrapper'
import { useVocab } from '../../../hooks/useVocab'

export function DemoCaseLog() {
  const { t } = useVocab(null)
  return (
    <DemoWrapper>
      <style>{`
        @keyframes logType {
          0%, 15% { width: 0; }
          20% { width: 5ch; }
          25% { width: 10ch; }
          30% { width: 18ch; }
          35%, 50% { width: 26ch; }
          55%, 100% { width: 26ch; }
        }
        @keyframes logEntry {
          0%, 52% { opacity: 0; transform: translateY(-8px); max-height: 0; }
          60%, 85% { opacity: 1; transform: translateY(0); max-height: 60px; }
          95%, 100% { opacity: 0; transform: translateY(-8px); max-height: 0; }
        }
        @keyframes logBtn {
          0%, 40% { background: rgb(59,130,246); }
          45% { background: rgb(34,197,94); }
          55%, 100% { background: rgb(59,130,246); }
        }
      `}</style>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Adding {t('activity', { article: true })}</div>
      {/* Input area */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 mb-2 flex items-center gap-2">
        <span
          className="inline-block overflow-hidden whitespace-nowrap text-[15px] text-slate-700 dark:text-slate-300"
          style={{ animation: 'logType 8s steps(26) infinite' }}
        >
          Phone call — all is well
        </span>
        <span className="w-0.5 h-4 bg-blue-500 animate-pulse shrink-0" />
        <button
          className="ml-auto px-2 py-1 rounded-sm text-white text-xs font-medium shrink-0"
          style={{ animation: 'logBtn 8s ease infinite', background: 'rgb(59,130,246)' }}
        >
          Add
        </button>
      </div>
      {/* New entry appearing */}
      <div
        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 overflow-hidden"
        style={{ animation: 'logEntry 8s ease infinite', fontSize: 13 }}
      >
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
          <span>📝</span>
          <span className="font-medium">Phone call — all is well</span>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Today at 2:30 PM · You</div>
      </div>
      {/* Existing entries */}
      <div className="mt-1 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-lg px-3 py-2" style={{ fontSize: 13 }}>
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <span>📋</span>
          <span>Home visit completed</span>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Yesterday · You</div>
      </div>
    </DemoWrapper>
  )
}
