// Sandbox Finding 1 check: many foreground Shell turns in ONE Hosted Session.
// Records each turn's Runtime Session id (from the Broker :publisher path) and
// the worker processes that served them.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848d';
const HTTP = Number(process.env.HTTP ?? 18848);
const ST = process.env.ST ?? 'a';
const ROOTS = process.env.ROOTS ?? 'roots4';
L.openLog(`s13-multiturn-${process.env.ARM ?? 'r3'}-${process.env.JAR ?? ''}`);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const n = (JSON.stringify(messages[lastUser]?.content ?? '').match(/\[\[TURN_(\d+)\]\]/) ?? [])[1];
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (n && !receipts.length) return { toolCalls: [fakeToolCall('run_shell_command', { command: `echo turn-${n} >> multi.txt; echo pid=$$` }, `turn-${n}-${Date.now()}`)] };
  return { content: `done ${n ?? ''}` };
});
const broker = await L.startBrokerProxy('http://127.0.0.1:19848');
const h = await new L.Harness({ name: `multi-${process.env.JAR ?? ''}`, modelUrl: model.baseUrl, brokerUrl: broker.url }).start();
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
fs.mkdirSync(`${L.RIG}/${ROOTS}/${ST}/child`, { recursive: true });
const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await s.create({ toolProfile: 'hosted-workspace-shell/1' });
const launchesBefore = L.launches(DB).length;
for (let n = 1; n <= 6; n++) {
  if (n === 4) {
    await s.detach();
    const load = await s.load({ toolProfile: 'hosted-workspace-shell/1' });
    L.say('reload', `detach + load -> ${load.status}`);
  }
  const t0 = Date.now();
  const r = await s.prompt(`[[TURN_${n}]]`);
  const pub = broker.ledger.filter((e) => e.t >= t0 && /:publisher$/.test(e.url)).map((e) => `${e.url.match(/tool-sessions\/([^:]+):publisher/)?.[1]?.slice(0, 8)} -> ${e.status}${e.code ? ' ' + e.code : ''}`);
  const out = (r.events ?? []).flatMap((e) => e.data?.record?.message?.parts ?? []).filter((p) => p.functionResponse).map((p) => JSON.stringify(p.functionResponse.response).match(/pid=(\d+)/)?.[1]);
  L.say(`turn ${n}`, `${L.summarizeTurn(r)}; publisher registration (runtime session): ${pub.join(', ') || 'none'}; shell pid ${out.join(',')}`);
}
const launches = L.launches(DB).slice(launchesBefore);
L.say('workers', `${launches.length} worker launch(es) during 6 Shell turns: ${launches.map((l) => l.split(' ').slice(0, 2).join(' ')).join(' | ')}`);
L.say('fs', `multi.txt=${JSON.stringify(fs.readFileSync(`${L.RIG}/${ROOTS}/${ST}/child/multi.txt`, 'utf8'))}`);
await h.stop();
await broker.close();
process.exit(0);
