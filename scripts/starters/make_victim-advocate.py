"""Generates src/shared/starters/victim-advocate.json (thresholds and configs are JSON strings)."""
import json, sys

def th(*steps):
    labels = {'coming': 'Coming up', 'soon': 'Due soon', 'urgent': 'Urgent'}
    colors = {'coming': '#bbf7d0', 'soon': '#facc15', 'urgent': '#fb923c'}
    out = [{'daysBefore': d, 'bgClass': colors[k], 'label': labels[k]} for k, d in steps]
    out += [{'daysBefore': 0, 'bgClass': '#dc2626', 'label': 'Due today'}, {'daysBefore': -1, 'bgClass': 'alert-pulse-dark', 'label': 'Overdue'}]
    return json.dumps(out)

T3 = th(('soon', 3), ('urgent', 1))
T7 = th(('soon', 7), ('urgent', 3))
T30 = th(('coming', 30), ('soon', 14), ('urgent', 7))
T60 = th(('coming', 60), ('soon', 30), ('urgent', 14))

def col(name, ctype, pos, width, **kw):
    c = {'name': name, 'column_type': ctype, 'position': pos, 'width': width}
    c.update(kw)
    return c

def date_col(name, pos, rule, description=None, **kw):
    c = col(name, 'date', pos, 160, config=json.dumps({'alert_rule_name': rule, 'log_changes': True}), **kw)
    if description: c['description'] = description
    return c

def d(n): return {'daysFromToday': n}

def cond(column, op, values=None):
    c = {'columnId': {'column': column}, 'op': op, 'whenFalse': 'hide'}
    if values is not None: c['values'] = values
    return json.dumps(c)

caseload = {
    'key': 'caseload', 'name': 'Advocacy caseload', 'description': 'People you support, with safe ways to reach them, protective orders and claims', 'kind': 'person',
    'columns': [
        col('Name', 'text', 0, 190, is_name_column=1, is_identifier=1, is_required=1),
        col('Safe contact method', 'dropdown', 1, 190, is_required=1,
            description='How it is safe to reach them. Check this every time before you call, text or mail anything',
            config=json.dumps({'options': ['Call this number', 'Text only', 'Email only', 'Through a trusted person', 'Wait for them to call']})),
        col('Safe phone', 'phone', 2, 140, description='A number they said is safe to use'),
        col('Safe times and notes', 'notes', 3, 240, description='When it is safe to reach them, and whether you may leave a message'),
        col('Referred by', 'dropdown', 4, 150, config=json.dumps({'options': ['Police', "Prosecutor's office", 'Hospital', 'Shelter', 'Self', 'Other']})),
        col('Incident date', 'date', 5, 150, description='The date the crime happened. The compensation claim deadline is counted from it'),
        date_col('Compensation claim filed', 6, 'Compensation claim deadline', 'Date the crime victim compensation claim was filed'),
        date_col('Protective order expires', 7, 'Protective order (30 days ahead)', 'Leave blank if there is no order'),
        date_col('Last safety check-in', 8, 'Every 30 days', 'Date you last went over the safety plan together'),
        date_col('Restitution follow-up', 9, 'Due date', 'Next time to check on restitution payments'),
        col('Status', 'dropdown', 10, 130, config=json.dumps({'options': ['Active', 'Court pending', 'Closed']})),
    ],
    'alertRules': [
        {'name': 'Protective order (30 days ahead)', 'description': 'The date the order runs out; warns 30 days ahead so there is time to ask for an extension', 'interval_days': 0, 'thresholds': T30},
        {'name': 'Every 30 days', 'description': 'Due 30 days after the date entered, while the case is open', 'interval_days': 30, 'thresholds': T7,
         'rule_condition': cond('Status', 'is_not', ['Closed'])},
        {'name': 'Compensation claim deadline', 'description': "Due 1 year after the incident date. Check your state's deadline and change this rule if it is different",
         'interval_days': 0, 'thresholds': T60, 'kind': 'relative',
         'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Incident date'}, 'offset': {'months': 12, 'direction': 'after'}}),
         'rule_condition': cond('Status', 'is_not', ['Closed'])},
        {'name': 'Due date', 'description': 'The date entered is the deadline', 'interval_days': 0, 'thresholds': T7},
    ],
    'checklists': [
        {'name': 'Safety plan', 'description': 'Go over these together; update them at each check-in', 'items': json.dumps([
            'A safe place to go, and how to get there', 'A bag ready with keys, medicine, cash and a phone charger',
            'Important papers copied: ID, birth certificates, the protective order', 'A code word with trusted friends or family',
            'Emergency numbers written down, not only saved in the phone', 'A plan for children and pets', 'Safe ways to reach you, and times to avoid'])},
    ],
    'forms': [{
        'name': 'Intake', 'intro': 'Fill this in at the first meeting. Ask about safe contact first.', 'log_activity_type': 'note',
        'fields': [
            {'kind': 'section', 'title': 'Staying safe', 'text': 'Before anything else: how is it safe to reach you?'},
            {'kind': 'column', 'column': 'Name', 'required': True},
            {'kind': 'column', 'column': 'Safe contact method', 'required': True, 'width': 'half'},
            {'kind': 'column', 'column': 'Safe phone', 'width': 'half'},
            {'kind': 'column', 'column': 'Safe times and notes'},
            {'kind': 'section', 'title': 'What happened and where things stand'},
            {'kind': 'column', 'column': 'Incident date', 'width': 'half'},
            {'kind': 'column', 'column': 'Referred by', 'width': 'half'},
            {'kind': 'column', 'column': 'Protective order expires', 'width': 'half'},
            {'kind': 'note', 'label': 'What help are they asking for?', 'required': True},
        ]}],
}

