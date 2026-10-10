"""Generates src/shared/starters/real-estate.json (thresholds and configs are JSON strings)."""
import os
import json, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'shared', 'starters', 'real-estate.json')

def th(*steps):
    labels = {'coming': 'Coming up', 'soon': 'Due soon', 'urgent': 'Urgent'}
    colors = {'coming': '#bbf7d0', 'soon': '#facc15', 'urgent': '#fb923c'}
    out = [{'daysBefore': d, 'bgClass': colors[k], 'label': labels[k]} for k, d in steps]
    out += [{'daysBefore': 0, 'bgClass': '#dc2626', 'label': 'Due today'}, {'daysBefore': -1, 'bgClass': 'alert-pulse-dark', 'label': 'Overdue'}]
    return json.dumps(out)

T7 = th(('soon', 7), ('urgent', 3))
T14 = th(('coming', 14), ('soon', 7), ('urgent', 3))
T30 = th(('coming', 30), ('soon', 14), ('urgent', 7))

def col(name, ctype, pos, width, **kw):
    c = {'name': name, 'column_type': ctype, 'position': pos, 'width': width}
    c.update(kw)
    return c

def date_col(name, pos, rule, description=None, log=True):
    cfg = {'alert_rule_name': rule}
    if log: cfg['log_changes'] = True
    c = col(name, 'date', pos, 160, config=json.dumps(cfg))
    if description: c['description'] = description
    return c

def d(n): return {'daysFromToday': n}

# While a deal is under contract the contingency dates matter; once it closes or falls through they don't
OPEN_DEAL = json.dumps({'columnId': {'column': 'Stage'}, 'op': 'is', 'values': ['Under contract', 'Clear to close'], 'whenFalse': 'hide'})
CLOSED = json.dumps({'columnId': {'column': 'Stage'}, 'op': 'is', 'values': ['Closed'], 'whenFalse': 'hide'})

def from_contract(name, days, description):
    return {'name': name, 'description': description, 'interval_days': 0, 'thresholds': T7, 'kind': 'relative',
            'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Contract date'}, 'offset': {'days': days, 'direction': 'after'}}),
            'rule_condition': OPEN_DEAL}

STAGES = [('Showing', 'slate', '#64748b'), ('Offer made', 'blue', '#3b82f6'), ('Under contract', 'amber', '#f59e0b'),
          ('Clear to close', 'teal', '#14b8a6'), ('Closed', 'green', '#22c55e'), ('Fell through', 'red', '#ef4444')]

people = {
    'key': 'clients', 'name': 'Buyers & sellers', 'description': 'The people you are helping buy or sell a home', 'kind': 'person',
    'vocab': {'record': {'one': 'client', 'many': 'clients', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 190, is_name_column=1, is_identifier=1, is_required=1),
        col('Phone', 'phone', 1, 140, is_required=1),
        col('Email', 'email', 2, 210),
        col('Buying or selling', 'dropdown', 3, 160, config=json.dumps({'options': ['Buying', 'Selling', 'Both']})),
        col('Current address', 'address', 4, 180),
        col('Price range', 'text', 5, 140, description='What they want to spend, or what they hope to get'),
        date_col('Pre-approval expires', 6, 'Expires', 'Mortgage pre-approval letters usually run 60 to 90 days'),
        date_col('Listing agreement expires', 7, 'Expires', 'For sellers: when your listing agreement ends'),
        col('Found you through', 'dropdown', 8, 160, config=json.dumps({'options': ['Referral', 'Open house', 'Website', 'Past client', 'Sign call', 'Other']})),
        col('Notes', 'notes', 9, 220),
    ],
    'alertRules': [
        {'name': 'Expires', 'description': 'The date entered is when it runs out', 'interval_days': 0, 'thresholds': T30},
    ],
}

