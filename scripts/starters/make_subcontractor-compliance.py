"""Generates src/shared/starters/subcontractor-compliance.json (thresholds and configs are JSON strings)."""
import os
import json, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'shared', 'starters', 'subcontractor-compliance.json')

def th(steps, today='Due today', overdue='Overdue'):
    out = [{'daysBefore': d, 'bgClass': c, 'label': l} for d, c, l in steps]
    out += [{'daysBefore': 0, 'bgClass': '#dc2626', 'label': today}, {'daysBefore': -1, 'bgClass': 'alert-pulse-dark', 'label': overdue}]
    return json.dumps(out)

# Expiring paperwork: warn 30 days ahead
T_EXPIRES = th([(30, '#facc15', 'Renew soon'), (14, '#fb923c', 'Urgent'), (7, '#f87171', 'Expiring')], 'Expires today', 'Expired')
# Job dates: two weeks ahead
T_JOB = th([(14, '#bbf7d0', 'Coming up'), (7, '#facc15', 'Soon'), (3, '#fb923c', 'Urgent')])

def col(name, ctype, pos, width, **kw):
    c = {'name': name, 'column_type': ctype, 'position': pos, 'width': width}
    c.update(kw)
    return c

def date_col(name, pos, rule, description=None, **kw):
    c = col(name, 'date', pos, 170, config=json.dumps({'alert_rule_name': rule, 'log_changes': True}), **kw)
    if description: c['description'] = description
    return c

def d(n): return {'daysFromToday': n}

EXPIRES = 'Expires (30-day warning)'

subs = {
    'key': 'subcontractors', 'name': 'Subcontractors', 'description': 'The trades you hire, with their insurance certificates, licenses and paperwork', 'kind': 'thing',
    'vocab': {'record': {'one': 'subcontractor', 'many': 'subcontractors', 'article': 'a'}},
    'columns': [
        col('Company', 'text', 0, 210, is_name_column=1, is_identifier=1, is_required=1),
        col('Trade', 'dropdown', 1, 140, config=json.dumps({'options': ['Electrical', 'Plumbing', 'HVAC', 'Roofing', 'Concrete', 'Framing', 'Drywall', 'Painting', 'Excavation', 'Flooring', 'Other']})),
        col('Contact person', 'text', 2, 160),
        col('Phone', 'phone', 3, 140, is_required=1),
        col('Email', 'email', 4, 210),
        date_col('General liability expires', 5, EXPIRES, 'From their certificate of insurance (COI)', is_required=1),
        date_col("Workers' comp expires", 6, EXPIRES, 'Leave blank and add a note if they have an exemption certificate'),
        date_col('Auto liability expires', 7, EXPIRES, 'For subs who drive company vehicles to your sites'),
        date_col('Contractor license expires', 8, EXPIRES, 'State or local contractor license'),
        col('W-9 received', 'date', 9, 140, is_required=1, description='Date you got their W-9; empty shows as missing'),
        col('Agreement signed', 'date', 10, 150, is_required=1, description='Date they signed your subcontract agreement; empty shows as missing'),
        col('Status', 'dropdown', 11, 130, config=json.dumps({'options': ['Approved', 'Waiting on paperwork', 'On hold', 'Do not use']})),
        col('Notes', 'notes', 12, 220),
    ],
    'alertRules': [
        {'name': EXPIRES, 'description': 'The date entered is when it runs out; warns 30 days ahead', 'interval_days': 0, 'thresholds': T_EXPIRES},
    ],
    'checklists': [
        {'name': 'New sub onboarding', 'description': 'Before a new subcontractor sets foot on a site', 'items': json.dumps([
            'W-9 received', 'Certificate of insurance received, with your company named as additional insured',
            "Workers' comp certificate, or an exemption certificate", 'Contractor license looked up on the state website',
            'Subcontract agreement signed', 'Safety training cards on file', 'Emergency contact on file'])},
    ],
}

