// Recording proxy in front of the real provider: logs the model's streamed
// tool calls (not headers) while a real-model Shell-profile turn runs.
import fs from 'node:fs';
import http from 'node:http';
import * as L from './lib.mjs';
const real = JSON.parse(fs.readFileSync(`${process.env.HOME}/.qwen/settings.json`, 'utf8'));
const MODEL = process.env.REAL_MODEL ?? 'qwen3.8-max';
const upstream = new URL(real.modelProviders.openai.find((p) => p.id === MODEL).baseUrl);
const ST = process.env.ST ?? 'v', DB = process.env.DB ?? 'p848f', HTTP = 18848, PORT = process.env.PORT ?? '18768';
L.openLog(`s21-record-real-${ST}`);
const calls = [];
const proxy = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const target = new URL(upstream.pathname.replace(/\/$/, '') + req.url.replace(/^\/v1/, ''), upstream);
  const r = await fetch(target, { method: req.method, headers: { 'content-type': 'application/json', authorization: req.headers.authorization }, body: chunks.length ? Buffer.concat(chunks) : undefined });
  res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'text/event-stream' });
  let text = '';
  for await (const c of r.body) { text += Buffer.from(c).toString(); res.write(c); }
  res.end();
  const args = {}; const names = {};
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
    try { for (const tc of JSON.parse(line.slice(6)).choices?.[0]?.delta?.tool_calls ?? []) { if (tc.function?.name) names[tc.index] = tc.function.name; args[tc.index] = (args[tc.index] ?? '') + (tc.function?.arguments ?? ''); } } catch {}
  }
  for (const i of Object.keys(names)) calls.push(`${names[i]}(${args[i]})`);
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
process.env.REAL_BASEURL = `http://127.0.0.1:${proxy.address().port}/v1`;
const h = await new L.Harness({ name: `rec-${ST}`, brokerUrl: 'http://127.0.0.1:19848', realModel: MODEL }).start();
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const dir = `${L.RIG}/${process.env.ROOTS ?? 'roots6'}/${ST}/child`;
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${dir}/index.html`, '<h1>hello</h1>\n');
const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await s.create({ toolProfile: 'hosted-workspace-shell/1' });
const r = await s.prompt(process.env.PROMPT ?? `Start a simple HTTP server for this directory on port ${PORT} (python3 -m http.server is fine) so it keeps running, then fetch http://127.0.0.1:${PORT}/index.html with curl and tell me what it returned.`, 240000);
L.say('turn', L.summarizeTurn(r));
for (const c of calls) L.say('model call', c.slice(0, 240));
L.say('harness', h.log().split('\n').filter((l) => /blocked|failed/.test(l)).slice(-2).map((l) => l.slice(0, 200)));
await h.stop();
proxy.close();
process.exit(0);
