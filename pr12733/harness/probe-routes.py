import sys, os, subprocess, shutil, importlib.util
SP = os.path.dirname(os.path.abspath(__file__)); WT = os.path.expanduser('~/git/qwen-code-pr12733')
spec = importlib.util.spec_from_file_location('m', os.path.join(SP, 'mutants2.py')); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
env = dict(os.environ); env['PATH'] = os.path.expanduser('~/.local/share/fnm/node-versions/v22.23.2/installation/bin') + ':' + env['PATH']
def probe(label, mode='hosted'):
    p = subprocess.run(['node', '.probe-routes.mjs', label, mode], cwd=WT, env=env, capture_output=True, text=True, timeout=120)
    print([l for l in (p.stdout + p.stderr).splitlines() if l.startswith('PROBE')] or (p.stdout + p.stderr)[-800:], flush=True)
probe('default-profile', 'default')
probe('pristine')
for mid, desc, edits in m.MUTANTS:
    baks = {}
    try:
        for f, old, new, want in edits:
            path = os.path.join(WT, f); src = open(path).read(); assert src.count(old) == want, (mid, f)
            if path not in baks: baks[path] = path + '.mutbak'; shutil.copy2(path, baks[path])
            open(path, 'w').write(src.replace(old, new))
        probe(mid)
    finally:
        for path, bak in baks.items(): shutil.copy2(bak, path); os.remove(bak)
