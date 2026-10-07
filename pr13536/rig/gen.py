#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13536): differential corpus for the schedule and automation_run bodies.
# Seeds = every fixture case / successor pair materialized with the fixture tests' deep merge; then
# single-point mutations at every path x a value pool (incl. cron / timezone / slot / occurrence
# grammars), raw numeric spellings, random multi-point mutations, and cross-pairs of valid bodies.
# Output JSONL rows {"id","op":"one"|"pair","domain","a":<json text>,"b":<json text>|null}
import json, random, sys, copy, itertools, os, re
random.seed(int(sys.argv[2]) if len(sys.argv) > 2 else 13536)
FIX = os.environ.get('FIXDIR', '/Users/wenshao/git/pr13536-head/packages/core/src/managed-runtime/contracts/')
fx = json.load(open(FIX + 'managed-automation-record-v1.fixtures.json'))

def merge(base, patch):
    value = copy.deepcopy(base if base is not None else {})
    for k, r in patch.items():
        if r is not None and isinstance(r, dict):
            value[k] = merge(value.get(k) if isinstance(value.get(k), dict) else {}, r)
        else:
            value[k] = r
    return value

seeds_one, seeds_pair = [], []
for c in fx['cases']:
    seeds_one.append((c['domain'], merge(fx['templates'][c['domain']], c['patch']), c['valid']))
for s in fx['successors']:
    t = fx['templates'][s['domain']]
    b = merge(t, s['before']); a = merge(t, s['after'])
    seeds_pair.append((s['domain'], b, a))

D64 = 'a' * 64
CRONS = ['0 9 * * 1-5', '* * * * *', '*/1 * * * *', '*/59 * * * *', '0-59 * * * *', '59 23 31 12 7',
         '0 0 1 1 0', '00 09 * * 1-5', '0000000005 * * * *', '9999999999 * * * *', '1-5/2 * * * *',
         '5/10 * * * *', '*/7 * * * */7', '* * * * */8', '* * */31 * *', '* * */32 * *', '* * 0 * *',
         '* * * 0 *', '* * * 13 *', '* * * * 8', '1,2,3 * * * *', '1,,2 * * * *', ',1 * * * *',
         '1, * * * *', '1-2-3 * * * *', '*-5 * * * *', '5-* * * * *', '*/ * * * *', '/5 * * * *',
         '1// * * * *', '1/2/3 * * * *', '0  9 * * 1-5', ' 0 9 * * 1-5', '0 9 * * 1-5 ', '0\t9 * * * *',
         '0 9 * * 1-5\n', '@daily', 'H 9 * * *', 'L * * * *', '0 9 ? * MON', '0 9 * * 1#2', '0 9 * * 5L',
         '０ 9 * * *', '٣ 9 * * *', '0 9 * * 1–5', '*/0010 * * * *', '-1 * * * *', '1-1 * * * *',
         '2-1 * * * *', '0-0 * * * *', '* * * * 0-7', '* * * * 7-7', '*' * 64 + ' * * * *',
         ('1,' * 40)[:-1] + ' * * * *', '*' * 65 + ' * * * *', '5 4 3 2 1']
TZS = ['UTC', 'Etc/GMT+8', 'Etc/GMT-14', 'GMT', 'Z', 'a', 'A' * 64, 'A' * 65, 'a/b/c', 'a/b/c/d', 'a//b',
       '/a', 'a/', '1abc', '_a', '+a', 'Asia/Shanghai', 'asia/shanghai', 'America/Argentina/Buenos_Aires',
       'America/Argentina/Buenos_Aires/X', 'Mars/Olympus', 'Mars/Olympus Mons', 'UTC\n', 'UTC ', ' UTC',
       'Europe/Kyiv', 'EST5EDT', 'Etc/UTC', 'a/' + 'b' * 64, 'a/' + 'b' * 65, 'Ä/x', 'a.b', 'a/b.c', 'CET']
