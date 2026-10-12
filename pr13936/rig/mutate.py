#!/usr/bin/env python3
"""Mutation run for PR 13936: each mutant changes one property the PR claims; the PR's own
test files must fail. Each mutant must apply exactly once (fail-closed). Original restored after."""
import json, subprocess, sys, time

WT = '/Users/wenshao/git/pr13936-mut/packages/web-shell'
M = 'client/components/managed/'
TESTS = [M + f for f in ['ManagedTaskPanel.test.tsx', 'use-managed-task-cancel.test.tsx', 'use-managed-tasks.test.tsx',
                         'ManagedSessionsPage.test.tsx', 'java-managed-agent-provider.test.ts', 'java-managed-agent-client.test.ts']] + ['client/i18n.test.ts']
C = M + 'use-managed-task-cancel.ts'
T = M + 'use-managed-tasks.ts'
P = M + 'ManagedTaskPanel.tsx'
S = M + 'ManagedSessionsPage.tsx'
V = M + 'java-managed-agent-provider.ts'
I = M + 'managed-task-messages.ts'

MUTANTS = [
  ('M01 completed command clears at once (renders settled from the command)', C,
   "          if (!accepted) refreshRef.current();\n          accepted = true;",
   "          clear(intent.taskId); refreshRef.current(); return;\n          accepted = true;"),
  ('M02 continue replays with a NEW key', C,
   "      if (intent) return run(intent, !intent.operationId);",
   "      if (intent) return run({ ...intent, idempotencyKey: managedRequestId() }, !intent.operationId);"),
  ('M03 storage failure still sends the POST', C,
   "      if (!save(scope.key, intents)) {",
   "      if (!save(scope.key, intents) && false) {"),
  ('M04 known operation re-POSTs on reload', C,
   "      if (intent.operationId) void run(intent, false);",
   "      if (intent.operationId) void run(intent, true);"),
  ('M05 replay rejection treated as proof of no admission', C,
   "        freshRequest &&\n        !received &&",
   "        !received &&"),
  ('M06 status-regression guard removed', C,
   "        if (accepted && operation.status !== 'completed')\n          throw new Error('Task cancel operation status regressed');",
   ""),
  ('M07 operation failed -> unconfirmed (no failed state)', C,
   "        if (operation.status === 'failed') {",
   "        if (operation.status === 'failed' && false) {"),
  ('M08 recovery_blocked keeps polling as pending', C,
   "        } else if (operation.status === 'recovery_blocked') {",
   "        } else if (operation.status === 'recovery_blocked' && false) {"),
  ('M09 30 s budget not enforced', C,
   "const timer = setTimeout(() => abort.abort(), 30_000);",
   "const timer = setTimeout(() => abort.abort(), 3_000_000);"),
  ('M10 terminal snapshot not required (any task GET settles)', C,
   "          if (isManagedTaskTerminal(task)) {\n            clear(intent.taskId);",
   "          if (true) {\n            clear(intent.taskId);"),
  ('M11 operation identity: operationId mismatch accepted', C,
   "          (intent.operationId && operation.operationId !== intent.operationId)",
   "          false"),
  ('M12 cancelled not terminal', T,
   "return ['completed', 'failed', 'cancelled'].includes(task.state);",
   "return ['completed', 'failed'].includes(task.state);"),
  ('M13 task page identity check removed', T,
   "        if (page.data.some((task) => task.sessionId !== sessionId))\n          throw new Error('Task page identity mismatch');",
   ""),
  ('M14 event identity check removed', T,
   "                throw new Error('Task event identity mismatch');",
   "                void 0;"),
  ('M15 cursor_expired treated as ordinary error', T,
   "                error.code === 'cursor_expired'",
   "                error.code === 'cursor_expired_x'"),
  ('M16 hidden tab keeps polling', T,
   "    if (!open || !visible || !sessionId || !api) return;",
   "    if (!open || !sessionId || !api) return;"),
  ('M17 owner guard dropped on list updates (stale Session paints)', T,
   "          value.owner === owner ? { ...value, ...patch } : value,",
   "          ({ ...value, ...patch }),"),
  ('M18 next() without cursor stack', T,
   "              cursors: [...value.cursors, value.page.nextCursor],",
   "              cursors: [value.page.nextCursor],"),
  ('M19 panel shows non-child tasks', P,
   "  const children = tasks.page.data.filter(\n    (task) => task.kind === 'child_agent',\n  );",
   "  const children = tasks.page.data;"),
  ('M20 cancel button ignores actionCapabilities', P,
   "          task.actionCapabilities.includes('cancel') &&\n          (confirm === task.taskId ? (",
   "          (confirm === task.taskId ? ("),
  ('M21 no inline confirmation (one click cancels)', P,
   "              onClick={() => setConfirm(task.taskId)}",
   "              onClick={() => void cancel.submit(task)}"),
  ('M22 Escape/close does not restore focus (wide)', P,
   "    if (wide) restoreFocus();",
   "    void restoreFocus;"),
  ('M23 entry shown without the tasks capability', S,
   "                (summary.capabilities.tasks === true ||",
   "                (true ||"),
  ('M24 old servers: provider projects tasks:true always', V,
   "      ...(session.capabilities?.tasks === true ? { tasks: true } : {}),",
   "      tasks: true,"),
  ('M25 cancel offered without productScope', V,
   "      ...(options.productScope?.trim()\n        ? {\n            cancel: {",
   "      ...(true\n        ? {\n            cancel: {"),
  ('M26 provider skips task_cancel type check', V,
   "    operation.type !== 'task_cancel' ||\n    operation.sessionId !== sessionId ||",
   "    operation.sessionId !== sessionId ||"),
  ('M27 provider get skips identity check', V,
   "        if (task.sessionId !== sessionId || task.taskId !== taskId)\n          throw new Error('Task identity mismatch');",
   ""),
  ('M28 ZH key dropped (stopping)', I,
   "  'managed.tasks.cancel.stopping': '停止请求已送达，等待任务结束。',",
   ""),
]