court = {
    'key': 'court-dates', 'name': 'Court dates', 'description': 'Hearings for the people you support, with reminders and results', 'kind': 'job',
    'vocab': {'record': {'one': 'court date', 'many': 'court dates', 'article': 'a'}},
    'columns': [
        col('Hearing', 'text', 0, 220, is_name_column=1, is_identifier=1, is_required=1),
        col('Type', 'dropdown', 1, 170, config=json.dumps({'options': ['Arraignment', 'Pretrial', 'Trial', 'Sentencing', 'Protective order hearing', 'Restitution hearing', 'Parole hearing']})),
        col('Court', 'text', 2, 200),
        date_col('Hearing date', 3, 'Hearing', 'The date of the hearing; record the result afterwards'),
        date_col('Client reminded', 4, 'Remind 2 days before', 'Date you reminded them, using their safe contact method'),
        col('Going with them', 'checkbox', 5, 140, description='You plan to go to court with them'),
        col('Result', 'dropdown', 6, 140, config=json.dumps({'options': ['Held', 'Continued', 'Cancelled']})),
        col('Notes', 'notes', 7, 240),
    ],
    'alertRules': [
        {'name': 'Hearing', 'description': 'The hearing date, until a result is recorded', 'interval_days': 0, 'thresholds': T7,
         'rule_condition': cond('Result', 'empty')},
        {'name': 'Remind 2 days before', 'description': 'Remind the client 2 days before the hearing, until a result is recorded', 'interval_days': 0, 'thresholds': T3,
         'kind': 'relative', 'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Hearing date'}, 'offset': {'days': 2, 'direction': 'before'}}),
         'rule_condition': cond('Result', 'empty')},
    ],
    'links': [{'to': 'caseload', 'label_forward': 'Client', 'label_backward': 'Court dates', 'cardinality': 'many_to_one'}],
}

NAMES = ['Grace Okafor', 'Linh Smith', 'Dorothy Kowalski', 'Priya Bell', 'Keisha Thompson', 'Ruth Jackson', 'Mei Ortiz', 'Hannah Walker']
METHOD = ['Text only', 'Call this number', 'Through a trusted person', 'Call this number', 'Wait for them to call', 'Email only', 'Text only', 'Call this number']
TIMES = ['Weekdays 9–3 only. Never leave a voicemail.', 'Any time. OK to leave a short message: "Calling from the clinic."', 'Through her sister; see contacts.',
         'Mornings. No messages.', 'Do not call. She will call the office.', None, 'After 6 pm. No messages.', None]
