"""Generates src/shared/starters/volunteer-manager.json (thresholds and configs are JSON strings)."""
import json, sys

def th(*steps):
    labels = {'coming': 'Coming up', 'soon': 'Due soon', 'urgent': 'Urgent'}
    colors = {'coming': '#bbf7d0', 'soon': '#facc15', 'urgent': '#fb923c'}
    out = [{'daysBefore': d, 'bgClass': colors[k], 'label': labels[k]} for k, d in steps]
    out += [{'daysBefore': 0, 'bgClass': '#dc2626', 'label': 'Due today'}, {'daysBefore': -1, 'bgClass': 'alert-pulse-dark', 'label': 'Overdue'}]
    return json.dumps(out)

T7 = th(('soon', 7), ('urgent', 3))
T14 = th(('soon', 14), ('urgent', 7))
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

volunteers = {
    'key': 'volunteers', 'name': 'Volunteers', 'description': 'Everyone who gives their time, with orientation, checks and training due', 'kind': 'person',
    'vocab': {'record': {'one': 'volunteer', 'many': 'volunteers', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 190, is_name_column=1, is_identifier=1, is_required=1),
        col('Phone', 'phone', 1, 140, is_required=1),
        col('Email', 'email', 2, 200),
        col('Status', 'dropdown', 3, 130, config=json.dumps({'options': ['Active', 'On a break', 'Moved on']}), default_value='Active'),
        col('Signed up', 'date', 4, 140, description='The day they signed up', config=json.dumps({'log_changes': True})),
        date_col('Orientation done', 5, 'Orientation', 'Date they finished orientation; due within 30 days of signing up'),
        col('Needs background check', 'dropdown', 6, 190, config=json.dumps({'options': ['Yes', 'No']}),
            description='Yes for roles with children, vulnerable adults, money or keys'),
        date_col('Background check', 7, 'Background check', 'Date of the last check; renews every 2 years'),
        date_col('Last training', 8, 'Every year', 'Date of the last yearly refresher'),
        col('Last shift', 'date', 9, 140, description='The last time they came in', config=json.dumps({'log_changes': True})),
        date_col('Checked in', 10, 'Check-in', 'Date you last called or wrote to someone you haven’t seen in 60 days'),
        col('Total hours', 'number', 11, 120, description='All the hours they have given; thank them at 100, 250 and 500'),
        col('Emergency contact', 'text', 12, 200),
    ],
    'alertRules': [
        {'name': 'Orientation', 'description': 'Due 30 days after signing up', 'interval_days': 0, 'thresholds': T14,
         'kind': 'relative', 'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Signed up'}, 'offset': {'days': 30, 'direction': 'after'}})},
        {'name': 'Background check', 'description': 'Every 2 years, only for volunteers who need one', 'interval_months': 24, 'thresholds': T60,
         'rule_condition': json.dumps({'columnId': {'column': 'Needs background check'}, 'op': 'is', 'values': ['Yes'], 'whenFalse': 'hide'})},
        {'name': 'Every year', 'description': 'Due on the same date a year later', 'interval_months': 12, 'thresholds': T60},
        {'name': 'Check-in', 'description': 'Reach out 60 days after their last shift, while they are active', 'interval_days': 0, 'thresholds': T7,
         'kind': 'relative', 'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Last shift'}, 'offset': {'days': 60, 'direction': 'after'}}),
         'rule_condition': json.dumps({'columnId': {'column': 'Status'}, 'op': 'is', 'values': ['Active'], 'whenFalse': 'hide'})},
    ],
    'checklists': [
        {'name': 'New volunteer', 'description': 'From sign-up to first shift', 'items': json.dumps([
            'Application and emergency contact on file', 'Signed waiver and confidentiality agreement in Files', 'Background check sent (if their role needs one)',
            'Orientation done', 'Name badge and shirt', 'First shift scheduled with a buddy', 'Welcome letter sent'])},
    ],
    'links': [{'to': 'programs', 'label_forward': 'Serves in', 'label_backward': 'Volunteers', 'cardinality': 'many_to_many'}],
    'forms': [{
        'name': 'Volunteer sign-up', 'intro': 'Fill this in with a new volunteer, or print a blank for the front desk or an event table.', 'log_activity_type': 'note',
        'fields': [
            {'kind': 'section', 'title': 'About you'},
            {'kind': 'column', 'column': 'Name', 'required': True},
            {'kind': 'column', 'column': 'Phone', 'width': 'half', 'required': True},
            {'kind': 'column', 'column': 'Email', 'width': 'half'},
            {'kind': 'column', 'column': 'Emergency contact'},
            {'kind': 'section', 'title': 'Helping out'},
            {'kind': 'note', 'label': 'What would you like to help with?'},
            {'kind': 'note', 'label': 'Which days and times usually work for you?'},
            {'kind': 'note', 'label': 'Anything we should know (access needs, languages, skills)?'},
        ]}],
}

