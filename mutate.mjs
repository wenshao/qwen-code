/**
 * Mutation matrix for PR #11251's new production code.
 *
 * The bot's round-12 review reports test efficacy as UNMEASURED ("harnessValidated
 * is null, the positive control never ran and neither the mutant nor the hunk
 * probes ran"). This script measures it: each mutation breaks one property the
 * diff introduces, then the test files the PR touches are run to see whether any
 * of them turns red.
 *
 * Usage: node mutate.mjs [id ...]
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const WS = '/Users/wenshao/git/rig11251-head/packages/web-shell';
const PROVIDER = 'client/daemon/session/DaemonSessionProvider.tsx';
const PROJECTION = 'client/assistant-turn-settlement.ts';
const ACTIONS = 'client/daemon/session/actions.ts';
const ADAPTER = 'client/adapters/transcriptToMessages.ts';

const PROVIDER_TESTS = [
  'daemon/session/DaemonSessionProvider.test.tsx',
  'daemon/session/actions.test.ts',
];
const PROJECTION_TESTS = ['assistant-turn-settlement.test.tsx'];

const MUTATIONS = [
  {
    id: 'M1-dedupe-gate',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: 'drop the published-key dedupe gate (one terminal may publish twice)',
    from: `      if (publishedPromptSettlementsRef.current.has(key)) return;\n`,
    to: '',
  },
  {
    id: 'M2-repair-suppression',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: 'publish the live terminal even while a journal repair targets it',
    from: `                if (settlement && !repairTargetsTerminal) {`,
    to: `                if (settlement) {`,
  },
  {
    id: 'M3-replay-admission-gate',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: 'publish every replayed terminal, not only locally admitted prompts (history load stops being silent)',
    from: `              if (
                replaySettlement &&
                locallyBoundPromptIdsRef.current
                  .get(replaySettlement.sessionId)
                  ?.has(replaySettlement.promptId)
              ) {`,
    to: `              if (replaySettlement) {`,
  },
  {
    id: 'M4-pre-publish-flush',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: 'remove the flushTranscriptSync() that commits the terminal projection before hosts run',
    fromLine: 3916,
    expectLine: '                flushTranscriptSync();',
    to: '',
  },
  {
    id: 'M5-bind-on-admission',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: 'never bind an admitted prompt (replay catch-up can no longer publish)',
    from: `          bindPrompt(
            locallyBoundPromptIdsRef.current,
            owner.sessionId,
            admission.promptId,
          );\n`,
    to: '',
  },
  {
    id: 'M6-unbind-on-publish',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: 'keep the admission key after publishing (stale key survives)',
    from: `      unbindPrompt(
        locallyBoundPromptIdsRef.current,
        event.sessionId,
        event.promptId,
      );\n`,
    to: '',
  },
  {
    id: 'M7-cancelled-outcome',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: "report a cancelled turn as completed (outcome mapping)",
    from: `      stopReason === 'cancelled'
        ? 'cancelled'`,
    to: `      stopReason === 'cancelled'
        ? 'completed'`,
  },
  {
    id: 'M8-listener-isolation',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: 'let one throwing host listener break the delivery loop',
    from: `          try {
            listener(event);
          } catch (error) {
            console.error(
              '[DaemonSessionProvider] prompt settlement listener failed',
              error,
            );
          }`,
    to: `          listener(event);`,
  },
  {
    id: 'M9-epoch-reset-cleanup',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: 'keep epoch-reset bound prompts after a fresh load reports none active',
    from: `          if (epochResetSessionIdRef.current === activeSession.sessionId) {
            epochResetSessionIdRef.current = undefined;
            if (!hasSessionActivePrompt()) {
              locallyBoundPromptIdsRef.current.delete(activeSession.sessionId);
            }
          }\n`,
    to: '',
  },
  {
    id: 'M10-foreign-removal-guard',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: 'let a foreign-session prompt removal mutate the current session stores',
    from: `          if (sessionId === undefined && sessionRef.current === owner)
            turnNotifications.remove(owner, promptId);`,
    to: `          if (sessionRef.current === owner)
            turnNotifications.remove(owner, promptId);`,
  },
  {
    id: 'M11-streaming-guard',
    file: PROJECTION,
    tests: PROJECTION_TESTS,
    what: 'publish a still-streaming block as the settled answer',
    from: `    if (block.streaming) return undefined;`,
    to: `    if (block.streaming) continue;`,
  },
  {
    id: 'M12-subagent-exclusion',
    file: PROJECTION,
    tests: PROJECTION_TESTS,
    what: "drop the subagent (parentToolCallId) exclusion",
    from: `      block.parentToolCallId !== undefined ||\n`,
    to: '',
  },
  {
    id: 'M13-prompt-ownership',
    file: PROJECTION,
    tests: PROJECTION_TESTS,
    what: "drop the prompt-ownership term (a foreign turn's answer can win)",
    from: `      block.promptId !== promptId\n`,
    to: `      false\n`,
  },
  {
    id: 'M14-insight-strip',
    file: PROJECTION,
    tests: PROJECTION_TESTS,
    what: 'publish raw block text instead of the rendered visible text (insight frames leak)',
    from: `    const visibleText = assistantVisibleTextOf(block.text);`,
    to: `    const visibleText = block.text;`,
  },
  {
    id: 'M15-session-scope',
    file: PROJECTION,
    tests: PROJECTION_TESTS,
    what: "project a message for another session's terminal from this session's blocks",
    from: `    currentSessionId === event.sessionId
      ? getSettledAssistantMessage(blocks, event.promptId)
      : undefined;`,
    to: `    getSettledAssistantMessage(blocks, event.promptId);`,
  },
  {
    id: 'M16-error-defaults',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: 'drop the turn_error message/code defaults',
    from: `        message: getString(data, 'message') ?? 'Prompt failed',
        code: getString(data, 'code') ?? 'turn_error',`,
    to: `        message: getString(data, 'message') as string,
        code: getString(data, 'code') as string,`,
  },
  {
    id: 'M17-stale-removal-unbind',
    file: ACTIONS,
    tests: PROVIDER_TESTS,
    what: 'stop reporting stale-session prompt removals to the provider',
    from: `        if (result.removed) {
          onPromptRemoved?.(session, promptId, opts.sessionId);
        }\n`,
    to: '',
  },
  {
    id: 'M18-visible-text-helper',
    file: ADAPTER,
    tests: PROJECTION_TESTS,
    what: 'make assistantVisibleTextOf return payload-only frames as text',
    from: `  const segments = splitInsightSegments(text);
  if (!segments) return text.trim();`,
    to: `  const segments = null as ReturnType<typeof splitInsightSegments>;
  if (!segments) return text.trim();`,
  },
  {
    id: 'M19-error-stop-outcome',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: "report a stopReason 'error' turn as completed",
    from: `        : stopReason === 'error'
          ? 'failed'`,
    to: `        : stopReason === 'error'
          ? 'completed'`,
  },
  {
    id: 'M20-stopreason-default',
    file: PROVIDER,
    tests: PROVIDER_TESTS,
    what: 'drop the end_turn default for a terminal with no stopReason',
    from: "    (event.data as DaemonTurnCompleteData | undefined)?.stopReason ??\n    'end_turn';",
    to: "    (event.data as DaemonTurnCompleteData | undefined)?.stopReason as string;",
  },
];

const ids = process.argv.slice(2);
const selected = ids.length
  ? MUTATIONS.filter((m) => ids.includes(m.id))
  : MUTATIONS;

const results = [];
for (const mutation of selected) {
  const path = `${WS}/${mutation.file}`;
  const backup = `${path}.mutbak`;
  copyFileSync(path, backup);
  let applied = true;
  try {
    let source = readFileSync(path, 'utf8');
    if (mutation.fromLine) {
      const lines = source.split('\n');
      const actual = lines[mutation.fromLine - 1];
      if (actual !== mutation.expectLine) {
        throw new Error(
          `line ${mutation.fromLine} is ${JSON.stringify(actual)}, expected ${JSON.stringify(mutation.expectLine)}`,
        );
      }
      lines.splice(mutation.fromLine - 1, 1);
      source = lines.join('\n');
    } else {
      const count = source.split(mutation.from).length - 1;
      if (count !== 1) {
        throw new Error(`anchor matched ${count} times`);
      }
      source = source.replace(mutation.from, mutation.to);
    }
    writeFileSync(path, source);
  } catch (error) {
    applied = false;
    copyFileSync(backup, path);
    results.push({ id: mutation.id, status: 'NOT_APPLIED', detail: String(error) });
    console.log(`${mutation.id}: NOT APPLIED — ${error}`);
    continue;
  }

  let output = '';
  let killed = false;
  try {
    output = execFileSync(
      'npx',
      ['vitest', 'run', '--config', 'vitest.config.ts', ...mutation.tests],
      { cwd: WS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 },
    );
  } catch (error) {
    killed = true;
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  copyFileSync(backup, path);

  const summary =
    output
      .split('\n')
      .filter((line) => /Tests {2}|Test Files/.test(line))
      .map((line) => line.replace(/\[[0-9;]*m/g, '').trim())
      .join(' | ') || '(no summary)';
  const failedNames = [...output.matchAll(/FAIL {2}(.+)/g)]
    .map((m) => m[1].replace(/\[[0-9;]*m/g, '').trim())
    .slice(0, 6);
  results.push({
    id: mutation.id,
    what: mutation.what,
    status: killed ? 'KILLED' : 'SURVIVED',
    summary,
    failedNames,
  });
  console.log(
    `${mutation.id}: ${killed ? 'KILLED' : 'SURVIVED'} — ${summary}${failedNames.length ? `\n    ${failedNames.join('\n    ')}` : ''}`,
  );
  if (applied) writeFileSync(`${WS}/mutation-results.json`, JSON.stringify(results, null, 2));
}
console.log('\n=== matrix ===');
for (const r of results) console.log(`${r.status.padEnd(11)} ${r.id}  ${r.what ?? ''}`);
