"""Generates src/shared/starters/home-services.json: one starter, five variants (lawn, pest, HVAC, pool, chimney/gutters/windows).
Shared shape: Customers <- Properties <- Visits (board), plus a variant-specific fourth list where the trade needs one."""
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

def dropdown(name, pos, width, options, **kw):
    return col(name, 'dropdown', pos, width, config=json.dumps({'options': options}), **kw)

def d(n): return {'daysFromToday': n}

def every_months(name, months, desc, thresholds=T30):
    return {'name': name, 'description': desc, 'interval_months': months, 'thresholds': thresholds}

def every_days(name, days, desc, thresholds=T30):
    return {'name': name, 'description': desc, 'interval_days': days, 'thresholds': thresholds}

def expires(name='Expires', desc='The date entered is when it runs out', thresholds=T30):
    return {'name': name, 'description': desc, 'interval_days': 0, 'thresholds': thresholds}

def calendar(name, months, day, desc, lead=None):
    cfg = {'kind': 'calendar', 'months': months, 'day': day}
    if lead is not None: cfg['lead'] = lead
    return {'name': name, 'description': desc, 'interval_days': 0, 'thresholds': T30, 'kind': 'calendar', 'rule_config': json.dumps(cfg)}

# ── Shared lists ─────────────────────────────────────────────────────────────

STAGES = [('Requested', 'slate', '#64748b'), ('Scheduled', 'blue', '#3b82f6'), ('Done', 'green', '#22c55e'), ('Cancelled', 'red', '#ef4444')]

def customers_list():
    return {
        'key': 'customers', 'name': 'Customers', 'description': 'The people and businesses you work for', 'kind': 'person',
        'vocab': {'record': {'one': 'customer', 'many': 'customers', 'article': 'a'}},
        'columns': [
            col('Name', 'text', 0, 190, is_name_column=1, is_identifier=1, is_required=1),
            col('Phone', 'phone', 1, 140, is_required=1),
            col('Email', 'email', 2, 200),
            dropdown('Preferred contact', 3, 150, ['Call', 'Text', 'Email']),
            col('Billing address', 'address', 4, 180),
            col('Notes', 'notes', 5, 220),
        ],
    }

def properties_list(plan_options, extra_cols, rules, description):
    cols = [
        col('Property', 'text', 0, 220, is_name_column=1, is_identifier=1, is_required=1, description='A short name, e.g. "Dubois – 100 Maple Ave"'),
        col('Address', 'address', 1, 180, is_required=1),
        col('Gate and pet notes', 'notes', 2, 220, description='Gate code, dogs, where to park, anything the crew should know'),
        dropdown('Service plan', 3, 170, plan_options),
    ]
    for i, c in enumerate(extra_cols):
        c['position'] = 4 + i
        cols.append(c)
    return {
        'key': 'properties', 'name': 'Properties', 'description': description, 'kind': 'thing',
        'vocab': {'record': {'one': 'property', 'many': 'properties', 'article': 'a'}},
        'columns': cols, 'alertRules': rules,
        'links': [{'to': 'customers', 'label_forward': 'Customer', 'label_backward': 'Properties', 'cardinality': 'many_to_one'}],
    }

def visits_list(services, extra_cols=(), extra_rules=(), checklist=None):
    cols = [
        col('Visit', 'text', 0, 220, is_name_column=1, is_identifier=1, is_required=1),
        col('Stage', 'status', 1, 140, config=json.dumps({'options': [{'label': s, 'color': h} for s, _, h in STAGES]})),
        dropdown('Service', 2, 170, services),
        date_col('Scheduled for', 3, 'Visit date', 'The day the visit is booked'),
        col('Completed on', 'date', 4, 150, description='Filled in when the visit moves to Done'),
    ]
    for c in extra_cols:
        c['position'] = len(cols)
        cols.append(c)
    cols.append(col('Price', 'currency', len(cols), 110))
    cols.append(col('Notes', 'notes', len(cols), 220))
    rules = [{'name': 'Visit date', 'description': 'The date entered is the day of the visit, until it is done', 'interval_days': 0, 'thresholds': T7,
              'rule_condition': json.dumps({'columnId': {'column': 'Stage'}, 'op': 'is_not', 'values': ['Done', 'Cancelled'], 'whenFalse': 'hide'})}]
    rules += list(extra_rules)
    lst = {
        'key': 'visits', 'name': 'Visits', 'description': 'Each visit from the request to done', 'kind': 'job',
        'vocab': {'record': {'one': 'visit', 'many': 'visits', 'article': 'a'}},
        'columns': cols, 'alertRules': rules,
        'links': [{'to': 'properties', 'label_forward': 'Property', 'label_backward': 'Visits', 'cardinality': 'many_to_one'}],
        'stage': {'column': 'Stage', 'options': [
            {'value': s, 'color': c, **({'done': True} if s in ('Done', 'Cancelled') else {}),
             **({'onEnter': {'stampColumn': 'Completed on', 'activityType': 'note'}} if s == 'Done' else {})}
            for s, c, _ in STAGES], 'hideDoneAfterDays': 30},
        'forms': [{
            'name': 'Service request', 'intro': 'Take this down when someone calls to book a visit, or print a blank for the truck.', 'log_activity_type': 'call',
            'fields': [
                {'kind': 'column', 'column': 'Visit', 'label': 'What do they need?', 'required': True},
                {'kind': 'column', 'column': 'Service', 'width': 'half'},
                {'kind': 'column', 'column': 'Scheduled for', 'width': 'half'},
                {'kind': 'note', 'label': 'Anything the crew should know before they arrive?'},
            ]}],
    }
    if checklist:
        lst['checklists'] = [checklist]
    return lst

