"""Generates src/shared/starters/job-search.json (thresholds and configs are JSON strings)."""
import os
import json, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'shared', 'starters', 'job-search.json')

def th(*steps):
    labels = {'coming': 'Coming up', 'soon': 'Due soon', 'urgent': 'Urgent'}
    colors = {'coming': '#bbf7d0', 'soon': '#facc15', 'urgent': '#fb923c'}
    out = [{'daysBefore': d, 'bgClass': colors[k], 'label': labels[k]} for k, d in steps]
    out += [{'daysBefore': 0, 'bgClass': '#dc2626', 'label': 'Due today'}, {'daysBefore': -1, 'bgClass': 'alert-pulse-dark', 'label': 'Overdue'}]
    return json.dumps(out)

T2 = th(('soon', 2), ('urgent', 1))
T7 = th(('soon', 7), ('urgent', 3))
T30 = th(('coming', 30), ('soon', 14), ('urgent', 7))

def col(name, ctype, pos, width, **kw):
    c = {'name': name, 'column_type': ctype, 'position': pos, 'width': width}
    c.update(kw)
    return c

def date_col(name, pos, rule, description=None):
    c = col(name, 'date', pos, 160, config=json.dumps({'alert_rule_name': rule, 'log_changes': True}))
    if description: c['description'] = description
    return c

def when_stage(*values):
    return json.dumps({'columnId': {'column': 'Stage'}, 'op': 'is', 'values': list(values), 'whenFalse': 'hide'})

def d(n): return {'daysFromToday': n}

STAGES = [('Interested', 'slate', '#64748b'), ('Applied', 'blue', '#3b82f6'), ('Interviewing', 'purple', '#8b5cf6'),
          ('Offer', 'amber', '#f59e0b'), ('Accepted', 'green', '#22c55e'), ('Not this time', 'red', '#ef4444')]

applications = {
    'key': 'applications', 'name': 'Applications', 'description': 'Every job you are looking at, from interested to an answer', 'kind': 'job',
    'vocab': {'record': {'one': 'application', 'many': 'applications', 'article': 'an'}},
    'columns': [
        col('Job', 'text', 0, 220, is_name_column=1, is_identifier=1, is_required=1, description='The job title'),
        col('Stage', 'status', 1, 150, config=json.dumps({'options': [{'label': s, 'color': h} for s, _, h in STAGES]})),
        col('Found on', 'dropdown', 2, 140, config=json.dumps({'options': ['Job board', 'Company website', 'Referral', 'Recruiter', 'Networking', 'Job fair']})),
        col('Pay', 'text', 3, 130, description='What the posting says, e.g. $22/hour or $52–58k'),
        col('Posting link', 'url', 4, 180),
        date_col('Apply by', 5, 'Apply by', 'Closing date on the posting'),
        col('Applied on', 'date', 6, 140, description='Filled in when the application moves to Applied'),
        date_col('Follow-up sent', 7, 'Follow-up', 'Date you checked in about your application'),
        col('Last interview', 'date', 8, 150, description='Date of your most recent interview for this job'),
        date_col('Thank-you sent', 9, 'Thank-you note', 'Date you sent a thank-you after the interview'),
        date_col('Respond to offer by', 10, 'Respond by', 'When they need your answer'),
        col('Closed on', 'date', 11, 140, description='Filled in when the application moves to Accepted or Not this time'),
    ],
    'alertRules': [
        {'name': 'Apply by', 'description': 'The closing date for applications, until you apply', 'interval_days': 0, 'thresholds': T7,
         'rule_condition': when_stage('Interested')},
        {'name': 'Follow-up', 'description': 'Check in 7 days after applying, while you are still waiting to hear', 'interval_days': 0, 'thresholds': T2,
         'kind': 'relative', 'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Applied on'}, 'offset': {'days': 7, 'direction': 'after'}}),
         'rule_condition': when_stage('Applied')},
        {'name': 'Thank-you note', 'description': 'Send a thank-you the day after an interview', 'interval_days': 0, 'thresholds': T2,
         'kind': 'relative', 'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Last interview'}, 'offset': {'days': 1, 'direction': 'after'}}),
         'rule_condition': when_stage('Interviewing')},
        {'name': 'Respond by', 'description': 'The date they need your answer on an offer', 'interval_days': 0, 'thresholds': T2,
         'rule_condition': when_stage('Offer')},
    ],
    'checklists': [
        {'name': 'Before the interview', 'description': 'The day before', 'items': json.dumps([
            'Read the job posting again', 'Look up the company and the people you will meet', 'Practice telling your story in two minutes',
            'Write down three questions to ask them', 'Print copies of your resume', 'Plan the route or test the video link',
            'Lay out what you will wear'])},
    ],
    'links': [{'to': 'companies', 'label_forward': 'Company', 'label_backward': 'Applications', 'cardinality': 'many_to_one'}],
    'stage': {'column': 'Stage', 'options': [
        {'value': s, 'color': c, **({'done': True} if s in ('Accepted', 'Not this time') else {}),
         **({'onEnter': {'stampColumn': 'Applied on', 'activityType': 'note'}} if s == 'Applied' else
            {'onEnter': {'checklist': 'Before the interview'}} if s == 'Interviewing' else
            {'onEnter': {'stampColumn': 'Closed on'}} if s in ('Accepted', 'Not this time') else {})}
        for s, c, _ in STAGES], 'hideDoneAfterDays': 30},
}

