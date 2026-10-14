#!/usr/bin/env python3
"""Single-point mutants of the 309106ee fixes, each run against the focused
regression tests. A mutant is KILLED when the named test fails with an
assertion (not an import/compile error). usage: mutants.py <tree> <outdir>"""
import json, os, re, subprocess, sys

tree, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
S = 'packages/cli/src/acp-integration/session/Session.ts'
TS = 'packages/cli/src/acp-integration/session/team-sink.ts'
TY = 'packages/cli/src/acp-integration/session/types.ts'
MUT = [
  ('M1 R1-1 sink back on the serialized queue', S,
   'requestPermission: (params, signal) =>\n        requestPermissionWithAbort(this.client, params, signal),',
   'requestPermission: (params, signal) =>\n        this.#requestPermissionQueued(params, signal),',
   'src/acp-integration/session/Session.test.ts', 'does not let an unanswered teammate approval wedge'),
  ('M2a R1-2 closing guard restored in #enqueueTeammateMessage', S,
   "    // release drains the queue, so the report still reaches the leader.\n    if (this.disposed) return;",
   "    // release drains the queue, so the report still reaches the leader.\n    if (this.disposed || this.closing) return;",
   'src/acp-integration/session/Session.test.ts', 'still delivers a teammate report that lands inside a reversible close'),
  ('M2b R1-2 closing guard restored in #enqueueTeamRosterChange', S,
   "    // swallow the notice, since the queue is drained when the gate releases.\n    if (this.disposed) return;",
   "    // swallow the notice, since the queue is drained when the gate releases.\n    if (this.disposed || this.closing) return;",
   'src/acp-integration/session/Session.test.ts', 'leader sink|Agent Team|teammate|roster'),
  ('M3 R1-3 post-answer respond rejection routed to fail-closed branch', TS,
   "swallow(error, 'post-answer respond');",
   'throw error;',
   'src/acp-integration/session/team-sink.test.ts', 'does not tell the leader the host failed to answer'),
  ('M4 R1-4 empty subagent_type degrades to "subagent" again', TY,
   'subagentType.trim() || DEFAULT_BUILTIN_SUBAGENT_TYPE',
   "subagentType.trim() || 'subagent'",
   'src/acp-integration/session/types.test.ts', 'deriveSubagentIdentity'),
]
rows = []
env = dict(os.environ); env.pop('QWEN_CODE_SERVE', None); env.pop('QWEN_RUNTIME_DIR', None)
for name, rel, old, new, test, filt in MUT:
  p = os.path.join(tree, rel)
  src = open(p).read()
  assert src.count(old) == 1, (name, src.count(old))
  open(p, 'w').write(src.replace(old, new))
  try:
    r = subprocess.run(['npx', 'vitest', 'run', test, '-t', filt], cwd=os.path.join(tree, 'packages/cli'), env=env, capture_output=True, text=True, timeout=900)
  finally:
    open(p, 'w').write(src)
  log = r.stdout + r.stderr
  tag = re.sub(r'[^A-Za-z0-9]+', '-', name.split(' ')[0])
  open(os.path.join(out, f'{tag}.log'), 'w').write(log)
  failed = re.findall(r'(?:×|FAIL)\s+(.*?)(?:\s+\d+ms)?$', log, re.M)
  counts = re.search(r'Tests\s+(.*)', log)
  assertion = re.search(r'(AssertionError[^\n]*|Expected[^\n]*|expected [^\n]*)', log)
  rows.append({'mutant': name, 'test': test, 'filter': filt, 'exit': r.returncode,
               'killed': r.returncode != 0, 'counts': counts.group(1).strip() if counts else None,
               'failing': failed[:4], 'assertion': assertion.group(1)[:200] if assertion else None})
  print(json.dumps(rows[-1]))
json.dump(rows, open(os.path.join(out, 'mutants.json'), 'w'), indent=1)
