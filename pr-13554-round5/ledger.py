"""Round-5 results ledger: parse every result file into results.json. Figures and the report read only this."""
import glob, json, os, re
R5 = '/Users/wenshao/pr13554-rig/r5/results'
ENG5 = {'mysql84': 'MySQL 8.4.6', 'mariadb': 'MariaDB 10.11.18'}
out = {}

def lines(path, prefix):
    return [l.rstrip('\n') for l in open(path, errors='replace') if l.startswith(prefix)]

def fields(line):
    return dict(re.findall(r'(\w+)=(\{[^}]*\}|\S+)', line))

# Migration-order probe (Flyway API, both engines).
mig = []
for f in sorted(glob.glob(R5 + '/probe/migorder-x5-*.log')):
    for l in lines(f, 'RESULT '):
        d = fields(l); d['line'] = l; mig.append(d)
out['migration_probe'] = mig

# PR's migration IT on mutant arms (Maven, both engines).
it = {}
for f in sorted(glob.glob(R5 + '/it/*.log')):
    name = os.path.basename(f)[:-4]
    text = open(f, errors='replace').read()
    tot = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$', text, re.M)
    ex = re.findall(r'^exit=(\d+) secs=(\d+)', text, re.M)
    elapsed = re.findall(r'Time elapsed: ([\d.]+) s (?:<<< FAILURE! )?-- in com\.alibaba\.qwen\.code\.managedagent\.store\.(\w+)', text)
    failing = sorted(set(re.findall(r'^\[ERROR\] com\.alibaba\.qwen\.code\.managedagent\.(?:\w+\.)*?(\w+(?:Test|IT))\.(\w+)(?:\(.*?\))?(?:\[\d+\])? -- Time elapsed', text, re.M)))
    it[name] = {'totals': tot[-1] if tot else None, 'exit': ex[-1] if ex else None,
                'classElapsed': elapsed, 'results': lines(f, 'RESULT '), 'failing': [f'{c}.{m}' for c, m in failing]}
out['it'] = it

# Publication-object probe (real O4-2 collection, then publicationObject reads).
pub = {}
for f in sorted(glob.glob(R5 + '/probe/pubobj-*.log')):
    name = os.path.basename(f)[:-4]
    pub[name] = [l for l in lines(f, 'PROBE ') if 'after ' in l or 'O4-2 collector' in l or 'recovery-read' in l]
out['pubobj'] = pub

# Mutation sweep.
M5 = '/Users/wenshao/pr13554-rig/mut5'
meta = {m['id']: m['desc'] for m in json.load(open(M5 + '/mutants/mutants.json'))}
muts = []
for f in sorted(glob.glob(M5 + '/logs/*.log')):
    tag = os.path.basename(f)[:-4]
    if tag.startswith('rep-'):
        continue
    text = open(f, errors='replace').read()
    tot = re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$', text, re.M)
    done = re.search(r'exit=(\d+)', text)
    killers = sorted(set(re.findall(r'^\[ERROR\] com\.alibaba\.qwen\.code\.managedagent\.store\.(\w+\.\w+)', text, re.M)))
    mid = tag.split('@')[0]
    muts.append({'tag': tag, 'id': mid, 'tree': tag.split('@')[1] if '@' in tag else 'tree',
                 'desc': meta.get(mid, 'control'), 'done': bool(done),
                 'totals': tot[-1] if tot else None, 'killers': killers})
out['mutation'] = muts

# Gates.
gates = {}
for f in glob.glob(R5 + '/gates/*.log') + glob.glob(R5 + '/gates/*.txt'):
    text = open(f, errors='replace').read()
    gates[os.path.basename(f)] = {
        'totals': re.findall(r'^\[(?:INFO|WARNING|ERROR)\] Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$', text, re.M),
        'failing': sorted(set(re.findall(r'^\[ERROR\] (com\.alibaba\.\S+?) -- Time elapsed', text, re.M))),
        'exit': re.findall(r'^exit=(\d+)(?: secs=(\d+))?', text, re.M),
        'tail': [l for l in text.splitlines() if re.search(r'failsafe-check|migrations, all|^exit=', l)][-4:],
        'checkstyle': re.findall(r'You have (\d+) Checkstyle violations', text),
        'spotbugs': re.findall(r'BugInstance size is (\d+)', text),
    }
out['gates'] = gates

# E2E (production app).
E = '/Users/wenshao/pr13554-rig/e2e'
out['order5'] = {h: (open(f'{E}/out-order5-{h}/result.txt').read().splitlines() if os.path.exists(f'{E}/out-order5-{h}/result.txt') else [])
                 for h in ('mysql84', 'mariadb')}
ups = {}
for h in ('mysql84', 'mariadb'):
    p = f'{R5}/e2e/UP5-{h}.log'
    if os.path.exists(p):
        ups[h] = [l.rstrip() for l in open(p) if not l.startswith(('pre-seal', 'started'))]
out['upgrade'] = ups
race = []
for f in sorted(glob.glob(R5 + '/race/*.log')):
    for l in lines(f, 'RESULT '):
        d = fields(l); d['file'] = os.path.basename(f); race.append(d)
