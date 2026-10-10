"""Cross-reference checks for a starter JSON (what zod can't see). Usage: python3 -I check_starter.py <file> [--human-services]"""
import json, re, sys

path = sys.argv[1]
human = '--human-services' in sys.argv
s = json.load(open(path))
errors, warns = [], []
LEAK = re.compile(r"\b(clients?|caseloads?|case ?(notes?|logs?)|providers?|acuity)\b", re.I)
DISCLAIMER = 'Pulse is a tracking aid, not your official record system.'

def refs(obj):
    """Every {"column": name} inside a JSON-string config."""
    out = []
    def walk(o):
        if isinstance(o, dict):
            if set(o.keys()) == {'column'}: out.append(o['column'])
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(obj); return out

def check_lists(lists, sample, label):
    keys = {l['key'] for l in lists}
    # Without activityTypes the built-in ones apply (note, visit, phone, email, meeting…): skip those checks
    act_types = ({a['key'] for a in s['activityTypes']} | {'note'}) if s.get('activityTypes') else None
    cols_by_list = {}
    link_names = {}
    for l in lists:
        names = [c['name'] for c in l['columns']]
        if len(names) != len(set(names)): errors.append(f'{label}{l["key"]}: duplicate column names')
        rules = {r['name'] for r in l.get('alertRules', [])}
        checklists = {c['name'] for c in l.get('checklists', [])}
        cols = set(names)
        for ln in l.get('links', []):
            if ln['to'] not in keys: errors.append(f'{label}{l["key"]}: link to unknown list {ln["to"]}')
            cols.add(ln['label_forward']); link_names.setdefault(l['key'], set()).add(ln['label_forward'])
        cols_by_list[l['key']] = cols
        for c in l['columns']:
            cfg = json.loads(c['config']) if c.get('config') else {}
            if cfg.get('alert_rule_name') and cfg['alert_rule_name'] not in rules: errors.append(f'{label}{l["key"]}.{c["name"]}: unknown rule {cfg["alert_rule_name"]}')
            if cfg.get('done_checklist_name') and cfg['done_checklist_name'] not in checklists: errors.append(f'{label}{l["key"]}.{c["name"]}: unknown checklist')
            if c['column_type'] in ('date',) and not cfg.get('alert_rule_name'): pass
        for r in l.get('alertRules', []):
            used = any((json.loads(c['config']).get('alert_rule_name') if c.get('config') else None) == r['name'] for c in l['columns'])
            if not used: warns.append(f'{label}{l["key"]}: rule "{r["name"]}" is not used by any column')
            for field in ('rule_config', 'rule_condition'):
                if r.get(field):
                    for name in refs(json.loads(r[field])):
                        if name not in set(names): errors.append(f'{label}{l["key"]} rule {r["name"]}: unknown column {name} in {field}')
        st = l.get('stage')
        if st:
            if st['column'] not in set(names): errors.append(f'{label}{l["key"]}: stage column missing')
            for o in st['options']:
                oe = o.get('onEnter') or {}
                if oe.get('stampColumn') and oe['stampColumn'] not in set(names): errors.append(f'{label}{l["key"]}: stamp column {oe["stampColumn"]} missing')
                if oe.get('checklist') and oe['checklist'] not in checklists: errors.append(f'{label}{l["key"]}: onEnter checklist missing')
                if oe.get('activityType') and act_types is not None and oe['activityType'] not in act_types: errors.append(f'{label}{l["key"]}: onEnter activity type missing')
        for f in l.get('forms', []):
            for fld in f['fields']:
                if fld['kind'] == 'column' and fld['column'] not in set(names): errors.append(f'{label}{l["key"]} form {f["name"]}: unknown column {fld["column"]}')
            if f.get('log_activity_type') and act_types is not None and f['log_activity_type'] not in act_types: errors.append(f'{label}form {f["name"]}: unknown activity type')
        if l.get('displayFormat'):
            for name in re.findall(r'\{([^}]+)\}', l['displayFormat']):
                if name not in set(names): errors.append(f'{label}{l["key"]}: displayFormat column {name} missing')
    if not sample: warns.append(f'{label}no sample data'); return
    recs = sample.get('records', {})
    for k, rows in recs.items():
        if k not in keys: errors.append(f'{label}sample list {k} unknown'); continue
        for i, row in enumerate(rows):
            for col in row:
                if col not in cols_by_list[k]: errors.append(f'{label}sample {k}#{i}: unknown column {col}')
    def ref_ok(ref):
        k, i = ref.split('#'); return k in recs and int(i) < len(recs[k])
    for a in sample.get('activities', []):
        if not ref_ok(a['record']): errors.append(f'{label}activity record {a["record"]} missing')
        if act_types is not None and a['type'] not in act_types: errors.append(f'{label}activity type {a["type"]} unknown')
    for ln in sample.get('links', []):
        if not ref_ok(ln['from']) or not ref_ok(ln['to']): errors.append(f'{label}link {ln} record missing')
        elif ln['link'] not in link_names.get(ln['from'].split('#')[0], set()): errors.append(f'{label}link name {ln["link"]} not defined on {ln["from"].split("#")[0]}')
    for h in sample.get('history', []):
        if not ref_ok(h['record']): errors.append(f'{label}history record {h["record"]} missing')
        elif h['column'] not in cols_by_list[h['record'].split('#')[0]]: errors.append(f'{label}history column {h["column"]} missing')
    for a in sample.get('appointments', []):
        if not ref_ok(a['record']): errors.append(f'{label}appointment record {a["record"]} missing')
        if a.get('type') and act_types is not None and a['type'] not in act_types: errors.append(f'{label}appointment type {a["type"]} unknown')
    for st in sample.get('stepsDone', []):
        if not ref_ok(st['record']): errors.append(f'{label}stepsDone record missing')
    # deadline spread: overdue / within 7 days / later
    offs = [v['daysFromToday'] for rows in recs.values() for row in rows for v in row.values() if isinstance(v, dict)]
    if offs and not (any(o < -30 for o in offs) and any(-30 <= o <= 30 for o in offs)): warns.append(f'{label}sample dates may not spread across overdue / soon / later')

if 'variants' in s:
    for v in s['variants']:
        check_lists(v['lists'], v.get('sampleData') or s.get('sampleData'), f'[{v["key"]}] ')
else:
    check_lists(s['lists'], s.get('sampleData'), '')

if not human:
    text = json.dumps(s, ensure_ascii=False)
    for m in set(m.group(0).lower() for m in LEAK.finditer(text)):
        errors.append(f'human-services word leaks: "{m}" (rename it, or the catalog test needs allowWords / humanServices)')
print('ERRORS:' if errors else 'no errors', *errors, sep='\n  ')
if warns: print('warnings:', *warns, sep='\n  ')
print('disclaimer in description:', DISCLAIMER in s['description'])
sys.exit(1 if errors else 0)
