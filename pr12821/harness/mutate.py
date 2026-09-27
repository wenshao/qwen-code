#!/usr/bin/env python3
"""Apply one mutant at a time to the PR head (wt-mut), run the PR's own suites, restore."""
import json, subprocess, sys, time, pathlib

WT = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
ONLY = set(sys.argv[3:])
CORE = 'packages/core/src/managed-runtime/'
CLI = 'packages/cli/src/serve/'
SES = CORE + 'local-shell-result-session.ts'
CAP = CORE + 'local-shell-result-capture.ts'
EXE = CLI + 'managed-runtime-tool-executor.ts'
SHS = 'packages/core/src/services/shellExecutionService.ts'
MUTANTS = [
  ('M01', 'accept() admits a non-complete capture as committed', [(SES, "const decision = complete ? 'committed' : 'blocked';", "const decision = 'committed';")]),
  ('M02', 'advance() resolves await_runtime for a blocked receipt', [(SES, "if (receipt.deliveryStatus !== 'committed') return;", "")]),
  ('M03', 'prepare() skips the await_runtime phase check', [(SES, "checkpoint.continuation.phase !== 'await_runtime' ||", "")]),
  ('M04', 'prepare() accepts a checkpoint from another activation', [(SES, "checkpoint.identity.activationId !== this.activation.activationId ||", "")]),
  ('M05', 'recorded() skips the stored identity comparison', [(SES, "if (JSON.stringify(saved.identity) !== JSON.stringify(identity)) {", "if (false) {")]),
  ('M06', 'accept() skips the re-read digest check', [(SES, "if (hash.digest('hex') !== entry.digest) {", "if (false) {")]),
  ('M07', 'accept() skips the sealed-prefix check', [(SES, "!prefix.result.sealed ||", "")]),
  ('M08', 'finish() seals an incomplete stream', [(CAP, "if (!this.failed && complete) {", "if (!this.failed) {")]),
  ('M09', 'write() ignores the failure latch', [(CAP, "if (this.failed || state.ended) return;", "if (state.ended) return;")]),
  ('M10', 'drain timer keeps running while persistence is pending', [(SHS, "          pendingCaptureWrites++;\n          pauseDrain();", "          pendingCaptureWrites++;")]),
  ('M11', 'inherited pipe tail reported complete', [(SHS, "rawCapture.finish('stdout', stdoutEnded),", "rawCapture.finish('stdout', true),")]),
  ('M12', 'executeV3 skips the args digest check', [(EXE, "if (reference.argsDigest.replace(/^sha256:/, '') !== inputDigest) {", "if (false) {")]),
  ('M13', 'executeV3 admits background Shell', [(EXE, "normalized['is_background'] === true", "normalized['is_background'] === 'never'")]),
  ('M14', 'acknowledgeV3 accepts a different second ACK', [(EXE, "      entry.acknowledgement &&\n      JSON.stringify(entry.acknowledgement) !== JSON.stringify(receipt)", "      false")]),
  ('M15', 'acknowledgeV3 lets committed ACK a non-complete capture', [(EXE, "(actual.captureStatus !== 'complete' ||", "(false ||")]),
  ('M16', 'receipt failure settles instead of unknown', [(EXE, "        entry.state = 'unknown';", "        entry.state = 'settled';")]),
  ('M17', 'v3 routes mounted without an injected publisher', [
      (CLI + 'managed-context-worker.ts', "  if (capturePublisher) {\n    registerManagedRuntimeToolV3Routes", "  if (true) {\n    registerManagedRuntimeToolV3Routes"),
      (CLI + 'managed-runtime-attestation-worker.ts', "? capturePublisher\n          ? [...MANAGED_CONTEXT_WORKER_ROUTES, ...MANAGED_TOOL_RESULT_ROUTES]", "? true\n          ? [...MANAGED_CONTEXT_WORKER_ROUTES, ...MANAGED_TOOL_RESULT_ROUTES]")]),
  ('M18', 'v2 status/cancel ignore v3 journal entries', [(EXE, "    if (entry && entry.version !== 2) {\n      throw new ManagedToolConflictError('Managed Runtime protocol conflicts.');\n    }\n    if (!entry || !sameReference(entry.reference, reference)) {\n      return null;\n    }\n    return view(entry);", "    if (!entry || !sameReference(entry.reference, reference)) {\n      return null;\n    }\n    return view(entry);")]),
]
SUITES = [
  ('packages/core', ['src/managed-runtime/local-shell-result-capture.test.ts', 'src/managed-runtime/local-shell-result-session.test.ts']),
  ('packages/cli', ['src/serve/managed-runtime-tool-v3-routes.test.ts', 'src/serve/managed-context-worker.test.ts']),
]

def run(cmd, cwd):
  return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)

def head():
  return run(['git', 'rev-parse', '--short', 'HEAD'], WT).stdout.strip()

results = []
for mid, desc, edits in MUTANTS:
  if ONLY and mid not in ONLY:
    continue
  assert run(['git', 'status', '--porcelain', '--untracked-files=no'], WT).stdout == '', 'dirty tree'
  for path, old, new in edits:
    p = WT / path
    s = p.read_text()
    assert s.count(old) == 1, (mid, path, s.count(old))
    p.write_text(s.replace(old, new))
  t0 = time.time()
  failed = []
  for pkg, files in SUITES:
    r = run(['npx', 'vitest', 'run', '--coverage.enabled=false', *files], WT / pkg)
    if r.returncode != 0:
      names = sorted({l.strip()[:150] for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith('×') or l.strip().startswith('FAIL ')})
      failed.append(f"{pkg}: " + ('; '.join(names[:3]) or (r.stdout + r.stderr)[-300:]))
  run(['git', 'checkout', '--', '.'], WT)
  row = {'id': mid, 'desc': desc, 'killed': bool(failed), 'secs': round(time.time() - t0), 'head': head(), 'by': failed}
  results.append(row)
  print(json.dumps(row), flush=True)
  with OUT.open('a') as f:
    f.write(json.dumps(row) + '\n')
print(f"killed {sum(r['killed'] for r in results)}/{len(results)}")