out['race'] = race
# Production-app rows for the figure: E2E-1, E2E-2, upgrade (both engines).
rows = []
o1 = E + '/out-e2e1-x5'
if os.path.exists(o1 + '/ledgers.txt'):
    led = [l.rstrip('\n').split('\t') for l in open(o1 + '/ledgers.txt')][1:]
    done = [r for r in led if r[3] == '1']
    pages = ', '.join(f"{r[0].split('-', 1)[0]}={r[1]}" for r in led)
    dig = open(o1 + '/eligible-digest.txt').read().splitlines()
    dig = dig[1].split('\t') if len(dig) > 1 else ['?', '?']
    rows.append(['E2E-1: one broker, real HTTP producer, production retirement (MySQL 8.4.6)',
                 f"{len(done)}/{len(led)} ledgers complete (" + ', '.join(f"{r[0]} held by {r[4]}" for r in led if r[3] != '1') + f"); pages per Session {pages}; page queries {dig[0]} in {dig[1]} ms; "
                 + '; '.join(open(o1 + '/recovery-reader.txt').read().splitlines()) + '; '
                 + '; '.join(open(o1 + '/log-counters.txt').read().splitlines())])
    out['e2e1'] = {'ledgers': led, 'digest': dig}
a2 = E + '/out-e2e2-x5/audit-r5.txt'
if os.path.exists(a2):
    t = open(a2).read()
    errs = dict(re.findall(r'^(ER_\w+)\t(\d+)$', t, re.M))
    aud = re.search(r'^(\d+)\t(\d+)\t(\d+)\t(\d+)\t(\d+)\t(\d+)$', t, re.M).groups()
    owners = re.findall(r'^([ABC]) completed=(\d+) retry=(\d+)$', t, re.M)
    killer = open(E + '/out-e2e2-x5/killer.txt').read().strip().splitlines()[-1]
    rows.append(['E2E-2: three brokers, 51 retired Sessions, 7,176 rows (MySQL 8.4.6)',
                 f"{aud[1]}/{aud[0]} ledgers byte-exact; {int(aud[2]):,} bytes collected = {int(aud[3]):,} retired; "
                 f"{aud[4]} collected rows still holding bytes; {aud[5]} live rows intact; completions "
                 + '/'.join(o[1] for o in owners) + f" (A/B/C), retries {sum(int(o[2]) for o in owners)}; "
                 f"deadlocks {errs.get('ER_LOCK_DEADLOCK')}, lock-wait timeouts {errs.get('ER_LOCK_WAIT_TIMEOUT')}; "
                 + open(E + '/out-e2e2-x5/done.txt').read().strip() + f"; in-page kill: {killer}"])
    out['e2e2'] = {'audit': aud, 'errors': errs, 'owners': owners, 'killer': killer}
for h in ('mysql84', 'mariadb'):
    p = f'{R5}/e2e/UP5-{h}.log'
    if os.path.exists(p):
        ups[h] = [l.rstrip() for l in open(p) if not l.startswith(('pre-seal', 'started'))]
out['upgrade'] = ups
for h in ('mysql84', 'mariadb'):
    p = f'{R5}/e2e/UP5-{h}.log'
    if os.path.exists(p) and 'UPGRADE-DONE' in open(p).read():
        t = open(p).read()
        applied = re.findall(r'Successfully applied (\d+) migration', t)
        coll = re.search(r'collected after (\d+)s', t)
        reup = re.search(r're-upgraded PR broker collected old-4 after (\d+)s', t)
        mixed = 'Successfully validated' in t
        final = re.findall(r'^(\d+)\t(\d+)$', t, re.M)
        rows.append([f'Upgrade main (V64) → merged (V65) with retired captures, mixed fleet, rollback and re-upgrade ({ENG5[h]})',
                     f"merged broker applied {applied[0] if applied else '?'} migration; 3 pre-upgrade Sessions collected after {coll.group(1) if coll else '?'} s; "
                     f"main broker on the V65 schema validates and starts: {mixed}; re-upgraded broker collected old-4 after {reup.group(1) if reup else '?'} s; "
                     f"final schema {final[-1][0] if final else '?'} ({final[-1][1] if final else '?'} applied)"])
p3 = f'{R5}/e2e/E2E3-x5.log'
if os.path.exists(p3):
    t = open(p3).read()
    ka = re.search(r'KILLED pid=\d+ after \d+ polls inside uncommitted trx \{trx_id=\d+, trx_rows_modified=(\d+)', t)
    kb = re.search(r'KILLED pid=\d+ between pages, ledger=\{session_id=L2-between, gc_generation=(\d+), gc_cursor=\w+, collected_bytes=(\d+)', t)
    seg = t.split('-- ')
    def block(prefix):
        for b in seg:
            if b.startswith(prefix):
                return b
        return ''
    after_a = re.findall(r'^L1-midpage\tPUBLISHED\t(\d+)\t\d+\t(\d+)\t(\d+)$', block('state right after kill -9 of B'), re.M)
    took_a = re.findall(r'^L1-midpage\t(\d+)\t-\t\w+\t(\d+)\t1\t', block('L1 after takeover'), re.M)
    took_b = re.findall(r'^L2-between\t(\d+)\t-\t\w+\t(\d+)\t1\t', block('L2 after takeover'), re.M)
    rows.append(['E2E-3: kill -9 inside an uncommitted page (a) and between pages (b); another instance resumes (MySQL 8.4.6)',
                 (f"(a) killed with {ka.group(1)} rows modified, uncommitted; after the kill L1 has {after_a[0][0]} rows PUBLISHED, "
                  f"{after_a[0][1]} with bytes, {after_a[0][2]} digests ok; takeover generation {took_a[0][0]} collected {took_a[0][1]} bytes"
                  if ka and after_a and took_a else '(a) not run')
                 + '; ' + (f"(b) killed after a committed page of {kb.group(2)} bytes; takeover generation {took_b[0][0]} brought the total to {took_b[0][1]} bytes"
                           if kb and took_b else '(b) not run')])
out['e2e'] = {'rows': rows}
json.dump(out, open('/Users/wenshao/pr13554-rig/r5/results.json', 'w'), indent=1)
print('migration cells', len(mig), 'it runs', len(it), 'mutants', len(muts), 'race', len(race))
