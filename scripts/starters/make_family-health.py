"""Generates src/shared/starters/family-health.json (thresholds and configs are JSON strings)."""
import json, sys

def th(*steps):
    labels = {'coming': 'Coming up', 'soon': 'Due soon', 'urgent': 'Urgent'}
    colors = {'coming': '#bbf7d0', 'soon': '#facc15', 'urgent': '#fb923c'}
    out = [{'daysBefore': d, 'bgClass': colors[k], 'label': labels[k]} for k, d in steps]
    out += [{'daysBefore': 0, 'bgClass': '#dc2626', 'label': 'Due today'}, {'daysBefore': -1, 'bgClass': 'alert-pulse-dark', 'label': 'Overdue'}]
    return json.dumps(out)

T7 = th(('soon', 7), ('urgent', 3))
T30 = th(('coming', 30), ('soon', 14), ('urgent', 7))
T45 = th(('coming', 45), ('soon', 21), ('urgent', 7))

def col(name, ctype, pos, width, **kw):
    c = {'name': name, 'column_type': ctype, 'position': pos, 'width': width}
    c.update(kw)
    return c

def date_col(name, pos, rule, description=None):
    c = col(name, 'date', pos, 160, config=json.dumps({'alert_rule_name': rule, 'log_changes': True}))
    if description: c['description'] = description
    return c

def deadline_col(name, pos, rule, description):
    return col(name, 'deadline', pos, 150, description=description, config=json.dumps({'alert_rule_name': rule}))

def d(n): return {'daysFromToday': n}

def only(who):
    return json.dumps({'columnId': {'column': 'Who'}, 'op': 'is', 'values': [who], 'whenFalse': 'hide'})

CHECKUP_STEPS = [('1 month', 1), ('2 months', 2), ('4 months', 4), ('6 months', 6), ('9 months', 9), ('12 months', 12),
                 ('15 months', 15), ('18 months', 18), ('2 years', 24), ('30 months', 30), ('Yearly checkup', 36)]

family = {
    'key': 'family', 'name': 'Family', 'description': 'Everyone in the household, with checkups, cleanings and refills due', 'kind': 'person',
    'vocab': {'record': {'one': 'family member', 'many': 'family members', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 180, is_name_column=1, is_identifier=1, is_required=1),
        col('Who', 'dropdown', 1, 110, is_required=1, description='Child or adult: decides which checkups apply', config=json.dumps({'options': ['Child', 'Adult']})),
        col('Date of birth', 'date', 2, 150, description="Children's checkups count from here"),
        deadline_col('Checkups', 3, 'Well-child checkups', 'The next well-child checkup; mark it done to move on'),
        date_col('Last physical', 4, 'Yearly physical', 'For adults: date of the last yearly physical'),
        date_col('Last dental cleaning', 5, 'Every 6 months'),
        date_col('Last eye exam', 6, 'Every year'),
        deadline_col('Flu shot', 7, 'Flu shot', "This season's flu shot; mark it done when they've had it"),
        col('Allergies', 'notes', 8, 180),
        col('Medications', 'notes', 9, 200, description='Name, dose and how often'),
        date_col('Next refill', 10, 'Due date', 'When the next prescription refill is needed'),
        date_col('Insurance renews', 11, 'Renewal', 'Health or dental plan renewal, or when the card expires'),
    ],
    'alertRules': [
        {'name': 'Well-child checkups', 'description': "Checkups by age, counted from the date of birth: 1, 2, 4, 6, 9, 12, 15, 18 months, 2 years, 30 months, then every year",
         'interval_days': 0, 'thresholds': T30, 'kind': 'sequence',
         'rule_config': json.dumps({'kind': 'sequence', 'anchorColumnId': {'column': 'Date of birth'},
                                    'steps': [{'label': lab, 'offset': {'months': m}} for lab, m in CHECKUP_STEPS], 'repeatLast': {'months': 12}}),
         'rule_condition': only('Child')},
        {'name': 'Yearly physical', 'description': 'Due a year after the last physical (adults)', 'interval_months': 12, 'thresholds': T45, 'rule_condition': only('Adult')},
        {'name': 'Every 6 months', 'description': 'Due 6 months after the date entered', 'interval_months': 6, 'thresholds': T30},
        {'name': 'Every year', 'description': 'Due on the same date a year later', 'interval_months': 12, 'thresholds': T45},
        {'name': 'Flu shot', 'description': 'Every fall, by the end of October', 'interval_days': 0, 'thresholds': T30,
         'kind': 'calendar', 'rule_config': json.dumps({'kind': 'calendar', 'months': [10], 'day': 'last', 'lead': 45})},
        {'name': 'Due date', 'description': 'The date entered is the deadline', 'interval_days': 0, 'thresholds': T7},
        {'name': 'Renewal', 'description': 'The date entered is when it renews or runs out', 'interval_days': 0, 'thresholds': T30},
    ],
    'links': [{'to': 'doctors', 'label_forward': 'Doctors', 'label_backward': 'Sees', 'cardinality': 'many_to_many'}],
}