def checklist(name, description, items):
    return {'name': name, 'description': description, 'items': json.dumps(items)}

# ── Shared sample data ───────────────────────────────────────────────────────

CUST = ['Robert Dubois', 'Linh Smith', 'Dorothy Kowalski', 'Carlos Wong', 'Priya Bell', 'Frank Rivera', 'Keisha Thompson', 'Samuel Rahman']
STREETS = ['100 Maple Ave', '137 Birch Lane', '174 Cedar Court', '211 Willow Way', '248 Elm Street', '285 Pine Road', '322 Oak Terrace', '359 Aspen Drive']
CONTACT = ['Text', 'Call', 'Text', 'Email', 'Call', 'Text', 'Call', 'Email']
GATE = ['Gate code 4471. Dog in the back yard.', None, 'Side gate sticks; lift and push.', 'Office park; check in at the front desk.',
        None, 'Park on the street, not the driveway.', 'Two cats indoors; keep doors shut.', None]

def customer_records():
    out = []
    for i, n in enumerate(CUST):
        r = {'Name': n, 'Phone': f'555-01{13 + i * 7:02d}', 'Email': n.lower().replace(' ', '.') + '@example.com',
             'Preferred contact': CONTACT[i], 'Billing address': f'{STREETS[i]}\nSpringfield'}
        if i == 3: r['Notes'] = 'Bill the office monthly.'
        out.append(r)
    return out

def prop_base(i, plan):
    last = CUST[i].split()[1]
    r = {'Property': f'{last} – {STREETS[i]}', 'Address': f'{STREETS[i]}\nSpringfield', 'Service plan': plan}
    if GATE[i]: r['Gate and pet notes'] = GATE[i]
    return r

def prop_links(n):
    return [{'from': f'properties#{i}', 'to': f'customers#{i}', 'link': 'Customer'} for i in range(n)]

def visit_links(props):
    return [{'from': f'visits#{i}', 'to': f'properties#{p}', 'link': 'Property'} for i, p in enumerate(props)]

def visit(name, stage, service, prop, sched=None, done=None, price=None, **extra):
    r = {'Visit': name, 'Stage': stage, 'Service': service}
    if sched is not None: r['Scheduled for'] = d(sched)
    if done is not None: r['Completed on'] = d(done)
    if price is not None: r['Price'] = price
    r.update(extra)
    return r, prop

def stage_history(rec, steps):
    return {'record': rec, 'column': 'Stage', 'values': [{'value': v, 'daysAgo': a} for v, a in steps]}

def route(prop_idx, title, day, time, weeks, minutes=45):
    """A weekly route stop: an appointment series on the property."""
    return {'record': f'properties#{prop_idx}', 'title': title, 'dayOffset': day, 'time': time, 'minutes': minutes, 'type': 'on_site', 'repeatWeekly': weeks}

def appt(rec, title, day, time, minutes, typ='on_site', location=None, status=None):
    a = {'record': rec, 'title': title, 'dayOffset': day, 'time': time, 'minutes': minutes, 'type': typ}
    if location: a['location'] = location
    if status: a['status'] = status
    return a

def build_variant(key, name, description, props_list, visits, extra_list, records, links, activities, history, appointments):
    lists = [customers_list(), props_list, visits]
    if extra_list: lists.append(extra_list)
    return {'key': key, 'name': name, 'description': description, 'lists': lists,
            'sampleData': {'records': records, 'links': links, 'activities': activities, 'history': history, 'appointments': appointments}}

def split_visits(pairs):
    return [r for r, _ in pairs], [p for _, p in pairs]

# ── Lawn care & landscaping ─────────────────────────────────────────────────

