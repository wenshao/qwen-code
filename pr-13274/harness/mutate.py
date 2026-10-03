#!/usr/bin/env python3
"""Targeted mutation matrix for PR #13274 (run in the dedicated mut worktree).

Each mutant replaces one exact snippet (must occur exactly once), runs the
named test files, records failing tests, then restores the original bytes.
"""
import json, os, subprocess, sys

ROOT = '/root/verify/pr13274/mut/packages/core'
OUT = '/root/verify/pr13274/mutants'
os.makedirs(OUT, exist_ok=True)

WS = 'src/agents/runtime/workflow-stall.ts'
RW = 'src/utils/retry-wait.ts'
RT = 'src/utils/retry.ts'
LC = 'src/core/llm-chat.ts'
AC = 'src/agents/runtime/agent-core.ts'
AH = 'src/agents/runtime/agent-headless.ts'
WO = 'src/agents/runtime/workflow-orchestrator.ts'

T_WS = 'src/agents/runtime/workflow-stall.test.ts'
T_RW = 'src/utils/retry-wait.test.ts'
T_RT = 'src/utils/retry.test.ts'
T_LC = 'src/core/llm-chat.test.ts'
T_AH = 'src/agents/runtime/agent-headless.test.ts'
T_WO = 'src/agents/runtime/workflow-orchestrator.test.ts'

M = [
  ('W1 start dedupe removed', WS, "      if (startedWaitIds.has(event.waitId)) return;\n", "", [T_WS, T_AH]),
  ('W2 expired waits never dropped', WS, "      if (until <= now) {", "      if (false) {", [T_WS, T_AH]),
  ('W3 expired wait not adopted as time base', WS, "        lastActivity = Math.max(lastActivity ?? until, until);\n", "", [T_WS, T_AH]),
  ('W4 TOOL_RESULT no longer marks activity', WS, "    inFlightTools = Math.max(0, inFlightTools - 1);\n    markActivity();\n", "    inFlightTools = Math.max(0, inFlightTools - 1);\n", [T_WS, T_AH]),
  ('W5 wait end does not restart window', WS, "      // The resumed request gets a full window from when it actually resumed.\n      markActivity();\n", "", [T_WS, T_AH]),
  ('W6 RETRY_WAIT listener not attached', WS, "  emitter.on(AgentEventType.RETRY_WAIT, onRetryWait);\n", "", [T_WS, T_AH]),
  ('W7 timer chunking removed', WS, "Math.min(due - now, MAX_TIMER_DELAY_MS)", "due - now", [T_WS]),
  ('W8 declared delay inflated x1000', WS, "waits.set(event.waitId, now + event.delayMs);", "waits.set(event.waitId, now + event.delayMs * 1000);", [T_WS, T_AH]),
  ('W9 invalid delays accepted by watchdog', WS, "      if (!Number.isFinite(event.delayMs) || event.delayMs <= 0) return;\n", "", [T_WS]),
  ('W10 RETRY_WAIT listener not detached', WS, "      emitter.off(AgentEventType.RETRY_WAIT, onRetryWait);\n", "", [T_WS]),
  ('R1 iterator next() not bound to observer', RW, "    next: (...args) =>\n      observerStorage.run(observer, () => iterator.next(...args)),", "    next: (...args) => iterator.next(...args),", [T_RW, T_LC, T_AH]),
  ('R2 ender not idempotent', RW, "    if (ended) return;\n", "", [T_RW, T_RT, T_LC, T_AH]),
  ('R3 observer exceptions propagate', RW, "  try {\n    observer(event);\n  } catch (error) {\n    debugLogger.warn('retry wait observer threw (swallowed):', error);\n  }", "  observer(event);", [T_RW, T_RT, T_LC]),
  ('R4 invalid delay announced', RW, "  if (!observer || !Number.isFinite(delayMs) || delayMs <= 0) {", "  if (!observer) {", [T_RW, T_RT, T_LC]),
  ('T1 Retry-After sleep unannounced', RT, "await observedDelay(actualDelayMs, () => delay(actualDelayMs, signal));", "await delay(actualDelayMs, signal);", [T_RT, T_LC]),
  ('T2 persistent sleep unannounced', RT, "await observedDelay(delayMs, () =>\n          sleepWithHeartbeat(", "await ((_d: number, f: () => Promise<void>) => f())(delayMs, () =>\n          sleepWithHeartbeat(", [T_RT]),
  ('T3 content-check sleep unannounced', RT, "await observedDelay(delayMs, () => delay(delayMs, signal));", "await delay(delayMs, signal);", [T_RT]),
  ('T4 wait not ended when the sleep rejects', RT, "  try {\n    await sleep();\n  } finally {\n    endWait();\n  }", "  await sleep();\n  endWait();", [T_RT]),
  ('C1 stream delay() unannounced', LC, "    endWait = beginRetryWait(delayMs);\n", "", [T_LC, T_AH]),
  ('C2 abort does not end the wait', LC, "        clearTimeout(timeoutId);\n        endWait();\n        reject(signal.reason);", "        clearTimeout(timeoutId);\n        reject(signal.reason);", [T_LC]),
  ('C3 resolve/skip does not end the wait', LC, "    resolveRef = () => {\n      endWait();\n      resolve();\n    };", "    resolveRef = () => {\n      resolve();\n    };", [T_LC, T_AH]),
  ('A1 thrown abort not mapped to TIMEOUT', AC, "        if (retryWaitScope?.timedOut()) {\n          terminateMode = AgentTerminateMode.TIMEOUT;\n          break;\n        }\n        throw error;", "        throw error;", [T_AH]),
  ('A2 in-iteration abort always CANCELLED', AC, "              terminateMode: retryWaitScope?.timedOut()\n                ? AgentTerminateMode.TIMEOUT\n                : AgentTerminateMode.CANCELLED,", "              terminateMode: AgentTerminateMode.CANCELLED,", [T_AH]),
  ('A3 close() leaves open waits unended', AC, "        for (const waitId of active) publish({ phase: 'end', waitId });\n", "", [T_AH]),
  ('A4 late callbacks after close() accepted', AC, "      if (closed) return;\n      if (event.phase === 'start') {", "      if (event.phase === 'start') {", [T_AH]),
  ('A5 parent-abort precedence check removed', AC, "          if (roundAbortController.signal.aborted) return;\n", "", [T_AH]),
  ('A6 lazy stream not bound', AC, "? retryWaitScope.bind(await retryWaitScope.run(sendMessage))", "? await retryWaitScope.run(sendMessage)", [T_AH]),
  ('A7 send-time work not observed', AC, "? retryWaitScope.bind(await retryWaitScope.run(sendMessage))", "? retryWaitScope.bind(await sendMessage())", [T_AH]),
  ('A8 deadline measured from round, not start', AC, "        ? startTime + options.maxTimeMinutes * 60 * 1000", "        ? Date.now() + options.maxTimeMinutes * 60 * 1000", [T_AH]),
  ('A9 guard not cleared when last wait ends', AC, "      if (active.size === 0) clearTimer();\n", "", [T_AH]),
  ('A10 duplicate start republished', AC, "        if (active.has(event.waitId)) return;\n", "", [T_AH]),
  ('A11 early-wake re-check removed', AC, "          if (Date.now() < deadline) {\n            armDeadline();\n            return;\n          }\n", "", [T_AH]),
  ('A12 deadline ignores enforce opt-in', AC, "      options?.enforceTimeLimitDuringRetryWait && options.maxTimeMinutes", "      options?.maxTimeMinutes", [T_AH]),
  ('H1 opt-in not threaded to the loop', AH, "            enforceTimeLimitDuringRetryWait,\n          },", "          },", [T_AH]),
  ('O1 fast path drops the opt-in', WO, "subagent.execute(ctx, attemptSignal, {\n          enforceTimeLimitDuringRetryWait: true,\n        }),", "subagent.execute(ctx, attemptSignal),", [T_WO]),
  ('O2 override path drops the opt-in', WO, "subagent.execute(ctx, dispatchSignal, {\n            enforceTimeLimitDuringRetryWait: true,\n          }),", "subagent.execute(ctx, dispatchSignal),", [T_WO]),
]

