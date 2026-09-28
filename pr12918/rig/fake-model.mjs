// Standalone fake OpenAI-compatible model for PR #12918 verification.
// Independent process so the ledger survives daemon restarts.
// Directives in the latest user message:
//   DO:write_file:<abs path>   -> one write_file tool call
//   DO:exit_plan               -> one exit_plan_mode tool call
// Anything else -> plain text ACK. A tool result as the last message -> "DONE".
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] || 0);
const ledger = process.argv[3];

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((p) => (typeof p === 'string' ? p : (p?.text ?? '')))
      .join('\n');
  return '';
}

let n = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (!req.url.includes('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model' }] }));
      return;
    }
    let j = {};
    try {
      j = JSON.parse(body);
    } catch {}
    const msgs = j.messages || [];
    const last = msgs[msgs.length - 1] || {};
    const tools = (j.tools || []).map((t) => t.function?.name);
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const lastUserText = textOf(lastUser?.content);
    const id = ++n;
    let reply;
    if (tools.length < 10) {
      reply = { content: 'side-query-ok' };
    } else if (last.role === 'tool') {
      reply = { content: `DONE after tool (${textOf(last.content).slice(0, 80)})` };
    } else {
      const m = lastUserText.match(/DO:write_file:(\S+)/);
      if (m && tools.includes('write_file')) {
        reply = {
          toolCalls: [
            {
              id: `call_w${id}`,
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({ file_path: m[1], content: `probe ${id}\n` }),
              },
            },
          ],
        };
      } else if (/DO:exit_plan/.test(lastUserText) && tools.includes('exit_plan_mode')) {
        reply = {
          toolCalls: [
            {
              id: `call_p${id}`,
              type: 'function',
              function: {
                name: 'exit_plan_mode',
                arguments: JSON.stringify({ plan: '1. Write the probe file.\n2. Report back.' }),
              },
            },
          ],
        };
      } else {
        reply = { content: `ACK #${id}` };
      }
    }
    if (ledger) {
      fs.appendFileSync(
        ledger,
        JSON.stringify({
          id,
          at: new Date().toISOString(),
          tools: tools.length,
          hasWriteFile: tools.includes('write_file'),
          hasExitPlan: tools.includes('exit_plan_mode'),
          lastRole: last.role,
          directive: (lastUserText.match(/DO:\S+/) || [null])[0],
          reply: reply.toolCalls ? reply.toolCalls.map((t) => t.function.name) : reply.content,
        }) + '\n',
      );
    }
    const created = Math.floor(Date.now() / 1000);
    const cid = `chatcmpl-${id}`;
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (j.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (delta, finish = null, u) =>
        res.write(
          `data: ${JSON.stringify({ id: cid, object: 'chat.completion.chunk', created, model: j.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(u ? { usage: u } : {}) })}\n\n`,
        );
      send({ role: 'assistant' });
      if (reply.content) send({ content: reply.content });
      (reply.toolCalls || []).forEach((t, i) => {
        send({ tool_calls: [{ index: i, id: t.id, type: 'function', function: { name: t.function.name, arguments: '' } }] });
        send({ tool_calls: [{ index: i, function: { arguments: t.function.arguments } }] });
      });
      send({}, reply.toolCalls ? 'tool_calls' : 'stop', usage);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: cid,
          object: 'chat.completion',
          created,
          model: j.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: reply.content ?? null, ...(reply.toolCalls ? { tool_calls: reply.toolCalls } : {}) },
              finish_reason: reply.toolCalls ? 'tool_calls' : 'stop',
            },
          ],
          usage,
        }),
      );
    }
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`fake-model listening on ${server.address().port}`);
});
