---
name: deps-upgrade
description: Audit outdated/vulnerable npm dependencies for Pulse and write a phased, copy-pasteable UPGRADE_PLAN.md. Respects the project's pinned-version decisions (Electron 39, electron-store 8, dnd-kit 6/8, electron-vite 3/Vite 6).
disable-model-invocation: true
---

## Pulse-specific constraints (read first)
- Check the Decision Log in `CLAUDE.md` before proposing any bump that reverses a recorded decision. Re-evaluate the reason; don't ignore it.
- `better-sqlite3-multiple-ciphers` is native. After any install, run `npx electron-rebuild -f -w better-sqlite3-multiple-ciphers`. Tests rebuild it for system Node and back automatically (`scripts/run-tests.sh`).
- Production-only vulnerabilities matter most: `npm audit --omit=dev`. Prefer patch and minor fixes via `npm audit fix` first.
- Production deps should be pinned exactly (no `^`), with the resolved version recorded in `package-lock.json`.
- Your training data may be older than these packages. Use WebSearch for migration guides.
- Every phase must pass `npm run typecheck`, `npm test`, and `npm run build`.

# Dependency Upgrade Audit & Plan

You are a senior engineer performing a comprehensive dependency audit and upgrade plan for this project.

## Phase 1: Discovery

Run these commands to gather the current state:

1. **List all dependencies with versions:**
```bash
cat package.json | node -e "const pkg=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('=== DEPENDENCIES ==='); Object.entries(pkg.dependencies||{}).forEach(([k,v])=>console.log(k,'@',v)); console.log('\n=== DEV DEPENDENCIES ==='); Object.entries(pkg.devDependencies||{}).forEach(([k,v])=>console.log(k,'@',v))"
```

2. **Check for available updates:**
```bash
npx npm-check-updates
```

3. **Check for known vulnerabilities:**
```bash
npm audit
```

4. **Identify the project framework** (Electron, Next.js, Express, etc.) and note which packages form the core toolchain vs which are leaf dependencies.

## Phase 2: Classify Every Outdated Package

For each outdated package, determine:

- **Current version → Latest version**
- **Semver jump type:** patch, minor, or major
- **Is it a direct dependency or transitive?**
- **Does it have known CVEs?** (check npm audit output)
- **Is it part of a coupled upgrade group?** (packages that must upgrade together — e.g., react + react-dom + @types/react, or vite + framework-specific vite plugin)

Classify into tiers:

| Tier | Description | Criteria |
|-|-|-|
| Safe | Minor/patch bumps, no breaking changes | Semver minor or patch; no migration guide exists |
| Moderate | Major bump but small API surface in this project | Major version; used in <5 files; migration guide is straightforward |
| Complex | Major bump with significant codebase impact | Major version; used broadly; has a migration guide with multiple steps |
| Defer | Not worth upgrading now | Beta/RC only, ESM-only migration when project is CJS, or API rewrite with no stable release |
| Blocked | Cannot upgrade due to dependency conflict | Upgrading would break another package that doesn't support the new version yet |

## Phase 3: Research Each Major Upgrade

For every package classified as Moderate or Complex, launch a research agent (or use WebSearch) to find:

1. **Official migration guide** — search "[package name] v[X] migration guide"
2. **Breaking changes list** — search "[package name] v[X] breaking changes"
3. **Automated codemods** — search "[package name] v[X] codemod" or "upgrade tool"
4. **Compatibility with other project dependencies** — especially for framework packages (React, Vue, etc.), check if every dependent library supports the new version. Search "[library name] [framework] [version] compatible"
5. **Minimum peer dependency versions** — check if upgrading A requires upgrading B

For each, document:
- Specific API changes that affect this project
- Files in this project that will need changes (use Grep to count occurrences)
- Whether an automated tool exists to handle the migration
- What could go wrong and how to recover

## Phase 4: Scan the Codebase for Affected Patterns

Search for patterns that will break with each upgrade. Examples:

- **React upgrades:** `forwardRef`, `defaultProps`, `string refs`, `Context.Provider`, `useRef()` without args, deprecated type names
- **CSS framework upgrades:** config file format, renamed utility classes, dark mode mechanism, `@apply` directives
- **Build tool upgrades:** config file format, plugin API changes, module resolution changes
- **ORM/DB upgrades:** query builder API changes, migration format changes
- **Test framework upgrades:** assertion API changes, config format changes

For each pattern found, report: count of occurrences, which files, and a representative sample.

## Phase 5: Determine Upgrade Order

Group packages into phases based on dependency chains. Rules:

1. **Build toolchain first** — if the build tool must upgrade, do it before anything that depends on the build output
2. **Framework core before plugins** — e.g., React before React-dependent libraries
3. **Coupled packages together** — packages that must be at compatible versions go in the same phase
4. **Leaf dependencies anytime** — packages with no dependents can go in any phase
5. **Each phase must result in a passing build** — `npm run build && npm test` must pass after every phase

## Phase 6: Write the Plan

Create a file called `UPGRADE_PLAN.md` with:

### For each phase:

1. **Phase name and risk level** (Low / Medium / High)
2. **Exact npm install commands** to run
3. **Config file changes** with before/after snippets
4. **Code changes** needed (specific files, specific patterns to find-and-replace)
5. **Automated tools** to run (codemods, upgrade scripts)
6. **Verification steps** (tsc, build, test, manual QA areas)
7. **What could go wrong** and how to fix it
8. **Rollback plan** if the phase fails catastrophically

### Also include:

- **"NOT upgrading" section** listing deferred packages with clear reasons
- **Final target version table** showing every package's target version
- **Post-upgrade checklist** of manual QA items to verify
- **Update instructions** for project documentation (README, config docs, CI, etc.)

## Output Rules

- Final plan should be actionable by an engineer (or AI agent) in a future session with no additional research needed
- Every command should be copy-pasteable
- Every code change should reference exact file paths and line patterns
- Do not assume the implementer has context — explain WHY each change is needed, not just WHAT
- Group related changes so each phase can be completed and committed atomically
- After writing the plan, update the project's main documentation file (CLAUDE.md, README, etc.) with:
  - Current actual versions
  - Planned target versions
  - A note telling future AI sessions to check package.json and look up unfamiliar APIs via web search rather than guessing