def lawn():
    props = properties_list(
        ['Weekly mowing', 'Every 2 weeks', 'Fertilizer program only', 'Full service'],
        [col('Lawn size (sq ft)', 'number', 0, 140),
         date_col('Last fertilizer round', 0, 'Fertilizer rounds', 'Date of the last round; the next one is due in Apr, Jun, Aug or Oct'),
         date_col('Irrigation started', 0, 'Irrigation start-up', 'Date the sprinklers were turned on; due again each April'),
         date_col('Irrigation winterized', 0, 'Winterize', 'Date the lines were blown out; due again each October')],
        [calendar('Fertilizer rounds', [4, 6, 8, 10], 15, 'Four rounds a year: April, June, August and October 15', lead=30),
         calendar('Irrigation start-up', [4], 30, 'Turn the sprinklers on by the end of April', lead=45),
         calendar('Winterize', [10], 31, 'Blow out the lines by the end of October', lead=45)],
        'Lawns and yards you look after, with their programs and seasonal dates')
    pairs = [
        visit('Weekly mow – Dubois', 'Scheduled', 'Mowing', 0, sched=1, price=45),
        visit('Weekly mow – Smith', 'Scheduled', 'Mowing', 1, sched=2, price=40),
        visit('Fall cleanup and leaves', 'Requested', 'Cleanup', 2),
        visit('Aerate and overseed', 'Scheduled', 'Aeration', 3, sched=-2, price=320),
        visit('Mulch beds out front', 'Scheduled', 'Landscaping', 4, sched=12, price=480),
        visit('Fertilizer round 3', 'Done', 'Fertilizer', 5, sched=-55, done=-55, price=85),
        visit('Sprinkler head repair', 'Done', 'Irrigation', 6, sched=-6, done=-6, price=120),
        visit('Hedge trim', 'Cancelled', 'Landscaping', 7, sched=-3),
    ]
    vrecs, vprops = split_visits(pairs)
    equipment = {
        'key': 'equipment', 'name': 'Equipment', 'description': 'Mowers, trimmers and trucks, with service due by engine hours', 'kind': 'thing',
        'vocab': {'record': {'one': 'machine', 'many': 'machines', 'article': 'a'}},
        'columns': [
            col('Name', 'text', 0, 200, is_name_column=1, is_identifier=1, is_required=1),
            dropdown('Type', 1, 140, ['Mower', 'Trimmer', 'Blower', 'Aerator', 'Truck', 'Trailer']),
            col('Hour meter', 'number', 2, 120, description='Engine hours; update it now and then so Pulse can forecast service'),
            col('Hours at last service', 'number', 3, 160),
            date_col('Last service', 4, 'Service'),
            date_col('Registration expires', 5, 'Expires'),
            col('Notes', 'notes', 6, 220),
        ],
        'alertRules': [
            {'name': 'Service', 'description': 'Every 50 engine hours or once a year, whichever comes first', 'interval_days': 0, 'thresholds': T7,
             'kind': 'meter', 'rule_config': json.dumps({'kind': 'meter', 'readingColumnId': {'column': 'Hour meter'}, 'lastServiceReadingColumnId': {'column': 'Hours at last service'},
                                                         'every': 50, 'unit': 'hours', 'timeFallback': {'months': 12}, 'typicalPerDay': 1.5})},
            expires(),
        ],
    }
    props_recs = []
    FERT = [-60, -120, -50, -200, None, -55, -130, -40]
    IRR_ON = [-170, -170, None, -540, -170, -170, None, -170]
    IRR_OFF = [-360, -350, None, -370, None, -350, None, -345]
    PLAN = ['Weekly mowing', 'Weekly mowing', 'Full service', 'Every 2 weeks', 'Full service', 'Fertilizer program only', 'Every 2 weeks', 'Weekly mowing']
    for i in range(8):
        r = prop_base(i, PLAN[i])
        r['Lawn size (sq ft)'] = [6500, 4200, 9800, 12000, 5200, 7300, 3900, 8100][i]
        if FERT[i] is not None: r['Last fertilizer round'] = d(FERT[i])
        if IRR_ON[i] is not None: r['Irrigation started'] = d(IRR_ON[i])
        if IRR_OFF[i] is not None: r['Irrigation winterized'] = d(IRR_OFF[i])
        props_recs.append(r)
    equip_recs = [
        {'Name': 'Zero-turn mower 60"', 'Type': 'Mower', 'Hour meter': 412, 'Hours at last service': 366, 'Last service': d(-35)},
        {'Name': 'Walk-behind mower 36"', 'Type': 'Mower', 'Hour meter': 905, 'Hours at last service': 880, 'Last service': d(-20)},
        {'Name': 'Core aerator', 'Type': 'Aerator', 'Hour meter': 61, 'Hours at last service': 40, 'Last service': d(-380)},
        {'Name': 'Crew truck', 'Type': 'Truck', 'Last service': d(-90), 'Registration expires': d(18)},
        {'Name': 'Equipment trailer', 'Type': 'Trailer', 'Last service': d(-200), 'Registration expires': d(210)},
    ]
    def hours(rec, now, per_day):
        return {'record': rec, 'column': 'Hour meter', 'values': [{'value': str(round(now - per_day * a)), 'daysAgo': a} for a in [150, 120, 90, 60, 30, 1]]}
    return build_variant(
        'lawn-care', 'Lawn care & landscaping', 'Mowing routes, fertilizer rounds, sprinkler start-up and winterizing, and mower service by engine hours.',
        props, visits_list(['Mowing', 'Fertilizer', 'Aeration', 'Cleanup', 'Irrigation', 'Landscaping'],
                           checklist=checklist('Spring start-up', 'First visit of the season', ['Walk the property for winter damage', 'Turn on and test every sprinkler zone', 'Sharpen mower blades', 'Edge beds and walks', 'Confirm the mowing day with the customer'])),
        equipment,
        {'customers': customer_records(), 'properties': props_recs, 'visits': vrecs, 'equipment': equip_recs},
        prop_links(8) + visit_links(vprops),
        [{'record': 'visits#3', 'type': 'call', 'daysAgo': 9, 'text': 'Booked aeration; wants overseed with shade mix.'},
         {'record': 'visits#6', 'type': 'note', 'daysAgo': 6, 'text': 'Replaced two broken heads in zone 3.'},
         {'record': 'properties#2', 'type': 'on_site', 'daysAgo': 14, 'text': 'Walked the yard; lots of leaves coming down from the oaks.'}],
        [hours('equipment#0', 412, 1.6), hours('equipment#1', 905, 0.9),
         stage_history('visits#3', [('Requested', 12), ('Scheduled', 9)])],
        [route(0, 'Mow – Dubois', 1, '08:00', 8, 40), route(1, 'Mow – Smith', 1, '09:00', 8, 35), route(7, 'Mow – Rahman', 2, '08:00', 8, 45),
         appt('visits#4', 'Mulch beds', 12, '08:00', 240, location=STREETS[4]),
         appt('visits#2', 'Look at the leaves', 3, '15:00', 30, location=STREETS[2])])

# ── Pest control ─────────────────────────────────────────────────────────────

