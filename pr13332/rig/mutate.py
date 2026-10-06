#!/usr/bin/env python3
"""Single-fix revert mutants for PR 13332, run against the PR's own tests.

Each mutant reverts (or disables) exactly one guard the PR adds, by an anchored
replacement that must match exactly once (fail closed otherwise). The target
test files run with a JSON reporter written to a file; a mutant counts as
KILLED only if the run completed with the expected file count and at least one
test that passes on the clean baseline failed. The tree is restored with
`git checkout -- <file>` after every mutant and verified clean.

usage: mutate.py [mutant-id ...]
"""
import json, os, subprocess, sys, time

WT = '/Users/wenshao/git/pr13332-mut'
OUT = '/Users/wenshao/git/pr13332-rig/results/mutants'
os.makedirs(OUT, exist_ok=True)
C = 'packages/core/src/'
AUTH = C + 'managed-runtime/managed-session-authority.ts'
HTTP = C + 'managed-runtime/http-managed-session-store.ts'
T_AUTH = ('core', 'src/managed-runtime/managed-session-authority.test.ts')
T_SINK = ('core', 'src/managed-runtime/managed-session-record-sink.test.ts')
T_HTTP = ('core', 'src/managed-runtime/http-managed-session-store.test.ts')
T_PROJ = ('core', 'src/managed-runtime/managed-session-message-projection.test.ts')
T_LOG = ('core', 'src/config/managed-session-log.test.ts')
T_REF = ('core', 'src/services/session-legacy-execution-refusal.test.ts')
T_LEASE = ('core', 'src/services/session-writer-lease.test.ts')
T_META = ('core', 'src/managed-runtime/managed-session-metadata.test.ts')
T_SCHED = ('core', 'src/managed-runtime/embedded-harness-scheduler.test.ts')
T_ACT = ('core', 'src/managed-runtime/managed-activation-store.test.ts')
T_HOOK = ('cli', 'src/serve/hosted-hook-session.test.ts')

