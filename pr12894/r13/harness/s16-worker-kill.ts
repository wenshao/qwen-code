// S16: the worker process running a Hosted Shell call dies mid-execution
// (SIGKILL), so the Broker loses the binding while the Tool v3 execution is
// running. Exercises the merged unknownWhenAdmissionClosed() path on v3.
// The worker is found by the port the Broker last sent /v3/execute to (from the
// JVM forward-proxy ledger) and must be a child of the rig Spring process.
// env: DB, ST, TAG, LOCAL=1 for the local path
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o2y';
const HTTP = 18894, BPORT = 19894, PROXY = 18895;
const ST = process.env.ST ?? 's40';
const TAG = process.env.TAG ?? `s16-${Date.now()}`;
const LEDGER = `${L.RIG}/run/fwd-ledger.log`;
L.openLog(`s16-${TAG}`);
let turn = 0;
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  if (!messages.slice(lastUser + 1).some((x) => x.role === 'tool'))
    return { toolCalls: [fakeToolCall('run_shell_command', { command: turn++ === 0 ? `echo ${TAG}-start; sleep 20; echo ${TAG}-slow` : `echo ${TAG}-second` }, `call-${TAG}-${turn}`)] };
  return { content: `done ${TAG}` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
const ws = `ws-${ST}`;
const conn = (h: any) => ({ ...L.storeConnection(h, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
const h = await new L.Harness({ name: `s16-${TAG}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const sessionId = await L.createWorkspaceSession(HTTP, ws);
const s = new L.HSession(h, sessionId, conn(h));
L.say('create', `${(await s.create()).status} path=${process.env.LOCAL === '1' ? 'local capture' : 'O2 publication'}`);
const ledgerStart = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split('\n').length : 0;
const sub = await s.submit(`[[${TAG}]] run it`);
let executing = false;
for (let i = 0; i < 300 && !executing; i++) {
  executing = proxy.ledger.some((e: any) => /:start$/.test(e.url) && e.code === 'state=executing') || proxy.ledger.some((e: any) => /^\/executions\/[^/:]+$/.test(e.url.replace('/internal/runtime-broker/v1', '')) && e.code === 'state=executing');
  if (!executing) await L.sleep(100);
}
await L.sleep(2000);
const lines = fs.readFileSync(LEDGER, 'utf8').split('\n').slice(ledgerStart - 1).filter((l) => /\/v[23]\/execute ->|\/v2\/execute/.test(l));
const port = lines.at(-1)?.match(/127\.0\.0\.1:(\d+)\//)?.[1];
const spring = execSync(`lsof -nP -iTCP:${HTTP} -sTCP:LISTEN -t`, { encoding: 'utf8' }).trim();
let killed = 'no worker found';
if (port) {
  const pid = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t || true`, { encoding: 'utf8' }).trim().split('\n')[0];
  const ppid = pid ? execSync(`ps -o ppid= -p ${pid}`, { encoding: 'utf8' }).trim() : '';
  if (pid && ppid === spring) {
    process.kill(Number(pid), 'SIGKILL');
    killed = `SIGKILL worker pid ${pid} (port ${port}, parent Spring ${spring})`;
  } else killed = `refused: pid ${pid} ppid ${ppid} spring ${spring}`;
}
L.say('kill', `executing=${executing}; ${killed}`);
const t0 = Date.now();
const st = await s.waitIdle(300_000).catch((e: any) => ({ error: String(e) }));
const events = await s.transcript();
const mine = events.filter((e: any) => e.promptId === sub.promptId);
L.say('turn', `terminal=${mine.filter((e: any) => e.type.startsWith('turn_')).map((e: any) => e.type).join(',') || '<none>'} after ${Date.now() - t0} ms; status=${JSON.stringify(st)}`);
L.say('broker', L.ledgerSince(proxy.ledger, 0).map((l: string) => l.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (x) => x.slice(0, 8))).reduce((acc: string[], l: string) => { const last = acc.at(-1); if (last && last.replace(/ x\d+$/, '') === l) acc[acc.length - 1] = `${l} x${(Number(last.match(/ x(\d+)$/)?.[1] ?? 1)) + 1}`; else acc.push(l); return acc; }, []));
const results = mine.flatMap((e: any) => (e.data?.record?.message?.parts ?? []).filter((p: any) => p.functionResponse).map((p: any) => JSON.stringify(p.functionResponse.response).slice(0, 180)));
L.say('tool results', results);
const d = await s.detach();
const tl = Date.now();
let ld: any;
do { ld = await s.load(); if (ld.status !== 200) await L.sleep(3000); } while (ld.status !== 200 && Date.now() - tl < 90_000);
L.say('reload', `detach ${d.status} load ${ld.status} after ${Date.now() - tl} ms ${ld.status === 200 ? '' : JSON.stringify(ld.json)}`);
if (ld.status === 200) {
  const r2 = await s.prompt(`[[${TAG}]] second turn`, 120_000).catch((e: any) => ({ terminal: [], err: String(e) }));
  L.say('second turn', L.summarizeTurn(r2));
}
L.say('harness', h.log().split('\n').filter((l: string) => /fail|block|error|retr|recover|unknown|admission/i.test(l)).map((l: string) => l.slice(0, 220)).slice(0, 10));
await h.stop();
process.exit(0);
