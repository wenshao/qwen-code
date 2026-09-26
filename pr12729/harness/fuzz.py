# Mutational differential fuzz: TS module vs Ajv schema vs the doc-only
# Python reading (docref.py). Seeds are the PR's own fixtures.
import base64, copy, hashlib, json, os, random, subprocess, sys, collections
from docref import *

FX = json.load(open(sys.argv[1]))
N = int(sys.argv[2]) if len(sys.argv) > 2 else 20000
OUT = os.path.dirname(os.path.abspath(__file__))
rnd = random.Random(12729)

H = lambda b: hashlib.sha256(b).hexdigest()
D1, D2 = H(b'a'), H(b'b')
IDS_POOL = ['a', 'tenant-a', '', 'x' * 512, 'x' * 513, 'é' * 256, 'é' * 257, 'é', 'Å',
            '\x00', '\x1f', '\x7f', '\x80', '\x9f', '\ud800', '\udc00', 'a b', ' ', ' ', 'ﬀ',
            '﻿', '\U0001F600' * 128, '\U0001F600' * 129, '"' * 512, 5, None, ['a']]
GEN_POOL = ['1', '3', '0', '01', '9223372036854775807', '9223372036854775808', '+1', '1.0', ' 1',
            '١', '1\n', 1, '', None]
COUNT_POOL = [0, 1, 2, -1, 1.5, '1', True, None, 2**53 - 2, 2**53 - 1, 65535, 65536, 16777216, 16777217,
              262144, 262145, 1024, 1025, 3, 6, 9]
EXIT_POOL = [None, 0, 1, 137, -2**31, -2**31 - 1, 2**32 - 1, 2**32, 1.5, '0', True]
SIG_POOL = [None, 'SIGKILL', 'SIGTERM', 'SIG', 'sigkill', 'SIG' + 'A' * 16, 'SIG' + 'A' * 17, 'KILL', 9, '']
TOKEN_POOL = ['stdout', 'capture-01', 'a', '', 'A', 'x' * 128, 'x' * 129, 'a/b', '.', '..', 'a b', 'a:b',
              'é', 'a\n', 5, None, '-', '_']
MIME_POOL = ['text/plain', 'application/octet-stream', 'text/plain;charset=utf-8', 'Text/plain', 'text',
             'text/', '/plain', '.a/b', 'a/b;\x01', 'a/b;é', 'a/' + 'x' * 253, 'a/' + 'x' * 254, 'a b/c',
             'a/b/c', '', 5, 'image/svg+xml', 'a/b\n']
DIGEST_POOL = [D1, D2, D1.upper(), D1[:63], 'sha256:' + D1, 5, None, '']
ENUMS = {
    'executionStatus': ['success', 'error', 'cancelled', 'unknown', 'not_started', 'SUCCESS', None],
    'captureScope': ['process_pty', 'process_pipes', 'tool_native', 'pty', None],
    'capturePolicy': ['complete_required', 'best_effort', 'required', None],
    'captureStatus': ['pending', 'complete', 'partial', 'unavailable', 'failed', None],
    'captureReason': [None, 'quota_exhausted', 'size_limit', 'producer_lost', 'storage_failed', 'cancelled',
                      'upstream_truncated', ''],
    'role': ['stdout', 'stderr', 'pty', 'result', 'attachment', 'hook', None],
    'state': ['open', 'sealed', 'incomplete', 'closed', None],
    'deliveryStatus': ['pending', 'committed', 'blocked', 'acknowledged', None],
}
BOOL_POOL = [True, False, 'true', 0, None]


def pick(pool):
    return copy.deepcopy(rnd.choice(pool))


def seeds_manifests():
    out = [c['manifest'] for c in FX['manifestCases'] if isinstance(c['manifest'], dict)]
    for c in FX['revisionCases']:
        out += [c['previous'], c['next']]
    for c in FX['pagePositionCases'] + FX['envelopeManifestCases']:
        out.append(c['manifest'])
    return [m for m in out if isinstance(m, dict)]


MSEEDS = seeds_manifests()
VALID_M = [m for m in MSEEDS if ok(manifest, m, unknown_rule=False)]


