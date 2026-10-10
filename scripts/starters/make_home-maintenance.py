"""Generates src/shared/starters/home-maintenance.json (thresholds and configs are JSON strings)."""
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

items = {
    'key': 'items', 'name': 'Home items', 'description': 'The things in your home that need regular care', 'kind': 'thing',
    'vocab': {'record': {'one': 'item', 'many': 'items', 'article': 'an'}},
    'columns': [
        col('Item', 'text', 0, 190, is_name_column=1, is_identifier=1, is_required=1),
        col('Where', 'text', 1, 140, description='Room or spot, e.g. Basement, Kitchen, North side of the house'),
        col('Brand and model', 'text', 2, 170),
        col('Installed', 'date', 3, 140),
        date_col('Warranty ends', 4, 'Expires (60 days ahead)'),
        date_col('Air filter changed', 5, 'Every 90 days', 'Furnace, AC or air purifier filter. Write the size in Notes'),
        date_col('Water filter changed', 6, 'Every 6 months', 'Refrigerator or under-sink water filter'),
        date_col('Last serviced', 7, 'Every year', 'Yearly tune-up, flush or cleaning: furnace, water heater, dryer vent, roof check'),
        date_col('Batteries changed', 8, 'Every year', 'Smoke and CO detectors. Press the test button once a month too'),
        col('Seasonal', 'dropdown', 9, 140, description='Choose "Spring and fall" for things that need care twice a year, like gutters',
            config=json.dumps({'options': ['Spring and fall']})),
        col('Spring and fall upkeep', 'deadline', 10, 170, description='Due at the end of April and the end of October; mark it done when it is done',
            config=json.dumps({'alert_rule_name': 'Spring and fall'})),
        col('Notes', 'notes', 11, 220),
    ],
    'alertRules': [
        {'name': 'Every 90 days', 'description': 'Due 90 days after the date entered', 'interval_days': 90, 'thresholds': T7},
        {'name': 'Every 6 months', 'description': 'Due 6 months after the date entered', 'interval_months': 6, 'thresholds': T14},
        {'name': 'Every year', 'description': 'Due on the same date a year later', 'interval_months': 12, 'thresholds': T30},
        {'name': 'Expires (60 days ahead)', 'description': 'The date entered is when it runs out; warns 60 days ahead', 'interval_days': 0, 'thresholds': T60},
        {'name': 'Spring and fall', 'description': 'Due April 30 and October 30, for items marked Spring and fall', 'interval_days': 0, 'thresholds': T30,
         'kind': 'calendar', 'rule_config': json.dumps({'kind': 'calendar', 'months': [4, 10], 'day': 30}),
         'rule_condition': json.dumps({'columnId': {'column': 'Seasonal'}, 'op': 'is', 'values': ['Spring and fall'], 'whenFalse': 'hide'})},
    ],
    'checklists': [
        {'name': 'Spring home checklist', 'description': 'Once the weather warms up', 'items': json.dumps([
            'Clean the gutters and downspouts', 'Test the sump pump with a bucket of water', 'Have the AC serviced before the first hot week',
            'Change the furnace or AC filter', 'Check the roof and siding for winter damage', 'Turn the outdoor faucets back on and check for leaks',
            'Test smoke and CO detectors'])},
        {'name': 'Fall home checklist', 'description': 'Before the first freeze', 'items': json.dumps([
            'Clean the gutters after the leaves drop', 'Have the furnace serviced', 'Change the furnace filter', 'Shut off and drain outdoor faucets',
            'Clean the dryer vent', 'Change smoke and CO detector batteries', 'Check weatherstripping on doors and windows'])},
    ],
    'links': [{'to': 'pros', 'label_forward': 'Who services it', 'label_backward': 'Takes care of', 'cardinality': 'many_to_one'}],
}

bills = {
    'key': 'bills', 'name': 'Bills and renewals', 'description': 'Home insurance, property tax and other house bills that come due once or twice a year', 'kind': 'thing',
    'vocab': {'record': {'one': 'bill', 'many': 'bills', 'article': 'a'}},
    'columns': [
        col('Bill', 'text', 0, 210, is_name_column=1, is_identifier=1, is_required=1),
        col('Company', 'text', 1, 170),
        col('Amount', 'currency', 2, 120),
        date_col('Due', 3, 'Due date', 'When it has to be paid or renewed. After paying, change it to the next due date'),
        col('How often', 'dropdown', 4, 140, config=json.dumps({'options': ['Monthly', 'Twice a year', 'Yearly']})),
        col('Account or policy number', 'text', 5, 190),
        col('Notes', 'notes', 6, 220),
    ],
    'alertRules': [
        {'name': 'Due date', 'description': 'The date entered is when it is due', 'interval_days': 0, 'thresholds': T30},
    ],
}

