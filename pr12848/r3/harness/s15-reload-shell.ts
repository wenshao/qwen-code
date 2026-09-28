// After detach + load of a Hosted Session, does the next tool turn work?
// VARIANT=shell-reload | shell-noreload | file-reload | shell-after-file-reload
import fs from 'node:fs';
import { createServer } from 'node:http';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848d';
const HTTP = Number(process.env.HTTP ?? 18848);
const ROOTS = process.env.ROOTS ?? 'roots4';
const VARIANT = process.env.VARIANT ?? 'shell-reload';
const ST = process.env.ST ?? 'h';
L.openLog(`s15-reload-${VARIANT}-${process.env.JAR ?? ''}`);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const m = JSON.stringify(messages[lastUser]?.content ?? '').match(/\[\[(SHELL|FILE)_(\d+)\]\]/);
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (m && !receipts.length)
    return {
      toolCalls: [m[1] === 'SHELL'
        ? fakeToolCall('run_shell_command', { command: `echo shell-${m[2]} >> trace.txt` }, `s-${m[2]}-${Date.now()}`)
        : fakeToolCall('write_file', { file_path: `file-${m[2]}.txt`, content: `file ${m[2]}\n` }, `f-${m[2]}-${Date.now()}`)],
    };
  return { content: 'ok' };
});
const log: string[] = [];
const cap = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const r = await fetch(new URL(req.url!, 'http://127.0.0.1:19848'), {
    method: req.method,
    headers: { Authorization: `Bearer ${L.BROKER_TOKEN}`, 'Content-Type': 'application/json' },
    ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
  });
  const text = await r.text();
  const route = `${req.method} ${req.url!.replace(/\?.*$/, '').replace('/internal/runtime-broker/v1', '')}`;
  let extra = '';
  try {
    const j = JSON.parse(text);
    extra = j.code ? ` code=${j.code} ${String(j.message ?? '').slice(0, 80)}` : j.status ? ` state=${j.status.state}` : '';
  } catch {}
  log.push(`${route.replace(/[0-9a-f-]{36}/g, (x) => x.slice(0, 8))} -> ${r.status}${extra}`);
  res.writeHead(r.status, { 'Content-Type': 'application/json' });
  res.end(text);
});
await new Promise<void>((r) => cap.listen(0, '127.0.0.1', r));
let h = await new L.Harness({ name: `reload-${VARIANT}`, modelUrl: model.baseUrl, brokerUrl: `http://127.0.0.1:${(cap.address() as any).port}` }).start();
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const dir = `${L.RIG}/${ROOTS}/${ST}/child`;
fs.mkdirSync(dir, { recursive: true });
const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await s.create({ toolProfile: 'hosted-workspace-shell/1' });
const steps = {
  'shell-reload': ['SHELL_1', 'RELOAD', 'SHELL_2'],
  'shell-noreload': ['SHELL_1', 'SHELL_2', 'SHELL_3'],
  'file-reload': ['FILE_1', 'RELOAD', 'FILE_2'],
  'text-reload-shell': ['TEXT', 'RELOAD', 'SHELL_2'],
  'fresh-reload-shell': ['RELOAD', 'SHELL_1'],
  'shell-restart': ['SHELL_1', 'RESTART', 'SHELL_2'],
}[VARIANT]!;
for (const step of steps) {
  if (step === 'RESTART') {
    await s.detach();
    await h.stop();
    h = await new L.Harness({ name: `reload-${VARIANT}-2`, modelUrl: model.baseUrl, brokerUrl: `http://127.0.0.1:${(cap.address() as any).port}` }).start();
    (s as any).h = h;
    (s as any).connection = L.storeConnection(h, ws, HTTP);
    const load = await s.load({ toolProfile: 'hosted-workspace-shell/1' });
    L.say('restart', `Harness stopped and restarted (new boot); load -> ${load.status}`);
    continue;
  }
  if (step === 'RELOAD') {
    await s.detach();
    const load = await s.load({ toolProfile: 'hosted-workspace-shell/1' });
    L.say('reload', `detach + load -> ${load.status}`);
    continue;
  }
  log.length = 0;
  const r = await s.prompt(`[[${step}]]`);
  L.say(step, L.summarizeTurn(r));
  for (const l of log) L.say(`${step} broker`, l);
}
L.say('harness', h.log().split('\n').filter((l) => /failed|blocked/i.test(l)).map((l) => l.slice(0, 300)));
L.say('fs', fs.readdirSync(dir).map((f) => `${f}=${JSON.stringify(fs.readFileSync(`${dir}/${f}`, 'utf8'))}`).join(' '));
await h.stop();
cap.close();
process.exit(0);