def mut_pageref(p):
    if not isinstance(p, dict):
        return p
    p = copy.deepcopy(p)
    sc = p['segmentCount'] if is_int(p.get('segmentCount')) else 1
    r = rnd.random()
    if r < 0.3:
        p['segmentCount'] = pick(COUNT_POOL)
    elif r < 0.6:
        p['byteLength'] = pick(COUNT_POOL + [sc * 16777216, sc * 16777216 + 1])
    elif r < 0.8 and isinstance(p.get('ref'), dict):
        f = rnd.choice(['resourceId', 'kind', 'schemaVersion', 'byteLength', 'digest'])
        p['ref'][f] = pick({'resourceId': IDS_POOL, 'kind': [KIND_PAGE, KIND_CONTENT, KIND_MANIFEST, 'x'],
                            'schemaVersion': [1, 2, 0], 'byteLength': COUNT_POOL, 'digest': DIGEST_POOL}[f])
    else:
        p[rnd.choice(['extra', 'ref'])] = None if rnd.random() < .5 else p.get('ref')
    return p


def fixup(m):
    """Make the derived fields consistent so the fuzz also explores accepted cases."""
    if not isinstance(m.get('contents'), list):
        return m
    for d in m['contents']:
        if not isinstance(d, dict):
            continue
        b = d.get('body')
        if rnd.random() < .6 and isinstance(b, dict) and isinstance(b.get('pages'), list):
            try:
                d['byteLength'] = sum(p['byteLength'] for p in b['pages'])
            except Exception:
                pass
        if rnd.random() < .5 and d.get('state') != 'incomplete':
            d['missingRanges'] = []
        if rnd.random() < .5 and d.get('state') == 'incomplete' and is_int(d.get('byteLength')):
            d['missingRanges'] = rnd.choice([[], [{'start': d['byteLength'], 'end': None}],
                                             [{'start': d['byteLength'], 'end': d['byteLength'] + 5}]])
    if rnd.random() < .7:
        try:
            m['captureStatus'] = implied([d for d in m['contents']])
        except Exception:
            pass
    if rnd.random() < .7:
        m['captureReason'] = None if m.get('captureStatus') in ('pending', 'complete') else 'producer_lost'
    return m


def mut_manifest(m):
    if not isinstance(m, dict):
        return m
    m = copy.deepcopy(m)
    for _ in range(rnd.randint(1, 3)):
        r = rnd.random()
        if r < 0.12:
            m[rnd.choice(['tenantId', 'sessionId', 'turnId', 'executionCallId', 'callId', 'invocationDigest'])] = pick(IDS_POOL)
        elif r < 0.17:
            m['bindingGeneration'] = pick(GEN_POOL)
        elif r < 0.21:
            m['revision'] = pick(COUNT_POOL)
        elif r < 0.25:
            m['captureId'] = pick(TOKEN_POOL)
        elif r < 0.40:
            f = rnd.choice(['executionStatus', 'exitCode', 'signal', 'executionStatus'])
            m[f] = pick({'executionStatus': ENUMS['executionStatus'], 'exitCode': EXIT_POOL, 'signal': SIG_POOL}[f])
        elif r < 0.52:
            f = rnd.choice(['captureScope', 'capturePolicy', 'captureStatus', 'captureReason', 'upstreamTruncated'])
            m[f] = pick(BOOL_POOL if f == 'upstreamTruncated' else ENUMS[f])
        elif r < 0.55:
            if rnd.random() < .5:
                m.pop(rnd.choice(list(m)), None)
            else:
                m['extra'] = 1
        elif isinstance(m.get('contents'), list):
            c = m['contents']
            r2 = rnd.random()
            if r2 < 0.1 and c:
                c.pop(rnd.randrange(len(c)))
            elif r2 < 0.2:
                donor = rnd.choice(VALID_M)['contents']
                if donor:
                    c.append(copy.deepcopy(rnd.choice(donor)))
            elif r2 < 0.25 and len(c) > 1:
                rnd.shuffle(c)
            elif c:
                d = rnd.choice(c)
                if not isinstance(d, dict):
                    continue
                f = rnd.choice(['streamId', 'role', 'mimeType', 'state', 'state', 'byteLength', 'digest',
                                'missingRanges', 'body', 'body', 'body'])
                if f == 'streamId':
                    d[f] = pick(TOKEN_POOL + [x.get('streamId') for x in c if isinstance(x, dict)])
                elif f in ('role', 'state'):
                    d[f] = pick(ENUMS[f])
                elif f == 'mimeType':
                    d[f] = pick(MIME_POOL)
                elif f == 'byteLength':
                    d[f] = pick(COUNT_POOL)
                elif f == 'digest':
                    d[f] = pick(DIGEST_POOL)
                elif f == 'missingRanges':
                    bl = d.get('byteLength') if is_int(d.get('byteLength')) else 0
                    d[f] = pick([[], [{'start': bl, 'end': None}], [{'start': bl, 'end': bl + 1}],
                                 [{'start': bl, 'end': bl}], [{'start': bl - 1, 'end': None}],
                                 [{'start': bl + 1, 'end': None}], [{'start': bl}],
                                 [{'start': bl, 'end': None}, {'start': bl, 'end': None}], None, [5]])
                else:
                    b = d.get('body')
                    r3 = rnd.random()
                    if r3 < 0.25:
                        d['body'] = {'ref': {'resourceId': 'content-1', 'kind': rnd.choice([KIND_CONTENT, KIND_PAGE]),
                                             'schemaVersion': rnd.choice([1, 1, 2]),
                                             'byteLength': d.get('byteLength'), 'digest': d.get('digest')}}
                    elif r3 < 0.35:
                        d['body'] = pick([{}, None, {'pages': [], 'ref': None}, {'pages': []}, {'x': 1}])
                    elif isinstance(b, dict) and isinstance(b.get('pages'), list):
                        ps = b['pages']
                        r4 = rnd.random()
                        if r4 < 0.3 and ps:
                            i = rnd.randrange(len(ps))
                            ps[i] = mut_pageref(ps[i])
                        elif r4 < 0.5 and ps:
                            ps.pop()
                        elif r4 < 0.7 and ps:
                            ps.append(copy.deepcopy(ps[-1]))
                        elif r4 < 0.8:
                            b['pages'] = [copy.deepcopy(ps[0])] * rnd.choice([64, 65]) if ps else []
                        else:
                            ps.insert(0, {'ref': {'resourceId': 'p', 'kind': KIND_PAGE, 'schemaVersion': 1,
                                                  'byteLength': 100, 'digest': D1},
                                          'segmentCount': 1, 'byteLength': 7})
    return fixup(m) if rnd.random() < 0.6 else m