SLOTS = ['2026-10-06T01:00:00Z', '0000-01-01T00:00:00Z', '0001-01-01T00:00:00Z', '9999-12-31T23:59:59Z',
         '1970-01-01T00:00:00Z', '2026-02-29T00:00:00Z', '2028-02-29T00:00:00Z', '1900-02-29T00:00:00Z',
         '2000-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-13-01T00:00:00Z', '2026-00-01T00:00:00Z',
         '2026-01-00T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T23:60:00Z', '2026-06-30T23:59:60Z',
         '2016-12-31T23:59:60Z', '2026-1-01T00:00:00Z', '2026-01-01t00:00:00Z', '2026-01-01T00:00:00z',
         '2026-01-01 00:00:00Z', '2026-01-01T00:00Z', '+2026-01-01T00:00:00Z', '-0001-01-01T00:00:00Z',
         '2026-10-06T01:00:00.0Z', '2026-10-06T01:00:00,000Z', '2026-10-06T01:00:00+00:00',
         '2026-10-06T01:00:00Z\n', '٢٠٢٦-10-06T01:00:00Z', '2026-10-06T01:00:00UTC', '10000-01-01T00:00:00Z']
OKEYS = (['schedule:' + s for s in SLOTS] +
         ['manual:command-1', 'manual:', 'manual:a', 'manual:' + 'x' * 512, 'manual:' + 'x' * 513,
          'manual: a', 'manual:a b', 'manual:a:b', 'manual:é', 'manual:é', 'manual:\ud800',
          'manual:a/b', 'manual:..', 'manual:.', 'webhook:event-1', 'webhook:', 'webhook', 'Webhook:x',
          'schedule', 'schedule:', 'Schedule:2026-10-06T01:00:00Z', 'manual', ':x', '', 'timer:x',
          'schedule:2026-10-06T01:00:00Z:extra', ' schedule:2026-10-06T01:00:00Z', 'x' * 4097])
POOL = [None, True, False, 0, 1, -1, 2, 3, 4, 1.5, 2 ** 53, 2 ** 53 - 2, 2 ** 53 - 1, 2 ** 53 + 2, '', 'a',
        '1', 'x' * 513, 'x' * 4096, 'x' * 4097, 'é' * 2048, 'é' * 2049, '\ud800', '\udc00', 'a\u0000b',
        'a\u007fb', 'a\u0085b', 'a\u009fb', 'a b', 'a b', 'a​b', 'a‮b', 'a﻿b',
        ' a', 'a b', D64, D64.upper(), 'g' * 64, 'a' * 63,
        'skip', 'queue_one', 'allow', 'none', 'latest', 'bounded', 'persistent', 'per_run', 'schedule',
        'automation_run', 'planned', 'sending', 'unknown', 'delivered', 'failed', 'cancelled', 'settled',
        'running', 'waiting', 'reserved', 'admitted', 'recovery_blocked', 'intent', 'dispatch_started',
        'running_attached', 'not_started_proven', 'outcome_unknown', 'session', 'channel',
        'session-1', 'session-2', 'schedule-1', 'run-1', 'claim-1', 'effect-1', 'delivery-1',
        {}, [], [1],
        {'resourceId': 'prompt-1', 'kind': 'managed-publication', 'schemaVersion': 1, 'byteLength': 2, 'digest': '6' * 64},
        {'resourceId': 'prompt-2', 'kind': 'managed-input', 'schemaVersion': 1, 'byteLength': 0, 'digest': D64},
        {'definitionId': 'schedule-1', 'definitionRevision': 3, 'definitionDigest': 'e' * 64},
        {'runtimeBindingId': 'binding-1', 'generation': '1'},
        {'target': 'channel', 'state': 'planned'}, {'target': 'channel', 'state': 'sending'},
        {'target': 'channel', 'state': 'delivered'}, {'target': 'session', 'state': 'planned'},
        {'kind': 'quota', 'code': 'start_failed'}] + CRONS + TZS + OKEYS
RAW_NUMS = ['1.0', '1e0', '10E-1', '3.0', '3e0', '1.0000000000000001', '2.9999999999999999', '-0', '1E2',
            '9007199254740990', '9007199254740990.0', '9007199254740991', '9.00719925474099e15']

def paths(v, prefix=()):
    yield prefix
    if isinstance(v, dict):
        for k in v:
            yield from paths(v[k], prefix + (k,))
def get(v, p):
    for k in p: v = v[k]
    return v
def setp(v, p, x):
    v = copy.deepcopy(v)
    if not p: return x
    cur = v
    for k in p[:-1]: cur = cur[k]
    cur[p[-1]] = x
    return v
def delp(v, p):
    v = copy.deepcopy(v); cur = v
    for k in p[:-1]: cur = cur[k]
    del cur[p[-1]]
    return v
