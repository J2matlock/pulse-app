import { DemoWrapper } from './DemoWrapper'
import { useVocab } from '../../../hooks/useVocab'

export function DemoAvailabilityStatus() {
  const { t } = useVocab(null)
  const statuses = [
    { name: 'Dr. Rivera', org: 'City Health', status: 'Accepting', color: '#22c55e', bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
    { name: 'Safe Haven', org: 'Housing Services', status: 'Waitlist', color: '#f59e0b', bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400' },
    { name: 'Legal Aid Clinic', org: 'County Legal', status: 'Full', color: '#ef4444', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' },
    { name: 'Community Center', org: 'Resources Inc.', status: 'Unknown', color: '#94a3b8', bg: 'bg-slate-100 dark:bg-slate-700/50', text: 'text-slate-600 dark:text-slate-400' },
  ]
  return (
    <DemoWrapper>
      <style>{`
        @keyframes avCard {
          0%, 5% { opacity: 0; transform: translateY(8px); }
          15%, 80% { opacity: 1; transform: translateY(0); }
          90%, 100% { opacity: 0; transform: translateY(8px); }
        }
        @keyframes avStaleness {
          0%, 60% { opacity: 0; }
          70%, 85% { opacity: 1; }
          95%, 100% { opacity: 0; }
        }
      `}</style>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{t('contact', { cap: true })} availability statuses</div>
      <div className="space-y-1.5">
        {statuses.map((s, i) => (
          <div
            key={s.name}
            className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-slate-700"
            style={{ animation: `avCard 9s ease ${i * 0.6}s infinite`, fontSize: 13 }}
          >
            {/* Color stripe */}
            <div className="w-1 h-8 rounded-full shrink-0" style={{ background: s.color }} />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-700 dark:text-slate-300 truncate">{s.name}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{s.org}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
                {s.status}
              </span>
              {s.status === 'Unknown' && (
                <span
                  className="text-xs text-slate-500 dark:text-slate-400 italic"
                  style={{ animation: `avStaleness 9s ease ${i * 0.6}s infinite` }}
                >
                  90d ago
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </DemoWrapper>
  )
}
