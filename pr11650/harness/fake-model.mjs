// Scripted OpenAI-compatible model for PR #11650 real-stack verification.
// Every main-session reply echoes the user turns the model actually received,
// so the transcript itself shows the API history after each rewind.
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.PORT);
const LOG = process.env.LOG;
let seq = 0;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((p) => (p?.type === 'text' ? p.text : '')).join('');
}
function partsOf(content) {
  if (!Array.isArray(content)) return ['text'];
  return content.map((p) => p?.type ?? '?');
}
function label(msg) {
  const t = textOf(msg.content);
  if (t.includes('<task-notification')) return 'NOTIF';
  // strip system reminders the host prepends
  const clean = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  const imgs = partsOf(msg.content).filter((p) => p === 'image_url').length;
  const m = clean.match(/\b(ALPHA|BRAVO|CHARLIE|DELTA|ECHO|FOXTROT|GOLF|HOTEL|INDIA|JULIET|KILO|LIMA|MIKE|NOVEMBER|OSCAR|PAPA|QUEBEC|ROMEO|SIERRA|TANGO|UNIFORM|VICTOR|WHISKEY|XRAY|YANKEE|ZULU|BGJOB|SUGGESTION)\b/);
  let l = m ? m[1] : (clean ? clean.slice(0, 12) : '(no text)');
  if (imgs) l += `+${imgs}img`;
  if (clean.includes('FILE-CONTENT-XYZ') || JSON.stringify(msg.content).includes('FILE-CONTENT-XYZ')) l += '+file';
  return l;
}

function sse(res, { content, toolCalls }) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const id = `chatcmpl-${++seq}`;
  const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'probe-model' };
  const send = (delta, finish = null) =>
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  send({ role: 'assistant' });
  if (content) {
    for (const chunk of content.match(/.{1,40}/gs) ?? []) send({ content: chunk });
  }
  if (toolCalls) {
    toolCalls.forEach((tc, i) =>
      send({ tool_calls: [{ index: i, id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } }] }),
    );
  }
  send({}, toolCalls ? 'tool_calls' : 'stop');
  res.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url?.startsWith('/__log')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(fs.existsSync(LOG) ? fs.readFileSync(LOG) : '');
      return;
    }
    if (!req.url?.includes('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'probe-model', object: 'model' }] }));
      return;
    }
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }
    const msgs = parsed.messages ?? [];
    const tools = (parsed.tools ?? []).map((t) => t?.function?.name);
    const sys = msgs.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n');
    const isMain = tools.includes('run_shell_command') && /Qwen Code/.test(sys);
    const users = msgs.filter((m) => m.role === 'user');
    const last = msgs[msgs.length - 1];
    const ctx = users.map(label);
    let reply;
    if (!isMain) {
      reply = { content: 'ok' };
    } else if (last?.role === 'tool') {
      const name = msgs.findLast((m) => m.role === 'assistant' && m.tool_calls)?.tool_calls?.[0]?.function?.name;
      reply = { content: name === 'run_shell_command' ? 'Background job started.' : `Tool ${name} finished.` };
    } else {
      const lt = textOf(last?.content);
      const lbl = label(last ?? {});
      if (lt.includes('<task-notification')) {
        reply = { content: `NOTIF-REPLY: saw the background result. context=[${ctx.join(', ')}]` };
      } else if (/BGJOB/.test(lt)) {
        reply = { toolCalls: [{ id: `call_bg_${seq}`, name: 'run_shell_command', args: { command: `node -e "setTimeout(()=>console.log('BG-OUTPUT'),2500)"`, is_background: true, description: 'background probe job' } }] };
      } else if (/WRITEFILE/.test(lt)) {
        const cwd = process.env.WS;
        reply = { toolCalls: [{ id: `call_wf_${seq}`, name: 'write_file', args: { file_path: `${cwd}/kept.txt`, content: 'written by turn B\n' } }] };
      } else {
        reply = { content: `Reply to ${lbl}. Model context=[${ctx.join(', ')}]` };
      }
    }
    fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), isMain, ntools: tools.length, ctx, lastRole: last?.role, lastParts: partsOf(last?.content), lastHasFile: JSON.stringify(last?.content ?? "").includes("FILE-CONTENT-XYZ"), lastSnippet: JSON.stringify(last?.content ?? "").replace(/"data:[^"]{40,}"/g, "\"data:<b64>\"").slice(0, 700), reply: reply.content ?? reply.toolCalls?.map((c) => c.name) }) + '\n');
    sse(res, reply);
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`fake model on ${PORT}`));
