// Round-2 probes at 25749df4 on the real stack (fixture model).
// Q1 CJK read_file result over the 64 KiB inline limit (post-dispatch).
// Q2 transient Store 503 on the assistant commit (bot finding 1).
// Q3 definite :start rejection (bot finding 2).
// Run from wt-pr: ARM=r2 node --import tsx ../rig/s7-r2-probes.ts Q1 Q2 Q3
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'rig3';
const HTTP = Number(process.env.HTTP ?? 18833);
const BROKER = process.env.BROKER ?? 'http://127.0.0.1:19833';
const ARM = process.env.ARM ?? 'r2';
const only = process.argv.slice(2);
const want = (p: string) => !only.length || only.includes(p);
L.openLog(`s7-r2-probes-${ARM}-${only.join('-')}`);

const seen: string[] = [];
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user' && /\[\[/.test(JSON.stringify(m.content)));
  const marker = [...JSON.stringify(messages[lastUser]?.content ?? '').matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].at(-1)?.[1] ?? 'NONE';
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  seen.push(`${marker}#${receipts.length}`);
  const [kind, tag] = marker.split('_');
  if (kind === 'CJKREAD') {
    if (!receipts.length) return { toolCalls: [fakeToolCall('read_file', { file_path: 'guide-zh.md' })] };
    return { content: `read ${JSON.stringify(receipts[0].content).length} chars` };
  }
  if (kind === 'BIGFINAL') {
    if (!receipts.length) return { toolCalls: [fakeToolCall('write_file', { file_path: 'bf.txt', content: 'small' })] };
    return { content: '终'.repeat(30_000) };
  }
  if (kind === 'WRITE') {
    if (!receipts.length) return { toolCalls: [fakeToolCall('write_file', { file_path: `${tag}.txt`, content: `by ${tag}` })] };
    return { content: `${tag} done` };
  }
  return { content: 'text' };
});
const broker = await L.startBrokerProxy(BROKER);
const store = await L.startPassProxy(`http://127.0.0.1:${HTTP}`);
const h = await new L.Harness({ name: `r2-${ARM}`, modelUrl: model.baseUrl, brokerUrl: broker.url }).start();
L.say('arm', `${ARM}: harness ${h.baseUrl}; Store via proxy ${store.url}; Broker via proxy ${broker.url}`);

async function session(st: string, viaStoreProxy = false) {
  const ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const id = await L.createWorkspaceSession(HTTP, ws);
  const conn = { ...L.storeConnection(h, ws, HTTP), ...(viaStoreProxy ? { baseUrl: store.url } : {}) };
  const s = new L.HSession(h, id, conn);
  const c = await s.create();
  if (c.status !== 200) throw new Error(`create ${c.status} ${JSON.stringify(c.json)}`);
  return s;
}
const held = () => L.holders(DB).filter((r) => r[1] !== '<none>').map((r) => r[1].slice(0, 8));
const file = (st: string, n: string) => (fs.existsSync(`${L.RIG}/roots3/${st}/child/${n}`) ? 'written' : 'absent');
const after = async (name: string, s: L.HSession) => {
  const again = await s.submit('[[TEXT]]');
  if (again.status === 202) await s.waitIdle();
  await s.detach();
  const reload = await s.load();
  L.say(name, `next prompt -> ${again.status}${again.status !== 202 ? ' ' + JSON.stringify(again.json) : ''}; reload -> ${reload.status}`);
};

