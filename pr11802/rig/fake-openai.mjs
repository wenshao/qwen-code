// Standalone OpenAI-compatible fake provider with a JSONL ledger.
// Scenario markers in the LAST user message:
//   [[ASK:<tag>]]   -> one ask_user_question tool call
//   [[ASK2:<tag>]]  -> two ask_user_question tool calls in one response
// After a tool result arrives (role=tool after the marker), reply plain text.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.env.FAKE_PORT || 8765);
const ledger = process.env.FAKE_LEDGER || `fake-ledger-${port}.jsonl`;
let requestIndex = 0;

function log(obj) {
  fs.appendFileSync(ledger, JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n');
}
function textOf(m) {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => (typeof p === 'string' ? p : p.text || '')).join('');
  return '';
}
function decide(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { lastUserIdx = i; break; }
  const lastUser = lastUserIdx >= 0 ? textOf(msgs[lastUserIdx]) : '';
  const toolAfter = msgs.slice(lastUserIdx + 1).some((m) => m.role === 'tool');
  const m1 = /\[\[ASK:([A-Za-z0-9_-]+)\]\]/.exec(lastUser);
  const m2 = /\[\[ASK2:([A-Za-z0-9_-]+)\]\]/.exec(lastUser);
  if (toolAfter) {
    const toolMsgs = msgs.slice(lastUserIdx + 1).filter((m) => m.role === 'tool');
    return { kind: 'after-tool', tag: (m1 || m2 || [])[1], text: `ANSWERED ${(m1 || m2 || ['','?'])[1]}: ${toolMsgs.map((m) => textOf(m).slice(0, 120)).join(' | ')}`, lastUser };
  }
  if (m2) return { kind: 'ask2', tag: m2[1], lastUser };
  if (m1) return { kind: 'ask', tag: m1[1], lastUser };
  return { kind: 'text', text: 'ok', lastUser };
}
function askCall(tag, n, id) {
  return {
    id,
    type: 'function',
    function: {
      name: 'ask_user_question',
      arguments: JSON.stringify({
        questions: [
          {
            question: `Probe ${tag}${n ? ' #' + n : ''}: which path should session ${tag} take?`,
            header: `Probe ${tag}`.slice(0, 12),
            options: [
              { label: 'Alpha', description: 'first path' },
              { label: 'Beta', description: 'second path' },
            ],
            multiSelect: false,
          },
        ],
      }),
    },
  };
}
function sse(res, obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); }

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404); res.end('not found'); return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const idx = requestIndex++;
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const d = decide(body);
    const sessionHint = /\[\[S:([A-Za-z0-9_-]+)\]\]/.exec(d.lastUser || '');
    log({ requestIndex: idx, model: body.model, stream: !!body.stream, kind: d.kind, tag: d.tag, session: sessionHint?.[1], lastUser: (d.lastUser || '').slice(0, 160), nMessages: (body.messages || []).length, nTools: (body.tools || []).length });
    const created = Math.floor(Date.now() / 1000);
    const id = `chatcmpl-fake-${idx}`;
    let toolCalls = [];
    let text = '';
    if (d.kind === 'ask') toolCalls = [askCall(d.tag, 0, `call_${d.tag}_${idx}`)];
    else if (d.kind === 'ask2') toolCalls = [askCall(d.tag, 1, `call_${d.tag}_1_${idx}`), askCall(d.tag, 2, `call_${d.tag}_2_${idx}`)];
    else text = d.text;
    const finish = toolCalls.length ? 'tool_calls' : 'stop';
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      sse(res, { id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
      if (text) sse(res, { id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
      toolCalls.forEach((tc, i) => {
        sse(res, { id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: '' } }] }, finish_reason: null }] });
        sse(res, { id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: tc.function.arguments } }] }, finish_reason: null }] });
      });
      sse(res, { id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage });
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const message = { role: 'assistant', content: text || null };
      if (toolCalls.length) message.tool_calls = toolCalls;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, object: 'chat.completion', created, model: body.model, choices: [{ index: 0, message, finish_reason: finish }], usage }));
    }
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`fake-openai listening on http://127.0.0.1:${port}/v1 ledger=${ledger}`);
});
