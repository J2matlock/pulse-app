"""Generates src/shared/starters/tree-service.json (thresholds and configs are JSON strings)."""
import json, sys

def th(*steps):
    labels = {'coming': 'Coming up', 'soon': 'Due soon', 'urgent': 'Urgent'}
    colors = {'coming': '#bbf7d0', 'soon': '#facc15', 'urgent': '#fb923c'}
    out = [{'daysBefore': d, 'bgClass': colors[k], 'label': labels[k]} for k, d in steps]
    out += [{'daysBefore': 0, 'bgClass': '#dc2626', 'label': 'Due today'}, {'daysBefore': -1, 'bgClass': 'alert-pulse-dark', 'label': 'Overdue'}]
    return json.dumps(out)

T7 = th(('soon', 7), ('urgent', 3))
T30 = th(('coming', 30), ('soon', 14), ('urgent', 7))
T60 = th(('coming', 60), ('soon', 30), ('urgent', 14))

def col(name, ctype, pos, width, **kw):
    c = {'name': name, 'column_type': ctype, 'position': pos, 'width': width}
    c.update(kw)
    return c

def date_col(name, pos, rule, description=None):
    c = col(name, 'date', pos, 160, config=json.dumps({'alert_rule_name': rule, 'log_changes': True}))
    if description: c['description'] = description
    return c

def d(n): return {'daysFromToday': n}

STAGES = [('Estimate requested', 'slate', '#64748b'), ('Estimate sent', 'blue', '#3b82f6'), ('Approved', 'purple', '#8b5cf6'),
          ('Scheduled', 'amber', '#f59e0b'), ('In progress', 'orange', '#f97316'), ('Done', 'green', '#22c55e'), ('Not going ahead', 'red', '#ef4444')]

customers = {
    'key': 'customers', 'name': 'Customers', 'description': 'Homeowners, businesses and property managers you work for', 'kind': 'person',
    'vocab': {'record': {'one': 'customer', 'many': 'customers', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 190, is_name_column=1, is_identifier=1, is_required=1),
        col('Phone', 'phone', 1, 140, is_required=1),
        col('Email', 'email', 2, 200),
        col('Address', 'address', 3, 180, is_required=1),
        col('Preferred contact', 'dropdown', 4, 150, config=json.dumps({'options': ['Call', 'Text', 'Email']})),
        col('Property notes', 'notes', 5, 240, description='Gate code, dogs, power lines, where to park the chipper'),
        date_col('Last tree check', 6, 'Every year', 'Date you last walked the property with them; Pulse reminds you a year later'),
        date_col('Ash tree treatment', 7, 'Every 2 years', 'Last emerald ash borer injection. Leave blank if they have no ash trees'),
    ],
    'alertRules': [
        {'name': 'Every year', 'description': 'Due on the same date a year later', 'interval_months': 12, 'thresholds': T60},
        {'name': 'Every 2 years', 'description': 'Due on the same date two years later', 'interval_months': 24, 'thresholds': T60},
    ],
}