try {
  if (want('Q1')) {
    const st = process.env.ST_Q1 ?? 'q';
    fs.mkdirSync(`${L.RIG}/roots3/${st}/child`, { recursive: true });
    const line = (i: number) => `第${String(i).padStart(4, '0')}行：托管工作区的文件工具需要先持久化再派发，结果提交后模型才能继续。`;
    fs.writeFileSync(`${L.RIG}/roots3/${st}/child/guide-zh.md`, Array.from({ length: 1600 }, (_, i) => line(i)).join('\n'));
    const bytes = fs.statSync(`${L.RIG}/roots3/${st}/child/guide-zh.md`).size;
    L.say('Q1', `--- ws-${st}: read_file of a Chinese document (${bytes} bytes UTF-8, ${[...fs.readFileSync(`${L.RIG}/roots3/${st}/child/guide-zh.md`, 'utf8')].length} chars)`);
    const D = await session(st);
    const t0 = Date.now();
    const d = await D.prompt('[[CJKREAD]]');
    L.say('Q1', `D: ${L.summarizeTurn(d)}`);
    for (const l of L.ledgerSince(broker.ledger, t0)) L.say('Q1 broker', l);
    L.say('Q1', `harness: ${h.log().split('\n').filter((l) => /recovery blocked|failed:/.test(l)).slice(-1)[0]?.replace(/^.*qwen serve: /, '')}`);
    L.say('Q1', `execution rows: ${JSON.stringify(L.sql(DB, "SELECT execution_state, IFNULL(execution_status,'-'), COUNT(*) FROM qwen_tool_execution GROUP BY 1,2"))}; held storages=${JSON.stringify(held())}`);
    await after('Q1 D', D);
    const E = await session(st);
    const e = await E.prompt('[[WRITE_E]]');
    L.say('Q1', `E (other Session, same Workspace): ${L.summarizeTurn(e)} E.txt=${file(st, 'E.txt')}`);
    const e2 = await E.prompt('[[WRITE_E2]]');
    L.say('Q1', `E retry: ${L.summarizeTurn(e2)} E2.txt=${file(st, 'E2.txt')}`);
  }

  if (want('Q2')) {
    const st = process.env.ST_Q2 ?? 'r';
    L.say('Q2', `--- ws-${st}: Session Store answers 503 to the first commit after acquire (the assistant tool-call record)`);
    const G = await session(st, true);
    let armed = false;
    let failed = 0;
    broker.state.hook = (e: { url: string }) => {
      if (e.url.endsWith('/tool-sessions:acquire')) armed = true;
      return 'forward';
    };
    store.state.hook = (e: { method: string; url: string }) => {
      if (armed && e.method === 'POST' && e.url.endsWith('/transactions:commit') && failed === 0) {
        failed++;
        return 'fail-503';
      }
      return 'forward';
    };
    const t0 = Date.now();
    const g = await G.prompt('[[WRITE_G]]');
    broker.state.hook = null;
    store.state.hook = null;
    L.say('Q2', `G: ${L.summarizeTurn(g)} injected=${failed}`);
    for (const l of L.ledgerSince(broker.ledger, t0)) L.say('Q2 broker', l);
    L.say('Q2', `store commits after t0: ${store.ledger.filter((x: { t: number; url: string }) => x.t >= t0 && x.url.endsWith(':commit')).map((x: { status: unknown }) => x.status).join(',')}`);
    L.say('Q2', `harness: ${h.log().split('\n').filter((l) => /recovery blocked|failed:/.test(l)).slice(-1)[0]?.replace(/^.*qwen serve: /, '')}`);
    L.say('Q2', `G.txt=${file(st, 'G.txt')}; prepared executions=${L.sql(DB, "SELECT COUNT(*) FROM qwen_tool_execution")[0][0]} total; held storages=${JSON.stringify(held())}`);
    await after('Q2 G', G);
    const K = await session(st);
    const k = await K.prompt('[[WRITE_K]]');
    L.say('Q2', `K (other Session, same Workspace): ${L.summarizeTurn(k)} K.txt=${file(st, 'K.txt')}`);
  }

  if (want('Q3')) {
    const st = process.env.ST_Q3 ?? 's';
    L.say('Q3', `--- ws-${st}: the Broker definitely refuses :start (payload bytes rewritten by the proxy)`);
    const J = await session(st);
    // Rewrite the start payload bytes so the Broker's digest check refuses it.
    broker.state.hook = async (e: { method: string; url: string; status?: unknown; code?: unknown }, body: Buffer) => {
      if (e.method === 'POST' && e.url.endsWith(':start')) {
        const parsed = JSON.parse(body.toString('utf8'));
        parsed.payloadJson = parsed.payloadJson.replace('"by J"', '"by X"');
        const r = await fetch(new URL(`/internal/runtime-broker/v1${e.url.split('/internal/runtime-broker/v1')[1]}`, BROKER), {
          method: 'POST',
          headers: { Authorization: `Bearer ${L.BROKER_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
        });
        const text = await r.text();
        e.status = `${r.status} (rewritten)`;
        e.code = JSON.parse(text).code;
        return { respond: { status: r.status, text } };
      }
      return 'forward';
    };
    const t0 = Date.now();
    const j = await J.prompt('[[WRITE_J]]', 300_000);
    broker.state.hook = null;
    const led = L.ledgerSince(broker.ledger, t0);
    const gets = led.filter((l: string) => l.startsWith('GET /executions/')).length;
    L.say('Q3', `J: ${L.summarizeTurn(j)}`);
    for (const l of led.filter((l: string) => !l.startsWith('GET /executions/'))) L.say('Q3 broker', l);
    L.say('Q3', `GET /executions/{id} polls: ${gets}`);
    L.say('Q3', `harness: ${h.log().split('\n').filter((l) => /recovery blocked|failed:/.test(l)).slice(-1)[0]?.replace(/^.*qwen serve: /, '')}`);
    L.say('Q3', `J.txt=${file(st, 'J.txt')}; held storages=${JSON.stringify(held())}`);
    await after('Q3 J', J);
  }
  if (want('Q4')) {
    const st = process.env.ST_Q4 ?? 'q4';
    L.say('Q4', `--- ws-${st}: tool batch settles, then the final assistant answer is 90 KB (30,000 CJK chars)`);
    const F = await session(st);
    const t0 = Date.now();
    const f = await F.prompt('[[BIGFINAL]]');
    L.say('Q4', `F: ${L.summarizeTurn(f)}`);
    for (const l of L.ledgerSince(broker.ledger, t0).filter((x: string) => !x.startsWith('GET'))) L.say('Q4 broker', l);
    L.say('Q4', `harness: ${h.log().split('\n').filter((l) => /recovery blocked|failed:/.test(l)).slice(-1)[0]?.replace(/^.*qwen serve: /, '')}`);
    L.say('Q4', `bf.txt=${file(st, 'bf.txt')}; held storages=${JSON.stringify(held())}`);
    await after('Q4 F', F);
    const K = await session(st);
    const k = await K.prompt('[[WRITE_K]]');
    L.say('Q4', `K (other Session, same Workspace): ${L.summarizeTurn(k)} K.txt=${file(st, 'K.txt')}`);
  }
} finally {
  L.say('model', seen.join(' '));
  await h.stop();
  await broker.close();
  await store.close();
  await model.close();
}
