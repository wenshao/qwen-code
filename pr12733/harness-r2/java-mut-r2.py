import os, subprocess, shutil, importlib.util
SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c190ac33-9385-406c-a1c1-f75775d345f5/scratchpad'
WT = os.path.expanduser('~/git/qwen-code-pr12733')
spec = importlib.util.spec_from_file_location('m', SP + '/mut/mutants_r2.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
want = ['M1', 'M2', 'M2b', 'M8', 'M9', 'M10', 'M11', 'M13', 'M19']
for mid, desc, edits in m.MUTANTS:
    if mid not in want: continue
    baks = {}
    try:
        for f, old, new, n in edits:
            p = os.path.join(WT, f); s = open(p).read(); assert s.count(old) == n
            if p not in baks: baks[p] = p + '.jbak'; shutil.copy2(p, baks[p])
            open(p, 'w').write(s.replace(old, new))
        r = subprocess.run([SP + '/java-it.sh', 'r2mut-' + mid, '-Dtest=NoSuchUnitTest', '-Dsurefire.failIfNoSpecifiedTests=false'], capture_output=True, text=True)
        print(f'{mid} :: {desc}\n' + '\n'.join('    ' + l for l in r.stdout.strip().splitlines()), flush=True)
    finally:
        for p, b in baks.items(): shutil.copy2(b, p); os.remove(b)
