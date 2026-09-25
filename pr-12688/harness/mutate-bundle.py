#!/usr/bin/env python3
"""For the unit-test survivors that change runtime behaviour, rebuild the
bundle with the mutant and run the PR's CLI integration test
(integration-tests/cli/advisor-tool.test.ts) — the file PR CI does not run."""
import json, os, shutil, subprocess, time, sys

ROOT = '/root/verify/pr12688/head'
exec(open('/root/verify/pr12688/harness/mutate.py').read().split('only = set')[0])  # reuse M
WANT = sys.argv[1:] or ['M03', 'M10', 'M16', 'M25', 'M13', 'M02']
ENV = {k: v for k, v in os.environ.items() if k.lower() not in ('http_proxy', 'https_proxy', 'all_proxy')}
ENV['QWEN_SANDBOX'] = 'false'

def sh(cmd, cwd=ROOT, timeout=900):
    p = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, env=ENV, timeout=timeout)
    return p.returncode, p.stdout + p.stderr

def rebuild(pkg):
    if pkg == 'core':
        rc, out = sh('NODE_OPTIONS=--max-old-space-size=6144 npx tsc --build', cwd=os.path.join(ROOT, 'packages/core'))
        if rc != 0:
            return rc, out[-800:]
    rc, out = sh('npm run bundle')
    return rc, out[-800:]

def itest():
    rc, out = sh('npx vitest run --root ./integration-tests ./cli/advisor-tool.test.ts --retry=0 --reporter=verbose')
    failed = [l.strip() for l in out.splitlines() if l.strip().startswith(('×', '✗')) or 'FAIL ' in l][:6]
    passed = sum(1 for l in out.splitlines() if l.strip().startswith('✓') and 'native Advisor tool >' in l)
    return rc, failed, passed

res = []
for mid, pkg, rel, old, new, desc in M:
    if mid not in WANT:
        continue
    path = os.path.join(ROOT, rel)
    src = open(path).read()
    assert src.count(old) == 1, mid
    bak = path + '.mutbak'
    shutil.copy2(path, bak)
    try:
        open(path, 'w').write(src.replace(old, new))
        t0 = time.time()
        rc, out = rebuild(pkg)
        if rc != 0:
            res.append({'id': mid, 'desc': desc, 'status': 'BUILD-FAIL', 'out': out})
            print(mid, 'BUILD-FAIL', out[-300:], flush=True)
            continue
        rc, failed, passed = itest()
        status = 'KILLED' if rc != 0 else 'SURVIVED'
        res.append({'id': mid, 'desc': desc, 'status': status, 'failing': failed, 'passed': passed, 'secs': round(time.time() - t0)})
        print(mid, status, desc, failed[:3], flush=True)
    finally:
        shutil.move(bak, path)

# restore a clean build and prove it is green again
touched = {p for m in M if m[0] in WANT for p in [m[1]]}
if 'core' in touched:
    print('restore core dist', rebuild('core')[0], flush=True)
else:
    print('restore bundle', rebuild('cli')[0], flush=True)
rc, failed, passed = itest()
print('CLEAN', 'PASS' if rc == 0 else 'FAIL', passed, failed, flush=True)
res.append({'id': 'clean', 'status': 'PASS' if rc == 0 else 'FAIL', 'passed': passed})
json.dump(res, open('/root/verify/pr12688/runs/mutation-bundle.json', 'w'), indent=2)
print(sh('git status --short')[1])
