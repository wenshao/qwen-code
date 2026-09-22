import sys, glob, collections, subprocess, json
out, keys, container, db = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
A = collections.defaultdict(set); samefalse = 0
execs = collections.defaultdict(list); claims = collections.defaultdict(list); settles = collections.defaultdict(list)
errs = collections.Counter(); counts = collections.Counter()
for f in glob.glob(out + '/n*.log'):
    for line in open(f):
        p = line.split()
        if not p: continue
        counts[p[0]] += 1
        if p[0] == 'A':
            A[int(p[1])].add(p[2]); samefalse += p[3] == 'false'
        elif p[0] == 'EXEC': execs[p[1]].append((int(p[2]), p[3]))
        elif p[0] == 'CLAIM': claims[p[1]].append((int(p[2]), p[3]))
        elif p[0] == 'SETTLE': settles[p[1]].append((int(p[2]), p[3], p[4]))
        elif p[0] == 'ERR': errs[' '.join(p[1:4])[:120]] += 1
converge = sum(1 for k in range(keys) if len(A[k]) == 1)
double_exec = {i: v for i, v in execs.items() if len(v) > 1}
def _gen_owners(v):
    d = collections.defaultdict(set)
    for g, o in v: d[g].add(o)
    return d
dup_gen = {i: v for i, v in claims.items() if any(len(o) > 1 for o in _gen_owners(v).values())}
multi_settle = {i: v for i, v in settles.items() if len(v) > 1}
cli = 'mariadb' if 'maria' in container else 'mysql'
rows = subprocess.run(['docker', 'exec', container, cli, '-uroot', '-N', '-e',
    f"SELECT execution_call_id, execution_state, dispatch_generation, result_json FROM {db}.qwen_tool_execution"],
    capture_output=True, text=True).stdout.strip().splitlines()
bad_owner = []; states = collections.Counter()
for r in rows:
    i, st, gen, res = r.split('\t')
    states[st] += 1
    if res != 'NULL':
        j = json.loads(res)
        if j.get('executionStatus') == 'success':
            ex = execs.get(i, [])
            if (j.get('gen'), j.get('owner')) not in [(g, o) for g, o in ex]:
                bad_owner.append(i)
    mx = max([g for g, _ in claims.get(i, [])], default=0)
    if int(gen) < mx: bad_owner.append(i + ' gen<claimed')
print(f"  events: {dict(counts)}")
print(f"  I1 create : {converge}/{keys} phase-A keys converge on one executionCallId; sameRequest=false {samefalse}; rows in table {len(rows)}")
print(f"  I2 at-most-once dispatch: {len(execs)} executions reached EXECUTING; executions with >1 EXEC = {len(double_exec)}")
_pairs = [(i, g, o) for i, v in claims.items() for g, o in _gen_owners(v).items() if len(o) > 1]
print(f"  I3 {sum(len(v) for v in claims.values())} claims; one owner per (execution, generation): violations = {len(dup_gen)} executions ({len(_pairs)} generations, {sum(len(o) - 1 for _, _, o in _pairs)} surplus grants)")
print(f"  I4 success results written by the dispatcher that executed that generation: violations = {len(bad_owner)}")
print(f"  I5 executions settled more than once: {len(multi_settle)}")
print(f"  final states: {dict(states)}   errors: {dict(errs) or 0}")
v = len(double_exec) + len(dup_gen) + len(bad_owner) + len(multi_settle) + (keys - converge) + samefalse + sum(errs.values())
for i, e in list(double_exec.items())[:3]: print(f"    double EXEC {i}: {e}")
print("  VERDICT:", "PASS" if v == 0 else f"FAIL ({v} violations)")
