/**
 * logger.ts — Structured logging for the main process.
 * Outputs JSON-formatted log lines with level, timestamp, component, and message.
 * In dev mode, also pretty-prints to console for readability.
 * In production, also writes to a rotating log file in <Pulse data folder>/logs.
 */

import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { getPortableDataDir } from './data-dir'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'

const SESSION_ID = randomUUID().slice(0, 8)

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const MIN_LEVEL: LogLevel = (() => {
  const env = process.env.PULSE_LOG_LEVEL?.toLowerCase()
  if (env && env in LEVEL_ORDER) return env as LogLevel
  return 'info'
})()

const LOG_FILE_NAME = 'pulse-main.log'
const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5 MB
const MAX_LOG_FILES = 7

let logDirEnsured = false

// Logs live inside the Pulse data folder (with everything else Pulse writes), so
// they move with a portable install and are removed by "Reset everything".
// They never contain client data; see sanitize() below.
function ensureLogDir(): string {
  const logDir = join(getPortableDataDir(), 'logs')
  if (!logDirEnsured) {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true })
    }
    logDirEnsured = true
  }
  return logDir
}

function writeToLogFile(line: string): void {
  const logDir = ensureLogDir()
  const logPath = join(logDir, LOG_FILE_NAME)

  // Size-based rotation: if file exceeds 5MB, rotate up to MAX_LOG_FILES backups
  // Rename .(N-1)→.N, ..., .1→.2, current→.1, then create fresh current
  try {
    if (existsSync(logPath)) {
      const stats = statSync(logPath)
      if (stats.size >= MAX_LOG_SIZE) {
        for (let i = MAX_LOG_FILES; i >= 2; i--) {
          const src = join(logDir, `${LOG_FILE_NAME}.${i - 1}`)
          const dst = join(logDir, `${LOG_FILE_NAME}.${i}`)
          try { if (existsSync(src)) renameSync(src, dst) } catch (err) { console.error('Logger internal error:', err) }
        }
        renameSync(logPath, join(logDir, `${LOG_FILE_NAME}.1`))
      }
    }
  } catch (err) {
    // If rotation fails, continue writing to the current file
    console.error('Logger internal error:', err)
  }

  try {
    appendFileSync(logPath, line + '\n')
  } catch (err) {
    // If file write fails, stderr is still available as fallback
    console.error('Logger internal error:', err)
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL]
}

function sanitizeString(value: string): string {
  return value.replace(/[0-9a-f]{64}/gi, '[REDACTED_KEY]')
    .replace(/password['":\s]*['"][^'"]+['"]/gi, 'password: [REDACTED]')
}

function sanitize(data: unknown, depth = 0, maxDepth = 5): unknown {
  if (data === null || data === undefined) return data
  if (depth > maxDepth) return '[MAX_DEPTH]'

  if (data instanceof Error) {
    return { message: data.message, stack: data.stack }
  }
  if (typeof data === 'string') {
    return sanitizeString(data)
  }
  if (typeof data === 'number' || typeof data === 'boolean') {
    return data
  }
  if (Array.isArray(data)) {
    return data.map(item => sanitize(item, depth + 1, maxDepth))
  }
  if (typeof data === 'object') {
    const SENSITIVE_KEYS = /^(password|secret|token|salt|recovery_key|wrapped_key|ssn|email|phone|address|hint|display_name|first_name|last_name|full_name|client_name|content|notes|scratch_pad|body)$/i
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(key)) {
        result[key] = '[REDACTED]'
        continue
      }
      result[key] = sanitize(value, depth + 1, maxDepth)
    }
    return result
  }
  return data
}

function log(level: LogLevel, component: string, message: string, data?: unknown, correlationId?: string): void {
  if (!shouldLog(level)) return

  const entry = {
    ts: new Date().toISOString(),
    level,
    session: SESSION_ID,
    ...(correlationId ? { corrId: correlationId } : {}),
    component,
    msg: message,
    ...(data !== undefined ? { data: sanitize(data) } : {})
  }

  const line = JSON.stringify(entry)

  // In packaged app, write structured JSON to stderr and to rotating log file
  // In dev mode, pretty-print to console for readability
  if (app.isPackaged) {
    process.stderr.write(line + '\n')
    writeToLogFile(line)
  } else {
    const prefix = `[${level.toUpperCase()}] [${component}]`
    const sanitizedData = data !== undefined ? sanitize(data) : ''
    if (level === 'error') console.error(prefix, message, sanitizedData)
    else if (level === 'warn') console.warn(prefix, message, sanitizedData)
    else console.log(prefix, message, sanitizedData)
  }
}

export const logger = {
  debug: (component: string, msg: string, data?: unknown, correlationId?: string) => log('debug', component, msg, data, correlationId),
  info: (component: string, msg: string, data?: unknown, correlationId?: string) => log('info', component, msg, data, correlationId),
  warn: (component: string, msg: string, data?: unknown, correlationId?: string) => log('warn', component, msg, data, correlationId),
  error: (component: string, msg: string, data?: unknown, correlationId?: string) => log('error', component, msg, data, correlationId),
}
