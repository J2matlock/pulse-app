/**
 * ipc-define.ts — declarative IPC handlers (sweep Phase 3.2 target 3).
 *
 * Most handlers open the same way: secureWrap, the read-only gate for writes,
 * a check per argument that answers with a failure message, then the work.
 * defineHandler composes those steps so a handler states its arguments and
 * whether it writes, and its body is only the work:
 *
 *   const define = handlersFor('ipc-tags')
 *   define(IPC.TAG_DELETE, [idArg()], (tagId) => { ... return ok(true) }, { write: true })
 *
 * Order, the same as the hand-written handlers it replaces:
 * 1. secureWrap: sender check (subframes and foreign pages refused) and the
 *    try/catch that logs and humanizes anything thrown;
 * 2. `write: true` → enforceWritable() (IPC_READ_ONLY) before anything else;
 * 3. each argument checked against its schema, in argument order; the first
 *    failure answers with that schema's message. A missing argument is
 *    checked as undefined; arguments past the schema list are ignored, as the
 *    hand-written handlers ignored them;
 * 4. the body, with the parsed arguments.
 *
 * Schemas are Zod. Give every schema the exact message people should see (or
 * the one a test pins), as the first argument of idArg / textArg / z.xxx(…)
 * or the last of .min / .max / .refine — tests/renderer/friendlyError.test.ts
 * reads the messages from those places. Zod objects drop keys they don't
 * list; use z.looseObject where the body passes the whole object on.
 */
import { z } from 'zod'
import { secureWrap, enforceWritable, fail, validId } from './ipc-utils'

/** What every handler answers: ok(data) or fail(message) */
type HandlerResult = { ok: true; data: unknown } | { ok: false; error: string }

type ArgSchemas = readonly z.ZodType[]

/** The parsed argument tuple for a list of schemas */
type ParsedArgs<S extends ArgSchemas> = { -readonly [K in keyof S]: z.output<S[K]> }

export interface HandlerOptions {
  /** Writes to the database: refused with IPC_READ_ONLY while Pulse is read-only */
  write?: boolean
}

/** A positive integer id, answering `message` (default 'Invalid ID') otherwise — validId's rule */
export function idArg(message = 'Invalid ID') {
  return z.custom<number>(validId, message)
}

export interface TextArgOptions {
  min?: number
  max?: number
  /** Refuse text that is only spaces */
  notBlank?: boolean
}

/** A string within length limits (UTF-16 units, as String.length counts), answering `message` otherwise */
export function textArg(message: string, { min, max, notBlank }: TextArgOptions = {}) {
  let schema = z.string(message)
  if (min !== undefined) schema = schema.min(min, message)
  if (max !== undefined) schema = schema.max(max, message)
  return notBlank ? schema.refine(s => s.trim().length > 0, message) : schema
}

/**
 * Register `fn` for `channel` through secureWrap, after the read-only gate
 * (writes) and the argument checks. `component` names the handler's module in
 * the log, as secureWrap's does.
 */
export function defineHandler<const S extends ArgSchemas>(
  channel: string,
  component: string,
  args: S,
  fn: (...parsed: ParsedArgs<S>) => HandlerResult | Promise<HandlerResult>,
  options: HandlerOptions = {},
): void {
  secureWrap(channel, component, (_e, ...raw: unknown[]) => {
    if (options.write) {
      const guard = enforceWritable(); if (guard) return guard
    }
    const parsed: unknown[] = []
    for (let i = 0; i < args.length; i++) {
      const result = args[i]!.safeParse(raw[i])
      if (!result.success) return fail(result.error.issues[0]?.message ?? 'Invalid input')
      parsed.push(result.data)
    }
    // The loop above built exactly the tuple ParsedArgs<S> describes
    return Reflect.apply(fn, undefined, parsed) as HandlerResult | Promise<HandlerResult>
  })
}

/** defineHandler with the log component filled in, one per handler module */
export function handlersFor(component: string) {
  return <const S extends ArgSchemas>(
    channel: string,
    args: S,
    fn: (...parsed: ParsedArgs<S>) => HandlerResult | Promise<HandlerResult>,
    options: HandlerOptions = {},
  ): void => defineHandler(channel, component, args, fn, options)
}
