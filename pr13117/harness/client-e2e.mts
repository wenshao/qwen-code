// VERIFICATION RIG ONLY (PR #13117): the shipped WebShell client against the real server.
import { JavaManagedAgentClient, JavaManagedAgentHttpError } from '/Users/wenshao/pr13117-rig/wt-head/packages/web-shell/client/components/managed/java-managed-agent-client.ts';
const base = 'http://127.0.0.1:18117';
const who = process.argv[2];
const headers: Record<string, string> = { 'X-Qwen-Tenant-Id': 't-home', 'X-Rig-Actor': who === 'owner' ? 'alice' : 'mallory' };
if (who !== 'owner') headers['X-Rig-Actor-Tenant'] = 't-other';
const client = new JavaManagedAgentClient({ baseUrl: base, getHeaders: () => headers });
const own = new JavaManagedAgentClient({ baseUrl: base, getHeaders: () => ({ 'X-Qwen-Tenant-Id': 't-home', 'X-Rig-Actor': 'alice' }) });
const created = await own.createSession({ idempotencyKey: `e2e-${Date.now()}`, agentId: 'default', requestId: 'e2e-create' } as never);
const sessionId = (created as { sessionId: string }).sessionId;
const calls: [string, () => Promise<unknown>][] = [
  ['getTranscript      (webShellTranscript)', () => client.getTranscript({ sessionId } as never)],
  ['streamEvents       (webShellStreamEvents)', async () => { for await (const f of client.streamEvents({ sessionId } as never)) return f; }],
  ['submitTurn         (webShellSubmitTurn)', () => client.submitTurn({ sessionId, idempotencyKey: `e2e-s-${who}`, requestId: 'e2e-trace', input: [{ type: 'input_text', text: 'hi' }] } as never)],
  ['cancelTurn         (webShellCancelTurn)', () => client.cancelTurn({ sessionId, idempotencyKey: `e2e-c-${who}`, turnId: 'turn_none' } as never)],
  ['listWorkspaces     (webShellQueryWorkspaces)', () => client.listWorkspaces({} as never)],
  ['getWorkspace       (webShellGetWorkspace)', () => client.getWorkspace('ws-none')],
  ['getSession         (webShellGetSession, declared before)', () => client.getSession(sessionId)],
];
console.log(`== shipped JavaManagedAgentClient, actor=${who === 'owner' ? 'alice@t-home (owner)' : 'mallory@t-other'}, tenant header t-home, session ${sessionId}`);
for (const [name, fn] of calls) {
  try {
    const out = await fn();
    console.log(`${name.padEnd(52)} ok      ${JSON.stringify(out).slice(0, 70)}`);
  } catch (e) {
    if (e instanceof JavaManagedAgentHttpError) console.log(`${name.padEnd(52)} throws  JavaManagedAgentHttpError status=${e.status} code=${e.code}`);
    else console.log(`${name.padEnd(52)} throws  ${String(e).slice(0, 90)}`);
  }
}
