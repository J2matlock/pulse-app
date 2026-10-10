"""Generates src/shared/starters/tax-preparer.json (thresholds and configs are JSON strings)."""
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

def deadline_col(name, pos, rule, description):
    return col(name, 'deadline', pos, 150, description=description, config=json.dumps({'alert_rule_name': rule}))

def cond(column, op, values):
    return json.dumps({'columnId': {'column': column}, 'op': op, 'values': values, 'whenFalse': 'hide'})

def calendar(months, day):
    return json.dumps({'kind': 'calendar', 'months': months, 'day': day})

def relative(anchor, days):
    return json.dumps({'kind': 'relative', 'anchorColumnId': {'column': anchor}, 'offset': {'days': days, 'direction': 'after'}})

def d(n): return {'daysFromToday': n}

STAGES = [('Waiting on documents', 'slate', '#64748b'), ('Documents in', 'blue', '#3b82f6'), ('Preparing', 'amber', '#f59e0b'),
          ('Review', 'purple', '#8b5cf6'), ('Extended', 'orange', '#f97316'), ('Filed', 'green', '#22c55e')]

clients = {
    'key': 'clients', 'name': 'Clients', 'description': 'People, households and small businesses you prepare taxes or keep books for', 'kind': 'person',
    'vocab': {'record': {'one': 'client', 'many': 'clients', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 200, is_name_column=1, is_identifier=1, is_required=1),
        col('Phone', 'phone', 1, 140, is_required=1),
        col('Email', 'email', 2, 210),
        col('Address', 'address', 3, 180),
        col('Client type', 'dropdown', 4, 150, config=json.dumps({'options': ['Individual', 'Household', 'Sole proprietor', 'Small business']})),
        col('Services', 'dropdown', 5, 180, config=json.dumps({'options': ['Taxes only', 'Taxes and bookkeeping', 'Bookkeeping only']})),
        col('Pays estimated taxes', 'dropdown', 6, 150, config=json.dumps({'options': ['Yes', 'No']})),
        date_col('Engagement letter signed', 7, 'Every year', 'Date they signed this year\'s engagement letter; renew every year'),
        deadline_col('Estimated taxes', 8, 'Estimated taxes', 'Quarterly payment reminder (Jan, Apr, Jun, Sep 15) for clients who pay estimated taxes; mark it done when they have paid'),
        deadline_col('1099s', 9, '1099s due', 'Contractor 1099s are due Jan 31 for sole proprietors and businesses; mark it done when filed'),
        deadline_col('Monthly close', 10, 'Monthly close', 'Books reconciled and closed by the 15th of each month, for bookkeeping clients'),
        col('Notes', 'notes', 11, 220),
    ],
    'alertRules': [
        {'name': 'Every year', 'description': 'Due on the same date a year later', 'interval_months': 12, 'thresholds': T60},
        {'name': 'Estimated taxes', 'description': 'Quarterly estimated taxes: Jan 15, Apr 15, Jun 15 and Sep 15', 'interval_days': 0, 'thresholds': T30,
         'kind': 'calendar', 'rule_config': calendar([1, 4, 6, 9], 15), 'rule_condition': cond('Pays estimated taxes', 'is', ['Yes'])},
        {'name': '1099s due', 'description': 'Contractor 1099s are due every Jan 31', 'interval_days': 0, 'thresholds': T60,
         'kind': 'calendar', 'rule_config': calendar([1], 31), 'rule_condition': cond('Client type', 'is', ['Sole proprietor', 'Small business'])},
        {'name': 'Monthly close', 'description': 'Books closed by the 15th of every month', 'interval_days': 0, 'thresholds': T7,
         'kind': 'calendar', 'rule_config': calendar(list(range(1, 13)), 15), 'rule_condition': cond('Services', 'is_not', ['Taxes only'])},
    ],
}

