// Minimal scripted OpenAI-compatible server. Logs every request body.
import http from 'node:http'; import fs from 'node:fs';
const port = Number(process.argv[2]); const LOG = process.argv[3];
let n = 0;
const textOf = (m) => typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map(p => p.text ?? '').join('') : '';
function decide(body) {
  const msgs = body.messages || [];
  const tools = (body.tools || []).map(t => t.function?.name).filter(Boolean);
  const last = msgs[msgs.length - 1] || {};
  const lastUserIdx = msgs.map(m => m.role).lastIndexOf('user');
  const userText = lastUserIdx >= 0 ? textOf(msgs[lastUserIdx]) : '';
  const sys = msgs.filter(m => m.role === 'system').map(textOf).join(' ');
  const isMain = tools.length > 0 && !/SUGGESTION MODE|security classifier|Generate a (short )?title/i.test(sys + userText);
  if (!isMain) return { text: 'Fixture session' };
  if (last.role === 'tool') return { text: 'The fixture dashboard is rendered above. [done:dashboard]' };
  if (/show .*dashboard/i.test(userText)) {
    const server = (/show (\w+) dashboard/i.exec(userText)?.[1] ?? 'fixture').replace(/^two$/,'fixture');
    const name = tools.find(t => t === `mcp__${server}__show_dashboard`);
    const regions = /\btwo\b/i.test(userText) ? ['East', 'West'] : ['West'];
    if (name) return { calls: regions.map((r, i) => ({ id: `call_${Date.now()}_${i}`, name, args: { region: r } })) };
    return { text: 'no show_dashboard tool advertised [done:none]' };
  }
  return { text: `ok: ${userText.slice(0, 40)} [done:plain]` };
}
http.createServer((req, res) => {
  let data = ''; req.on('data', c => data += c); req.on('end', () => {
    if (!req.url.includes('chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] })); return; }
    const body = JSON.parse(data || '{}'); const idx = n++;
    const d = decide(body);
    fs.appendFileSync(LOG, JSON.stringify({ idx, t: Date.now(), stream: !!body.stream, tools: (body.tools || []).map(t => t.function?.name), messages: body.messages, decision: d }) + '\n');
    const id = 'chatcmpl-' + idx; const created = Math.floor(Date.now() / 1000);
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
      send({ choices: [{ index: 0, delta: { role: 'assistant', content: d.text }, finish_reason: null }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    res.end('data: [DONE]\n\n');
  });
}).listen(port, '127.0.0.1', () => console.log('FAKE_READY ' + port));
