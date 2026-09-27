// Counts Session Store HTTP traffic for one 64 MiB foreground Shell call.
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848a';
const HTTP = Number(process.env.HTTP ?? 18848);
const ST = process.env.ST ?? 'x';
L.openLog(`s5-store-traffic-${ST}`);
const MIB = Number(process.env.MIB ?? 64);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (!receipts.length && JSON.stringify(messages[lastUser]?.content).includes('[[BIG]]'))
    return { toolCalls: [fakeToolCall('run_shell_command', { command: `yes 0123456789abcdef | head -c ${MIB * 1024 * 1024}`, timeout: 600000 }, 'big')] };
  return { content: 'done' };
});
const store = await L.startPassProxy(`http://127.0.0.1:${HTTP}`);
const h = await new L.Harness({ name: `traffic-${ST}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), { ...L.storeConnection(h, ws, HTTP), baseUrl: store.url });
await s.create({ toolProfile: 'hosted-workspace-shell/1' });
const status = () => Object.fromEntries(L.sql(DB, "SELECT VARIABLE_NAME, VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME IN ('Com_update','Com_insert','Com_select','Com_commit')").map(([k, v]) => [k, Number(v)]));
const before = status();
const t0 = Date.now();
const r = await s.prompt('[[BIG]]', 600000);
const after = status();
L.say('turn', `${MIB} MiB: ${L.summarizeTurn(r)}`);
const counts: Record<string, number> = {};
for (const e of store.ledger.filter((e) => e.t >= t0)) {
  const k = `${e.method} ${e.url.replace(/\/v1\/internal\/managed-sessions\/[^/]+/, '/…').replace(/[0-9a-f-]{36}/g, '<id>')} -> ${e.status}`;
  counts[k] = (counts[k] ?? 0) + 1;
}
L.say('store requests', Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}x ${k}`));
L.say('mysql deltas', Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]])));
L.say('per MiB', `store requests ${(Object.values(counts).reduce((a, b) => a + b, 0) / MIB).toFixed(1)}/MiB; throughput ${(MIB / ((Date.now() - t0) / 1000)).toFixed(1)} MiB/s`);
await h.stop();
await store.close();
process.exit(0);
