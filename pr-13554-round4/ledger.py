"""Round-4 results ledger: parse every result file into results.json. Figures and the report read only this."""
import glob, json, os, re
R = '/Users/wenshao/pr13554-rig/r4/results'
out = {}

# Race probes (RESULT lines). The matrix runs supersede the earlier smoke run of the same scenarios.
race = []
for f in sorted(glob.glob(R + '/race/*.log')):
    if f.endswith('head-mysql84-inflight_gap_collectorFirst.log'):
        continue  # smoke run, superseded by the matrix file
    for line in open(f, errors='replace'):
        if not line.startswith('RESULT '):
            continue
        fields = dict(re.findall(r'(\w+)=(\{[^}]*\}|\[[^\]]*\]|\S+)', line))
        fields.setdefault('isolation', 'REPEATABLE-READ')
        fields['file'] = os.path.basename(f)
        race.append(fields)
out['race'] = race

# Mutation sweep.
muts = []
for i, line in enumerate(open(R + '/mutation/results.psv')):
    if i == 0:
        continue
    mid, tests, fails, errs, killers = (line.rstrip('\n').split('|') + [''] * 5)[:5]
    muts.append({'id': mid, 'tests': int(tests or 0), 'failures': int(fails or 0), 'errors': int(errs or 0),
                 'killers': killers.split()})
meta = {m['id']: m['desc'] for m in json.load(open(R + '/mutation/mutants.json'))}
for m in muts:
    m['desc'] = meta.get(m['id'], 'baseline')
out['mutation'] = muts
rep = {}
for f in glob.glob(R + '/mutation/rep-*.summary'):
    arm = os.path.basename(f)[4:-8]
    lines = [l for l in open(f) if 'Tests run' in l]
    rep[arm] = {'runs': len(lines), 'failed': sum(1 for l in lines if 'Failures: 1' in l)}
out['m29_repeat'] = rep

# Gates.
def counts(path, pattern):
    hits = [l for l in open(path, errors='replace') if re.search(pattern, l)]
    return hits
gates = {}
for f in glob.glob(R + '/gates/*.summary.txt'):
    gates[os.path.basename(f)[:-12]] = open(f).read().splitlines()
out['gates'] = gates
out['aa'] = open(R + '/gates/AA-rerun-summary.txt').read().splitlines()
probe = {}
for f in glob.glob(R + '/gates/P1-probe-head-*.txt'):
    db = f.rsplit('-', 1)[1][:-4]
    probe[db] = [l.strip() for l in open(f) if 'recovery-read kind=managed-tool-' in l or 'O4-2 collector' in l or 'negative' in l]
out['p1'] = probe

# Candidate validation.
cand = {}
for f in glob.glob(R + '/cand/*.summary.txt'):
    name = os.path.basename(f)[:-12]
    text = open(f).read()
    total = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$', text, re.M)
    failing = sorted(set(re.findall(r'CollectorTest\.([A-Za-z]+):(\d+)', text)))
    cand[name] = {'totals': total[-1] if total else None, 'failing': failing,
                  'checkstyle': re.findall(r'You have (\d+) Checkstyle', text)}
out['candidates'] = cand

# Production-app E2E (trial-merge classes).
e = R + '/e2e'
ledgers = [l.rstrip('\n').split('\t') for l in open(e + '/out-e2e1-m4/ledgers.txt')]
out['e2e1'] = {'ledgers': ledgers, 'digest': open(e + '/out-e2e1-m4/eligible-digest.txt').read().splitlines(),
               'reader': open(e + '/out-e2e1-m4/recovery-reader.txt').read().splitlines(),
               'counters': open(e + '/out-e2e1-m4/log-counters.txt').read().splitlines(),
               'reads': [open(e + '/out-e2e1-m4/read-after-retire.txt').read().strip(),
                         open(e + '/out-e2e1-m4/read-after-collect.txt').read().strip()]}
out['cad'] = open(e + '/out-cad-m4/timeline.txt').read().splitlines()
out['e2e2'] = open(e + '/out-e2e2/audit-r4.txt').read().splitlines() + open(e + '/out-e2e2/done.txt').read().splitlines()
out['e2e3'] = [l.rstrip() for l in open(e + '/E2E3.log') if l.startswith(('KILLED', 'L1-midpage', 'L2-between'))]
ups = {}
for db in ('mysql84', 'mariadb'):
    ups[db] = [l.rstrip() for l in open(e + f'/UP-{db}.log') if not l.startswith(('pre-seal', 'started', 'booted'))]
out['upgrade'] = ups
out['binlog'] = [l.strip() for l in open(e + '/out-bin/binlog.txt') if 'collected_bytes=0' not in l]
json.dump(out, open('/Users/wenshao/pr13554-rig/r4/results.json', 'w'), indent=1)
print('race results', len(race), 'mutants', len(muts) - 1, 'candidate runs', len(cand))
