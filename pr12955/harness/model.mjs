// VERIFICATION RIG ONLY: deterministic OpenAI-compatible model.
// The script is chosen by a marker in the LAST user message:
//   G0_FILES [name=<file>] [delay=<ms>]  write -> edit -> read -> "G0_DONE"
//   G0_PATH path=<p>                       one write_file to <p>, then "G0_DONE"
//   G0_HANG                                write, then hold the 2nd response ~forever
//   anything else                          "PLAIN_OK" (no tools)
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 15955);
const log = process.argv[3] ?? 'model-requests.jsonl';

const text = (content) =>
  typeof content === 'string' ? content : JSON.stringify(content ?? '');

function reply(res, delta, finish) {
  const chunk = (d, f) =>
    JSON.stringify({
      id: 'rig',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'rig-model',
      choices: [{ index: 0, delta: d, finish_reason: f }],
    });
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(
    `data: ${chunk({ role: 'assistant', ...delta }, null)}\n\n` +
      `data: ${chunk({}, finish)}\n\n` +
      'data: [DONE]\n\n',
  );
}

const call = (step, name, args) => ({
  tool_calls: [
    {
      index: 0,
      id: `rig-tool-${step}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const messages = body.messages ?? [];
      let lastUser = -1;
      messages.forEach((m, i) => {
        if (m.role === 'user') lastUser = i;
      });
      const userText = lastUser >= 0 ? text(messages[lastUser].content) : '';
      const tools = (body.tools ?? []).map((t) => t.function?.name);
      const results = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
      const step = results.length;
      // Markers may repeat when core merges adjacent user turns: take the LAST.
      const markers = [...userText.matchAll(/G0_(FILES|PATH|HANG)([^\n"\\]*)/g)];
      const marker = markers.at(-1);
      const kind = marker?.[1] ?? 'PLAIN';
      const opts = Object.fromEntries(
        [...(marker?.[2] ?? '').matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]),
      );
      fs.appendFileSync(
        log,
        JSON.stringify({
          t: new Date().toISOString(),
          kind,
          step,
          tools,
          lastToolResult: step ? text(results.at(-1).content).slice(0, 400) : null,
        }) + '\n',
      );
      const delay = Number(opts.delay ?? 0);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const file = opts.name ?? 'proof.txt';
      if (kind === 'FILES' && step < 3) {
        const args = [
          { file_path: file, content: 'before' },
          { file_path: file, old_string: 'before', new_string: 'after' },
          { file_path: file },
        ][step];
        reply(res, call(step, ['write_file', 'edit', 'read_file'][step], args), 'tool_calls');
      } else if (kind === 'PATH' && step < 1) {
        reply(res, call(step, 'write_file', { file_path: opts.path, content: 'escaped' }), 'tool_calls');
      } else if (kind === 'HANG' && step < 1) {
        reply(res, call(step, 'write_file', { file_path: file, content: 'hang' }), 'tool_calls');
      } else if (kind === 'HANG') {
        await new Promise((r) => setTimeout(r, 3_600_000));
        reply(res, { content: 'G0_DONE' }, 'stop');
      } else {
        reply(res, { content: kind === 'PLAIN' ? 'PLAIN_OK' : 'G0_DONE' }, 'stop');
      }
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`model listening ${port}`));