def run_tests():
    r = subprocess.run(['npx', 'vitest', 'run', '--config', 'vitest.config.ts', *TESTS], cwd=WT, capture_output=True, text=True)
    out = r.stdout + r.stderr
    import re
    m = re.search(r'Tests\s+(?:(\d+) failed \| )?(\d+) passed', out)
    failed = int(m.group(1) or 0) if m else -1
    passed = int(m.group(2)) if m else -1
    fails = re.findall(r'FAIL\s+(\S+) > (.+)', out)
    return r.returncode, failed, passed, fails[:4], out

only = sys.argv[1:]
rc, f, p, _, _ = run_tests()
print(json.dumps({'baseline': {'rc': rc, 'failed': f, 'passed': p}}), flush=True)
assert rc == 0 and f == 0, 'baseline must be green'
for name, rel, old, new in MUTANTS:
    if only and name.split()[0] not in only: continue
    path = f'{WT}/{rel}'
    src = open(path, encoding='utf8').read()
    n = src.count(old)
    if n != 1:
        print(json.dumps({'mutant': name, 'error': f'pattern count {n}'}), flush=True)
        continue
    open(path, 'w', encoding='utf8').write(src.replace(old, new))
    try:
        rc, f, p, fails, out = run_tests()
        verdict = 'KILLED' if rc != 0 else 'SURVIVED'
        if f == -1 and rc != 0: verdict = 'KILLED(compile/collect)'
        print(json.dumps({'mutant': name, 'verdict': verdict, 'failed': f, 'passed': p, 'by': [x[1][:110] for x in fails]}), flush=True)
    finally:
        open(path, 'w', encoding='utf8').write(src)
assert subprocess.run(['git', 'status', '--porcelain', '--', 'client'], cwd=WT, capture_output=True, text=True).stdout.strip() == '', 'worktree not restored'
print('RESTORED-CLEAN')
