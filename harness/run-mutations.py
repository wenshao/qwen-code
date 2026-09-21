import subprocess, sys, os, shutil, json, importlib.util
REPO = '/Users/wenshao/git/qwen-12374-head'
spec = importlib.util.spec_from_file_location('mutants', os.path.join(os.path.dirname(__file__), 'mutants.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

TESTS = ['src/utils/housekeeping/cleanup.test.ts', 'src/services/housekeeping/scheduler.test.ts']
CLI = os.path.join(REPO, 'packages/cli')
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')

def run_tests():
    p = subprocess.run(['npx','vitest','run',*TESTS,'--reporter=dot','--coverage.enabled=false'],
                       cwd=CLI, capture_output=True, text=True, env=env, timeout=900)
    return p.returncode, p.stdout + p.stderr

results = []
for mid, rel, old, new, desc in m.MUTANTS:
    path = os.path.join(REPO, rel)
    src = open(path, encoding='utf-8').read()
    if src.count(old) != 1:
        results.append((mid, 'ANCHOR-FAIL', desc, f'occurrences={src.count(old)}'))
        print(mid, 'ANCHOR-FAIL', flush=True); continue
    bak = src
    open(path,'w',encoding='utf-8').write(src.replace(old, new, 1))
    try:
        rc, out = run_tests()
        failed = []
        for line in out.splitlines():
            ls = line.strip()
            if ls.startswith('×') or ls.startswith('FAIL'):
                failed.append(ls[:120])
        status = 'KILLED' if rc != 0 else 'SURVIVED'
        results.append((mid, status, desc, '; '.join(failed[:4])))
        print(f'{mid} {status} :: {desc}', flush=True)
    finally:
        open(path,'w',encoding='utf-8').write(bak)

print('\n=== SUMMARY ===')
for r in results:
    print(' | '.join(str(x)[:150] for x in r))
killed = sum(1 for r in results if r[1]=='KILLED')
print(f'\nkilled {killed}/{len(results)}')
json.dump(results, open(os.path.join(os.path.dirname(__file__),'mutation-results.json'),'w'), indent=2)