def pest():
    props = properties_list(
        ['Quarterly', 'Monthly', 'One-time', 'Termite protection'],
        [col('Pests seen', 'text', 0, 180, description='What the customer has been seeing'),
         date_col('Last quarterly service', 0, 'Every 3 months', 'Date of the last plan visit; the next is due 3 months later'),
         date_col('Termite protection renews', 0, 'Renews', 'Yearly termite bond or warranty renewal')],
        [every_months('Every 3 months', 3, 'Due 3 months after the date entered'),
         expires('Renews', 'The date entered is when it renews', T60)],
        'Homes and buildings on a service plan, with what pests they have')
    follow_up = date_col('Follow-up visit', 0, 'Follow-up visit', 'Date you went back to check the treatment worked')
    pairs = [
        visit('Quarterly service – Dubois', 'Scheduled', 'Quarterly service', 0, sched=0, price=95),
        visit('Ants in the kitchen', 'Done', 'Treatment', 1, sched=-11, done=-11, price=150),
        visit('Wasp nest under the deck', 'Done', 'Treatment', 2, sched=-20, done=-20, price=125),
        visit('Quarterly service – Wong offices', 'Scheduled', 'Quarterly service', 3, sched=-1, price=240),
        visit('Mice in the garage', 'Requested', 'Inspection', 4),
        visit('Termite inspection', 'Scheduled', 'Termite', 5, sched=8, price=0),
        visit('Bed bug treatment', 'Done', 'Treatment', 6, sched=-40, done=-40, price=600, **{'Follow-up visit': d(-26)}),
        visit('Quarterly service – Rahman', 'Done', 'Quarterly service', 7, sched=-30, done=-30, price=95),
    ]
    vrecs, vprops = split_visits(pairs)
    for r in vrecs:
        if r['Service'] == 'Treatment': r.setdefault('Products used', 'Gel bait and crack-and-crevice spray')
    visits = visits_list(['Quarterly service', 'Treatment', 'Inspection', 'Termite'],
                         extra_cols=[follow_up, col('Products used', 'notes', 0, 200, description='Product names and amounts, for your records')],
                         extra_rules=[{'name': 'Follow-up visit', 'description': 'Go back 14 days after a treatment', 'interval_days': 0, 'thresholds': T7,
                                       'kind': 'relative', 'rule_config': json.dumps({'kind': 'relative', 'anchorColumnId': {'column': 'Completed on'}, 'offset': {'days': 14, 'direction': 'after'}}),
                                       'rule_condition': json.dumps({'columnId': {'column': 'Service'}, 'op': 'is', 'values': ['Treatment'], 'whenFalse': 'hide'})}],
                         checklist=checklist('Treatment visit', 'Every treatment', ['Ask about kids, pets and allergies', 'Read the label for this site', 'Note product, amount and where it was applied', 'Leave the after-treatment sheet', 'Book the follow-up visit']))
    techs = {
        'key': 'technicians', 'name': 'Technicians', 'description': 'Your applicators, with licenses and training due', 'kind': 'person',
        'vocab': {'record': {'one': 'technician', 'many': 'technicians', 'article': 'a'}},
        'columns': [
            col('Name', 'text', 0, 180, is_name_column=1, is_identifier=1, is_required=1),
            col('Phone', 'phone', 1, 140),
            col('Applicator license number', 'text', 2, 180, is_required=1),
            date_col('Applicator license expires', 3, 'Expires (60 days ahead)'),
            col('Training credits this cycle', 'number', 4, 180, description='Continuing education credits toward renewal'),
            date_col('Last safety training', 5, 'Every year'),
        ],
        'alertRules': [expires('Expires (60 days ahead)', 'The date entered is when it runs out; warns 60 days ahead', T60),
                       every_months('Every year', 12, 'Due on the same date a year later', T60)],
    }
    PLAN = ['Quarterly', 'One-time', 'One-time', 'Monthly', 'One-time', 'Termite protection', 'One-time', 'Quarterly']
    LASTQ = [-92, None, None, -28, None, None, None, -30]
    TERM = [None, None, None, None, None, 25, None, 140]
    PESTS = ['Spiders, ants', 'Ants', 'Wasps', 'Roaches near the break room', 'Mice', 'Termite swarmers last spring', 'Bed bugs', 'Ants']
    props_recs = []
    for i in range(8):
        r = prop_base(i, PLAN[i]); r['Pests seen'] = PESTS[i]
        if LASTQ[i] is not None: r['Last quarterly service'] = d(LASTQ[i])
        if TERM[i] is not None: r['Termite protection renews'] = d(TERM[i])
        props_recs.append(r)
    tech_recs = [
        {'Name': 'Marcus Lee', 'Phone': '555-0170', 'Applicator license number': 'AP-20417', 'Applicator license expires': d(45), 'Training credits this cycle': 6, 'Last safety training': d(-300)},
        {'Name': 'Ana Torres', 'Phone': '555-0173', 'Applicator license number': 'AP-31882', 'Applicator license expires': d(410), 'Training credits this cycle': 10, 'Last safety training': d(-380)},
        {'Name': 'Devon Price', 'Phone': '555-0176', 'Training credits this cycle': 2, 'Last safety training': d(-60)},
    ]
    return build_variant(
        'pest-control', 'Pest control', 'Quarterly service plans, a follow-up visit 14 days after each treatment, termite renewals and applicator licenses.',
        props, visits, techs,
        {'customers': customer_records(), 'properties': props_recs, 'visits': vrecs, 'technicians': tech_recs},
        prop_links(8) + visit_links(vprops),
        [{'record': 'visits#1', 'type': 'note', 'daysAgo': 11, 'text': 'Treated along the baseboards and under the sink. Follow-up in two weeks.'},
         {'record': 'visits#4', 'type': 'call', 'daysAgo': 2, 'text': 'Hearing scratching in the garage at night. Wants someone out this week.'},
         {'record': 'visits#6', 'type': 'note', 'daysAgo': 26, 'text': 'Follow-up done; no live activity found.'}],
        [stage_history('visits#5', [('Requested', 10), ('Scheduled', 6)])],
        [appt('visits#0', 'Quarterly – Dubois', 0, '09:00', 45, location=STREETS[0]), appt('visits#3', 'Quarterly – Wong offices', 1, '07:30', 90, location=STREETS[3]),
         appt('visits#4', 'Mouse inspection', 2, '14:00', 45, location=STREETS[4]), appt('visits#5', 'Termite inspection', 8, '10:00', 60, location=STREETS[5]),
         appt('visits#1', 'Ant follow-up', 3, '11:00', 30, location=STREETS[1])])

