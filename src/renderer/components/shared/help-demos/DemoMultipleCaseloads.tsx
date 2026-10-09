import { DemoWrapper } from './DemoWrapper'
import { useVocab } from '../../../hooks/useVocab'

export function DemoMultipleCaseloads() {
  const { t } = useVocab(null)
  const caseloads = ['Housing Team', 'Mental Health', 'Youth Services']
  return (
    <DemoWrapper>
      <style>{`
        @keyframes mcSlideIn {
          0%, 10% { opacity: 0; transform: translateX(-12px); }
          20%, 80% { opacity: 1; transform: translateX(0); }
          90%, 100% { opacity: 0; transform: translateX(-12px); }
        }
        @keyframes mcNewItem {
          0%, 50% { opacity: 0; max-height: 0; }
          60%, 80% { opacity: 1; max-height: 40px; }
          90%, 100% { opacity: 0; max-height: 0; }
        }
        @keyframes mcPlusClick {
          0%, 45% { transform: scale(1); background: transparent; }
          48% { transform: scale(1.2); background: rgba(59,130,246,0.2); }
          52%, 100% { transform: scale(1); background: transparent; }
        }
      `}</style>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Multiple {t('list', { many: true })} in sidebar</div>
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 max-w-[200px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{t('list', { many: true, cap: true })}</span>
          <div
            className="w-5 h-5 rounded-sm flex items-center justify-center text-blue-600 dark:text-blue-400 cursor-pointer"
            style={{ animation: 'mcPlusClick 8s ease infinite', fontSize: 16 }}
          >
            +
          </div>
        </div>
        {/* Existing caseloads */}
        {caseloads.map((name, i) => (
          <div
            key={name}
            className={`px-2 py-1.5 rounded-sm text-sm ${i === 0 ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium' : 'text-slate-600 dark:text-slate-400'}`}
            style={{ animation: `mcSlideIn 8s ease ${i * 0.3}s infinite` }}
          >
            {name}
          </div>
        ))}
        {/* New caseload appearing */}
        <div
          className="px-2 py-1.5 rounded-sm text-sm text-green-600 dark:text-green-400 font-medium bg-green-50 dark:bg-green-900/20 overflow-hidden"
          style={{ animation: 'mcNewItem 8s ease infinite' }}
        >
          + New {t('list')}
        </div>
      </div>
    </DemoWrapper>
  )
}
