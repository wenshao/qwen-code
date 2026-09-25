#!/usr/bin/env python3
"""Mutation sweep over the PR's production changes, scored by the PR's own
targeted unit tests. Each mutant: back up the file, apply one exact
replacement, run the owning package's targeted tests, restore the backup."""
import json, os, shutil, subprocess, sys, time

ROOT = '/root/verify/pr12688/head'
CORE_TESTS = 'src/tools/advisor.test.ts src/core/advisor-policy.test.ts src/agents/runtime/agent-core.test.ts src/core/coreToolScheduler.test.ts src/config/config.test.ts'
CLI_TESTS = 'src/config/settings.test.ts src/ui/commands/advisor-command.test.ts src/ui/components/AppHeader.test.tsx src/ui/components/messages/ToolMessage.test.tsx src/ui/hooks/useReactToolScheduler.test.tsx src/ui/opentui/event-adapter.test.ts src/ui/opentui/live-session.test.ts'
WS_TESTS = 'client/settings.test.ts client/components/messages/toolFormatting.test.ts'
PKG = {'core': ('packages/core', CORE_TESTS), 'cli': ('packages/cli', CLI_TESTS), 'ws': ('packages/web-shell', WS_TESTS)}

C = 'packages/core/src/'
M = [
  ('M01', 'core', C+'config/config.ts', 'this.advisorUsage.calls += 1;', 'this.advisorUsage = { calls: this.advisorUsage.calls + 1 };', 'counter reassigned -> derived configs shadow it (cap not shared)'),
  ('M02', 'core', C+'config/config.ts', 'if (isSessionTransition) this.advisorUsage = { calls: 0 };', '', 'no reset on a new session'),
  ('M03', 'core', C+'config/config.ts', 'this.advisorMaxUses > 0 &&\n', '', '0 no longer means unlimited'),
  ('M04', 'core', C+'config/config.ts', 'this.advisorUsage.calls >= this.advisorMaxUses', 'this.advisorUsage.calls > this.advisorMaxUses', 'off-by-one: cap N allows N+1'),
  ('M05', 'core', C+'config/config.ts', '    await this.syncAdvisorToolRegistration(registry);', '    if (!options?.forSubAgent) await this.syncAdvisorToolRegistration(registry);', 'subagent registries skip Advisor again'),
  ('M06', 'core', C+'tools/advisor.ts', 'if (getCurrentAgentId() && !agentChat) {', 'if (false) {', 'subagent without bound chat falls back to parent transcript'),
  ('M07', 'core', C+'tools/advisor.ts', '    } catch (error) {\n      if (signal.aborted) throw error;', '    } catch (error) {\n      (this.config as unknown as { advisorUsage: { calls: number } }).advisorUsage.calls -= 1;\n      if (signal.aborted) throw error;', 'failed requests refunded (no longer count)'),
  ('M08', 'core', C+'tools/advisor.ts', '    signal.throwIfAborted();\n', '', 'pre-aborted signal no longer throws'),
  ('M09', 'core', C+'tools/advisor.ts', "      if (!text) throw new Error('Advisor returned no readable guidance.');\n", '', 'empty advice accepted'),
  ('M10', 'core', C+'tools/advisor.ts', "      true,\n      false,\n      'advisor consult", "      false,\n      false,\n      'advisor consult", 'Advisor not deferred'),
  ('M11', 'core', C+'core/advisor-policy.ts', 'const route = names.has(ToolNames.ADVISOR)', 'const route = false', 'always bridge route even when advisor is declared'),
  ('M12', 'core', C+'core/advisor-policy.ts', '  if (!available) return undefined;\n', '', 'reminder emitted when advisor unavailable'),
  ('M13', 'core', C+'agents/runtime/agent-core.ts', 'turnCounter === 1 && this.runtimeContext', 'this.runtimeContext', 'subagent reminder on every turn'),
  ('M14', 'core', C+'agents/runtime/agent-core.ts', ' &&\n                  this.isToolExecutionAllowed(ToolNames.ADVISOR)', '', 'subagent reminder ignores tool allowlist'),
  ('M15', 'core', C+'agents/runtime/agent-core.ts', 'runWithAgentChat(this.executionChat, () =>\n                this.withRuntimeView(fn, inheritedView),\n              );', 'this.withRuntimeView(fn, inheritedView);', 'subagent chat not bound'),
  ('M16', 'core', C+'core/client.ts', '          if (advisorReminder) systemReminders.push(advisorReminder);', "          if (advisorReminder && process.env['NEVER_SET_M16']) systemReminders.push(advisorReminder);", 'executor never gets the reminder'),
  ('M17', 'core', C+'core/coreToolScheduler.ts', '            invocation,\n            response: auxiliaryData', '            response: auxiliaryData', 'errored call drops invocation'),
  ('M18', 'core', C+'tools/tools.ts', "  return display.type === 'advisor_advice'\n    ? display.text", "  return false\n    ? display.text", 'advice text formatted as legacy review'),
  ('M19', 'cli', 'packages/cli/src/config/settingsUtils.ts', "  'advisorModel',\n  'advisorMaxUses',\n", "  'advisorModel',\n", 'workspace may set advisorMaxUses'),
  ('M20', 'cli', 'packages/cli/src/ui/commands/advisor-command.ts', "['interactive', 'non_interactive', 'acp']", "['interactive', 'acp']", '/advisor unavailable non-interactively'),
  ('M21', 'cli', 'packages/cli/src/ui/components/AppHeader.tsx', 'const model = config.getModelsConfig().getModelDisplayName(currentModel);', 'const model = config.getModelDisplayName(); void currentModel;', 'header back to config model'),
  ('M22', 'cli', 'packages/cli/src/ui/hooks/useReactToolScheduler.ts', " &&\n          trackedCall.request.name !== ToolNames.ADVISOR", '', 'failed Advisor call loses model subtitle'),
  ('M23', 'cli', 'packages/cli/src/ui/opentui/live-session.ts', "c.request.modelFacingName === ToolNames.TOOL_CALL &&", "false &&", 'OpenTUI bridged call not relabelled'),
  ('M24', 'cli', 'packages/cli/src/ui/opentui/event-adapter.ts', '  if (isAdvisorDisplay(display)) return formatAdvisorDisplay(display);\n', '', 'OpenTUI advice not formatted'),
  ('M25', 'cli', 'packages/cli/src/config/config.ts', '    advisorMaxUses: settings.advisorMaxUses,\n', '', 'setting not threaded into Config'),
  ('M26', 'cli', 'packages/cli/src/ui/components/messages/ToolMessage.tsx', 'text={formatAdvisorDisplay(effectiveDisplayRenderer.data)}', 'text={JSON.stringify(effectiveDisplayRenderer.data)}', 'Ink advice card shows raw JSON'),
  ('M27', 'ws', 'packages/web-shell/client/settings.ts', "  'setting:advisor-session-call-limit': 'advisorMaxUses',\n", '', 'Web Shell alias removed'),
]

