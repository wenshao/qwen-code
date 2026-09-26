# An independent reading of docs/design/2026-09-26-managed-tool-result-contract.md
# (value rules, manifest, descriptors, capture status, pages, page position,
# revisions, envelope, segment publication). Written from the prose only.
import hashlib
import re
import unicodedata

MAX_COUNT = 2**53 - 2
TOKEN = re.compile(r'[a-z0-9_-]{1,128}')
DIGEST = re.compile(r'[0-9a-f]{64}')
GEN = re.compile(r'[1-9][0-9]*')
SIGNAL = re.compile(r'SIG[A-Z0-9]{1,16}')
MIME = re.compile(r'[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*(;[\x20-\x7e]*)?')
KIND_MANIFEST, KIND_PAGE, KIND_CONTENT = (
    'managed-tool-result-manifest', 'managed-tool-result-page', 'managed-tool-result-content')
PROTO = 'managed-tool-result/1'


class Bad(Exception):
    pass


LAST = [None]


def need(cond):
    if not cond:
        import sys as _s
        f = _s._getframe(1)
        LAST[0] = '%s:%d' % (f.f_code.co_name, f.f_lineno)
        raise Bad()


def obj(v, keys, optional=()):
    need(isinstance(v, dict))
    need(set(v) <= set(keys))
    need(all(k in v for k in keys if k not in optional))
    return v


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def count(v, lo=0, hi=MAX_COUNT):
    need(is_int(v) and lo <= v <= hi and v <= MAX_COUNT)
    return v


def ident(v):
    need(isinstance(v, str) and len(v) > 0)
    try:
        b = v.encode('utf-8')
    except UnicodeEncodeError:
        LAST[0] = 'ident:not-well-formed-utf16'
        raise Bad()
    need(len(b) <= 512)
    need(unicodedata.is_normalized('NFC', v))
    need(not any(ord(c) < 0x20 or 0x7f <= ord(c) <= 0x9f for c in v))
    return v


def token(v):
    need(isinstance(v, str) and TOKEN.fullmatch(v))
    return v


def digest(v):
    need(isinstance(v, str) and DIGEST.fullmatch(v))
    return v


def generation(v):
    need(isinstance(v, str) and GEN.fullmatch(v) and 1 <= int(v) <= 2**63 - 1)
    return v


def dref(v, kind=None, lo=None, hi=None):
    obj(v, ['resourceId', 'kind', 'schemaVersion', 'byteLength', 'digest'])
    ident(v['resourceId']); ident(v['kind'])
    count(v['schemaVersion']); count(v['byteLength']); digest(v['digest'])
    if kind is not None:
        need(v['kind'] == kind and v['schemaVersion'] == 1)
    if lo is not None:
        need(lo <= v['byteLength'] <= hi)
    return v


def one_of(v, allowed):
    need(isinstance(v, str) and v in allowed)
    return v


def descriptor(d):
    obj(d, ['streamId', 'role', 'mimeType', 'state', 'byteLength', 'digest', 'missingRanges', 'body'])
    token(d['streamId'])
    one_of(d['role'], ['stdout', 'stderr', 'pty', 'result', 'attachment'])
    need(isinstance(d['mimeType'], str) and len(d['mimeType']) <= 255 and MIME.fullmatch(d['mimeType']))
    state = one_of(d['state'], ['open', 'sealed', 'incomplete'])
    n = count(d['byteLength'])
    digest(d['digest'])
    mr = d['missingRanges']
    need(isinstance(mr, list))
    need(len(mr) <= (1 if state == 'incomplete' else 0))
    for r in mr:
        obj(r, ['start', 'end'])
        count(r['start'])
        need(r['start'] == n)
        if r['end'] is not None:
            count(r['end'])
            need(r['end'] > r['start'])
    body = d['body']
    need(isinstance(body, dict) and len(body) == 1 and set(body) <= {'ref', 'pages'})
    if 'ref' in body:
        need(state != 'open')
        dref(body['ref'], KIND_CONTENT)
        need(body['ref']['byteLength'] == n and body['ref']['digest'] == d['digest'])
    else:
        pages = body['pages']
        need(isinstance(pages, list) and len(pages) <= 64)
        total = 0
        for p in pages:
            obj(p, ['ref', 'segmentCount', 'byteLength'])
            dref(p['ref'], KIND_PAGE, 1, 262144)
            sc = count(p['segmentCount'], 1, 1024)
            count(p['byteLength'], sc, sc * 16 * 1024 * 1024)
            total += p['byteLength']
        need(total == n)
        need((len(pages) == 0) == (n == 0))
    return d