jobs = {
    'key': 'jobs', 'name': 'Jobs', 'description': 'Work from the first call to the cleanup check', 'kind': 'job',
    'vocab': {'record': {'one': 'job', 'many': 'jobs', 'article': 'a'}},
    'columns': [
        col('Job', 'text', 0, 230, is_name_column=1, is_identifier=1, is_required=1),
        col('Stage', 'status', 1, 160, config=json.dumps({'options': [{'label': s, 'color': h} for s, _, h in STAGES]})),
        col('Work type', 'dropdown', 2, 150, config=json.dumps({'options': ['Removal', 'Pruning', 'Stump grinding', 'Storm cleanup', 'Plant health care', 'Cabling and bracing', 'Inspection']})),
        col('Estimate', 'currency', 3, 120),
        col('Estimate sent on', 'date', 4, 150, description='Filled in when the job moves to Estimate sent'),
        date_col('Estimate follow-up', 5, 'Estimate follow-up', 'Date you called back about the estimate'),
        date_col('Scheduled for', 6, 'Scheduled date', 'The day the crew is booked'),
        date_col('Permit expires', 7, 'Expires', 'Tree removal permit from the town, if one is needed'),
        col('Completed on', 'date', 8, 150, description='Filled in when the job moves to Done'),
        date_col('Follow-up call', 9, 'Follow-up call', 'Date you checked the cleanup was OK and asked for a review'),
        col('Invoice total', 'currency', 10, 130),
    ],
    'alertRules': [
        {'name': 'Scheduled date', 'description': 'The date entered is the day of the job, until it is done', 'interval_days': 0, 'thresholds': T7,
         'rule_condition': json.dumps({'columnId': {'column': 'Stage'}, 'op': 'is_not', 'values': ['Done', 'Not going ahead'], 'whenFalse': 'hide'})},
        {'name': 'Expires', 'description': 'The date entered is when it runs out', 'interval_days': 0, 'thresholds': T30},
        {'name': 'Estimate follow-up', 'description': 'Call back 7 days after sending an estimate, while it is still waiting', 'interval_days': 0, 'thresholds': T7,
         'kind': 'relative', 'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Estimate sent on'}, 'offset': {'days': 7, 'direction': 'after'}}),
         'rule_condition': json.dumps({'columnId': {'column': 'Stage'}, 'op': 'is', 'values': ['Estimate sent'], 'whenFalse': 'hide'})},
        {'name': 'Follow-up call', 'description': 'Call the customer 7 days after the job is done', 'interval_days': 0, 'thresholds': T7,
         'kind': 'relative', 'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Completed on'}, 'offset': {'days': 7, 'direction': 'after'}})},
    ],
    'checklists': [
        {'name': 'Job site safety', 'description': 'Before the first cut', 'items': json.dumps([
            'Walk the site and talk through the plan with the crew', 'Power lines checked: stay 10 feet away unless line-clearance qualified',
            'Drop zone marked off with cones', 'PPE checked: helmet, eye and ear protection, chaps', 'Aerial rescue plan and first aid kit ready',
            'Nearest hospital noted', 'Underground lines marked (811) before stump grinding'])},
    ],
    'links': [{'to': 'customers', 'label_forward': 'Customer', 'label_backward': 'Jobs', 'cardinality': 'many_to_one'}],
    'stage': {'column': 'Stage', 'options': [
        {'value': s, 'color': c, **({'done': True} if s in ('Done', 'Not going ahead') else {}),
         **({'onEnter': {'stampColumn': 'Estimate sent on'}} if s == 'Estimate sent' else
            {'onEnter': {'checklist': 'Job site safety'}} if s == 'In progress' else
            {'onEnter': {'stampColumn': 'Completed on', 'activityType': 'note'}} if s == 'Done' else {})}
        for s, c, _ in STAGES], 'hideDoneAfterDays': 30},
    'forms': [{
        'name': 'Estimate request', 'intro': 'Take this down when someone calls asking for a quote, or print a blank for the truck.', 'log_activity_type': 'call',
        'fields': [
            {'kind': 'section', 'title': 'The work'},
            {'kind': 'column', 'column': 'Job', 'label': 'What do they need done?', 'required': True},
            {'kind': 'column', 'column': 'Work type', 'width': 'half'},
            {'kind': 'note', 'label': 'Where are the trees on the property?'},
            {'kind': 'note', 'label': 'Anything close by: power lines, buildings, fences, a pool?'},
            {'kind': 'note', 'label': 'Best time to come out and look'},
        ]}],
}

