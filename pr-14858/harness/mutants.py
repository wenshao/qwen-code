#!/usr/bin/env python3
"""Targeted mutants for PR #14858. Each mutant edits one production file in the
hardlinked copy wt-mut (breaking the link via os.replace), runs the PR's tests
for that file, records killed/survived, and restores the original from wt-head.

usage: python3 -I mutants.py [ids...]
"""
import json
import os
import shutil
import subprocess
import sys

H = '/root/verify/pr14858/wt-head'
M = '/root/verify/pr14858/wt-mut'
OUT = '/root/verify/pr14858/mutants'
os.makedirs(OUT, exist_ok=True)

CORE = 'packages/core/src'
CLI = 'packages/cli/src'

MUTANTS = [
    # id, file, [(old, new, count)], package dir, test files, what it breaks
    ('M01', f'{CORE}/services/loopDetectionService.ts', [(
        """  if (totalCalls > hardCap) {
    return { reason: LoopReason.BACKSTOP, limit: hardCap };
  }
  if (maxKeyRepeat >= GLOBAL_DUPLICATE_THRESHOLD) {
    return { reason: LoopReason.STUCK_REPETITION, limit: cap };
  }""",
        """  if (maxKeyRepeat >= GLOBAL_DUPLICATE_THRESHOLD) {
    return { reason: LoopReason.STUCK_REPETITION, limit: cap };
  }
  if (totalCalls > hardCap) {
    return { reason: LoopReason.BACKSTOP, limit: hardCap };
  }""", 1)], 'packages/core', ['src/services/loopDetectionService.test.ts'],
     'cap classifier: stuck wins over backstop'),
    ('M02', f'{CORE}/services/loopDetectionService.ts', [(
        """    return this.lastLoopDetail &&
      this.lastLoopDetail.loopType === this.lastLoopType
      ? this.lastLoopDetail.detail""",
        """    return this.lastLoopDetail
      ? this.lastLoopDetail.detail""", 1)], 'packages/core', ['src/services/loopDetectionService.test.ts'],
     'detail not guarded by the current loop type (stale detail)'),
    ('M03', f'{CORE}/services/loopDetectionService.ts', [(
        "      new LoopDetectedEvent(loopType, this.promptId, detail),",
        "      new LoopDetectedEvent(loopType, this.promptId),", 1)], 'packages/core', ['src/services/loopDetectionService.test.ts'],
     'core telemetry event loses the detail'),
    ('M04', f'{CORE}/services/loopDetectionService.ts', [(
        "      toolCallLimit: halt.limit,",
        "      toolCallLimit: this.config.getMaxToolCallsPerTurn(),", 1)],
     'packages/core', ['src/services/loopDetectionService.test.ts'],
     'core reports the soft cap as the backstop limit'),
    ('M05', f'{CORE}/core/client.ts', [(
        "value: { loopType, ...this.loopDetector.getLastLoopDetail() },",
        "value: { loopType },", 3)], 'packages/core', ['src/core/client.test.ts'],
     'LoopDetected stream event drops the detail (all three sites)'),
    ('M06', f'{CORE}/telemetry/qwen-logger/qwen-logger.ts', [(
        """        ...(event.loop_reason !== undefined
          ? { loop_reason: event.loop_reason }
          : {}),""", "", 1)], 'packages/core', ['src/telemetry/qwen-logger/qwen-logger.test.ts', 'src/telemetry/loggers.test.ts'],
     'RUM loop_detected drops loop_reason'),
    ('M07', f'{CLI}/utils/loop-detected-message.ts', [(
        """    case LoopReason.REPEATED_CALL:
      return HEURISTIC_HINT;""", """    case LoopReason.REPEATED_CALL:
      return ALWAYS_ON_HINT;""", 1)], 'packages/cli', ['src/utils/loop-detected-message.test.ts'],
     'heuristic duplicate keeps the old (wrong) always-on hint'),
    ('M08', f'{CLI}/nonInteractiveCli.ts', [(
        """              loopDetectedMessage = emitLoopDetectedMessage(
                config,
                event.value,
              );""", """              loopDetectedMessage = emitLoopDetectedMessage(
                config,
                event.value && { loopType: event.value.loopType },
              );""", 1)], 'packages/cli', ['src/nonInteractiveCli.test.ts'],
     'headless main loop passes only loopType'),
    ('M09', f'{CLI}/nonInteractiveCli.ts', [(
        "  loopReason: LoopReason.PROVIDER_DUPLICATE_ID,\n};", "};", 1)], 'packages/cli', ['src/nonInteractiveCli.test.ts'],
     'headless provider breaker loses its reason'),
    ('M10', f'{CLI}/ui/hooks/use-llm-stream.ts', [(
        "              loopStopRef.current = event.value;\n", "", 1)], 'packages/cli', ['src/ui/hooks/use-llm-stream.test.tsx'],
     'TUI ignores the LoopDetected value'),
    ('M11', f'{CLI}/ui/hooks/use-llm-stream.ts', [(
        """          loopStopRef.current = {
            loopType: LoopType.GLOBAL_TOOL_CALL_DUPLICATE,
            loopReason: LoopReason.PROVIDER_DUPLICATE_ID,
          };""", "", 1)], 'packages/cli', ['src/ui/hooks/use-llm-stream.test.tsx'],
     'TUI provider breaker sets no stop'),
    ('M12', f'{CLI}/ui/components/LoopDetectionConfirmation.tsx', [(
        "<Text color={theme.text.primary}>Cause: {quotedCause}.</Text>", "<Text color={theme.text.primary}>{''}</Text>", 1)],
     'packages/cli', ['src/ui/components/LoopDetectionConfirmation.test.tsx'], 'dialog hides the cause'),
    ('M13', f'{CLI}/ui/components/LoopDetectionConfirmation.tsx', [(
        "cause?.replace(/`([^`]+)`/g, '\"$1\"')", "cause", 1)],
     'packages/cli', ['src/ui/components/LoopDetectionConfirmation.test.tsx'], 'dialog keeps raw backticks'),
    ('M14', f'{CLI}/ui/opentui/event-adapter.ts', [(
        """          text: formatInteractiveLoopDetectedMessage(
            ev.value as LoopStop | undefined,
          ),""", """          text: formatInteractiveLoopDetectedMessage(undefined),""", 1)],
     'packages/cli', ['src/ui/opentui/event-adapter.test.ts'], 'OpenTUI ignores the stop'),
    ('M15', f'{CLI}/acp-integration/session/Session.ts', [(
        "          { loopDetail: { loopReason: LoopReason.PROVIDER_DUPLICATE_ID } },\n", "", 1)],
     'packages/cli', ['src/acp-integration/session/Session.test.ts'], 'daemon provider breaker loses its reason'),
    ('M16', f'{CLI}/acp-integration/session/Session.ts', [(
        "    ...(detail?.loopReason ? { loopReason: detail.loopReason } : {}),\n", "", 1)],
     'packages/cli', ['src/acp-integration/session/Session.test.ts'], 'daemon turn_error data drops loopReason'),
    ('M17', f'{CLI}/acp-integration/session/Session.ts', [(
        "          toolCallLimit: capHalt.limit,", "          toolCallLimit: config.getMaxToolCallsPerTurn(),", 1)],
     'packages/cli', ['src/acp-integration/session/Session.test.ts'], 'daemon backstop reports the wrong limit'),
    ('M18', f'{CLI}/acp-integration/session/Session.ts', [(
        "      { loopDetail: { loopReason: LoopReason.REPEATED_CALL } },\n", "", 1)],
     'packages/cli', ['src/acp-integration/session/Session.test.ts'], 'daemon heuristic duplicate loses its reason'),
    ('M19', 'packages/acp-bridge/src/session-control-plane.ts', [(
        "        ...(loopReason ? { loopReason } : {}),\n", "", 1)],
     'packages/acp-bridge', ['src/bridge.test.ts'], 'bridge turn_error drops loopReason'),
    ('M20', 'packages/acp-bridge/src/session-control-plane.ts', [(
        "        ...(toolCallLimit !== undefined ? { toolCallLimit } : {}),\n", "", 1)],
     'packages/acp-bridge', ['src/bridge.test.ts'], 'bridge turn_error drops toolCallLimit'),
    ('M21', 'packages/sdk-typescript/src/daemon/ui/normalizer.ts', [(
        "          ...(loop ? { loop } : {}),\n", "", 1)],
     'packages/sdk-typescript', ['test/unit/daemonUi.test.ts'], 'SDK normalizer drops loop'),
    ('M22', 'packages/sdk-typescript/src/daemon/ui/transcript.ts', [(
        "    ...(event?.type === 'error' && event.loop ? { loop: event.loop } : {}),\n", "", 1)],
     'packages/sdk-typescript', ['test/unit/daemonUi.test.ts'], 'transcript block drops loop'),
    ('M23', 'packages/web-shell/client/adapters/localizedMessages.ts', [(
        "          return t('error.loopDetected.explicitCap', { limit });", "          return undefined;", 1)],
     'packages/web-shell', ['client/adapters/transcriptToMessages.test.ts', 'client/hooks/useMessages.test.ts'],
     'Web Shell explicit cap falls back to generic'),
    ('M24', 'packages/web-shell/client/adapters/localizedMessages.ts', [(
        "          return t('error.loopDetected.providerDuplicateId');", "          return t('error.loopDetected.repeatedCall');", 1)],
     'packages/web-shell', ['client/adapters/transcriptToMessages.test.ts', 'client/hooks/useMessages.test.ts'],
     'Web Shell provider replay shown as repeated call'),
    ('M25', 'packages/web-shell/client/adapters/transcriptToMessages.ts', [(
        "      (block.loop ? labels?.loopDetectedFor?.(block.loop) : undefined) ??\n", "", 1)],
     'packages/web-shell', ['client/adapters/transcriptToMessages.test.ts', 'client/hooks/useMessages.test.ts'],
     'adapter ignores the per-cause label'),
]


