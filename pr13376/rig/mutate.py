#!/usr/bin/env python3
"""Mutants of the PR 13376 replay path, run against the PR's witness tests.

Each mutant applies anchored replacements that must match exactly once inside
the named span (fail closed otherwise). A mutant is KILLED only if the run
completed with the baseline's file and test counts and a test that passes on
the clean baseline failed. The file is restored with `git checkout` after each
mutant and the tree is verified clean.

usage: mutate.py <suite: witness|wide> [mutant-id ...]
"""
import json, os, subprocess, sys, time

WT = '/Users/wenshao/git/pr13376-mut'
OUT = '/Users/wenshao/git/pr13376-rig/results/mutants'
os.makedirs(OUT, exist_ok=True)
AUTH = 'packages/core/src/managed-runtime/managed-session-authority.ts'
SUITES = {
  'witness': ['src/managed-runtime/managed-session-metadata.test.ts',
              'src/managed-runtime/managed-session-record-sink.test.ts'],
  'wide': ['src/managed-runtime', 'src/config/managed-session-log.test.ts'],
}
FN = ('  private replayedDomain(', '  private replayedExtension(')
CDR = ('  async commitDomainRecord(', '  async commitExtensionRecord(')
REPLAY = ('      const replayed = this.replayedDomain(command, request.domain);\n'
          '      if (replayed !== undefined) return replayed;\n')

def move_replay_after(anchor):
  return [(CDR, REPLAY, ''), (CDR, anchor, anchor + REPLAY)]

MUTANTS = [
  ('M01', 'replay check removed from commitDomainRecord', [(CDR, REPLAY, '')]),
  ('M02', 'domain gate hoisted above the replay (PR witness claim)',
   [(CDR, '      this.assertDomainAdmittable(request.domain);\n      // Refused before publishing',
     '      // Refused before publishing'),
    (CDR, REPLAY, '      this.assertDomainAdmittable(request.domain);\n' + REPLAY)]),
  ('M03', 'replay ignores the domain', [(FN, 'committed !== undefined && committed.domain === domain', 'committed !== undefined')]),
  ('M04', 'replay ignores the content digest',
   [(FN, '    if (previous.contentDigest !== command.contentDigest) {', '    if (false) {')]),
  ('M05', 'replay ignores the session key',
   [(FN, 'previous === undefined ||\n      !managedSessionKeysEqual(command.sessionKey, this.sessionKey)', 'previous === undefined')]),
  ('M06', 'no domain event -> fall through instead of refusing',
   [(FN, '    throw new ManagedSessionConflictError(\n      `command ${command.commandId} was committed without a domain record.`,\n    );',
     '    return undefined;')]),
  ('M07', 'replay answers the latest revision', [(FN, 'revision: committed.revision,', 'revision: this.domainRecords.get(domain)!.revision,')]),
  ('M08', 'replay answers the latest recordRef', [(FN, 'recordRef: committed.recordRef,', 'recordRef: this.domainRecords.get(domain)!.recordRef,')]),
  ('M09', 'replay answers the stale committedSequence', [(FN, 'committedSequence: this.committed,', 'committedSequence: previous.receipt.committedSequence,')]),
  ('M10', 'replay not flagged replayed', [(FN, 'replayed: true,', 'replayed: false,')]),
  ('M11', 'domainEvents not rebuilt on cold reopen',
   [(None, '    await authority.rebuildExtensionRecords();\n', '    await authority.rebuildExtensionRecords();\n    authority.domainEvents.clear();\n')]),
  ('M12', 'domainEvents keyed off by one', [(None, 'this.domainEvents.set(event.sequence, ', 'this.domainEvents.set(event.sequence + 1, ')]),
  ('M13', 'replay after the actor/identity checks', move_replay_after('      assertCommandIdentity(command);\n')),
  ('M14', 'replay after the writable check (stopped writer refuses retries)', move_replay_after('      this.assertCommandWritable(command);\n      this.assertExpectedSequence(command);\n      const previous = this.domainRecords.get(request.domain);\n')[:1] +
   [(CDR, '      this.assertCommandWritable(command);\n      this.assertExpectedSequence(command);\n',
     '      this.assertCommandWritable(command);\n' + REPLAY + '      this.assertExpectedSequence(command);\n')]),
  ('M15', 'replay after expectedSequence (the #13345 R3 shape)',
   move_replay_after('      this.assertExpectedSequence(command);\n      const previous = this.domainRecords.get(request.domain);\n')),
  ('M14b', 'isolated: a stopped writer skips the replay (refuses retries)',
   [(CDR, '      const replayed = this.replayedDomain(command, request.domain);\n',
     '      const replayed =\n        this.writeFailure === undefined\n          ? this.replayedDomain(command, request.domain)\n          : undefined;\n')]),
  ('M15b', 'isolated: a stale expectedSequence skips the replay (#13345 R3 shape)',
   [(CDR, '      const replayed = this.replayedDomain(command, request.domain);\n',
     '      const replayed =\n        command.expectedSequence !== undefined &&\n        command.expectedSequence !== this.committed\n          ? undefined\n          : this.replayedDomain(command, request.domain);\n')]),
]