def mut_page(p):
    if not isinstance(p, dict):
        return p
    p = copy.deepcopy(p)
    for _ in range(rnd.randint(1, 3)):
        r = rnd.random()
        if r < 0.15:
            p[rnd.choice(['captureId', 'streamId'])] = pick(TOKEN_POOL)
        elif r < 0.35:
            p['firstOrdinal'] = pick(COUNT_POOL + [65535, 65534, 65535 - len(p.get('segments') or [])])
        elif r < 0.5:
            p['offset'] = pick(COUNT_POOL + [2**53 - 3, 2**53 - 2 - 7])
        elif r < 0.55:
            p[rnd.choice(['toolResult', 'type'])] = pick([PROTO, 'page', 'manifest', 'x', None])
        elif r < 0.6:
            p.pop(rnd.choice(list(p)), None) if rnd.random() < .5 else p.__setitem__('extra', 1)
        elif isinstance(p.get('segments'), list):
            s = p['segments']
            r2 = rnd.random()
            if r2 < 0.2 and s:
                s.pop()
            elif r2 < 0.4 and s:
                s.append(copy.deepcopy(s[-1]))
            elif r2 < 0.5 and s:
                p['segments'] = [copy.deepcopy(s[0])] * rnd.choice([1024, 1025])
            elif s:
                seg = rnd.choice(s)
                if isinstance(seg, dict):
                    if rnd.random() < .6:
                        seg['byteLength'] = pick(COUNT_POOL)
                    else:
                        seg['digest'] = pick(DIGEST_POOL)
    return p


