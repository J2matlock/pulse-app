/**
 * Thin structured-log wrapper for renderer process.
 * Errors and warnings are forwarded to the main process via IPC
 * so they get written to the structured log file in production.
 */

function forwardToMain(level: string, component: string, msg: string, data?: unknown): void {
  try {
    window.api?.invoke('log:forward', { level, component, msg, data });
  } catch {
    console.error(`[Pulse:${component}] ${msg}`, data !== undefined ? data : '')
  }
}

export const rlog = {
  error(tag: string, msg: string, error?: unknown): void {
    console.error(`[${tag}]`, msg, ...(error !== undefined ? [error] : []));
    forwardToMain('error', tag, msg, error instanceof Error ? { message: error.message, stack: error.stack } : error);
  },
  warn(tag: string, msg: string, ...args: unknown[]): void {
    console.warn(`[${tag}]`, msg, ...args);
    forwardToMain('warn', tag, msg, args.length > 0 ? args[0] : undefined);
  },
  info(tag: string, msg: string, ...args: unknown[]): void {
    console.info(`[${tag}]`, msg, ...args);
    forwardToMain('info', tag, msg, args.length > 0 ? args[0] : undefined);
  },
};
