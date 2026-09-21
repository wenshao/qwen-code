# Round 2: replacements scoped to the cleanupOldDebugLogs function body only,
# plus fixture-gap probes.
import subprocess, os, json
REPO = '/Users/wenshao/git/qwen-12374-head'
CLEANUP = 'packages/cli/src/utils/housekeeping/cleanup.ts'
TESTS = ['src/utils/housekeeping/cleanup.test.ts', 'src/services/housekeeping/scheduler.test.ts']
CLI = os.path.join(REPO, 'packages/cli')
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
FN_START = 'export async function cleanupOldDebugLogs('

MUTANTS = [
 ('M5', "if (s.mtime < opts.cutoffDate) {", "if (true) {",
  'ignore the cutoff (every candidate deleted)'),
 ('M6', "if (s.mtime < opts.cutoffDate) {", "if (s.mtime <= opts.cutoffDate) {",
  'boundary: < becomes <='),
 ('M7', "if (isENOENT(e)) return result;", "if (isENOENT(e)) throw e;",
  'missing debug dir throws instead of returning a zero result'),
 ('M8', "if (isENOENT(err)) return;", "if (false) return;",
  'a concurrent delete (ENOENT) is counted as an error'),
 ('M14', "const root = Storage.getGlobalDebugDir();",
         "const root = Storage.getGlobalQwenDir();",
  'sweep the qwen home root instead of the debug dir'),
 ('M15', "for (let i = 0; i < logFiles.length; i += SWEEP_CONCURRENCY) {",
         "for (let i = 0; i < logFiles.length; i += 1000000) {",
  'batching stride made effectively unbounded'),
 ('M17', "const batch = logFiles.slice(i, i + SWEEP_CONCURRENCY);",
         "const batch = logFiles.slice(i, i + SWEEP_CONCURRENCY - 1);",
  'each batch drops its last candidate'),
 ('M18', "for (let i = 0; i < logFiles.length; i += SWEEP_CONCURRENCY) {",
         "for (let i = 0; i < logFiles.length - SWEEP_CONCURRENCY; i += SWEEP_CONCURRENCY) {",
  'trailing partial batch never visited'),
 ('M19', "for (let i = 0; i < logFiles.length; i += SWEEP_CONCURRENCY) {",
         "for (let i = 0; i < logFiles.length; i += SWEEP_CONCURRENCY + 1) {",
  'stride off by one (one candidate skipped per batch boundary)'),
 ('M16', "if (!opts.isValidSessionId(sessionId) || excludes.has(sessionId)) {",
         "if (!opts.isValidSessionId(sessionId) && excludes.has(sessionId)) {",
  '|| becomes && in the skip predicate'),
]

def run_tests():
    p = subprocess.run(['npx','vitest','run',*TESTS,'--reporter=dot','--coverage.enabled=false'],
                       cwd=CLI, capture_output=True, text=True, env=env, timeout=900)
    return p.returncode, p.stdout + p.stderr

path = os.path.join(REPO, CLEANUP)
results = []
for mid, old, new, desc in MUTANTS:
    src = open(path, encoding='utf-8').read()
    i = src.find(FN_START)
    assert i > 0
    head, body = src[:i], src[i:]
    if body.count(old) != 1:
        results.append((mid,'ANCHOR-FAIL',desc,f'in-body occurrences={body.count(old)}'))
        print(mid,'ANCHOR-FAIL',body.count(old), flush=True); continue
    bak = src
    open(path,'w',encoding='utf-8').write(head + body.replace(old,new,1))
    try:
        rc,out = run_tests()
        failed=[l.strip()[:110] for l in out.splitlines() if l.strip().startswith(('×','FAIL'))]
        status = 'KILLED' if rc != 0 else 'SURVIVED'
        results.append((mid,status,desc,'; '.join(failed[:3])))
        print(f'{mid} {status} :: {desc}', flush=True)
    finally:
        open(path,'w',encoding='utf-8').write(bak)

print('\n=== SUMMARY2 ===')
for r in results: print(' | '.join(str(x)[:140] for x in r))
print(f"\nkilled {sum(1 for r in results if r[1]=='KILLED')}/{len(results)}")
json.dump(results, open(os.path.join(os.path.dirname(__file__),os.environ.get('MUT_OUT2','mutation-results2.json')),'w'), indent=2)
