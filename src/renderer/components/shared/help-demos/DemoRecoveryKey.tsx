import { DemoWrapper } from './DemoWrapper'

export function DemoRecoveryKey() {
  return (
    <DemoWrapper>
      <style>{`
        @keyframes rkReveal {
          0%, 10% { filter: blur(8px); opacity: 0.3; }
          25%, 70% { filter: blur(0); opacity: 1; }
          85%, 100% { filter: blur(8px); opacity: 0.3; }
        }
        @keyframes rkCopy {
          0%, 55% { opacity: 0; transform: translateY(4px); }
          60%, 75% { opacity: 1; transform: translateY(0); }
          85%, 100% { opacity: 0; transform: translateY(4px); }
        }
        @keyframes rkShield {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">Recovery key — keep it safe!</div>
      <div className="flex flex-col items-center gap-3">
        <div className="text-3xl" style={{ animation: 'rkShield 3s ease infinite' }}>🔑</div>
        <div
          className="font-mono text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 text-center tracking-wider select-all"
          style={{ animation: 'rkReveal 8s ease infinite' }}
        >
          ABCD-EFGH-IJKL-MNOP
        </div>
        <div
          className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400"
          style={{ animation: 'rkCopy 8s ease infinite' }}
        >
          <span>✓</span>
          <span className="font-medium">Copied to clipboard!</span>
        </div>
        <div className="text-sm text-amber-700 dark:text-amber-400 text-center max-w-[250px]">
          Store this key in a safe place. It's the only way to recover your data if you forget your password.
        </div>
      </div>
    </DemoWrapper>
  )
}
