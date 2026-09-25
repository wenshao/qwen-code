#!/usr/bin/env python3
"""Round 2 (5d59f93): mutants on the two new commits, scored by the PR's
targeted core/cli tests; R2-M01 is additionally checked against tsc because
`readonly` should now reject a reassignment at compile time."""
import os, shutil, subprocess

ROOT = '/root/verify/pr12688/head'
CFG = 'packages/core/src/config/config.ts'
SET = 'packages/cli/src/config/settings.ts'
CORE = ('packages/core', 'src/config/config.test.ts -t Advisor')
CLI = ('packages/cli', 'src/config/settings.test.ts')
M = [
  ('R2-M01', CORE, CFG, 'this.advisorUsage.calls += 1;', 'this.advisorUsage = { calls: this.advisorUsage.calls + 1 };', 'reassign the counter (shadowing on derived configs)'),
  ('R2-M02', CORE, CFG, '      this.advisorUsage.calls = 0;\n', '', 'drop the in-place reset in the transition block'),
  ('R2-M03', CORE, CFG, '      this.advisorUsage.calls = 0;\n    }\n', '    }\n    this.advisorUsage.calls = 0;\n', 'reset outside the transition guard (also on same-id resume)'),
  ('R2-M04', CORE, CFG, '    this.advisorMaxUses = isValidAdvisorMaxUses(params.advisorMaxUses)', '    this.advisorMaxUses = true', 'no validation of the configured value'),
  ('R2-M05', CORE, CFG, '  return Number.isSafeInteger(value) && (value as number) >= 0;', '  return Number.isSafeInteger(value);', 'negative values accepted'),
  ('R2-M06', CLI, SET, '    !isValidAdvisorMaxUses(advisorMaxUses)\n', '    false\n', 'settings warning never emitted'),
  ('R2-M07', CLI, SET, '    advisorMaxUses !== null &&\n', '', 'warn on an explicit null'),
]
for mid, (pkg, tests), rel, old, new, desc in M:
    path = os.path.join(ROOT, rel)
    src = open(path).read()
    n = src.count(old)
    if n != 1:
        print(mid, 'APPLY-FAIL', n); continue
    shutil.copy2(path, path + '.mutbak')
    try:
        open(path, 'w').write(src.replace(old, new))
        p = subprocess.run(f'timeout 900 npx vitest run {tests} --coverage.enabled=false', shell=True, cwd=os.path.join(ROOT, pkg), capture_output=True, text=True)
        out = p.stdout + p.stderr
        fails = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL ')][:2]
        extra = ''
        if mid == 'R2-M01':
            q = subprocess.run('NODE_OPTIONS=--max-old-space-size=6144 timeout 900 npx tsc --noEmit -p .', shell=True, cwd=os.path.join(ROOT, 'packages/core'), capture_output=True, text=True)
            extra = ' | tsc: ' + ('; '.join(l for l in q.stdout.splitlines() if 'error TS' in l)[:200] or f'exit {q.returncode}')
        print(mid, 'KILLED' if p.returncode else 'SURVIVED', '-', desc, fails, extra, flush=True)
    finally:
        shutil.move(path + '.mutbak', path)
print(subprocess.run('git status --short', shell=True, cwd=ROOT, capture_output=True, text=True).stdout or 'clean')