def mut_envelope(e):
    if not isinstance(e, dict):
        return e
    e = copy.deepcopy(e)
    for _ in range(rnd.randint(1, 3)):
        r = rnd.random()
        if r < 0.2:
            e['executionStatus'] = pick(ENUMS['executionStatus'])
        elif r < 0.3:
            e['responseParts'] = pick([[], [{'text': 'x'}], None, {}, 'x'])
        elif r < 0.4:
            e['error'] = pick([{'message': 'x'}, {'message': 'x', 'type': 'y'}, {'message': ''}, {'type': 'y'},
                               {'message': 'x', 'type': ''}, {'message': 'x', 'extra': 1}, None, 'x'])
        elif r < 0.45:
            e.pop(rnd.choice(list(e)), None) if rnd.random() < .5 else e.__setitem__('extra', 1)
        else:
            c = e.get('capture')
            if not isinstance(c, dict):
                e['capture'] = pick([None, {'captureStatus': 'complete', 'captureReason': None, 'manifest': None,
                                            'previewTruncated': False, 'deliveryStatus': 'pending'}])
                continue
            f = rnd.choice(['captureStatus', 'captureReason', 'manifest', 'previewTruncated', 'deliveryStatus'])
            if f == 'manifest':
                c[f] = pick([None, {'resourceId': 'manifest-r2', 'kind': KIND_MANIFEST, 'schemaVersion': 1,
                                    'byteLength': rnd.choice([0, 1, 1408, 65536, 65537]), 'digest': D1},
                             {'resourceId': 'm', 'kind': KIND_PAGE, 'schemaVersion': 1, 'byteLength': 5, 'digest': D1},
                             {'resourceId': 'é', 'kind': KIND_MANIFEST, 'schemaVersion': 1, 'byteLength': 5,
                              'digest': D1}])
            elif f == 'previewTruncated':
                c[f] = pick(BOOL_POOL)
            else:
                c[f] = pick(ENUMS[f] + (['pending'] if f == 'captureStatus' else []))
    return e


def mut_successor(a):
    """A next revision derived from `a`, with one or two targeted changes."""
    b = copy.deepcopy(a)
    if is_int(b.get('revision')):
        b['revision'] += 1
    for _ in range(rnd.randint(1, 2)):
        r = rnd.random()
        if r < 0.08:
            b['revision'] = pick([a.get('revision'), (a.get('revision') or 0) + 2, 1])
        elif r < 0.18:
            f = rnd.choice(FIXED)
            b[f] = {'captureScope': 'process_pty', 'capturePolicy': 'best_effort', 'bindingGeneration': '4',
                    'captureId': 'capture-02'}.get(f, 'other')
        elif r < 0.32:
            b['executionStatus'] = pick(['success', 'error', 'cancelled', 'unknown'])
            b['exitCode'], b['signal'] = pick([(None, None), (0, None), (1, None), (None, 'SIGKILL'), (137, None)])
        elif r < 0.38:
            b['upstreamTruncated'] = not a.get('upstreamTruncated')
        elif r < 0.45 and b['contents']:
            b['contents'].pop()
        elif r < 0.52:
            donor = rnd.choice(VALID_M)['contents']
            if donor:
                d = copy.deepcopy(rnd.choice(donor)); d['streamId'] = 'extra-' + str(rnd.randint(0, 9)); d['role'] = 'attachment'
                b['contents'].append(d)
        elif b['contents']:
            i = rnd.randrange(len(b['contents']))
            d = b['contents'][i]
            r2 = rnd.random()
            if r2 < 0.1:
                d['mimeType'] = 'text/x-other'
            elif r2 < 0.2:
                d['state'] = rnd.choice(['sealed', 'incomplete', 'open'])
            elif r2 < 0.3:
                d['digest'] = D2 if d['digest'] != D2 else D1
            elif 'pages' in d['body']:
                ps = d['body']['pages']
                r3 = rnd.random()
                if r3 < 0.3:
                    ps.append({'ref': {'resourceId': 'page-new', 'kind': KIND_PAGE, 'schemaVersion': 1,
                                       'byteLength': 200, 'digest': D2}, 'segmentCount': 2, 'byteLength': 10})
                elif r3 < 0.55 and ps:
                    last = ps[-1]; last['segmentCount'] = min(1024, last['segmentCount'] + rnd.choice([-1, 0, 1]))
                    last['byteLength'] = max(last['segmentCount'], last['byteLength'] + rnd.choice([-1, 0, 5]))
                    last['ref']['resourceId'] = 'page-replaced'
                elif r3 < 0.75 and len(ps) > 1:
                    j = rnd.randrange(len(ps) - 1); ps[j]['ref']['resourceId'] = 'page-rewritten'
                elif ps:
                    ps.pop()
                d['byteLength'] = sum(p['byteLength'] for p in ps)
                if rnd.random() < .5:
                    d['digest'] = D2
            if d['state'] == 'incomplete':
                d['missingRanges'] = [] if rnd.random() < .5 else [{'start': d['byteLength'], 'end': None}]
            else:
                d['missingRanges'] = []
    if rnd.random() < .8:
        b['captureStatus'] = implied(b['contents'])
        b['captureReason'] = None if b['captureStatus'] in ('pending', 'complete') else 'producer_lost'
    return b