def run(mid, rel, edits, pkg, tests, desc):
    src = f'{M}/{rel}'
    orig = open(f'{H}/{rel}').read()
    text = orig
    for old, new, count in edits:
        n = text.count(old)
        if n != count:
            return {'id': mid, 'desc': desc, 'status': f'PATTERN_COUNT {n}!={count}'}
        text = text.replace(old, new)
    tmp = src + '.mut'
    with open(tmp, 'w') as f:
        f.write(text)
    os.replace(tmp, src)  # new inode: the head arm is untouched
    rep = f'{OUT}/{mid}.json'
    try:
        p = subprocess.run(
            ['npx', 'vitest', 'run', *tests, '--reporter=json', f'--outputFile={rep}'],
            cwd=f'{M}/{pkg}', env={**os.environ, 'CI': 'true'},
            capture_output=True, text=True, timeout=900)
        try:
            d = json.load(open(rep))
            failed = d['numFailedTests']
            total = d['numTotalTests']
            failed_names = [a['fullName'] for t in d['testResults'] for a in t['assertionResults'] if a['status'] == 'failed'][:4]
            suites_failed = d.get('numFailedTestSuites', 0)
        except Exception as e:  # noqa: BLE001
            failed, total, failed_names, suites_failed = None, None, [str(e)], None
        status = 'KILLED' if (failed or suites_failed) else 'SURVIVED'
        return {'id': mid, 'desc': desc, 'status': status, 'failed': failed, 'total': total,
                'failedSuites': suites_failed, 'examples': failed_names, 'exit': p.returncode}
    finally:
        tmp = src + '.restore'
        shutil.copyfile(f'{H}/{rel}', tmp)
        os.replace(tmp, src)
        assert open(src).read() == orig


ids = set(sys.argv[1:])
results = []
for m in MUTANTS:
    if ids and m[0] not in ids:
        continue
    r = run(*m)
    print(json.dumps(r), flush=True)
    results.append(r)
with open(f'{OUT}/summary-{"-".join(sorted(ids)) or "all"}.json', 'w') as f:
    json.dump(results, f, indent=1)
