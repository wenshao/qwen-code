import sys, re, collections
rows = collections.defaultdict(list)
renew = collections.defaultdict(list)
clock = []
for f in sys.argv[1:]:
    for line in open(f):
        p = line.split()
        arm, db, kind = p[0], p[1], p[2]
        kv = dict(x.split('=', 1) for x in p[3:] if '=' in x)
        if kind in ('binding', 'dispatch'):
            rows[(arm, db, kind, kv['lease'])].append((int(kv['offset']), int(kv['granted']), int(kv['lifetime'])))
        elif kind == 'renew':
            renew[(arm, db)].append(kv)
        elif kind == 'clock':
            clock.append(line.strip())
print("LEASE LIFETIME (ms): granted = stored deadline - claim start; lifetime = measured takeover delay")
for k in sorted(rows):
    v = rows[k]; g = [x[1] for x in v]; l = [x[2] for x in v]
    short = sum(1 for x in l if x < int(k[3]))
    print(f"{k[0]:4} {k[1]:12} {k[2]:8} lease={k[3]:>4}  n={len(v)}  granted {min(g):5}..{max(g):5}  lifetime {min(l):5}..{max(l):5}  shorter-than-lease {short}/{len(v)}")
print("\nRENEWAL CHAIN (1 s lease, renew every 333 ms for 3 s, then CAS)")
for k in sorted(renew):
    v = renew[k]
    op = sum(1 for x in v if x['opRefusedAt'] != '-1'); dx = sum(1 for x in v if x['dxRefusedAt'] != '-1')
    oc = sum(1 for x in v if x['opCas'] == 'true'); dc = sum(1 for x in v if x['dxCas'] == 'true')
    at = collections.Counter(x['opRefusedAt'] for x in v)
    print(f"{k[0]:4} {k[1]:12} binding refused {op}/{len(v)} (at renewal #{dict(at)})  dispatch refused {dx}/{len(v)}  CAS ok binding {oc}/{len(v)} dispatch {dc}/{len(v)}")
print("\nPRECISE CLOCK CONSISTENCY")
for c in clock: print(c)
