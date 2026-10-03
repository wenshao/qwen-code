// Recording OpenAI-compatible model. The answer is a pure function of the
// history it was handed, so "what the bot says" reads out "which session
// history the channel routed this message into".
//   REMEMBER:<x>  -> "NOTED <x>"
//   RECALL?       -> "RECALL=<every REMEMBER:x in earlier user turns | NONE>"
//   IMGS?         -> "IMGS=<image parts across the whole history>"
//   SLOW:<n>      -> streams "chunk-1 " .. "chunk-n " one per second (abort-aware)
//   TOUCH:<f>     -> tool call run_shell_command {command:"touch <f>"}
//   (tool result) -> "TOOL-RESULT <first 60 chars>"
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.MODEL_PORT || 18500);
const LEDGER = process.env.MODEL_LEDGER || path.join(__dirname, 'model-ledger.jsonl');
let reqIndex = 0;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (p && p.type === 'text' ? p.text : '')).join(' ');
  return '';
}
function imagesOf(content) {
  if (!Array.isArray(content)) return 0;
  return content.filter((p) => p && (p.type === 'image_url' || p.type === 'image')).length;
}

function decide(body) {
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const hasShell = (body.tools || []).some((t) => t.function && t.function.name === 'run_shell_command');
  if (last.role === 'tool') {
    return { text: `TOOL-RESULT ${textOf(last.content).replace(/\s+/g, ' ').slice(0, 60)}` };
  }
  const userMsgs = msgs.filter((m) => m.role === 'user');
  const lastUser = userMsgs[userMsgs.length - 1];
  const lastText = lastUser ? textOf(lastUser.content) : '';
  const earlier = userMsgs.slice(0, -1).map((m) => textOf(m.content)).join('\n');
  let m;
  if ((m = lastText.match(/TOUCH:([\w.-]+)/)) && hasShell) {
    return { tool: { name: 'run_shell_command', args: { command: `touch ${m[1]}`, description: 'harness touch' } } };
  }
  if ((m = lastText.match(/SLOW:(\d+)/))) return { slow: Number(m[1]) };
  if ((m = lastText.match(/REMEMBER:([\w-]+)/))) return { text: `NOTED ${m[1]}` };
  if (/RECALL\?/.test(lastText)) {
    const found = [...earlier.matchAll(/REMEMBER:([\w-]+)/g)].map((x) => x[1]);
    return { text: `RECALL=${found.length ? [...new Set(found)].join(',') : 'NONE'}` };
  }
  if (/IMGS\?/.test(lastText)) {
    const n = msgs.reduce((acc, mm) => acc + imagesOf(mm.content), 0);
    const files = new Set([...msgs.filter((mm) => mm.role === 'user').map((mm) => textOf(mm.content)).join('\n').matchAll(/channel-files\/([0-9a-f-]{36})/g)].map((x) => x[1]));
    return { text: `IMGS=${n} FILES=${files.size}` };
  }
  return { text: 'ACK' };
}

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (!req.url.includes('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] }));
      return;
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const idx = ++reqIndex;
    const main = Array.isArray(body.tools) && body.tools.length > 0;
    const d = main ? decide(body) : { text: 'ACK' };
    const msgs = body.messages || [];
    const userTexts = msgs.filter((m) => m.role === 'user').map((m) => textOf(m.content).replace(/\s+/g, ' ').slice(-160));
    const entry = {
      ts: Date.now(),
      idx,
      main,
      nMessages: msgs.length,
      lastRole: (msgs[msgs.length - 1] || {}).role,
      sys: textOf((msgs.find((m) => m.role === 'system') || {}).content).slice(0, 80),
      lastUserText: userTexts[userTexts.length - 1],
      userTurns: userTexts.length,
      images: msgs.reduce((a, m) => a + imagesOf(m.content), 0),
      decision: d.tool ? `tool:${d.tool.args.command}` : d.slow ? `slow:${d.slow}` : d.text,
    };
    fs.appendFileSync(LEDGER, JSON.stringify(entry) + '\n');
    const id = `chatcmpl-${idx}`;
    const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model || 'fake-model' };
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id,
          object: 'chat.completion',
          created: base.created,
          model: base.model,
          choices: [{ index: 0, message: { role: 'assistant', content: d.text || 'ACK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const finish = (reason) => {
      sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: reason }] });
      sse(res, { ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
      res.write('data: [DONE]\n\n');
      res.end();
    };
    if (d.tool) {
      sse(res, {
        ...base,
        choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${idx}`, type: 'function', function: { name: d.tool.name, arguments: JSON.stringify(d.tool.args) } }] }, finish_reason: null }],
      });
      return finish('tool_calls');
    }
    if (d.slow) {
      let k = 0;
      let aborted = false;
      res.on('close', () => {
        if (k < d.slow) {
          aborted = true;
          fs.appendFileSync(LEDGER, JSON.stringify({ ts: Date.now(), idx, event: 'slow-aborted', atChunk: k + 1 }) + '\n');
        }
      });
      const tick = () => {
        if (aborted) return;
        k++;
        sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: `chunk-${k} ` }, finish_reason: null }] });
        if (k >= d.slow) return finish('stop');
        setTimeout(tick, 1000);
      };
      return tick();
    }
    sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: d.text }, finish_reason: null }] });
    finish('stop');
  });
});
server.listen(PORT, '127.0.0.1', () => process.stdout.write(`FAKEMODEL_READY http://127.0.0.1:${PORT}/v1\n`));
