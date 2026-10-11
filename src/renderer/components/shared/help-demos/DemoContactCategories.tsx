import { DemoWrapper } from './DemoWrapper'
import { useVocab } from '../../../hooks/useVocab'

export function DemoContactCategories() {
  const { t } = useVocab(null)
  const cats = [
    { name: 'Medical', color: '#ef4444', count: 8 },
    { name: 'Housing', color: '#f59e0b', count: 5 },
    { name: 'Legal', color: '#8b5cf6', count: 3 },
    { name: 'Mental Health', color: '#22c55e', count: 6 },
    { name: 'Transportation', color: '#3b82f6', count: 2 },
  ]
  return (
    <DemoWrapper>
      <style>{`
        @keyframes ccPop {
          0%, 5% { opacity: 0; transform: scale(0.8); }
          15%, 80% { opacity: 1; transform: scale(1); }
          90%, 100% { opacity: 0; transform: scale(0.8); }
        }
        @keyframes ccCustom {
          0%, 55% { opacity: 0; max-width: 0; }
          65%, 80% { opacity: 1; max-width: 140px; }
          90%, 100% { opacity: 0; max-width: 0; }
        }
      `}</style>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{t('contact', { cap: true })} categories with colors</div>
      <div className="flex flex-wrap gap-2 mb-3">
        {cats.map((c, i) => (
          <div
            key={c.name}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            style={{ animation: `ccPop 8s ease ${i * 0.4}s infinite`, fontSize: 12 }}
          >
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
            <span className="text-slate-700 dark:text-slate-300 font-medium">{c.name}</span>
            <span className="text-slate-500 dark:text-slate-400 text-xs">{c.count}</span>
          </div>
        ))}
        {/* New custom category appearing */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 overflow-hidden"
          style={{ animation: 'ccCustom 8s ease infinite', fontSize: 12 }}
        >
          <span className="text-green-600 dark:text-green-400">+</span>
          <span className="text-green-700 dark:text-green-300 font-medium whitespace-nowrap">Custom Category</span>
        </div>
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 text-center">
        Each category has a color and optional custom fields
      </div>
    </DemoWrapper>
  )
}
