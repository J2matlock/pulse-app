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
 * the one a test pins), as the first argument of idArg / textArg / z.xxx(…),
 * the first two of idListArg, or the last of schemaArg / z.enum / z.custom /
 * .min / .max / .refine / .regex / textLength — tests/renderer/friendlyError.test.ts
 * reads the messages from those places. Zod objects drop keys they don't
 * list; use z.looseObject where the body passes the whole object on.
 */
import { z } from 'zod'
import { textLength } from '../../shared/textLength'
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
  if (min !== undefined || max !== undefined) schema = schema.check(textLength({ min, max }, message))
  return notBlank ? schema.refine(s => s.trim().length > 0, message) : schema
}

/**
 * A list of ids: not a list, or too short or long → `listMessage`; then a bad id
 * in it → `idMessage` (checked only once the list itself passed, as the
 * hand-written "length first, then every id" checks did).
 */
export function idListArg(listMessage: string, idMessage: string, { min, max }: { min?: number; max?: number } = {}) {
  let list = z.array(z.unknown(), listMessage)
  if (min !== undefined) list = list.min(min, listMessage)
  if (max !== undefined) list = list.max(max, listMessage)
  return list.pipe(z.array(idArg(idMessage)))
}

/**
 * An argument checked against a schema of its own (one with its own messages,
 * shared with other code), answering one `message` whatever the reason, as
 * `if (!schema.safeParse(x).success) return fail(message)` did. The body gets
 * the schema's parsed value.
 */
export function schemaArg<S extends z.ZodType>(schema: S, message: string) {
  return z.custom<unknown>(v => schema.safeParse(v).success, message).pipe(schema)
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