def implied(contents):
    states = [d['state'] for d in contents]
    if 'open' in states:
        return 'pending'
    if contents and all(s == 'sealed' for s in states):
        return 'complete'
    if all(s == 'incomplete' and d['byteLength'] == 0 for s, d in zip(states, contents)):
        return 'unavailable'
    return 'partial'


IDS = ['tenantId', 'sessionId', 'turnId', 'executionCallId', 'callId', 'invocationDigest']
FIXED = IDS + ['bindingGeneration', 'captureId', 'captureScope', 'capturePolicy']


def manifest(m, unknown_rule=True):
    obj(m, ['toolResult', 'type', *IDS, 'bindingGeneration', 'captureId', 'revision', 'executionStatus',
            'exitCode', 'signal', 'captureScope', 'capturePolicy', 'captureStatus', 'captureReason',
            'upstreamTruncated', 'contents'])
    need(m['toolResult'] == PROTO and m['type'] == 'manifest')
    for k in IDS:
        ident(m[k])
    generation(m['bindingGeneration']); token(m['captureId']); count(m['revision'], 1)
    es = one_of(m['executionStatus'], ['success', 'error', 'cancelled', 'unknown'])
    ec, sig = m['exitCode'], m['signal']
    if ec is not None:
        need(is_int(ec) and -2**31 <= ec <= 2**32 - 1)
    if sig is not None:
        need(isinstance(sig, str) and SIGNAL.fullmatch(sig))
    scope = one_of(m['captureScope'], ['process_pty', 'process_pipes', 'tool_native'])
    if scope == 'tool_native':
        need(ec is None and sig is None)
    else:
        need(ec is None or sig is None)
        if unknown_rule and es == 'unknown':
            need(ec is None and sig is None)  # "both are null while the outcome is unknown"
    one_of(m['capturePolicy'], ['complete_required', 'best_effort'])
    st = one_of(m['captureStatus'], ['pending', 'complete', 'partial', 'unavailable'])
    if m['captureReason'] is not None:
        one_of(m['captureReason'], ['quota_exhausted', 'size_limit', 'producer_lost', 'storage_failed', 'cancelled'])
    need(isinstance(m['upstreamTruncated'], bool))
    c = m['contents']
    need(isinstance(c, list) and len(c) <= 32)
    for d in c:
        descriptor(d)
    need(len({d['streamId'] for d in c}) == len(c))
    roles = [d['role'] for d in c]
    for r in ['stdout', 'stderr', 'pty', 'result']:
        need(roles.count(r) <= 1)
    banned = {'process_pty': {'stdout', 'stderr'}, 'process_pipes': {'pty'},
              'tool_native': {'stdout', 'stderr', 'pty'}}[scope]
    need(not (set(roles) & banned))
    need(st == implied(c))
    need((m['captureReason'] is None) == (st in ('pending', 'complete')))
    return m


def ok(fn, *a, **kw):
    try:
        fn(*a, **kw)
        return True
    except Bad:
        return False


def page(p):
    obj(p, ['toolResult', 'type', 'captureId', 'streamId', 'firstOrdinal', 'offset', 'segments'])
    need(p['toolResult'] == PROTO and p['type'] == 'page')
    token(p['captureId']); token(p['streamId'])
    fo = count(p['firstOrdinal']); off = count(p['offset'])
    segs = p['segments']
    need(isinstance(segs, list) and 1 <= len(segs) <= 1024)
    for s in segs:
        obj(s, ['byteLength', 'digest'])
        count(s['byteLength'], 1, 16777216); digest(s['digest'])
    need(fo + len(segs) - 1 <= 65535)
    need(off + sum(s['byteLength'] for s in segs) <= MAX_COUNT)
    return p


