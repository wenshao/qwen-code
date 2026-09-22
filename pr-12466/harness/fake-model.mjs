// Scripted OpenAI-compatible model for PR #12466. Each user prompt carries a
// `SCN:<name>` marker; the step within a turn = number of assistant messages
// since that prompt. Every response is logged with send time so a tool's
// recorded [startedAt, startedAt+duration] can be bracketed by real wall clock:
// tool N starts after response N is sent and ends before request N+1 arrives.
import http from 'node:http'; import fs from 'node:fs';
const port = Number(process.argv[2]); const LOG = process.argv[3]; const WS = process.argv[4];
let n = 0;
const textOf = (m) => typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map(p => p.text ?? '').join('') : '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const call = (id, name, args) => ({ id, name, args });
const SCRIPTS = {
  overview: [
    [call('ov_shell', 'run_shell_command', { command: 'ls -1 src && git log --oneline -1', description: 'List source files and the last commit' })],
    [call('ov_read', 'read_file', { file_path: `${WS}/src/app.js` })],
    [call('ov_edit', 'edit', { file_path: `${WS}/src/app.js`, old_string: "const greeting = 'hello';", new_string: "const greeting = 'hello, tool calls';" })],
    [call('ov_write', 'write_file', { file_path: `${WS}/NOTES.md`, content: '# Notes\n\n- inspected by the tool calls panel\n' })],
    [call('ov_search', 'tool_search', { query: 'select:mcp__inventory__lookup_sku' })],
    [call('ov_mcp_wrapped', 'tool_call', { name: 'mcp__inventory__lookup_sku', arguments: { sku: 'A-100', include: ['price', 'stock'] } })],
    [call('ov_mcp_direct', 'mcp__catalog__describe_item', { id: 7 })],
    [call('ov_grep', 'grep_search', { pattern: 'TODO', path: WS }), call('ov_glob', 'glob', { pattern: 'src/**/*.js' })],
    [call('ov_read_missing', 'read_file', { file_path: `${WS}/does-not-exist.txt` })],
    [call('ov_shell_fail', 'run_shell_command', { command: 'echo "about to fail" >&2; exit 3', description: 'Run a command that exits non-zero' })],
  ],
  slow: [
    [call('slow_shell', 'run_shell_command', { command: 'python3 -u -c "import time\nfor i in range(1, 9):\n    print(\'tick\', i, flush=True); time.sleep(1)\nprint(\'slow-done\')"', description: 'Count eight slow ticks' })],
    [call('slow_after', 'glob', { pattern: 'src/*.js' })],
  ],
  approve: [
    [call('ap_shell', 'run_shell_command', { command: 'python3 -c "import time; time.sleep(2); print(\'approved-run\')"', description: 'Needs approval, then waits two seconds' })],
  ],
  cancel2: [[call('cx2_shell', 'run_shell_command', { command: 'python3 -c "import time; time.sleep(60)"', description: 'Long wait that is cancelled' })]],
  crash: [[call('cr_shell', 'run_shell_command', { command: 'python3 -c "import time; time.sleep(60)"', description: 'Long wait interrupted by a daemon crash' })]],
  cancel: [
    [call('cx_shell', 'run_shell_command', { command: 'python3 -c "import time; time.sleep(60)"', description: 'Long wait that will be cancelled' })],
  ],
  agent: [
    [call('ag_agent', 'agent', { subagent_type: 'general-purpose', description: 'Summarize the source tree', prompt: 'SUBAGENT_TASK: summarize src in one line.' })],
  ],
  after: [
    [call('af_glob', 'glob', { pattern: '*.md' })],
  ],
};
// 14 rounds x 10 parallel calls = 140 calls in one turn.
SCRIPTS.bulkcap = Array.from({ length: 14 }, (_, r) => Array.from({ length: 10 }, (_, k) => {
  const i = r * 10 + k;
  return i % 2 === 0
    ? call(`bulk_${i}`, 'glob', { pattern: `notes/note-${i % 20}.txt` })
    : call(`bulk_${i}`, 'read_file', { file_path: `${WS}/notes/note-${i % 20}.txt` });
}));
// 9 rounds x 10 = 90 calls: under the 100-call loop cap, so the turn completes.
SCRIPTS.bulk = SCRIPTS.bulkcap.slice(0, 9).map(round => round.map(c => ({ ...c, id: c.id.replace('bulk_', 'bk_') })));
function decide(body) {
  const msgs = body.messages || [];
  const tools = (body.tools || []).map(t => t.function?.name).filter(Boolean);
  const userIdxs = msgs.map((m, i) => (m.role === 'user' ? i : -1)).filter(i => i >= 0);
  const all = msgs.map(textOf).join('\n');
  const sys = msgs.filter(m => m.role === 'system').map(textOf).join(' ');
  if (!tools.length || /SUGGESTION MODE|security classifier|Generate a (short )?title|concise title/i.test(sys + textOf(msgs[userIdxs.at(-1)] ?? {}))) return { text: 'Tool calls demo' };
  if (/SUBAGENT_TASK/.test(all) && !/SCN:/.test(all)) return { text: 'Subagent summary: src holds app.js and util.js.' };
  let scnIdx = -1, scn;
  for (const i of userIdxs) { const m = /SCN:([a-z0-9]+)/.exec(textOf(msgs[i])); if (m) { scnIdx = i; scn = m[1]; } }
  if (!scn || !SCRIPTS[scn]) return { text: 'Acknowledged.' };
  const step = msgs.slice(scnIdx + 1).filter(m => m.role === 'assistant').length;
  const script = SCRIPTS[scn];
  // Unique ids per prompt in a session (the daemon rejects reused provider ids).
  const ordinal = userIdxs.filter(i => /SCN:/.test(textOf(msgs[i]))).length;
  const uniq = process.env.UNIQUE_IDS === '1';
  if (step < script.length) return { calls: uniq ? script[step].map(c => ({ ...c, id: `${c.id}_p${ordinal}` })) : script[step], scn, step };
  return { text: `Finished scenario ${scn} after ${script.length} step(s).`, scn, step };
}
http.createServer((req, res) => {
  let data = ''; req.on('data', c => data += c); req.on('end', async () => {
    if (!req.url.includes('chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] })); return; }
    const tIn = Date.now();
    const body = JSON.parse(data || '{}'); const idx = n++;
    const d = decide(body);
    const id = 'chatcmpl-' + idx; const created = Math.floor(Date.now() / 1000);
    await sleep(20);
    const log = (o) => { if (LOG) fs.appendFileSync(LOG, JSON.stringify(o) + '\n'); };
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id, object: 'chat.completion', created, model: 'fake-model', choices: [{ index: 0, finish_reason: d.calls ? 'tool_calls' : 'stop', message: d.calls ? { role: 'assistant', content: null, tool_calls: d.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : { role: 'assistant', content: d.text } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
      log({ idx, tIn, tSent: Date.now(), stream: false, scn: d.scn, step: d.step, calls: d.calls?.map(c => c.id), text: d.text });
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
    log({ idx, tIn, tSent: Date.now(), stream: true, scn: d.scn, step: d.step, calls: d.calls?.map(c => c.id), text: d.text });
  });
}).listen(port, '127.0.0.1', () => console.log('FAKE_READY ' + port));
