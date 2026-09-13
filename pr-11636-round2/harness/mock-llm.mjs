// Scripted OpenAI-compatible provider for PR #11636 verification.
//
// Routing is by conversation state, never by request counter:
//  - subagent request : a user message carries [[SUB:name:delayMs]] and no user
//                       message carries a parent scenario marker [[S:name]]
//  - parent request   : the newest [[S:name]] user marker selects the scenario;
//                       step = assistant tool-call messages after that marker
//  - side query       : no `agent` tool declared -> short text
// Messages after the last assistant message are the request's NEW input; the
// oracle for "what the model received" is <task-notification> / [[STEER]] there.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.MOCK_PORT || 18636);
const OUT = process.env.MOCK_OUT || '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/63de0ea4-4d44-4577-a263-66b150608516/scratchpad/h/out/mock';
let runDir = path.join(OUT, 'default');
let seq = 0;
let records = [];
let RUN_TAG = Date.now().toString(36);
fs.mkdirSync(runDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const textOf = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('')
      : '';

const agent = (name, desc, delay) => ({
  name: 'agent',
  args: {
    description: desc,
    prompt: `[[SUB:${name}:${delay}]] Investigate ${desc} and report back.`,
    run_in_background: true,
  },
});
const shell = (command) => ({
  name: 'run_shell_command',
  args: { command: `${command} # intentional-sleep: harness pacing for PR 11636`, description: 'silent wait', is_background: false },
});

// Parent scripts: index = step. Each entry -> {tools:[...]} or {text, ms}.
const SCRIPTS = {
  hello: { steps: [{ text: 'HELLO-DONE', ms: 300 }] },
  idle: {
    steps: [{ tools: [agent('alpha', 'Alpha probe', 6000)] }, { text: 'PARENT-DONE idle: alpha launched.', ms: 300 }],
    notifMs: 6000,
  },
  same: {
    steps: [
      { tools: [agent('alpha', 'Alpha probe', 1500)] },
      { tools: [shell('sleep 6')] },
      { text: 'PARENT-DONE same: shell finished.', ms: 300 },
    ],
    notifMs: 2000,
  },
  steer: {
    steps: [{ tools: [agent('alpha', 'Alpha probe', 3000)] }, { text: 'PARENT-DONE steer: alpha launched.', ms: 300 }],
    notifMs: 12000,
  },
  stop: {
    steps: [
      { tools: [agent('alpha', 'Alpha probe', 4000), agent('beta', 'Beta probe', 9000)] },
      { text: 'PARENT-DONE stop: alpha+beta launched.', ms: 300 },
    ],
    notifMs: 20000,
  },
  after: { steps: [{ text: 'AFTER-DONE: new user prompt answered.', ms: 1500 }], notifMs: 2000 },
  slow: { steps: [{ text: 'SLOW-DONE: ordinary user turn finished.', ms: 8000 }], notifMs: 3000 },
  two: {
    steps: [
      { tools: [agent('alpha', 'Ownership investigation', 5000), agent('beta', 'Rendering investigation', 11000)] },
      { text: 'Both investigations are running.', ms: 300 },
    ],
    notifMs: 3000,
    answers: {
      'Ownership investigation': 'Ownership is understood; rendering is still being investigated.',
      'Rendering investigation': 'Ownership and rendering findings are complete. This is the final main-agent answer.',
    },
  },
  overflow: {
    steps: [
      { tools: Array.from({ length: 21 }, (_, i) => agent(`o${String(i + 1).padStart(2, '0')}`, `Overflow probe ${String(i + 1).padStart(2, '0')}`, 1500)) },
      { tools: [shell('sleep 10')] },
      { text: 'PARENT-DONE overflow.', ms: 300 },
    ],
    notifMs: 800,
  },
};
SCRIPTS.overflowb = {
  // All 21 results complete during ONE silent tool call, so they reach the
  // same safe boundary together and the default queue (20) must overflow.
  steps: [
    { tools: Array.from({ length: 21 }, (_, i) => agent(`q${String(i + 1).padStart(2, '0')}`, `Queue probe ${String(i + 1).padStart(2, '0')}`, 12000)) },
    { tools: [shell('sleep 22')] },
    { text: 'PARENT-DONE overflowb.', ms: 300 },
  ],
  notifMs: 800,
};
SCRIPTS.stopbase = SCRIPTS.stop;

function classify(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const tools = (body.tools ?? []).map((t) => t?.function?.name);
  const userTexts = msgs.map((m, i) => ({ i, role: m.role, text: textOf(m.content) }));
  let scenario;
  let markerIdx = -1;
  for (const u of userTexts) {
    if (u.role !== 'user') continue;
    const all = [...u.text.matchAll(/\[\[S:([a-z]+)\]\]/g)];
    if (all.length) {
      scenario = all.at(-1)[1];
      markerIdx = u.i;
    }
  }
  const sub = userTexts.find((u) => u.role === 'user' && /\[\[SUB:/.test(u.text));
  let lastAssistant = -1;
  msgs.forEach((m, i) => {
    if (m.role === 'assistant') lastAssistant = i;
  });
  const fresh = msgs.slice(lastAssistant + 1);
  const freshUser = fresh.filter((m) => m.role === 'user').map((m) => textOf(m.content));
  const freshJoined = freshUser.join('\n');
  const notifs = [...freshJoined.matchAll(/<summary>Agent "([^"]+)"/g)].map((m) => m[1]);
  const notifTaskIds = [...freshJoined.matchAll(/<task-id>([^<]+)<\/task-id>/g)].map((m) => m[1]);
  // every notification ever delivered in this conversation (history is append-only)
  const everJoined = userTexts.filter((u) => u.role === 'user').map((u) => u.text).join('\n');
  const everNotifs = [...everJoined.matchAll(/<summary>Agent "([^"]+)"/g)].map((m) => m[1]);
  const steer = [...freshJoined.matchAll(/\[\[STEER[^\]]*\]\][^\n<]*/g)].map((m) => m[0]);
  let step = 0;
  for (let i = markerIdx + 1; i < msgs.length; i++) {
    if (msgs[i].role === 'assistant' && (msgs[i].tool_calls ?? []).length) step++;
  }
  let kind = 'other';
  if (sub && !scenario) kind = 'sub';
  else if (scenario && tools.includes('agent')) kind = 'parent';
  return {
    kind,
    scenario,
    step,
    sub: sub ? sub.text.match(/\[\[SUB:([^:]+):(\d+)\]\]/)?.slice(1) : undefined,
    notifs,
    notifTaskIds,
    everNotifs,
    steer,
    freshUserExcerpts: freshUser.map((t) => t.replace(/\s+/g, ' ').slice(0, 400)),
    freshRoles: fresh.map((m) => m.role),
    tools: tools.length,
  };
}

function plan(c) {
  if (c.kind === 'sub') {
    const [name, delay] = c.sub;
    return { delay: Number(delay), text: `SUBRESULT-${name}: evidence collected.`, ms: 200 };
  }
  if (c.kind !== 'parent') return { text: 'mock side answer', ms: 50 };
  const s = SCRIPTS[c.scenario] ?? SCRIPTS.hello;
  if (c.steer.length) {
    return { text: `STEER-ACK (${c.steer.join(' | ')})${c.notifs.length ? ` + HANDLED[${c.notifs.join(',')}]` : ''}`, ms: 1500 };
  }
  if (c.notifs.length) {
    const answer = c.notifs.map((d) => s.answers?.[d]).filter(Boolean).at(-1);
    return { text: answer ?? `HANDLED[${c.notifs.join(',')}] (${c.notifs.length} results)`, ms: s.notifMs ?? 3000 };
  }
  return s.steps[c.step] ?? { text: `PARENT-EXTRA step=${c.step}`, ms: 200 };
}

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const ch of req) raw += ch;
  const url = req.url || '';
  if (url === '/__run' && req.method === 'POST') {
    const { label } = JSON.parse(raw || '{}');
    runDir = path.join(OUT, label);
    fs.mkdirSync(path.join(runDir, 'requests'), { recursive: true });
    records = [];
    seq = 0;
    RUN_TAG = Date.now().toString(36);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, runDir }));
    return;
  }
  if (url === '/__log') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(records));
    return;
  }
  if (url.includes('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }));
    return;
  }
  if (!url.includes('/chat/completions')) {
    res.writeHead(404);
    res.end('{}');
    return;
  }
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {}
  const c = classify(body);
  const p = plan(c);
  const n = seq++;
  const rec = { seq: n, at: Date.now(), ...c, reply: p.tools ? p.tools.map((t) => t.name) : p.text.slice(0, 120), aborted: false, ended: false };
  records.push(rec);
  fs.mkdirSync(path.join(runDir, 'requests'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'requests', `${String(n).padStart(4, '0')}-${c.kind}.json`), JSON.stringify({ rec, body }, null, 1));
  const flush = () => fs.writeFileSync(path.join(runDir, 'log.json'), JSON.stringify(records, null, 1));
  flush();
  res.on('close', () => {
    if (!rec.ended) {
      rec.aborted = true;
      rec.abortedAt = Date.now();
      flush();
    }
  });

  if (p.delay) await sleep(p.delay);
  const model = body.model || 'mock-model';
  const id = 'chatcmpl-' + n;
  const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model };
  const usage = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 };
  if (body.stream !== true) {
    res.writeHead(200, { 'content-type': 'application/json' });
    const message = p.tools
      ? { role: 'assistant', content: null, tool_calls: p.tools.map((t, i) => ({ id: `call_${RUN_TAG}_${n}_${i}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) }
      : { role: 'assistant', content: p.text };
    rec.ended = true;
    flush();
    res.end(JSON.stringify({ id, object: 'chat.completion', created: base.created, model, choices: [{ index: 0, message, finish_reason: p.tools ? 'tool_calls' : 'stop' }], usage }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
  if (p.tools) {
    p.tools.forEach((t, i) =>
      sse(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: `call_${RUN_TAG}_${n}_${i}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } }] }, finish_reason: null }] }),
    );
    sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage });
  } else {
    const words = p.text.split(/(?<= )/);
    const chunks = Math.max(1, Math.ceil((p.ms ?? 300) / 250));
    const per = Math.ceil(words.length / chunks);
    for (let i = 0; i < chunks; i++) {
      if (rec.aborted) return;
      await sleep((p.ms ?? 300) / chunks);
      const piece = words.slice(i * per, (i + 1) * per).join('');
      if (piece) sse(res, { ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
    }
    sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage });
  }
  res.write('data: [DONE]\n\n');
  rec.ended = true;
  rec.endedAt = Date.now();
  flush();
  res.end();
});
server.listen(PORT, '127.0.0.1', () => console.log(`mock on ${PORT} out=${OUT}`));
