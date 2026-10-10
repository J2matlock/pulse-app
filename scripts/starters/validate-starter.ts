import { readFileSync } from 'fs'
import { parseStarter } from '../../src/shared/starters/schema'
const file = process.argv[2]!
const r = parseStarter(JSON.parse(readFileSync(file, 'utf8')))
console.log(JSON.stringify(r, (_k, v) => v, 0).slice(0, 600))
