import { DemoWrapper } from './DemoWrapper'

export function DemoTaskPriorities() {
  const tasks = [
    { title: 'Follow up with housing', priority: 'Urgent', color: 'border-l-red-500', badge: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
    { title: 'Update care plan', priority: 'High', color: 'border-l-orange-500', badge: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' },
    { title: 'Schedule appointment', priority: 'Medium', color: 'border-l-blue-500', badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
    { title: 'File quarterly report', priority: 'Low', color: 'border-l-slate-400', badge: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400' },
  ]
  return (
    <DemoWrapper>
      <style>{`
        @keyframes tpSlide {
          0%, 5% { opacity: 0; transform: translateX(-12px); }
          15%, 80% { opacity: 1; transform: translateX(0); }
          90%, 100% { opacity: 0; transform: translateX(-12px); }
        }
      `}</style>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Task priority levels</div>
      <div className="space-y-1.5">
        {tasks.map((t, i) => (
          <div
            key={t.title}
            className={`flex items-center gap-3 bg-white dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-slate-700 border-l-4 ${t.color}`}
            style={{ animation: `tpSlide 8s ease ${i * 0.5}s infinite`, fontSize: 15 }}
          >
            <div className="flex-1 text-slate-700 dark:text-slate-300">{t.title}</div>
            <span className={`px-2 py-0.5 rounded-full text-sm font-medium ${t.badge}`}>{t.priority}</span>
          </div>
        ))}
      </div>
    </DemoWrapper>
  )
}
