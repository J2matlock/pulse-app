import { DemoWrapper } from './DemoWrapper'

export function DemoDeadlineColors() {
  const stages = [
    { label: '30 days', color: '#22c55e', delay: 0 },
    { label: '14 days', color: '#eab308', delay: 1 },
    { label: '7 days',  color: '#f97316', delay: 2 },
    { label: '3 days',  color: '#ef4444', delay: 3 },
    { label: 'Overdue', color: '#ef4444', delay: 4, pulse: true },
  ]
  return (
    <DemoWrapper>
      <style>{`
        @keyframes dlBarIn {
          0%, 5% { transform: scaleX(0); opacity: 0; }
          15%, 85% { transform: scaleX(1); opacity: 1; }
          95%, 100% { transform: scaleX(0); opacity: 0; }
        }
        @keyframes dlPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">Deadline color progression</div>
      <div className="space-y-2">
        {stages.map((s, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-sm text-slate-500 dark:text-slate-400 w-16 text-right shrink-0">{s.label}</span>
            <div className="flex-1 h-6 rounded-md overflow-hidden bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-md origin-left"
                style={{
                  background: s.color,
                  animation: `dlBarIn 8s ease ${s.delay * 1.2}s infinite${s.pulse ? ', dlPulse 0.8s ease-in-out infinite' : ''}`,
                  width: '100%',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </DemoWrapper>
  )
}
