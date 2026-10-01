// PR #13087 rig: create one real Workspace Session, run N real Shell calls through the
// packaged Hosted Harness + Broker worker (each call = one O2 publication), detach, and
// optionally DELETE the Session through the public API (which retires its output).
// env: DB, ST, TAG, RUNS ("so:se:code,..." one Shell call each), DELETE=1, HTTP, BPORT, PROXY, CAPTURE
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr13087/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o4a';
const HTTP = Number(process.env.HTTP ?? 28894), BPORT = Number(process.env.BPORT ?? 29894), PROXY = Number(process.env.PROXY ?? 28895);
const ST = process.env.ST ?? 's01';
const TAG = process.env.TAG ?? `mk-${Date.now()}`;
const RUNS = (process.env.RUNS ?? `${5 * 1024 * 1024 + 333}:${1024 * 1024 + 77}:0`).split(',').map((r) => r.split(':').map(Number));
L.openLog(`mk-${TAG}`);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  const text = JSON.stringify(messages[lastUser]?.content ?? '');
  const i = Number(text.match(/\[\[[^\]#]+#(\d+)\]\]/)?.[1] ?? 0);
  if (!receipts.length) {
    const [so, se, code] = RUNS[i];
    return { toolCalls: [fakeToolCall('run_shell_command', { command: `${L.NODE22} ${L.RIG}/gen.mjs ${TAG}-${i} ${so} ${se} ${code}` }, `call-${TAG}-${i}`)] };
  }
  return { content: `done ${TAG}#${i}` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
const h = await new L.Harness({ name: `mk-${TAG}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
let sessionId: string;
if (process.env.LEGACY === '1') {
  const r = await L.api(HTTP, 'POST', '/v1/agents/sessions', { actor: 'alice', idem: randomUUID(), body: { agent_id: 'qwen-code' } });
  if (r.status >= 300) throw new Error('legacy create ' + r.status + JSON.stringify(r.json));
  sessionId = r.json.id;
} else sessionId = await L.createWorkspaceSession(HTTP, ws);
const s = new L.HSession(h, sessionId, { ...L.storeConnection(h, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
const created = await s.create();
L.say('create', `${created.status} session=${sessionId}`);
const t0 = Date.now();
for (let i = 0; i < RUNS.length; i++) {
  const r = await s.prompt(`[[${TAG}#${i}]] run it`, Number(process.env.TIMEOUT ?? 600_000)).catch((e: unknown) => ({ status: 'timeout', terminal: [], status2: { error: String(e) } }));
  L.say('turn', `#${i} ${RUNS[i].join(':')} ${L.summarizeTurn(r)}`);
}
L.say('turns', `${RUNS.length} Shell calls in ${Date.now() - t0} ms`);
const d = await s.detach();
L.say('detach', d.status);
await h.stop();
const pubs = L.publications(DB, sessionId).map((p: any) => {
  const objs = L.objects(DB, p.id);
  return { ...p, objects: objs.length, ossObjects: objs.filter((o: any) => o.objectKey).length, inline: objs.filter((o: any) => o.inline).length };
});
L.say('catalog', pubs.map((p: any) => `${p.id.slice(0, 8)} state=${p.state} phase=${p.phase} objects=${p.objects} oss=${p.ossObjects} inline=${p.inline} held=${JSON.stringify(p.held)}`));
let deleteOp: any = null;
if (process.env.DELETE === '1') {
  for (let attempt = 0; attempt < 30; attempt++) {
    const del = await L.api(HTTP, 'DELETE', `/v1/agents/sessions/${sessionId}`, { actor: 'alice', idem: `del-${TAG}` });
    deleteOp = del.json;
    const opId = del.json?.id ?? del.json?.operation_id;
    L.say('delete', `${del.status} ${JSON.stringify(del.json).slice(0, 200)}`);
    if (del.status >= 300) { await L.sleep(2000); continue; }
    for (let i = 0; i < 120; i++) {
      const op = await L.api(HTTP, 'GET', `/v1/agents/sessions/${sessionId}/operations/${opId}`, { actor: 'alice' });
      deleteOp = op.json;
      if (/complet|succeed|fail/i.test(JSON.stringify(op.json?.status ?? op.json?.state ?? ''))) break;
      await L.sleep(500);
    }
    break;
  }
  L.say('delete-op', JSON.stringify(deleteOp).slice(0, 300));
  L.say('retention', L.sql(DB, `SELECT CONCAT(LEFT(publication_id,8),' ',retention_state) FROM qwen_tool_publication WHERE session_id='${sessionId}'`).map((x: string[]) => x[0]));
}
fs.writeFileSync(`${L.RIG}/out/mk-${TAG}.json`, JSON.stringify({ tag: TAG, db: DB, sessionId, ws, pubs, deleteOp }, null, 1));
await proxy.close();
process.exit(0);
