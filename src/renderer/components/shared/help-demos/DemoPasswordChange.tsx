import { DemoWrapper } from './DemoWrapper'

export function DemoPasswordChange() {
  const fields = ['Current password', 'New password', 'Confirm password']
  return (
    <DemoWrapper>
      <style>{`
        @keyframes pcDots {
          0%, 10% { width: 0; }
          30%, 65% { width: 80px; }
          80%, 100% { width: 0; }
        }
        @keyframes pcSuccess {
          0%, 55% { opacity: 0; transform: scale(0.8); }
          65%, 80% { opacity: 1; transform: scale(1); }
          90%, 100% { opacity: 0; transform: scale(0.8); }
        }
      `}</style>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">Password change flow</div>
      <div className="space-y-2 mb-3">
        {fields.map((f, i) => (
          <div key={f} className="flex items-center gap-3">
            <span className="text-sm text-slate-500 dark:text-slate-400 w-36 shrink-0">{f}</span>
            <div className="flex-1 h-8 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-sm px-2 flex items-center overflow-hidden">
              <div
                className="text-slate-700 dark:text-slate-300 tracking-widest overflow-hidden whitespace-nowrap"
                style={{ animation: `pcDots 8s ease ${i * 0.8}s infinite`, fontSize: 18, lineHeight: '8px' }}
              >
                ••••••••
              </div>
            </div>
          </div>
        ))}
      </div>
      <div
        className="flex items-center justify-center gap-2 bg-green-50 dark:bg-green-900/30 rounded-lg py-2"
        style={{ animation: 'pcSuccess 8s ease infinite' }}
      >
        <span className="text-green-600 dark:text-green-400 text-lg">✓</span>
        <span className="text-sm font-medium text-green-700 dark:text-green-300">Password changed!</span>
      </div>
    </DemoWrapper>
  )
}