only = sys.argv[1:]
results = []
for name, rel, old, new, tests in M:
    if only and not any(name.startswith(o) for o in only):
        continue
    path = os.path.join(ROOT, rel)
    orig = open(path, encoding='utf-8').read()
    n = orig.count(old)
    if n != 1:
        results.append({'mutant': name, 'error': f'snippet count {n}'})
        print(name, 'SNIPPET COUNT', n, flush=True)
        continue
    mutated = orig.replace(old, new)
    # Write a new inode so nothing hardlinked is touched.
    tmp = path + '.mut'
    open(tmp, 'w', encoding='utf-8').write(mutated)
    os.replace(tmp, path)
    out_json = os.path.join(OUT, name.split()[0] + '.json')
    try:
        subprocess.run(['npx', 'vitest', 'run', *tests, '--reporter=json', f'--outputFile={out_json}'],
                       cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
    finally:
        tmp = path + '.orig'
        open(tmp, 'w', encoding='utf-8').write(orig)
        os.replace(tmp, path)
    try:
        data = json.load(open(out_json))
        failed = [(r['name'].split('/')[-1], a['fullName']) for r in data['testResults']
                  for a in r['assertionResults'] if a['status'] == 'failed']
        suite_errors = [r['name'].split('/')[-1] for r in data['testResults']
                        if r.get('status') == 'failed' and not r['assertionResults']]
        rec = {'mutant': name, 'tests': len(failed) and 'KILLED' or ('KILLED(suite)' if suite_errors else 'SURVIVED'),
               'failedCount': len(failed), 'total': data['numTotalTests'], 'failed': failed[:8], 'suiteErrors': suite_errors}
    except Exception as e:  # noqa: BLE001
        rec = {'mutant': name, 'error': str(e)}
    results.append(rec)
    print(json.dumps({k: rec.get(k) for k in ('mutant', 'tests', 'failedCount', 'total')}), flush=True)

json.dump(results, open(os.path.join(OUT, 'results.json' if not only else 'results-partial.json'), 'w'), indent=1)
print('MUTATE_DONE', flush=True)
