#!/usr/bin/env python3
"""Run each mutant against the PR's own tests in a hardlinked copy of the head
worktree. Files are replaced via os.replace (new inode) so the hardlinked
originals in /root/verify/pr12353-head are never written.
usage: drive.py <copy-dir> <mutant-id>...   (M00 = unmutated control)"""
import json, os, subprocess, sys, tempfile, time
sys.path.insert(0, os.path.dirname(__file__))
from mutants import MUTANTS

HEAD = os.environ.get('MUT_HEAD', '/root/verify/pr12353-head/')
copy = sys.argv[1].rstrip('/') + '/'
ids = sys.argv[2:]
by_id = {m[0]: m for m in MUTANTS}
OUT = os.environ.get('MUT_OUT', '/root/verify/pr12353-work/mutants/results')
os.makedirs(OUT, exist_ok=True)

ACP = ['src/child-heap-args.test.ts', 'src/child-heap-policy.test.ts', 'src/spawnChannel.test.ts', 'src/process-registry.test.ts']
CLI = ['src/commands/serve.test.ts', 'src/serve/fast-path.test.ts', 'src/serve/idle-acp-reclamation.test.ts',
       'src/serve/run-qwen-serve.test.ts', 'src/serve/daemon-status.test.ts', 'src/serve/acp-http/dispatch-error.test.ts',
       'src/serve/process-env-guard.test.ts', 'src/serve/server.test.ts']

def write_new_inode(path, content):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
    with os.fdopen(fd, 'w') as f:
        f.write(content)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)

def vitest(pkg, files, tag):
    out = f'{OUT}/{tag}-{pkg.split("/")[-1]}.json'
    if os.path.exists(out):
        os.remove(out)
    env = dict(os.environ, CI='true')
    subprocess.run(['npx', 'vitest', 'run', *files, '--reporter=json', f'--outputFile={out}'],
                   cwd=copy + pkg, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1200)
    try:
        r = json.load(open(out))
    except Exception:
        return {'error': 'no report'}
    failed = []
    for f in r['testResults']:
        for a in f['assertionResults']:
            if a['status'] == 'failed':
                failed.append(f['name'].split('/src/')[-1] + ' :: ' + a['fullName'])
        if f.get('status') == 'failed' and not any(a['status'] == 'failed' for a in f['assertionResults']):
            failed.append(f['name'].split('/src/')[-1] + ' :: <suite failed to load> ' + (f.get('message') or '')[:200])
    return {'total': r['numTotalTests'], 'failed': failed}

for mid in ids:
    t0 = time.time()
    rel = None
    if mid != 'M00':
        _, rel, old, new, desc = by_id[mid]
        src = open(HEAD + rel).read()
        assert src.count(old) == 1, (mid, 'pattern')
        write_new_inode(copy + rel, src.replace(old, new, 1))
    try:
        acp = vitest('packages/acp-bridge', ACP, mid)
        cli = vitest('packages/cli', CLI, mid)
    finally:
        if rel:
            write_new_inode(copy + rel, open(HEAD + rel).read())
    res = {'id': mid, 'desc': by_id[mid][4] if mid != 'M00' else 'control', 'file': rel,
           'acp': acp, 'cli': cli, 'secs': round(time.time() - t0)}
    nfail = len(acp.get('failed', [])) + len(cli.get('failed', []))
    res['killed'] = nfail > 0
    json.dump(res, open(f'{OUT}/{mid}.json', 'w'), indent=1)
    print(mid, 'KILLED' if nfail else 'SURVIVED', nfail, res['secs'], 's', flush=True)
