// VERIFICATION RIG ONLY (PR #13107): source mutants of the PR's new client code, run against the PR's own
// unit tests (client/components/managed). Runs in a separate worktree so the served arms are never touched.
// usage: node mutate.mjs <worktree-dir> [only-id ...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const W = process.argv[2];
const only = process.argv.slice(3);
const PKG = `${W}/packages/web-shell`;
const M = `${PKG}/client/components/managed`;
const OUT = '/Users/wenshao/pr13107-rig/out/mutation';
fs.mkdirSync(OUT, { recursive: true });

// [id, file, what it breaks, find, replace]
const mutants = [
  ['H1', 'use-managed-actions.ts', 'action_updated no longer triggers a re-read', "if (event.type === 'action_updated' || event.type === 'stream_gap') {", "if (event.type === 'stream_gap') {"],
  ['H2', 'use-managed-actions.ts', 'stream_gap no longer triggers a re-read', "if (event.type === 'action_updated' || event.type === 'stream_gap') {", "if (event.type === 'action_updated') {"],
  ['H3', 'use-managed-actions.ts', 'no re-read after the approval expires', '    if (pending.actions.length === 0) return undefined;\n    const earliest', '    if (pending.actions.length >= 0) return undefined;\n    const earliest'],
  ['H4', 'use-managed-actions.ts', 'an answered approval is not hidden while it settles', 'setAnswered((current) => new Set(current).add(actionId));', 'setAnswered((current) => new Set(current));'],
  ['H5', 'use-managed-actions.ts', 'a failed answer does not bring the card back', '          next.delete(actionId);', ''],
  ['H6', 'use-managed-actions.ts', 'idempotency key no longer names the option', 'idempotencyKey: `${target.actionId}:${optionId}`,', 'idempotencyKey: `${target.actionId}`,'],
  ['H7', 'use-managed-actions.ts', 'no re-read after a successful answer', '        });\n        setRevision((value) => value + 1);\n      } catch (failure) {', '        });\n      } catch (failure) {'],
  ['H8', 'use-managed-actions.ts', 'reads Actions even when the Session cannot serve them', 'const reader = enabled ? provider.actions : undefined;', 'const reader = provider.actions;'],
  ['H9', 'use-managed-actions.ts', "shows another Session's pending approvals", '() => (pending.sessionId === sessionId ? pending.actions : []),', '() => pending.actions,'],
  ['H10', 'use-managed-actions.ts', 'answered set and error survive a Session switch', '    setAnswered(new Set());\n    setError(undefined);\n  }, [sessionId]);', '  }, [sessionId]);'],
  ['H11', 'use-managed-actions.ts', 'a failed list read is not reported', '        if (!abort.signal.aborted) setError(failure);\n      });', '        void failure;\n      });'],
  ['H12', 'use-managed-actions.ts', 'a failed answer is not reported', '          return next;\n        });\n        setError(failure);', '          return next;\n        });'],
  ['A1', 'managed-approval.ts', 'allow is presented as a rejection', "allow: 'allow_once',", "allow: 'reject_once',"],
  ['A2', 'managed-approval.ts', 'deny is presented as an allow', "deny: 'reject_once',", "deny: 'allow_once',"],
  ['A3', 'managed-approval.ts', "matches any Turn's call with the same ID", '      if (exact ? tool.callId === exact : tool.callId.endsWith(suffix)) {', '      if (tool.callId.endsWith(suffix)) {'],
  ['A4', 'managed-approval.ts', 'fallback takes the first matching call, not the latest', '        found = tool;', '        found ??= tool;'],
  ['A5', 'managed-approval.ts', 'no toolCallId unless a tool row matched', "    tool?.callId ??\n    (action.turnId ? `${action.turnId}:${action.functionCallId}` : undefined);", '    tool?.callId;'],
  ['A6', 'managed-approval.ts', 'call arguments are not passed to the card', '    ...(tool?.args ? { rawInput: tool.args } : {}),', ''],
  ['P1', 'java-managed-agent-provider.ts', 'decided/expired Actions are listed as pending', "if (action.kind !== 'permission' || action.state !== 'requested') return [];", "if (action.kind !== 'permission') return [];"],
  ['P2', 'java-managed-agent-provider.ts', 'question Actions are listed as permission approvals', "if (action.kind !== 'permission' || action.state !== 'requested') return [];", "if (action.state !== 'requested') return [];"],
  ['P3', 'java-managed-agent-provider.ts', 'actions capability reported for every Session', "...(session.capabilities?.actions === true ? { actions: true } : {}),", '...{ actions: true },'],
  ['P4', 'java-managed-agent-provider.ts', 'answer omits the policy revision', '              policyRevision: action.policyRevision,\n', ''],
  ['P5', 'java-managed-agent-provider.ts', 'answer sends a constant input revision', '              inputRevision: action.inputRevision,', '              inputRevision: 1,'],
  ['P6', 'java-managed-agent-provider.ts', 'answer does not forward the idempotency key', '            idempotencyKey: command.idempotencyKey,\n            sessionId: action.sessionId,', "            idempotencyKey: '',\n            sessionId: action.sessionId,"],
  ['E1', 'java-managed-agent-event-projector.ts', 'action.updated is dropped by the projector', "    case 'action.updated':\n      return 'action_updated';\n", ''],
  ['T1', 'managed-session-messages.ts', 'approval updates settle the streamed Turn', "    if (event.type === 'action_updated') continue;\n", ''],
  ['G1', 'ManagedSessionsPage.tsx', 'page reads approvals without the capability', "    detail.summary?.capabilities.actions === true,", '    true,'],
  ['G2', 'ManagedSessionsPage.tsx', 'the approval card is never rendered', '          {pendingApproval && (\n            <div className="shrink-0" data-testid="managed-approval">', '          {false && pendingApproval && (\n            <div className="shrink-0" data-testid="managed-approval">'],
  ['G3', 'ManagedSessionsPage.tsx', 'the answer failure text is never rendered', '          {approvals.error !== undefined && (', '          {false && approvals.error !== undefined && ('],
  ['G4', 'ManagedSessionsPage.tsx', 'the transcript is not told about the pending approval', '                pendingApproval={pendingApproval}\n                sessionKey', '                pendingApproval={null}\n                sessionKey'],
  ['G5', 'ManagedSessionsPage.tsx', 'clicking an option does not answer', '                  approvals.respond(actionId, optionId)', '                  void [actionId, optionId]'],
];

function run(label) {
  const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.config.ts', 'client/components/managed'], { cwd: PKG, encoding: 'utf8', env: { ...process.env, CI: '1' }, timeout: 600_000 });
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
