"""Generates src/shared/starters/driving-school.json (thresholds and configs are JSON strings)."""
import os
import json, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'shared', 'starters', 'driving-school.json')

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

# Hide a student's deadlines once they've passed or stopped coming
ACTIVE_ONLY = json.dumps({'columnId': {'column': 'Status'}, 'op': 'is_not', 'values': ['Passed', 'Withdrawn'], 'whenFalse': 'hide'})

STAGES = [('Enrolled', 'slate', '#64748b'), ('Learning', 'blue', '#3b82f6'), ('Ready for road test', 'amber', '#f59e0b'),
          ('Passed', 'green', '#22c55e'), ('Withdrawn', 'red', '#ef4444')]

students = {
    'key': 'students', 'name': 'Students', 'description': 'Learners from enrollment to their road test', 'kind': 'person',
    'vocab': {'record': {'one': 'student', 'many': 'students', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 180, is_name_column=1, is_identifier=1, is_required=1),
        col('Status', 'status', 1, 170, config=json.dumps({'options': [{'label': s, 'color': h} for s, _, h in STAGES]})),
        col('Parent / guardian', 'text', 2, 170, is_required=1),
        col('Parent phone', 'phone', 3, 140, is_required=1),
        col('Permit issued', 'date', 4, 150, is_required=1, description="Date on the learner's permit; the road test date is worked out from it"),
        date_col('Permit expires', 5, 'Expires', "When the learner's permit runs out"),
        date_col('Road test booked', 6, 'Road test eligible', 'Date you booked the road test. Due once the permit is 6 months old'),
        date_col('Road test date', 7, 'Test day', 'The day of the road test'),
        col('Passed on', 'date', 8, 140, description='Filled in when the student moves to Passed'),
        col('Practice hours', 'number', 9, 130, description='Supervised driving hours so far, from the practice log (most states ask for 50)'),
        col('Night hours', 'number', 10, 120, description='Of those, hours driven after dark (most states ask for 10)'),
        col('Enrolled on', 'date', 11, 140, description='Lessons are counted from this date until the permit expires'),
        col('Lessons paid for', 'number', 12, 140),
        col('Lessons left', 'deadline', 13, 140, config=json.dumps({'alert_rule_name': 'Lessons left'})),
    ],
    'alertRules': [
        {'name': 'Road test eligible', 'description': 'Book the road test once the permit is 6 months old', 'interval_days': 0, 'thresholds': T30,
         'kind': 'relative', 'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Permit issued'}, 'offset': {'months': 6, 'direction': 'after'}}),
         'rule_condition': ACTIVE_ONLY},
        {'name': 'Test day', 'description': 'The date entered is the day of the road test, until the student passes', 'interval_days': 0, 'thresholds': T7,
         'rule_condition': ACTIVE_ONLY},
        {'name': 'Expires', 'description': 'The date entered is when it runs out', 'interval_days': 0, 'thresholds': T60,
         'rule_condition': ACTIVE_ONLY},
        {'name': 'Lessons left', 'description': 'Counts lessons between the enrollment date and the permit expiry', 'interval_days': 0, 'thresholds': T30,
         'kind': 'quota', 'rule_config': json.dumps({'kind': 'quota', 'activityTypes': ['lesson'], 'limitColumnId': {'column': 'Lessons paid for'},
                                                      'startColumnId': {'column': 'Enrolled on'}, 'endColumnId': {'column': 'Permit expires'},
                                                      'warnRemaining': 1, 'warnDaysBeforeEnd': 30}),
         'rule_condition': ACTIVE_ONLY},
    ],
    'requirements': [{'label': 'Parent update', 'note_types': ['parent_update'], 'per_month': 1, 'period': 'month'}],
    'checklists': [
        {'name': 'Road test day', 'description': 'What to bring and check before the test', 'items': json.dumps([
            "Learner's permit and photo ID", 'Signed practice log (day and night hours)', 'Car registration and insurance card',
            'Car passes the safety check: lights, signals, horn, mirrors', 'Arrive 20 minutes early', 'Parent or guardian present if under 18'])},
    ],
    'links': [{'to': 'instructors', 'label_forward': 'Instructor', 'label_backward': 'Students', 'cardinality': 'many_to_one'}],
    'stage': {'column': 'Status', 'options': [
        {'value': s, 'color': c, **({'done': True} if s in ('Passed', 'Withdrawn') else {}),
         **({'onEnter': {'checklist': 'Road test day'}} if s == 'Ready for road test' else
            {'onEnter': {'stampColumn': 'Passed on', 'activityType': 'road_test'}} if s == 'Passed' else {})}
        for s, c, _ in STAGES], 'hideDoneAfterDays': 60},
    'forms': [{
        'name': 'Enrollment', 'intro': 'Fill this in with a new student and their parent or guardian, or print a blank for the front desk.', 'log_activity_type': 'parent_update',
        'fields': [
            {'kind': 'section', 'title': 'Student'},
            {'kind': 'column', 'column': 'Name', 'required': True},
            {'kind': 'column', 'column': 'Permit issued', 'width': 'half'},
            {'kind': 'column', 'column': 'Permit expires', 'width': 'half'},
            {'kind': 'section', 'title': 'Parent or guardian'},
            {'kind': 'column', 'column': 'Parent / guardian', 'width': 'half', 'required': True},
            {'kind': 'column', 'column': 'Parent phone', 'width': 'half', 'required': True},
            {'kind': 'section', 'title': 'Lessons'},
            {'kind': 'column', 'column': 'Lessons paid for', 'width': 'half'},
            {'kind': 'note', 'label': 'Anything we should know? (nerves, glasses, best days for lessons)'},
        ]}],
}

