#!/usr/bin/env python3
"""Census of hosted-workspace-tool-turn.test.ts on main CI ubuntu Test jobs.

For every cached job log: file duration, every listed test of the file
(vitest lists only tests >=300ms when the file passes), the subset whose body
calls requested(), failures (x) and absorbed retries ((retry xN))."""
import re, sys, glob, os, json
FILE = 'hosted-workspace-tool-turn.test.ts'
pats = []
for l in open('requested-tests.txt'):
    _, title = l.rstrip('\n').split(' ', 1)
    rx = re.escape(title)
    rx = re.sub(r'%s|\\\$decision|\\\$oversized', '.*?', rx)
    pats.append(re.compile('^' + rx))
def is_req(name): return any(p.match(name) for p in pats)
meta = {}
for tsv in ['/root/verify/pr13323/census/jobs.tsv', 'jobs-new.tsv']:
    for l in open(tsv):
        c = l.rstrip('\n').split('\t')
        if len(c) >= 7 and c[2].isdigit(): meta[c[2]] = dict(run=c[0], sha=c[1], runner=c[5], started=c[6])
rows = []
for f in sorted(glob.glob('/root/verify/pr13323/census/logs/*.log') + glob.glob('logs/*.log')):
    jid = os.path.basename(f)[:-4]
    on = False; tests = []; file_ms = None; file_status = None
    for raw in open(f, encoding='utf-8', errors='replace'):
        l = re.sub(r'\x1b\[[0-9;]*m', '', raw.rstrip('\n'))
        if re.match(r'\d{4}-\d\d-\d\dT', l): l = l[29:]
        m = re.match(r'\s*([✓❯×]) src/serve/' + re.escape(FILE) + r' \((\d+) tests?(?: \| (\d+) failed)?(?: \| \d+ skipped)?\) (\d+)ms', l)
        if m:
            on = True; file_ms = int(m.group(4)); file_status = m.group(1); continue
        if on:
            m = re.match(r'\s+([✓×↓]) (.*?) +(\d+)ms(?: \(retry x(\d)\))?\s*$', l)
            if m: tests.append(dict(ok=m.group(1), name=m.group(2), ms=int(m.group(3)), retry=int(m.group(4) or 0)))
            elif re.match(r'\s+→ ', l): continue
            else: on = False
    if file_ms is None: continue
    req = [t for t in tests if is_req(t['name'])]
    rows.append(dict(job=jid, **meta.get(jid, {}), file_ms=file_ms, file_status=file_status,
        listed=len(tests), req_listed=len(req),
        req_max=max([t['ms'] for t in req], default=0),
        req_max_name=max(req, key=lambda t: t['ms'])['name'] if req else '',
        fails=[t['name'] for t in tests if t['ok'] == '×'],
        retries=[(t['name'], t['retry']) for t in tests if t['retry']],
        req_ms=[t['ms'] for t in req]))
json.dump(rows, open('census.json', 'w'), indent=1)
rows.sort(key=lambda r: r.get('started', ''))
print('jobs', len(rows))
for r in rows:
    print(f"{r.get('started','?')[:16]} {r.get('sha','?')} {r.get('runner','?'):18} file={r['file_ms']:6d}ms {r['file_status']} listed={r['listed']:3d} req={r['req_listed']:2d} reqmax={r['req_max']:5d} fails={len(r['fails'])} retries={r['retries']}")