MUTANTS = [
  # id, finding, file, old, new, tests
  ('M01', 'projection: typed ref check', C + 'managed-runtime/managed-session-message-projection.ts',
   'const body = await resources.read(assertManagedSessionDurableRef(ref, at));',
   'const body = await resources.read(ref as never);', [T_PROJ]),
  ('M02', 'renewal: hold re-check disabled', AUTH,
   'if (input.hold !== undefined && !input.hold(this.activation)) {',
   'if (input.hold !== undefined && false) {', [T_AUTH, T_HOOK]),
  ('M03', 'renewal: hold ignores phase', AUTH,
   "live.phase === 'active' &&\n", '', [T_AUTH, T_HOOK]),
  ('M04', 'renewal: hold ignores activationId', AUTH,
   'live.activationId === current.activationId &&\n', '', [T_AUTH, T_HOOK]),
  ('M05', 'renewal: hold ignores renewalSeq', AUTH,
   'live.renewalSeq === current.renewalSeq,', 'true,', [T_AUTH, T_HOOK]),
  ('M06', 'regressed head: journalRevision clause', HTTP,
   'head.journalRevision < grant.journalRevision ||', 'false ||', [T_HTTP]),
  ('M07', 'regressed head: committedSequence clause', HTTP,
   'head.committedSequence < grant.committedSequence\n', 'false\n', [T_HTTP]),
  ('M08', 'refs: event refs back to deep walk', HTTP,
   'refs: dedupeRefs(\n      eventRecords.flatMap((event) => managedSessionEventRefs(event)),\n    ),',
   'refs: collectRefs(records),', [T_HTTP]),
  ('M09', 'refs: header refs back to deep walk', HTTP,
   'refs: dedupeRefs([\n        header.definitionRef,\n        header.rootSnapshotRef,\n        ...(header.baseTranscriptProof === undefined\n          ? []\n          : [header.baseTranscriptProof]),\n      ]),',
   'refs: collectRefs(records),', [T_HTTP]),
  ('M10', 'marker: isManagedSessionTranscriptSync substring', C + 'utils/sessionStorageUtils.ts',
   'return head !== undefined && headCarriesManagedHeader(head, filePath);',
   'return head?.includes(MANAGED_HEADER_MARKER) === true;', [T_REF]),
  ('M11', 'marker: execution evidence substring', C + 'utils/sessionStorageUtils.ts',
   'headCarriesManagedHeader(head, filePath) ||', 'head.includes(MANAGED_HEADER_MARKER) ||', [T_REF]),
  ('M12', 'marker: \\u-spelled lines not parsed', C + 'utils/sessionStorageUtils.ts',
   "(line.includes(MANAGED_HEADER_MARKER) || line.includes('\\\\u')) &&",
   'line.includes(MANAGED_HEADER_MARKER) &&', [T_REF]),
  ('M13', 'navigation: no daemonPromptId fill', C + 'services/session-transcript-reader.ts',
   "        ...(typeof record.daemonPromptId === 'string' && record.daemonPromptId\n          ? { promptId: record.daemonPromptId }\n          : {}),\n",
   '', [T_LOG]),
  ('M14', 'navigation: turn result overwrites promptId', C + 'services/session-transcript-reader.ts',
   'currentPromptTurn.promptId ??= record.systemPayload.promptId;',
   'currentPromptTurn.promptId = record.systemPayload.promptId;', [T_LOG]),
  ('M15', 'fence: commit funnel skips turn.settled', AUTH,
   "if (event.kind === 'turn.settled') {\n        await this.assertReaderFacingTurnResult",
   "if (event.kind === ('none' as string)) {\n        await this.assertReaderFacingTurnResult", [T_AUTH, T_SINK]),
  ('M16', 'fence: cross-session check removed', AUTH,
   'validated.record.sessionId !== this.sessionKey.sessionId', 'false', [T_AUTH, T_SINK]),
  ('M17', 'fence: cwd check removed', AUTH,
   "typeof candidate?.cwd !== 'string' ||", '', [T_AUTH, T_SINK]),
  ('M18', 'fence: version check removed', AUTH,
   "typeof candidate?.version !== 'string' ||", '', [T_AUTH, T_SINK]),
  ('M19', 'fence: diagnostics ignored', AUTH,
   "typeof candidate?.timestamp !== 'string' ||\n      validated.diagnostics.length > 0",
   "typeof candidate?.timestamp !== 'string'", [T_AUTH, T_SINK]),
  ('M20', 'fence: null resultRef branch removed', AUTH,
   'if (resultRef === null) {', 'if (false) {', [T_AUTH, T_SINK]),
  ('M21', 'envelope: content spread after envelope', AUTH,
   '            ...request.content,\n            operationId: command.commandId,\n            revision,\n            previousRecordRef: previous?.recordRef ?? null,\n',
   '            operationId: command.commandId,\n            revision,\n            previousRecordRef: previous?.recordRef ?? null,\n            ...request.content,\n',
   [T_META]),
  ('M22', 'lease: acquire formatVersion validation', C + 'services/session-writer-lease.ts',
   '!isManagedFormatVersion(lockSchema.formatVersion)', 'false', [T_LEASE]),
  ('M23', 'lease: stale active newer format reclaimed', C + 'services/session-writer-lease.ts',
   'normalizedOptions.lockSchema.formatVersion < state.record.format_version', 'false', [T_LEASE]),
  ('M24', 'lease: sealed newer format adopted', C + 'services/session-writer-lease.ts',
   'options.lockSchema.formatVersion < observed.record.format_version', 'false', [T_LEASE]),
  ('M25', 'scheduler: memory-blocked exit drops wake', C + 'managed-runtime/embedded-harness-scheduler.ts',
   '        // execute() completion is coming to re-arm it (zero or idle active\n        // runs) — reclaimable leases would otherwise wait forever.\n        this.scheduleRecoveryWake();\n',
   '', [T_SCHED]),
  ('M26', 'scheduler: zero-delay spin on expired lease', C + 'managed-runtime/embedded-harness-scheduler.ts',
   'remaining <= 0 ? 1_000 : remaining', 'Math.max(0, remaining)', [T_SCHED]),
  ('M27', 'activation store: enqueue reads live input', C + 'managed-runtime/managed-activation-store.ts',
   'const activation = descriptor(capturedInput);', 'const activation = descriptor(input);', [T_ACT]),
  ('M28', 'activation store: enqueue reads live limits', C + 'managed-runtime/managed-activation-store.ts',
   'const capturedLimits = structuredClone(limits);', 'const capturedLimits = limits;', [T_ACT]),
  ('M29', 'activation store: claim reads live input', C + 'managed-runtime/managed-activation-store.ts',
   'const at = this.getCurrentTime();\n      const activation = identity(captured);', 'const at = this.getCurrentTime();\n      const activation = identity(input);', [T_ACT]),
  ('M30', 'activation store: renew reads live lease', C + 'managed-runtime/managed-activation-store.ts',
   'const currentLease = lease(captured);', 'const currentLease = lease(input);', [T_ACT]),
  ('M31', 'activation store: release reads live lease', C + 'managed-runtime/managed-activation-store.ts',
   'const currentLease = lease(capturedInput);', 'const currentLease = lease(input);', [T_ACT]),
  ('M32', 'activation store: release reads live outcome', C + 'managed-runtime/managed-activation-store.ts',
   'const releaseOutcome = outcome(capturedResult);', 'const releaseOutcome = outcome(result);', [T_ACT]),
  ('M33', 'restore: malformed file_history_snapshot rethrown', C + 'services/session-transcript-reader.ts',
   '      fileHistory.add(record);\n    } catch (error) {\n',
   '      fileHistory.add(record);\n    } catch (error) {\n      if (error) throw error;\n', [T_LOG]),
]


