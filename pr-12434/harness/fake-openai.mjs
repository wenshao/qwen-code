// Scripted OpenAI-compatible model: every user prompt runs 1-2 read_file tool
// rounds then answers, so each turn persists real request + tool timing records.
import http from 'node:http'; import fs from 'node:fs';
const port = Number(process.argv[2]); const LOG = process.argv[3]; const WS = process.argv[4];
let n = 0;
const textOf = (m) => typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map(p => p.text ?? '').join('') : '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function decide(body) {
  const msgs = body.messages || [];
  const tools = (body.tools || []).map(t => t.function?.name).filter(Boolean);
  const lastUserIdx = msgs.map(m => m.role).lastIndexOf('user');
  const userText = lastUserIdx >= 0 ? textOf(msgs[lastUserIdx]) : '';
  const sys = msgs.filter(m => m.role === 'system').map(textOf).join(' ');
  const isMain = tools.length > 0 && !/SUGGESTION MODE|security classifier|Generate a (short )?title/i.test(sys + userText);
  if (!isMain) return { text: 'Seeded trajectory session' };
  const m = /Prompt #(\d+): read the note/.exec(userText);
  const long = /Long #(\d+): read every note/.exec(userText);
  if (!m && !long) return { text: 'Side request acknowledged.' };
  const turn = Number((m ?? long)[1]);
  const toolMsgsSinceUser = msgs.slice(lastUserIdx + 1).filter(m => m.role === 'tool').length;
  const rounds = long ? 250 : turn % 3 === 0 ? 2 : 1;
  if (toolMsgsSinceUser < rounds && tools.includes('read_file')) {
    return { calls: [{ id: `call_t${turn}_r${toolMsgsSinceUser}`, name: 'read_file', args: { file_path: `${WS}/notes/note-${(turn + toolMsgsSinceUser) % 20}.txt` } }] };
  }
  return { text: `Answer for prompt #${turn}: read ${rounds} note(s). [done]` };
}
http.createServer((req, res) => {
  let data = ''; req.on('data', c => data += c); req.on('end', async () => {
    if (!req.url.includes('chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] })); return; }
    const body = JSON.parse(data || '{}'); const idx = n++;
    const d = decide(body);
    if (LOG) fs.appendFileSync(LOG, JSON.stringify({ idx, t: Date.now(), decision: d }) + '\n');
    const id = 'chatcmpl-' + idx; const created = Math.floor(Date.now() / 1000);
    await sleep(15 + (idx % 7) * 5);
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id, object: 'chat.completion', created, model: 'fake-model', choices: [{ index: 0, finish_reason: d.calls ? 'tool_calls' : 'stop', message: d.calls ? { role: 'assistant', content: null, tool_calls: d.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : { role: 'assistant', content: d.text } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (o) => res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'fake-model', ...o }) + '\n\n');
    if (d.calls) {
      d.calls.forEach((c, i) => send({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }] }, finish_reason: null }] }));
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      send({ choices: [{ index: 0, delta: { role: 'assistant', content: d.text.slice(0, 10) }, finish_reason: null }] });
      await sleep(10);
      send({ choices: [{ index: 0, delta: { content: d.text.slice(10) }, finish_reason: null }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    res.end('data: [DONE]\n\n');
  });
}).listen(port, '127.0.0.1', () => console.log('FAKE_READY ' + port));
