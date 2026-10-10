"""Generates src/shared/starters/horse-barn.json (thresholds and configs are JSON strings)."""
import json, sys

def th(*steps):
    labels = {'coming': 'Coming up', 'soon': 'Due soon', 'urgent': 'Urgent'}
    colors = {'coming': '#bbf7d0', 'soon': '#facc15', 'urgent': '#fb923c'}
    out = [{'daysBefore': d, 'bgClass': colors[k], 'label': labels[k]} for k, d in steps]
    out += [{'daysBefore': 0, 'bgClass': '#dc2626', 'label': 'Due today'}, {'daysBefore': -1, 'bgClass': 'alert-pulse-dark', 'label': 'Overdue'}]
    return json.dumps(out)

T7 = th(('soon', 7), ('urgent', 3))
T14 = th(('soon', 14), ('urgent', 7))
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

BREEDING = ['Open', 'Bred', 'In foal', 'Foaled']

horses = {
    'key': 'horses', 'name': 'Horses', 'description': 'Every horse in the barn, with hoof care, health and breeding dates', 'kind': 'thing',
    'vocab': {'record': {'one': 'horse', 'many': 'horses', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 170, is_name_column=1, is_identifier=1, is_required=1),
        col('Breed', 'text', 1, 150),
        col('Born', 'date', 2, 130, description='Year or date of birth, if known'),
        col('Stall', 'text', 3, 100, description='Stall or pasture'),
        date_col('Last farrier visit', 4, 'Every 7 weeks', 'Trim or shoes; the next visit comes due 7 weeks later'),
        date_col('Last deworming', 5, 'Every 12 weeks'),
        date_col('Coggins test', 6, 'Every year', 'Date the last negative Coggins was drawn; most shows and barns want one within 12 months'),
        date_col('Last vaccines', 7, 'Every 6 months', 'Spring and fall shots'),
        date_col('Teeth floated', 8, 'Every year', 'Last dental visit'),
        col('Breeding status', 'dropdown', 9, 150, config=json.dumps({'options': BREEDING}), description='For mares; leave blank for geldings and stallions'),
        col('Breeding date', 'date', 10, 150, description='Last cover or insemination date'),
        date_col('Pregnancy check', 11, 'Pregnancy check', 'Date of the ultrasound check, about 15 days after breeding'),
        date_col('Foaled on', 12, 'Foaling due', 'Foaling is due about 340 days after breeding; fill this in when the foal arrives'),
    ],
    'alertRules': [
        {'name': 'Every 7 weeks', 'description': 'Due 49 days after the date entered', 'interval_days': 49, 'thresholds': T7},
        {'name': 'Every 12 weeks', 'description': 'Due 84 days after the date entered', 'interval_days': 84, 'thresholds': T14},
        {'name': 'Every 6 months', 'description': 'Due 6 months after the date entered', 'interval_months': 6, 'thresholds': T30},
        {'name': 'Every year', 'description': 'Due on the same date a year later', 'interval_months': 12, 'thresholds': T60},
        {'name': 'Pregnancy check', 'description': 'Ultrasound 15 days after breeding, while the mare is marked Bred', 'interval_days': 0, 'thresholds': T7,
         'kind': 'relative', 'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Breeding date'}, 'offset': {'days': 15, 'direction': 'after'}}),
         'rule_condition': json.dumps({'columnId': {'column': 'Breeding status'}, 'op': 'is', 'values': ['Bred'], 'whenFalse': 'hide'})},
        {'name': 'Foaling due', 'description': 'About 340 days after breeding, while the mare is Bred or In foal', 'interval_days': 0, 'thresholds': T30,
         'kind': 'relative', 'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Breeding date'}, 'offset': {'days': 340, 'direction': 'after'}}),
         'rule_condition': json.dumps({'columnId': {'column': 'Breeding status'}, 'op': 'is', 'values': ['Bred', 'In foal'], 'whenFalse': 'hide'})},
    ],
    'checklists': [
        {'name': 'New horse arriving', 'description': 'Before a new boarder moves in', 'items': json.dumps([
            'Copy of a negative Coggins from the last 12 months', 'Vaccine record copied', "Owner's emergency contact and vet",
            'Quarantine stall ready', 'Feeding plan written down', 'Farrier schedule agreed'])},
    ],
    'links': [{'to': 'owners', 'label_forward': 'Owner', 'label_backward': 'Horses', 'cardinality': 'many_to_one'}],
}