equipment = {
    'key': 'equipment', 'name': 'Equipment', 'description': 'Chippers, stump grinders, trucks and saws, with service and inspections due', 'kind': 'thing',
    'vocab': {'record': {'one': 'machine', 'many': 'machines', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 210, is_name_column=1, is_identifier=1, is_required=1),
        col('Type', 'dropdown', 1, 140, config=json.dumps({'options': ['Chipper', 'Stump grinder', 'Bucket truck', 'Crane', 'Truck', 'Loader', 'Chainsaws', 'Trailer']})),
        col('Hour meter', 'number', 2, 120, description='Engine hours; update it now and then so Pulse can forecast service'),
        col('Hours at last service', 'number', 3, 160),
        date_col('Last service', 4, 'Service'),
        date_col('Aerial lift inspection', 5, 'Every year', 'Yearly inspection for bucket trucks and lifts'),
        date_col('Dielectric test', 6, 'Every year', 'Yearly test for insulated booms used near power lines'),
        date_col('Registration expires', 7, 'Expires'),
        col('Notes', 'notes', 8, 220),
    ],
    'alertRules': [
        {'name': 'Service', 'description': 'Every 100 engine hours or 6 months, whichever comes first', 'interval_days': 0, 'thresholds': T7,
         'kind': 'meter', 'rule_config': json.dumps({'kind': 'meter', 'readingColumnId': {'column': 'Hour meter'}, 'lastServiceReadingColumnId': {'column': 'Hours at last service'},
                                                     'every': 100, 'unit': 'hours', 'timeFallback': {'months': 6}, 'typicalPerDay': 3})},
        {'name': 'Every year', 'description': 'Due on the same date a year later', 'interval_months': 12, 'thresholds': T60},
        {'name': 'Expires', 'description': 'The date entered is when it runs out', 'interval_days': 0, 'thresholds': T30},
    ],
}

crew = {
    'key': 'crew', 'name': 'Crew', 'description': 'Climbers, ground workers and operators, with certifications and training due', 'kind': 'person',
    'vocab': {'record': {'one': 'crew member', 'many': 'crew members', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 180, is_name_column=1, is_identifier=1, is_required=1),
        col('Phone', 'phone', 1, 140),
        col('Role', 'dropdown', 2, 150, config=json.dumps({'options': ['Crew lead', 'Climber', 'Ground worker', 'Bucket operator', 'Estimator']})),
        date_col('Arborist certification expires', 3, 'Expires (60 days ahead)', 'ISA Certified Arborist or similar; renews every 3 years'),
        date_col('CPR / first aid expires', 4, 'Expires (60 days ahead)'),
        date_col('CDL medical card expires', 5, 'Expires (60 days ahead)', 'For anyone who drives the trucks'),
        date_col('Chainsaw safety training', 6, 'Every year', 'Date of the last refresher'),
    ],
    'alertRules': [
        {'name': 'Expires (60 days ahead)', 'description': 'The date entered is when it runs out; warns 60 days ahead', 'interval_days': 0, 'thresholds': T60},
        {'name': 'Every year', 'description': 'Due on the same date a year later', 'interval_months': 12, 'thresholds': T60},
    ],
}

CUST = [('Robert Dubois', '100 Maple Ave'), ('Linh Smith', '137 Birch Lane'), ('Dorothy Kowalski', '174 Cedar Court'), ('Carlos Wong', '211 Willow Way'),
        ('Priya Bell', '248 Elm Street'), ('Frank Rivera', '285 Pine Road'), ('Keisha Thompson', '322 Oak Terrace'), ('Samuel Rahman', '359 Aspen Drive')]
CONTACT = ['Text', 'Call', 'Text', 'Email', 'Call', 'Text', 'Call', 'Email']
NOTES = ['Gate code 4471. Dog in the back yard.', 'Power line along the back fence.', None, 'Owns the office park on Willow; bill monthly.',
         None, 'Park the chipper on the street, not the driveway.', 'Two big ash trees out front.', None]
CHECK = [-380, -360, -300, -200, -100, -350, -30, None]
ASH = [None, None, None, None, None, -700, -800, None]
cust_records = []
for i, (n, a) in enumerate(CUST):
    r = {'Name': n, 'Phone': f'555-01{13 + i * 7:02d}', 'Email': n.lower().replace(' ', '.') + '@example.com', 'Address': f'{a}\nSpringfield', 'Preferred contact': CONTACT[i]}
    if NOTES[i]: r['Property notes'] = NOTES[i]
    if CHECK[i] is not None: r['Last tree check'] = d(CHECK[i])
    if ASH[i] is not None: r['Ash tree treatment'] = d(ASH[i])
    cust_records.append(r)