instructors = {
    'key': 'instructors', 'name': 'Instructors', 'description': 'Instructors and their training cars, with licenses and checks due', 'kind': 'person',
    'vocab': {'record': {'one': 'instructor', 'many': 'instructors', 'article': 'an'}},
    'columns': [
        col('Name', 'text', 0, 180, is_name_column=1, is_identifier=1, is_required=1),
        col('Phone', 'phone', 1, 140),
        col('Email', 'email', 2, 200),
        date_col('Instructor license expires', 3, 'Expires (60 days ahead)'),
        date_col('Background check', 4, 'Every 2 years', 'Date of the last background check'),
        col('Training car', 'text', 5, 200, description='Make, model and plate of the dual-brake car'),
        date_col('Car insurance renews', 6, 'Expires (60 days ahead)'),
        date_col('Car safety inspection', 7, 'Every year', 'Date of the last inspection of the training car'),
    ],
    'alertRules': [
        {'name': 'Expires (60 days ahead)', 'description': 'The date entered is when it runs out; warns 60 days ahead', 'interval_days': 0, 'thresholds': T60},
        {'name': 'Every 2 years', 'description': 'Due on the same date two years later', 'interval_months': 24, 'thresholds': T60},
        {'name': 'Every year', 'description': 'Due on the same date a year later', 'interval_months': 12, 'thresholds': T60},
    ],
}

# name, status, parent, permit issued, permit expires, booked, test date, passed, practice, night, enrolled, paid, lessons done, instructor
STUDENTS = [
    ('Maya Chen', 'Learning', 'Linda Chen', -150, 580, None, None, None, 31.5, 6, -140, 6, 4, 0),
    ('Jordan Ellis', 'Ready for road test', 'Mark Ellis', -200, 530, -10, 4, None, 52, 11, -190, 6, 6, 0),
    ('Ava Patel', 'Learning', 'Rina Patel', -175, 555, None, None, None, 44, 8, -160, 10, 7, 1),
    ('Leo Martinez', 'Enrolled', 'Sofia Martinez', -20, 710, None, None, None, 2, 0, -14, 6, 1, 1),
    ('Grace Kim', 'Learning', 'Daniel Kim', -190, 540, None, None, None, 50, 10, -185, 8, 6, 2),
    ('Noah Brooks', 'Ready for road test', 'Tanya Brooks', -230, 500, -20, -2, None, 55, 12, -220, 6, 5, 2),
    ('Emma Walsh', 'Passed', 'Kevin Walsh', -260, 470, -60, -30, -30, 58, 12, -250, 6, 6, 0),
    ('Ethan Ross', 'Learning', 'Paula Ross', -320, 45, None, None, None, 20, 2, -300, 6, 3, 1),
]
student_records, lesson_acts, history, links = [], [], [], []
for i, (name, status, parent, issued, expires, booked, test, passed, prac, night, enrolled, paid, done, instr) in enumerate(STUDENTS):
    r = {'Name': name, 'Status': status, 'Parent / guardian': parent, 'Parent phone': f'555-01{10 + i * 4:02d}',
         'Permit issued': d(issued), 'Permit expires': d(expires), 'Practice hours': prac, 'Night hours': night,
         'Enrolled on': d(enrolled), 'Lessons paid for': paid}
    if booked is not None: r['Road test booked'] = d(booked)
    if test is not None: r['Road test date'] = d(test)
    if passed is not None: r['Passed on'] = d(passed)
    student_records.append(r)
    links.append({'from': f'students#{i}', 'to': f'instructors#{instr}', 'link': 'Instructor'})
    # Lessons a week or two apart, the last one a few days ago (or before passing)
    last = (-passed if passed is not None else 3) + i % 3
    for k in range(done):
        ago = last + k * 10
        if ago < -enrolled:
            lesson_acts.append({'record': f'students#{i}', 'type': 'lesson', 'daysAgo': ago,
                                'text': ['Parking lot: starting, stopping, turns.', 'Neighborhood streets and stop signs.', 'Lane changes on a 45 mph road.',
                                         'Parallel parking and three-point turns.', 'Highway merging.', 'Night drive downtown.', 'Mock road test.'][k % 7]})
    # Practice hours over time, so the number chart shows progress
    if prac >= 20:
        steps = 5
        history.append({'record': f'students#{i}', 'column': 'Practice hours',
                        'values': [{'value': str(round(prac * (s + 1) / steps, 1)), 'daysAgo': max(1, int(-enrolled * (steps - 1 - s) / steps))} for s in range(steps)]})