transactions = {
    'key': 'transactions', 'name': 'Transactions', 'description': 'Each home from the first showing to closing', 'kind': 'job',
    'vocab': {'record': {'one': 'transaction', 'many': 'transactions', 'article': 'a'}},
    'columns': [
        col('Property', 'text', 0, 210, is_name_column=1, is_identifier=1, is_required=1, description='The street address'),
        col('Stage', 'status', 1, 150, config=json.dumps({'options': [{'label': s, 'color': h} for s, _, h in STAGES]})),
        col('Side', 'dropdown', 2, 120, config=json.dumps({'options': ['Buyer side', 'Listing side']})),
        col('Price', 'currency', 3, 130),
        col('Contract date', 'date', 4, 150, description='The day the contract was fully signed. The contingency dates count from here'),
        date_col('Inspection done', 5, 'Inspection period', 'Date the inspection was done and any repair requests sent'),
        date_col('Appraisal received', 6, 'Appraisal', 'Date the appraisal came back'),
        date_col('Loan approved', 7, 'Financing contingency', 'Date the lender gave final loan approval'),
        date_col('Closing date', 8, 'Closing', 'The closing date in the contract'),
        col('Closed on', 'date', 9, 150, description='Filled in when the transaction moves to Closed'),
        date_col('Closing anniversary', 10, 'Closing anniversary', 'Date you last sent a closing-anniversary note', log=False),
        col('Commission', 'currency', 11, 130),
    ],
    'alertRules': [
        from_contract('Inspection period', 10, 'Inspection done within 10 days of the contract date'),
        from_contract('Appraisal', 21, 'Appraisal back within 21 days of the contract date'),
        from_contract('Financing contingency', 21, 'Loan approval within 21 days of the contract date'),
        {'name': 'Closing', 'description': 'The date entered is the closing, while the deal is open', 'interval_days': 0, 'thresholds': T14,
         'rule_condition': OPEN_DEAL},
        {'name': 'Closing anniversary', 'description': 'Every year on the day it closed, 30 days ahead', 'interval_days': 0, 'thresholds': T14,
         'kind': 'calendar', 'rule_config': json.dumps({'kind': 'calendar', 'fromColumnMonth': {'column': 'Closed on'}, 'lead': 30}),
         'rule_condition': CLOSED},
    ],
    'checklists': [
        {'name': 'Under contract', 'description': 'From signed contract to closing', 'items': json.dumps([
            'Earnest money deposited', 'Inspection scheduled', 'Repair requests sent or waived', 'Appraisal ordered',
            'Loan application and documents with the lender', 'Title search ordered', "Homeowner's insurance quote",
            'Utilities transfer arranged', 'Final walk-through scheduled'])},
    ],
    'links': [{'to': 'clients', 'label_forward': 'Client', 'label_backward': 'Transactions', 'cardinality': 'many_to_one'}],
    'stage': {'column': 'Stage', 'options': [
        {'value': s, 'color': c, **({'done': True} if s in ('Closed', 'Fell through') else {}),
         **({'onEnter': {'checklist': 'Under contract'}} if s == 'Under contract' else
            {'onEnter': {'stampColumn': 'Closed on', 'activityType': 'note'}} if s == 'Closed' else {})}
        for s, c, _ in STAGES], 'hideDoneAfterDays': 60},
}

NAMES = [('Robert Dubois', 'Buying'), ('Linh Smith', 'Selling'), ('Dorothy Kowalski', 'Buying'), ('Carlos Wong', 'Selling'),
         ('Priya Bell', 'Buying'), ('Frank Rivera', 'Both'), ('Keisha Thompson', 'Selling'), ('Samuel Rahman', 'Buying')]
STREETS = ['100 Maple Ave', '137 Birch Lane', '174 Cedar Court', '211 Willow Way', '248 Elm Street', '285 Pine Road', '322 Oak Terrace', '359 Aspen Drive']
EXTRA = [
    {'Price range': '$350k–$400k', 'Pre-approval expires': d(20), 'Found you through': 'Referral'},
    {'Price range': 'Hoping for $425k', 'Listing agreement expires': d(40), 'Found you through': 'Past client'},
    {'Price range': '$300k–$330k', 'Pre-approval expires': d(-3), 'Found you through': 'Open house', 'Notes': 'Needs a new pre-approval letter before the next offer.'},
    {'Price range': 'Hoping for $510k', 'Listing agreement expires': d(12), 'Found you through': 'Sign call'},
    {'Price range': 'Up to $280k', 'Pre-approval expires': d(60), 'Found you through': 'Website', 'Notes': 'First-time buyer. Wants a yard for the dog.'},
    {'Price range': '$450k–$500k', 'Found you through': 'Referral'},
    {'Price range': 'Sold at $389k', 'Listing agreement expires': d(150), 'Found you through': 'Past client'},
    {'Price range': '$250k–$300k', 'Pre-approval expires': d(45), 'Found you through': 'Open house'},
]
people_records = []
for i, ((n, role), street, extra) in enumerate(zip(NAMES, STREETS, EXTRA)):
    people_records.append({'Name': n, 'Phone': f'555-01{13 + i * 7:02d}', 'Email': n.lower().replace(' ', '.') + '@example.com',
                           'Buying or selling': role, 'Current address': f'{street}\nSpringfield', **extra})

