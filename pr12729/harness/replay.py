import base64, json, sys
from docref import *
fx = json.load(open(sys.argv[1]))
res = {}
def rec(group, cid, want, got):
    r = res.setdefault(group, [0, 0, []]); r[0] += 1
    if want == got: r[1] += 1
    else: r[2].append(cid)
for c in fx['manifestCases']: rec('manifestCases', c['id'], c['valid'], ok(manifest, c['manifest']))
def text_of(c):
    t = c['text'].encode('utf-8', 'surrogatepass')
    if c.get('padToBytes') is not None: t = t + b' ' * (c['padToBytes'] - len(t))
    return t
def parse_bytes(b, limit):
    need(len(b) <= limit)
    try: s = b.decode('utf-8')
    except UnicodeDecodeError: raise Bad()
    def hook(pairs):
        keys = [k for k, _ in pairs]; need(len(keys) == len(set(keys))); return dict(pairs)
    def const(x): raise Bad()
    try: return json.loads(s, object_pairs_hook=hook, parse_constant=const)
    except ValueError: raise Bad()
for c in fx['manifestTextCases']: rec('manifestTextCases', c['id'], c['valid'], ok(lambda: manifest(parse_bytes(text_of(c), 65536))))
def page_of(c):
    if c.get('repeatSegments') is None: return c['page']
    p = dict(c['page']); p['segments'] = p['segments'] * c['repeatSegments']; return p
for c in fx['pageCases']: rec('pageCases', c['id'], c['valid'], ok(page, page_of(c)))
for c in fx['pageTextCases']: rec('pageTextCases', c['id'], c['valid'], ok(lambda: page(parse_bytes(text_of(c), 262144))))
for c in fx['pagePositionCases']: rec('pagePositionCases', c['id'], c['valid'], page_at(c['manifest'], c['streamIndex'], c['pageIndex'], c['page']))
for c in fx['revisionCases']: rec('revisionCases', c['id'], c['valid'], successor(c['previous'], c['next']))
for c in fx['pageRevisionCases']: rec('pageRevisionCases', c['id'], c['valid'], page_successor(c['previous'], c['next']))
for c in fx['envelopeCases']: rec('envelopeCases', c['id'], c['valid'], ok(envelope, c['result']))
for c in fx['envelopeManifestCases']: rec('envelopeManifestCases', c['id'], c['valid'], envelope_of(c['result'], c['manifest']))
def bytes_of(spec):
    return base64.b64decode(spec['base64']) if 'base64' in spec else bytes([spec['fill']['byte']]) * spec['fill']['length']
for sq in fx['segmentSequences']:
    L = Ledger(); good = True
    for st in sq['steps']:
        q = dict(st['request'])
        if st['op'] == 'publish' and isinstance(q.get('bytes'), dict): q['bytes'] = bytes_of(q['bytes'])
        if getattr(L, st['op'])(q) != st['expected']: good = False; break
    rec('segmentSequences', sq['id'], True, good)
tot = sum(r[0] for r in res.values()); agree = sum(r[1] for r in res.values())
for g, (n, a, bad) in res.items(): print(f'{g:24} {a}/{n}', 'MISMATCH ' + ', '.join(bad) if bad else '')
print(f'TOTAL {agree}/{tot}')
