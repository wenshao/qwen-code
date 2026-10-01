// VERIFICATION RIG ONLY (PR #13107): source mutants of the PR's new client code, run against the PR's own
// unit tests (client/components/managed). Runs in a separate worktree so the served arms are never touched.
// usage: node mutate.mjs <worktree-dir> [only-id ...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const W = process.argv[2];
const only = process.argv.slice(3);
const PKG = `${W}/packages/web-shell`;
const M = `${PKG}/client/components/managed`;
const OUT = process.env.MUT_OUT ?? '/Users/wenshao/pr13107-rig/out/mutation-r5b';
fs.mkdirSync(OUT, { recursive: true });

// [id, file, what it breaks, find, replace]
const mutants = [
  ['H1', 'use-managed-actions.ts', 'action_updated no longer triggers a re-read', "if (event.type === 'action_updated' || event.type === 'stream_gap') {", "if (event.type === 'stream_gap') {"],
  ['H2', 'use-managed-actions.ts', 'stream_gap no longer triggers a re-read', "if (event.type === 'action_updated' || event.type === 'stream_gap') {", "if (event.type === 'action_updated') {"],
  ['H3', 'use-managed-actions.ts', 'no re-read after the approval expires', '    if (earliestExpiry === undefined) return undefined;', '    if (earliestExpiry !== null) return undefined;'],
  ['H3b', 'use-managed-actions.ts', 'expiry timer re-armed by every read (the N3 loop)', '  }, [earliestExpiry]);', '  }, [earliestExpiry, pending]);'],
  ['H4', 'use-managed-actions.ts', 'an answered approval is not hidden while it settles', 'setAnswered((current) => new Set(current).add(actionId));', 'setAnswered((current) => new Set(current));'],
  ['H5', 'use-managed-actions.ts', 'a failed answer does not bring the card back', '          next.delete(actionId);', ''],
  ['H6', 'use-managed-actions.ts', 'idempotency key no longer names the option', 'idempotencyKey: `${target.actionId}:${optionId}`,', 'idempotencyKey: `${target.actionId}`,'],
  ["H7", "use-managed-actions.ts", "no re-read after a successful answer", "        }\n        setRevision((value) => value + 1);\n      } catch (failure) {", "        }\n      } catch (failure) {"],
  ['H8', 'use-managed-actions.ts', 'reads Actions even when the Session cannot serve them', 'const reader = enabled === false ? undefined : provider.actions;', 'const reader = provider.actions;'],
  ['H18', 'use-managed-actions.ts', 'R1-1 regression: an unknown capability is treated as absent', 'const reader = enabled === false ? undefined : provider.actions;', 'const reader = enabled ? provider.actions : undefined;'],
  ['H19', 'use-managed-actions.ts', 'reads while the capability is unknown', '    if (enabled === undefined) return undefined;\n', ''],
  ['H9', 'use-managed-actions.ts', "shows another Session's pending approvals", '() => (pending.sessionId === sessionId ? pending.actions : []),', '() => pending.actions,'],
  ["H10", "use-managed-actions.ts", "answered set and errors survive a Session switch", "    setAnswered(new Set());\n    setLoadError(undefined);\n    setAnswerError(undefined);\n    loadFailures.current = 0;\n    answerFailure.current = undefined;\n    endedAnswers.current.clear();\n  }, [sessionId]);", "  }, [sessionId]);"],
  ['H11', 'use-managed-actions.ts', 'a failed list read is not reported', '        setLoadError(failure);', '        void failure;'],
  ["H12", "use-managed-actions.ts", "a failed answer is not reported", "        setAnswerError(failure);\n        answerFailure.current = actionId;", "        answerFailure.current = actionId;"],
  ['H13', 'use-managed-actions.ts', 'a failed read is never retried in the background', 'const LOAD_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];', 'const LOAD_RETRY_DELAYS_MS: number[] = [];'],
  ['H14', 'use-managed-actions.ts', 'background retries are unbounded', 'const delay = LOAD_RETRY_DELAYS_MS[loadFailures.current];', 'const delay = LOAD_RETRY_DELAYS_MS[0];'],
  ['H15', 'use-managed-actions.ts', 'Retry keeps the exhausted failure count', '    loadFailures.current = 0;\n    setRevision((value) => value + 1);\n  }, []);', '    setRevision((value) => value + 1);\n  }, []);'],
  ["H16", "use-managed-actions.ts", "a failed answer is swallowed instead of rethrown to the card", "        answerFailure.current = actionId;\n        throw failure;", "        answerFailure.current = actionId;"],
  ["H17", "use-managed-actions.ts", "a successful answer does not clear the previous answer error", "        if (answerFailure.current === actionId) {\n          setAnswerError(undefined);\n          answerFailure.current = undefined;\n        }\n        setRevision", "        setRevision"],
  ['A1', 'managed-approval.ts', 'allow is presented as a rejection', "allow: 'allow_once',", "allow: 'reject_once',"],
  ['A2', 'managed-approval.ts', 'deny is presented as an allow', "deny: 'reject_once',", "deny: 'allow_once',"],
  ["A3", "managed-approval.ts", "matches any Turn's call with the same ID", "            ? tool.callId === exact\n", "            ? tool.callId.endsWith(suffix)\n"],
  ["A4", "managed-approval.ts", "fallback takes the first matching call, not the latest", "if (matches) found = tool;", "if (matches) found ??= tool;"],
  ['A5', 'managed-approval.ts', 'no toolCallId unless a tool row matched', "    tool?.callId ??\n    (action.turnId ? `${action.turnId}:${action.functionCallId}` : undefined);", '    tool?.callId;'],
  ['A6', 'managed-approval.ts', 'rawInput / contentIsInput not passed to the card', '    ...(tool?.args ? { rawInput: tool.args, contentIsInput: true } : {}),', ''],
  ['A7', 'managed-approval.ts', 'the arguments text block is not rendered', "    content: tool?.args\n      ? [{ type: 'text', text: JSON.stringify(tool.args, null, 2) }]\n      : [],", '    content: [],'],
  ['P1', 'java-managed-agent-provider.ts', 'decided/expired Actions are listed as pending', "if (action.kind !== 'permission' || action.state !== 'requested') return [];", "if (action.kind !== 'permission') return [];"],
  ['P2', 'java-managed-agent-provider.ts', 'question Actions are listed as permission approvals', "if (action.kind !== 'permission' || action.state !== 'requested') return [];", "if (action.state !== 'requested') return [];"],
  ['P3', 'java-managed-agent-provider.ts', 'actions capability reported for every Session', "...(session.capabilities?.actions === true ? { actions: true } : {}),", '...{ actions: true },'],
  ['P4', 'java-managed-agent-provider.ts', 'answer omits the policy revision', '              policyRevision: action.policyRevision,\n', ''],
  ['P5', 'java-managed-agent-provider.ts', 'answer sends a constant input revision', '              inputRevision: action.inputRevision,', '              inputRevision: 1,'],
  ['P6', 'java-managed-agent-provider.ts', 'answer does not forward the idempotency key', '            idempotencyKey: command.idempotencyKey,\n            sessionId: action.sessionId,', "            idempotencyKey: '',\n            sessionId: action.sessionId,"],
  ['P7', 'java-managed-agent-provider.ts', 'a 202 with status failed counts as applied', "          result.status === 'failed' ||", '          false ||'],
  ['P8', 'java-managed-agent-provider.ts', 'cancelled / recovery_blocked count as applied', "          result.status === 'cancelled' ||\n          result.status === 'recovery_blocked'", '          false'],
  ['E1', 'java-managed-agent-event-projector.ts', 'action.updated is dropped by the projector', "    case 'action.updated':\n      return 'action_updated';\n", ''],
  ['T1', 'managed-session-messages.ts', 'approval updates settle the streamed Turn', "    if (event.type === 'action_updated') continue;\n", ''],
  ['G1', 'ManagedSessionsPage.tsx', 'page reads approvals without the capability', "    detail.summary ? detail.summary.capabilities.actions === true : undefined,", '    true,'],
  ['G9', 'ManagedSessionsPage.tsx', 'R1-1 regression at the page: unknown summary passed as false', "    detail.summary ? detail.summary.capabilities.actions === true : undefined,", '    detail.summary?.capabilities.actions === true,'],
  ['G2', 'ManagedSessionsPage.tsx', 'the approval card is never rendered', '          {pendingApproval && (\n            <div className="shrink-0" data-testid="managed-approval">', '          {false && pendingApproval && (\n            <div className="shrink-0" data-testid="managed-approval">'],
  ['G3', 'ManagedSessionsPage.tsx', 'the answer failure text is never rendered', '          {approvals.answerError !== undefined && (', '          {false && approvals.answerError !== undefined && ('],
  ['G4', 'ManagedSessionsPage.tsx', 'the transcript is not told about the pending approval', '                pendingApproval={pendingApproval}\n                sessionKey', '                pendingApproval={null}\n                sessionKey'],
  ['G5', 'ManagedSessionsPage.tsx', 'clicking an option does not answer', '                  approvals.respond(actionId, optionId)', '                  void [actionId, optionId]'],
  ['G6', 'ManagedSessionsPage.tsx', 'the arguments-unavailable notice is never rendered', '              {pendingApproval.rawInput === undefined && (', '              {false && ('],
  ['G7', 'ManagedSessionsPage.tsx', 'a 403 gets the generic message, not the creator-only one', "    approvalCause.code === 'action_forbidden';", "    approvalCause.code === 'never';"],
  ['G8', 'ManagedSessionsPage.tsx', 'the load failure and its Retry button are never rendered', '          {approvals.loadError !== undefined && (', '          {false && approvals.loadError !== undefined && ('],
  ["N1", "use-managed-actions.ts", "R1-2's real code (action_already_resolved) is not treated as ended", "  'action_already_resolved',\n", ""],
  ["N1b", "use-managed-actions.ts", "action_expired is not treated as ended", "  'action_expired',\n", ""],
  ["N1c", "use-managed-actions.ts", "action_cancelled is not treated as ended", "  'action_cancelled',\n", ""],
  ["N2", "use-managed-actions.ts", "no failure is ever classified as an ended Action", "  return typeof code === 'string' && ENDED_ACTION_CODES.has(code);", "  return false;"],
  ["N3", "use-managed-actions.ts", "a hidden ended Action is not remembered, so a wrong report hides it for good", "          endedAnswers.current.add(actionId);\n", ""],
  ["N4", "use-managed-actions.ts", "an ended Action the next read still lists stays hidden", "        if (stillListed.length > 0) {", "        if (false && stillListed.length > 0) {"],
  ["N5", "use-managed-actions.ts", "an ended answer does not trigger a re-read", "          }\n          setRevision((value) => value + 1);\n          return;", "          }\n          return;"],
  ["N6", "use-managed-actions.ts", "an ended answer keeps the previous answer warning", "          if (answerFailure.current === actionId) {\n            answerFailure.current = undefined;\n            setAnswerError(undefined);\n          }\n", ""],
  ["N7", "use-managed-actions.ts", "the ended set is never cleared after a read", "        endedAnswers.current.clear();\n        if (stillListed", "        if (stillListed"],
  ["N8", "use-managed-actions.ts", "a definitive 4xx read is retried on the ladder again (R1-5)", "        if (isNonRetryableClientError(failure)) return;\n", ""],
  ["N9", "managed-request-error.ts", "a 408 timeout is no longer retried", "    status !== 408 &&\n", ""],
  ["N10", "managed-request-error.ts", "a 429 rate limit is no longer retried", "    status !== 408 &&\n    status !== 429\n", "    status !== 408\n"],
  ["N11", "use-managed-actions.ts", "the answer warning outlives its Action (R1-3)", "          !actions.some((entry) => entry.actionId === answerFailure.current)", "          false"],
  ["N12", "use-managed-actions.ts", "the failed Action is not recorded, so its warning is never dropped", "        answerFailure.current = actionId;\n", ""],
  ["N13", "use-managed-actions.ts", "a withdrawn reader keeps its spent retry budget", "      loadFailures.current = 0;\n      return undefined;\n    }\n    if (enabled === undefined)", "      return undefined;\n    }\n    if (enabled === undefined)"],
  ["N14", "use-managed-actions.ts", "loaded is always false (R1-4 wording regresses)", "  const loaded = pending.sessionId === sessionId;", "  const loaded = false;"],
  ["N15", "use-managed-actions.ts", "loaded is always true (a first failed load says refresh)", "  const loaded = pending.sessionId === sessionId;", "  const loaded = true;"],
  ["G10", "ManagedSessionsPage.tsx", "the caveat is not added to the dialog description (R1-8)", "                extraDescriptionId={\n                  pendingApproval.rawInput === undefined\n                    ? argumentsCaveatId\n                    : undefined\n                }\n", ""],
  ["G11", "ManagedSessionsPage.tsx", "the caveat id is passed while no caveat is rendered (dangling IDREF)", "                    ? argumentsCaveatId\n                    : undefined", "                    ? argumentsCaveatId\n                    : argumentsCaveatId"],
  ["G12", "ManagedSessionsPage.tsx", "the caveat paragraph loses its id", "                  id={argumentsCaveatId}\n", ""],
  ["G13", "ManagedSessionsPage.tsx", "a failed refresh says \"could not be loaded\" (R1-4)", "                    ? 'managed.approval.refreshFailed'", "                    ? 'managed.approval.loadFailed'"],
  ["TA1", "../messages/ToolApproval.tsx", "the shared card ignores extraDescriptionId", "        extraDescriptionId ?? null,\n", ""],
  ["T2", "managed-session-messages.ts", "the Harness's call title is dropped from the row", "      if (typeof data['title'] === 'string') tool.title = data['title'];\n", ""],
  ["T3", "managed-session-messages.ts", "R4-1 regression: itemId rows lose the call ID", "      if (typeof callId === 'string') tool.toolCallId = callId;\n", ""],
  ["A8", "managed-approval.ts", "an itemId row matches another Turn's call with the same ID", "            (!action.turnId || tool.callId.startsWith(`${action.turnId}:`))", "            true"],
  ["A9", "managed-approval.ts", "R4-1 regression: the call-ID branch is never used", "        tool.toolCallId !== undefined\n", "        false\n"],
  ["L1", "use-managed-actions.ts", "a late success for a replaced Action still touches the current card", "        if (!isPending()) return;\n", ""],
  ["L2", "use-managed-actions.ts", "a late failure for a replaced Action still touches the current card", "        if (!isPending()) throw failure;\n", ""],
  ["L3", "use-managed-actions.ts", "the answer warning is not tied to the shown Action", "      answerFailure.current === action?.actionId ? answerError : undefined,", "      answerError,"],
  ["L4", "use-managed-actions.ts", "a late reply is matched by Action ID only, across Sessions", "        current.current.sessionId === target.sessionId &&\n", ""],
  ["L5", "use-managed-actions.ts", "the late-reply check reads the list from the click, not the latest render", "  current.current = { sessionId, actions };\n", ""],
];

