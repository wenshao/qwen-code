#!/usr/bin/env python3
"""Run the four witness tests against the unmutated source (m00) and against each survivor mutant."""
import json, os, shutil, subprocess, sys
sys.path.insert(0, '/root/verify/pr13250/harness')
import mutate

PKG, SRC = mutate.PKG, mutate.SRC
WIT = os.path.join(SRC, '__wit__')
OUT = '/root/verify/pr13250/harness/runs/witness'
TARGETS = ['m00', 'm06', 'm07', 'm09', 'm12']

header = ''.join(open(os.path.join(SRC, 'stream.test.ts')).readlines()[:321])
body = open('/root/verify/pr13250/harness/witness/witness-body.ts').read()
witness = header + body

shutil.rmtree(WIT, ignore_errors=True)
os.makedirs(WIT)
srcs = [f for f in os.listdir(SRC) if f.endswith('.ts') and not f.endswith('.test.ts')]
orig = {f: open(os.path.join(SRC, f)).read() for f in srcs}
spec = {m[0]: m for m in mutate.MUTANTS}
for mid in TARGETS:
    d = os.path.join(WIT, mid)
    os.makedirs(d)
    files = dict(orig)
    if mid != 'm00':
        _, _, f, old, new = spec[mid]
        assert files[f].count(old) == 1, mid
        files[f] = files[f].replace(old, new)
    for f, t in files.items():
        open(os.path.join(d, f), 'w').write(t)
    open(os.path.join(d, 'witness.test.ts'), 'w').write(witness)
os.makedirs(OUT, exist_ok=True)
out = os.path.join(OUT, 'vitest.json')
try:
    subprocess.run(['npx', 'vitest', 'run', 'src/__wit__/', '--reporter=json', f'--outputFile={out}'], cwd=PKG,
                   env=dict(os.environ, CI='true'), capture_output=True, text=True)
    data = json.load(open(out))
finally:
    shutil.rmtree(WIT, ignore_errors=True)
rows = []
for tf in sorted(data['testResults'], key=lambda t: t['name']):
    mid = tf['name'].split('/__wit__/')[1].split('/')[0]
    if not tf['assertionResults']:
        print(mid, 'SUITE ERROR', tf.get('message', '')[:500])
    for a in tf['assertionResults']:
        w = a['title'].split(' ')[0]
        msg = (a.get('failureMessages') or [''])[0].split('\n')[0][:160]
        rows.append({'target': mid, 'witness': w, 'status': a['status'], 'msg': msg})
        print(f"{mid} {w:4} {a['status']:7} {msg}")
json.dump(rows, open(os.path.join(OUT, 'witness.json'), 'w'), indent=2)
print('git status clean:', subprocess.run(['git', 'status', '--porcelain'], cwd=PKG, capture_output=True, text=True).stdout.strip() == '')
