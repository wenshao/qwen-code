#!/usr/bin/env python3
# Cross-arm probe matrix: per probe and arm, a short outcome; flags any H2/MySQL disagreement.
import re, sys, os, collections
P = os.path.dirname(os.path.abspath(__file__))
arms = ['r3', '99ff', 'f4ee', 'head', 'cand3']
files = {a: [f'{P}/probe-{a}.txt'] + ([f'{P}/probe-{a}-mn.txt'] if a in ('head', 'cand3') else []) for a in arms}
def short(pid, r):
    st = re.search(r'op=\S+ state=(\S+)(?: error=(\S+))?', r)
    s = (st.group(1) + (' ' + st.group(2).split('/')[0] if st and st.group(2) else '')) if st else ''
    if r.startswith('scan_escaped'): s = 'scan THROWS, ' + s
    for k in ('bucket_object', 'db_rows_referencing_object', 'non_verified_rows', 'deletes_inside_tx'):
        m = re.search(k + r'=(\S+)', r)
        if m and pid[0] in 'JKL': s += f' {k.split("_")[0] if k!="deletes_inside_tx" else "in_tx"}={m.group(1)}'
    if pid == 'M':
        a = re.search(r'a-poison\{[^}]*next_at=(\S+?)\}', r); z = re.search(r'z-finish\{state=\S+ claim_epoch=(\d+)', r)
        s = ('THROWS' if 'scan_escaped' in r else 'returns') + f'; poison next_at={"pushed" if a and a.group(1).startswith("pushed") else a.group(1) if a else "?"}; 2nd candidate claim_epoch={z.group(1) if z else "?"}'
    if pid.startswith('N'):
        m = re.search(r'grant\{state=(\S+) claim_epoch=(\d+)', r); s = (m.group(1) if m else s) + (' ' + st.group(2).split('/')[0] if st and st.group(2) else '')
    if pid in ('C', 'E3', 'F') : s = r[:70]
    return s.strip()
res = collections.defaultdict(dict); raw = collections.defaultdict(dict)
for a in arms:
    for f in files[a]:
        if not os.path.exists(f): continue
        for l in open(f):
            m = re.match(r'PROBE (\S+) (h2|mysql) (\S+) (.*?) :: (.*)', l.rstrip())
            if not m: continue
            _, db, pid, label, r = m.groups()
            r = re.sub(r'pushed_to_now\+-?\d+ms', 'pushed', r)
            r = re.sub(r'"(resourceId|digest)":"[^"]+"', '', r)
            raw[pid][(a, db)] = r; res[pid][a] = short(pid, r)
for pid in sorted(res, key=lambda x: (x[0], x)):
    dis = [a for a in arms if (a, 'h2') in raw[pid] and (a, 'mysql') in raw[pid] and raw[pid][(a, 'h2')] != raw[pid][(a, 'mysql')]]
    miss = [f'{a}/{db}' for a in arms for db in ('h2', 'mysql') if (a, db) not in raw[pid]]
    print(f'{pid}' + (f'   !! H2/MySQL differ on {dis}' if dis else '') + (f'   (missing {miss})' if miss else ''))
    for a in arms: print(f'   {a:6s} {res[pid].get(a, "-")}')