pros = {
    'key': 'pros', 'name': 'Service people', 'description': 'Who you call for repairs and yearly service', 'kind': 'person',
    'vocab': {'record': {'one': 'service person', 'many': 'service people', 'article': 'a'}},
    'columns': [
        col('Name', 'text', 0, 200, is_name_column=1, is_identifier=1, is_required=1),
        col('Trade', 'dropdown', 1, 150, config=json.dumps({'options': ['Plumber', 'Heating and cooling', 'Electrician', 'Handyman', 'Roofer', 'Appliance repair', 'Pest control']})),
        col('Phone', 'phone', 2, 140, is_required=1),
        col('Email', 'email', 3, 200),
        col('Last used', 'date', 4, 140),
        col('Notes', 'notes', 5, 220),
    ],
}

ITEMS = [
    ('Furnace', 'Basement', 'Carrier 59SC5', -2900, {'Warranty ends': d(750), 'Air filter changed': d(-95), 'Last serviced': d(-340), 'Notes': 'Filter size 16x25x1, MERV 8.'}),
    ('Central AC', 'North side of the house', 'Carrier 24ACC6', -2900, {'Last serviced': d(-300), 'Seasonal': 'Spring and fall'}),
    ('Water heater', 'Basement', 'Rheem 50 gal', -1800, {'Warranty ends': d(345), 'Last serviced': d(-370), 'Notes': 'Flush the tank yearly to clear sediment.'}),
    ('Smoke and CO detectors', 'Every floor', None, None, {'Batteries changed': d(-358), 'Notes': '5 detectors: basement, kitchen, hallway, two bedrooms.'}),
    ('Gutters', 'Roof line', None, None, {'Seasonal': 'Spring and fall'}),
    ('Dryer vent', 'Laundry room', None, None, {'Last serviced': d(-200)}),
    ('Refrigerator', 'Kitchen', 'LG LRMVS3006S', -900, {'Warranty ends': d(30), 'Water filter changed': d(-170)}),
    ('Sump pump', 'Basement', 'Zoeller M53', -1500, {'Seasonal': 'Spring and fall', 'Notes': 'Test it by pouring a bucket of water into the pit.'}),
    ('Roof', 'House', 'Architectural shingles', -4000, {'Warranty ends': d(3300), 'Last serviced': d(-150)}),
    ('Dishwasher', 'Kitchen', 'Bosch 300 Series', -500, {'Warranty ends': d(230)}),
]
item_records = []
for name, where, model, installed, extra in ITEMS:
    r = {'Item': name, 'Where': where}
    if model: r['Brand and model'] = model
    if installed is not None: r['Installed'] = d(installed)
    r.update(extra)
    item_records.append(r)

bill_records = [
    {'Bill': 'Home insurance', 'Company': 'Example Mutual', 'Amount': 1450, 'Due': d(24), 'How often': 'Yearly', 'Account or policy number': 'HO-0042-118'},
    {'Bill': 'Property tax, first half', 'Company': 'Springfield County', 'Amount': 2100, 'Due': d(5), 'How often': 'Twice a year', 'Notes': 'Pay online on the county site.'},
    {'Bill': 'Property tax, second half', 'Company': 'Springfield County', 'Amount': 2100, 'Due': d(185), 'How often': 'Twice a year'},
    {'Bill': 'HOA dues', 'Company': 'Maple Grove HOA', 'Amount': 85, 'Due': d(-2), 'How often': 'Monthly'},
    {'Bill': 'Home warranty plan', 'Company': 'Example Home Shield', 'Amount': 540, 'Due': d(80), 'How often': 'Yearly'},
    {'Bill': 'Flood insurance', 'Company': 'Example Mutual', 'Amount': 620, 'Due': d(150), 'How often': 'Yearly'},
]

pro_records = [
    {'Name': 'Dana Cole Plumbing', 'Trade': 'Plumber', 'Phone': '555-0131', 'Email': 'dana.cole@example.com', 'Last used': d(-120)},
    {'Name': 'Aspen Heating and Air', 'Trade': 'Heating and cooling', 'Phone': '555-0138', 'Email': 'service@aspen.example.com', 'Last used': d(-340), 'Notes': 'Ask for Luis.'},
    {'Name': 'Bright Spark Electric', 'Trade': 'Electrician', 'Phone': '555-0145', 'Email': 'office@brightspark.example.com'},
    {'Name': 'Greg Martin', 'Trade': 'Handyman', 'Phone': '555-0152', 'Email': 'greg.martin@example.com', 'Last used': d(-160), 'Notes': 'Does gutters and small repairs.'},
]

