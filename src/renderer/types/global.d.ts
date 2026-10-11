import type { IPCChannel } from '../../shared/ipc-channels'
import type { IPCResult } from '../../shared/types'
import type { IPCContract, ContractChannel } from '../../shared/ipc-contract'

declare global {
  interface Window {
    api: {
      invoke: {
        /** Typed overload: channels in IPCContract get inferred args; main answers with the { ok, data } wrapper. */
        <C extends ContractChannel>(channel: C, ...args: IPCContract[C]['args']): Promise<IPCResult<IPCContract[C]['return']>>
        /** Fallback: untyped channels still accept unknown args and return unknown. */
        (channel: IPCChannel, ...args: unknown[]): Promise<unknown>
      }
      on: (channel: IPCChannel, callback: (...args: unknown[]) => void) => () => void
      /** Main can refuse (text too large, untrusted sender): check `ok` before saying it was copied */
      copyToClipboard: (text: string) => Promise<IPCResult<true>>
      setZoomFactor: (factor: number) => void
      /** A dropped file's path on disk ('' when there isn't one) */
      pathForFile?: (file: File) => string
    }
    __pulseUnhandledRejectionRegistered?: boolean
  }
}
