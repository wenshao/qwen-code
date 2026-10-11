// VERIFICATION RIG ONLY (PR #13773): deterministic OpenAI-compatible model.
// The script is chosen by the marker in the LAST user message that carries one:
//   G_AGENT bg=<true|false> tag=<t>  round 0: agent({description, prompt:"G_CHILD tag=<t>", run_in_background}) ; then G_DONE
//   G_CHILD tag=<t>                  round 0: write_file(child-<t>.txt) ; then G_DONE   (needs the Workspace mount)
//   G_READ tag=<t>                   round 0: write_file(seed-<t>.txt) ; then G_DONE    (fires result Hooks once)
//   anything else                    "PLAIN_OK"
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 15773);
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
      // The LAST user message decides (a background child's notification turn carries no G_AGENT and stays plain).
      let lastUser = -1;
      messages.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
      const userText = lastUser >= 0 ? text(messages[lastUser].content) : '';
      const tools = (body.tools ?? []).map((t) => t.function?.name);
      const after = messages.slice(lastUser + 1);
      const results = after.filter((m) => m.role === 'tool');
      const rounds = after.filter((m) => m.role === 'assistant').length;
      const marker = [...userText.matchAll(/G_(AGENT|CHILD|READ)([^\n"\\]*)/g)].at(-1);
      let kind = marker?.[1] ?? 'PLAIN';
      // Only a child Session (no agent tool) runs the child script; a parent that sees a quoted G_CHILD stays plain.
      if (kind === 'CHILD' && tools.includes('agent')) kind = 'PLAIN';
      const opts = Object.fromEntries([...(marker?.[2] ?? '').matchAll(/(\w+)=([^\s"\\]+)/g)].map((m) => [m[1], m[2]]));
      const summary = results.map((r) => text(r.content).replace(/\s+/g, ' ').slice(0, 600));
      const entry = { kind, tag: opts.tag, bg: opts.bg, rounds, msgs: messages.length, tools, results: summary, lastUserHead: userText.slice(0, 160) };
      write(entry);
      const id = (n) => `rig-call-${opts.tag ?? 'x'}-${rounds}-${n}`;
      const done = () => reply(res, { content: `G_DONE kind=${kind} tag=${opts.tag ?? ''} rounds=${rounds} results=${JSON.stringify(summary)}` }, 'stop');
      if (kind === 'AGENT' && rounds < 1) {
        if (!tools.includes('agent')) { reply(res, { content: `G_NO_AGENT_TOOL tag=${opts.tag} tools=${tools.join(',')}` }, 'stop'); return; }
        reply(res, calls([[id(0), 'agent', { description: `audit ${opts.tag}`, prompt: `G_CHILD tag=${opts.tag}`, run_in_background: opts.bg !== 'false' }]]), 'tool_calls');
      } else if (kind === 'CHILD' && rounds < 1) {
        reply(res, calls([[id(0), 'write_file', { file_path: `child-${opts.tag}.txt`, content: `child ${opts.tag} ran` }]]), 'tool_calls');
      } else if (kind === 'READ' && rounds < 1) {
        reply(res, calls([[id(0), 'write_file', { file_path: `seed-${opts.tag}.txt`, content: `seed ${opts.tag}` }]]), 'tool_calls');
      } else if (kind === 'PLAIN') {
        reply(res, { content: 'PLAIN_OK' }, 'stop');
      } else done();
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`model ${port}`));
