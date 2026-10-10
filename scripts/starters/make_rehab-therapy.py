"""Generates src/shared/starters/rehab-therapy.json (thresholds and configs are JSON strings)."""
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

def col(name, ctype, pos, width, **kw):
    c = {'name': name, 'column_type': ctype, 'position': pos, 'width': width}
    c.update(kw)
    return c

def date_col(name, pos, rule, description=None):
    c = col(name, 'date', pos, 160, config=json.dumps({'alert_rule_name': rule, 'log_changes': True}))
    if description: c['description'] = description
    return c

def d(n): return {'daysFromToday': n}

NOT_DISCHARGED = json.dumps({'columnId': {'column': 'Stage'}, 'op': 'is_not', 'values': ['Discharged'], 'whenFalse': 'hide'})

STAGES = [('Evaluation', 'slate', '#64748b'), ('Active', 'blue', '#3b82f6'), ('On hold', 'amber', '#f59e0b'), ('Discharged', 'green', '#22c55e')]

patients = {
    'key': 'patients', 'name': 'Patients', 'description': 'Everyone you treat, with their orders, plan of care and authorized visits', 'kind': 'person',
    'vocab': {'record': {'one': 'patient', 'many': 'patients', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 180, is_name_column=1, is_identifier=1, is_required=1),
        col('Date of birth', 'date', 1, 140),
        col('Phone', 'phone', 2, 140),
        col('Discipline', 'dropdown', 3, 130, is_required=1, config=json.dumps({'options': ['Speech', 'OT', 'PT']})),
        col('Stage', 'status', 4, 140, config=json.dumps({'options': [{'label': s, 'color': h} for s, _, h in STAGES]})),
        col('Evaluation date', 'date', 5, 150, description='Day of the first evaluation; the signed order is due 30 days later', is_required=1),
        date_col('Order signed on', 6, 'Physician order', "Date the doctor signed the plan of care. Due within 30 days of the evaluation"),
        date_col('Plan of care start', 7, 'Plan of care recert', 'Start of the current plan of care; recertify every 90 days'),
        col('Visits authorized', 'number', 8, 130),
        col('Authorization start', 'date', 9, 150),
        col('Authorization end', 'date', 10, 150),
        col('Visits left', 'deadline', 11, 140, description='Visits used against the authorization, and when it ends', config=json.dumps({'alert_rule_name': 'Visits left'})),
        col('Last progress note', 'date', 12, 150, description='Date of the last progress note (or the evaluation). Update it each time you write one', config=json.dumps({'log_changes': True})),
        col('Progress note due', 'deadline', 13, 150, description='Treatment visits since the last progress note; one is due every 10', config=json.dumps({'alert_rule_name': 'Progress note every 10 visits'})),
    ],
    'alertRules': [
        {'name': 'Physician order', 'description': 'Signed order due 30 days after the evaluation', 'interval_days': 0, 'thresholds': T14,
         'kind': 'relative', 'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Evaluation date'}, 'offset': {'days': 30, 'direction': 'after'}})},
        {'name': 'Plan of care recert', 'description': 'Recertify the plan of care every 90 days', 'interval_days': 90, 'thresholds': T30,
         'rule_condition': NOT_DISCHARGED},
        {'name': 'Visits left', 'description': 'Counts visits between the authorization start and end dates', 'interval_days': 0, 'thresholds': T30,
         'kind': 'quota', 'rule_config': json.dumps({'kind': 'quota', 'activityTypes': ['evaluation', 'visit', 'progress'], 'limitColumnId': {'column': 'Visits authorized'},
                                                     'startColumnId': {'column': 'Authorization start'}, 'endColumnId': {'column': 'Authorization end'}, 'warnRemaining': 3, 'warnDaysBeforeEnd': 14}),
         'rule_condition': NOT_DISCHARGED},
        {'name': 'Progress note every 10 visits', 'description': 'Counts treatment visits since the last progress note; one is due by the 10th', 'interval_days': 0, 'thresholds': T7,
         'kind': 'quota', 'rule_config': json.dumps({'kind': 'quota', 'activityTypes': ['visit'], 'limit': 10,
                                                     'startColumnId': {'column': 'Last progress note'}, 'endColumnId': {'column': 'Authorization end'}, 'warnRemaining': 2, 'warnDaysBeforeEnd': 0}),
         'rule_condition': NOT_DISCHARGED},
    ],
    'checklists': [
        {'name': 'Discharge', 'description': 'Wrapping up care', 'items': json.dumps([
            'Discharge summary written', 'Home exercise program given and explained', 'Summary sent to the referring doctor',
            'Loaned equipment returned', 'Patient or family told how to reach you'])},
    ],
    'links': [{'to': 'doctors', 'label_forward': 'Referred by', 'label_backward': 'Patients', 'cardinality': 'many_to_one'}],
    'stage': {'column': 'Stage', 'options': [
        {'value': s, 'color': c, **({'done': True, 'onEnter': {'checklist': 'Discharge'}} if s == 'Discharged' else {})}
        for s, c, _ in STAGES], 'hideDoneAfterDays': 30},
    'forms': [{
        'name': 'Evaluation', 'intro': 'Fill this in at the first visit, or print a blank for the front desk.', 'log_activity_type': 'evaluation',
        'fields': [
            {'kind': 'section', 'title': 'About the patient'},
            {'kind': 'column', 'column': 'Name', 'required': True},
            {'kind': 'column', 'column': 'Date of birth', 'width': 'half'},
            {'kind': 'column', 'column': 'Phone', 'width': 'half'},
            {'kind': 'column', 'column': 'Discipline', 'width': 'half'},
            {'kind': 'column', 'column': 'Evaluation date', 'width': 'half'},
            {'kind': 'section', 'title': 'Why they were referred', 'text': 'In the words of the patient or family, and the doctor\'s order.'},
            {'kind': 'note', 'label': 'Reason for referral', 'required': True},
            {'kind': 'note', 'label': 'What the patient or family hopes to get back to'},
            {'kind': 'section', 'title': 'Authorization'},
            {'kind': 'column', 'column': 'Visits authorized', 'width': 'half'},
            {'kind': 'column', 'column': 'Authorization start', 'width': 'half'},
            {'kind': 'column', 'column': 'Authorization end', 'width': 'half'},
        ]}],
}

