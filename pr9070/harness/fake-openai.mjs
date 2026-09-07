/**
 * Standalone fake OpenAI-compatible server for PR #9070 verification.
 * Logs every request body to $LOG_FILE (JSONL) and scripts responses by role.
 */
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.FAKE_PORT || 0);
const LOG = process.env.FAKE_LOG || '/tmp/fake-openai.jsonl';
const MARKER = process.env.TEAMMATE_MARKER || 'ZZMARKERZZ';
const PROBE_TOOL = process.env.PROBE_TOOL || 'run_shell_command';
const PROBE_ARGS = process.env.PROBE_ARGS || JSON.stringify({ command: 'echo pr9070-probe' });
const TEAM_NAME = process.env.TEAM_NAME || 'verify9070';

writeFileSync(LOG, '');

let seq = 0;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n');
  return '';
}

function isTeammate(messages) {
  return messages.some(
    (m) =>
      (m.role === 'system' || m.role === 'user') &&
      textOf(m.content).includes(MARKER),
  );
}

// count assistant messages that carried tool_calls -> which scripted turn we're on
function assistantToolTurns(messages) {
  return messages.filter(
    (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
  ).length;
}

function toolCall(id, name, args) {
  return [{ id, type: 'function', function: { name, arguments: args } }];
}

const SCRIPT_MODE = process.env.SCRIPT_MODE || 'team';

function auqScript(turn) {
  if (turn === 0)
    return {
      tool_calls: toolCall(
        'call_probe',
        'ask_user_question',
        JSON.stringify({
          questions: [
            {
              question: 'Which arm should the probe report?',
              header: 'Arm',
              options: [
                { label: 'Alpha', description: 'first option' },
                { label: 'Beta', description: 'second option' },
              ],
            },
          ],
        }),
      ),
    };
  return { content: 'LEADER_DONE' };
}

function leaderScript(turn) {
  if (SCRIPT_MODE === 'auq') return auqScript(turn);
  if (turn === 0)
    return {
      tool_calls: toolCall('call_team_create', 'team_create', JSON.stringify({ team_name: TEAM_NAME })),
    };
  if (turn === 1)
    return {
      tool_calls: toolCall(
        'call_agent',
        'agent',
        JSON.stringify({
          description: 'probe worker',
          name: 'worker',
          subagent_type: 'general-purpose',
          prompt: `${MARKER} You are a probe. Immediately call the tool as instructed by the harness. Do not ask questions.`,
        }),
      ),
    };
  return { content: 'LEADER_DONE' };
}

function teammateScript(turn) {
  if (turn === 0)
    return { tool_calls: toolCall('call_probe', PROBE_TOOL, PROBE_ARGS) };
  return { content: 'TEAMMATE_DONE' };
}

function sse(res, payload) {
  const id = `chatcmpl-${++seq}`;
  const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fake-model' };
  const write = (delta, finish) =>
    res.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish ?? null }] })}\n\n`,
    );
  write({ role: 'assistant' });
  if (payload.tool_calls) {
    write({
      tool_calls: payload.tool_calls.map((tc, i) => ({
        index: i,
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    });
    write({}, 'tool_calls');
  } else {
    write({ content: payload.content ?? 'ok' });
    write({}, 'stop');
  }
  res.write(
    `data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = createServer(async (req, res) => {
  if (!req.url.includes('/chat/completions')) {
    res.writeHead(404).end('nope');
    return;
  }
  const raw = await readBody(req);
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {}
  const messages = body.messages || [];
  const teammate = isTeammate(messages);
  const turn = assistantToolTurns(messages);
  appendFileSync(
    LOG,
    JSON.stringify({ n: seq + 1, at: Date.now(), teammate, turn, body }) + '\n',
  );
  if (body.stream !== true) {
    // side queries (memory selection, summarisation, ...) — never scripted
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: `chatcmpl-side-${++seq}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'fake-model',
        choices: [
          { index: 0, message: { role: 'assistant', content: '{"selected_memories":[]}' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
    return;
  }
  const payload = teammate ? teammateScript(turn) : leaderScript(turn);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  sse(res, payload);
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  console.log(`FAKE_READY ${addr.port}`);
});