returns = {
    'key': 'returns', 'name': 'Returns', 'description': 'Each return or filing, from waiting on documents to filed', 'kind': 'job',
    'vocab': {'record': {'one': 'return', 'many': 'returns', 'article': 'a'}},
    'columns': [
        col('Return', 'text', 0, 240, is_name_column=1, is_identifier=1, is_required=1),
        col('Stage', 'status', 1, 170, config=json.dumps({'options': [{'label': s, 'color': h} for s, _, h in STAGES]})),
        col('Return type', 'dropdown', 2, 170, config=json.dumps({'options': ['Individual (1040)', 'S corporation (1120-S)', 'Partnership (1065)', 'Nonprofit (990)', 'Amended return', 'Sales tax', 'Payroll (941)']})),
        col('Tax year', 'number', 3, 100),
        col('Documents requested on', 'date', 4, 170, description='The day you sent the document request'),
        date_col('Documents follow-up', 5, 'Documents follow-up', 'Date you followed up about missing documents'),
        date_col('Filing deadline', 6, 'Filing deadline', 'Apr 15 for most individual returns, Mar 15 for S corporations and partnerships. If you file an extension, change it to the extended date'),
        col('Filed on', 'date', 7, 150, description='Filled in when the return moves to Filed'),
        date_col('E-file accepted', 8, 'E-file acceptance', 'Date you confirmed the IRS or state accepted the e-file'),
        col('Fee', 'currency', 9, 110),
    ],
    'alertRules': [
        {'name': 'Filing deadline', 'description': 'The date entered is the filing deadline, until the return is filed', 'interval_days': 0, 'thresholds': T30,
         'rule_condition': cond('Stage', 'is_not', ['Filed'])},
        {'name': 'Documents follow-up', 'description': 'Follow up 7 days after requesting documents, while still waiting on them', 'interval_days': 0, 'thresholds': T7,
         'kind': 'relative', 'rule_config': relative('Documents requested on', 7), 'rule_condition': cond('Stage', 'is', ['Waiting on documents'])},
        {'name': 'E-file acceptance', 'description': 'Check the e-file was accepted 3 days after filing', 'interval_days': 0, 'thresholds': T7,
         'kind': 'relative', 'rule_config': relative('Filed on', 3)},
    ],
    'checklists': [
        {'name': 'Documents still missing', 'description': 'Tick each one off as it comes in', 'items': json.dumps([
            'W-2s from every job', '1099s: interest, dividends, contract work, retirement', 'Form 1098 mortgage interest and the property tax bill',
            'Last year\'s return (if we did not prepare it)', 'Form 1095-A, if they bought insurance on the marketplace',
            'Childcare costs and the daycare\'s tax ID', 'Charitable donation receipts', 'Estimated tax payments made this year',
            'Bank account and routing number for the refund'])},
        {'name': 'Before filing', 'description': 'Last checks before the return goes out', 'items': json.dumps([
            'Prior-year carryovers checked', 'Estimated payments match the IRS record', 'Refund or payment bank details confirmed',
            'Client signed the e-file authorization (8879)', 'Copy saved for the client and for your files'])},
    ],
    'links': [{'to': 'clients', 'label_forward': 'Client', 'label_backward': 'Returns', 'cardinality': 'many_to_one'}],
    'stage': {'column': 'Stage', 'options': [
        {'value': s, 'color': c, **({'done': True} if s == 'Filed' else {}),
         **({'onEnter': {'checklist': 'Documents still missing'}} if s == 'Waiting on documents' else
            {'onEnter': {'checklist': 'Before filing'}} if s == 'Review' else
            {'onEnter': {'stampColumn': 'Filed on', 'activityType': 'note'}} if s == 'Filed' else {})}
        for s, c, _ in STAGES], 'hideDoneAfterDays': 60},
}

CLIENTS = [
    # name, street, type, services, estimated, engagement signed
    ('Robert Dubois', '100 Maple Ave', 'Individual', 'Taxes only', 'No', -330),
    ('Linh Smith', '137 Birch Lane', 'Sole proprietor', 'Taxes and bookkeeping', 'Yes', -380),
    ('Dorothy Kowalski', '174 Cedar Court', 'Household', 'Taxes only', 'No', -200),
    ('Wong Family Bakery', '211 Willow Way', 'Small business', 'Taxes and bookkeeping', 'Yes', -350),
    ('Priya Bell', '248 Elm Street', 'Individual', 'Taxes only', 'Yes', -90),
    ('Rivera Landscaping LLC', '285 Pine Road', 'Small business', 'Bookkeeping only', 'No', -400),
    ('Keisha Thompson', '322 Oak Terrace', 'Sole proprietor', 'Taxes only', 'Yes', -150),
    ('Samuel Rahman', '359 Aspen Drive', 'Individual', 'Taxes only', 'No', None),
]
NOTES = [None, 'Freelance designer; quarterly estimates from her business account.', 'Files jointly with her husband, Walter.',
         'Two locations. Payroll through the bank.', None, 'Owner: Frank Rivera. Prefers email.', 'Rideshare driver; keeps a mileage log.', 'New this year.']
client_records = []
for i, (n, street, typ, svc, est, signed) in enumerate(CLIENTS):
    r = {'Name': n, 'Phone': f'555-01{13 + i * 7:02d}', 'Email': n.lower().replace(' ', '.').replace('llc', 'office') + '@example.com',
         'Address': f'{street}\nSpringfield', 'Client type': typ, 'Services': svc, 'Pays estimated taxes': est}
    if signed is not None: r['Engagement letter signed'] = d(signed)
    if NOTES[i]: r['Notes'] = NOTES[i]
    client_records.append(r)

