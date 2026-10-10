// VERIFICATION RIG ONLY: deterministic OpenAI-compatible model for PR #13682.
// The script is chosen by the marker in the LAST user message (so each Turn of a Session starts over):
//   G_FILES name=<f> tag=<t>   write_file(<f>,"before-<t>") -> edit(before-<t> -> after-<t>) -> read_file -> "G_DONE ..."
//   G_WRITE name=<f> content=<c>  one write_file(<f>, upper(<c>)) then "G_DONE ..."
//   G_HOLD                    never answers; logs when the Harness aborts the request (cancel), gives up after 120 s
//   G_SLOW name=<f> hold=<ms>  waits hold ms (or until aborted), then one write_file(<f>), then done
//   G_TRICKLE secs=<s> every=<ms> streams one text delta every <ms> for <s> seconds, then stops (round 4)
//   anything else             "PLAIN_OK" (no tools)
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 15163);
const log = process.argv[3] ?? 'model-requests.jsonl';
const text = (c) => (typeof c === 'string' ? c : JSON.stringify(c ?? ''));
const write = (e) => fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), ...e }) + '\n');

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
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
      const messages = body.messages ?? [];
      let lastUser = -1;
      messages.forEach((m, i) => { if (m.role === 'user' && /G_[A-Z]+|PLAIN/.test(text(m.content))) lastUser = i; });
      if (lastUser < 0) messages.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
      const userText = lastUser >= 0 ? text(messages[lastUser].content) : '';
      const tools = (body.tools ?? []).map((t) => t.function?.name);
      const after = messages.slice(lastUser + 1);
      const results = after.filter((m) => m.role === 'tool');
      const rounds = after.filter((m) => m.role === 'assistant').length;
      const marker = [...userText.matchAll(/G_(FILES|WRITE|HOLD|SLOW|STEP|TRICKLE)([^\n"\\]*)/g)].at(-1);
      const kind = marker?.[1] ?? 'PLAIN';
      const opts = Object.fromEntries([...(marker?.[2] ?? '').matchAll(/(\w+)=([^\s"\\]+)/g)].map((m) => [m[1], m[2]]));
      const summary = results.map((r) => text(r.content).replace(/\s+/g, ' ').slice(0, 150));
      const userTurns = messages.filter((m) => m.role === 'user').length;
      const entry = { kind, tag: opts.tag, rounds, userTurns, msgs: messages.length, tools, results: summary };
      write(entry);
      const file = opts.name ?? 'proof.txt';
      const id = (n) => `rig-call-${rounds}-${n}`;
      const done = () => reply(res, { content: `G_DONE tag=${opts.tag ?? ''} rounds=${rounds} results=${JSON.stringify(summary)}` }, 'stop');
      if (kind === 'TRICKLE') {
        const started = Date.now(); const every = Number(opts.every ?? 250); const secs = Number(opts.secs ?? 40);
        const chunk = (d, f) => JSON.stringify({ id: 'rig', object: 'chat.completion.chunk', created: 0, model: 'rig-model', choices: [{ index: 0, delta: d, finish_reason: f }] });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${chunk({ role: 'assistant', content: 't0 ' }, null)}\n\n`);
        let n = 0;
        const timer = setInterval(() => {
          n += 1;
          if (Date.now() - started >= secs * 1000) { clearInterval(timer); write({ kind: 'TRICKLE-done', tag: opts.tag, n }); res.end(`data: ${chunk({}, 'stop')}\n\ndata: [DONE]\n\n`); return; }
          res.write(`data: ${chunk({ content: 't' + n + ' ' }, null)}\n\n`);
        }, every);
        res.on('close', () => { clearInterval(timer); if (!res.writableEnded) write({ kind: 'TRICKLE-aborted', tag: opts.tag, heldMs: Date.now() - started, n }); });
        return;
      }
      if (kind === 'HOLD') {
        const started = Date.now();
        const timer = setTimeout(() => { write({ kind: 'HOLD-timeout', tag: opts.tag }); reply(res, { content: 'HOLD_EXPIRED' }, 'stop'); }, 120_000);
        res.on('close', () => { clearTimeout(timer); if (!res.writableEnded) write({ kind: 'HOLD-aborted', tag: opts.tag, heldMs: Date.now() - started }); });
        return;
      }
      if (kind === 'SLOW' && rounds < 1) {
        // hold the first reply for hold= ms, then ask for one write_file
        const started = Date.now();
        const timer = setTimeout(() => { write({ kind: 'SLOW-reply', tag: opts.tag }); reply(res, calls([[id(0), 'write_file', { file_path: file, content: 'written-after-cancel' }]]), 'tool_calls'); }, Number(opts.hold ?? 8000));
        res.on('close', () => { clearTimeout(timer); if (!res.writableEnded) write({ kind: 'SLOW-aborted', tag: opts.tag, heldMs: Date.now() - started }); });
        return;
      }
      if (kind === 'STEP' && rounds === 0) { reply(res, calls([[id(0), 'write_file', { file_path: file, content: 'step-one' }]]), 'tool_calls'); return; }
      if (kind === 'STEP' && rounds === 1) {
        const started = Date.now();
        write({ kind: 'STEP-hold', tag: opts.tag });
        const timer = setTimeout(() => { write({ kind: 'STEP-reply', tag: opts.tag }); reply(res, calls([[id(0), 'write_file', { file_path: opts.name2 ?? 'second.txt', content: 'step-two' }]]), 'tool_calls'); }, Number(opts.hold ?? 8000));
        res.on('close', () => { clearTimeout(timer); if (!res.writableEnded) write({ kind: 'STEP-aborted', tag: opts.tag, heldMs: Date.now() - started }); });
        return;
      }
      if (kind === 'FILES' && rounds < 3) {
        const t = opts.tag ?? 'x';
        const step = [
          ['write_file', { file_path: file, content: `before-${t}` }],
          ['edit', { file_path: file, old_string: `before-${t}`, new_string: `after-${t}` }],
          ['read_file', { file_path: file }],
        ][rounds];
        reply(res, calls([[id(0), step[0], step[1]]]), 'tool_calls');
      } else if (kind === 'WRITE' && rounds < 1) {
        reply(res, calls([[id(0), 'write_file', { file_path: file, content: (opts.content ?? 'content').toUpperCase() }]]), 'tool_calls');
      } else if (kind === 'PLAIN') {
        reply(res, { content: 'PLAIN_OK' }, 'stop');
      } else done();
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`model listening ${port}`));