doctors = {
    'key': 'doctors', 'name': 'Doctors & dentists', 'description': "The doctors, dentists, eye doctors and pharmacy your family uses", 'kind': 'person',
    'vocab': {'record': {'one': 'doctor', 'many': 'doctors', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 210, is_name_column=1, is_identifier=1, is_required=1),
        col('Kind', 'dropdown', 1, 150, config=json.dumps({'options': ['Pediatrician', 'Family doctor', 'Dentist', 'Eye doctor', 'Specialist', 'Pharmacy']})),
        col('Practice', 'text', 2, 180),
        col('Phone', 'phone', 3, 140, is_required=1),
        col('Address', 'address', 4, 180),
        col('Patient portal', 'url', 5, 200, description='Website where you see results and send messages'),
        col('Notes', 'notes', 6, 220, description='Office hours, after-hours line, who to ask for'),
    ],
}

FAMILY = [
    # name, who, dob, extras
    ('Grace Okafor', 'Adult', -13020, {'Last physical': d(-340), 'Last dental cleaning': d(-170), 'Last eye exam': d(-300), 'Next refill': d(20),
                                        'Medications': 'Levothyroxine 50 mcg, every morning', 'Insurance renews': d(55)}),
    ('Samuel Okafor', 'Adult', -13540, {'Last physical': d(-390), 'Last dental cleaning': d(-200), 'Last eye exam': d(-380), 'Next refill': d(3),
                                         'Medications': 'Lisinopril 10 mg, once a day'}),
    ('Ruby Okafor', 'Child', -2100, {'Last dental cleaning': d(-60), 'Last eye exam': d(-330), 'Allergies': 'Penicillin (rash)'}),
    ('Maya Okafor', 'Child', -400, {'Last dental cleaning': d(-100)}),
    ('Leo Okafor', 'Child', -185, {'Allergies': 'None known'}),
]
family_records = [{'Name': n, 'Who': who, 'Date of birth': d(dob), **extra} for n, who, dob, extra in FAMILY]

DOCTORS = [
    ('Dr. Hannah Walker', 'Pediatrician', 'Springfield Pediatrics', '100 Maple Ave', 'Ask for the nurse line after 5 pm.'),
    ('Dr. Omar Brown', 'Family doctor', 'Birch Lane Family Medicine', '137 Birch Lane', None),
    ('Bright Smiles Dental', 'Dentist', 'Bright Smiles Dental', '174 Cedar Court', 'Cleanings book up 2 months ahead.'),
    ('Clearview Eye Care', 'Eye doctor', 'Clearview Eye Care', '211 Willow Way', None),
    ('Springfield Pharmacy', 'Pharmacy', 'Springfield Pharmacy', '248 Elm Street', 'Refills ready the next day after 2 pm.'),
]
doctor_records = []
for i, (n, kind, practice, addr, notes) in enumerate(DOCTORS):
    r = {'Name': n, 'Kind': kind, 'Practice': practice, 'Phone': f'555-01{20 + i * 6}', 'Address': f'{addr}\nSpringfield',
         'Patient portal': 'https://portal.example.com'}
    if notes: r['Notes'] = notes
    doctor_records.append(r)

LINKS = {0: [1, 2, 3, 4], 1: [1, 2, 3, 4], 2: [0, 2, 3], 3: [0, 2], 4: [0]}

