import React, { useState, useRef, useEffect } from 'react'
import { Copy, Printer } from 'lucide-react'
import { motion } from 'motion/react'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import toast from 'react-hot-toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { copyText } from '../../hooks/useCopyFeedback'
import { PRODUCT_NAME } from '../../../shared/constants'

interface RecoveryKeyDisplayModalProps {
  open: boolean
  recoveryKey: string
  onClose: () => void
}

export function RecoveryKeyDisplayModal({ open, recoveryKey, onClose }: RecoveryKeyDisplayModalProps): React.ReactElement | null {
  const [saved, setSaved] = useState(false)
  // Done was clicked before the box was ticked: say so instead of a silent, full-colour
  // button that does nothing (UX-A-05)
  const [needTick, setNeedTick] = useState(false)
  const printTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const trapRef = useRef<HTMLDivElement>(null)
  const savedRef = useRef<HTMLInputElement>(null)

  useFocusTrap(trapRef, open)

  // Clean up print iframe timer on unmount
  useEffect(() => () => { clearTimeout(printTimerRef.current) }, [])

  async function handleCopy() {
    // copyText says so itself when the copy didn't happen
    // Short-lived: it shouldn't still be in the corner on the next screen (UX-A-31)
    if (await copyText(recoveryKey)) toast.success('Recovery key copied', { duration: 3000 })
  }

  function handleDone() {
    if (!saved) {
      setNeedTick(true)
      savedRef.current?.focus()
      return
    }
    onClose()
  }

  function handlePrint() {
    // Use a hidden iframe to print — Electron blocks window.open() pop-ups
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.left = '-9999px'
    iframe.style.top = '-9999px'
    iframe.style.width = '0'
    iframe.style.height = '0'
    document.body.appendChild(iframe)

    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) {
      toast.error("We couldn't print — copy the key instead")
      document.body.removeChild(iframe)
      return
    }

    doc.open()
    doc.write(`<!DOCTYPE html>
<html><head><title>${PRODUCT_NAME} — Recovery Key</title>
<style>
body { font-family: sans-serif; padding: 40px; text-align: center; }
h1 { font-size: 20px; margin-bottom: 8px; }
p { font-size: 15px; color: #555; margin-bottom: 24px; }
.key { font-family: monospace; font-size: 28px; letter-spacing: 4px; padding: 16px; border: 2px dashed #999; display: inline-block; margin-bottom: 24px; }
.instructions { font-size: 15px; color: #777; text-align: left; max-width: 400px; margin: 0 auto; }
.instructions li { margin-bottom: 6px; }
</style></head><body>
<h1>${PRODUCT_NAME} — Recovery Key</h1>
<p>Keep this card somewhere safe. You will need it if you forget your password.</p>
<div class="key">${recoveryKey}</div>
<ul class="instructions">
<li>Store this in a secure location (lockbox, password manager, etc.)</li>
<li>Do NOT store it on the same computer as your Pulse data</li>
<li>This key can unlock your data if you forget your password</li>
</ul>
</body></html>`)
    doc.close()

    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()

    // Clean up after a delay to allow the print dialog to render
    clearTimeout(printTimerRef.current)
    printTimerRef.current = setTimeout(() => {
      if (iframe.parentNode) document.body.removeChild(iframe)
    }, 5000)
  }

  return (
    <>
      {open && (
        <motion.div variants={backdropVariants} initial="hidden" animate="visible" className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
          <motion.div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="recovery-key-title" variants={modalPanelVariants} initial="hidden" animate="visible" className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-8">
        <h2 id="recovery-key-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
          Your recovery key
        </h2>
        <p className="text-base text-slate-500 dark:text-slate-400 mb-6">
          Write this down or print it. You'll need it if you forget your password.
        </p>

        <div className="bg-slate-100 dark:bg-slate-700 rounded-lg p-5 mb-4 text-center select-all">
          <span className="font-mono text-2xl tracking-widest text-slate-900 dark:text-slate-100">
            {recoveryKey}
          </span>
        </div>

        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg p-3 mb-6">
          <p className="text-amber-800 dark:text-amber-300 text-base leading-relaxed">
            This key will not be shown again. Store it somewhere safe — a lockbox, a password manager, or a printed card in a secure location.
          </p>
        </div>

        <div className="flex gap-3 mb-6">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="btn-secondary flex-1 flex items-center justify-center gap-2"
            style={{ minHeight: 44 }}
          >
            <Copy className="w-4 h-4" />
            Copy
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="btn-secondary flex-1 flex items-center justify-center gap-2"
            style={{ minHeight: 44 }}
          >
            <Printer className="w-4 h-4" />
            Print a recovery card
          </button>
        </div>

        <label className="flex items-center gap-3 mb-4 cursor-pointer select-none">
          <input
            ref={savedRef}
            type="checkbox"
            checked={saved}
            onChange={e => { setSaved(e.target.checked); if (e.target.checked) setNeedTick(false) }}
            aria-describedby={needTick ? 'recovery-key-need-tick' : undefined}
            className="w-5 h-5 accent-blue-600 flex-shrink-0"
          />
          <span className="text-base text-slate-700 dark:text-slate-300">
            I have saved this recovery key somewhere safe
          </span>
        </label>

        <button
          type="button"
          onClick={handleDone}
          className="btn-primary w-full"
          style={{ minHeight: 44 }}
        >
          Done
        </button>
        {needTick && (
          <p id="recovery-key-need-tick" role="alert" className="mt-3 text-base text-red-700 dark:text-red-300">
            Tick “I have saved this recovery key somewhere safe” first.
          </p>
        )}
          </motion.div>
        </motion.div>
      )}
    </>
  )
}