REF = ['Police', "Prosecutor's office", 'Hospital', 'Police', 'Shelter', 'Self', "Prosecutor's office", 'Police']
INCIDENT = [-340, -120, -400, -60, -200, -355, -30, -500]
CLAIM = [None, -90, -350, None, None, None, None, -460]
ORDER = [25, 160, None, 8, -3, None, 300, None]
CHECK = [-33, -12, -45, -20, -28, -5, -2, -90]
REST = [None, 4, None, None, None, -6, None, None]
STATUS = ['Active', 'Court pending', 'Active', 'Court pending', 'Active', 'Active', 'Court pending', 'Closed']
cases = []
for i, n in enumerate(NAMES):
    r = {'Name': n, 'Safe contact method': METHOD[i], 'Referred by': REF[i], 'Incident date': d(INCIDENT[i]),
         'Last safety check-in': d(CHECK[i]), 'Status': STATUS[i]}
    if METHOD[i] in ('Text only', 'Call this number'): r['Safe phone'] = f'555-01{20 + i * 6:02d}'
    if TIMES[i]: r['Safe times and notes'] = TIMES[i]
    if CLAIM[i] is not None: r['Compensation claim filed'] = d(CLAIM[i])
    if ORDER[i] is not None: r['Protective order expires'] = d(ORDER[i])
    if REST[i] is not None: r['Restitution follow-up'] = d(REST[i])
    cases.append(r)

HEARINGS = [
    # hearing, type, client, date offset, reminded offset, going, result
    ('Pretrial hearing', 'Pretrial', 1, 3, None, True, None),
    ('Protective order hearing', 'Protective order hearing', 3, 1, -1, True, None),
    ('Sentencing', 'Sentencing', 6, 12, None, True, None),
    ('Restitution hearing', 'Restitution hearing', 5, 8, None, False, None),
    ('Arraignment', 'Arraignment', 0, -9, -11, True, 'Held'),
    ('Pretrial hearing', 'Pretrial', 6, -20, -22, False, 'Continued'),
    ('Trial', 'Trial', 1, 40, None, True, None),
]
court_records, links, appts = [], [], []
for i, (h, typ, client, when, reminded, going, result) in enumerate(HEARINGS):
    r = {'Hearing': h, 'Type': typ, 'Court': 'Springfield District Court, Room ' + str(2 + i % 3), 'Hearing date': d(when), 'Going with them': 'true' if going else 'false'}
    if reminded is not None: r['Client reminded'] = d(reminded)
    if result: r['Result'] = result
    court_records.append(r)
    links.append({'from': f'court-dates#{i}', 'to': f'caseload#{client}', 'link': 'Client'})
    if -30 <= when <= 30:
        appts.append({'record': f'court-dates#{i}', 'title': f'{h} (court)', 'dayOffset': when, 'time': '09:00', 'minutes': 120, 'type': 'court',
                      'location': r['Court'], **({'status': 'done'} if result == 'Held' else {'status': 'cancelled'} if result == 'Continued' else {})})

appts += [
    {'record': 'caseload#0', 'title': 'Safety check-in', 'dayOffset': 2, 'time': '10:00', 'minutes': 45, 'type': 'safety_check', 'location': 'Office, room B'},
    {'record': 'caseload#4', 'title': 'Compensation claim paperwork', 'dayOffset': 4, 'time': '13:30', 'minutes': 60, 'type': 'note', 'location': 'Office, room B'},
]

sample = {
    'records': {'caseload': cases, 'court-dates': court_records},
    'links': links,
    'activities': [
        {'record': 'caseload#0', 'type': 'safety_check', 'daysAgo': 33, 'text': 'Went over the safety plan. Bag is packed; code word set with her brother.'},
        {'record': 'caseload#1', 'type': 'court', 'daysAgo': 20, 'text': 'Went with her to the pretrial hearing. Continued; new date set.'},
        {'record': 'caseload#2', 'type': 'referral', 'daysAgo': 15, 'text': 'Referred to legal aid for help with the custody paperwork.'},
        {'record': 'caseload#3', 'type': 'phone', 'daysAgo': 3, 'text': 'Texted on her safe number about the protective order hearing; she will be there.'},
        {'record': 'caseload#4', 'type': 'phone', 'daysAgo': 6, 'text': 'She called the office. Wants help with the compensation claim.'},
        {'record': 'caseload#5', 'type': 'safety_check', 'daysAgo': 5, 'text': 'Check-in by email. Doing well; restitution payment is late again.'},
        {'record': 'caseload#6', 'type': 'court', 'daysAgo': 9, 'text': 'Explained what to expect at sentencing and the victim impact statement.'},
    ],
    'appointments': appts,
}

starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'victim-advocate', 'name': 'Victim advocate',
    'description': "For victim advocates: safe ways to reach each person, protective order expiry, court dates with reminders, safety plan check-ins every 30 days and the crime victim compensation claim deadline. Pulse is a tracking aid, not your official record system.",
    'icon': 'life-buoy', 'group': 'Human services',
    'vocab': {
        'record': {'one': 'client', 'many': 'clients', 'article': 'a'}, 'list': {'one': 'caseload', 'many': 'caseloads', 'article': 'a'},
        'activity': {'one': 'case note', 'many': 'case notes', 'article': 'a'}, 'activityLog': {'one': 'case log', 'many': 'case logs', 'article': 'a'},
        'contactDirectory': {'one': 'contacts', 'many': 'contacts', 'article': 'a', 'oneCap': 'Contacts', 'manyCap': 'Contacts'},
        'contact': {'one': 'provider', 'many': 'providers', 'article': 'a'}, 'priority': {'one': 'acuity level', 'many': 'acuity levels', 'article': 'an'},
        'archive': {'one': 'archive', 'many': 'archives', 'article': 'an'}, 'worker': {'one': 'advocate', 'many': 'advocates', 'article': 'an'},
        'requirement': {'one': 'contact requirement', 'many': 'contact requirements', 'article': 'a'},
        'appointment': {'one': 'appointment', 'many': 'appointments', 'article': 'an'}, 'stage': {'one': 'stage', 'many': 'stages', 'article': 'a'},
    },
    'suggestedFeatures': {'personFields': True, 'priority': False, 'contactsDirectory': True, 'requirements': False, 'timeTracking': False, 'mileage': False,
                          'snippets': True, 'checklists': True, 'tasks': True, 'focusMode': True, 'letters': True, 'summaryReport': True, 'handoff': True,
                          'links': True, 'stages': False, 'measures': False, 'appointments': True, 'forms': True, 'attachments': True},
    'activityTypes': [
        {'key': 'note', 'label': 'Note', 'icon': '📝', 'color': 'slate'},
        {'key': 'safety_check', 'label': 'Safety check-in', 'icon': '🛡️', 'color': 'green'},
        {'key': 'court', 'label': 'Court accompaniment', 'icon': '⚖️', 'color': 'purple'},
        {'key': 'phone', 'label': 'Phone', 'icon': '📞', 'color': 'blue'},
        {'key': 'referral', 'label': 'Referral', 'icon': '🔗', 'color': 'teal'},
    ],
    'documentTemplates': [
        {'name': 'Court date reminder', 'content': '{{today}}\n\nDear {{linked:Client.Name}},\n\nThis is a reminder about your court date:\n\n{{name}}\n{{field:Hearing date}}\n{{field:Court}}\n\nPlease arrive 30 minutes early. If you would like me to go with you, or if anything has changed, call me.\n\n{{my_name}}'},
        {'name': 'Protective order renewal reminder', 'content': '{{today}}\n\nDear {{name}},\n\nYour protective order runs out on {{field:Protective order expires}}. If you would like it extended, the request usually needs to be filed before then.\n\nCall me and we can go over it together.\n\n{{my_name}}'},
    ],
    'helpTips': [
        {'title': 'Safe contact comes first', 'body': 'Check Safe contact method before every call, text, email or letter. Never leave a voicemail unless the notes say it is OK, and only mail a letter if mail is a safe way to reach them.'},
        {'title': 'Court dates', 'body': 'Add each hearing to Court dates and link it to the client. Pulse reminds you to contact them 2 days before. After the hearing, set Result (Held, Continued or Cancelled) and the reminders go away; for a continuance, add the new date as a new court date.'},
        {'title': 'Compensation deadline', 'body': "The claim deadline is set to 1 year after the incident date. States differ: open the column's rule and change it to match yours. Fill in Compensation claim filed once it is in."},
        {'title': 'Keeping it private', 'body': 'Everything in Pulse is encrypted and stays on this computer. Pulse locks itself when you step away; lock it yourself (Ctrl+L) before anyone else can see the screen.'},
    ],
    'lists': [caseload, court],
    'dashboardCards': ['summary', 'today', 'missingInfo', 'recentActivity'],
    'sampleData': sample,
}

json.dump(starter, open(sys.argv[1], 'w'), indent=2, ensure_ascii=False)
open(sys.argv[1], 'a').write('\n')
print('written')