RETURNS = [
    # return, stage, type, year, client, extras
    ('2025 Form 1040 – Dubois', 'Extended', 'Individual (1040)', 2025, 0, {'Documents requested on': d(-200), 'Filing deadline': d(6), 'Fee': 325}),
    ('2025 Form 1040 – Smith', 'Review', 'Individual (1040)', 2025, 1, {'Documents requested on': d(-190), 'Filing deadline': d(6), 'Fee': 475}),
    ('2025 Form 1040 – Kowalski', 'Filed', 'Individual (1040)', 2025, 2, {'Documents requested on': d(-230), 'Filing deadline': d(-177), 'Filed on': d(-180), 'E-file accepted': d(-178), 'Fee': 350}),
    ('2025 Form 1120-S – Wong Family Bakery', 'Preparing', 'S corporation (1120-S)', 2025, 3, {'Documents requested on': d(-240), 'Filing deadline': d(-24), 'Fee': 1200}),
    ('Q3 Form 941 – Wong Family Bakery', 'Filed', 'Payroll (941)', 2025, 3, {'Filing deadline': d(22), 'Filed on': d(-1), 'Fee': 90}),
    ('2025 Form 1040 – Bell', 'Waiting on documents', 'Individual (1040)', 2025, 4, {'Documents requested on': d(-10), 'Filing deadline': d(6), 'Fee': 300}),
    ('2024 amended return – Thompson', 'Waiting on documents', 'Amended return', 2024, 6, {'Documents requested on': d(-4), 'Filing deadline': d(40), 'Fee': 250}),
    ('2025 Form 1040 – Rahman', 'Documents in', 'Individual (1040)', 2025, 7, {'Documents requested on': d(-30), 'Filing deadline': d(6), 'Fee': 300}),
    ('Q3 sales tax – Rivera Landscaping', 'Preparing', 'Sales tax', 2025, 5, {'Filing deadline': d(11), 'Fee': 75}),
]
return_records = [{'Return': name, 'Stage': stage, 'Return type': typ, 'Tax year': year, **extra} for name, stage, typ, year, _, extra in RETURNS]

sample = {
    'records': {'clients': client_records, 'returns': return_records},
    'links': [{'from': f'returns#{i}', 'to': f'clients#{c}', 'link': 'Client'} for i, (_, _, _, _, c, _) in enumerate(RETURNS)],
    'activities': [
        {'record': 'returns#5', 'type': 'email', 'daysAgo': 10, 'text': 'Sent the document request. Still need her 1099-INT and the mortgage statement.'},
        {'record': 'returns#0', 'type': 'note', 'daysAgo': 176, 'text': 'Filed the extension (Form 4868) and moved the filing deadline to October 15.'},
        {'record': 'returns#3', 'type': 'call', 'daysAgo': 6, 'text': 'Talked with Carlos about the new oven: depreciate it, don\'t expense it.'},
        {'record': 'returns#7', 'type': 'docs', 'daysAgo': 3, 'text': 'Everything in: W-2, 1098, donation receipts.'},
        {'record': 'returns#2', 'type': 'note', 'daysAgo': 178, 'text': 'E-file accepted by the IRS and the state.'},
        {'record': 'clients#1', 'type': 'meeting', 'daysAgo': 45, 'text': 'Midyear check-in. Income up about 20%; raised her quarterly estimates.'},
        {'record': 'clients#5', 'type': 'note', 'daysAgo': 20, 'text': 'September books closed. Two receipts still missing for equipment.'},
    ],
    'history': [
        {'record': 'returns#1', 'column': 'Stage', 'values': [{'value': 'Waiting on documents', 'daysAgo': 190}, {'value': 'Extended', 'daysAgo': 176}, {'value': 'Documents in', 'daysAgo': 120}, {'value': 'Preparing', 'daysAgo': 30}, {'value': 'Review', 'daysAgo': 2}]},
        {'record': 'returns#3', 'column': 'Stage', 'values': [{'value': 'Waiting on documents', 'daysAgo': 240}, {'value': 'Documents in', 'daysAgo': 60}, {'value': 'Preparing', 'daysAgo': 21}]},
        {'record': 'returns#7', 'column': 'Stage', 'values': [{'value': 'Waiting on documents', 'daysAgo': 30}, {'value': 'Documents in', 'daysAgo': 3}]},
    ],
    'appointments': [
        {'record': 'returns#7', 'title': 'Go over the return with Samuel', 'dayOffset': 2, 'time': '10:00', 'minutes': 45, 'type': 'meeting'},
        {'record': 'returns#1', 'title': 'Sign 8879 – Linh Smith', 'dayOffset': 1, 'time': '16:30', 'minutes': 30, 'type': 'meeting'},
        {'record': 'returns#3', 'title': 'Year-end planning – Wong Family Bakery', 'dayOffset': 8, 'time': '09:00', 'minutes': 60, 'type': 'meeting'},
        {'record': 'returns#2', 'title': 'Return pickup – Kowalski', 'dayOffset': -180, 'time': '11:00', 'minutes': 20, 'type': 'meeting'},
    ],
}

starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'tax-preparer', 'name': 'Bookkeeper & tax preparer',
    'description': 'For tax preparers and bookkeepers: clients, returns on a board from waiting on documents to filed, quarterly estimated taxes, 1099s, extensions, engagement letters and monthly closes. Pulse is a tracking aid, not your official record system.',
    'icon': 'calculator', 'group': 'Business',
    'vocab': {'record': {'one': 'record', 'many': 'records', 'article': 'a'}, 'list': {'one': 'list', 'many': 'lists', 'article': 'a'}, 'activity': {'one': 'note', 'many': 'notes', 'article': 'a'}},
    'suggestedFeatures': {'personFields': False, 'priority': False, 'contactsDirectory': False, 'requirements': False, 'timeTracking': False, 'mileage': False,
                          'snippets': True, 'checklists': True, 'tasks': True, 'focusMode': False, 'letters': True, 'summaryReport': True, 'handoff': False,
                          'links': True, 'stages': True, 'measures': False, 'appointments': True, 'forms': False, 'attachments': True},
    'activityTypes': [
        {'key': 'note', 'label': 'Note', 'icon': '📝', 'color': 'slate'},
        {'key': 'call', 'label': 'Call', 'icon': '📞', 'color': 'blue'},
        {'key': 'email', 'label': 'Email', 'icon': '✉️', 'color': 'teal'},
        {'key': 'meeting', 'label': 'Meeting', 'icon': '🤝', 'color': 'purple'},
        {'key': 'docs', 'label': 'Documents received', 'icon': '📄', 'color': 'green'},
    ],
    'documentTemplates': [
        {'name': 'Document request', 'content': '{{today}}\n\nHi {{linked:Client.Name}},\n\nWe are getting ready to prepare your {{field:Tax year}} return ({{name}}). To get started, please send us:\n\n- W-2s and 1099s\n- Form 1098 (mortgage interest) and your property tax bill\n- Receipts for charitable donations\n- Any estimated tax payments you made this year\n- A copy of last year\'s return, if we did not prepare it\n\nThe filing deadline is {{field:Filing deadline}}. The sooner we have everything, the sooner we can file.\n\nThanks,\n\n{{my_name}}'},
        {'name': 'Engagement letter reminder', 'content': '{{today}}\n\nDear {{name}},\n\nIt is time to renew our engagement letter for the coming year. Your last one was signed on {{field:Engagement letter signed}}.\n\nThe new letter is enclosed. Please sign and return it, and let us know if anything about your situation has changed: a new job, a new business, a move, or a new dependent.\n\nThank you for your trust,\n\n{{my_name}}'},
    ],
    'helpTips': [
        {'title': 'Waiting on documents', 'body': 'Fill in "Documents requested on" when you send the request. If the return is still waiting a week later, the Documents follow-up column turns due. Once the return moves on, the reminder goes away.'},
        {'title': 'Extensions', 'body': 'When you file an extension, move the return to Extended and change its filing deadline to the extended date (October 15 for most individual returns), so the reminder follows the new date.'},
        {'title': 'Calendar deadlines', 'body': 'Estimated taxes (Jan, Apr, Jun and Sep 15), 1099s (Jan 31) and the monthly close show only for the clients they apply to. Mark each one done when it is paid or filed, and Pulse moves on to the next date.'},
        {'title': 'Keep copies safe', 'body': 'Drop signed engagement letters, 8879s and scanned documents into Files on the client or the return. They are stored encrypted inside Pulse. Copies you save elsewhere are not.'},
    ],
    'lists': [clients, returns],
    'dashboardCards': ['summary', 'today', 'stages', 'missingInfo', 'recentActivity'],
    'sampleData': sample,
}

json.dump(starter, open(sys.argv[1], 'w'), indent=2, ensure_ascii=False)
open(sys.argv[1], 'a').write('\n')
print('written')