JOBS = [
    # job, stage, work type, customer, extras
    ('Remove dead oak by the garage', 'In progress', 'Removal', 0, {'Estimate': 2400, 'Estimate sent on': d(-20), 'Scheduled for': d(0), 'Permit expires': d(10)}),
    ('Prune two maples over the roof', 'Scheduled', 'Pruning', 1, {'Estimate': 850, 'Estimate sent on': d(-12), 'Scheduled for': d(3)}),
    ('Fallen limb on the fence', 'Approved', 'Storm cleanup', 2, {'Estimate': 600, 'Estimate sent on': d(-2), 'Scheduled for': d(1)}),
    ('Grind three stumps', 'Estimate sent', 'Stump grinding', 3, {'Estimate': 375, 'Estimate sent on': d(-9)}),
    ('Crown thinning, front yard', 'Estimate sent', 'Pruning', 4, {'Estimate': 1200, 'Estimate sent on': d(-5)}),
    ('Treat ash trees', 'Estimate requested', 'Plant health care', 6, {}),
    ('Look at a leaning pine', 'Estimate requested', 'Inspection', 5, {}),
    ('Remove two pines by the driveway', 'Done', 'Removal', 7, {'Estimate': 3100, 'Estimate sent on': d(-40), 'Scheduled for': d(-9), 'Completed on': d(-8), 'Invoice total': 3100}),
    ('Trim hedges and shrubs', 'Done', 'Pruning', 0, {'Estimate': 300, 'Estimate sent on': d(-15), 'Scheduled for': d(-3), 'Completed on': d(-3), 'Invoice total': 300}),
    ('Cable and brace the split maple', 'Scheduled', 'Cabling and bracing', 3, {'Estimate': 950, 'Estimate sent on': d(-18), 'Scheduled for': d(9)}),
]
job_records = []
for name, stage, wt, _, extra in JOBS:
    job_records.append({'Job': name, 'Stage': stage, 'Work type': wt, **extra})

EQUIP = [
    ('Chipper – Bandit 250', 'Chipper', 1840, 1745, -40, {}),
    ('Stump grinder – Rayco', 'Stump grinder', 620, 560, -75, {}),
    ('Bucket truck – 60 ft', 'Bucket truck', 4210, 4150, -50, {'Aerial lift inspection': d(-350), 'Dielectric test': d(-370), 'Registration expires': d(45)}),
    ('Chip truck – F-550', 'Truck', None, None, -150, {'Registration expires': d(12)}),
    ('Chainsaws (6)', 'Chainsaws', None, None, -20, {'Notes': 'Sharpen chains every Friday.'}),
]
equip_records = []
for name, typ, hours, at_service, last, extra in EQUIP:
    r = {'Name': name, 'Type': typ, 'Last service': d(last), **extra}
    if hours is not None: r['Hour meter'] = hours
    if at_service is not None: r['Hours at last service'] = at_service
    equip_records.append(r)

CREW = [
    ('Marcus Lee', 'Crew lead', {'Arborist certification expires': d(40), 'CPR / first aid expires': d(200), 'CDL medical card expires': d(20), 'Chainsaw safety training': d(-300)}),
    ('Ana Torres', 'Climber', {'Arborist certification expires': d(400), 'CPR / first aid expires': d(-5), 'Chainsaw safety training': d(-370)}),
    ('Devon Price', 'Ground worker', {'CPR / first aid expires': d(90), 'Chainsaw safety training': d(-100)}),
    ('Sam Okafor', 'Bucket operator', {'CPR / first aid expires': d(300), 'CDL medical card expires': d(6), 'Chainsaw safety training': d(-200)}),
]
crew_records = [{'Name': n, 'Phone': f'555-01{70 + i * 3}', 'Role': role, **extra} for i, (n, role, extra) in enumerate(CREW)]

def hours_history(rec, now, per_day=3.2, n=6):
    return {'record': rec, 'column': 'Hour meter', 'values': [{'value': str(round(now - per_day * days)), 'daysAgo': days} for days in [450, 360, 270, 180, 90, 1][-n:]]}