RAWMARK = '\u0001RAW:'
def dumps(v):
    s = json.dumps(v, ensure_ascii=True, separators=(',', ':'))
    return re.sub(r'"\\u0001RAW:([^"]*)"', lambda m: m.group(1), s)

def single_mutations(body):
    out = []
    for p in paths(body):
        if not p: continue
        out.append(delp(body, p))
        for x in POOL: out.append(setp(body, p, x))
        cur = get(body, p)
        if isinstance(cur, (int, float)) and not isinstance(cur, bool):
            for r in RAW_NUMS: out.append(setp(body, p, RAWMARK + r))
    for p in paths(body):
        if isinstance(get(body, p), dict): out.append(setp(body, p + ('zz',), 1))
    return out

def rand_mutation(body, k):
    v = body
    for _ in range(k):
        ps = [p for p in paths(v) if p]
        p = random.choice(ps); r = random.random()
        try:
            if r < 0.15: v = delp(v, p)
            elif r < 0.25 and isinstance(get(v, p), (int, float)) and not isinstance(get(v, p), bool):
                v = setp(v, p, RAWMARK + random.choice(RAW_NUMS))
            else: v = setp(v, p, copy.deepcopy(random.choice(POOL)))
        except Exception: pass
    return v

def rand_cron():
    def atom():
        r = random.random()
        base = random.choice(['*', str(random.randint(0, 70)), f'{random.randint(0, 40)}-{random.randint(0, 40)}', ''])
        if r < 0.4: base += '/' + random.choice([str(random.randint(0, 70)), '', '0' + str(random.randint(0, 9))])
        return base
    def field(): return ','.join(atom() for _ in range(random.choice([1, 1, 1, 2, 3])))
    return ' '.join(field() for _ in range(random.choice([5, 5, 5, 5, 4, 6])))

rows = []
def emit(op, domain, a, b=None):
    rows.append({'id': f'c{len(rows)}', 'op': op, 'domain': domain, 'a': dumps(a), 'b': None if b is None else dumps(b)})

for d, body, _ in seeds_one:
    emit('one', d, body)
    for m in single_mutations(body): emit('one', d, m)
    for _ in range(60): emit('one', d, rand_mutation(body, random.choice([2, 2, 3, 4])))
# grammar sweeps on the templates
st, at = fx['templates']['schedule'], fx['templates']['automation_run']
for _ in range(20000): emit('one', 'schedule', setp(st, ('cron',), rand_cron()))
for y in [0, 1, 1900, 1970, 2000, 2024, 2026, 2100, 9999]:
    for mo in range(0, 14):
        for dd in [0, 1, 28, 29, 30, 31, 32]:
            for hms in ['00:00:00', '23:59:59', '24:00:00', '23:59:60', '12:60:00']:
                emit('one', 'automation_run', setp(at, ('occurrenceKey',), f'schedule:{y:04d}-{mo:02d}-{dd:02d}T{hms}Z'))
valid_by_dom = {}
for d, body, ok in seeds_one:
    if ok: valid_by_dom.setdefault(d, []).append(body)
for d, b, a in seeds_pair:
    emit('pair', d, b, a)
    for m in single_mutations(a): emit('pair', d, b, m)
    sm = single_mutations(b)
    for m in random.sample(sm, min(200, len(sm))): emit('pair', d, m, a)
    for _ in range(40): emit('pair', d, b, rand_mutation(a, random.choice([1, 2, 3])))
for d, bodies in valid_by_dom.items():
    for x, y in itertools.product(bodies, bodies): emit('pair', d, x, y)
    for x, y in itertools.product(bodies, bodies):
        y2 = copy.deepcopy(y)
        if 'definitionRevision' in x and isinstance(x['definitionRevision'], int):
            y2['definitionRevision'] = x['definitionRevision'] + 1
        emit('pair', d, x, y2)
    for _ in range(3000):
        x, y = random.choice(bodies), random.choice(bodies)
        emit('pair', d, x, rand_mutation(y, 1))
out = open(sys.argv[1], 'w')
for r in rows: out.write(json.dumps(r, ensure_ascii=True) + '\n')
print(len(rows), 'rows;', sum(1 for r in rows if r['op'] == 'one'), 'one;', sum(1 for r in rows if r['op'] == 'pair'), 'pair', file=sys.stderr)
