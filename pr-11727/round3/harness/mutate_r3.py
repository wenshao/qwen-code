#!/usr/bin/env python3
"""Round-3 mutation probes at head fd61c750b0 (src only; CLI arms use dist).
Patterns are whitespace-tolerant: every whitespace run in the literal matches \\s+.
Each mutant must match exactly once; the file is restored from pristine bytes."""
import subprocess, pathlib, re, json, sys

WT = pathlib.Path('/root/git/pr11727')
CORE = WT / 'packages/core'
SHELL = 'src/tools/shell.ts'
SCHED = 'src/core/coreToolScheduler.ts'
ST, SCT = ['src/tools/shell.test.ts'], ['src/core/coreToolScheduler.test.ts']
OUT = pathlib.Path('/root/git/h11727/out/mutants-r3')
OUT.mkdir(parents=True, exist_ok=True)


def L(s):
  return r'\s+'.join(re.escape(tok) for tok in s.split())


HALFCAP = 'Math.min(appendedMetadataChars, Math.floor(outputThreshold / 2))'
MUTANTS = [
  ('M1', 'clamp + half-cap removed (== 8ac6e4d602)', SHELL,
   L('Math.max( 1, outputThreshold - ' + HALFCAP + ', )'), '(outputThreshold - appendedMetadataChars)', ST),
  ('M1b', 'half-cap removed (== c2d3c24df8)', SHELL, L(HALFCAP), 'appendedMetadataChars', ST),
  ('M1c', 'clamp removed, half-cap kept', SHELL,
   L('Math.max( 1, outputThreshold - ' + HALFCAP + ', )'), '(outputThreshold - ' + HALFCAP + ')', ST),
  ('M2', 'reservation zeroed', SHELL,
   L('appendedMetadata.reduce( (total, s) => total + APPENDED_METADATA_SEPARATOR.length + s.length, 0, )'), '0', ST),
  ('M2b', 'reservation ignores the separator length', SHELL,
   L('total + APPENDED_METADATA_SEPARATOR.length + s.length'), 'total + s.length', ST),
  ('M3', 'Shell never sets the marker', SHELL, L('outputBudgetApplied = true;'), 'outputBudgetApplied = false;', ST),
  ('M4', 'attribution .slice(0, 120) removed', SHELL,
   L('getErrorMessage(err).slice(0, 120)}.'), 'getErrorMessage(err)}.', ST),
  ('M5', 'success gate ignores marker (call site false)', SCHED,
   L('content, toolResult.outputBudgetApplied === true, ); content = persisted.content;'),
   'content,\n          false,\n        );\n        content = persisted.content;', SCT),
  ('M6', 'gate stand-down line removed', SCHED, L('if (outputBudgetApplied) return { content };'), '', SCT),
  ('M7', 'error gate: marker check dropped', SCHED,
   L('toolResult.outputBudgetApplied === true && errorMessage === toolResult.llmContent;'),
   'errorMessage === toolResult.llmContent;', SCT),
  ('M8', 'error gate: identity check dropped', SCHED,
   L('toolResult.outputBudgetApplied === true && errorMessage === toolResult.llmContent;'),
   'toolResult.outputBudgetApplied === true;', SCT),
  ('M9', 'timeout: re-bound branch never taken', SCHED,
   L('toolResult.outputBudgetApplied === true ? scheduledCall.tool.maxOutputChars : undefined;'), 'undefined;', SCT),
  ('M10', 'timeout: re-bound threshold = Infinity', SCHED,
   L('threshold: markedProducerBudget,'), 'threshold: Number.POSITIVE_INFINITY,', SCT),
  ('M11', 'tri-state helper: [file] arm -> []', SCHED, L('return [truncated.outputFile];'), 'return [];', SCT),
  ('M11b', 'tri-state helper: [] arm -> undefined', SCHED,
   L('return truncated.content !== beforeContent ? [] : undefined;'), 'return undefined;', SCT),
  ('M12', 'timeout: else-branch gate ignores marker', SCHED,
   L('toolResult.llmContent, toolResult.outputBudgetApplied === true, );'),
   'toolResult.llmContent,\n              false,\n            );', SCT),
  ('M13', 'attributionWarning dropped from the metadata list', SHELL,
   L('[longRunHint, attributionWarning].filter('), '[longRunHint].filter(', ST),
]

only = set(sys.argv[1:])
results = []
for mid, desc, rel, pat, repl, tests in MUTANTS:
  if only and mid not in only:
    continue
  f = CORE / rel
  pristine = f.read_bytes()
  text = pristine.decode()
  new, n = re.subn(pat, lambda _m: repl, text)
  if n != 1:
    results.append({'id': mid, 'desc': desc, 'status': f'NOT-APPLIED (matches={n})'})
    print(mid, 'NOT APPLIED', n, flush=True)
    continue
  f.write_text(new)
  try:
    p = subprocess.run(['npx', 'vitest', 'run', *tests], cwd=CORE, capture_output=True, text=True, timeout=900)
  finally:
    f.write_bytes(pristine)
  log = p.stdout + p.stderr
  (OUT / f'{mid}.log').write_text(log)
  m = re.search(r'Tests\s+(?:(\d+) failed \| )?(\d+) passed', log)
  failed = int(m.group(1) or 0) if m else None
  failing = sorted(set(re.findall(r'FAIL\s+\S+ > (.+?)$', log, re.M)))
  status = 'KILLED' if (failed or p.returncode != 0) else 'SURVIVED'
  results.append({'id': mid, 'desc': desc, 'status': status, 'failed': failed, 'failing': failing[:6]})
  print(mid, status, failed, [x.split(' > ')[-1] for x in failing[:2]], flush=True)

tag = '-'.join(sorted(only)) if only else 'all'
(OUT / f'results-{tag}.json').write_text(json.dumps(results, indent=1))
print(subprocess.run(['git', 'status', '--porcelain'], cwd=WT, capture_output=True, text=True).stdout or 'CLEAN')