INSTRUCTORS = [
    ('Dana Whitfield', {'Instructor license expires': d(25), 'Background check': d(-650), 'Training car': '2021 Toyota Corolla, plate DRV-101',
                        'Car insurance renews': d(120), 'Car safety inspection': d(-340)}),
    ('Marcus Greene', {'Instructor license expires': d(400), 'Background check': d(-760), 'Training car': '2020 Honda Civic, plate DRV-102',
                       'Car insurance renews': d(10), 'Car safety inspection': d(-100)}),
    ('Rosa Alvarez', {'Instructor license expires': d(200), 'Background check': d(-200), 'Training car': '2022 Hyundai Elantra, plate DRV-103',
                      'Car insurance renews': d(-3), 'Car safety inspection': d(-370)}),
]
instructor_records = [{'Name': n, 'Phone': f'555-01{60 + i * 3}', 'Email': n.lower().replace(' ', '.') + '@example.com', **extra} for i, (n, extra) in enumerate(INSTRUCTORS)]


# Status history, so "days in this status" has something to go on
for i, (name, status, parent, issued, expires, booked, test, passed, prac, night, enrolled, paid, done, instr) in enumerate(STUDENTS):
    steps = [('Enrolled', -enrolled)]
    if status != 'Enrolled': steps.append(('Learning', -enrolled - 10))
    if status in ('Ready for road test', 'Passed'): steps.append(('Ready for road test', max(1, -(booked if booked is not None else -15))))
    if status == 'Passed': steps.append(('Passed', -passed))
    history.append({'record': f'students#{i}', 'column': 'Status', 'values': [{'value': v, 'daysAgo': d} for v, d in steps]})

sample = {
    'records': {'students': student_records, 'instructors': instructor_records},
    'links': links,
    'activities': lesson_acts + [
        {'record': 'students#0', 'type': 'parent_update', 'daysAgo': 12, 'text': 'Told Linda that Maya is doing well with turns; needs more highway time.'},
        {'record': 'students#1', 'type': 'parent_update', 'daysAgo': 10, 'text': 'Road test booked. Sent the checklist home.'},
        {'record': 'students#4', 'type': 'parent_update', 'daysAgo': 40, 'text': 'Grace has her 50 hours. Ready to book the road test.'},
        {'record': 'students#7', 'type': 'note', 'daysAgo': 20, 'text': 'Missed two lessons. Permit runs out soon; called Paula about catching up.'},
        {'record': 'students#6', 'type': 'road_test', 'daysAgo': 30, 'text': 'Passed on the first try.'},
    ],
    'history': history,
    'appointments': [
        {'record': 'students#0', 'title': 'Lesson: Maya Chen', 'dayOffset': 1, 'time': '16:00', 'minutes': 60, 'type': 'lesson', 'repeatWeekly': 6},
        {'record': 'students#2', 'title': 'Lesson: Ava Patel', 'dayOffset': 2, 'time': '15:30', 'minutes': 60, 'type': 'lesson', 'repeatWeekly': 6},
        {'record': 'students#3', 'title': 'Lesson: Leo Martinez', 'dayOffset': 3, 'time': '17:00', 'minutes': 60, 'type': 'lesson', 'repeatWeekly': 8},
        {'record': 'students#7', 'title': 'Lesson: Ethan Ross', 'dayOffset': 0, 'time': '18:00', 'minutes': 90, 'type': 'lesson', 'repeatWeekly': 4},
        {'record': 'students#1', 'title': 'Road test: Jordan Ellis', 'dayOffset': 4, 'time': '09:00', 'minutes': 60, 'type': 'road_test', 'location': 'Springfield DMV'},
        {'record': 'students#5', 'title': 'Road test: Noah Brooks', 'dayOffset': -2, 'time': '10:30', 'minutes': 60, 'type': 'road_test', 'location': 'Springfield DMV'},
    ],
}

starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'driving-school', 'name': 'Driving school',
    'description': "For driving schools and instructors: students from learner's permit to road test, practice and night hours, lessons left on a package, monthly parent updates, and instructor licenses, background checks and training cars. Hour and permit rules vary by state, so check yours. Pulse is a tracking aid, not your official record system.",
    'icon': 'car-front', 'group': 'Education and youth',
    'vocab': {'record': {'one': 'record', 'many': 'records', 'article': 'a'}, 'list': {'one': 'list', 'many': 'lists', 'article': 'a'}, 'activity': {'one': 'note', 'many': 'notes', 'article': 'a'}},
    'suggestedFeatures': {'personFields': False, 'priority': False, 'contactsDirectory': False, 'requirements': True, 'timeTracking': False, 'mileage': False,
                          'snippets': True, 'checklists': True, 'tasks': True, 'focusMode': False, 'letters': True, 'summaryReport': True, 'handoff': False,
                          'links': True, 'stages': True, 'measures': True, 'appointments': True, 'forms': True, 'attachments': True},
    'activityTypes': [
        {'key': 'note', 'label': 'Note', 'icon': '📝', 'color': 'slate'},
        {'key': 'lesson', 'label': 'Lesson', 'icon': '🚗', 'color': 'blue'},
        {'key': 'road_test', 'label': 'Road test', 'icon': '🏁', 'color': 'green'},
        {'key': 'parent_update', 'label': 'Parent update', 'icon': '👪', 'color': 'teal'},
    ],
    'measures': [
        {'key': 'driving_hours', 'label': 'Driving hours', 'kind': 'hours', 'decimals': 1},
        {'key': 'night_hours', 'label': 'Night hours', 'kind': 'hours', 'decimals': 1},
    ],
    'documentTemplates': [
        {'name': 'Road test reminder', 'content': "{{today}}\n\nDear {{field:Parent / guardian}},\n\n{{name}}'s road test is on {{field:Road test date}}.\n\nPlease bring:\n- the learner's permit and photo ID\n- the signed practice log ({{field:Practice hours}} hours so far, {{field:Night hours}} at night)\n- the car's registration and insurance card, if {{name}} is testing in your car\n\nPlease arrive 20 minutes early. Good luck!\n\n{{my_name}}"},
    ],
    'helpTips': [
        {'title': 'Road test timing', 'body': "Enter the date on the learner's permit. Pulse shows when the student can book the road test (6 months later) and turns it due until you fill in Road test booked. Many states use 6 months; change the rule in the column menu if yours is different."},
        {'title': 'Practice hours', 'body': 'Update Practice hours and Night hours from the signed log; the number chart on the student\'s page shows their progress. You can also log hours on each lesson note (Driving hours, Night hours) and see totals in reports.'},
        {'title': 'Lesson packages', 'body': 'Lessons left counts Lesson notes between the enrollment date and the permit expiry, out of Lessons paid for. It warns when one lesson is left.'},
        {'title': 'Parent updates', 'body': 'Log a Parent update note once a month. The dashboard shows which families are still owed one this month.'},
    ],
    'lists': [students, instructors],
    'dashboardCards': ['summary', 'today', 'stages', 'quotas', 'requirements', 'missingInfo'],
    'sampleData': sample,
}

json.dump(starter, open(OUT, 'w'), indent=2, ensure_ascii=False)
open(OUT, 'a').write('\n')
print('written', OUT)