doctors = {
    'key': 'doctors', 'name': 'Referring doctors', 'description': 'Doctors who send patients and sign plans of care', 'kind': 'person',
    'vocab': {'record': {'one': 'doctor', 'many': 'doctors', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 190, is_name_column=1, is_identifier=1, is_required=1),
        col('Practice', 'text', 1, 200),
        col('Phone', 'phone', 2, 140),
        col('Fax', 'phone', 3, 140, description='Where to send plans of care for signature'),
        col('Email', 'email', 4, 200),
        col('Notes', 'notes', 5, 240),
    ],
}

# name, DOB, phone index, discipline, stage, eval, order, plan start, auth (n, start, end), last progress, doctor
P = [
    ('Ava Martinez', -2900, 'Speech', 'Active', -40, -30, -40, (24, -40, 50), -25, 0),
    ('Noah Bennett', -24800, 'PT', 'Active', -85, -70, -85, (20, -85, 5), -20, 1),
    ('Grace Liu', -26100, 'OT', 'Active', -20, None, -20, (12, -20, 70), -20, 2),
    ('Henry Adams', -21500, 'PT', 'Active', -38, None, -38, (16, -38, 52), -38, 1),
    ('Maya Patel', -1900, 'Speech', 'On hold', -100, -90, -100, (24, -100, -5), -60, 0),
    ('Owen Brooks', -3300, 'OT', 'Evaluation', -2, None, None, None, None, 2),
    ('Lily Chen', -17900, 'PT', 'Discharged', -120, -110, -120, (24, -120, -10), -30, 3),
    ('Eli Foster', -2500, 'Speech', 'Active', -60, -50, -60, (30, -60, 120), -10, 3),
]
records = []
for i, (name, dob, disc, stage, ev, order, plan, auth, prog, _) in enumerate(P):
    r = {'Name': name, 'Date of birth': d(dob), 'Phone': f'555-01{20 + i * 4}', 'Discipline': disc, 'Stage': stage, 'Evaluation date': d(ev)}
    if order is not None: r['Order signed on'] = d(order)
    if plan is not None: r['Plan of care start'] = d(plan)
    if auth: r['Visits authorized'], r['Authorization start'], r['Authorization end'] = auth[0], d(auth[1]), d(auth[2])
    if prog is not None: r['Last progress note'] = d(prog)
    records.append(r)