# ── HVAC ─────────────────────────────────────────────────────────────────────

def hvac():
    props = properties_list(
        ['Maintenance agreement', 'Pay per visit'],
        [date_col('AC tune-up', 0, 'Spring AC tune-up', 'Date of the last cooling tune-up; due again each spring'),
         date_col('Furnace tune-up', 0, 'Fall furnace tune-up', 'Date of the last heating tune-up; due again each fall'),
         date_col('Filter changed', 0, 'Every 90 days', 'Date the filter was last changed'),
         col('Filter size', 'text', 0, 120, description='e.g. 16x25x1')],
        [calendar('Spring AC tune-up', [5], 15, 'Cooling tune-up by mid-May', lead=60),
         calendar('Fall furnace tune-up', [10], 31, 'Heating tune-up by the end of October', lead=60),
         every_days('Every 90 days', 90, 'Due 90 days after the date entered', T7)],
        'Homes and buildings you service, with tune-ups and filters due')
    pairs = [
        visit('Furnace tune-up – Dubois', 'Scheduled', 'Tune-up', 0, sched=2, price=129),
        visit('No heat upstairs', 'Scheduled', 'Repair', 1, sched=0, price=0),
        visit('Furnace tune-up – Kowalski', 'Requested', 'Tune-up', 2),
        visit('Rooftop units – Wong offices', 'Scheduled', 'Tune-up', 3, sched=-2, price=540),
        visit('Replace condenser fan motor', 'Done', 'Repair', 4, sched=-15, done=-15, price=410),
        visit('New furnace install', 'Scheduled', 'Install', 5, sched=16, price=5800),
        visit('Filter change', 'Done', 'Filter change', 6, sched=-88, done=-88, price=35),
        visit('AC tune-up – Rahman', 'Done', 'Tune-up', 7, sched=-150, done=-150, price=129),
    ]
    vrecs, vprops = split_visits(pairs)
    systems = {
        'key': 'systems', 'name': 'Systems', 'description': 'Furnaces, air conditioners and heat pumps at each property', 'kind': 'thing',
        'vocab': {'record': {'one': 'system', 'many': 'systems', 'article': 'a'}},
        'columns': [
            col('System', 'text', 0, 220, is_name_column=1, is_identifier=1, is_required=1, description='e.g. "Dubois – furnace"'),
            dropdown('Type', 1, 140, ['Furnace', 'Air conditioner', 'Heat pump', 'Boiler', 'Mini-split', 'Water heater']),
            col('Make and model', 'text', 2, 180),
            col('Installed', 'date', 3, 140),
            date_col('Warranty ends', 4, 'Warranty', 'Parts or labor warranty end date'),
            dropdown('Refrigerant', 5, 120, ['R-410A', 'R-32', 'R-454B', 'R-22', 'None']),
            col('Notes', 'notes', 6, 220),
        ],
        'alertRules': [expires('Warranty', 'The date entered is when the warranty runs out', T60)],
        'links': [{'to': 'properties', 'label_forward': 'Property', 'label_backward': 'Systems', 'cardinality': 'many_to_one'}],
    }
    techs = {
        'key': 'technicians', 'name': 'Technicians', 'description': 'Your techs, with licenses and certifications', 'kind': 'person',
        'vocab': {'record': {'one': 'technician', 'many': 'technicians', 'article': 'a'}},
        'columns': [
            col('Name', 'text', 0, 180, is_name_column=1, is_identifier=1, is_required=1),
            col('Phone', 'phone', 1, 140),
            dropdown('EPA 608 certification', 2, 170, ['Type I', 'Type II', 'Type III', 'Universal'], is_required=1, description='Does not expire, but you need it on file'),
            date_col('State license expires', 3, 'Expires (60 days ahead)'),
            date_col("Driver's license expires", 4, 'Expires (60 days ahead)'),
            date_col('Last safety training', 5, 'Every year'),
        ],
        'alertRules': [expires('Expires (60 days ahead)', 'The date entered is when it runs out; warns 60 days ahead', T60),
                       every_months('Every year', 12, 'Due on the same date a year later', T60)],
    }
    PLAN = ['Maintenance agreement', 'Pay per visit', 'Maintenance agreement', 'Maintenance agreement', 'Pay per visit', 'Pay per visit', 'Maintenance agreement', 'Maintenance agreement']
    AC = [-150, None, -520, -160, -150, None, -170, -150]
    FURN = [-340, -400, -360, -350, None, None, -20, -345]
    FILT = [-80, -120, -95, -40, None, None, -88, -10]
    SIZE = ['16x25x1', '20x25x4', '16x20x1', '20x20x2', None, None, '14x25x1', '16x25x1']
    props_recs = []
    for i in range(8):
        r = prop_base(i, PLAN[i])
        if AC[i] is not None: r['AC tune-up'] = d(AC[i])
        if FURN[i] is not None: r['Furnace tune-up'] = d(FURN[i])
        if FILT[i] is not None: r['Filter changed'] = d(FILT[i])
        if SIZE[i]: r['Filter size'] = SIZE[i]
        props_recs.append(r)
    sys_recs = [
        {'System': 'Dubois – furnace', 'Type': 'Furnace', 'Make and model': 'Carrier 59SC5', 'Installed': d(-2900), 'Warranty ends': d(-10), 'Refrigerant': 'None'},
        {'System': 'Dubois – air conditioner', 'Type': 'Air conditioner', 'Make and model': 'Carrier 24ACC6', 'Installed': d(-2900), 'Warranty ends': d(-10), 'Refrigerant': 'R-410A'},
        {'System': 'Smith – heat pump', 'Type': 'Heat pump', 'Make and model': 'Trane XR15', 'Installed': d(-1500), 'Warranty ends': d(2100), 'Refrigerant': 'R-410A'},
        {'System': 'Wong offices – rooftop unit 1', 'Type': 'Air conditioner', 'Make and model': 'Lennox LGH', 'Installed': d(-3300), 'Warranty ends': d(40), 'Refrigerant': 'R-410A', 'Notes': 'Belt-drive blower; spare belt in the van.'},
        {'System': 'Bell – air conditioner', 'Type': 'Air conditioner', 'Make and model': 'Goodman GSXN4', 'Installed': d(-700), 'Warranty ends': d(3000), 'Refrigerant': 'R-32'},
    ]
    tech_recs = [
        {'Name': 'Marcus Lee', 'Phone': '555-0170', 'EPA 608 certification': 'Universal', 'State license expires': d(28), "Driver's license expires": d(900), 'Last safety training': d(-300)},
        {'Name': 'Ana Torres', 'Phone': '555-0173', 'EPA 608 certification': 'Type II', 'State license expires': d(420), "Driver's license expires": d(-4), 'Last safety training': d(-375)},
        {'Name': 'Devon Price', 'Phone': '555-0176', "Driver's license expires": d(700), 'Last safety training': d(-90)},
    ]
    sv = build_variant(
        'hvac', 'Heating & cooling (HVAC)', 'Maintenance agreements with spring AC and fall furnace tune-ups, filters every 90 days, equipment warranties and tech licenses.',
        props, visits_list(['Tune-up', 'Repair', 'Install', 'Filter change'],
                           checklist=checklist('Furnace tune-up', 'Fall heating check', ['Replace or clean the filter', 'Check the flame sensor and igniter', 'Test the carbon monoxide detector', 'Check the flue and venting', 'Measure temperature rise', 'Note the filter size on the property'])),
        None,
        {'customers': customer_records(), 'properties': props_recs, 'visits': vrecs, 'systems': sys_recs, 'technicians': tech_recs},
        prop_links(8) + visit_links(vprops) + [{'from': f'systems#{s}', 'to': f'properties#{p}', 'link': 'Property'} for s, p in [(0, 0), (1, 0), (2, 1), (3, 3), (4, 4)]],
        [{'record': 'visits#1', 'type': 'call', 'daysAgo': 0, 'text': 'Upstairs stays at 60 degrees. Booked for this afternoon.'},
         {'record': 'visits#4', 'type': 'note', 'daysAgo': 15, 'text': 'Replaced the fan motor and capacitor. Running fine.'},
         {'record': 'properties#3', 'type': 'call', 'daysAgo': 5, 'text': 'Office manager asked for the rooftop units before the cold snap.'}],
        [stage_history('visits#5', [('Requested', 20), ('Scheduled', 12)])],
        [appt('visits#1', 'No heat upstairs', 0, '14:00', 90, location=STREETS[1]), appt('visits#0', 'Furnace tune-up', 2, '09:00', 60, location=STREETS[0]),
         appt('visits#5', 'Furnace install', 16, '08:00', 480, location=STREETS[5]), appt('visits#3', 'Rooftop units', -2, '07:00', 240, location=STREETS[3], status='scheduled')])
    sv['lists'] = sv['lists'] + [systems, techs]
    return sv