jobs = {
    'key': 'jobs', 'name': 'Jobs', 'description': 'Projects and the subcontractors working on each one', 'kind': 'job',
    'vocab': {'record': {'one': 'job', 'many': 'jobs', 'article': 'a'}},
    'columns': [
        col('Job', 'text', 0, 230, is_name_column=1, is_identifier=1, is_required=1),
        col('Address', 'address', 1, 190),
        col('Property owner', 'text', 2, 170),
        col('Status', 'dropdown', 3, 130, config=json.dumps({'options': ['Bidding', 'Signed', 'Active', 'Done']})),
        date_col('Start date', 4, 'Start date', 'Check every sub on the job has current paperwork before this date'),
        date_col('Finish date', 5, 'Finish date'),
        col('Notes', 'notes', 6, 220),
    ],
    'alertRules': [
        {'name': 'Start date', 'description': 'The date entered is the start of the job; hidden once the job is done', 'interval_days': 0, 'thresholds': T_JOB,
         'rule_condition': json.dumps({'columnId': {'column': 'Status'}, 'op': 'is_not', 'values': ['Active', 'Done'], 'whenFalse': 'hide'})},
        {'name': 'Finish date', 'description': 'The date entered is when the job should be finished; hidden once it is done', 'interval_days': 0, 'thresholds': T_JOB,
         'rule_condition': json.dumps({'columnId': {'column': 'Status'}, 'op': 'is_not', 'values': ['Done'], 'whenFalse': 'hide'})},
    ],
    'links': [{'to': 'subcontractors', 'label_forward': 'Subs on this job', 'label_backward': 'Jobs', 'cardinality': 'many_to_many'}],
}

SUBS = [
    # company, trade, contact, GL, WC, auto, license, w9, agreement, status, notes
    ('Ridgeline Electric LLC', 'Electrical', 'Dana Cole', -6, 140, 95, 310, -400, -390, 'Approved', 'Requested a new COI from their agent.'),
    ('Bluewater Plumbing', 'Plumbing', 'Marcus Lee', 4, 4, None, 220, -300, -298, 'Approved', None),
    ('Summit Roofing Co.', 'Roofing', 'Ana Torres', 22, -15, 60, 180, -200, -195, 'Waiting on paperwork', "Workers' comp lapsed; they say the renewal is in the mail."),
    ('Keystone Concrete', 'Concrete', 'Devon Price', 120, 120, 75, 12, -500, -480, 'Approved', None),
    ('Brightline HVAC', 'HVAC', 'Sam Okafor', 250, 250, 250, 400, -150, None, 'Waiting on paperwork', 'Agreement sent for signature.'),
    ('Oakview Drywall', 'Drywall', 'Priya Bell', 45, None, None, 90, None, -60, 'Approved', "Sole owner; workers' comp exemption certificate in Files."),
    ('Northfield Painting', 'Painting', 'Frank Rivera', 9, 70, None, -3, -700, -690, 'On hold', 'License renewal pending with the state.'),
    ('Granite Excavating', 'Excavation', 'Keisha Thompson', 180, 33, 33, 260, -90, -88, 'Approved', None),
]
sub_records = []
for i, (co, trade, contact, gl, wc, auto, lic, w9, agr, status, notes) in enumerate(SUBS):
    r = {'Company': co, 'Trade': trade, 'Contact person': contact, 'Phone': f'555-01{13 + i * 7:02d}',
         'Email': 'office@' + co.lower().split()[0] + '.example.com', 'General liability expires': d(gl), 'Status': status}
    if wc is not None: r["Workers' comp expires"] = d(wc)
    if auto is not None: r['Auto liability expires'] = d(auto)
    if lic is not None: r['Contractor license expires'] = d(lic)
    if w9 is not None: r['W-9 received'] = d(w9)
    if agr is not None: r['Agreement signed'] = d(agr)
    if notes: r['Notes'] = notes
    sub_records.append(r)

JOBS = [
    ('Kitchen remodel – Maple Ave', '100 Maple Ave\nSpringfield', 'Robert Dubois', 'Active', -20, 25, [0, 1, 5, 6]),
    ('Garage addition – Birch Lane', '137 Birch Lane\nSpringfield', 'Linh Smith', 'Signed', 5, 70, [3, 0, 2, 7]),
    ('Office build-out – Willow Way', '211 Willow Way\nSpringfield', 'Carlos Wong', 'Signed', 12, 60, [0, 4, 5, 6]),
    ('Roof replacement – Elm Street', '248 Elm Street\nSpringfield', 'Priya Bell', 'Bidding', 30, 40, [2]),
    ('Basement finish – Oak Terrace', '322 Oak Terrace\nSpringfield', 'Keisha Thompson', 'Done', -90, -12, [0, 1, 5, 6]),
]
job_records, links = [], []
for i, (name, addr, owner, status, start, finish, sub_idx) in enumerate(JOBS):
    job_records.append({'Job': name, 'Address': addr, 'Property owner': owner, 'Status': status, 'Start date': d(start), 'Finish date': d(finish)})
    links += [{'from': f'jobs#{i}', 'to': f'subcontractors#{j}', 'link': 'Subs on this job'} for j in sub_idx]