companies = {
    'key': 'companies', 'name': 'Companies', 'description': 'Places you have applied or want to work', 'kind': 'thing',
    'vocab': {'record': {'one': 'company', 'many': 'companies', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 200, is_name_column=1, is_identifier=1, is_required=1),
        col('Website', 'url', 1, 190),
        col('Contact person', 'text', 2, 170, description='Recruiter or hiring manager'),
        col('Contact email', 'email', 3, 200),
        col('Contact phone', 'phone', 4, 140),
        col('Address', 'address', 5, 180),
        col('Notes', 'notes', 6, 240, description='What they do, who you know there, what you liked'),
    ],
}

people = {
    'key': 'people', 'name': 'Contacts', 'description': 'References and people in your network', 'kind': 'person',
    'vocab': {'record': {'one': 'contact', 'many': 'contacts', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 180, is_name_column=1, is_identifier=1, is_required=1),
        col('Phone', 'phone', 1, 140),
        col('Email', 'email', 2, 200),
        col('Works at', 'text', 3, 170),
        col('How you know them', 'dropdown', 4, 170, config=json.dumps({'options': ['Former manager', 'Coworker', 'Teacher', 'Friend', 'Met networking']})),
        col('Reference', 'checkbox', 5, 110, description='They agreed to be a reference'),
        date_col('Last in touch', 6, 'Every 3 months', 'Pulse reminds you to check in every few months'),
        col('Notes', 'notes', 7, 220),
    ],
    'alertRules': [
        {'name': 'Every 3 months', 'description': 'Due 3 months after the date entered', 'interval_months': 3, 'thresholds': T30},
    ],
}

COMPANIES = [
    ('Maple Street Dental', 'https://maplestreetdental.example.com', 'Rita Gomez', 'rita.gomez@example.com', '555-0181', '42 Maple Street\nSpringfield', 'Small office, close to home.'),
    ('Northwind Logistics', 'https://northwind.example.com', 'Ben Carter', 'ben.carter@example.com', '555-0184', '900 Harbor Road\nSpringfield', 'Warehouse and office jobs. Hiring all year.'),
    ('Springfield Library', 'https://library.example.com', 'Ms. Patel', 'hr@library.example.com', '555-0187', '10 Commons Square\nSpringfield', None),
    ('Bright Path Learning', 'https://brightpath.example.com', None, 'jobs@brightpath.example.com', None, None, 'Tutoring center; Jamie works here.'),
    ('Cedar Valley Hospital', 'https://cedarvalley.example.com', 'Tom Nguyen', 'tom.nguyen@example.com', '555-0193', '1 Cedar Valley Way\nSpringfield', 'Big employer. Online application only.'),
    ('Riverside Coffee Co.', 'https://riversidecoffee.example.com', 'Ana Lima', 'ana.lima@example.com', '555-0196', '77 River Street\nSpringfield', None),
]
company_records = []
for name, web, person, email, phone, addr, notes in COMPANIES:
    r = {'Name': name, 'Website': web, 'Contact email': email}
    if person: r['Contact person'] = person
    if phone: r['Contact phone'] = phone
    if addr: r['Address'] = addr
    if notes: r['Notes'] = notes
    company_records.append(r)

