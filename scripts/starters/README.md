# Starter generators

Each `make_<id>.py` writes `src/shared/starters/<id>.json` (thresholds and rule settings are JSON strings, which are easier to keep right in Python). Edit the script, not the JSON, then:

```bash
python3 -I scripts/starters/make_<id>.py src/shared/starters/<id>.json
npx tsx scripts/starters/validate-starter.ts src/shared/starters/<id>.json   # schema
python3 -I scripts/starters/check_starter.py src/shared/starters/<id>.json   # column names, rules, sample data, leak words (--human-services to allow them)
npm test -- tests/starter-catalog.test.ts tests/starters.test.ts
```

A new starter also needs: an entry in `src/shared/starters/index.ts`, its icon in `src/renderer/components/starters/StarterIcon.tsx`, an `EXPECTED` entry in `tests/starter-catalog.test.ts`, a blurb in `scripts/website-copy/blurbs.mjs`, then `node scripts/website-copy/build.mjs` and a screenshot tour (`scripts/website-copy/screenshots.sh <id>`; under Wayland run it with `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11`). Look at the screenshots: past dates on finished work showing as overdue is the usual mistake (hide them with a stage `rule_condition`).

Older starters were written by hand and have no generator.