sample = {
    'records': {'family': family_records, 'doctors': doctor_records},
    'links': [{'from': f'family#{f}', 'to': f'doctors#{doc}', 'link': 'Doctors'} for f, docs in LINKS.items() for doc in docs],
    # Steps already done, so only the next checkup shows (born 2100 / 400 / 185 days ago)
    'stepsDone': [
        {'record': 'family#2', 'column': 'Checkups', 'steps': 13},
        {'record': 'family#3', 'column': 'Checkups', 'steps': 6},
        {'record': 'family#4', 'column': 'Checkups', 'steps': 3},
    ],
    'activities': [
        {'record': 'family#3', 'type': 'doctor_visit', 'daysAgo': 35, 'text': '12-month checkup. Growing well; shots up to date. Next visit at 15 months.'},
        {'record': 'family#1', 'type': 'medication_change', 'daysAgo': 30, 'text': 'Blood pressure a bit high. Started lisinopril 10 mg once a day.'},
        {'record': 'family#2', 'type': 'sick_day', 'daysAgo': 5, 'text': 'Fever and sore throat, stayed home from school. Better by the next day.'},
        {'record': 'family#0', 'type': 'dentist', 'daysAgo': 170, 'text': 'Cleaning, no cavities.'},
        {'record': 'family#4', 'type': 'doctor_visit', 'daysAgo': 63, 'text': '4-month checkup. Rolling over; next visit at 6 months.'},
    ],
    'appointments': [
        {'record': 'family#4', 'title': '6-month checkup', 'dayOffset': 2, 'time': '10:30', 'minutes': 30, 'type': 'doctor_visit', 'location': 'Springfield Pediatrics'},
        {'record': 'family#1', 'title': 'Yearly physical', 'dayOffset': 6, 'time': '09:00', 'minutes': 45, 'type': 'doctor_visit', 'location': 'Birch Lane Family Medicine'},
        {'record': 'family#0', 'title': 'Dental cleaning', 'dayOffset': 12, 'time': '14:00', 'minutes': 60, 'type': 'dentist', 'location': 'Bright Smiles Dental'},
        {'record': 'family#2', 'title': 'Eye exam', 'dayOffset': 20, 'time': '15:30', 'minutes': 45, 'type': 'doctor_visit', 'location': 'Clearview Eye Care'},
        {'record': 'family#3', 'title': '12-month checkup', 'dayOffset': -35, 'time': '11:00', 'minutes': 30, 'type': 'doctor_visit', 'location': 'Springfield Pediatrics'},
    ],
}

DISCLAIMER = 'Pulse is a tracking aid, not your official record system.'
starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'family-health', 'name': 'Family health',
    'description': "For keeping your family's health on track: kids' checkups by age, yearly physicals, dentist every 6 months, eye exams, flu shots, refills and insurance renewals, with doctors and appointments in one place. It isn't medical advice: follow your doctor's schedule. " + DISCLAIMER,
    'icon': 'baby', 'group': 'Personal',
    'vocab': {'record': {'one': 'family member', 'many': 'family members', 'article': 'a'}, 'list': {'one': 'list', 'many': 'lists', 'article': 'a'}, 'activity': {'one': 'note', 'many': 'notes', 'article': 'a'}},
    'suggestedFeatures': {'personFields': False, 'priority': False, 'contactsDirectory': False, 'requirements': False, 'timeTracking': False, 'mileage': False,
                          'snippets': False, 'checklists': False, 'tasks': True, 'focusMode': False, 'letters': False, 'summaryReport': True, 'handoff': True,
                          'links': True, 'stages': False, 'measures': False, 'appointments': True, 'forms': False, 'attachments': True},
    'activityTypes': [
        {'key': 'note', 'label': 'Note', 'icon': '📝', 'color': 'slate'},
        {'key': 'doctor_visit', 'label': 'Doctor visit', 'icon': '🩺', 'color': 'blue'},
        {'key': 'dentist', 'label': 'Dentist', 'icon': '🦷', 'color': 'teal'},
        {'key': 'medication_change', 'label': 'Medication change', 'icon': '💊', 'color': 'purple'},
        {'key': 'sick_day', 'label': 'Sick day', 'icon': '🤒', 'color': 'amber'},
    ],
    'helpTips': [
        {'title': 'Checkups by age', 'body': "Enter each child's date of birth and Pulse shows their next well-child checkup. After the visit, mark it done and the next one appears. From age 3 it's once a year. Your doctor's schedule wins if it differs."},
        {'title': 'Private by design', 'body': "Your family's health details stay on this computer, encrypted with your password. Nothing goes to the cloud, and Pulse locks itself when you step away."},
        {'title': 'Vaccine records and insurance cards', 'body': "Drop a photo or PDF of vaccine records, insurance cards and test results into Files on each person's page. They're stored encrypted inside Pulse, ready when a school or camp asks."},
        {'title': 'Flu shots', 'body': 'Each fall the Flu shot column comes due by the end of October. Mark it done when everyone has had theirs.'},
    ],
    'lists': [family, doctors],
    'dashboardCards': ['summary', 'today', 'recentActivity', 'missingInfo'],
    'sampleData': sample,
}

json.dump(starter, open(sys.argv[1], 'w'), indent=2, ensure_ascii=False)
open(sys.argv[1], 'a').write('\n')
print('written')