programs = {
    'key': 'programs', 'name': 'Programs', 'description': 'Where volunteers help, and how many each one needs', 'kind': 'thing',
    'vocab': {'record': {'one': 'program', 'many': 'programs', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 200, is_name_column=1, is_identifier=1, is_required=1),
        col('When', 'text', 1, 170, description='Day and time, e.g. "Saturdays 9–12"'),
        col('Where', 'text', 2, 170),
        col('Volunteers needed', 'number', 3, 150, description='How many people a shift needs'),
        col('Lead', 'text', 4, 150, description='Staff member or lead volunteer in charge'),
        col('Background check needed', 'dropdown', 5, 190, config=json.dumps({'options': ['Yes', 'No']})),
        col('Notes', 'notes', 6, 220),
    ],
}

VOLS = [
    # name, status, signed up, orientation, needs check, check, training, last shift, checked in, hours, programs
    ('Helen Brooks', 'Active', -900, -880, 'Yes', -700, -340, -2, None, 512, [0, 1]),
    ('Tom Nguyen', 'Active', -400, -390, 'No', None, -370, -5, None, 238, [0]),
    ('Grace Okafor', 'Active', -24, None, 'Yes', None, None, None, None, 0, [2]),
    ('Walter Johnson', 'Active', -620, -600, 'Yes', -735, -200, -64, None, 96, [2]),
    ('Mei Ortiz', 'Active', -40, None, 'No', None, None, None, None, 4, [3]),
    ('Diego Ferreira', 'Active', -300, -290, 'No', None, -290, -75, -10, 61, [0, 3]),
    ('Ruth Jackson', 'Active', -1500, -1480, 'Yes', -360, -20, -1, None, 1040, [1]),
    ('Hannah Walker', 'On a break', -500, -480, 'No', None, -480, -120, -50, 145, [3]),
    ('Ahmed Fischer', 'Active', -10, None, 'Yes', -5, None, None, None, 0, [1]),
    ('Yolanda Miller', 'Active', -200, -185, 'No', None, -185, -58, None, 248, [0]),
]
vol_records = []
for i, (n, status, signed, orient, needs, check, training, last, checked, hours, _) in enumerate(VOLS):
    r = {'Name': n, 'Phone': f'555-01{13 + i * 7:02d}', 'Email': n.lower().replace(' ', '.') + '@example.com', 'Status': status,
         'Signed up': d(signed), 'Needs background check': needs, 'Total hours': hours}
    for k, v in (('Orientation done', orient), ('Background check', check), ('Last training', training), ('Last shift', last), ('Checked in', checked)):
        if v is not None: r[k] = d(v)
    if i % 3 == 0: r['Emergency contact'] = ['Sam Brooks 555-0190', 'Lena Johnson 555-0191', 'Paul Walker 555-0192', 'Rosa Jackson 555-0193'][i // 3]
    vol_records.append(r)

PROGS = [
    {'Name': 'Food pantry: Saturday sort', 'When': 'Saturdays 9–12', 'Where': 'Warehouse, 50 Mill Street', 'Volunteers needed': 8, 'Lead': 'Ruth Jackson', 'Background check needed': 'No'},
    {'Name': 'Hospital front desk', 'When': 'Weekdays, 4-hour shifts', 'Where': 'Main lobby', 'Volunteers needed': 3, 'Lead': 'Dana (volunteer office)', 'Background check needed': 'Yes',
     'Notes': 'Flu shot required by November 1.'},
    {'Name': 'Youth reading buddies', 'When': 'Tuesdays 3:30–5', 'Where': 'Branch library', 'Volunteers needed': 6, 'Lead': 'Helen Brooks', 'Background check needed': 'Yes'},
    {'Name': 'Shelter dog walking', 'When': 'Daily, mornings', 'Where': 'Animal shelter, 12 Kennel Road', 'Volunteers needed': 4, 'Lead': 'Marcus (shelter staff)', 'Background check needed': 'No'},
]

sample = {
    'records': {'volunteers': vol_records, 'programs': PROGS},
    'links': [{'from': f'volunteers#{i}', 'to': f'programs#{p}', 'link': 'Serves in'} for i, v in enumerate(VOLS) for p in v[10]],
    'activities': [
        {'record': 'volunteers#0', 'type': 'shift', 'daysAgo': 2, 'text': 'Saturday sort. Trained two new people on the scale.'},
        {'record': 'volunteers#0', 'type': 'thank_you', 'daysAgo': 30, 'text': 'Card and pin for passing 500 hours.'},
        {'record': 'volunteers#1', 'type': 'shift', 'daysAgo': 5, 'text': 'Covered the loading dock.'},
        {'record': 'volunteers#3', 'type': 'call', 'daysAgo': 3, 'text': 'Left a message. Haven’t seen him since the summer.'},
        {'record': 'volunteers#5', 'type': 'call', 'daysAgo': 10, 'text': 'Busy with a new job; back in a few weeks.'},
        {'record': 'volunteers#6', 'type': 'training', 'daysAgo': 20, 'text': 'Yearly refresher: privacy and fire safety.'},
        {'record': 'volunteers#6', 'type': 'shift', 'daysAgo': 1, 'text': 'Front desk, morning. Very busy.'},
        {'record': 'volunteers#8', 'type': 'note', 'daysAgo': 10, 'text': 'Signed up at the community fair. Wants weekday mornings.'},
        {'record': 'volunteers#9', 'type': 'shift', 'daysAgo': 58, 'text': 'Saturday sort.'},
    ],
    'appointments': [
        {'record': 'volunteers#0', 'title': 'Saturday sort', 'dayOffset': 2, 'time': '09:00', 'minutes': 180, 'type': 'shift', 'location': '50 Mill Street', 'repeatWeekly': 8},
        {'record': 'volunteers#6', 'title': 'Front desk', 'dayOffset': 1, 'time': '08:00', 'minutes': 240, 'type': 'shift', 'location': 'Main lobby', 'repeatWeekly': 8},
        {'record': 'volunteers#1', 'title': 'Saturday sort', 'dayOffset': 2, 'time': '09:00', 'minutes': 180, 'type': 'shift', 'location': '50 Mill Street', 'repeatWeekly': 6},
        {'record': 'volunteers#2', 'title': 'Orientation', 'dayOffset': 4, 'time': '18:00', 'minutes': 90, 'type': 'training', 'location': 'Volunteer office'},
        {'record': 'volunteers#4', 'title': 'Orientation', 'dayOffset': 4, 'time': '18:00', 'minutes': 90, 'type': 'training', 'location': 'Volunteer office'},
        {'record': 'volunteers#0', 'title': 'Saturday sort', 'dayOffset': -5, 'time': '09:00', 'minutes': 180, 'type': 'shift', 'location': '50 Mill Street'},
    ],
}

starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'volunteer-manager', 'name': 'Volunteer manager',
    'description': 'For any nonprofit that runs on volunteers: orientation within 30 days of signing up, background checks for the roles that need them, yearly training, a nudge when someone hasn’t been in for 60 days, hours given and thank-yous.',
    'icon': 'hand-helping', 'group': 'Faith and community',
    'vocab': {'record': {'one': 'record', 'many': 'records', 'article': 'a'}, 'list': {'one': 'list', 'many': 'lists', 'article': 'a'}, 'activity': {'one': 'note', 'many': 'notes', 'article': 'a'}},
    'suggestedFeatures': {'personFields': False, 'priority': False, 'contactsDirectory': False, 'requirements': False, 'timeTracking': False, 'mileage': False,
                          'snippets': True, 'checklists': True, 'tasks': True, 'focusMode': False, 'letters': True, 'summaryReport': True, 'handoff': False,
                          'links': True, 'stages': False, 'measures': True, 'appointments': True, 'forms': True, 'attachments': True},
    'activityTypes': [
        {'key': 'note', 'label': 'Note', 'icon': '📝', 'color': 'slate'},
        {'key': 'shift', 'label': 'Shift', 'icon': '🙋', 'color': 'green'},
        {'key': 'training', 'label': 'Training', 'icon': '🎓', 'color': 'purple'},
        {'key': 'thank_you', 'label': 'Thank-you', 'icon': '💐', 'color': 'amber'},
        {'key': 'call', 'label': 'Call', 'icon': '📞', 'color': 'blue'},
    ],
    'measures': [{'key': 'hours_given', 'label': 'Hours given', 'kind': 'hours', 'decimals': 1}],
    'documentTemplates': [
        {'name': 'Welcome letter', 'content': '{{today}}\n\nDear {{name}},\n\nWelcome, and thank you for signing up to volunteer with us!\n\nYour next step is orientation, where you will meet the team, take a tour and get your badge. Please come to one within the next few weeks.\n\nIf you have any questions, just call or reply to this letter.\n\nWith thanks,\n\n{{my_name}}'},
        {'name': 'Thank-you letter', 'content': '{{today}}\n\nDear {{name}},\n\nWe wanted to stop and say thank you. You have now given {{field:Total hours}} hours to our community.\n\nThat time made a real difference to the people we serve, and to everyone who works beside you.\n\nWith gratitude,\n\n{{my_name}}'},
    ],
    'helpTips': [
        {'title': 'Hours', 'body': 'Log each shift as a Shift note and fill in Hours given. Reports can total hours by volunteer or by month. Keep Total hours up to date, then sort or filter by it to see who has passed 100, 250 or 500 hours and send the Thank-you letter.'},
        {'title': 'Background checks', 'body': 'Set Needs background check to Yes for volunteers whose roles involve children, vulnerable adults, money or keys. Only they get the every-2-years reminder.'},
        {'title': 'Keeping in touch', 'body': 'Fill in Last shift when someone comes in. If an active volunteer has not been in for 60 days, Checked in comes due: give them a call. Volunteers on a break are left alone.'},
        {'title': 'Paperwork', 'body': 'Drop signed waivers and background check results into Files on the volunteer’s page. They are stored encrypted inside Pulse.'},
    ],
    'lists': [volunteers, programs],
    'dashboardCards': ['summary', 'today', 'missingInfo', 'recentActivity'],
    'sampleData': sample,
}

json.dump(starter, open(sys.argv[1], 'w'), indent=2, ensure_ascii=False)
open(sys.argv[1], 'a').write('\n')
print('written')
