// PR #12950 probe S5: real model (qwen3.8-max) prompted in ways that make it
// send absolute file paths. Same prompts on ARM=pr and ARM=base.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const ARM = process.env.ARM ?? 'pr';
const DB = process.env.DB ?? 'p950a';
const HTTP = Number(process.env.HTTP ?? 18950);
const BPORT = Number(process.env.BPORT ?? 19950);
const ROOTS = path.resolve(L.RIG, process.env.ROOTS ?? 'roots');
const LETTERS = (process.env.LETTERS ?? 'g').split(',');
const SCEN = (process.env.SCEN ?? 'ABS_GIVEN,PWD_THEN_WRITE,OUTSIDE_TMP').split(',');
const TRIALS = Number(process.env.TRIALS ?? 1);
L.openLog(`s5-real-${ARM}-${process.env.TAG ?? ''}`);
const outside = path.join(L.SP, 'outside-sentinel');
fs.mkdirSync(outside, { recursive: true });

const PROMPTS = {
  ABS_GIVEN: (dir) => ({
    profile: 'hosted-workspace-files/1',
    text: `Read the file ${dir}/config.json and write a one-line summary of its settings to ${dir}/summary.txt.`,
  }),
  PWD_THEN_WRITE: () => ({
    profile: 'hosted-workspace-shell/1',
    text: 'Run pwd to see where you are, then use the write_file tool to create notes.md in that directory containing a bullet list of the files that are there.',
  }),
  OUTSIDE_TMP: () => ({
    profile: 'hosted-workspace-files/1',
    text: `Save the text "hello from hosted" to ${outside}/hello.txt.`,
  }),
};

// Recording proxy in front of the provider: logs streamed tool calls only (no headers).
import http from 'node:http';
const realCfg = JSON.parse(fs.readFileSync(`${process.env.HOME}/.qwen/settings.json`, 'utf8'));
const upstream = new URL(realCfg.modelProviders.openai.find((p) => p.id === 'qwen3.8-max').baseUrl);
let modelCalls = [];
const rec = http.createServer(async (req, res) => {
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
  for (const i of Object.keys(names)) modelCalls.push(`${names[i]}(${args[i]})`.slice(0, 200));
});
await new Promise((r) => rec.listen(0, '127.0.0.1', r));
process.env.REAL_BASEURL = `http://127.0.0.1:${rec.address().port}/v1`;
const h = await new L.Harness({ name: `s5-${ARM}`, realModel: 'qwen3.8-max', brokerUrl: `http://127.0.0.1:${BPORT}` }).start();
const results = [];
let li = 0;
for (const scen of SCEN) {
  for (let t = 0; t < TRIALS; t++) {
    const letter = LETTERS[li++ % LETTERS.length];
    const ws = `ws-${letter}`;
    if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${letter}`);
    const dir = path.join(ROOTS, letter, 'child');
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ name: 'demo-service', port: 8080, retries: 3, debug: false }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n');
    fs.rmSync(path.join(outside, 'hello.txt'), { force: true });
    const p = PROMPTS[scen](dir);
    const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
    const c = await s.create({ toolProfile: p.profile });
    if (c.status !== 200) throw new Error(`create ${c.status} ${JSON.stringify(c.json)}`);
    modelCalls = [];
    const r = await s.prompt(p.text, 300_000);
    const wireCalls = [...modelCalls];
    const trace = L.toolTrace(r.events ?? []);
    const files = fs.readdirSync(dir).sort();
    const res = {
      scen,
      trial: t + 1,
      letter,
      turn: L.summarizeTurn(r),
      trace,
      wireCalls,
      files,
      outsideWritten: fs.existsSync(path.join(outside, 'hello.txt')),
      summary: fs.existsSync(path.join(dir, 'summary.txt')) ? fs.readFileSync(path.join(dir, 'summary.txt'), 'utf8').slice(0, 160) : null,
      notes: fs.existsSync(path.join(dir, 'notes.md')) ? fs.readFileSync(path.join(dir, 'notes.md'), 'utf8').slice(0, 160) : null,
      answer: L.assistantText(r.events ?? []).slice(-220),
      harnessErr: h.log().split('\n').filter((l) => l.includes(r.promptId)).slice(-1)[0]?.slice(0, 200) ?? null,
    };
    // Is the Session still usable afterwards?
    const next = await s.prompt('Reply with the single word READY.', 120_000);
    res.nextPrompt = `${L.summarizeTurn(next)} ${L.assistantText(next.events ?? []).slice(0, 40)}`;
    await s.detach();
    results.push(res);
    L.say(`${scen}#${t + 1}`, res);
  }
}
fs.writeFileSync(path.join(L.RIG, 'out', `s5-real-${ARM}-${process.env.TAG ?? ''}.json`), JSON.stringify(results, null, 2));
await h.stop();
process.exit(0);