def page_at(m, si, pi, p, unknown_rule=True):
    if not (ok(manifest, m, unknown_rule=unknown_rule) and ok(page, p)):
        return False
    if not (0 <= si < len(m['contents'])):
        return False
    body = m['contents'][si]['body']
    if 'pages' not in body or not (0 <= pi < len(body['pages'])):
        return False
    before = body['pages'][:pi]
    slot = body['pages'][pi]
    return (p['captureId'] == m['captureId'] and p['streamId'] == m['contents'][si]['streamId']
            and p['firstOrdinal'] == sum(x['segmentCount'] for x in before)
            and p['offset'] == sum(x['byteLength'] for x in before)
            and len(p['segments']) == slot['segmentCount']
            and sum(s['byteLength'] for s in p['segments']) == slot['byteLength'])


def successor(a, b, unknown_rule=True):
    if not (ok(manifest, a, unknown_rule=unknown_rule) and ok(manifest, b, unknown_rule=unknown_rule)):
        return False
    if a['captureStatus'] != 'pending' or b['revision'] != a['revision'] + 1:
        return False
    if any(a[k] != b[k] for k in FIXED):
        return False
    if a['executionStatus'] != 'unknown' and any(a[k] != b[k] for k in ('executionStatus', 'exitCode', 'signal')):
        return False
    if a['upstreamTruncated'] and not b['upstreamTruncated']:
        return False
    if len(b['contents']) < len(a['contents']):
        return False
    for x, y in zip(a['contents'], b['contents']):
        if (x['streamId'], x['role'], x['mimeType']) != (y['streamId'], y['role'], y['mimeType']):
            return False
        if x['state'] in ('sealed', 'incomplete'):
            if x != y:
                return False
            continue
        if 'pages' not in y['body'] or y['byteLength'] < x['byteLength']:
            return False
        if y['byteLength'] == x['byteLength'] and y['digest'] != x['digest']:
            return False
        px, py = x['body']['pages'], y['body']['pages']
        if len(py) < len(px):
            return False
        for i, pg in enumerate(px):
            if i < len(px) - 1:
                if pg != py[i]:
                    return False
            elif not (py[i]['segmentCount'] >= pg['segmentCount'] and py[i]['byteLength'] >= pg['byteLength']):
                return False
    return True


def page_successor(a, b):
    if not (ok(page, a) and ok(page, b)):
        return False
    return (a['captureId'] == b['captureId'] and a['streamId'] == b['streamId']
            and a['firstOrdinal'] == b['firstOrdinal'] and a['offset'] == b['offset']
            and len(b['segments']) >= len(a['segments'])
            and b['segments'][:len(a['segments'])] == a['segments'])


def envelope(r):
    obj(r, ['executionStatus', 'responseParts', 'error', 'capture'], optional=['error'])
    es = one_of(r['executionStatus'], ['not_started', 'success', 'error', 'cancelled'])
    need(isinstance(r['responseParts'], list))
    if 'error' in r:
        obj(r['error'], ['message', 'type'], optional=['type'])
        need(isinstance(r['error']['message'], str) and r['error']['message'])
        if 'type' in r['error']:
            need(isinstance(r['error']['type'], str) and r['error']['type'])
    c = r['capture']
    if es == 'not_started':
        need(c is None)
        return r
    obj(c, ['captureStatus', 'captureReason', 'manifest', 'previewTruncated', 'deliveryStatus'])
    cs = one_of(c['captureStatus'], ['complete', 'partial', 'unavailable'])
    if c['captureReason'] is not None:
        one_of(c['captureReason'], ['quota_exhausted', 'size_limit', 'producer_lost', 'storage_failed', 'cancelled'])
    need((c['captureReason'] is None) == (cs == 'complete'))
    if c['manifest'] is None:
        need(cs == 'unavailable')
    else:
        dref(c['manifest'], KIND_MANIFEST, 1, 65536)
    need(isinstance(c['previewTruncated'], bool))
    one_of(c['deliveryStatus'], ['pending', 'committed', 'blocked'])
    return r