DEALS = [
    # property, stage, side, client index, extra columns
    ('12 Larch Lane', 'Under contract', 'Buyer side', 0, {'Price': 372000, 'Contract date': d(-12), 'Closing date': d(33)}),
    ('48 Juniper Court', 'Under contract', 'Listing side', 1, {'Price': 419000, 'Contract date': d(-8), 'Inspection done': d(-3), 'Closing date': d(37)}),
    ('7 Hawthorn Road', 'Clear to close', 'Buyer side', 2, {'Price': 318000, 'Contract date': d(-40), 'Inspection done': d(-32), 'Appraisal received': d(-25), 'Loan approved': d(-20), 'Closing date': d(5)}),
    ('301 Poplar Street', 'Showing', 'Listing side', 3, {'Price': 509000}),
    ('19 Sycamore Ave', 'Offer made', 'Buyer side', 4, {'Price': 275000}),
    ('88 Chestnut Drive', 'Closed', 'Buyer side', 5, {'Price': 468000, 'Contract date': d(-400), 'Inspection done': d(-392), 'Appraisal received': d(-385), 'Loan approved': d(-380), 'Closing date': d(-355), 'Closed on': d(-355), 'Commission': 11700}),
    ('5 Magnolia Way', 'Closed', 'Listing side', 6, {'Price': 389000, 'Contract date': d(-75), 'Inspection done': d(-68), 'Appraisal received': d(-55), 'Loan approved': d(-50), 'Closing date': d(-30), 'Closed on': d(-30), 'Commission': 9725}),
    ('66 Redwood Circle', 'Fell through', 'Buyer side', 7, {'Price': 262000, 'Contract date': d(-50)}),
]
deal_records = [{'Property': p, 'Stage': st, 'Side': side, **extra} for p, st, side, _, extra in DEALS]

sample = {
    'records': {'clients': people_records, 'transactions': deal_records},
    'links': [{'from': f'transactions#{i}', 'to': f'clients#{c}', 'link': 'Client'} for i, (_, _, _, c, _) in enumerate(DEALS)],
    'activities': [
        {'record': 'transactions#0', 'type': 'call', 'daysAgo': 12, 'text': 'Offer accepted at $372k. Contract fully signed tonight.'},
        {'record': 'transactions#0', 'type': 'note', 'daysAgo': 4, 'text': 'Inspector had to reschedule; asked the seller side for two extra days.'},
        {'record': 'transactions#1', 'type': 'note', 'daysAgo': 3, 'text': 'Inspection report in. Buyer asking for a new water heater.'},
        {'record': 'transactions#2', 'type': 'call', 'daysAgo': 2, 'text': 'Lender says clear to close. Walk-through set for the morning of closing.'},
        {'record': 'transactions#4', 'type': 'showing', 'daysAgo': 5, 'text': 'Second showing. Loved the yard; writing an offer tonight.'},
        {'record': 'transactions#7', 'type': 'note', 'daysAgo': 38, 'text': 'Buyer backed out after the inspection (foundation). Earnest money returned.'},
        {'record': 'clients#5', 'type': 'call', 'daysAgo': 60, 'text': 'Checked in. Thinking about selling the old place next spring.'},
    ],
    'history': [
        {'record': 'transactions#0', 'column': 'Stage', 'values': [{'value': 'Showing', 'daysAgo': 30}, {'value': 'Offer made', 'daysAgo': 14}, {'value': 'Under contract', 'daysAgo': 12}]},
        {'record': 'transactions#1', 'column': 'Stage', 'values': [{'value': 'Showing', 'daysAgo': 45}, {'value': 'Offer made', 'daysAgo': 10}, {'value': 'Under contract', 'daysAgo': 8}]},
        {'record': 'transactions#2', 'column': 'Stage', 'values': [{'value': 'Offer made', 'daysAgo': 42}, {'value': 'Under contract', 'daysAgo': 40}, {'value': 'Clear to close', 'daysAgo': 2}]},
        {'record': 'transactions#3', 'column': 'Stage', 'values': [{'value': 'Showing', 'daysAgo': 21}]},
        {'record': 'transactions#4', 'column': 'Stage', 'values': [{'value': 'Showing', 'daysAgo': 18}, {'value': 'Offer made', 'daysAgo': 4}]},
    ],
    'appointments': [
        {'record': 'transactions#3', 'title': 'Showing', 'dayOffset': 1, 'time': '17:30', 'minutes': 45, 'type': 'showing', 'location': '301 Poplar Street'},
        {'record': 'transactions#3', 'title': 'Open house', 'dayOffset': 3, 'time': '13:00', 'minutes': 180, 'type': 'showing', 'location': '301 Poplar Street'},
        {'record': 'transactions#0', 'title': 'Home inspection', 'dayOffset': 1, 'time': '10:00', 'minutes': 150, 'location': '12 Larch Lane'},
        {'record': 'transactions#2', 'title': 'Final walk-through', 'dayOffset': 5, 'time': '09:00', 'minutes': 45, 'location': '7 Hawthorn Road'},
        {'record': 'transactions#2', 'title': 'Closing', 'dayOffset': 5, 'time': '11:00', 'minutes': 60, 'location': 'Springfield Title Co.'},
        {'record': 'transactions#4', 'title': 'Second showing', 'dayOffset': -5, 'time': '18:00', 'minutes': 45, 'type': 'showing', 'location': '19 Sycamore Ave'},
    ],
}

starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'real-estate', 'name': 'Real estate transactions',
    'description': 'For real estate agents: buyers and sellers, and each home on a board from showing to closing, with the inspection, appraisal, financing and closing dates counted from the contract date, pre-approval and listing expirations, and a note on every closing anniversary. Your contract sets the real dates. Pulse is a tracking aid, not your official record system.',
    'icon': 'handshake', 'group': 'Business',
    'vocab': {'record': {'one': 'record', 'many': 'records', 'article': 'a'}, 'list': {'one': 'list', 'many': 'lists', 'article': 'a'}, 'activity': {'one': 'note', 'many': 'notes', 'article': 'a'}},
    'suggestedFeatures': {'personFields': False, 'priority': False, 'contactsDirectory': False, 'requirements': False, 'timeTracking': False, 'mileage': False,
                          'snippets': True, 'checklists': True, 'tasks': True, 'focusMode': False, 'letters': True, 'summaryReport': True, 'handoff': False,
                          'links': True, 'stages': True, 'measures': False, 'appointments': True, 'forms': False, 'attachments': True},
    'activityTypes': [
        {'key': 'note', 'label': 'Note', 'icon': '📝', 'color': 'slate'},
        {'key': 'call', 'label': 'Call', 'icon': '📞', 'color': 'blue'},
        {'key': 'text', 'label': 'Text', 'icon': '💬', 'color': 'teal'},
        {'key': 'showing', 'label': 'Showing', 'icon': '🏠', 'color': 'green'},
    ],
    'documentTemplates': [
        {'name': 'Under contract: key dates', 'content': '{{today}}\n\nHi {{linked:Client.Name}},\n\nCongratulations, {{name}} is under contract! Here are the dates we are working toward:\n\n- Inspection: {{deadline:Inspection done}}\n- Appraisal: {{deadline:Appraisal received}}\n- Loan approval: {{deadline:Loan approved}}\n- Closing: {{field:Closing date}}\n\nI will keep you posted at every step. Call me any time with questions.\n\n{{my_name}}'},
        {'name': 'Closing anniversary note', 'content': '{{today}}\n\nHi {{linked:Client.Name}},\n\nHard to believe it has been a year since you closed on {{name}} ({{field:Closed on}}). I hope the place feels like home.\n\nIf you ever have questions about your home\'s value, or know someone thinking of buying or selling, I would love to help.\n\nWarmly,\n\n{{my_name}}'},
    ],
    'helpTips': [
        {'title': 'Dates from the contract', 'body': 'Fill in the Contract date and Pulse counts the inspection (10 days), appraisal and financing (21 days) from it. Change the days under the column\'s deadline settings to match your contract. Fill in each date when it is done.'},
        {'title': 'After closing', 'body': 'Move a transaction to Closed and Pulse fills in Closed on. The contingency dates go away, and the closing anniversary comes up a month ahead every year, a good time to send the anniversary note.'},
        {'title': 'Keep the paperwork', 'body': 'Drop the signed contract, inspection report and closing disclosure into Files on the transaction. They are stored encrypted inside Pulse.'},
    ],
    'lists': [people, transactions],
    'dashboardCards': ['summary', 'today', 'stages', 'missingInfo'],
    'sampleData': sample,
}

starter['reports'] = [{'name': 'Commission per month', 'list': 'transactions', 'description': 'Deals closed and commission earned each month this year.', 'config': {'source': 'records', 'filters': [], 'groupBy': [{'field': 'col:Closed on', 'bucket': 'month'}], 'values': [{'fn': 'count', 'label': 'Closed'}, {'fn': 'sum', 'field': 'col:Commission', 'label': 'Commission'}], 'dateRange': {'field': 'col:Closed on', 'preset': 'this_year'}}}, {'name': 'Where buyers and sellers come from', 'list': 'clients', 'description': 'How people found you, so you know what’s working.', 'config': {'source': 'records', 'filters': [], 'groupBy': [{'field': 'col:Found you through'}], 'values': [{'fn': 'count'}]}}]

json.dump(starter, open(OUT, 'w'), indent=2, ensure_ascii=False)
open(OUT, 'a').write('\n')
print('written', OUT)
