// VERIFICATION RIG ONLY (PR #13084): deterministic OpenAI-compatible model.
// The script is chosen by a marker in the LAST user message:
//   [O3_SH:<base64url command>]                 one run_shell_command, then a text answer
//   [O3_SH2:<base64url cmd1>:<base64url cmd2>]  two sequential run_shell_command calls
//   [O3_PAR:<base64url cmd1>:<base64url cmd2>]  two run_shell_command calls in ONE response
//   [O3_CMD:<name>]                             one run_shell_command; the command is looked up in run/commands.json
//   [O3_DELAY:<ms>]                             additionally: answer after the tool results only after <ms> (models a real model's latency)
//   [O3_FILE]                                   one write_file call (non-Shell producer)
//   anything else                               "PLAIN_OK" (no tools)
// Usage: node model.mjs <port> <request-log.jsonl>
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 45226);
const log = process.argv[3] ?? 'model-requests.jsonl';

const text = (content) =>
  typeof content === 'string' ? content : JSON.stringify(content ?? '');
const b64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

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

const call = (index, id, name, args) => ({
  index,
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
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
      const markers = [...userText.matchAll(/\[O3_(SH2|SH|PAR|FILE|CMD)(?::([A-Za-z0-9_-]+))?(?::([A-Za-z0-9_-]+))?\]/g)];
      const marker = markers.at(-1);
      const kind = marker?.[1] ?? 'PLAIN';
      const last = step ? text(results.at(-1).content) : null;
      fs.appendFileSync(
        log,
        JSON.stringify({
          t: new Date().toISOString(),
          kind,
          step,
          tools,
          toolResultBytes: last === null ? null : Buffer.byteLength(last),
          lastToolResult: last === null ? null : last.slice(0, 600),
        }) + '\n',
      );
      const wait = /\[O3_DELAY:(\d+)\]/.exec(userText);
      if (wait && step > 0) await new Promise((r) => setTimeout(r, Number(wait[1])));
      // named commands answer like a real model would: a little after the tool result
      if (kind === 'CMD' && step > 0) await new Promise((r) => setTimeout(r, 2500));
      const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      if (kind === 'CMD' && step < 1) {
        const commands = JSON.parse(fs.readFileSync(new URL('./run/commands.json', import.meta.url), 'utf8'));
        reply(res, { tool_calls: [call(0, `rig-cmd-${tag}`, 'run_shell_command', { command: commands[marker[2]] })] }, 'tool_calls');
      } else if (kind === 'SH' && step < 1) {
        reply(res, { tool_calls: [call(0, `rig-sh-${tag}`, 'run_shell_command', { command: b64(marker[2]) })] }, 'tool_calls');
      } else if (kind === 'SH2' && step < 2) {
        reply(res, { tool_calls: [call(0, `rig-sh${step}-${tag}`, 'run_shell_command', { command: b64(marker[2 + step]) })] }, 'tool_calls');
      } else if (kind === 'PAR' && step < 1) {
        reply(
          res,
          {
            tool_calls: [
              call(0, `rig-pa-${tag}`, 'run_shell_command', { command: b64(marker[2]) }),
              call(1, `rig-pb-${tag}`, 'run_shell_command', { command: b64(marker[3]) }),
            ],
          },
          'tool_calls',
        );
      } else if (kind === 'FILE' && step < 1) {
        reply(res, { tool_calls: [call(0, `rig-wf-${tag}`, 'write_file', { file_path: 'proof.txt', content: 'o3 file producer' })] }, 'tool_calls');
      } else {
        reply(res, { content: kind === 'PLAIN' ? 'PLAIN_OK' : kind === 'CMD' ? (JSON.parse(fs.readFileSync(new URL('./run/answers.json', import.meta.url), 'utf8'))[marker[2]] ?? 'Done.') : 'The command finished; its saved output is attached to the tool card.' }, 'stop');
      }
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`model listening ${port}`));
