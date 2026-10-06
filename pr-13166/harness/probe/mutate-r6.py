#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13166 round 6): one anchored mutant per fix of 0d6a6307 (R10-1, R11-1, R11-2,
# R11-3) plus the two round-5 survivors (G1, E1). Each mutant edits one file of the head worktree,
# runs the suites that own it, restores the original bytes and asserts a clean `git diff`.
import json, os, subprocess, sys, time, hashlib

W = '/root/verify/pr13166/head'
OUT = '/root/verify/pr13166/rig/out/mutation'
os.makedirs(OUT, exist_ok=True)
EX = 'packages/cli/src/serve/managed-runtime-tool-executor.ts'
CW = 'packages/cli/src/serve/managed-context-worker.ts'
GL = 'packages/core/src/tools/glob.ts'
CLI_SUITES = ['src/serve/managed-context-worker.test.ts', 'src/serve/managed-runtime-tool-executor.test.ts', 'src/serve/hosted-workspace-tool-turn.test.ts']
CORE_SUITES = ['src/tools/glob-search-worker.test.ts', 'src/tools/glob.test.ts']

MUTANTS = [
    ('M1', 'R10-1: rethrow the build failure before the boundary is judged', EX,
     '          buildError = error;\n', '          throw error;\n', 'cli', CLI_SUITES),
    ('M2', 'R11-1: drop the ownership arm from glob input admission', EX,
     '''          escapesSession(path.relative(realRoot, realResolved)) ||
          (await this.ownsAnotherSessionDir?.(
            tools.sessionId,
            realResolved,
            realRoot,
          ))''',
     '''          escapesSession(path.relative(realRoot, realResolved))''', 'cli', CLI_SUITES),
    ('M3', 'R11-2: certify the raw spelling (build lazily after the pin, as before)', EX,
     '''        let globBuildError: unknown;
        try {
          fileInvocation = sessionIdContext.run(sessionId, () =>
            tool.build(params),
          );
        } catch (error) {
          globBuildError = error;
        }''',
     '''        let globBuildError: unknown;''', 'cli', CLI_SUITES),
    ('M4', 'R11-3: restore the own-estate early return (one-directional ownership)', CW,
     '''        (root === undefined || ownDirectory !== root);
      for (const [otherId, binding] of installations.bindings()) {''',
     '''        (root === undefined || ownDirectory !== root);
      if (ownEstate) return false;
      for (const [otherId, binding] of installations.bindings()) {''', 'cli', CLI_SUITES),
    ('G1', 'round-5 carry-over: do not await worker.terminate()', GL,
     '      await worker.terminate();', '      void worker;', 'core', CORE_SUITES),
    ('E1', 'round-5 carry-over: build the Hosted glob without executionTimeoutMs', EX,
     '          executionTimeoutMs: 5_000,\n', '', 'cli', CLI_SUITES),
]

def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()

def run(pkg, suites, tag):
    cwd = f'{W}/packages/{pkg}'
    rep = f'{OUT}/{tag}.json'
    cmd = ['npx', 'vitest', 'run', *suites, '--reporter=json', f'--outputFile={rep}']
    t0 = time.time()
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env={**os.environ, 'CI': 'true'}, timeout=1500)
    open(f'{OUT}/{tag}.log', 'w').write(p.stdout[-20000:] + '\n---stderr---\n' + p.stderr[-20000:])
    try:
        r = json.load(open(rep))
    except Exception as e:
        return {'rc': p.returncode, 'error': str(e), 'secs': round(time.time() - t0)}
    failed = [f"{os.path.basename(t['name'])} :: {a['fullName']}" for t in r['testResults'] for a in t['assertionResults'] if a['status'] == 'failed']
    return {'rc': p.returncode, 'passed': r['numPassedTests'], 'failed': r['numFailedTests'], 'total': r['numTotalTests'], 'failedNames': failed, 'secs': round(time.time() - t0)}

only = set(sys.argv[1:])
ledger = open(f'{OUT}/ledger.jsonl', 'a')
if not only or 'baseline' in only:
    for pkg, suites in (('cli', CLI_SUITES), ('core', CORE_SUITES)):
        res = run(pkg, suites, f'baseline-{pkg}')
        print('baseline', pkg, json.dumps(res)[:400], flush=True)
        ledger.write(json.dumps({'id': f'baseline-{pkg}', **res}) + '\n'); ledger.flush()
for mid, what, rel, old, new, pkg, suites in MUTANTS:
    if only and mid not in only:
        continue
    f = f'{W}/{rel}'
    orig = open(f, encoding='utf8').read()
    before = sha(f)
    n = orig.count(old)
    if n != 1:
        print(mid, 'ANCHOR MATCHED', n, 'times; skipped', flush=True)
        ledger.write(json.dumps({'id': mid, 'what': what, 'skipped': f'anchor x{n}'}) + '\n'); ledger.flush()
        continue
    tmp = f + '.mut'
    open(tmp, 'w', encoding='utf8').write(orig.replace(old, new))
    os.replace(tmp, f)
    try:
        res = run(pkg, suites, mid)
    finally:
        tmp = f + '.orig'
        open(tmp, 'w', encoding='utf8').write(orig)
        os.replace(tmp, f)
    assert sha(f) == before, f'{mid}: restore mismatch'
    clean = subprocess.run(['git', 'diff', '--quiet', '--', rel], cwd=W).returncode == 0
    verdict = 'KILLED' if res.get('failed', 0) > 0 or res.get('rc') not in (0,) else 'SURVIVED'
    row = {'id': mid, 'what': what, 'file': rel, 'verdict': verdict, 'restoredClean': clean, **res}
    print(mid, verdict, json.dumps(res)[:600], flush=True)
    ledger.write(json.dumps(row) + '\n'); ledger.flush()