def gen_ledger():
    steps = []
    streams = [('capture-01', 'stdout'), ('capture-01', 'stderr'), ('capture-02', 'stdout')]
    pool = [b'a', b'b', b'ab', b'\x00', b'hello', b'\xff\xfe']
    for _ in range(rnd.randint(3, 16)):
        cid, sid = rnd.choice(streams)
        op = rnd.choices(['publish', 'seal', 'prefix'], [6, 3, 2])[0]
        if op == 'publish':
            b = rnd.choice(pool)
            q = {'captureId': cid, 'streamId': sid, 'ordinal': rnd.choice([0, 0, 1, 1, 2, 3, 65535, 65536, -1, 1.5]),
                 'bytes': {'__b64': base64.b64encode(b).decode()}}
            r = rnd.random()
            if r < .3:
                q['digest'] = H(b)
            elif r < .4:
                q['digest'] = H(b + b'x')
            elif r < .45:
                q['digest'] = H(b).upper()
            if rnd.random() < .04:
                q['bytes'] = rnd.choice([{'__b64': ''}, {'__str': 'abc'}, None])
            if rnd.random() < .03:
                q['captureId'] = rnd.choice(['A', '', 'a/b'])
            if rnd.random() < .02:
                q['extra'] = 1
        elif op == 'seal':
            n = rnd.choice([0, 1, 2, 3, 4, 65536, 65537, -1])
            data_guess = b''.join(rnd.choice(pool) for _ in range(max(0, min(n, 4))))
            q = {'captureId': cid, 'streamId': sid, 'segmentCount': n,
                 'byteLength': rnd.choice([len(data_guess), 0, 1, 2, 3, 4, 5]), 'digest': rnd.choice([H(data_guess), H(b''), H(b'a'), H(b'ab'), H(b'aa'), H(b'ba')])}
            if rnd.random() < .03:
                q.pop('digest')
        else:
            q = {'captureId': cid, 'streamId': sid}
            if rnd.random() < .05:
                q['streamId'] = 'UPPER'
        steps.append({'op': op, 'q': q})
    return steps


def py_ledger(steps):
    L = Ledger(); out = []
    for st in steps:
        q = copy.deepcopy(st['q'])
        if st['op'] == 'publish' and isinstance(q, dict):
            b = q.get('bytes')
            if isinstance(b, dict) and '__b64' in b:
                q['bytes'] = base64.b64decode(b['__b64'])
            elif isinstance(b, dict) and '__str' in b:
                q['bytes'] = b['__str']
        out.append(getattr(L, st['op'])(q))
    return out


