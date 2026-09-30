// S15: R5-1 probe. Just before the Harness's `:start` reaches the Broker, the
// Workspace execution lease row is handed to another holder, so the ownership
// check in WorkspaceRuntimeTransport.executeV3 refuses before worker dispatch.
// Afterwards: turn outcome, model-visible result, receipt, reload + second turn.
// env: DB, ST, TAG, LOCAL=1 for the local path, RESTORE=1 to hand the lease back after :start
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o2u';
const HTTP = 18894, BPORT = 19894, PROXY = 18895;
const ST = process.env.ST ?? 's30';
const TAG = process.env.TAG ?? `s15-${Date.now()}`;
L.openLog(`s15-${TAG}`);
const KEY = `SHA2(CONCAT('${L.TENANT}', CHAR(0), 'st-${ST}'), 256)`;
const lease = () => L.sql(DB, `SELECT COALESCE(LEFT(holder_key, 12), 'NULL') FROM managed_workspace_execution_lease WHERE storage_key = ${KEY}`).map((r: string[]) => r[0]);
let turn = 0, seen = '';
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const tools = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (!tools.length) return { toolCalls: [fakeToolCall('run_shell_command', { command: `echo ${TAG}-run-${++turn}` }, `call-${TAG}-${turn}`)] };
  const c = tools.at(-1)?.content as unknown;
  seen = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? JSON.stringify(p)).join('') : JSON.stringify(c ?? '');
  return { content: `done ${TAG}` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
let stolen: string[] | null = null, original: string[] = [];
let once = true;
proxy.state.hook = async (entry: any) => {
  if (process.env.MODE !== "install" && once && /:start$/.test(entry.url)) {
    once = false;
    original = lease();
    L.sql(DB, `UPDATE managed_workspace_execution_lease SET holder_key = '${'f'.repeat(64)}' WHERE storage_key = ${KEY}`);
    stolen = lease();
  }
  return 'forward';
};
const ws = `ws-${ST}`;
const conn = (h: any) => ({ ...L.storeConnection(h, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
const h = await new L.Harness({ name: `s15-${TAG}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const sessionId = await L.createWorkspaceSession(HTTP, ws);
const s = new L.HSession(h, sessionId, conn(h));
L.say('create', `${(await s.create()).status} path=${process.env.LOCAL === '1' ? 'local capture' : 'O2 publication'}`);
if (process.env.MODE === "install") { const fs = await import("node:fs"); original = lease(); fs.writeFileSync(`${L.RIG}/run/fwd-arm.sql`, `${DB}\nUPDATE managed_workspace_execution_lease SET holder_key = '${"f".repeat(64)}' WHERE storage_key = ${KEY}`); stolen = ["armed for publications:install"]; }
const t0 = Date.now();
const r = await s.prompt(`[[${TAG}]] run it`, Number(process.env.TIMEOUT ?? 240_000)).catch((e: any) => ({ terminal: [], err: String(e) }));
L.say('lease', `before :start ${JSON.stringify(original)} -> after tamper ${JSON.stringify(stolen)}`);
L.say('turn', `${L.summarizeTurn(r)} (${Date.now() - t0} ms)`);
L.say('model saw', JSON.stringify(seen.slice(0, 200)));
L.say('broker', L.ledgerSince(proxy.ledger, 0).map((l: string) => l.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (x) => x.slice(0, 8))));
const journal = L.sql(DB, `SELECT CAST(record_bytes AS CHAR) FROM qwen_managed_session_journal_tx WHERE session_id='${sessionId}' ORDER BY journal_revision`).map((x: string[]) => x[0]).join('\n');
const kc: Record<string, number> = {};
for (const k of (journal.match(/"kind":"[a-z._]+"/g) ?? []).map((k) => k.slice(8, -1))) kc[k] = (kc[k] ?? 0) + 1;
L.say('journal', kc);
L.say('status', JSON.stringify(await s.status().catch((e: any) => String(e))));
L.say('lease now', JSON.stringify(lease()));
const d = await s.detach();
const ld = await s.load();
L.say('reload', `detach ${d.status} load ${ld.status} ${ld.status === 200 ? '' : JSON.stringify(ld.json)}`);
await L.sleep(1000);
L.say('status after reload', JSON.stringify(await s.status().catch((e: any) => String(e))));
const r2 = await s.prompt(`[[${TAG}]] second turn`, 120_000).catch((e: any) => ({ terminal: [], err: String(e) }));
L.say('second turn', L.summarizeTurn(r2));
L.say('harness', h.log().split('\n').filter((l: string) => /fail|block|error|retr|recover|unstarted|not_started|refus/i.test(l)).map((l: string) => l.slice(0, 220)).slice(0, 10));
await h.stop();
process.exit(0);
