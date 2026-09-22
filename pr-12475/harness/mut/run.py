import json, os, re, shutil, subprocess, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from mutants import MUTANTS
HEAD = os.environ.get('MUT_SRC', '/root/verify/pr12475-head'); MUT = os.environ.get('MUT_DIR', '/root/verify/pr12475-mut')
OUT = os.environ.get('MUT_OUT', '/root/verify/pr12475-logs/mut'); os.makedirs(OUT, exist_ok=True)
only = sys.argv[1].split(',') if len(sys.argv) > 1 else None

def fresh(f):
    dst = os.path.join(MUT, f)
    os.remove(dst); shutil.copy2(os.path.join(HEAD, f), dst)  # new inode, never writes through the hardlink

def run_suite(suite, tag):
    pkg, files = suite
    log = os.path.join(OUT, f'{tag}.json')
    if os.path.exists(log): os.remove(log)
    cmd = ['npx', 'vitest', 'run', *files, '--reporter=json', f'--outputFile={log}']
    t = time.time()
    p = subprocess.run(cmd, cwd=os.path.join(MUT, pkg), env={**os.environ, 'CI': 'true'}, capture_output=True, text=True, timeout=900)
    try:
        j = json.load(open(log))
    except Exception:
        return {'error': p.stdout[-800:] + p.stderr[-800:]}
    failed = [f"{os.path.basename(r['name'])} :: {a['fullName']}" for r in j['testResults'] for a in r['assertionResults'] if a['status'] == 'failed']
    return {'passed': j['numPassedTests'], 'failed': j['numFailedTests'], 'failedNames': failed, 'sec': round(time.time() - t, 1), 'suiteErrors': [r['message'][:300] for r in j['testResults'] if r.get('status') == 'failed' and not r['assertionResults']]}

results = []
controls = {}
for mid, f, old, new, suite, desc in MUTANTS:
    if only and mid not in only: continue
    key = suite[0] + '|' + ','.join(suite[1])
    if key not in controls:
        controls[key] = run_suite(suite, 'control-' + re.sub(r'\W', '_', key))
        print('CONTROL', key, {k: v for k, v in controls[key].items() if k != 'failedNames'}, flush=True)
    src = open(os.path.join(HEAD, f)).read()
    n = src.count(old)
    if n != 1:
        print(mid, 'PATTERN COUNT', n); results.append({'id': mid, 'error': f'pattern count {n}'}); continue
    fresh(f)
    open(os.path.join(MUT, f), 'w').write(src.replace(old, new))
    try:
        r = run_suite(suite, mid)
    finally:
        fresh(f)
    killed = r.get('failed', 0) > 0 or bool(r.get('suiteErrors'))
    results.append({'id': mid, 'file': f, 'desc': desc, 'killed': killed, **r})
    print(mid, 'KILLED' if killed else 'SURVIVED', r.get('failed'), '|', desc, '|', r.get('failedNames', [])[:3], r.get('suiteErrors', [])[:1], flush=True)
json.dump({'controls': controls, 'results': results}, open(os.path.join(OUT, f'results-{int(time.time())}.json'), 'w'), indent=1)
# sanity: the mutation copy must be byte-identical to head again
for _, f, *_ in MUTANTS:
    assert open(os.path.join(MUT, f)).read() == open(os.path.join(HEAD, f)).read(), f
print('RESTORED-OK')