def envelope_of(r, m, unknown_rule=True):
    if not (ok(envelope, r) and ok(manifest, m, unknown_rule=unknown_rule)):
        return False
    c = r['capture']
    return (c is not None and c['manifest'] is not None and m['captureStatus'] != 'pending'
            and m['executionStatus'] == r['executionStatus'] and m['captureStatus'] == c['captureStatus']
            and m['captureReason'] == c['captureReason'])


class Ledger:
    """Segment publication, seal and prefix, per the numbered steps."""

    def __init__(self):
        self.seg = {}
        self.sealed = {}

    def publish(self, q):
        try:
            obj(q, ['captureId', 'streamId', 'ordinal', 'bytes', 'digest'], optional=['digest'])
            key = (token(q['captureId']), token(q['streamId']))
            o = count(q['ordinal'], 0, 65535)
            b = q['bytes']
            need(isinstance(b, (bytes, bytearray)) and 1 <= len(b) <= 16 * 1024 * 1024)
            if 'digest' in q:
                digest(q['digest'])
        except Bad:
            return {'status': 'refused', 'code': 'managed_tool_result_invalid'}
        h = hashlib.sha256(b).hexdigest()
        if 'digest' in q and q['digest'] != h:
            return {'status': 'refused', 'code': 'managed_tool_result_digest_mismatch'}
        s = self.seg.setdefault(key, {})
        if o in s:
            if len(s[o]) == len(b) and hashlib.sha256(s[o]).hexdigest() == h:
                return {'status': 'ok', 'result': {'ordinal': o, 'byteLength': len(b), 'digest': h}}
            return {'status': 'refused', 'code': 'managed_tool_result_conflict'}
        if key in self.sealed and o >= self.sealed[key]['segmentCount']:
            return {'status': 'refused', 'code': 'managed_tool_result_conflict'}
        s[o] = bytes(b)
        return {'status': 'ok', 'result': {'ordinal': o, 'byteLength': len(b), 'digest': h}}

    def seal(self, q):
        try:
            obj(q, ['captureId', 'streamId', 'segmentCount', 'byteLength', 'digest'])
            key = (token(q['captureId']), token(q['streamId']))
            n = count(q['segmentCount'], 0, 65536)
            count(q['byteLength']); digest(q['digest'])
        except Bad:
            return {'status': 'refused', 'code': 'managed_tool_result_invalid'}
        want = {'segmentCount': n, 'byteLength': q['byteLength'], 'digest': q['digest']}
        if key in self.sealed:
            if self.sealed[key] == want:
                return {'status': 'ok', 'result': dict(want)}
            return {'status': 'refused', 'code': 'managed_tool_result_conflict'}
        s = self.seg.get(key, {})
        if set(s) != set(range(n)):
            return {'status': 'refused', 'code': 'managed_tool_result_conflict'}
        data = b''.join(s[i] for i in range(n))
        if len(data) != q['byteLength'] or hashlib.sha256(data).hexdigest() != q['digest']:
            return {'status': 'refused', 'code': 'managed_tool_result_digest_mismatch'}
        self.sealed[key] = want
        return {'status': 'ok', 'result': dict(want)}

    def prefix(self, q):
        try:
            obj(q, ['captureId', 'streamId'])
            key = (token(q['captureId']), token(q['streamId']))
        except Bad:
            return {'status': 'refused', 'code': 'managed_tool_result_invalid'}
        s = self.seg.get(key, {})
        chunks = []
        while len(chunks) in s:
            chunks.append(s[len(chunks)])
        data = b''.join(chunks)
        return {'status': 'ok', 'result': {'segmentCount': len(chunks), 'byteLength': len(data),
                                           'digest': hashlib.sha256(data).hexdigest(),
                                           'sealed': key in self.sealed}}
