// Scripted OpenAI-compatible provider for PR #11727 verification.
//
// A main-loop request (declares run_shell_command) whose newest message is NOT
// a tool result gets one run_shell_command call built from the [[S:<name>]]
// scenario in the user prompt. When the newest message IS the tool result, the
// exact `content` the CLI sent is saved to out/<label>/tool-content.txt and the
// reply is a one-line summary of what the model received, so the same verdict
// shows up in headless stdout and in the interactive TUI.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.MOCK_PORT || 18727);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'out');
const SCEN = JSON.parse(fs.readFileSync(path.join(HERE, 'scenarios.json'), 'utf8'));
let seq = 0;

const textOf = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('')
      : '';

export function summarize(content) {
  const exit = content.match(/Exit Code: (-?\d+)/g);
  const lastRow = [...content.matchAll(/row (\d{6})/g)].at(-1)?.[1];
  return {
    len: content.length,
    stub: content.includes('<persisted-output>'),
    sentinel: /Tool output was too large and has been truncated/.test(content),
    tail: content.includes('TAIL-STATUS:'),
    exit: exit ? exit.at(-1).replace('Exit Code: ', '') : null,
    advisory: content.includes('Note: this foreground command ran for'),
    hookCtx: content.includes('HOOK-CONTEXT'),
    lastRow: lastRow ?? null,
    spillRef: /\.output\b|saved to/i.test(content),
  };
}

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const ch of req) raw += ch;
  const url = req.url || '';
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
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const tools = (body.tools ?? []).map((t) => t?.function?.name);
  const allUser = msgs.filter((m) => m.role === 'user').map((m) => textOf(m.content)).join('\n');
  const scenario = [...allUser.matchAll(/\[\[S:([a-z0-9_-]+)\]\]/g)].at(-1)?.[1];
  const label = [...allUser.matchAll(/\[\[L:([A-Za-z0-9_.-]+)\]\]/g)].at(-1)?.[1] ?? 'nolabel';
  const last = msgs.at(-1);
  const n = seq++;

  let reply;
  if (!tools.includes('run_shell_command') || !scenario) {
    reply = { text: 'ok' };
  } else if (last?.role === 'tool') {
    const content = textOf(last.content);
    const dir = path.join(OUT, label);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tool-content.txt'), content);
    const s = summarize(content);
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ label, scenario, ...s }, null, 1));
    reply = {
      text:
        `MODEL RECEIVED ${s.len.toLocaleString('en-US')} chars | ` +
        `${s.stub ? 'head-only <persisted-output> stub' : s.sentinel ? 'head+tail preview' : 'whole body'} | ` +
        `last row ${s.lastRow ?? '-'} | TAIL-STATUS ${s.tail ? 'yes' : 'NO'} | ` +
        `Exit Code ${s.exit ?? 'NOT PRESENT'}${s.advisory ? ' | advisory yes' : ''}`,
    };
  } else {
    const sc = SCEN[scenario];
    reply = {
      tool: {
        id: `call_${scenario}_${Date.now().toString(36)}_${n}`,
        name: 'run_shell_command',
        args: {
          command: sc.command,
          description: sc.description ?? `PR 11727 scenario ${scenario}`,
          is_background: false,
          ...(sc.timeout ? { timeout: sc.timeout } : {}),
        },
      },
    };
  }
  fs.appendFileSync(
    path.join(OUT, 'requests.jsonl'),
    JSON.stringify({ n, at: new Date().toISOString(), label, scenario, lastRole: last?.role, tools: tools.length, reply: reply.text ?? reply.tool.name }) + '\n',
  );

  const model = body.model || 'mock-model';
  const base = { id: `chatcmpl-${n}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model };
  const usage = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 };
  if (body.stream !== true) {
    res.writeHead(200, { 'content-type': 'application/json' });
    const message = reply.tool
      ? { role: 'assistant', content: null, tool_calls: [{ id: reply.tool.id, type: 'function', function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] }
      : { role: 'assistant', content: reply.text };
    res.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: reply.tool ? 'tool_calls' : 'stop' }], usage }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  if (reply.tool) {
    sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: reply.tool.id, type: 'function', function: { name: reply.tool.name, arguments: '' } }] } }] });
    sse(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(reply.tool.args) } }] } }] });
    sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  } else {
    sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: reply.text } }] });
    sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  }
  sse(res, { ...base, choices: [], usage });
  res.write('data: [DONE]\n\n');
  res.end();
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  fs.mkdirSync(OUT, { recursive: true });
  server.listen(PORT, '127.0.0.1', () => console.log(`mock on ${PORT}`));
}
