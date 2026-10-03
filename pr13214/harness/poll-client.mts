// Runs the shipped Hosted Harness Broker client (packages/cli/src/serve/hosted-workspace-broker.ts,
// byte-identical at 5130c1a734 and PR head) against a Rig Broker: prepare one v2 shell call,
// then execute() it exactly as hosted-workspace-tool-turn.ts does (waitForUnknown = session has MCP).
// argv: <baseUrl> <token> <harness> <runtimeSession> <command> <waitForUnknown> <observationMs>
import crypto from 'node:crypto';
import { HostedWorkspaceBroker } from '/Users/wenshao/git/qwen-code-x9/packages/cli/src/serve/hosted-workspace-broker.ts';

const [baseUrl, token, harness, runtimeSession, command, waitArg, obsArg] = process.argv.slice(2);
const requests: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  requests.push(`${init?.method ?? 'GET'} ${url.pathname.replace('/internal/runtime-broker/v1', '')}${url.searchParams.get('reconcile') ? '?reconcile=' + url.searchParams.get('reconcile') : ''}`);
  return realFetch(input, init);
}) as typeof fetch;
const client = new HostedWorkspaceBroker(
  { baseUrl, token },
  { tenantId: 'tenant-a', workspaceId: 'workspace-a', sessionId: harness } as never,
  runtimeSession,
);
const payloadJson = JSON.stringify({ toolName: 'run_shell_command', input: { command, is_background: false } });
const digest = 'sha256:' + crypto.createHash('sha256').update(payloadJson).digest('hex');
const id = await client.prepare('call-poll', digest);
console.log(JSON.stringify({ phase: 'prepared', id }));
const started = Date.now();
let outcome: unknown;
try {
  const result = await client.execute(id, payloadJson, new AbortController().signal, Number(obsArg), waitArg === 'true');
  outcome = { settled: result.executionStatus };
} catch (error) {
  outcome = { threw: String((error as Error).message) };
}
const tally: Record<string, number> = {};
for (const r of requests) tally[r] = (tally[r] ?? 0) + 1;
console.log(JSON.stringify({ phase: 'done', id, elapsedMs: Date.now() - started, outcome, requests: tally }));
