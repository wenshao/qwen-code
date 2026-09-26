import sys, os, json, subprocess, shutil, time, hashlib, importlib.util
SP = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('m', os.path.join(SP, sys.argv[2]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
WT = os.path.expanduser(sys.argv[1]); tag = os.environ.get('MUT_TAG', 'x')
env = dict(os.environ)
env['PATH'] = os.path.expanduser('~/.local/share/fnm/node-versions/v22.23.2/installation/bin') + ':' + env['PATH']
results = []
for mid, desc, edits in m.MUTANTS:
    baks = {}
    ok = True
    try:
        for f, old, new, want in edits:
            path = os.path.join(WT, f)
            src = open(path, encoding='utf-8').read()
            n = src.count(old)
            if n != want:
                print(f'{mid}: {f} anchor hits={n} want={want} -> SKIP'); ok = False; break
            if path not in baks:
                baks[path] = path + '.mutbak'; shutil.copy2(path, baks[path])
            open(path, 'w', encoding='utf-8').write(src.replace(old, new))
        if not ok: continue
        h = hashlib.sha256(b''.join(open(p,'rb').read() for p in sorted(baks))).hexdigest()[:12]
        out = os.path.join(SP, f'{tag}-{mid}.json'); log = os.path.join(SP, f'{tag}-{mid}.log')
        t = time.time()
        with open(log, 'w') as fh:
            p = subprocess.run(['npm', 'run', 'test:integration:hosted:sandbox:none', '--', '--reporter=json', f'--outputFile={out}'], cwd=WT, env=env, stdout=fh, stderr=subprocess.STDOUT, timeout=900)
        dt = time.time() - t
        r = json.load(open(out))
        tests = [(a['title'], a['status'], (a.get('failureMessages') or [''])[0].split('\n')[0][:160]) for tr in r['testResults'] for a in tr['assertionResults']]
    finally:
        for path, bak in baks.items(): shutil.copy2(bak, path); os.remove(bak)
    failed = [t for t in tests if t[1] != 'passed']
    verdict = 'KILLED' if failed else 'SURVIVED'
    print(f'{mid} [{h}] {verdict} exit={p.returncode} {dt:.0f}s failed={len(failed)}/{len(tests)} :: {desc}', flush=True)
    for t in failed: print(f'     x {t[0][:90]} | {t[2]}', flush=True)
    results.append({'id': mid, 'desc': desc, 'hash': h, 'verdict': verdict, 'secs': round(dt), 'failed': failed, 'total': len(tests)})
json.dump(results, open(os.path.join(SP, f'results-{tag}.json'), 'w'), indent=1)
