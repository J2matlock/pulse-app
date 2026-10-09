// Builds the website copy (W16): plans/website/<starter id>.md for every
// built-in starter, plus an index. The headline and "the problem" come from
// blurbs.mjs; what the starter sets up is read from its JSON, so the pages
// stay true to what ships.
//
//   node scripts/website-copy/build.mjs
//
// Screenshots are made separately (scripts/website-copy/screenshots.sh).
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { BLURBS } from './blurbs.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const startersDir = join(root, 'src', 'shared', 'starters')
const outDir = join(root, 'plans', 'website')
const DISCLAIMER = 'Pulse is a tracking aid, not your official record system.'
const DOWNLOAD = 'https://github.com/J2matlock/pulse-releases/releases/latest'

const starters = readdirSync(startersDir).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(startersDir, f), 'utf-8')))
  .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name))

const missing = starters.filter(s => !BLURBS[s.id]).map(s => s.id)
if (missing.length) throw new Error(`No blurb for: ${missing.join(', ')}`)
const extra = Object.keys(BLURBS).filter(id => !starters.some(s => s.id === id))
if (extra.length) throw new Error(`Blurb for a starter that doesn't exist: ${extra.join(', ')}`)

const many = (vocab, fallback) => vocab?.record?.many ?? fallback
const sentence = s => (s ? s.replace(/\s+$/, '').replace(/([^.!?])$/, '$1.') : '')

function ruleLine(r) {
  const kind = {
    relative: 'counted from another date', calendar: 'on the calendar', meter: 'by miles or months',
    quota: 'counted from your notes', sequence: 'step by step',
  }[r.kind] ?? null
  // Lowercase the first letter to follow the colon, but not an acronym's (OPT, IEP)
  const d = r.description ?? ''
  const desc = d ? `: ${/^[A-Z][a-z]/.test(d) ? d.charAt(0).toLowerCase() + d.slice(1) : d}` : ''
  return `${r.name}${desc}${kind && !desc ? ` (${kind})` : ''}`
}

function listSection(l, all) {
  const out = [`### ${l.name}`, '']
  if (l.description) out.push(sentence(l.description), '')
  const bullets = []
  const dated = l.columns.filter(c => /alert_rule_name/.test(c.config ?? '')).map(c => c.name)
  if (dated.length) bullets.push(`Deadline columns: ${dated.join(', ')}`)
  for (const r of l.alertRules ?? []) bullets.push(`Deadline rule — ${ruleLine(r)}`)
  for (const link of l.links ?? []) {
    const other = all.find(x => x.key === link.to)
    bullets.push(`Linked to ${other?.name ?? link.to} ("${link.label_forward}" here, "${link.label_backward}" there)`)
  }
  if (l.stage) bullets.push(`Board view by ${l.stage.column}: ${(l.stage.options ?? []).map(o => o.value).join(' → ')}`)
  for (const q of l.requirements ?? []) bullets.push(`${q.label}: ${q.per_month} a ${q.period ?? 'month'}`)
  for (const f of l.forms ?? []) bullets.push(`Form: ${f.name}`)
  for (const c of l.checklists ?? []) bullets.push(`Checklist: ${c.name}`)
  const other = l.columns.filter(c => !dated.includes(c.name) && !c.is_name_column).map(c => c.name)
  if (other.length) bullets.push(`Also: ${other.join(', ')}`)
  out.push(...bullets.map(b => `- ${b}`), '')
  return out.join('\n')
}

function page(s) {
  const b = BLURBS[s.id]
  const lists = s.lists ?? s.variants[0].lists
  // The first list is what people see first, so its word leads
  const records = lists[0].vocab?.record?.many ?? many(s.vocab, 'records')
  const regulated = s.description.includes(DISCLAIMER)
  const lines = [
    `# ${s.name}: ${b.headline}`,
    '',
    `*${s.group ?? 'Other'} · starter \`${s.id}\`*`,
    '',
    '## The problem',
    '',
    b.problem,
    '',
    '## What Pulse sets up for you',
    '',
    sentence(s.description.replace(DISCLAIMER, '').trim()),
    '',
  ]
  if (s.variants) {
    const q = s.variantQuestion ?? 'Which describes your work best?'
    lines.push(q.endsWith('?') ? `${q} Pick one:` : `${q}:`, '')
    for (const v of s.variants) lines.push(`- **${v.name}** — ${sentence(v.description)}`)
    lines.push('', `The first layout, ${s.variants[0].name}, is shown below.`, '')
  }
  for (const l of lists) lines.push(listSection(l, lists))
  const extras = []
  if (s.activityTypes?.length) extras.push(`Kinds of notes: ${s.activityTypes.map(a => a.label).join(', ')}`)
  if (s.documentTemplates?.length) extras.push(`Letters: ${s.documentTemplates.map(d => d.name).join(', ')}`)
  if (s.sampleData) extras.push(`Sample ${records} to try it out, removed in one click when you're ready`)
  if (extras.length) lines.push('### Also included', '', ...extras.map(e => `- ${e}`), '')
  lines.push(
    '## See it',
    '',
    `![The ${lists[0].name} list](screenshots/${s.id}/01-list.png)`,
    `![The dashboard: what's overdue and due soon](screenshots/${s.id}/02-dashboard.png)`,
    `![One of the ${records}, with deadlines and notes](screenshots/${s.id}/03-record.png)`,
  )
  if (s.sampleData?.appointments?.length) lines.push(`![The calendar](screenshots/${s.id}/04-calendar.png)`)
  lines.push(
    '',
    '## Your spreadsheet, but safer',
    '',
    `- **Stays on your computer.** No cloud account and no upload. Your ${records} never leave your machine.`,
    '- **Locked with your password.** Everything is encrypted, and Pulse locks itself when you step away.',
    '- **Backed up for you.** Automatic backups, plus a recovery key in case you forget your password.',
    '- **Colors that tell you what to do next.** Green is fine, yellow is coming up, red is overdue.',
    '- **Bring what you have.** Import your existing spreadsheet from Excel or CSV.',
    '',
    '## Try it free',
    '',
    `[Download Pulse](${DOWNLOAD}) for Windows or Linux and pick "${s.name}" when it asks how you want to start. The free version keeps up to 15 active ${records}; sample data never counts.`,
    '',
  )
  if (regulated) lines.push(`> ${DISCLAIMER} Keep your official records where your agency, court or regulator requires them.`, '')
  return lines.join('\n')
}

mkdirSync(outDir, { recursive: true })
for (const s of starters) writeFileSync(join(outDir, `${s.id}.md`), page(s))

const index = [
  '# Website copy: one page per starter',
  '',
  'Generated by `node scripts/website-copy/build.mjs` from the starter files and `scripts/website-copy/blurbs.mjs`. Edit those, not these pages.',
  '',
  'Before publishing:',
  '- The free-version rule (15 active records in people and thing lists) is assumption A1 in W13; check it still holds.',
  '- Screenshots: `scripts/website-copy/screenshots.sh` (all starters) or `scripts/website-copy/screenshots.sh therapy-practice` (one). They go to `plans/website/screenshots/<id>/`, which is not committed.',
  '',
  '| Starter | Group | Page |',
  '|-|-|-|',
  ...starters.map(s => `| ${s.name} | ${s.group ?? ''} | [${s.id}](${s.id}.md) |`),
  '',
]
writeFileSync(join(outDir, 'README.md'), index.join('\n'))
console.log(`Wrote ${starters.length} pages to plans/website/`)
