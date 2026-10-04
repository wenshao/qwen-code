// Deterministic OpenAI-compatible fake provider for PR #13324 verification.
// Plays the Goal worker (Code Mode `exec` scripts) and the independent Goal
// verifier. Every request body is appended to $LOG as one JSON line.
'use strict';
const http = require('node:http');
const fs = require('node:fs');

const LOG = process.env.LOG;
const FIXTURE = process.env.FIXTURE; // absolute path of the real fixture file
const MISSING = process.env.MISSING; // absolute path that does not exist
const PORT = Number(process.env.PORT || 0);

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('')
      : '';

function classify(body) {
  const sys = (body.messages || [])
    .filter((m) => m.role === 'system')
    .map((m) => textOf(m.content))
    .join('\n');
  if (sys.includes('You are an independent Goal Verifier')) return 'verifier';
  // Background managed-memory extraction agent: not the Goal worker.
  if (JSON.stringify(body.messages || []).includes('Managed memory has TWO directories')) return 'memory';
  if (!body.stream) return 'side';
  if (!Array.isArray(body.tools) || body.tools.length === 0) return 'side';
  return 'worker';
}

const WORK_SCRIPT = `
const goal = await tools.get_goal({});
text("GOAL_ECHO " + JSON.stringify(goal).slice(0, 160));
await tools.read_file({file_path: ${JSON.stringify(FIXTURE)}});
try {
  await tools.read_file({file_path: ${JSON.stringify(MISSING)}});
} catch {}
text("Claim: fixture overwritten and 999 tests passed.");
text(6 * 7);
`;
const PROPOSE_SCRIPT = `
const r = await tools.update_goal({status: "complete", reason: "Fixture read and computation finished."});
text(JSON.stringify(r).slice(0, 200));
`;
const PHASE2_SCRIPT = `
await tools.read_file({file_path: ${JSON.stringify(FIXTURE)}});
text("phase2 " + (6 * 7));
`;

function workerReply(body) {
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
  const lastUserText = textOf(lastUser?.content);
  if (last.role === 'tool') {
    const id = last.tool_call_id || '';
    if (id.startsWith('call_work')) return { tool: ['call_propose', PROPOSE_SCRIPT] };
    return { text: '.' };
  }
  if (lastUserText.includes('PHASE2')) return { tool: ['call_phase2', PHASE2_SCRIPT] };
  return { tool: ['call_work', WORK_SCRIPT] };
}

function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

let seq = 0;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {}
    const kind = req.url.includes('/models') ? 'models' : classify(body);
    const n = ++seq;
    if (LOG) fs.appendFileSync(LOG, JSON.stringify({ n, kind, url: req.url, body }) + '\n');
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] }));
    }
    const base = { id: `cmpl-${n}`, object: 'chat.completion.chunk', created: 0, model: body.model || 'fake-model' };
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    let content = '';
    let toolCall = null;
    if (kind === 'verifier') {
      content = JSON.stringify({ decision: 'accept', reason: 'Fake verifier: evidence recorded for inspection.' });
    } else if (kind === 'worker') {
      const r = workerReply(body);
      if (r.tool) {
        // Suffix the id per phase so a resumed process cannot reuse an id.
        toolCall = { id: `${r.tool[0]}_${n}`, name: 'exec', args: { source: r.tool[1] } };
      } else content = r.text;
    } else {
      content = 'Fake side reply';
    }
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          id: `cmpl-${n}`,
          object: 'chat.completion',
          created: 0,
          model: base.model,
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage,
        }),
      );
    }
    const chunks = [];
    if (toolCall) {
      chunks.push({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                { index: 0, id: toolCall.id, type: 'function', function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) } },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage });
    } else {
      chunks.push({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] });
      chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage });
    }
    sse(res, chunks);
  });
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`FAKE_SERVER_READY http://127.0.0.1:${server.address().port}/v1`);
});
