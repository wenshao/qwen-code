#!/usr/bin/env node
// Deterministic OpenAI-compatible model for driving the real CLI's `lsp` tool.
// The user prompt carries directives, one per line:
//   @@tool <name> <json-args>
// Each turn emits the next un-executed directive as a tool call; once every
// directive has a tool result, the model replies with the tool results verbatim
// so the final answer (and the TUI) shows exactly what the LSP layer returned.
import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 18443);
const LOG = process.env.LOG_FILE || '';

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((p) => (typeof p === 'string' ? p : (p.text ?? ''))).join('\n');
  return '';
}

function plan(body) {
  const msgs = body.messages || [];
  let lastUser = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user' && /@@tool /.test(textOf(msgs[i].content))) {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return { content: 'ok' };
  const directives = textOf(msgs[lastUser].content)
    .split('\n')
    .map((l) => /@@tool\s+(\S+)\s+(\{.*\})\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ name: m[1], args: JSON.parse(m[2]) }));
  if (directives.length === 0) return { content: 'ok (no directives parsed)' };
  const results = msgs.slice(lastUser + 1).filter((m) => m.role === 'tool');
  // "$ITEM@k" in an argument = first JSON item from directive k's tool result (1-based).
  const itemFrom = (k) => {
    const text = textOf(results[k - 1]?.content);
    const at = text.indexOf('(JSON)');
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text.slice(at));
    const raw = fenced ? fenced[1] : text.slice(text.indexOf('[', at));
    const parsed = JSON.parse(raw.trim());
    return Array.isArray(parsed) ? parsed[0] : parsed;
  };
  const subst = (v) =>
    // The CLI splits "@N" off as an @-reference, so prompts use ITEM_FROM_N instead.
    typeof v === 'string' && /^ITEM_FROM_\d+$/.test(v)
      ? itemFrom(Number(v.slice('ITEM_FROM_'.length)))
      : Array.isArray(v)
        ? v.map(subst)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subst(x)]))
          : v;
  if (results.length < directives.length) {
    const d = { ...directives[results.length] };
    try {
      d.args = subst(d.args);
    } catch (e) {
      d.args = { ...d.args, callHierarchyItem: { error: `mock could not extract item: ${e.message}` } };
    }
    return {
      tool_calls: [
        {
          id: `call_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          type: 'function',
          function: { name: d.name, arguments: JSON.stringify(d.args) },
        },
      ],
    };
  }
  const lines = results.map(
    (r, i) => `[${i + 1}] ${directives[i].args.operation ?? directives[i].name}: ${textOf(r.content).trim()}`,
  );
  return { content: lines.join('\n') };
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-lsp', object: 'model' }] }));
      return;
    }
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      /* ignore */
    }
    const msg = plan(body);
    if (LOG) appendFileSync(LOG, JSON.stringify({ t: Date.now(), n: (body.messages || []).length, reply: msg }) + '\n');
    const model = body.model || 'mock-lsp';
    const id = `chatcmpl-${randomUUID()}`;
    const finish = msg.tool_calls ? 'tool_calls' : 'stop';
    const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id,
          object: 'chat.completion',
          created: 0,
          model,
          choices: [{ index: 0, message: { role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) }, finish_reason: finish }],
          usage,
        }),
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta, finish_reason = null) =>
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    res.write(chunk({ role: 'assistant', content: '' }));
    if (msg.content) res.write(chunk({ content: msg.content }));
    (msg.tool_calls || []).forEach((tc, index) =>
      res.write(chunk({ tool_calls: [{ index, id: tc.id, type: 'function', function: tc.function }] })),
    );
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
server.listen(PORT, '127.0.0.1', () => console.error(`mock-model on ${PORT}`));
