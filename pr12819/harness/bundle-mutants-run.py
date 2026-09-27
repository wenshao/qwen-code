# Bundle mutant runner: applies each mutant to dist/chunks (anchors resolved by
# content, exact hit counts required), runs the Hosted suite from main (7 cases)
# and from this PR (8 cases) against the same mutated bundle, then restores.
import sys, os, json, subprocess, shutil, time, hashlib, glob, importlib.util

SP = os.path.dirname(os.path.abspath(__file__))
WT = os.path.join(os.path.dirname(SP), 'wt')
TEST = os.path.join(WT, 'integration-tests/cli/hosted-harness-process.test.ts')
MAIN_TEST = os.path.join(SP, 'main-hosted-harness-process.test.ts')
tag = os.environ.get('MUT_TAG', 'x')
only = set(sys.argv[2:])
spec = importlib.util.spec_from_file_location('m', os.path.join(SP, sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
env = dict(os.environ)
env['PATH'] = os.path.expanduser('~/.local/share/fnm/node-versions/v22.23.2/installation/bin') + ':' + env['PATH']

_cache = {}
def resolve(old):
    hits = []
    for f in glob.glob(os.path.join(WT, 'dist/**/*.js'), recursive=True):
        if f not in _cache: _cache[f] = open(f, encoding='utf-8').read()
        if old in _cache[f]: hits.append(f)
    if len(hits) != 1: raise SystemExit(f'anchor not unique ({len(hits)}): {old[:80]}')
    return hits[0]

def run_suite(label, mid):
    out = os.path.join(SP, f'{tag}-{mid}-{label}.json'); log = os.path.join(SP, f'{tag}-{mid}-{label}.log')
    t = time.time()
    with open(log, 'w') as fh:
        p = subprocess.run(['npm', 'run', 'test:integration:hosted:sandbox:none', '--', '--reporter=json', f'--outputFile={out}'],
                           cwd=WT, env=env, stdout=fh, stderr=subprocess.STDOUT, timeout=1200)
    dt = time.time() - t
    try:
        r = json.load(open(out))
        tests = [(a['title'], a['status'], ' '.join((a.get('failureMessages') or [''])[0].split('\n')[0:1])[:170])
                 for tr in r['testResults'] for a in tr['assertionResults']]
    except Exception as e:
        tests = [('RUNNER', 'failed', f'no json: {e}')]
    return p.returncode, dt, tests

pr_src = open(TEST, encoding='utf-8').read()
main_src = open(MAIN_TEST, encoding='utf-8').read()
results = []
for mid, desc, edits in m.MUTANTS:
    if only and mid not in only: continue
    baks = {}
    try:
        for old, new, want in edits:
            path = resolve(old)
            src = open(path, encoding='utf-8').read()
            n = src.count(old)
            if n != want: raise SystemExit(f'{mid}: hits={n} want={want} in {path}')
            if path not in baks:
                baks[path] = path + '.mutbak'; shutil.copy2(path, baks[path])
            open(path, 'w', encoding='utf-8').write(src.replace(old, new))
        row = {'id': mid, 'desc': desc}
        for label, src in (('main', main_src), ('pr', pr_src)):
            open(TEST, 'w', encoding='utf-8').write(src)
            code, dt, tests = run_suite(label, mid)
            failed = [t for t in tests if t[1] != 'passed']
            row[label] = {'exit': code, 'secs': round(dt), 'total': len(tests),
                          'passed': sum(t[1] == 'passed' for t in tests), 'failed': failed}
            print(f'{mid} {label:4} exit={code} {dt:.0f}s passed={row[label]["passed"]}/{len(tests)} :: {desc}', flush=True)
            for t in failed: print(f'     x {t[0][:80]} | {t[2]}', flush=True)
        results.append(row)
    finally:
        open(TEST, 'w', encoding='utf-8').write(pr_src)
        for path, bak in baks.items(): shutil.copy2(bak, path); os.remove(bak)
        _cache.clear()
json.dump(results, open(os.path.join(SP, f'results-{tag}.json'), 'w'), indent=1)