only = set(sys.argv[1:])
results = []
for mid, pkg, rel, old, new, desc in M:
    if only and mid not in only:
        continue
    path = os.path.join(ROOT, rel)
    src = open(path).read()
    n = src.count(old)
    if n != 1:
        results.append({'id': mid, 'desc': desc, 'status': f'APPLY-FAIL(count={n})'})
        print(mid, 'APPLY-FAIL', n, flush=True)
        continue
    bak = path + '.mutbak'
    shutil.copy2(path, bak)
    try:
        open(path, 'w').write(src.replace(old, new))
        cwd, tests = PKG[pkg]
        t0 = time.time()
        p = subprocess.run(f'timeout 900 npx vitest run {tests} --coverage.enabled=false --reporter=dot', shell=True, cwd=os.path.join(ROOT, cwd), capture_output=True, text=True)
        out = p.stdout + p.stderr
        failed = [l.strip() for l in out.splitlines() if l.strip().startswith(('FAIL', '×', '✗')) or ' FAIL ' in l][:4]
        status = 'KILLED' if p.returncode != 0 else 'SURVIVED'
        results.append({'id': mid, 'pkg': pkg, 'desc': desc, 'status': status, 'secs': round(time.time() - t0), 'failing': failed})
        print(mid, status, desc, failed[:2], flush=True)
    finally:
        shutil.move(bak, path)

json.dump(results, open('/root/verify/pr12688/runs/mutation.json' if not only else f'/root/verify/pr12688/runs/mutation-{"_".join(sorted(only))}.json', 'w'), indent=2)
subprocess.run('git -C /root/verify/pr12688/head status --short', shell=True)
