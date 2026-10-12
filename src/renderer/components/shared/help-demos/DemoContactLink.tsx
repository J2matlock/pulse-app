import { DemoWrapper } from './DemoWrapper'
import { useVocab } from '../../../hooks/useVocab'

export function DemoContactLink() {
  const { t } = useVocab(null)
  return (
    <DemoWrapper>
      <style>{`
        @keyframes clLeft {
          0%, 10% { opacity: 0; transform: translateX(-20px); }
          20%, 80% { opacity: 1; transform: translateX(0); }
          90%, 100% { opacity: 0; transform: translateX(-20px); }
        }
        @keyframes clRight {
          0%, 15% { opacity: 0; transform: translateX(20px); }
          25%, 80% { opacity: 1; transform: translateX(0); }
          90%, 100% { opacity: 0; transform: translateX(20px); }
        }
        @keyframes clLine {
          0%, 25% { width: 0; opacity: 0; }
          35%, 75% { width: 100%; opacity: 1; }
          85%, 100% { width: 0; opacity: 0; }
        }
        @keyframes clArrows {
          0%, 35% { opacity: 0; }
          45%, 70% { opacity: 1; }
          80%, 100% { opacity: 0; }
        }
      `}</style>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">Two-way {t('record')}–{t('contact')} linking</div>
      <div className="flex items-center justify-between gap-2">
        {/* Client card */}
        <div
          className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 text-center flex-1"
          style={{ animation: 'clLeft 8s ease infinite', fontSize: 15 }}
        >
          <div className="text-blue-700 dark:text-blue-300 font-medium">Maria Johnson</div>
          <div className="text-sm text-blue-500 dark:text-blue-400">{t('record', { cap: true })}</div>
        </div>
        {/* Connecting line with arrows */}
        <div className="flex-1 flex items-center justify-center relative" style={{ minWidth: 60 }}>
          <div
            className="h-0.5 bg-slate-400 dark:bg-slate-500 absolute"
            style={{ animation: 'clLine 8s ease infinite' }}
          />
          <div
            className="text-slate-500 dark:text-slate-400 text-sm absolute flex gap-8"
            style={{ animation: 'clArrows 8s ease infinite' }}
          >
            <span>◀</span>
            <span>▶</span>
          </div>
        </div>
        {/* Provider card */}
        <div
          className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg px-3 py-2 text-center flex-1"
          style={{ animation: 'clRight 8s ease infinite', fontSize: 15 }}
        >
          <div className="text-green-700 dark:text-green-300 font-medium">Dr. Rivera</div>
          <div className="text-sm text-green-500 dark:text-green-400">{t('contact', { cap: true })}</div>
        </div>
      </div>
      <div className="text-sm text-slate-500 dark:text-slate-400 text-center mt-3">Links visible from both the {t('record')} profile and the {t('contact')} details</div>
    </DemoWrapper>
  )
}