function run(label) {
  const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.config.ts', 'client/components/managed', 'client/components/messages/ToolApproval'], { cwd: PKG, encoding: 'utf8', env: { ...process.env, CI: '1' }, timeout: 600_000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  fs.writeFileSync(`${OUT}/${label}.log`, out);
  const tests = out.match(/Tests\s+(.*)/)?.[1]?.replace(/\x1b\[[0-9;]*m/g, '') ?? '';
  const failed = [...out.matchAll(/(?:FAIL|×)\s+(.*)/g)].map((m) => m[1].replace(/\x1b\[[0-9;]*m/g, '').trim());
  return { status: r.status, tests, failed };
}

const base = run('baseline');
console.log(`baseline: exit=${base.status} ${base.tests}`);
if (base.status !== 0) process.exit(1);
const rows = [];
for (const [id, file, what, find, replace] of mutants) {
  if (only.length && !only.includes(id)) continue;
  const path = `${M}/${file}`;
  const original = fs.readFileSync(path, 'utf8');
  if (!original.includes(find)) {
    console.log(`${id}: ANCHOR NOT FOUND in ${file}`);
    rows.push({ id, file, what, result: 'anchor-missing' });
    continue;
  }
  fs.writeFileSync(path, original.replace(find, replace));
  let r;
  try {
    r = run(id);
  } finally {
    fs.writeFileSync(path, original);
  }
  const killed = r.status !== 0;
  const by = [...new Set(r.failed.filter((f) => /\.test\./.test(f)).map((f) => f.match(/([\w.-]+\.test\.tsx?)/)?.[1]))].filter(Boolean);
  rows.push({ id, file, what, result: killed ? 'killed' : 'survived', tests: r.tests, by });
  console.log(`${id.padEnd(4)} ${killed ? 'killed  ' : 'SURVIVED'} ${file.padEnd(40)} ${what}${killed ? '  <- ' + by.join(', ') : ''}`);
}
const killed = rows.filter((r) => r.result === 'killed').length;
console.log(`== mutation: ${killed}/${rows.length} killed; survivors: ${rows.filter((r) => r.result === 'survived').map((r) => r.id).join(' ')}`);
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(rows, null, 1));
const clean = spawnSync('git', ['status', '--short', 'packages/web-shell/client/components'], { cwd: W, encoding: 'utf8' }).stdout.trim();
console.log(`worktree after the run: ${clean === '' ? 'clean' : clean}`);
