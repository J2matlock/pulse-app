import { DemoWrapper } from './DemoWrapper'
import { useVocab } from '../../../hooks/useVocab'

export function DemoActivityTimeline() {
  const { t } = useVocab(null)
  const events = [
    { time: '2:30 PM', icon: '✏️', text: 'Status changed to Active', type: 'edit' },
    { time: '1:15 PM', icon: '📝', text: `${t('activity', { cap: true })}: Phone follow-up`, type: 'log' },
    { time: '11:00 AM', icon: '📎', text: 'Document attached', type: 'doc' },
    { time: 'Yesterday', icon: '🔄', text: 'Referral sent to Dr. Rivera', type: 'ref' },
  ]
  return (
    <DemoWrapper>
      <style>{`
        @keyframes atSlideIn {
          0%, 5% { opacity: 0; transform: translateX(-16px); }
          15%, 80% { opacity: 1; transform: translateX(0); }
          90%, 100% { opacity: 0; transform: translateX(-16px); }
        }
        @keyframes atLine {
          0%, 5% { height: 0; }
          20%, 80% { height: 100%; }
          90%, 100% { height: 0; }
        }
      `}</style>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Activity timeline</div>
      <div className="relative pl-6 space-y-2">
        {/* Vertical line */}
        <div className="absolute left-2 top-1 bottom-1 w-0.5 bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div className="w-full bg-blue-300 dark:bg-blue-600" style={{ animation: 'atLine 9s ease infinite' }} />
        </div>
        {events.map((e, i) => (
          <div
            key={i}
            className="flex items-start gap-2 relative"
            style={{ animation: `atSlideIn 9s ease ${i * 0.7}s infinite`, fontSize: 15 }}
          >
            {/* Dot on timeline */}
            <div className="absolute -left-[17px] top-1.5 w-2 h-2 rounded-full bg-blue-500 border-2 border-white dark:border-slate-800" />
            <div className="flex-1 bg-white dark:bg-slate-800 rounded-lg px-3 py-1.5 border border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <span>{e.icon}</span>
                <span className="text-slate-700 dark:text-slate-300">{e.text}</span>
              </div>
              <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{e.time}</div>
            </div>
          </div>
        ))}
      </div>
    </DemoWrapper>
  )
}
