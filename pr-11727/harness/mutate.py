#!/usr/bin/env python3
"""Mutation probes on the PR's production hunks at head (src only; the CLI runs use dist).
Each mutant is an exact-string replacement that must match once; the file is restored
from the pristine bytes read before mutation, and the worktree must be clean at the end."""
import subprocess, pathlib, re, json, sys

WT = pathlib.Path('/root/git/pr11727')
CORE = WT / 'packages/core'
SHELL = 'src/tools/shell.ts'
SCHED = 'src/core/coreToolScheduler.ts'
OUT = pathlib.Path('/root/git/h11727/out/mutants')
OUT.mkdir(parents=True, exist_ok=True)

MUTANTS = [
  ('M1', 'clamp removed (== 8ac6e4d602)', SHELL,
   'Math.max(\n        1,\n        outputThreshold - appendedMetadataChars,\n      )',
   '(outputThreshold - appendedMetadataChars)', ['src/tools/shell.test.ts']),
  ('M2', 'metadata reservation zeroed', SHELL,
   '(longRunHint ? longRunHint.length + 2 : 0) +\n      (attributionWarning ? attributionWarning.length + 2 : 0);',
   '0;', ['src/tools/shell.test.ts']),
  ('M3', 'Shell never sets the marker', SHELL,
   'outputBudgetApplied = true;', 'outputBudgetApplied = false;', ['src/tools/shell.test.ts']),
  ('M4', 'attribution .slice(0, 120) removed', SHELL,
   'getErrorMessage(err).slice(0, 120)}', 'getErrorMessage(err)}', ['src/tools/shell.test.ts']),
  ('M5', 'success gate ignores marker (call site false)', SCHED,
   'content,\n          toolResult.outputBudgetApplied === true,\n        );\n        content = persisted.content;',
   'content,\n          false,\n        );\n        content = persisted.content;', ['src/core/coreToolScheduler.test.ts']),
  ('M6', 'gate stand-down line removed', SCHED,
   'if (outputBudgetApplied) return { content };', '', ['src/core/coreToolScheduler.test.ts']),
  ('M7', 'error gate: marker check dropped', SCHED,
   'toolResult.outputBudgetApplied === true &&\n          errorMessage === toolResult.llmContent;',
   'errorMessage === toolResult.llmContent;', ['src/core/coreToolScheduler.test.ts']),
  ('M8', 'error gate: identity check dropped', SCHED,
   'toolResult.outputBudgetApplied === true &&\n          errorMessage === toolResult.llmContent;',
   'toolResult.outputBudgetApplied === true;', ['src/core/coreToolScheduler.test.ts']),
  ('M9', 'timeout: re-bound branch never taken', SCHED,
   'toolResult.outputBudgetApplied === true\n              ? scheduledCall.tool.maxOutputChars\n              : undefined;',
   'undefined;', ['src/core/coreToolScheduler.test.ts']),
  ('M10', 'timeout: re-bound threshold = Infinity', SCHED,
   'threshold: markedProducerBudget,', 'threshold: Number.POSITIVE_INFINITY,', ['src/core/coreToolScheduler.test.ts']),
  ('M11', 'timeout: re-bound spill file not recorded', SCHED,
   'persistedOutputFiles: truncated.outputFile\n                  ? [truncated.outputFile]',
   'persistedOutputFiles: truncated.outputFile\n                  ? []', ['src/core/coreToolScheduler.test.ts']),
  ('M12', 'timeout: else-branch gate ignores marker', SCHED,
   'toolResult.llmContent,\n              toolResult.outputBudgetApplied === true,\n            );',
   'toolResult.llmContent,\n              false,\n            );', ['src/core/coreToolScheduler.test.ts']),
  ('M13', 'reservation: attributionWarning term dropped (R3-2)', SHELL,
   '(longRunHint ? longRunHint.length + 2 : 0) +\n      (attributionWarning ? attributionWarning.length + 2 : 0);',
   '(longRunHint ? longRunHint.length + 2 : 0);', ['src/tools/shell.test.ts']),
  ('M14', 'CANDIDATE FIX: reserve at most half the threshold', SHELL,
   'Math.max(\n        1,\n        outputThreshold - appendedMetadataChars,\n      )',
   'Math.max(\n        1,\n        outputThreshold -\n          Math.min(appendedMetadataChars, Math.floor(outputThreshold / 2)),\n      )',
   ['src/tools/shell.test.ts', 'src/core/coreToolScheduler.test.ts']),
]

only = set(sys.argv[1:])
results = []
for mid, desc, rel, old, new, tests in MUTANTS:
  if only and mid not in only:
    continue
  f = CORE / rel
  pristine = f.read_bytes()
  text = pristine.decode()
  n = text.count(old)
  if n != 1:
    results.append({'id': mid, 'desc': desc, 'status': f'NOT-APPLIED (matches={n})'})
    print(mid, 'NOT APPLIED', n, flush=True)
    continue
  f.write_text(text.replace(old, new))
  try:
    p = subprocess.run(['npx', 'vitest', 'run', *tests], cwd=CORE, capture_output=True, text=True, timeout=900)
  finally:
    f.write_bytes(pristine)
  log = p.stdout + p.stderr
  (OUT / f'{mid}.log').write_text(log)
  m = re.search(r'Tests\s+(?:(\d+) failed \| )?(\d+) passed', log)
  failed = int(m.group(1) or 0) if m else None
  failing = sorted(set(re.findall(r'(?:FAIL|×)\s+.*?> (.+?)(?: \d+ms)?$', log, re.M)))
  status = 'KILLED' if (failed or p.returncode != 0) else 'SURVIVED'
  results.append({'id': mid, 'desc': desc, 'status': status, 'failed': failed, 'failing': failing[:6]})
  print(mid, status, failed, failing[:3], flush=True)

(OUT / 'results.json').write_text(json.dumps(results, indent=1))
print(subprocess.run(['git', 'status', '--porcelain'], cwd=WT, capture_output=True, text=True).stdout or 'CLEAN')
