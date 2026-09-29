// S14: R2-5 probe. The Broker proxy holds the Harness's `:start` request; while
// it is held the client cancels the turn, so the prepared execution settles as
// not_started. Then detach/load and run a second Shell turn.
// env: DB, ST, TAG, HOLD_MS (default 6000), LOCAL=1 for the local path
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o2n';
const HTTP = 18894, BPORT = 19894, PROXY = 18895;
const ST = process.env.ST ?? 's30';
const TAG = process.env.TAG ?? `s14-${Date.now()}`;
const HOLD_MS = Number(process.env.HOLD_MS ?? 6000);
L.openLog(`s14-${TAG}`);
let turn = 0;
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  if (!messages.slice(lastUser + 1).some((x) => x.role === 'tool'))
    return { toolCalls: [fakeToolCall('run_shell_command', { command: `echo ${TAG}-run-${++turn}` }, `call-${TAG}-${turn}`)] };
  return { content: `done ${TAG}` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
let heldStart: ((v?: unknown) => void) | null = null;
let holdOnce = true;
proxy.state.hook = async (entry: any) => {
  if (holdOnce && /:start$/.test(entry.url)) {
    holdOnce = false;
    heldStart = () => undefined;
    return "drop-request";
  }
  return "forward";
};
const ws = `ws-${ST}`;
const conn = (h: any) => ({ ...L.storeConnection(h, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
const h = await new L.Harness({ name: `s14-${TAG}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const sessionId = await L.createWorkspaceSession(HTTP, ws);
const s = new L.HSession(h, sessionId, conn(h));
L.say('create', `${(await s.create()).status} path=${process.env.LOCAL === '1' ? 'local capture' : 'O2 publication'}`);
const sub = await s.submit(`[[${TAG}]] run it`);
for (let i = 0; i < 200 && !heldStart; i++) await L.sleep(50);
L.say('start held', heldStart ? 'yes' : 'never reached');
await L.sleep(Number(process.env.CANCEL_AFTER_MS ?? 150));
const c = await s.cancel();
L.say('cancel', `${c.status}`);
const st = await s.waitIdle(120_000).catch((e: any) => ({ error: String(e) }));
const events = await s.transcript();
const mine = events.filter((e: any) => e.promptId === sub.promptId);
L.say('turn', `terminal=${mine.filter((e: any) => e.type.startsWith('turn_')).map((e: any) => e.type).join(',') || '<none>'} status=${JSON.stringify(st)}`);
L.say('broker', L.ledgerSince(proxy.ledger, 0).map((l: string) => l.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (x) => x.slice(0, 8))));
const journal = L.sql(DB, `SELECT CAST(record_bytes AS CHAR) FROM qwen_managed_session_journal_tx WHERE session_id='${sessionId}' ORDER BY journal_revision`).map((x: string[]) => x[0]).join('\n');
const kc: Record<string, number> = {};
for (const k of (journal.match(/"kind":"[a-z._]+"/g) ?? []).map((k) => k.slice(8, -1))) kc[k] = (kc[k] ?? 0) + 1;
L.say('journal', kc);
const results = mine.flatMap((e: any) => (e.data?.record?.message?.parts ?? []).filter((p: any) => p.functionResponse).map((p: any) => JSON.stringify(p.functionResponse.response).slice(0, 160)));
L.say('tool results in transcript', results);
const d = await s.detach();
const ld = await s.load();
L.say('reload', `detach ${d.status} load ${ld.status} ${ld.status === 200 ? '' : JSON.stringify(ld.json)}`);
await L.sleep(1000);
L.say('status after reload', JSON.stringify(await s.status()));
const r2 = await s.prompt(`[[${TAG}]] second turn`, 120_000).catch((e: any) => ({ terminal: [], err: String(e) }));
L.say('second turn', L.summarizeTurn(r2));
L.say('harness', h.log().split('\n').filter((l: string) => /fail|block|error|retr|recover|unstarted|not_started/i.test(l)).map((l: string) => l.slice(0, 220)).slice(0, 10));
await h.stop();
process.exit(0);
