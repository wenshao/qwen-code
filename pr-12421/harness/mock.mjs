// Scripted mock for PR #12421: serves Chat Completions, Responses and
// Anthropic Messages. The step index is derived from the number of tool
// results already present in the request, so side queries never advance it.
// Usage: node mock.mjs <port> <scenario.json> <log.jsonl>
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.argv[2]);
const SCENARIO = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const LOG = process.argv[4];
fs.writeFileSync(LOG, '');

const record = (e) => fs.appendFileSync(LOG, JSON.stringify(e) + '\n');

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const e of events) {
    if (e.event) res.write(`event: ${e.event}\n`);
    res.write(`data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`);
  }
  res.end();
}

const textOf = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p === 'string' ? p : (p?.text ?? p?.content ?? ''))).join('')
      : JSON.stringify(c ?? '');

// Returns {count, last} of tool results seen in the request history.
function toolResults(path, body) {
  if (path.startsWith('/v1/chat/completions')) {
    const t = (body.messages || []).filter((m) => m.role === 'tool');
    return { count: t.length, last: t.length ? textOf(t[t.length - 1].content) : '' };
  }
  if (path.startsWith('/v1/responses')) {
    const t = (Array.isArray(body.input) ? body.input : []).filter((m) => m?.type === 'function_call_output');
    return { count: t.length, last: t.length ? textOf(t[t.length - 1].output) : '' };
  }
  const t = [];
  for (const m of body.messages || [])
    if (Array.isArray(m.content)) for (const p of m.content) if (p?.type === 'tool_result') t.push(p);
  return { count: t.length, last: t.length ? textOf(t[t.length - 1].content) : '' };
}

function nextArgs(step, last) {
  if (step.retryFromPrevious) {
    const m = /Retry with: (\{.*\})\s*$/m.exec(last);
    if (m) return { args: JSON.parse(m[1]), source: 'retry-example' };
    return { args: step.fallback, source: 'fallback(no retry example)' };
  }
  return { args: step.args, source: 'script' };
}

// Raw JSON arguments string so literal nulls/strings reach the CLI verbatim.
const argString = (a) => (typeof a === 'string' ? a : JSON.stringify(a));

function chatEvents(call) {
  const base = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 1, model: 'mock-model' };
  if (call) {
    return [
      { data: { ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: argString(call.args) } }] }, finish_reason: null }] } },
      { data: { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } } },
      { data: '[DONE]' },
    ];
  }
  return [
    { data: { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'SCENARIO_DONE' }, finish_reason: null }] } },
    { data: { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } } },
    { data: '[DONE]' },
  ];
}

function responsesEvents(call, n) {
  const out = [{ event: 'response.created', data: { type: 'response.created', response: { id: `resp_${n}` } } }];
  if (call) {
    const item = { id: `fc_${n}`, type: 'function_call', call_id: call.id, name: call.name, arguments: argString(call.args) };
    out.push({ event: 'response.output_item.added', data: { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } } });
    out.push({ event: 'response.function_call_arguments.delta', data: { type: 'response.function_call_arguments.delta', output_index: 0, delta: item.arguments } });
    out.push({ event: 'response.output_item.done', data: { type: 'response.output_item.done', output_index: 0, item } });
  } else {
    out.push({ event: 'response.output_item.added', data: { type: 'response.output_item.added', output_index: 0, item: { id: `msg_${n}`, type: 'message', role: 'assistant', content: [] } } });
    out.push({ event: 'response.output_text.delta', data: { type: 'response.output_text.delta', output_index: 0, delta: 'SCENARIO_DONE' } });
    out.push({ event: 'response.output_item.done', data: { type: 'response.output_item.done', output_index: 0, item: { id: `msg_${n}`, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'SCENARIO_DONE' }] } } });
  }
  out.push({ event: 'response.completed', data: { type: 'response.completed', response: { id: `resp_${n}`, status: 'completed', usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } } } });
  return out;
}

function anthropicEvents(call) {
  const out = [{ event: 'message_start', data: { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', model: 'mock-model', content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } } }];
  if (call) {
    out.push({ event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } } });
    out.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: argString(call.args) } } });
  } else {
    out.push({ event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
    out.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'SCENARIO_DONE' } } });
  }
  out.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } });
  out.push({ event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } } });
  out.push({ event: 'message_stop', data: { type: 'message_stop' } });
  return out;
}

let n = 0;
http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      n += 1;
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
      const path = req.url;
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }));
        return;
      }
      const hasReadFile = JSON.stringify(body.tools || []).includes('read_file');
      const { count, last } = toolResults(path, body);
      const isMain = hasReadFile && body.stream === true;
      let call = null;
      let source = null;
      if (isMain && count < SCENARIO.length) {
        const step = SCENARIO[count];
        const next = nextArgs(step, last);
        call = { id: `call_${step.id}`, name: step.name ?? 'read_file', args: next.args };
        source = next.source;
      }
      record({ n, path, isMain, toolResultsSeen: count, issued: call ? { id: call.id, args: call.args, source } : null, body });
      if (body.stream !== true) {
        // Non-streaming side query: answer with plain text.
        res.writeHead(200, { 'content-type': 'application/json' });
        if (path.startsWith('/v1/messages')) {
          res.end(JSON.stringify({ id: 'msg_side', type: 'message', role: 'assistant', model: 'mock-model', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
        } else if (path.startsWith('/v1/responses')) {
          res.end(JSON.stringify({ id: 'resp_side', object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
        } else {
          res.end(JSON.stringify({ id: 'side', object: 'chat.completion', created: 1, model: 'mock-model', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        }
        return;
      }
      if (path.startsWith('/v1/chat/completions')) return sse(res, chatEvents(call));
      if (path.startsWith('/v1/responses')) return sse(res, responsesEvents(call, n));
      if (path.startsWith('/v1/messages')) return sse(res, anthropicEvents(call));
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `no route ${path}` } }));
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`MOCK_READY http://127.0.0.1:${PORT}/v1`));
