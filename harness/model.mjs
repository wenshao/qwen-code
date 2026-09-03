// Scripted OpenAI-compatible model. The LAST user turn (flattened) is scanned
// for directives; everything is logged to JSONL so the prompt is an oracle.
//   SAYB64:<b64>   -> final answer text (decoded), streamed in small chunks
//   CHUNK:<n>      -> chunk size in code points (default 5)
//   TOOL           -> first emit a run_shell_command tool call, answer after the tool result
//   PREB64:<b64>   -> assistant text emitted in the same turn as the tool call (before the tool boundary)
//   NOSTREAMSPLIT  -> send the whole answer as one delta
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.MODEL_PORT || 4499);
const LOG = process.env.MODEL_LOG || '/tmp/model-requests.jsonl';
let n = 0;
const log = (e) => fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...e }) + '\n');
const flatten = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('') : '');
const base = () => ({ id: 'chatcmpl-h' + ++n, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'harness-model' });
async function sse(res, chunks, delay = 0) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  for (const c of chunks) { res.write(`data: ${JSON.stringify(c)}\n\n`); if (delay) await new Promise((r) => setTimeout(r, delay)); }
  res.write('data: [DONE]\n\n');
  res.end();
}
function splitChunks(text, size) {
  const cps = [...text];
  const out = [];
  for (let i = 0; i < cps.length; i += size) out.push(cps.slice(i, i + size).join(''));
  return out;
}
http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch {}
    const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
    const toolResults = msgs.filter((m) => m.role === 'tool').length;
    const userTexts = msgs.filter((m) => m.role === 'user').map((m) => flatten(m.content));
    const system = msgs.filter((m) => m.role === 'system').map((m) => flatten(m.content)).join('\n');
    const last = userTexts[userTexts.length - 1] ?? '';
    const all = userTexts.join('\n');
    const src = /SAYB64:/.test(last) ? last : all; // directives come from the LAST user turn (sessions accumulate history)
    const say = /SAYB64:([A-Za-z0-9+/=]+)/.exec(src)?.[1];
    const pre = /PREB64:([A-Za-z0-9+/=]+)/.exec(src)?.[1];
    const chunk = Number(/CHUNK:(\d+)/.exec(src)?.[1] || 5);
    const wantTool = /\bTOOL\b/.test(src);
    const delay = Number(/DELAY:(\d+)/.exec(src)?.[1] || 0);
    const answer = say ? Buffer.from(say, 'base64').toString('utf8') : 'HARNESS_DEFAULT_ANSWER';
    const everything = msgs.map((m) => flatten(m.content)).join('\n');
    log({ url: req.url, toolResults, nMessages: msgs.length, lastUser: last.slice(0, 400), promptHasFileInstr: everything.includes('[FILE: /absolute/path/to/file]'), promptHasImageInstr: everything.includes('[IMAGE: /absolute/path/to/file.png]'), fileInstrIn: msgs.filter((m) => flatten(m.content).includes('[FILE: /absolute/path/to/file]')).map((m) => m.role).join(','), systemLen: system.length });
    if (!req.url.includes('chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[]}'); }
    if (wantTool && toolResults < 1) {
      const call = { index: 0, id: 'call_h1', type: 'function', function: { name: 'run_shell_command', arguments: JSON.stringify({ command: 'echo tool-ran', description: 'harness probe' }) } };
      const preText = pre ? Buffer.from(pre, 'base64').toString('utf8') : '';
      return sse(res, [
        { ...base(), choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
        ...(preText ? splitChunks(preText, chunk).map((c) => ({ ...base(), choices: [{ index: 0, delta: { content: c }, finish_reason: null }] })) : []),
        { ...base(), choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: null }] },
        { ...base(), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } },
      ]);
    }
    const pieces = /NOSTREAMSPLIT/.test(src) ? [answer] : splitChunks(answer, chunk);
    return sse(res, [
      { ...base(), choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
      ...pieces.map((c) => ({ ...base(), choices: [{ index: 0, delta: { content: c }, finish_reason: null }] })),
      { ...base(), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } },
    ], delay);
  });
}).listen(PORT, '127.0.0.1', () => console.error('[model] :' + PORT));