def git(*args):
  return subprocess.run(['git', '-C', WT, *args], capture_output=True, text=True)


def run_tests(tag, tests):
  results = {}
  for pkg in sorted({p for p, _ in tests}):
    files = [f for p, f in tests if p == pkg]
    out = f'{OUT}/{tag}-{pkg}.json'
    if os.path.exists(out):
      os.remove(out)
    subprocess.run(
      ['npx', 'vitest', 'run', *files, '--coverage.enabled=false', '--testTimeout=120000',
       '--reporter=json', f'--outputFile={out}'],
      cwd=f'{WT}/packages/{pkg}', capture_output=True, text=True)
    if not os.path.exists(out):
      results[pkg] = None
      continue
    d = json.load(open(out))
    results[pkg] = {
      'files': len(d['testResults']),
      'total': d['numTotalTests'],
      'failed': sorted(a['fullName'] for r in d['testResults'] for a in r['assertionResults'] if a['status'] == 'failed'),
      'fileErrors': [r['name'] for r in d['testResults'] if r['status'] == 'failed' and not any(a['status'] == 'failed' for a in r['assertionResults'])],
    }
  return results


def main():
  want = set(sys.argv[1:])
  if git('status', '--porcelain', '--', 'packages').stdout.strip():
    sys.exit('mutation tree is not clean; refusing to start')
  baselines = {}
  for mid, finding, path, old, new, tests in MUTANTS:
    if want and mid not in want:
      continue
    key = tuple(sorted(tests))
    if key not in baselines:
      baselines[key] = run_tests('baseline-' + '-'.join(sorted({os.path.basename(f).split('.')[0] for _, f in tests})), tests)
    base = baselines[key]
    full = f'{WT}/{path}'
    src = open(full).read()
    if src.count(old) != 1:
      print(f'{mid}\tANCHOR-MISS\t{src.count(old)}\t{finding}', flush=True)
      continue
    open(full, 'w').write(src.replace(old, new, 1))
    t0 = time.time()
    try:
      res = run_tests(mid, tests)
    finally:
      git('checkout', '--', path)
    if git('status', '--porcelain', '--', 'packages').stdout.strip():
      sys.exit(f'{mid}: tree not clean after restore')
    verdict = 'KILLED'
    killers = []
    for pkg, r in res.items():
      b = base.get(pkg)
      if r is None or b is None or r['files'] != b['files'] or r['total'] != b['total']:
        verdict = 'INVALID'
        continue
      killers += [n for n in r['failed'] if n not in b['failed']]
      if r['fileErrors']:
        killers += ['FILE-ERROR ' + x.split('/')[-1] for x in r['fileErrors']]
    if verdict != 'INVALID' and not killers:
      verdict = 'SURVIVED'
    row = {'id': mid, 'finding': finding, 'verdict': verdict, 'killers': killers,
           'seconds': round(time.time() - t0), 'baselineFailed': {k: v['failed'] for k, v in base.items() if v}}
    with open(f'{OUT}/results.jsonl', 'a') as f:
      f.write(json.dumps(row) + '\n')
    print(f"{mid}\t{verdict}\t{len(killers)}\t{finding}\t{(killers[0][:110] if killers else '')}", flush=True)


main()