DOCS = [('Dr. Helen Ward', 'Maple Pediatrics'), ('Dr. Raj Iyer', 'Riverside Orthopedics'), ('Dr. Carmen Diaz', 'Lakeview Family Medicine'), ('Dr. Paul Novak', 'Northside Neurology')]
doc_records = [{'Name': n, 'Practice': p, 'Phone': f'555-01{60 + i * 3}', 'Fax': f'555-01{61 + i * 3}',
                'Email': n.lower().replace('dr. ', '').replace(' ', '.') + '@example.com'} for i, (n, p) in enumerate(DOCS)]
doc_records[1]['Notes'] = 'Prefers plans of care by fax; signs on Fridays.'

# Notes: evaluation, visits (twice a week) and progress notes, so both quotas have something to count
VISIT_TEXT = {
    'Speech': 'Worked on target sounds in words and short phrases; practiced at home with a parent.',
    'OT': 'Fine motor and dressing practice; updated the home program.',
    'PT': 'Gait training and strengthening; walked farther with less help.',
}
NOTES = {
    0: ([38, 35, 31, 28, 24, 21, 17, 14, 10, 7, 3, 1], [25]),
    1: ([82, 78, 75, 71, 68, 64, 61, 50, 45, 40, 18, 14, 11, 7, 4], [55, 20]),
    2: ([17, 13, 10, 6, 3], []),
    3: ([36, 33, 29, 26, 22, 19, 15, 12, 8, 5], []),
    4: ([95, 91, 88, 84, 81, 77, 74, 70, 56, 53, 49], [60]),
    5: ([], []),
    6: ([115, 110, 104, 100, 95, 90, 84, 77, 70, 63, 56, 49, 42, 35, 28, 21, 14, 7], [90, 60, 30]),
    7: ([57, 53, 50, 46, 43, 39, 36, 32, 29, 25, 22, 18, 15, 12, 8, 4], [10]),
}
activities = []
for i, (name, _, disc, stage, ev, *_rest) in enumerate(P):
    activities.append({'record': f'patients#{i}', 'type': 'evaluation', 'daysAgo': -ev, 'text': f'{disc} evaluation. Goals set with the patient and family; plan of care sent for signature.'})
    visits, progress = NOTES[i]
    for v in visits: activities.append({'record': f'patients#{i}', 'type': 'visit', 'daysAgo': v, 'text': VISIT_TEXT[disc]})
    for p in progress: activities.append({'record': f'patients#{i}', 'type': 'progress', 'daysAgo': p, 'text': 'Progress note: goals reviewed, steady gains, continue the plan of care.'})
activities += [
    {'record': 'patients#3', 'type': 'phone', 'daysAgo': 6, 'text': "Called Dr. Iyer's office about the unsigned plan of care; they will fax it back this week."},
    {'record': 'patients#4', 'type': 'no_show', 'daysAgo': 42, 'text': 'No-show. Family away; on hold until they are back.'},
    {'record': 'patients#2', 'type': 'phone', 'daysAgo': 15, 'text': 'Left a message for Dr. Diaz to sign the order.'},
]

def twice_weekly(rec, first, second, time, room, n=6):
    return [{'record': rec, 'title': 'Treatment visit', 'dayOffset': first, 'time': time, 'minutes': 45, 'type': 'visit', 'location': room, 'repeatWeekly': n},
            {'record': rec, 'title': 'Treatment visit', 'dayOffset': second, 'time': time, 'minutes': 45, 'type': 'visit', 'location': room, 'repeatWeekly': n}]

appointments = (twice_weekly('patients#0', 1, 4, '15:30', 'Speech room') + twice_weekly('patients#1', 0, 3, '09:00', 'Gym')
                + twice_weekly('patients#2', 2, 5, '11:00', 'OT room') + twice_weekly('patients#3', 1, 4, '13:00', 'Gym')
                + twice_weekly('patients#7', 2, 5, '16:15', 'Speech room')
                + [{'record': 'patients#5', 'title': 'First treatment visit', 'dayOffset': 3, 'time': '10:00', 'minutes': 45, 'type': 'visit', 'location': 'OT room'}])