def git(*args):
  return subprocess.run(['git', '-C', WT, *args], capture_output=True, text=True)


def run_tests(tag, files):
  out = f'{OUT}/{tag}.json'
  if os.path.exists(out):
    os.remove(out)
  subprocess.run(['npx', 'vitest', 'run', *files, '--coverage.enabled=false', '--testTimeout=120000',
                  '--reporter=json', f'--outputFile={out}'],
                 cwd=f'{WT}/packages/core', capture_output=True, text=True)
  if not os.path.exists(out):
    return None
  d = json.load(open(out))
  return {
    'files': len(d['testResults']), 'total': d['numTotalTests'],
    'failed': sorted(a['fullName'] for r in d['testResults'] for a in r['assertionResults'] if a['status'] == 'failed'),
    'fileErrors': [r['name'] for r in d['testResults'] if r['status'] == 'failed' and not any(a['status'] == 'failed' for a in r['assertionResults'])],
  }


def apply(src, edits):
  for span, old, new in edits:
    if span is None:
      lo, hi = 0, len(src)
    else:
      lo = src.index(span[0]); hi = src.index(span[1], lo)
    seg = src[lo:hi]
    if seg.count(old) != 1:
      raise ValueError(f'anchor matched {seg.count(old)}x: {old[:60]!r}')
    src = src[:lo] + seg.replace(old, new, 1) + src[hi:]
  return src


def main():
  suite = sys.argv[1]
  want = set(sys.argv[2:])
  if git('status', '--porcelain', '--', 'packages').stdout.strip():
    sys.exit('mutation tree is not clean; refusing to start')
  base = run_tests(f'{suite}-baseline', SUITES[suite])
  print(f"baseline {suite}: files={base['files']} total={base['total']} failed={base['failed']}", flush=True)
  full = f'{WT}/{AUTH}'
  for mid, what, edits in MUTANTS:
    if want and mid not in want:
      continue
    src = open(full).read()
    try:
      mutated = apply(src, edits)
    except ValueError as e:
      print(f'{mid}\tANCHOR-MISS\t{e}\t{what}', flush=True)
      continue
    open(full, 'w').write(mutated)
    t0 = time.time()
    try:
      r = run_tests(f'{suite}-{mid}', SUITES[suite])
    finally:
      git('checkout', '--', AUTH)
    if git('status', '--porcelain', '--', 'packages').stdout.strip():
      sys.exit(f'{mid}: tree not clean after restore')
    if r is None or r['files'] != base['files'] or r['total'] != base['total']:
      verdict, killers = 'INVALID', []
    else:
      killers = [n for n in r['failed'] if n not in base['failed']] + ['FILE-ERROR ' + x.split('/')[-1] for x in r['fileErrors']]
      verdict = 'KILLED' if killers else 'SURVIVED'
    row = {'suite': suite, 'id': mid, 'what': what, 'verdict': verdict, 'killers': killers, 'seconds': round(time.time() - t0)}
    with open(f'{OUT}/results.jsonl', 'a') as f:
      f.write(json.dumps(row) + '\n')
    print(f"{mid}\t{verdict}\t{len(killers)}\t{what}\t{' | '.join(k.split(' > ')[-1][:70] for k in killers[:3])}", flush=True)


main()