owners = {
    'key': 'owners', 'name': 'Owners', 'description': 'Boarders and owners of the horses in your care', 'kind': 'person',
    'vocab': {'record': {'one': 'owner', 'many': 'owners', 'article': 'an'}},
    'columns': [
        col('Name', 'text', 0, 180, is_name_column=1, is_identifier=1, is_required=1),
        col('Phone', 'phone', 1, 140, is_required=1),
        col('Email', 'email', 2, 200),
        col('Address', 'address', 3, 170),
        col('Board plan', 'dropdown', 4, 140, config=json.dumps({'options': ['Full board', 'Pasture board', 'Self-care', 'Training']})),
        col('Emergency contact', 'text', 5, 170, is_required=1, description='Who to call if the owner can\'t be reached'),
        col('Emergency phone', 'phone', 6, 140),
        date_col('Boarding agreement signed', 7, 'Every year', 'Renew the agreement every year'),
        col('Notes', 'notes', 8, 220),
    ],
    'alertRules': [
        {'name': 'Every year', 'description': 'Due on the same date a year later', 'interval_months': 12, 'thresholds': T30},
    ],
}

HORSES = [
    # name, breed, born, stall, owner, farrier, deworm, coggins, vaccines, teeth, breeding extras
    ('Biscuit', 'Quarter Horse', -365 * 12, 'Stall 1', 0, -52, -80, -340, -170, -200, {}),
    ('Captain Sprinkles', 'Welsh pony', -365 * 15, 'Stall 2', 1, -30, -95, -380, -100, -400, {}),
    ('Moonpie', 'Morgan', -365 * 9, 'Stall 3', 2, -45, -20, -100, -60, -300, {'Breeding status': 'Bred', 'Breeding date': d(-12)}),
    ('Duchess', 'Paint', -365 * 11, 'Foaling stall', 2, -10, -40, -200, -175, -150, {'Breeding status': 'In foal', 'Breeding date': d(-300), 'Pregnancy check': d(-285)}),
    ('Tater Tot', 'Miniature horse', -365 * 7, 'Paddock B', 3, -60, -10, -20, -190, -30, {}),
    ('Rocket', 'Thoroughbred', -365 * 6, 'Stall 4', 0, -5, -70, -360, -20, -350, {'Breeding status': 'Open'}),
]
horse_records = []
for name, breed, born, stall, _, farrier, deworm, coggins, vacc, teeth, extra in HORSES:
    horse_records.append({'Name': name, 'Breed': breed, 'Born': d(born), 'Stall': stall, 'Last farrier visit': d(farrier), 'Last deworming': d(deworm),
                          'Coggins test': d(coggins), 'Last vaccines': d(vacc), 'Teeth floated': d(teeth), **extra})

OWNERS = [
    ('Priya Bell', '248 Elm Street', 'Full board', 'Raj Bell', -370),
    ('Frank Rivera', '285 Pine Road', 'Pasture board', 'Maria Rivera', -200),
    ('Keisha Thompson', '322 Oak Terrace', 'Full board', 'Dana Thompson', -350),
    ('Samuel Rahman', '359 Aspen Drive', 'Self-care', 'Leah Rahman', -30),
]
owner_records = []
for i, (n, a, plan, ec, signed) in enumerate(OWNERS):
    owner_records.append({'Name': n, 'Phone': f'555-01{41 + i * 7}', 'Email': n.lower().replace(' ', '.') + '@example.com', 'Address': f'{a}\nSpringfield',
                          'Board plan': plan, 'Emergency contact': ec, 'Emergency phone': f'555-01{43 + i * 7}', 'Boarding agreement signed': d(signed)})
owner_records[1]['Notes'] = 'Pays board on the 1st. Prefers texts.'

