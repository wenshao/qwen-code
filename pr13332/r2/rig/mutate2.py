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
OUT = '/Users/wenshao/git/pr13332-rig/results/mutants-r2'
os.makedirs(OUT, exist_ok=True)
C = 'packages/core/src/'
AUTH = C + 'managed-runtime/managed-session-authority.ts'
HTTP = C + 'managed-runtime/http-managed-session-store.ts'
REC = C + 'managed-runtime/managed-session-records.ts'
SCHED = C + 'managed-runtime/embedded-harness-scheduler.ts'
ACT = C + 'managed-runtime/managed-activation-store.ts'
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
T_EXT = ('core', 'src/managed-runtime/managed-session-authority.extension.test.ts')

MUTANTS = [
  # ---- carried over from round 1, re-anchored ----
  ('M01', 'projection: typed ref check', C + 'managed-runtime/managed-session-message-projection.ts',
   'assertManagedSessionDurableRef(ref, at),\n  );\n  return JSON.parse', 'ref as never,\n  );\n  return JSON.parse', [T_PROJ]),
  ('M02', 'renewal: hold re-check disabled', AUTH,
   'if (input.hold !== undefined && !input.hold(this.activation)) {',
   'if (input.hold !== undefined && false) {', [T_AUTH, T_HOOK]),
  ('M03', 'renewal: hold ignores phase', AUTH, "live.phase === 'active' &&\n", '', [T_AUTH, T_HOOK]),
  ('M04', 'renewal: hold ignores activationId', AUTH,
   'live.activationId === current.activationId &&\n        live.epoch === current.epoch &&\n        live.renewalSeq',
   'live.epoch === current.epoch &&\n        live.renewalSeq', [T_AUTH, T_HOOK]),
  ('M05', 'renewal: hold ignores renewalSeq', AUTH, 'live.renewalSeq === current.renewalSeq,', 'true,', [T_AUTH, T_HOOK]),
  ('M06', 'regressed head: journalRevision clause', HTTP, 'head.journalRevision < grant.journalRevision ||', 'false ||', [T_HTTP]),
  ('M07', 'regressed head: committedSequence clause', HTTP, 'head.committedSequence < grant.committedSequence\n', 'false\n', [T_HTTP]),
  ('M08', 'refs: event refs back to deep walk', HTTP,
   'refs: dedupeRefs(\n      eventRecords.flatMap((event) => managedSessionEventRefs(event)),\n    ),',
   'refs: collectRefs(records),', [T_HTTP]),
  ('M09', 'refs: header refs back to deep walk', HTTP,
   'refs: dedupeRefs([\n        header.definitionRef,\n        header.rootSnapshotRef,\n        ...(header.baseTranscriptProof === undefined\n          ? []\n          : [header.baseTranscriptProof]),\n      ]),',
   'refs: collectRefs(records),', [T_HTTP]),
  ('M10', 'marker: header scan back to substring', C + 'utils/sessionStorageUtils.ts',
   'return head !== undefined && headCarriesManagedHeader(head, filePath);',
   'return head?.includes(MANAGED_HEADER_MARKER) === true;', [T_REF]),
  ('M11', 'marker: execution evidence header by substring', C + 'utils/sessionStorageUtils.ts',
   '      records.some(isManagedHeaderRecord) || records.some(isManagedOwnerRecord)',
   '      line.includes(MANAGED_HEADER_MARKER) || records.some(isManagedOwnerRecord)', [T_REF]),
  ('M12', 'marker: \\u-spelled lines not parsed', C + 'utils/sessionStorageUtils.ts',
   "    if (!line.includes(MANAGED_HEADER_MARKER) && !line.includes('\\\\u')) {",
   '    if (!line.includes(MANAGED_HEADER_MARKER)) {', [T_REF]),
  ('M13', 'navigation: no daemonPromptId fill', C + 'services/session-transcript-reader.ts',
   "        ...(typeof record.daemonPromptId === 'string' && record.daemonPromptId\n          ? { promptId: record.daemonPromptId }\n          : {}),\n", '', [T_LOG]),
  ('M14', 'navigation: turn result overwrites promptId', C + 'services/session-transcript-reader.ts',
   'currentPromptTurn.promptId ??= record.systemPayload.promptId;', 'currentPromptTurn.promptId = record.systemPayload.promptId;', [T_LOG]),
  ('M15', 'fence: commit funnel skips every channel', AUTH,
   '    for (const event of events) {\n      await this.assertReaderFacingBody(event);\n    }\n', '', [T_AUTH, T_SINK, T_EXT, T_META]),
  ('M16', 'predicate: cross-session check removed', REC,
   'if (record !== undefined && record.sessionId !== sessionId) {', 'if (false) {', [T_AUTH, T_SINK, T_PROJ]),
  ('M17', 'predicate: cwd check removed', REC, "    typeof candidate?.cwd !== 'string' ||\n", '', [T_AUTH, T_SINK, T_PROJ]),
  ('M18', 'predicate: version check removed', REC, "    typeof candidate?.version !== 'string' ||\n", '', [T_AUTH, T_SINK, T_PROJ]),
  ('M19', 'predicate: diagnostics ignored', REC,
   "    typeof candidate?.timestamp !== 'string' ||\n    diagnostics.length > 0", "    typeof candidate?.timestamp !== 'string'", [T_AUTH, T_SINK, T_PROJ]),
  ('M20', 'fence: null ref branch removed', AUTH, '    if (carried.ref === null) {', '    if (false) {', [T_AUTH, T_SINK]),
  ('M21', 'envelope: content spread after envelope', AUTH,
   '            ...request.content,\n            operationId: command.commandId,\n            revision,\n            previousRecordRef: previous?.recordRef ?? null,\n',
   '            operationId: command.commandId,\n            revision,\n            previousRecordRef: previous?.recordRef ?? null,\n            ...request.content,\n', [T_META]),
  ('M22', 'lease: acquire formatVersion validation', C + 'services/session-writer-lease.ts', '!isManagedFormatVersion(lockSchema.formatVersion)', 'false', [T_LEASE]),
  ('M23', 'lease: stale active newer format reclaimed', C + 'services/session-writer-lease.ts', 'normalizedOptions.lockSchema.formatVersion < state.record.format_version', 'false', [T_LEASE]),
  ('M24', 'lease: sealed newer format adopted', C + 'services/session-writer-lease.ts', 'options.lockSchema.formatVersion < observed.record.format_version', 'false', [T_LEASE]),
  ('M25', 'scheduler: blocked exit arms no wake', SCHED, '        this.armBlockedWake();\n        return;', '        return;', [T_SCHED]),
  ('M26', 'scheduler: zero-delay spin on expired lease', SCHED, 'Math.min(remaining <= 0 ? 1_000 : remaining, 2_147_483_647)', 'Math.min(Math.max(0, remaining), 2_147_483_647)', [T_SCHED]),
  ('M27', 'activation store: enqueue reads live input', ACT, 'const activation = descriptor(capturedInput);', 'const activation = descriptor(input);', [T_ACT]),
  ('M28', 'activation store: enqueue reads live limits', ACT, 'const capturedLimits = structuredClone(limits);', 'const capturedLimits = limits;', [T_ACT]),
  ('M29', 'activation store: claim reads live input', ACT,
   'const at = this.getCurrentTime();\n      const activation = identity(captured);', 'const at = this.getCurrentTime();\n      const activation = identity(input);', [T_ACT]),
  ('M30', 'activation store: renew reads live lease', ACT, 'const currentLease = lease(captured);', 'const currentLease = lease(input);', [T_ACT]),
  ('M31', 'activation store: release reads live lease', ACT, 'const currentLease = lease(capturedInput);', 'const currentLease = lease(input);', [T_ACT]),
  ('M32', 'activation store: release reads live outcome', ACT, 'const releaseOutcome = outcome(capturedResult);', 'const releaseOutcome = outcome(result);', [T_ACT]),
  ('M33', 'restore: malformed file_history_snapshot rethrown', C + 'services/session-transcript-reader.ts',
   '      fileHistory.add(record);\n    } catch (error) {\n', '      fileHistory.add(record);\n    } catch (error) {\n      if (error) throw error;\n', [T_LOG]),
  # ---- new in round 2 ----
  ('N01', 'fence: reads chunk manifest, not the message (be6fb30d revert)', AUTH,
   '    const body = await readManagedMessageBody(\n      (bodyRef) => store.read(bodyRef),\n      ref,\n    ).catch(',
   '    const body = await store.read(ref).catch(', [T_AUTH, T_SINK, T_HTTP, T_EXT, T_META, T_PROJ, T_LOG]),
  ('N02', 'fence: message.committed channel skipped', AUTH,
   '    if (carried === undefined) return;\n    const noun',
   "    if (carried === undefined || event.kind === 'message.committed') return;\n    const noun", [T_AUTH, T_SINK, T_EXT, T_META]),
  ('N03', 'fence: context.compacted channel skipped', AUTH,
   '    if (carried === undefined) return;\n    const noun',
   "    if (carried === undefined || event.kind === 'context.compacted') return;\n    const noun", [T_AUTH, T_SINK, T_EXT, T_META]),
  ('N04', 'fence: domain record channel skipped', AUTH,
   '    if (carried === undefined) return;\n    const noun',
   "    if (carried === undefined || event.kind === 'domain.committed') return;\n    const noun", [T_AUTH, T_SINK, T_EXT, T_META]),
  ('N05', 'fence: strict wire decode restored (R4-1 revert)', AUTH,
   "      value = JSON.parse(body.toString('utf8'));",
   "      value = parseManagedSessionRecordJson(body.toString('utf8'), body.length);", [T_AUTH, T_SINK]),
  ('N06', 'fence: null domain envelope unguarded (R5-1)', AUTH,
   '        ? value !== null && typeof value === \'object\'\n          ? (value as { readonly record?: unknown }).record\n          : undefined\n        : value,',
   '        ? (value as { readonly record?: unknown }).record\n        : value,', [T_AUTH, T_SINK]),
  ('N07', 'reader: null domain envelope unguarded (R5-1)', C + 'managed-runtime/managed-session-message-projection.ts',
   '          ? body !== null && typeof body === \'object\'\n            ? (body as { readonly record?: unknown }).record\n            : undefined\n          : body,',
   '          ? (body as { readonly record?: unknown }).record\n          : body,', [T_PROJ]),
  ('N08', 'commitDomainRecord: no pre-publish validation (R3-6)', AUTH,
   'if (managedSessionDomainCarriesRecord(request.domain)) {', 'if (false) {', [T_AUTH, T_EXT, T_META]),
  ('N09', 'release hold: identity conjuncts dropped (R3-1)', AUTH,
   '        live !== undefined &&\n        live.activationId === current.activationId &&\n        live.epoch === current.epoch,\n',
   '        live !== undefined,\n', [T_AUTH, T_HOOK]),
  ('N10', 'release hold: recoveryBlocked ignored (R1-12)', AUTH,
   '      hold: (live) =>\n        !this.recoveryBlocked &&\n        live !== undefined &&\n        live.activationId',
   '      hold: (live) =>\n        live !== undefined &&\n        live.activationId', [T_AUTH, T_HOOK]),
  ('N11', 'renewal hold: recoveryBlocked ignored (R1-12)', AUTH,
   "      hold: (live) =>\n        !this.recoveryBlocked &&\n        live !== undefined &&\n        live.phase",
   "      hold: (live) =>\n        live !== undefined &&\n        live.phase", [T_AUTH, T_HOOK]),
  ('N12', 'scheduler: blocked backoff never grows', SCHED,
   'Math.min(this.memoryBlockedPollMs * 2, MEMORY_BLOCKED_POLL_MAX_MS)', 'this.memoryBlockedPollMs', [T_SCHED]),
  ('N13', 'scheduler: carried restart ignored', SCHED, 'if (options?.restartBlockedCadence === true) {', 'if (false) {', [T_SCHED]),
  ('N14', 'scheduler: clearMemoryBlocked keeps backoff', SCHED,
   '    this.memoryBlocked = false;\n    this.memoryBlockedPollMs = MEMORY_BLOCKED_POLL_MS;\n', '    this.memoryBlocked = false;\n', [T_SCHED]),
  ('N15', 'scheduler: lease wake inside grown window', SCHED,
   '(remaining <= 0 || remaining > MEMORY_BLOCKED_POLL_MS)', '(remaining <= 0 || remaining > blockedPollMs)', [T_SCHED]),
  ('N16', 'scheduler: empty queue keeps memory block', SCHED,
   '        this.clearMemoryBlocked();\n        this.scheduleRecoveryWake();\n        return;', '        this.scheduleRecoveryWake();\n        return;', [T_SCHED]),
  ('N17', 'domain body reader: substring classification (R1-20)', C + 'utils/sessionStorageUtils.ts',
   '    if (header === undefined) return undefined;\n',
   '    if (header === undefined) return headText.includes(MANAGED_HEADER_MARKER) ? {} : undefined;\n', [T_META, T_LOG]),
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
