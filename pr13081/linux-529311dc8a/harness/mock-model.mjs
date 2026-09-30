// OpenAI-compatible streaming stub for the PR #13081 real-stack rig.
// Behavior per turn (counted by user messages in the request):
//   - no tool result yet  -> emit tool_call(s) for read_file (turn 4: two
//     parallel calls, everything else: one), with artificial latency so the
//     trajectory waterfall gets distinct request/tool durations;
//   - tool result present -> final text answer.
// The point is a REAL daemon session whose transcript replay carries real
// ui_telemetry timing frames (request + tool), rendered by the PR's panel.
import http from 'node:http';

const port = Number(process.env.MOCK_MODEL_PORT ?? 23181);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunk(model, delta, finishReason) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-rig13081',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400).end('bad json');
        return;
      }
      const model = parsed.model ?? 'rig-trajectory';
      const messages = parsed.messages ?? [];
      const userTurns = messages.filter((m) => m.role === 'user').length;
      // Only the CURRENT turn matters: a tool result that arrives after the
      // last user message means this request is the follow-up -> final text.
      const lastUser = messages.map((m) => m.role).lastIndexOf('user');
      const hasToolResult = messages.slice(lastUser + 1).some((m) => m.role === 'tool');
      const turn = userTurns; // user msgs already include the current prompt

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const abort = { done: false };
      res.on('close', () => {
        abort.done = true;
      });

      // Vary latency per turn so waterfall bars differ: 400/700/1000/1300ms...
      const latency = 400 + ((turn - 1) % 4) * 300;
      await sleep(latency);
      if (abort.done) return;

      if (!hasToolResult) {
        const calls =
          turn % 4 === 0
            ? [
                { id: `call_${turn}_a`, name: 'read_file', args: { file_path: `/root/rig13081/workspace/note-${turn}a.txt` } },
                { id: `call_${turn}_b`, name: 'read_file', args: { file_path: `/root/rig13081/workspace/note-${turn}b.txt` } },
              ]
            : [
                { id: `call_${turn}_a`, name: 'read_file', args: { file_path: `/root/rig13081/workspace/note-${turn}a.txt` } },
              ];
        // First chunk carries role, subsequent chunks carry one tool call each.
        res.write(chunk(model, { role: 'assistant', content: '' }, null));
        for (let i = 0; i < calls.length; i += 1) {
          const c = calls[i];
          res.write(
            chunk(
              model,
              {
                tool_calls: [
                  {
                    index: i,
                    id: c.id,
                    type: 'function',
                    function: { name: c.name, arguments: JSON.stringify(c.args) },
                  },
                ],
              },
              i === calls.length - 1 ? 'tool_calls' : null,
            ),
          );
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // Final answer after the tool result: drip a few text chunks.
      const text = `Turn ${turn} done: read the note file(s) successfully.`;
      for (const piece of [text.slice(0, 20), text.slice(20)]) {
        res.write(chunk(model, { content: piece }, null));
        await sleep(120);
        if (abort.done) return;
      }
      res.write(chunk(model, {}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
    });
    return;
  }
  if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'rig-trajectory', object: 'model', owned_by: 'rig' }],
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`mock model listening on http://127.0.0.1:${port}/v1`);
});