sample = {
    'records': {'horses': horse_records, 'owners': owner_records},
    'links': [{'from': f'horses#{i}', 'to': f'owners#{h[4]}', 'link': 'Owner'} for i, h in enumerate(HORSES)],
    'activities': [
        {'record': 'horses#0', 'type': 'farrier', 'daysAgo': 52, 'text': 'Front shoes reset, hinds trimmed. Left front wall a little thin.'},
        {'record': 'horses#2', 'type': 'vet_visit', 'daysAgo': 12, 'text': 'Bred by AI. Ultrasound pencilled in for about two weeks out.'},
        {'record': 'horses#3', 'type': 'vet_visit', 'daysAgo': 285, 'text': 'Ultrasound confirmed in foal. Single pregnancy.'},
        {'record': 'horses#4', 'type': 'feeding_change', 'daysAgo': 6, 'text': 'Cut grain to half a scoop; grazing muzzle on in the afternoon.'},
        {'record': 'horses#1', 'type': 'injury', 'daysAgo': 3, 'text': 'Small scrape on the right hind cannon. Cleaned, watching for swelling.'},
        {'record': 'horses#5', 'type': 'farrier', 'daysAgo': 5, 'text': 'Full set of shoes before the show season.'},
    ],
    'appointments': [
        {'record': 'horses#0', 'title': 'Farrier', 'dayOffset': 1, 'time': '09:00', 'minutes': 60, 'type': 'farrier', 'location': 'Barn aisle'},
        {'record': 'horses#4', 'title': 'Farrier: trim', 'dayOffset': 1, 'time': '10:00', 'minutes': 30, 'type': 'farrier', 'location': 'Barn aisle'},
        {'record': 'horses#2', 'title': 'Pregnancy check ultrasound', 'dayOffset': 3, 'time': '14:00', 'minutes': 30, 'type': 'vet_visit'},
        {'record': 'horses#1', 'title': 'Coggins draw and teeth', 'dayOffset': 5, 'time': '11:00', 'minutes': 60, 'type': 'vet_visit'},
        {'record': 'horses#3', 'title': 'Pre-foaling vet check', 'dayOffset': 20, 'time': '10:00', 'minutes': 45, 'type': 'vet_visit'},
        {'record': 'horses#5', 'title': 'Farrier: shoes', 'dayOffset': -5, 'time': '09:00', 'minutes': 60, 'type': 'farrier', 'location': 'Barn aisle'},
    ],
}

starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'horse-barn', 'name': 'Horse barn & small herd',
    'description': 'For barn managers and horse owners: farrier every 7 weeks, deworming, yearly Coggins, spring and fall shots, teeth, and breeding dates through to foaling, with each horse linked to its owner.',
    'icon': 'tractor', 'group': 'Animals',
    'vocab': {'record': {'one': 'record', 'many': 'records', 'article': 'a'}, 'list': {'one': 'list', 'many': 'lists', 'article': 'a'}, 'activity': {'one': 'note', 'many': 'notes', 'article': 'a'}},
    'suggestedFeatures': {'personFields': False, 'priority': False, 'contactsDirectory': False, 'requirements': False, 'timeTracking': False, 'mileage': False,
                          'snippets': True, 'checklists': True, 'tasks': True, 'focusMode': False, 'letters': True, 'summaryReport': True, 'handoff': False,
                          'links': True, 'stages': False, 'measures': False, 'appointments': True, 'forms': False, 'attachments': True},
    'activityTypes': [
        {'key': 'note', 'label': 'Note', 'icon': '📝', 'color': 'slate'},
        {'key': 'vet_visit', 'label': 'Vet visit', 'icon': '🩺', 'color': 'blue'},
        {'key': 'farrier', 'label': 'Farrier', 'icon': '🔨', 'color': 'orange'},
        {'key': 'feeding_change', 'label': 'Feeding change', 'icon': '🌾', 'color': 'amber'},
        {'key': 'injury', 'label': 'Injury', 'icon': '🩹', 'color': 'red'},
    ],
    'documentTemplates': [
        {'name': 'Vaccines coming up', 'content': "{{today}}\n\nHi {{linked:Owner.Name}},\n\n{{name}} is due for spring or fall shots: {{deadline:Last vaccines}}.\n\nThe vet is coming out soon, so let us know if you'd like {{name}} added to the list, or if your own vet will handle it.\n\nThanks,\n\n{{my_name}}"},
        {'name': 'Coggins due', 'content': "{{today}}\n\nHi {{linked:Owner.Name}},\n\n{{name}}'s Coggins test is coming due: {{deadline:Coggins test}}. We need a current negative Coggins on file for every horse in the barn.\n\nWe can have it drawn at the next vet visit, or you can drop off a copy from your own vet.\n\nThanks,\n\n{{my_name}}"},
    ],
    'helpTips': [
        {'title': 'Farrier and shots', 'body': 'Fill in the date of each farrier visit, deworming, Coggins and set of shots. Pulse works out when the next one is due and colors it as it gets close.'},
        {'title': 'Breeding', 'body': "Set a mare's Breeding status to Bred and enter the breeding date. The pregnancy check comes due about 15 days later and foaling about 340 days later. Change it to In foal once she's confirmed, and to Foaled when the foal arrives: the reminders go away on their own."},
        {'title': 'Papers', 'body': 'Drop Coggins certificates, vaccine records and boarding agreements into Files on the horse or owner. They are stored encrypted inside Pulse.'},
    ],
    'lists': [horses, owners],
    'dashboardCards': ['summary', 'today', 'missingInfo', 'recentActivity'],
    'sampleData': sample,
}

json.dump(starter, open(sys.argv[1], 'w'), indent=2, ensure_ascii=False)
open(sys.argv[1], 'a').write('\n')
print('written')
