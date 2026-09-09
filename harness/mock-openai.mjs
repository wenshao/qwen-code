/**
 * Minimal OpenAI-compatible chat/completions server for the PR #11483 TUI E2E.
 * Scripted turns: each POST /v1/chat/completions consumes the next entry of
 * SCRIPT and streams it back as SSE. Every request is logged to REQ_LOG.
 */
import { createServer } from 'node:http';
import { appendFileSync, readFileSync } from 'node:fs';

const PORT = Number(process.env['MOCK_PORT'] ?? 8811);
const REQ_LOG = process.env['MOCK_REQ_LOG'] ?? '/tmp/mock-openai-requests.jsonl';
const SCRIPT = JSON.parse(readFileSync(process.env['MOCK_SCRIPT'], 'utf8'));

let turn = 0;

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'mock-vision' }] }));
      return;
    }
    appendFileSync(REQ_LOG, JSON.stringify({ t: Date.now(), url: req.url, turn, body }) + '\n');
    const step = SCRIPT[Math.min(turn, SCRIPT.length - 1)];
    turn++;

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const id = `chatcmpl-${turn}`;
    const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model' };

    if (step.text) {
      sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: step.text }, finish_reason: null }] });
    }
    if (step.tool) {
      sse(res, {
        ...base,
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [{
              index: 0,
              id: step.tool.id,
              type: 'function',
              function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) },
            }],
          },
          finish_reason: null,
        }],
      });
      sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`mock-openai listening on ${PORT}`);
});
