// Model gateway for the PR 13598 rig: logs every chat request the Harness
// makes, optionally holds it (HOLD::<seconds> in the last user message), and
// forwards it to the real qwen3.8-max endpoint with the key injected here.
// The key is read from ~/.qwen/settings.json env at start; it is never
// written to disk or logged.
// usage: node gw5.mjs <port>   (round 4: also FAIL::<status> answers that status at once; per-message markers)
import { createServer } from 'node:http';
import { appendFileSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

const PORT = Number(process.argv[2] ?? 35985);
const LOG = '/Users/wenshao/git/pr13598-rig/runs/model-requests-r5.jsonl';
const settings = JSON.parse(readFileSync(`${process.env.HOME}/.qwen/settings.json`, 'utf8'));
const entry = settings.modelProviders.openai.find((m) => m.id === 'qwen3.8-max');
const KEY = settings.env[entry.envKey];
const UPSTREAM = entry.baseUrl.replace(/\/$/, '');
if (!KEY) throw new Error('no key');

function text(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === 'object' && 'text' in p ? String(p.text) : '')).join('');
  return '';
}
let n = Number(process.env.GW_START ?? 0);
const onceSeen = new Set();
createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const id = ++n;
  const t0 = Date.now();
  let body = {};
  try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch {}
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const users = msgs.filter((m) => m.role === 'user').map((m) => text(m.content));
  const lastUser = users[users.length - 1] ?? '';
  const marker = /(AUTO|USER|MANUAL)::[A-Za-z0-9_:-]+/.exec(users.join('\n'))?.[0] ?? null;
  const hold = /HOLD::(\d+)/.exec(lastUser);
  const all = users.join('\n');
  const auto = /Automation ID: (asch_[0-9a-f]+)[\s\S]*?Occurrence: (\S+)[\s\S]*?Trigger: (\S+)/.exec(lastUser);
  const shape = msgs.map((m) => ({ r: m.role, occ: (text(m.content).match(/Occurrence: \S+/g) ?? []).map((s) => s.slice(12)), tc: (m.tool_calls ?? []).map((c) => c.function?.name + ':' + c.id), tcid: m.tool_call_id ?? undefined, mk: text(m.content).match(/(AUTO|USER|MANUAL)::[A-Za-z0-9_-]+/g) ?? [], head: text(m.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').slice(0, 60) }));
  const rec = { shape, id, auto: auto ? { schedule: auto[1], occurrence: auto[2], trigger: auto[3] } : null, at: new Date(t0).toISOString(), path: req.url, model: body.model, stream: !!body.stream, nmsg: msgs.length, ntools: (body.tools ?? []).length, marker, lastUser: lastUser.slice(0, 300) };
  appendFileSync(LOG, JSON.stringify({ ...rec, phase: 'request' }) + '\n');
  const ac = new AbortController();
  let closed = false;
  res.on('close', () => { closed = true; if (!res.writableFinished) ac.abort(); });
  // FAIL1::<tag>::<status> / HOLD1::<tag>::<s>: only the first request whose last user message carries the tag.
  const fail1 = /FAIL1::([A-Za-z0-9_-]+)::(\d{3})/.exec(lastUser);
  if (fail1 && !onceSeen.has('F' + fail1[1])) {
    onceSeen.add('F' + fail1[1]);
    appendFileSync(LOG, JSON.stringify({ id, phase: 'injected-failure', status: Number(fail1[2]), tag: fail1[1] }) + '\n');
    res.writeHead(Number(fail1[2]), { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'rig injected failure', type: 'invalid_request_error', code: 'rig_injected' } }));
    return;
  }
  const hold1 = /HOLD1::([A-Za-z0-9_-]+)::(\d+)/.exec(lastUser);
  if (hold1 && !onceSeen.has('H' + hold1[1])) {
    onceSeen.add('H' + hold1[1]);
    await new Promise((r) => setTimeout(r, Math.min(Number(hold1[2]), 100) * 1000));
  }
  const fail = /FAIL::(\d{3})/.exec(lastUser);
  if (fail) {
    appendFileSync(LOG, JSON.stringify({ id, phase: 'injected-failure', status: Number(fail[1]) }) + '\n');
    res.writeHead(Number(fail[1]), { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'rig injected failure', type: 'invalid_request_error', code: 'rig_injected' } }));
    return;
  }
  if (hold) await new Promise((r) => setTimeout(r, Math.min(Number(hold[1]), 100) * 1000));
  if (closed) { appendFileSync(LOG, JSON.stringify({ id, phase: 'client-closed-during-hold', ms: Date.now() - t0 }) + '\n'); return; }
  try {
    const up = await fetch(UPSTREAM + req.url.replace(/^\/v1/, ''), {
      method: req.method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, accept: req.headers['accept'] ?? '*/*' },
      body: req.method === 'GET' ? undefined : JSON.stringify({ ...body, model: 'qwen3.8-max' }),
      signal: ac.signal,
    });
    res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'application/json' });
    if (up.body) {
      const s = Readable.fromWeb(up.body);
      s.on('error', () => res.destroy());
      s.pipe(res);
      if (!res.destroyed) await new Promise((r) => res.on('close', r));
    } else res.end();
    appendFileSync(LOG, JSON.stringify({ id, phase: 'done', status: up.status, ms: Date.now() - t0 }) + '\n');
  } catch (e) {
    appendFileSync(LOG, JSON.stringify({ id, phase: 'error', error: String(e), ms: Date.now() - t0 }) + '\n');
    if (!res.headersSent) res.writeHead(502);
    res.destroy();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`gw listening ${PORT} -> ${UPSTREAM}`));