sample = {
    'records': {'patients': records, 'doctors': doc_records},
    'links': [{'from': f'patients#{i}', 'to': f'doctors#{p[-1]}', 'link': 'Referred by'} for i, p in enumerate(P)],
    'activities': activities,
    'history': [
        {'record': 'patients#4', 'column': 'Stage', 'values': [{'value': 'Evaluation', 'daysAgo': 100}, {'value': 'Active', 'daysAgo': 98}, {'value': 'On hold', 'daysAgo': 42}]},
        {'record': 'patients#6', 'column': 'Stage', 'values': [{'value': 'Evaluation', 'daysAgo': 120}, {'value': 'Active', 'daysAgo': 118}, {'value': 'Discharged', 'daysAgo': 3}]},
    ],
    'appointments': appointments,
}

starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'rehab-therapy', 'name': 'Speech, OT and PT practice',
    'description': 'For speech, occupational and physical therapists: plan of care recertification every 90 days, a progress note every 10 visits, authorized visits counted as you write notes, signed doctor orders within 30 days, twice-weekly visits on the calendar and an evaluation form. Pulse is a tracking aid, not your official record system.',
    'icon': 'activity', 'group': 'Health',
    'vocab': {'record': {'one': 'patient', 'many': 'patients', 'article': 'a'}, 'list': {'one': 'list', 'many': 'lists', 'article': 'a'},
              'activity': {'one': 'note', 'many': 'notes', 'article': 'a'}, 'worker': {'one': 'therapist', 'many': 'therapists', 'article': 'a'}},
    'suggestedFeatures': {'personFields': True, 'priority': False, 'contactsDirectory': False, 'requirements': False, 'timeTracking': True, 'mileage': False,
                          'snippets': True, 'checklists': True, 'tasks': True, 'focusMode': True, 'letters': True, 'summaryReport': True, 'handoff': True,
                          'links': True, 'stages': True, 'measures': False, 'appointments': True, 'forms': True, 'attachments': True},
    'activityTypes': [
        {'key': 'evaluation', 'label': 'Evaluation', 'icon': '📋', 'color': 'purple'},
        {'key': 'visit', 'label': 'Treatment visit', 'icon': '🤸', 'color': 'teal'},
        {'key': 'progress', 'label': 'Progress note', 'icon': '📈', 'color': 'green'},
        {'key': 'phone', 'label': 'Phone', 'icon': '📞', 'color': 'blue'},
        {'key': 'no_show', 'label': 'No-show', 'icon': '🚫', 'color': 'red'},
    ],
    'documentTemplates': [
        {'name': 'Physician signature request', 'content': '{{today}}\n\nDear {{linked:Referred by.Name}},\n\nRe: {{name}}, born {{field:Date of birth}}\n\nWe evaluated {{name}} for {{field:Discipline}} on {{field:Evaluation date}}. The plan of care that started on {{field:Plan of care start}} is enclosed.\n\nPlease sign and return it so treatment can continue without a break. You can fax it back to us.\n\nThank you,\n\n{{my_name}}'},
        {'name': 'Authorization request', 'content': '{{today}}\n\nRe: {{name}}, born {{field:Date of birth}}\n\nThe current authorization of {{field:Visits authorized}} {{field:Discipline}} visits ends on {{field:Authorization end}}. {{name}} is making progress toward the goals in the plan of care, and we are asking for more visits to continue treatment.\n\nThe latest progress note was written on {{field:Last progress note}}.\n\nThank you,\n\n{{my_name}}'},
    ],
    'helpTips': [
        {'title': 'Twice-weekly visits', 'body': "On a patient's page, add an appointment and choose Repeat weekly; add a second one for the other day. Marking a visit done writes its Treatment visit note, which counts toward Visits left and Progress note due."},
        {'title': 'Progress notes', 'body': 'Write a note of the kind Progress note, then change Last progress note to today. The count of treatment visits starts again, and Progress note due warns as you get close to 10.'},
        {'title': 'Signed orders', 'body': 'The order is due 30 days after the Evaluation date. Fill in Order signed on when it comes back, and drop the signed copy into Files on the patient\'s page.'},
        {'title': 'Plan of care', 'body': 'Change Plan of care start each time you recertify. Pulse reminds you 90 days later, and stops once the patient is discharged.'},
    ],
    'lists': [patients, doctors],
    'dashboardCards': ['today', 'summary', 'quotas', 'stages', 'missingInfo'],
    'sampleData': sample,
}

json.dump(starter, open(sys.argv[1], 'w'), indent=2, ensure_ascii=False)
open(sys.argv[1], 'a').write('\n')
print('written')
