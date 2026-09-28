// d00068fd: Broker observation of an UNKNOWN v3 record (the worker request
// times out at 30 s while the command keeps running). Captures the Broker's
// status bodies seen by the Hosted client. LONG = plain 45 s command,
// CANCEL = same command cancelled at ~35 s (inside the UNKNOWN window).
import fs from 'node:fs';
import { createServer } from 'node:http';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848d';
const HTTP = Number(process.env.HTTP ?? 18848);
const ROOTS = process.env.ROOTS ?? 'roots4';
const JAR = process.env.JAR ?? 'r4';
const [ST_LONG, ST_CANCEL] = (process.env.LETTERS ?? 'b,c').split(',');
L.openLog(`s14-unknown-observe-${JAR}`);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (/\[\[(LONG|CANCEL)\]\]/.test(JSON.stringify(messages[lastUser]?.content)) && !receipts.length)
    return { toolCalls: [fakeToolCall('run_shell_command', { command: 'sh wait45.sh', timeout: 120000 }, `long-${Date.now()}`)] };
  return { content: 'ok' };
});
const seen: Array<{ t: number; route: string; status: number; state?: string; keys?: string; cancelRequested?: unknown }> = [];
// Minimal capture proxy of our own (the lib proxy drops query strings from entry.url).
const cap = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const r = await fetch(new URL(req.url!, 'http://127.0.0.1:19848'), {
    method: req.method,
    headers: { Authorization: `Bearer ${L.BROKER_TOKEN}`, 'Content-Type': 'application/json' },
    ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
  });
  const text = await r.text();
  const route = `${req.method} ${req.url!.replace(/\?.*$/, '').replace('/internal/runtime-broker/v1', '').replace(/[0-9a-f-]{36}/g, '<id>')}`;
  if (/executions\/<id>(:start|:cancel)?$/.test(route)) {
    try {
      const st = JSON.parse(text).status ?? {};
      seen.push({ t: Date.now(), route, status: r.status, state: st.state, keys: Object.keys(st).sort().join(','), cancelRequested: st.cancelRequested });
    } catch {
      seen.push({ t: Date.now(), route, status: r.status });
    }
  }
  res.writeHead(r.status, { 'Content-Type': 'application/json' });
  res.end(text);
});
await new Promise<void>((r) => cap.listen(0, '127.0.0.1', r));
const capUrl = `http://127.0.0.1:${(cap.address() as any).port}`;
const h = await new L.Harness({ name: `unk-obs-${JAR}`, modelUrl: model.baseUrl, brokerUrl: capUrl }).start();
async function run(st: string, marker: 'LONG' | 'CANCEL') {
  const ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const dir = `${L.RIG}/${ROOTS}/${st}/child`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/wait45.sh`, 'echo start >> slow.txt\nsleep 45\necho done >> slow.txt\necho finished\n');
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  await s.create({ toolProfile: 'hosted-workspace-shell/1' });
  seen.length = 0;
  const t0 = Date.now();
  const sub = await s.submit(`[[${marker}]]`);
  if (marker === 'CANCEL') {
    while (Date.now() - t0 < 35000) await L.sleep(250);
    const c = await s.cancel();
    L.say(`${marker} cancel`, `POST /cancel at ${Date.now() - t0} ms -> ${c.status}`);
  }
  const status = await s.waitIdle(240000);
  const events = (await s.transcript()).filter((e: any) => e.promptId === sub.promptId);
  const term = events.filter((e: any) => e.type.startsWith('turn_')).map((e: any) => `${e.type}(${e.data?.stopReason ?? ''})`).join(',');
  const results = events.flatMap((e: any) => e.data?.record?.message?.parts ?? []).filter((p: any) => p.functionResponse).map((p: any) => `status=${p.functionResponse.response.executionStatus} capture=${p.functionResponse.response.capture?.captureStatus}/${p.functionResponse.response.capture?.deliveryStatus}`);
  L.say(marker, `${term} after ${Date.now() - t0} ms; recoveryBlocked=${status.recoveryBlocked}; ${results.join(' ')}; slow.txt=${JSON.stringify(fs.readFileSync(`${dir}/slow.txt`, 'utf8'))}`);
  const groups = new Map<string, number>();
  for (const e of seen) {
    const k = `${e.route} -> ${e.status} state=${e.state ?? '-'} keys=[${e.keys ?? ''}]${e.cancelRequested !== undefined ? ` cancelRequested=${e.cancelRequested}` : ''}`;
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  for (const [k, v] of groups) L.say(`${marker} broker`, `${v}x ${k}`);
  const row = L.sql(DB, `SELECT execution_state, IFNULL(execution_status,'-'), record_version FROM qwen_tool_execution WHERE harness_session_id='${s.sessionId}'`);
  L.say(`${marker} db`, JSON.stringify(row));
  const next = await s.prompt('[[TEXT]]');
  L.say(`${marker} next`, L.summarizeTurn(next));
}
try {
  if (!process.env.ONLY || process.env.ONLY === 'LONG') await run(ST_LONG, 'LONG');
  if (!process.env.ONLY || process.env.ONLY === 'CANCEL') await run(ST_CANCEL, 'CANCEL');
} finally {
  await h.stop();
  cap.close();
}
process.exit(0);
