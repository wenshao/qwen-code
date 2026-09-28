// S2: real model (qwen3.8-max) drives the Hosted Shell profile on the candidate stack.
// A failing build prints ~107 KB and reports its error on stderr at the very end.
// env: TRIALS, ST_BASE (storage number offset), N (log lines), HARNESS_WT
import fs from 'node:fs';
import * as L from './lib.mjs';

const HTTP = 18894, BPORT = 19894, DB = process.env.DB ?? 'o2a';
const TRIALS = Number(process.env.TRIALS ?? 3);
const BASE = Number(process.env.ST_BASE ?? 20);
const N = Number(process.env.N ?? 3000);
const PROMPT = process.env.PROMPT ?? 'Run ./build.sh in the workspace once and tell me whether the build succeeded. If it failed, quote the exact error message it printed.';
import http from 'node:http';
const realCfg = JSON.parse(fs.readFileSync(`${process.env.HOME}/.qwen/settings.json`, 'utf8'));
const upstream = new URL(realCfg.modelProviders.openai.find((p: any) => p.id === 'qwen3.8-max').baseUrl);
let modelCalls: string[] = [];
const rec = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const target = new URL(upstream.pathname.replace(/\/$/, '') + req.url!.replace(/^\/v1/, ''), upstream);
  const r = await fetch(target, { method: req.method, headers: { 'content-type': 'application/json', authorization: String(req.headers.authorization) }, body: chunks.length ? Buffer.concat(chunks) : undefined });
  res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'text/event-stream' });
  let text = '';
  for await (const c of r.body as any) { text += Buffer.from(c).toString(); res.write(c); }
  res.end();
  const args: Record<string, string> = {}; const names: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
    try { for (const tc of JSON.parse(line.slice(6)).choices?.[0]?.delta?.tool_calls ?? []) { if (tc.function?.name) names[tc.index] = tc.function.name; args[tc.index] = (args[tc.index] ?? '') + (tc.function?.arguments ?? ''); } } catch {}
  }
  for (const i of Object.keys(names)) modelCalls.push(`${names[i]}(${args[i]})`);
});
await new Promise<void>((r) => rec.listen(0, '127.0.0.1', r));
process.env.REAL_BASEURL = `http://127.0.0.1:${(rec.address() as any).port}/v1`;
L.openLog(`s2-real-${process.env.LABEL ?? 'run'}`);
const results: any[] = [];
for (let t = 0; t < TRIALS; t++) {
  const st = `s${String(BASE + t).padStart(2, '0')}`;
  const ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const counter = `${L.RIG}/run/build-runs-${st}.log`;
  fs.rmSync(counter, { force: true });
  for (const dir of [`${process.env.ROOTS ?? L.RIG + "/roots"}/${st}`, `${process.env.ROOTS ?? L.RIG + "/roots"}/${st}/child`]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/build.sh`, `#!/bin/sh\necho "run $$" >> ${counter}\ni=1\nwhile [ $i -le ${N} ]; do echo "compiling module \${i} of ${N} ... ok"; i=$((i+1)); done\necho "ERROR: link step failed: undefined symbol rig_link_target_${t}" >&2\nexit 3\n`, { mode: 0o755 });
  }
  const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
  const h = await new L.Harness({ name: `s2-${st}`, brokerUrl: proxy.url, realModel: 'qwen3.8-max' }).start();
  try {
    const sessionId = await L.createWorkspaceSession(HTTP, ws);
    const s = new L.HSession(h, sessionId, L.storeConnection(h, ws, HTTP));
    const c = await s.create();
    if (c.status !== 200) throw new Error(`create ${c.status} ${JSON.stringify(c.json)}`);
    let r: any;
    try { r = await s.prompt(PROMPT, 600_000); } catch (e) { r = { terminal: [], events: [], status2: await s.status() }; }
    const runs = fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8').trim().split('\n').length : 0;
    const trace = L.toolTrace(r.events ?? []);
    const answer = L.assistantText(r.events ?? []);
    const quoted = answer.includes(`rig_link_target_${t}`);
    const absRead = trace.some((l: string) => l.startsWith('call read_file') && l.includes('/.qwen/tmp'));
    const row = { modelCalls: [...modelCalls], st, sessionId, terminal: L.summarizeTurn(r), runs, quoted, absRead, trace, answer: answer.slice(-600) };
    results.push(row);
    L.say(st, `${row.terminal} build.sh runs=${runs} quotedError=${quoted} readWorkerPath=${absRead}`);
    for (const l of trace) L.say(`${st} tool`, l);
    for (const l of modelCalls) L.say(`${st} model-call`, l.slice(0, 260));
    modelCalls = [];
    L.say(`${st} answer`, answer.slice(-400).replace(/\n/g, ' '));
    L.say(`${st} harness`, h.log().split('\n').filter((l) => /fail|block|error/i.test(l)).map((l) => l.slice(0, 240)));
  } finally {
    await h.stop();
    await proxy.close();
  }
}
fs.writeFileSync(`${L.RIG}/out/s2-${process.env.LABEL ?? 'run'}.json`, JSON.stringify(results, null, 1));
L.say('summary', results.map((r) => `${r.st}: runs=${r.runs} quoted=${r.quoted} absRead=${r.absRead} ${r.terminal.split(' ')[1]}`));
process.exit(0);
