// Content-keyed OpenAI-compatible fake model for PR #8838 verification.
// usage: node fake-model.mjs <requests.jsonl> [port]
// Prints "FAKE_SERVER_READY <baseUrl>" once listening.
//
// Dispatch is keyed on the text of the latest *user* message (system-reminder
// blocks stripped), so an extra background request can never shift a turn.
import { createServer } from 'node:http';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';

const [logPath, portArg] = process.argv.slice(2);
writeFileSync(logPath, '');

export const TASK =
  'NIGHTLY-REPORT-TASK: summarize repository health and post the nightly report.';
export const RESULT = 'NIGHTLY-REPORT-RESULT: repository health is green.';
export const FAIL_TASK = 'FAILING-TASK: rebuild the search index.';

let reqIndex = 0;
const flatten = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('')
      : '';
const strip = (s) =>
  s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();

function sse(res, chunks) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function reply(res, body, r) {
  const id = 'chatcmpl-' + reqIndex;
  const created = Math.floor(Date.now() / 1000);
  const model = body.model ?? 'fake';
  const toolCalls = (r.toolCalls ?? []).map((tc, i) => ({
    index: i,
    id: tc.id,
    type: 'function',
    function: { name: tc.name, arguments: JSON.stringify(tc.args) },
  }));
  const finish = toolCalls.length ? 'tool_calls' : 'stop';
  const usage = { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 };
  if (body.stream) {
    const chunks = [];
    if (r.content)
      chunks.push({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', content: r.content }, finish_reason: null }] });
    if (toolCalls.length)
      chunks.push({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: toolCalls }, finish_reason: null }] });
    chunks.push({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: finish }] });
    chunks.push({ id, object: 'chat.completion.chunk', created, model, choices: [], usage });
    sse(res, chunks);
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id, object: 'chat.completion', created, model, usage,
      choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: r.content ?? '', ...(toolCalls.length ? { tool_calls: toolCalls.map(({ index, ...t }) => t) } : {}) } }] }));
  }
}

function respond(body, idx) {
  const msgs = body.messages ?? [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const last = msgs[msgs.length - 1];
  let anchor = '';
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') {
      anchor = strip(flatten(msgs[i].content));
      break;
    }
  }
  if (tools.length === 0 || anchor.includes('[SUGGESTION MODE')) {
    return { kind: 'side', r: { content: '' } };
  }
  const afterTool = last?.role === 'tool';
  if (anchor.includes('SCHEDULE-IT') || anchor.includes('SCHEDULE-FAIL')) {
    const prompt = anchor.includes('SCHEDULE-FAIL') ? FAIL_TASK : TASK;
    if (afterTool) return { kind: 'main', r: { content: 'Scheduled. It will run every minute.' } };
    return {
      kind: 'main',
      r: {
        toolCalls: [
          { id: `call_sched_${idx}`, name: 'cron_create', args: { cron: '* * * * *', prompt, recurring: true } },
        ],
      },
    };
  }
  if (anchor.startsWith('NIGHTLY-REPORT-TASK')) return { kind: 'cron', r: { content: RESULT } };
  if (anchor.startsWith('OUTAGE-PROMPT')) {
    if (process.env.HEAL_FILE && existsSync(process.env.HEAL_FILE))
      return { kind: 'retry', r: { content: 'OUTAGE-PROMPT-RESULT: build is green.' } };
    return { kind: 'outage', fail: true };
  }
  if (anchor.startsWith('FAILING-TASK')) {
    // Provider outage until the harness drops the heal file (after restart).
    if (process.env.HEAL_FILE && existsSync(process.env.HEAL_FILE))
      return { kind: 'cron-continue', r: { content: 'FAILING-TASK-RESULT: search index rebuilt.' } };
    return { kind: 'cron-fail', fail: true };
  }
  if (anchor.startsWith('FOLLOWUP')) return { kind: 'followup', r: { content: `ACK ${anchor.split(':')[0]}` } };
  return { kind: 'main', r: { content: `ACK: ${anchor.slice(0, 40)}` } };
}

const server = createServer((req, res) => {
  let data = '';
  req.on('data', (d) => (data += d));
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(data || '{}');
    } catch {}
    const idx = reqIndex++;
    if (!req.url.includes('chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"object":"list","data":[{"id":"fake-model","object":"model"}]}');
      return;
    }
    const d = respond(body, idx);
    const msgs = (body.messages ?? []).map((m) => ({
      role: m.role,
      text: strip(flatten(m.content)).slice(0, 400),
      toolCalls: (m.tool_calls ?? []).map((t) => t.function?.name),
    }));
    appendFileSync(
      logPath,
      JSON.stringify({ idx, t: Date.now(), kind: d.kind, stream: !!body.stream, nMsgs: msgs.length, messages: msgs, reply: d.r ?? { fail: 400 } }) + '\n',
    );
    if (d.fail) {
      // Non-retryable provider rejection for the scheduled task's turn.
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'fake provider rejected FAILING-TASK', type: 'invalid_request_error', code: 'fake_reject' } }));
      return;
    }
    reply(res, body, d.r);
  });
});
server.listen(Number(portArg ?? 0), '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`FAKE_SERVER_READY http://127.0.0.1:${port}/v1`);
});