sample = {
    'records': {'customers': cust_records, 'jobs': job_records, 'equipment': equip_records, 'crew': crew_records},
    'links': [{'from': f'jobs#{i}', 'to': f'customers#{c}', 'link': 'Customer'} for i, (_, _, _, c, _) in enumerate(JOBS)],
    'activities': [
        {'record': 'jobs#3', 'type': 'call', 'daysAgo': 9, 'text': 'Walked the yard with Carlos. Three stumps by the back fence, one close to the gas line.'},
        {'record': 'jobs#4', 'type': 'site_visit', 'daysAgo': 6, 'text': 'Measured the canopy; about a day for a crew of three.'},
        {'record': 'jobs#0', 'type': 'note', 'daysAgo': 14, 'text': 'Town permit approved. Copy in Files.'},
        {'record': 'jobs#2', 'type': 'call', 'daysAgo': 2, 'text': 'Approved over the phone. Wants it done before the weekend.'},
        {'record': 'jobs#7', 'type': 'note', 'daysAgo': 8, 'text': 'Both pines down and hauled. Stumps left low for grinding later.'},
        {'record': 'customers#6', 'type': 'site_visit', 'daysAgo': 30, 'text': 'Yearly check. Ash trees look healthy; treatment due next year.'},
        {'record': 'equipment#2', 'type': 'note', 'daysAgo': 50, 'text': 'Hydraulic fluid and filters changed.'},
    ],
    'history': [
        hours_history('equipment#0', 1840), hours_history('equipment#1', 620, per_day=1.2), hours_history('equipment#2', 4210, per_day=2.5),
        {'record': 'jobs#0', 'column': 'Stage', 'values': [{'value': 'Estimate sent', 'daysAgo': 20}, {'value': 'Approved', 'daysAgo': 15}, {'value': 'Scheduled', 'daysAgo': 14}, {'value': 'In progress', 'daysAgo': 0}]},
        {'record': 'jobs#1', 'column': 'Stage', 'values': [{'value': 'Estimate sent', 'daysAgo': 12}, {'value': 'Approved', 'daysAgo': 8}, {'value': 'Scheduled', 'daysAgo': 7}]},
        {'record': 'jobs#9', 'column': 'Stage', 'values': [{'value': 'Estimate sent', 'daysAgo': 18}, {'value': 'Approved', 'daysAgo': 11}, {'value': 'Scheduled', 'daysAgo': 10}]},
    ],
    'appointments': [
        {'record': 'jobs#0', 'title': 'Oak removal', 'dayOffset': 0, 'time': '07:30', 'minutes': 480, 'location': '100 Maple Ave'},
        {'record': 'jobs#2', 'title': 'Storm cleanup', 'dayOffset': 1, 'time': '08:00', 'minutes': 180, 'location': '174 Cedar Court'},
        {'record': 'jobs#5', 'title': 'Estimate: ash trees', 'dayOffset': 1, 'time': '15:00', 'minutes': 30, 'type': 'site_visit', 'location': '322 Oak Terrace'},
        {'record': 'jobs#6', 'title': 'Estimate: leaning pine', 'dayOffset': 2, 'time': '16:00', 'minutes': 30, 'type': 'site_visit', 'location': '285 Pine Road'},
        {'record': 'jobs#1', 'title': 'Maple pruning', 'dayOffset': 3, 'time': '08:00', 'minutes': 300, 'location': '137 Birch Lane'},
        {'record': 'jobs#9', 'title': 'Cable and brace', 'dayOffset': 9, 'time': '08:00', 'minutes': 240, 'location': '211 Willow Way'},
        {'record': 'jobs#7', 'title': 'Pine removal', 'dayOffset': -9, 'time': '07:30', 'minutes': 480, 'location': '359 Aspen Drive'},
        {'record': 'crew#0', 'title': 'Crew safety meeting', 'dayOffset': 1, 'time': '07:00', 'minutes': 20, 'repeatWeekly': 8},
    ],
}

starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'tree-service', 'name': 'Tree service',
    'description': 'For tree care companies: customers, jobs on a board from estimate request to done, estimate follow-ups, permits, equipment service by engine hours, aerial lift inspections and crew certifications.',
    'icon': 'tree-deciduous', 'group': 'Trades and service',
    'vocab': {'record': {'one': 'record', 'many': 'records', 'article': 'a'}, 'list': {'one': 'list', 'many': 'lists', 'article': 'a'}, 'activity': {'one': 'note', 'many': 'notes', 'article': 'a'}},
    'suggestedFeatures': {'personFields': False, 'priority': False, 'contactsDirectory': False, 'requirements': False, 'timeTracking': False, 'mileage': False,
                          'snippets': True, 'checklists': True, 'tasks': True, 'focusMode': False, 'letters': True, 'summaryReport': True, 'handoff': False,
                          'links': True, 'stages': True, 'measures': False, 'appointments': True, 'forms': True, 'attachments': True},
    'activityTypes': [
        {'key': 'note', 'label': 'Note', 'icon': '📝', 'color': 'slate'},
        {'key': 'call', 'label': 'Call', 'icon': '📞', 'color': 'blue'},
        {'key': 'text', 'label': 'Text', 'icon': '💬', 'color': 'teal'},
        {'key': 'site_visit', 'label': 'Site visit', 'icon': '🌳', 'color': 'green'},
    ],
    'documentTemplates': [
        {'name': 'Estimate follow-up', 'content': '{{today}}\n\nHi {{linked:Customer.Name}},\n\nI wanted to follow up on the estimate we sent on {{field:Estimate sent on}} for {{name}} ({{field:Estimate}}).\n\nLet me know if you have any questions, or if you would like to get on the schedule.\n\nThanks,\n\n{{my_name}}'},
        {'name': 'Yearly tree check reminder', 'content': '{{today}}\n\nHi {{name}},\n\nIt has been about a year since we last looked at your trees ({{field:Last tree check}}). A quick yearly check catches dead limbs, disease and storm damage before they turn into a bigger job.\n\nGive us a call to set up a free visit.\n\nThanks,\n\n{{my_name}}'},
    ],
    'helpTips': [
        {'title': 'Estimates', 'body': 'Move a job to Estimate sent and Pulse fills in the date. If it is still waiting a week later, the Estimate follow-up column turns due. Once the job is approved (or not going ahead), the reminder goes away.'},
        {'title': 'Engine hours', 'body': 'Update the Hour meter on the chipper and grinder now and then. Pulse learns how fast the hours add up and shows about when the next service is due: every 100 hours or 6 months, whichever comes first.'},
        {'title': 'Before stump grinding', 'body': 'Call 811 a few days ahead so underground lines are marked, and keep the ticket number in a note on the job. The Job site safety checklist is added when a job moves to In progress.'},
        {'title': 'Photos and permits', 'body': 'Drop before-and-after photos, permits and signed estimates into Files on the job. They are stored encrypted inside Pulse.'},
    ],
    'lists': [customers, jobs, equipment, crew],
    'dashboardCards': ['summary', 'today', 'stages', 'dueForService', 'missingInfo'],
    'sampleData': sample,
}

starter['reports'] = [{'name': 'Estimates waiting on an answer', 'list': 'jobs', 'description': 'Quotes that still need a call back, oldest first.', 'config': {'source': 'records', 'filters': [{'field': 'col:Stage', 'operator': 'equals', 'value': 'Estimate sent'}], 'groupBy': [], 'values': [{'fn': 'count'}], 'columns': ['col:Job', 'col:Customer', 'col:Estimate', 'col:Estimate sent on'], 'sort': {'field': 'col:Estimate sent on', 'dir': 'asc'}}}, {'name': 'Invoiced per month', 'list': 'jobs', 'description': 'What you billed each month this year.', 'config': {'source': 'records', 'filters': [], 'groupBy': [{'field': 'col:Completed on', 'bucket': 'month'}], 'values': [{'fn': 'count', 'label': 'Jobs'}, {'fn': 'sum', 'field': 'col:Invoice total', 'label': 'Invoiced'}], 'dateRange': {'field': 'col:Completed on', 'preset': 'this_year'}}}, {'name': 'Work by type', 'list': 'jobs', 'description': 'Which kinds of work you do most, and what they bring in.', 'config': {'source': 'records', 'filters': [], 'groupBy': [{'field': 'col:Work type'}], 'values': [{'fn': 'count', 'label': 'Jobs'}, {'fn': 'sum', 'field': 'col:Invoice total', 'label': 'Invoiced'}]}}]

json.dump(starter, open(sys.argv[1], 'w'), indent=2, ensure_ascii=False)
open(sys.argv[1], 'a').write('\n')
print('written')