# ── Pool service ─────────────────────────────────────────────────────────────

def pool():
    props = properties_list(
        ['Weekly service', 'Every 2 weeks', 'Opening and closing only'],
        [dropdown('Pool type', 0, 130, ['Chlorine', 'Salt', 'Spa / hot tub']),
         col('Gallons', 'number', 0, 110),
         col('Pump and filter', 'text', 0, 180, description='Make and model, filter type'),
         date_col('Opened', 0, 'Opening', 'Date the pool was opened; due again each May'),
         date_col('Closed', 0, 'Closing', 'Date the pool was closed; due again each September'),
         date_col('Filter cleaned', 0, 'Every 3 months', 'Date the filter was last cleaned')],
        [calendar('Opening', [5], 25, 'Open by Memorial Day weekend', lead=45),
         calendar('Closing', [9], 30, 'Close by the end of September', lead=45),
         every_months('Every 3 months', 3, 'Due 3 months after the date entered', T7)],
        'Pools and spas you look after')
    pairs = [
        visit('Weekly service – Dubois', 'Scheduled', 'Weekly cleaning', 0, sched=1, price=55),
        visit('Weekly service – Smith', 'Scheduled', 'Weekly cleaning', 1, sched=1, price=55),
        visit('Weekly service – Bell', 'Scheduled', 'Weekly cleaning', 4, sched=2, price=60),
        visit('Close the pool', 'Scheduled', 'Closing', 2, sched=-3, price=275),
        visit('Pump making noise', 'Requested', 'Repair', 5),
        visit('Green pool cleanup', 'Done', 'Green pool cleanup', 6, sched=-12, done=-12, price=350),
        visit('Close the pool', 'Scheduled', 'Closing', 7, sched=9, price=275),
        visit('Salt cell cleaning', 'Done', 'Repair', 3, sched=-25, done=-25, price=90),
    ]
    vrecs, vprops = split_visits(pairs)
    for r, p in pairs:
        if r['Stage'] == 'Done':
            r['Free chlorine (ppm)'] = 3; r['pH'] = 7.5
    PLAN = ['Weekly service', 'Weekly service', 'Opening and closing only', 'Every 2 weeks', 'Weekly service', 'Every 2 weeks', 'Weekly service', 'Opening and closing only']
    TYPE = ['Chlorine', 'Salt', 'Chlorine', 'Salt', 'Chlorine', 'Spa / hot tub', 'Chlorine', 'Chlorine']
    OPENED = [-140, -135, -150, -500, -130, None, -138, -142]
    CLOSED = [-380, -375, -390, -400, None, None, -385, -12]
    FILTER = [-70, -100, None, -85, -40, -200, -88, -30]
    props_recs = []
    for i in range(8):
        r = prop_base(i, PLAN[i]); r['Pool type'] = TYPE[i]; r['Gallons'] = [18000, 22000, 15000, 30000, 20000, 450, 16000, 25000][i]
        if OPENED[i] is not None: r['Opened'] = d(OPENED[i])
        if CLOSED[i] is not None: r['Closed'] = d(CLOSED[i])
        if FILTER[i] is not None: r['Filter cleaned'] = d(FILTER[i])
        if i in (0, 3): r['Pump and filter'] = ['Hayward Super Pump, cartridge filter', 'Pentair variable-speed, sand filter'][i // 3]
        props_recs.append(r)
    visits = visits_list(['Weekly cleaning', 'Opening', 'Closing', 'Repair', 'Green pool cleanup'],
                         extra_cols=[col('Free chlorine (ppm)', 'number', 0, 150), col('pH', 'number', 0, 90)],
                         checklist=checklist('Weekly service', 'Every stop on the route', ['Skim and empty baskets', 'Brush walls and steps', 'Vacuum', 'Test chlorine and pH, and balance', 'Check pump pressure', 'Close and lock the gate']))
    return build_variant(
        'pool-service', 'Pool service', 'Weekly route visits, opening and closing each season, filter cleaning and water readings.',
        props, visits, None,
        {'customers': customer_records(), 'properties': props_recs, 'visits': vrecs},
        prop_links(8) + visit_links(vprops),
        [{'record': 'visits#5', 'type': 'note', 'daysAgo': 12, 'text': 'Shocked twice and ran the filter 48 hours. Clear now.'},
         {'record': 'visits#4', 'type': 'call', 'daysAgo': 1, 'text': 'Grinding noise from the pump since the weekend.'},
         {'record': 'properties#7', 'type': 'on_site', 'daysAgo': 12, 'text': 'Pool closed; cover on and lines blown out.'}],
        [stage_history('visits#3', [('Requested', 14), ('Scheduled', 10)])],
        [route(0, 'Pool – Dubois', 1, '08:00', 10, 40), route(1, 'Pool – Smith', 1, '09:00', 10, 40), route(4, 'Pool – Bell', 2, '08:30', 10, 45),
         appt('visits#4', 'Look at the pump', 3, '13:00', 60, location=STREETS[5]), appt('visits#6', 'Close the pool', 9, '10:00', 180, location=STREETS[7])])

# ── Chimney, gutters & windows ───────────────────────────────────────────────

def chimney():
    props = properties_list(
        ['Yearly', 'Twice a year', 'One-time'],
        [col('Stories', 'number', 0, 90, description='For ladders and gutter length'),
         date_col('Last chimney sweep', 0, 'Every year', 'Date of the last sweep; due again a year later'),
         date_col('Gutters cleaned', 0, 'Spring and fall', 'Date the gutters were last cleaned; due each May and November'),
         date_col('Windows washed', 0, 'Every year'),
         date_col('Dryer vent cleaned', 0, 'Every year')],
        [every_months('Every year', 12, 'Due on the same date a year later', T30),
         calendar('Spring and fall', [5, 11], 15, 'Gutter cleaning in mid-May and mid-November', lead=45)],
        'Homes you service, with sweeps, gutters and windows due')
    pairs = [
        visit('Chimney sweep – Dubois', 'Scheduled', 'Chimney sweep', 0, sched=0, price=189),
        visit('Gutters front and back', 'Scheduled', 'Gutter cleaning', 1, sched=4, price=160),
        visit('Smoke coming into the room', 'Requested', 'Chimney inspection', 2),
        visit('Windows inside and out', 'Scheduled', 'Window washing', 3, sched=-4, price=420),
        visit('Chimney cap replacement', 'Done', 'Repair', 4, sched=-9, done=-9, price=275),
        visit('Dryer vent cleaning', 'Done', 'Dryer vent', 5, sched=-30, done=-30, price=110),
        visit('Gutters and downspouts', 'Scheduled', 'Gutter cleaning', 6, sched=20, price=180),
        visit('Chimney sweep – Rahman', 'Cancelled', 'Chimney sweep', 7, sched=-6),
    ]
    vrecs, vprops = split_visits(pairs)
    PLAN = ['Yearly', 'Twice a year', 'One-time', 'Twice a year', 'Yearly', 'Yearly', 'Twice a year', 'Yearly']
    SWEEP = [-370, None, -700, None, -9, -200, None, -355]
    GUTTER = [-330, -150, None, -160, -140, None, -150, -200]
    WINDOWS = [-200, None, None, -370, None, -100, -345, None]
    DRYER = [None, -380, None, None, -60, -30, None, -300]
    props_recs = []
    for i in range(8):
        r = prop_base(i, PLAN[i]); r['Stories'] = [2, 1, 2, 3, 2, 1, 2, 2][i]
        if SWEEP[i] is not None: r['Last chimney sweep'] = d(SWEEP[i])
        if GUTTER[i] is not None: r['Gutters cleaned'] = d(GUTTER[i])
        if WINDOWS[i] is not None: r['Windows washed'] = d(WINDOWS[i])
        if DRYER[i] is not None: r['Dryer vent cleaned'] = d(DRYER[i])
        props_recs.append(r)
    return build_variant(
        'chimney-gutters-windows', 'Chimney, gutters & windows', 'Yearly chimney sweeps, gutter cleaning each spring and fall, window washing and dryer vents.',
        props, visits_list(['Chimney sweep', 'Chimney inspection', 'Gutter cleaning', 'Window washing', 'Dryer vent', 'Repair'],
                           checklist=checklist('Chimney sweep', 'Every sweep', ['Drop cloths down and fireplace sealed', 'Sweep the flue', 'Check the cap, crown and flashing', 'Photograph anything that needs repair', 'Leave the inspection report'])),
        None,
        {'customers': customer_records(), 'properties': props_recs, 'visits': vrecs},
        prop_links(8) + visit_links(vprops),
        [{'record': 'visits#2', 'type': 'call', 'daysAgo': 1, 'text': 'Smoke rolls into the room when the fire is going. Wants an inspection before using it again.'},
         {'record': 'visits#4', 'type': 'note', 'daysAgo': 9, 'text': 'New stainless cap installed; photos in Files.'},
         {'record': 'properties#0', 'type': 'on_site', 'daysAgo': 370, 'text': 'Light creosote; good for a year.'}],
        [stage_history('visits#1', [('Requested', 8), ('Scheduled', 5)])],
        [appt('visits#0', 'Chimney sweep', 0, '10:00', 90, location=STREETS[0]), appt('visits#2', 'Chimney inspection', 1, '13:00', 60, location=STREETS[2]),
         appt('visits#1', 'Gutters', 4, '09:00', 120, location=STREETS[1]), appt('visits#6', 'Gutters and downspouts', 20, '09:00', 150, location=STREETS[6])])

starter = {
    'pulse_template': '2.0', 'type': 'workspace', 'id': 'home-services', 'name': 'Home services',
    'description': 'For lawn care, pest control, heating and cooling, pool service, and chimney, gutter and window businesses: customers, their properties, visits on a board, seasonal and repeating service dates, and weekly routes on the calendar.',
    'icon': 'house', 'group': 'Trades and service',
    'vocab': {'record': {'one': 'record', 'many': 'records', 'article': 'a'}, 'list': {'one': 'list', 'many': 'lists', 'article': 'a'}, 'activity': {'one': 'note', 'many': 'notes', 'article': 'a'}},
    'suggestedFeatures': {'personFields': False, 'priority': False, 'contactsDirectory': False, 'requirements': False, 'timeTracking': False, 'mileage': False,
                          'snippets': True, 'checklists': True, 'tasks': True, 'focusMode': False, 'letters': True, 'summaryReport': True, 'handoff': False,
                          'links': True, 'stages': True, 'measures': False, 'appointments': True, 'forms': True, 'attachments': True},
    'activityTypes': [
        {'key': 'note', 'label': 'Note', 'icon': '📝', 'color': 'slate'},
        {'key': 'call', 'label': 'Call', 'icon': '📞', 'color': 'blue'},
        {'key': 'text', 'label': 'Text', 'icon': '💬', 'color': 'teal'},
        {'key': 'on_site', 'label': 'On site', 'icon': '🏠', 'color': 'green'},
    ],
    'documentTemplates': [
        {'name': 'Seasonal service reminder', 'content': '{{today}}\n\nHi {{linked:Customer.Name}},\n\nIt is that time of year again for {{name}}. Give us a call or reply to this letter and we will get you on the schedule.\n\nThanks,\n\n{{my_name}}'},
    ],
    'helpTips': [
        {'title': 'Seasonal dates', 'body': 'For seasonal work like tune-ups, openings and gutter cleaning, enter the date you last did it. Pulse shows the next one when the season comes around.'},
        {'title': 'Weekly routes', 'body': 'Put each route stop on the calendar as a weekly appointment. Pick a day for each area of town, and the calendar becomes your route sheet.'},
        {'title': 'Visits', 'body': 'Move a visit to Done and Pulse fills in the date. Visits that are done or cancelled stop showing as due.'},
        {'title': 'Photos', 'body': 'Drop before-and-after photos or signed work orders into Files on the visit. They are stored encrypted inside Pulse.'},
    ],
    'variantQuestion': 'What kind of service do you run?',
    'variants': [lawn(), pest(), hvac(), pool(), chimney()],
    'dashboardCards': ['summary', 'today', 'stages', 'missingInfo'],
}

json.dump(starter, open(sys.argv[1], 'w'), indent=2, ensure_ascii=False)
open(sys.argv[1], 'a').write('\n')
print('written')
