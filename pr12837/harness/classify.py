import sys, collections, json
UNI16 = '\U000105D2̇'
tot = collections.Counter(); dis = collections.Counter(); other = []
for seed in sys.argv[1:]:
    with open(f'big{seed}.jsonl', encoding='utf8') as c, open(f'big{seed}.ts.txt') as t, open(f'big{seed}.java.txt') as j:
        for line, tl, jl in zip(c, t, j):
            ts, sc = tl.rstrip('\n').split('\t'); jv = jl.strip()
            k = line[6:line.index('"', 6)]
            tot[(k, ts)] += 1
            if ts != jv:
                why = 'unicode16-nfc' if UNI16 in line else 'OTHER'
                dis[(k, why, ts, jv)] += 1
                if why == 'OTHER' and len(other) < 5: other.append(line[:600])
print('per-kind verdicts (TS):')
for (k, v), n in sorted(tot.items()): print(f'  {k:12s} {v}: {n}')
print('disagreements:')
for key, n in sorted(dis.items()): print('  ', key, n)
for o in other: print('OTHER:', o)
