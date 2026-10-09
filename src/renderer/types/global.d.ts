import type { IPCChannel } from '../../shared/ipc-channels'
import type { IPCContract, ContractChannel } from '../../shared/ipc-contract'

declare global {
  interface Window {
    api: {
      invoke: {
        /** Typed overload: channels in IPCContract get inferred args/return. */
        <C extends ContractChannel>(channel: C, ...args: IPCContract[C]['args']): Promise<IPCContract[C]['return']>
        /** Fallback: untyped channels still accept unknown args and return unknown. */
        (channel: IPCChannel, ...args: unknown[]): Promise<unknown>
      }
      on: (channel: IPCChannel, callback: (...args: unknown[]) => void) => () => void
      copyToClipboard: (text: string) => void
      setZoomFactor: (factor: number) => void
      /** A dropped file's path on disk ('' when there isn't one) */
      pathForFile?: (file: File) => string
    }
    __pulseUnhandledRejectionRegistered?: boolean
  }
}