APPS = [
    # job, stage, found on, company, extras
    ('Front desk coordinator', 'Interviewing', 'Job board', 0, {'Pay': '$21/hour', 'Applied on': d(-16), 'Last interview': d(-1)}),
    ('Office manager', 'Applied', 'Recruiter', 1, {'Pay': '$52–58k', 'Applied on': d(-9)}),
    ('Library assistant', 'Applied', 'Company website', 2, {'Pay': '$19/hour', 'Applied on': d(-5)}),
    ('Program coordinator', 'Interested', 'Referral', 3, {'Pay': '$48k', 'Apply by': d(3)}),
    ('Patient access representative', 'Interested', 'Job board', 4, {'Pay': '$20–23/hour', 'Apply by': d(12)}),
    ('Scheduling coordinator', 'Offer', 'Networking', 4, {'Pay': '$50k', 'Applied on': d(-30), 'Last interview': d(-10), 'Thank-you sent': d(-9), 'Respond to offer by': d(2)}),
    ('Shift supervisor', 'Not this time', 'Job fair', 5, {'Pay': '$18/hour', 'Applied on': d(-40), 'Closed on': d(-12)}),
    ('Administrative assistant', 'Interviewing', 'Recruiter', 1, {'Pay': '$45k', 'Applied on': d(-20), 'Last interview': d(-8), 'Thank-you sent': d(-7)}),
]
app_records = []
for job, stage, found, _, extra in APPS:
    r = {'Job': job, 'Stage': stage, 'Found on': found, 'Posting link': f'https://jobs.example.com/{job.lower().replace(" ", "-")}', **extra}
    app_records.append(r)

PEOPLE = [
    ('Jamie Brooks', 'Friend', 'Bright Path Learning', False, -20, 'Said they would pass my resume to the director.'),
    ('Linda Ortiz', 'Former manager', 'Northwind Logistics', True, -100, 'Happy to be a reference. Prefers a heads-up text first.'),
    ('Marcus Hale', 'Coworker', None, True, -60, None),
    ('Grace Kim', 'Teacher', 'Springfield Community College', True, -95, 'Wrote my letter for the certificate program.'),
    ('Owen Price', 'Met networking', 'Cedar Valley Hospital', False, -10, 'Met at the career fair; works in scheduling.'),
]
people_records = []
for i, (n, how, work, ref, last, notes) in enumerate(PEOPLE):
    r = {'Name': n, 'Phone': f'555-01{50 + i * 3}', 'Email': n.lower().replace(' ', '.') + '@example.com', 'How you know them': how,
         'Last in touch': d(last)}
    if ref: r['Reference'] = 'true'
    if work: r['Works at'] = work
    if notes: r['Notes'] = notes
    people_records.append(r)

sample = {
    'records': {'applications': app_records, 'companies': company_records, 'people': people_records},
    'links': [{'from': f'applications#{i}', 'to': f'companies#{c}', 'link': 'Company'} for i, (_, _, _, c, _) in enumerate(APPS)],
    'activities': [
        {'record': 'applications#0', 'type': 'interview', 'daysAgo': 1, 'text': 'Met the office manager and one of the dentists. Asked about weekend hours. Second interview likely.'},
        {'record': 'applications#1', 'type': 'call', 'daysAgo': 9, 'text': 'Recruiter called; sent my resume over the same day.'},
        {'record': 'applications#5', 'type': 'call', 'daysAgo': 3, 'text': 'Offer call: $50k, starts in two weeks. Asked for a couple of days to think it over.'},
        {'record': 'applications#7', 'type': 'interview', 'daysAgo': 8, 'text': 'Phone screen went well. Waiting to hear about the panel interview.'},
        {'record': 'people#1', 'type': 'call', 'daysAgo': 100, 'text': 'Asked Linda to be a reference; she said yes.'},
    ],
    'history': [
        {'record': 'applications#0', 'column': 'Stage', 'values': [{'value': 'Interested', 'daysAgo': 20}, {'value': 'Applied', 'daysAgo': 16}, {'value': 'Interviewing', 'daysAgo': 4}]},
        {'record': 'applications#5', 'column': 'Stage', 'values': [{'value': 'Applied', 'daysAgo': 30}, {'value': 'Interviewing', 'daysAgo': 15}, {'value': 'Offer', 'daysAgo': 3}]},
        {'record': 'applications#7', 'column': 'Stage', 'values': [{'value': 'Applied', 'daysAgo': 20}, {'value': 'Interviewing', 'daysAgo': 9}]},
    ],
    'appointments': [
        {'record': 'applications#0', 'title': 'Interview: front desk coordinator', 'dayOffset': -1, 'time': '10:00', 'minutes': 45, 'type': 'interview', 'location': '42 Maple Street'},
        {'record': 'applications#0', 'title': 'Second interview', 'dayOffset': 4, 'time': '14:00', 'minutes': 60, 'type': 'interview', 'location': '42 Maple Street'},
        {'record': 'applications#7', 'title': 'Panel interview (video)', 'dayOffset': 2, 'time': '11:00', 'minutes': 60, 'type': 'interview', 'location': 'Video call'},
        {'record': 'applications#7', 'title': 'Phone screen', 'dayOffset': -8, 'time': '09:30', 'minutes': 30, 'type': 'interview'},
        {'record': 'applications#3', 'title': 'Coffee with Jamie about the opening', 'dayOffset': 1, 'time': '08:30', 'minutes': 30, 'type': 'note', 'location': 'Riverside Coffee Co.'},
    ],
}

starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'job-search', 'name': 'Job search',
    'description': 'For anyone looking for work: applications on a board from interested to an answer, follow-ups a week after applying, thank-you notes after interviews, offer deadlines, and the people who can help.',
    'icon': 'briefcase', 'group': 'Personal',
    'vocab': {'record': {'one': 'record', 'many': 'records', 'article': 'a'}, 'list': {'one': 'list', 'many': 'lists', 'article': 'a'}, 'activity': {'one': 'note', 'many': 'notes', 'article': 'a'}},
    'suggestedFeatures': {'personFields': False, 'priority': False, 'contactsDirectory': False, 'requirements': False, 'timeTracking': False, 'mileage': False,
                          'snippets': True, 'checklists': True, 'tasks': True, 'focusMode': False, 'letters': True, 'summaryReport': False, 'handoff': False,
                          'links': True, 'stages': True, 'measures': False, 'appointments': True, 'forms': False, 'attachments': True},
    'activityTypes': [
        {'key': 'note', 'label': 'Note', 'icon': '📝', 'color': 'slate'},
        {'key': 'call', 'label': 'Call', 'icon': '📞', 'color': 'blue'},
        {'key': 'email', 'label': 'Email', 'icon': '✉️', 'color': 'teal'},
        {'key': 'interview', 'label': 'Interview', 'icon': '🤝', 'color': 'purple'},
    ],
    'documentTemplates': [
        {'name': 'Follow-up on my application', 'content': 'Hello,\n\nI applied for the {{name}} position on {{field:Applied on}} and wanted to follow up. I am still very interested in the role and would be glad to share anything else that would help.\n\nThank you for your time,\n\n{{my_name}}'},
        {'name': 'Thank-you after an interview', 'content': 'Hello,\n\nThank you for taking the time to talk with me about the {{name}} position. I enjoyed learning more about the team at {{linked:Company.Name}}, and I am excited about the chance to work with you.\n\nPlease let me know if there is anything else I can send.\n\nBest regards,\n\n{{my_name}}'},
    ],
    'helpTips': [
        {'title': 'The board', 'body': 'Drag an application across the board as it moves. Moving it to Applied fills in the date, and a follow-up comes due a week later if you have not heard back. Moving it to Interviewing adds the Before the interview checklist.'},
        {'title': 'Thank-you notes', 'body': 'After an interview, put the date in Last interview. A thank-you note comes due the next day. The Thank-you after an interview letter fills in the job and company for you.'},
        {'title': 'Interviews on the calendar', 'body': 'Add each interview as an appointment on the application, so the dashboard shows what is coming up today and this week.'},
        {'title': 'Your resume and cover letters', 'body': 'Drop the resume and cover letter you sent into Files on the application, so you always know which version they have.'},
    ],
    'lists': [applications, companies, people],
    'dashboardCards': ['summary', 'today', 'stages', 'missingInfo'],
    'sampleData': sample,
}

json.dump(starter, open(OUT, 'w'), indent=2, ensure_ascii=False)
open(OUT, 'a').write('\n')
print('written', OUT)
