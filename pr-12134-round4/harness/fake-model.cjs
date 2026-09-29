// Scripted OpenAI-compatible model for PR #12134 round 4.
// Main-loop requests are driven by the last *user* text:
//   "SEED <n>"          -> streams n transcript paragraphs "LINE-001 ..." as text.
//   "PLAN <scenario>"   -> a sequence of todo_write tool calls, one per request;
//                          each request is HELD until the harness releases it
//                          (GET /control/release), so plan updates land exactly
//                          when the harness is ready to measure.
//   anything else       -> short text.
// Side queries (no tools / other system prompts) get a short non-tool answer.
const http = require('http');
const PORT = Number(process.env.FAKE_PORT || 18134);

const SCENARIOS = {
  // 7 items, one completion per step (the round 1-3 shape), ends all completed.
  steps7: [0, 1, 2, 3, 4, 5, 6, 7],
  // follow-mode probe: 7 items; step 2 -> 5 completes three items in one call
  // (5 open rows -> 2 open rows), then a long streamed reply follows.
  batch7: [0, 2, 5],
  // hold a mid-plan state for UI actions (collapse/expand); ends all completed.
  hold7: [2, 7],
};
const ITEMS = [
  'Read the session transcript and collect the open questions',
  'Map the daemon routes the strip depends on',
  'Draft the reading-position oracle',
  'Run the head arm against the real daemon',
  'Run the control arm with the same script',
  'Compare the per-step anchor shifts',
  'Write up the results table',
];
function planState(done) {
  return ITEMS.map((content, i) => ({
    id: String(i + 1),
    content,
    status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending',
  }));
}

let waiters = [];
let released = 0;
let consumed = 0;
const log = [];
function gate() {
  if (released > consumed) {
    consumed++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}
function release(n) {
  for (let i = 0; i < n; i++) {
    const w = waiters.shift();
    if (w) { w(); } else { released++; }
  }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => p.text || '').join('');
  return '';
}

function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}
function base(model) {
  return { id: 'chatcmpl-' + Math.random().toString(36).slice(2), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model };
}
async function streamText(res, model, text, { chunkChars = 400, delayMs = 0 } = {}) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (let i = 0; i < text.length; i += chunkChars) {
    res.write(`data: ${JSON.stringify({ ...base(model), choices: [{ index: 0, delta: { role: 'assistant', content: text.slice(i, i + chunkChars) }, finish_reason: null }] })}\n\n`);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  res.write(`data: ${JSON.stringify({ ...base(model), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}
function toolCall(res, model, id, name, args) {
  sse(res, [
    { ...base(model), choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] },
    { ...base(model), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } },
  ]);
}
function plain(res, body, text) {
  if (body.stream) return streamText(res, body.model, text);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
}

let promptOrdinal = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/control/release') {
    release(Number(url.searchParams.get('n') || 1));
    res.end(JSON.stringify({ waiting: waiters.length, released, consumed }));
    return;
  }
  if (url.pathname === '/control/state') {
    res.end(JSON.stringify({ waiting: waiters.length, released, consumed, log: log.slice(-20) }));
    return;
  }
  if (url.pathname === '/control/reset') {
    waiters.forEach((w) => w()); waiters = []; released = 0; consumed = 0;
    res.end('{}');
    return;
  }
  let raw = '';
  for await (const c of req) raw += c;
  let body = {};
  try { body = JSON.parse(raw || '{}'); } catch {}
  if (!url.pathname.endsWith('/chat/completions')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'dummy', object: 'model' }] }));
    return;
  }
  const msgs = body.messages || [];
  const hasTodo = (body.tools || []).some((t) => t.function && t.function.name === 'todo_write');
  if (!hasTodo) {
    log.push({ kind: 'side' });
    return plain(res, body, 'Plan strip check');
  }
  // last user message (the prompt of this turn)
  let lastUserIdx = -1;
  let userText = '';
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== 'user') continue;
    const stripped = textOf(msgs[i].content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
    if (stripped) { lastUserIdx = i; userText = stripped; break; }
  }
  const m = userText.match(/(SEED|PLAN)\s+(\S+)/);
  const toolResults = msgs.slice(lastUserIdx + 1).filter((x) => x.role === 'tool').length;
  if (m && m[1] === 'SEED') {
    const n = Number(m[2]);
    const text = Array.from({ length: n }, (_, i) => `LINE-${String(i + 1).padStart(3, '0')} — transcript paragraph ${i + 1} of ${n}, long enough to wrap onto a second line in a narrow panel so the list really scrolls.`).join('\n\n');
    log.push({ kind: 'seed', n });
    return streamText(res, body.model, text, { chunkChars: 2000 });
  }
  if (m && m[1] === 'PLAN') {
    const [scenario, tail] = m[2].split(':');
    const steps = SCENARIOS[scenario];
    promptOrdinal++;
    if (toolResults < steps.length) {
      await gate();
      const done = steps[toolResults];
      log.push({ kind: 'todo', scenario, step: toolResults, done, at: Date.now() });
      return toolCall(res, body.model, `call_${scenario}_${promptOrdinal}_${toolResults}`, 'todo_write', { todos: planState(done) });
    }
    await gate();
    log.push({ kind: 'final', scenario, at: Date.now() });
    const n = Number(tail || 0);
    const text = n > 0
      ? Array.from({ length: n }, (_, i) => `TAIL-${String(i + 1).padStart(3, '0')} — streamed after the plan update.`).join('\n\n')
      : 'All seven steps are complete.';
    return streamText(res, body.model, text, { chunkChars: n > 0 ? 60 : 4000, delayMs: n > 0 ? 40 : 0 });
  }
  log.push({ kind: 'other' });
  return plain(res, body, 'ok');
});
server.listen(PORT, '127.0.0.1', () => console.log('FAKE_READY http://127.0.0.1:' + PORT + '/v1'));