def build():
    cases = []
    ENV = [c['result'] for c in FX['envelopeCases'] if isinstance(c['result'], dict)]
    PAGES = [c['page'] for c in FX['pageCases'] if c.get('repeatSegments') is None and isinstance(c['page'], dict)] + FX['pages']
    PENDING = [m for m in VALID_M if m['captureStatus'] == 'pending']
    for c in FX['revisionCases']:
        if ok(manifest, c['previous'], unknown_rule=False) and c['previous']['captureStatus'] == 'pending':
            PENDING.append(c['previous'])
    for _ in range(N):
        cases.append(('manifest', mut_manifest(rnd.choice(MSEEDS))))
    for _ in range(N // 3):
        cases.append(('page', mut_page(rnd.choice(PAGES))))
    for _ in range(N // 3):
        cases.append(('envelope', mut_envelope(rnd.choice(ENV))))
    for _ in range(N):
        a = rnd.choice(PENDING + VALID_M[:5])
        cases.append(('revision', {'a': a, 'b': mut_successor(a)}))
    for _ in range(N // 4):
        a = rnd.choice(PAGES)
        b = copy.deepcopy(a)
        if isinstance(b.get('segments'), list) and rnd.random() < .7:
            b['segments'] = b['segments'] + [{'byteLength': 3, 'digest': D1}] * rnd.randint(0, 2)
        cases.append(('pageRevision', {'a': a, 'b': mut_page(b) if rnd.random() < .5 else b}))
    for _ in range(N // 4):
        c = rnd.choice(FX['pagePositionCases'])
        cases.append(('pageAt', {'m': mut_manifest(c['manifest']) if rnd.random() < .15 else c['manifest'],
                                 'si': rnd.choice([c['streamIndex'], 0, 1, -1]),
                                 'pi': rnd.choice([c['pageIndex'], 0, 1, 2, -1]),
                                 'p': mut_page(c['page']) if rnd.random() < .3 else c['page']}))
    for _ in range(N // 4):
        c = rnd.choice(FX['envelopeManifestCases'])
        cases.append(('envelopeOf', {'r': mut_envelope(c['result']) if rnd.random() < .5 else c['result'],
                                     'm': mut_manifest(c['manifest']) if rnd.random() < .5 else c['manifest']}))
    for _ in range(N // 4):
        cases.append(('ledger', gen_ledger()))
    return cases


def py_verdict(k, v):
    if k == 'manifest':
        return {'doc': ok(manifest, v), 'docNoUnknownRule': ok(manifest, v, unknown_rule=False)}
    if k == 'page':
        return {'doc': ok(page, v)}
    if k == 'envelope':
        return {'doc': ok(envelope, v)}
    if k == 'revision':
        return {'doc': successor(v['a'], v['b']), 'docNoUnknownRule': successor(v['a'], v['b'], unknown_rule=False)}
    if k == 'pageRevision':
        return {'doc': page_successor(v['a'], v['b'])}
    if k == 'pageAt':
        return {'doc': page_at(v['m'], v['si'], v['pi'], v['p'])}
    if k == 'envelopeOf':
        return {'doc': envelope_of(v['r'], v['m'])}
    if k == 'ledger':
        return {'doc': py_ledger(v)}


cases = build()
inp = os.path.join(OUT, 'fuzz-in.jsonl'); outp = os.path.join(OUT, 'fuzz-out.jsonl')
with open(inp, 'w') as f:
    for k, v in cases:
        f.write(json.dumps({'k': k, 'v': v}) + '\n')
subprocess.run(['node', os.path.join(OUT, 'eval.mjs'), outp, inp], check=True)
ts = [json.loads(l) for l in open(outp)]
assert len(ts) == len(cases)
stats = collections.defaultdict(collections.Counter)
loose = collections.defaultdict(collections.Counter)
looseEx = {}
examples = collections.defaultdict(list)
for (k, v), t in zip(cases, ts):
    p = py_verdict(k, v)
    s = stats[k]; s['n'] += 1
    if k == 'ledger':
        agree = t['m'] == p['doc']
        s['steps'] += len(v)
        s['agree'] += agree
        if not agree:
            examples[k].append((v, t['m'], p['doc']))
        continue
    s['accepted_ts'] += t['m'] is True
    if not isinstance(t['m'], bool):
        s['ts_threw'] += 1; examples[k + ':threw'].append((v, t['m']))
    s['ts==doc'] += t['m'] == p['doc']
    if t['m'] != p['doc']:
        tag = 'ts!=doc'
        if 'docNoUnknownRule' in p and t['m'] == p['docNoUnknownRule']:
            tag = 'ts!=doc ONLY via unknown-outcome exit rule'
        s[tag] += 1
        examples[k + ':' + tag].append(v)
    if 's' in t:
        s['schema==ts'] += t['s'] == t['m']
        if t['s'] and not t['m']:
            s['schema accepts, ts refuses'] += 1; examples[k + ':schemaLoose'].append(v)
            import docref
            docref.LAST[0] = 'STALE'
            {'manifest': lambda: ok(manifest, v, unknown_rule=False), 'page': lambda: ok(page, v), 'envelope': lambda: ok(envelope, v)}[k]()
            loose[k][docref.LAST[0]] += 1
            if loose[k][docref.LAST[0]] <= 3:
                looseEx.setdefault(k + ' ' + docref.LAST[0], []).append(v)
        if t['m'] and not t['s']:
            s['SCHEMA REFUSES, TS ACCEPTS'] += 1; examples[k + ':schemaStrict'].append(v)
json.dump({k: dict(v) for k, v in stats.items()}, open(os.path.join(OUT, 'fuzz-stats.json'), 'w'), indent=1)
json.dump({k: v[:20] for k, v in examples.items()}, open(os.path.join(OUT, 'fuzz-examples.json'), 'w'), indent=1, default=repr)
for k, v in stats.items():
    print(k.ljust(13), dict(v))
for k, v in loose.items():
    print('schema-loose rule hits', k, dict(v.most_common()))
json.dump({k: dict(v) for k, v in loose.items()}, open(os.path.join(OUT, 'fuzz-loose.json'), 'w'), indent=1)
json.dump(looseEx, open(os.path.join(OUT, 'fuzz-loose-examples.json'), 'w'))