sample = {
    'records': {'items': item_records, 'bills': bill_records, 'pros': pro_records},
    'links': [
        {'from': 'items#0', 'to': 'pros#1', 'link': 'Who services it'},
        {'from': 'items#1', 'to': 'pros#1', 'link': 'Who services it'},
        {'from': 'items#2', 'to': 'pros#0', 'link': 'Who services it'},
        {'from': 'items#4', 'to': 'pros#3', 'link': 'Who services it'},
        {'from': 'items#5', 'to': 'pros#3', 'link': 'Who services it'},
        {'from': 'items#7', 'to': 'pros#0', 'link': 'Who services it'},
    ],
    'activities': [
        {'record': 'items#0', 'type': 'repair', 'daysAgo': 340, 'text': 'Yearly tune-up. Cleaned the burners, replaced the igniter.'},
        {'record': 'items#2', 'type': 'note', 'daysAgo': 370, 'text': 'Flushed the tank; a lot of sediment came out.'},
        {'record': 'items#7', 'type': 'call', 'daysAgo': 120, 'text': 'Called Dana about the pump running a lot after rain. Said it is fine for now.'},
        {'record': 'items#6', 'type': 'note', 'daysAgo': 170, 'text': 'New water filter, LT1000P.'},
        {'record': 'bills#0', 'type': 'call', 'daysAgo': 20, 'text': 'Asked about a discount for the new roof. They will send a quote.'},
    ],
    'appointments': [
        {'record': 'items#0', 'title': 'Furnace tune-up', 'dayOffset': 5, 'time': '10:00', 'minutes': 60, 'type': 'repair'},
        {'record': 'items#4', 'title': 'Gutter cleaning', 'dayOffset': 12, 'time': '09:00', 'minutes': 120},
    ],
}

starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'home-maintenance', 'name': 'Home maintenance',
    'description': 'For homeowners: furnace filters every 90 days, yearly service for the furnace and water heater, smoke detector batteries, gutters every spring and fall, warranties, home insurance and property tax due dates, and who to call for repairs.',
    'icon': 'hammer', 'group': 'Personal',
    'vocab': {'record': {'one': 'item', 'many': 'items', 'article': 'an'}, 'list': {'one': 'list', 'many': 'lists', 'article': 'a'}, 'activity': {'one': 'note', 'many': 'notes', 'article': 'a'}},
    'suggestedFeatures': {'personFields': False, 'priority': False, 'contactsDirectory': False, 'requirements': False, 'timeTracking': False, 'mileage': False,
                          'snippets': False, 'checklists': True, 'tasks': True, 'focusMode': False, 'letters': False, 'summaryReport': False, 'handoff': False,
                          'links': True, 'stages': False, 'measures': False, 'appointments': True, 'forms': False, 'attachments': True},
    'activityTypes': [
        {'key': 'note', 'label': 'Note', 'icon': '📝', 'color': 'slate'},
        {'key': 'call', 'label': 'Call', 'icon': '📞', 'color': 'blue'},
        {'key': 'repair', 'label': 'Repair or service', 'icon': '🔧', 'color': 'orange'},
    ],
    'helpTips': [
        {'title': 'Manuals and receipts', 'body': 'Drop the manual, receipt and warranty card into Files on each item. They are stored encrypted inside Pulse, so they are there when something breaks.'},
        {'title': 'Spring and fall', 'body': 'Set Seasonal to "Spring and fall" on things like gutters and the AC. They come due at the end of April and the end of October. The spring and fall checklists cover the rest of the house.'},
        {'title': 'Filters', 'body': 'Write the filter size in Notes, so you buy the right one. When you change it, put today in Air filter changed and Pulse reminds you again in 90 days.'},
        {'title': 'Bills that repeat', 'body': 'After you pay a bill, change its Due date to the next one. Pulse warns you 30 days ahead.'},
    ],
    'lists': [items, bills, pros],
    'dashboardCards': ['summary', 'today'],
    'sampleData': sample,
}

json.dump(starter, open(sys.argv[1], 'w'), indent=2, ensure_ascii=False)
open(sys.argv[1], 'a').write('\n')
print('written')
