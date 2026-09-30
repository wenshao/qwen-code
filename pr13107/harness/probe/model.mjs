// VERIFICATION RIG ONLY: deterministic OpenAI-compatible model for PR #13107.
// The script is chosen by a marker in the LAST user message:
//   UI_WRITE name=<f> content=<c>      one write_file, then "UI_DONE ..."
//   UI_FILES name=<f>                  write -> edit -> read -> "UI_DONE ..."
//   UI_BATCH names=a.txt,b.txt         ONE assistant message with a write_file per name, then done
//   UI_SEQ n=<k> name=<stem>           k sequential write_file rounds, then done
//   UI_RETRY n=<k> name=<f>            keeps re-issuing the same write_file after a refusal, up to k rounds
//   anything else                      "PLAIN_OK" (no tools)
// The final text quotes every tool result so a refusal is visible in the Session's events.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 15107);
const log = process.argv[3] ?? 'model-requests.jsonl';
const text = (c) => (typeof c === 'string' ? c : JSON.stringify(c ?? ''));

function reply(res, delta, finish) {
  const chunk = (d, f) =>
    JSON.stringify({ id: 'rig', object: 'chat.completion.chunk', created: 0, model: 'rig-model', choices: [{ index: 0, delta: d, finish_reason: f }] });
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(`data: ${chunk({ role: 'assistant', ...delta }, null)}\n\n` + `data: ${chunk({}, finish)}\n\n` + 'data: [DONE]\n\n');
}
const calls = (list) => ({
  content: 'I will use ' + list.map((c) => c[1]).join(', ') + ' now.',
  tool_calls: list.map(([id, name, args], index) => ({ index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } })),
});

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
      const messages = body.messages ?? [];
      let lastUser = -1;
      messages.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
      const userText = lastUser >= 0 ? text(messages[lastUser].content) : '';
      const tools = (body.tools ?? []).map((t) => t.function?.name);
      const after = messages.slice(lastUser + 1);
      const results = after.filter((m) => m.role === 'tool');
      const rounds = after.filter((m) => m.role === 'assistant').length;
      const markers = [...userText.matchAll(/UI_(WRITE|FILES|BATCH|SEQ|RETRY|SHELL)([^\n"\\]*)/g)];
      const marker = markers.at(-1);
      const kind = marker?.[1] ?? 'PLAIN';
      const opts = Object.fromEntries([...(marker?.[2] ?? '').matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
      const summary = results.map((r) => text(r.content).replace(/\s+/g, ' ').slice(0, 150));
      fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), kind, rounds, tools, results: summary }) + '\n');
      const delay = Number(opts.delay ?? 0);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const file = opts.name ?? 'proof.txt';
      const done = () => reply(res, { content: `UI_DONE rounds=${rounds} results=${JSON.stringify(summary)}` }, 'stop');
      const id = (n) => `rig-call-${rounds}-${n}`;
      if (kind === 'WRITE' && rounds < 1) {
        reply(res, calls([[id(0), 'write_file', { file_path: file, content: (opts.content ?? 'approved-content').toUpperCase() }]]), 'tool_calls');
      } else if (kind === 'FILES' && rounds < 3) {
        const step = [
          ['write_file', { file_path: file, content: 'before' }],
          ['edit', { file_path: file, old_string: 'before', new_string: 'after' }],
          ['read_file', { file_path: file }],
        ][rounds];
        reply(res, calls([[id(0), step[0], step[1]]]), 'tool_calls');
      } else if (kind === 'BATCH' && rounds < 1) {
        const names = (opts.names ?? 'a.txt,b.txt').split(',');
        reply(res, calls(names.map((n, i) => [id(i), 'write_file', { file_path: n, content: `batch-${n}` }])), 'tool_calls');
      } else if (kind === 'SEQ' && rounds < Number(opts.n ?? 2)) {
        reply(res, calls([[id(0), 'write_file', { file_path: `${file}-${rounds}`, content: `seq-${rounds}` }]]), 'tool_calls');
      } else if (kind === 'RETRY' && rounds < Number(opts.n ?? 3) && !summary.some((s) => /Successfully|created|wrote/i.test(s))) {
        reply(res, calls([[id(0), 'write_file', { file_path: file, content: `retry-${rounds}` }]]), 'tool_calls');
      } else if (kind === 'SHELL' && rounds < 1) {
        reply(res, calls([[id(0), 'run_shell_command', { command: 'echo approved-by-owner > ' + file, description: 'Write a marker file with the shell' }]]), 'tool_calls');
      } else if (kind === 'PLAIN') {
        reply(res, { content: 'PLAIN_OK' }, 'stop');
      } else done();
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`model listening ${port}`));
