// Regenerates the dependency documents for IT reviewers:
//   sbom.json                 CycloneDX 1.6 SBOM of what ships (production deps + Electron)
//   licenses.txt              one line per package, with a count per license
//   THIRD_PARTY_LICENSES.txt  every package's license text
//
//   npm run licenses
//
// Run after dependencies change (see the pre-release skill), with node_modules
// installed from package-lock.json. Copy the three files to the website's docs/.
import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CYCLONEDX = '@cyclonedx/cyclonedx-npm@6.0.1'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const readJson = f => JSON.parse(readFileSync(f, 'utf-8'))
const app = readJson(join(root, 'package.json'))

// ── Packages that ship ───────────────────────────────────────────────
// Production dependencies, plus Electron: it's a devDependency for
// electron-builder, but its runtime is inside every build.
const tree = JSON.parse(execFileSync(npm, ['ls', '--omit=dev', '--all', '--json', '--long'], { cwd: root, maxBuffer: 64 << 20 }).toString())
const pkgs = new Map()
;(function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    const key = `${name}@${dep.version}`
    if (pkgs.has(key) || !dep.path) continue
    pkgs.set(key, { name, version: dep.version, path: dep.path })
    walk(dep)
  }
})(tree)
const electronDir = join(root, 'node_modules', 'electron')
const electron = readJson(join(electronDir, 'package.json'))
pkgs.set(`electron@${electron.version}`, { name: 'electron', version: electron.version, path: electronDir })

function licenseOf(dir) {
  const p = readJson(join(dir, 'package.json'))
  const lic = p.license ?? p.licenses
  const id = typeof lic === 'string' ? lic
    : Array.isArray(lic) ? lic.map(l => l.type ?? l).join(' OR ')
    : lic?.type ?? 'UNKNOWN'
  const repo = typeof p.repository === 'string' ? p.repository : p.repository?.url ?? p.homepage ?? ''
  const file = readdirSync(dir).find(f => /^(licen[cs]e|copying)(\.|-|$)/i.test(f))
  const text = file ? readFileSync(join(dir, file), 'utf-8').trim() : null
  return { id, repo: repo.replace(/^git\+/, '').replace(/\.git$/, ''), text }
}

const list = [...pkgs.values()]
  .map(p => ({ ...p, ...licenseOf(p.path) }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))

// ── licenses.txt ─────────────────────────────────────────────────────
const counts = {}
for (const p of list) counts[p.id] = (counts[p.id] ?? 0) + 1
const date = new Date().toISOString().slice(0, 10)
writeFileSync(join(root, 'licenses.txt'), [
  `Pulse by BaringaSoft ${app.version} — third-party license summary (${date})`,
  `Pulse itself is licensed under the GNU GPL v3 (${app.license}).`,
  `${list.length} packages ship with Pulse (production dependencies and the Electron runtime).`,
  '',
  'Licenses:',
  ...Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, n]) => `  ${String(n).padStart(4)}  ${id}`),
  '',
  'Packages:',
  ...list.map(p => `  ${p.name}@${p.version} — ${p.id}${p.repo ? ` — ${p.repo}` : ''}`),
  '',
].join('\n'))

// ── THIRD_PARTY_LICENSES.txt ─────────────────────────────────────────
const rule = '-'.repeat(60)
writeFileSync(join(root, 'THIRD_PARTY_LICENSES.txt'), [
  'THIRD-PARTY SOFTWARE LICENSES',
  '='.repeat(60),
  '',
  `Pulse by BaringaSoft ${app.version} includes the following third-party software.`,
  "Each package's license is reproduced below. Electron also bundles Chromium",
  'and Node.js; their licenses ship with the app as LICENSES.chromium.html.',
  '',
  ...list.flatMap(p => [
    rule,
    `Package: ${p.name}@${p.version}`,
    `License: ${p.id}`,
    ...(p.repo ? [`Repository: ${p.repo}`] : []),
    '',
    p.text ?? `(No license file in the package. Its package.json declares: ${p.id})`,
    '',
  ]),
].join('\n'))

// ── sbom.json ────────────────────────────────────────────────────────
execFileSync(npx, ['--yes', CYCLONEDX, '--omit', 'dev', '--spec-version', '1.6', '--output-reproducible',
  '--output-format', 'JSON', '--output-file', 'sbom.json'], { cwd: root, stdio: 'inherit' })
const sbom = readJson(join(root, 'sbom.json'))
if (!sbom.components.some(c => c.name === 'electron')) {
  sbom.components.push({
    type: 'framework',
    name: 'electron',
    version: electron.version,
    'bom-ref': `pkg:npm/electron@${electron.version}`,
    purl: `pkg:npm/electron@${electron.version}`,
    licenses: [{ license: { id: licenseOf(electronDir).id } }],
    description: 'Application runtime (Chromium and Node.js), bundled into every build',
  })
}
sbom.metadata.timestamp = new Date().toISOString()
writeFileSync(join(root, 'sbom.json'), JSON.stringify(sbom, null, 2) + '\n')

const missing = list.filter(p => !p.text).map(p => `${p.name}@${p.version}`)
console.log(`${list.length} packages; ${Object.keys(counts).length} licenses; SBOM ${sbom.components.length} components`)
if (missing.length) console.log(`No license file (declared license used): ${missing.join(', ')}`)
