# Ground truth (raw JSONL) vs GET /workspaces/:ws/session/:id/tool-calls, per turn.
# Also brackets each recorded [startedAt, startedAt+durationMs] by the fake model's
# wall clock: a call cannot start before the response that issued it was sent, and
# must end before the next model request that carries its result arrives.
import json, sys, urllib.request, os
base, sid, run = sys.argv[1], sys.argv[2], sys.argv[3]
out = sys.argv[4] if len(sys.argv) > 4 else None
wsid = open(f'{run}/wsid').read().strip()
H = {'authorization': 'Bearer tok-12466'}
def get(path):
    req = urllib.request.Request(base + path, headers=H)
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
jf = [os.path.join(dp, f) for dp, _, fs in os.walk(f'{run}/home') for f in fs if f == f'{sid}.jsonl'][0]
recs = [json.loads(l) for l in open(jf)]
_, ti = get(f'/workspaces/{wsid}/session/{sid}/turn-index?limit=100')
turn_ids = [t['turnId'] for t in ti['turns']]
pos = {r['uuid']: i for i, r in enumerate(recs)}
fake = [json.loads(l) for l in open(f'{run}/fake.ndjson')]
issued = {}  # callId -> (tSent of issuing response, tIn of next main request)
for i, f in enumerate(fake):
    for c in f.get('calls') or []:
        nxt = next((g['tIn'] for g in fake[i + 1:] if g.get('scn') == f.get('scn')), None)
        issued.setdefault(c, []).append((f['tSent'] - 25, nxt))
rows = []
for k, tid in enumerate(turn_ids):
    lo = pos[tid]; hi = pos[turn_ids[k + 1]] if k + 1 < len(turn_ids) else len(recs)
    truth = []
    tele = {}
    for r in recs[lo:hi]:
        if r.get('type') == 'assistant':
            for p in (r.get('message') or {}).get('parts') or []:
                fc = p.get('functionCall')
                if fc: truth.append((fc.get('id'), fc.get('name')))
        if r.get('type') == 'system' and r.get('subtype') == 'ui_telemetry':
            e = (r.get('systemPayload') or {}).get('uiEvent') or {}
            if e.get('call_id'): tele[e['call_id']] = e
    st, body = get(f'/workspaces/{wsid}/session/{sid}/tool-calls?turnId={tid}')
    starts, timing, status = [], {}, {}
    for ev in body.get('events', []):
        d = ev['data']; m = d.get('_meta') or {}
        if d.get('sessionUpdate') == 'tool_call': starts.append(d['toolCallId'])
        if d.get('sessionUpdate') in ('tool_call', 'tool_call_update') and d.get('status'): status[d['toolCallId']] = d['status']
        t = m.get('timing')
        if t and t.get('kind') == 'tool': timing[t['callId']] = t
    tids = [c for c, _ in truth]
    bracket_ok = bracket_bad = no_start = 0; bad = []
    for c in tids:
        t = timing.get(c)
        if not t or 'startedAt' not in t: no_start += 1; continue
        s0, e0 = t['startedAt'], t['startedAt'] + t['durationMs']
        w = issued.get(c, [])
        if any(a <= s0 and (b is None or e0 <= b + 5) for a, b in w): bracket_ok += 1
        else: bracket_bad += 1; bad.append((c, s0, e0, w))
    tel_match = sum(1 for c in tids if c in tele and c in timing and tele[c].get('duration_ms') == timing[c]['durationMs'] and tele[c].get('started_at') == timing[c].get('startedAt'))
    row = dict(turn=k, label=ti['turns'][k]['label'][:34], http=st, code=body.get('code'), truth=len(tids), api=len(starts),
               missing=sorted(set(tids) - set(starts))[:5], extra=sorted(set(starts) - set(tids))[:5], dup=len(starts) - len(set(starts)),
               order_equal=starts == tids, timed=len(timing), bracket_ok=bracket_ok, bracket_bad=bracket_bad, no_start=no_start,
               telemetry_equal=tel_match, statuses=dict(sorted({s: list(status.values()).count(s) for s in set(status.values())}.items())), bad=bad[:3])
    rows.append(row)
    print(json.dumps(row))
if out: json.dump(rows, open(out, 'w'), indent=1)
