// S11: does Session load cost grow with the number of past Shell calls?
// One Session runs small Shell turns; at each checkpoint it detaches and loads
// again, timing the load and counting Broker ACKs, Store requests and
// "ACK failed during recovery" lines emitted during that load.
// env: DB, ST, TAG, CHECKS (e.g. "1,10,40"), LOCAL=1 for the #12848 local path
import * as L from './lib.mjs';
import { execSync } from "node:child_process";
import { fakeToolCall, startFakeOpenAIServer } from '/root/git/qwen-code-c2/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o2l';
const HTTP = 18894, BPORT = 19894, PROXY = 18895, CTRL = 'http://127.0.0.1:18896';
const ST = process.env.ST ?? 's32';
const TAG = process.env.TAG ?? `s11-${Date.now()}`;
const CHECKS = (process.env.CHECKS ?? '1,10,40').split(',').map(Number);
L.openLog(`s11-${TAG}`);
const ctrl = async (p: string) => (await fetch(CTRL + p)).json();
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  if (!messages.slice(lastUser + 1).some((x) => x.role === 'tool'))
    return { toolCalls: [fakeToolCall('run_shell_command', { command: `echo out-${TAG}; echo err-${TAG} >&2` }, `call-${TAG}-${messages.length}`)] };
  return { content: `done ${TAG}` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
const ws = `ws-${ST}`;
const conn = (h: any) => ({ ...L.storeConnection(h, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
const h = await new L.Harness({ name: `s11-${TAG}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const sessionId = await L.createWorkspaceSession(HTTP, ws);
const s = new L.HSession(h, sessionId, conn(h));
L.say('create', `${(await s.create()).status} path=${process.env.LOCAL === '1' ? 'local capture' : 'O2 publication'}`);
const warnings = () => h.log().split('\n').filter((l: string) => /ACK failed during recovery/.test(l)).length;
let done = 0, failed = 0;
const rows: any[] = [];
for (const target of CHECKS) {
  const tt = Date.now();
  while (done < target) {
    const r = await s.prompt(`[[${TAG}]] turn ${done + 1}`, 120_000).catch((e: any) => ({ terminal: [], err: String(e) }));
    if (!r.terminal?.some((e: any) => e.type === 'turn_complete')) { failed++; L.say('turn', `${done + 1}: ${L.summarizeTurn(r)}`); }
    done++;
  }
  const turnMs = Date.now() - tt;
  const d = await s.detach();
  const w0 = warnings();
  const cpu = () => { const t = String(execSync(`ps -o cputime= -p ${h.child.pid}`)).trim().split(/[:.]/).map(Number); return t.length === 3 ? (t[0] * 60 + t[1]) * 1000 + t[2] * 10 : NaN; };
  const c0 = cpu();
  const t0 = Date.now();
  const ld = await s.load();
  const loadMs = Date.now() - t0;
  const loadCpuMs = cpu() - c0;
  await L.sleep(300);
  const acks = proxy.ledger.filter((e: any) => e.t >= t0 && /:acknowledge$/.test(e.url));
  const store = (await ctrl(`/ledger?since=${t0}`)).filter((e: any) => e.t === undefined || e.t <= t0 + loadMs + 50);
  const row = { shellTurns: done, failedTurns: failed, detach: d.status, load: ld.status, loadMs, loadCpuMs, acks: acks.length, ack404: acks.filter((e: any) => e.status === 404).length, storeRequests: store.length, warnings: warnings() - w0, avgTurnMs: Math.round(turnMs / Math.max(1, target - (rows.at(-1)?.shellTurns ?? 0))) };
  const byUrl: Record<string, number> = {};
  for (const e of store) { const k = `${e.method} ${String(e.url).replace(/\/internal\/managed-session-store\/v1\/sessions\/[^\/]+/, "").replace(/[0-9a-f]{8}-[0-9a-f-]{27}|sha256:[0-9a-f]{64}|[0-9a-f]{32,}/g, ":id").replace(/\?.*/, "")}`; byUrl[k] = (byUrl[k] ?? 0) + 1; }
  (row as any).byUrl = byUrl;
  rows.push(row);
  L.say('checkpoint', JSON.stringify(row));
  const st = await s.status();
  if (st?.recoveryBlocked) { L.say('status', JSON.stringify(st)); break; }
}
const sample = h.log().split('\n').find((l: string) => /ACK failed during recovery/.test(l));
if (sample) L.say('sample warning', sample.slice(0, 200));
await (await import('node:fs')).promises.writeFile(`${L.RIG}/out/s11-${TAG}.json`, JSON.stringify(rows, null, 1));
await h.stop();
process.exit(0);
