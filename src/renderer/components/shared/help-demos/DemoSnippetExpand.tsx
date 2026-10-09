import { DemoWrapper } from './DemoWrapper'

export function DemoSnippetExpand() {
  return (
    <DemoWrapper>
      <style>{`
        @keyframes snTrigger {
          0%, 5% { width: 0; }
          10% { width: 1ch; }
          15% { width: 2ch; }
          20%, 30% { width: 3ch; }
          35%, 100% { width: 0; }
        }
        @keyframes snExpand {
          0%, 32% { opacity: 0; max-height: 0; }
          40%, 75% { opacity: 1; max-height: 80px; }
          85%, 100% { opacity: 0; max-height: 0; }
        }
        @keyframes snFlash {
          0%, 35% { background: transparent; }
          40% { background: rgba(59,130,246,0.15); }
          55%, 100% { background: transparent; }
        }
      `}</style>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Snippet expansion</div>
      {/* Fake textarea */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3" style={{ minHeight: 100 }}>
        {/* Trigger text */}
        <span
          className="inline-block overflow-hidden whitespace-nowrap text-[15px] text-blue-600 dark:text-blue-400 font-mono font-medium"
          style={{ animation: 'snTrigger 8s steps(3) infinite' }}
        >
          /hw
        </span>
        {/* Expanded text */}
        <div
          className="text-[15px] text-slate-700 dark:text-slate-300 leading-relaxed overflow-hidden rounded-sm"
          style={{ animation: 'snExpand 8s ease infinite, snFlash 8s ease infinite' }}
        >
          Reported stable housing with no concerns.
        </div>
      </div>
      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 text-center">
        Type <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded-sm">/hw</code> → expands to full note
      </div>
    </DemoWrapper>
  )
}