sample = {
    'records': {'subcontractors': sub_records, 'jobs': job_records},
    'links': links,
    'activities': [
        {'record': 'subcontractors#0', 'type': 'email', 'daysAgo': 10, 'text': 'Asked their insurance agent for an updated certificate, with us as additional insured.'},
        {'record': 'subcontractors#2', 'type': 'call', 'daysAgo': 3, 'text': "Called about the workers' comp lapse. Off the Elm Street roof until we get the new certificate."},
        {'record': 'subcontractors#3', 'type': 'certificate', 'daysAgo': 15, 'text': 'New general liability certificate received; dates updated. PDF in Files.'},
        {'record': 'subcontractors#6', 'type': 'note', 'daysAgo': 6, 'text': 'State website shows the license renewal as pending.'},
        {'record': 'jobs#1', 'type': 'note', 'daysAgo': 2, 'text': 'Before start: check Ridgeline and Summit paperwork.'},
    ],
}

starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'subcontractor-compliance', 'name': 'Subcontractor insurance & licenses',
    'description': "For general contractors and builders: every subcontractor's certificates of insurance, workers' comp, licenses, W-9 and signed agreement, with 30-day warnings before anything runs out, and the subs on each job.",
    'icon': 'file-check', 'group': 'Business',
    'vocab': {'record': {'one': 'record', 'many': 'records', 'article': 'a'}, 'list': {'one': 'list', 'many': 'lists', 'article': 'a'}, 'activity': {'one': 'note', 'many': 'notes', 'article': 'a'}},
    'suggestedFeatures': {'personFields': False, 'priority': False, 'contactsDirectory': False, 'requirements': False, 'timeTracking': False, 'mileage': False,
                          'snippets': True, 'checklists': True, 'tasks': True, 'focusMode': False, 'letters': True, 'summaryReport': True, 'handoff': False,
                          'links': True, 'stages': False, 'measures': False, 'appointments': False, 'forms': False, 'attachments': True},
    'activityTypes': [
        {'key': 'note', 'label': 'Note', 'icon': '📝', 'color': 'slate'},
        {'key': 'call', 'label': 'Call', 'icon': '📞', 'color': 'blue'},
        {'key': 'email', 'label': 'Email', 'icon': '✉️', 'color': 'purple'},
        {'key': 'certificate', 'label': 'Certificate received', 'icon': '📄', 'color': 'green'},
    ],
    'documentTemplates': [
        {'name': 'Certificate of insurance request', 'content': "{{today}}\n\n{{name}}\nAttn: {{field:Contact person}}\n\nPlease send an updated certificate of insurance. Our records show your general liability coverage ends on {{field:General liability expires}} and your workers' comp coverage on {{field:Workers' comp expires}}.\n\nPlease have your agent list our company as certificate holder and additional insured. We can't schedule your crew on our sites until a current certificate is on file.\n\nThank you,\n\n{{my_name}}"},
        {'name': 'Missing paperwork request', 'content': "{{today}}\n\n{{name}}\nAttn: {{field:Contact person}}\n\nBefore your next job with us, we still need:\n\n- A completed W-9\n- Your signed subcontract agreement\n- A copy of your current contractor license\n\nYou can email them back or drop them off at the office.\n\nThank you,\n\n{{my_name}}"},
    ],
    'helpTips': [
        {'title': 'Keep the certificates', 'body': "Drop each certificate of insurance, W-9 and signed agreement into Files on the subcontractor's page. They are stored encrypted inside Pulse, and you can show them to your own insurance auditor."},
        {'title': 'Before a job starts', 'body': "Open the job to see every sub linked to it. Anything red on their page (an expired certificate, a missing W-9) should be sorted out before they start work."},
        {'title': 'Additional insured', 'body': "When you request a certificate, ask their agent to name your company as certificate holder and additional insured. The Certificate of insurance request letter already says so."},
    ],
    'lists': [subs, jobs],
    'dashboardCards': ['summary', 'missingInfo', 'recentActivity'],
    'sampleData': sample,
}

json.dump(starter, open(OUT, 'w'), indent=2, ensure_ascii=False)
open(OUT, 'a').write('\n')
print('written', OUT)
