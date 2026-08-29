/**
 * Fake OpenAI-compatible server that scripts a full Agent Team session
 * for PR #10083 (send_message destination disambiguation).
 *
 * Every request body is appended to LEDGER as JSON lines so the tool
 * results the model actually saw can be replayed after the run.
 */
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const LEDGER = process.env.LEDGER_PATH;
const PORT_FILE = process.env.PORT_FILE;
const MARKER_FULL = 'QWEN-VERIFY-DRIVER-10083';
const MARKER_NOTEAM = 'QWEN-VERIFY-NOTEAM-10083';
const MARKER_TUI = 'QWEN-VERIFY-TUI-10083';

const S = {
  ambig: 'SENTINEL-AMBIGUOUS-DESTINATION',
  hint: 'SENTINEL-HINT-CASE',
  generic: 'SENTINEL-GENERIC-CASE',
  mirror: 'SENTINEL-MIRROR-CASE',
  leader: 'SENTINEL-LEADER-CASE',
};

const now = () => Math.floor(Date.now() / 1000);
const cid = () => `chatcmpl-${Math.random().toString(36).slice(2)}`;
const USAGE = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

function toolCall(name, args, id) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

function messagesText(body) {
  try {
    return JSON.stringify(body.messages ?? []);
  } catch {
    return '';
  }
}

/** Number of assistant turns that already emitted tool calls. */
function assistantToolTurns(body) {
  return (body.messages ?? []).filter(
    (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length,
  ).length;
}

/** Pull the background task id out of the agent-launch tool result. */
function backgroundTaskId(body) {
  for (const m of body.messages ?? []) {
    if (m.role !== 'tool') continue;
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const hit = /task_id:\s*([A-Za-z0-9._-]+)/.exec(c ?? '');
    if (hit) return hit[1];
  }
  return null;
}

function noTeamScript(body) {
  const step = assistantToolTurns(body);
  if (step === 0) {
    return {
      toolCalls: [toolCall('send_message', { task_id: 'QA Reviewer', message: S.hint }, 'n0')],
    };
  }
  return { content: 'VERIFY-DONE' };
}

function leaderScript(body, scenario) {
  const step = assistantToolTurns(body);
  const bg = backgroundTaskId(body);
  if (scenario === 'tui' && step >= 5) return { content: 'VERIFY-DONE' };
  switch (step) {
    case 0:
      return {
        toolCalls: [
          toolCall('team_create', { team_name: 'pr10083', description: 'verification team' }, 'c0'),
        ],
      };
    case 1:
      return {
        toolCalls: [
          toolCall(
            'agent',
            {
              name: 'qa-reviewer',
              description: 'QA teammate',
              prompt: 'You are the QA reviewer teammate. Stand by and do nothing.',
            },
            'c1',
          ),
        ],
      };
    case 2:
      return {
        toolCalls: [
          toolCall(
            'agent',
            {
              description: 'long running background probe',
              prompt: 'BACKGROUND-PROBE-AGENT: run for a long time. Do nothing.',
              subagent_type: 'general-purpose',
              run_in_background: true,
            },
            'c2',
          ),
        ],
      };
    case 3:
      return {
        toolCalls: [
          toolCall(
            'send_message',
            { to: 'qa-reviewer', task_id: bg ?? 'MISSING-BG-ID', message: S.ambig },
            'c3',
          ),
        ],
      };
    case 4:
      return {
        toolCalls: [toolCall('send_message', { task_id: 'QA Reviewer', message: S.hint }, 'c4')],
      };
    case 5:
      return {
        toolCalls: [
          toolCall('send_message', { task_id: 'unrelated-task-xyz', message: S.generic }, 'c5'),
        ],
      };
    case 6:
      return {
        toolCalls: [
          toolCall('send_message', { to: bg ?? 'MISSING-BG-ID', message: S.mirror }, 'c6'),
        ],
      };
    case 7:
      return {
        toolCalls: [toolCall('send_message', { task_id: 'leader', message: S.leader }, 'c7')],
      };
    default:
      return { content: 'VERIFY-DONE' };
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400);
    res.end('bad json');
    return;
  }

  if (LEDGER) {
    appendFileSync(LEDGER, JSON.stringify({ at: Date.now(), body }) + '\n');
  }

  const streaming = body.stream === true;
  if (!streaming) {
    // Side queries (memory selection, classifiers, summarisers).
    writeNonStreamed(res, body, { content: '{"selected_memories":[]}' });
    return;
  }

  const text = messagesText(body);
  const isBackgroundProbe = text.includes('BACKGROUND-PROBE-AGENT');

  if (text.includes(MARKER_NOTEAM)) {
    writeStreamed(res, body, noTeamScript(body));
    return;
  }
  if (text.includes(MARKER_TUI)) {
    writeStreamed(res, body, leaderScript(body, 'tui'));
    return;
  }
  if (text.includes(MARKER_FULL)) {
    writeStreamed(res, body, leaderScript(body, 'full'));
    return;
  }
  if (isBackgroundProbe) {
    // Hold the response open so the background task stays `running`
    // while the leader issues its send_message calls.
    const timer = setTimeout(() => {
      writeStreamed(res, body, { content: 'background probe finished' });
    }, 300000);
    res.on('close', () => clearTimeout(timer));
    return;
  }
  // Teammate and any other nested session: go idle immediately.
  writeStreamed(res, body, { content: 'Standing by.' });
});

function writeNonStreamed(res, body, msg) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: cid(),
      object: 'chat.completion',
      created: now(),
      model: body.model ?? 'fake-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: msg.content ?? null },
          finish_reason: 'stop',
        },
      ],
      usage: USAGE,
    }),
  );
}

function writeStreamed(res, body, msg) {
  res.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  });
  const id = cid();
  const created = now();
  const model = body.model ?? 'fake-model';
  const chunk = (delta, finish_reason = null, usage) => ({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason }],
    ...(usage ? { usage } : {}),
  });
  const send = (p) => res.write(`data: ${JSON.stringify(p)}\n\n`);

  send(chunk({ role: 'assistant' }));
  if (msg.content) send(chunk({ content: msg.content }));
  (msg.toolCalls ?? []).forEach((tc, i) => {
    send(
      chunk({
        tool_calls: [
          { index: i, id: tc.id, type: tc.type, function: { name: tc.function.name, arguments: '' } },
        ],
      }),
    );
    send(
      chunk({
        tool_calls: [{ index: i, function: { arguments: tc.function.arguments } }],
      }),
    );
  });
  send(chunk({}, msg.toolCalls?.length ? 'tool_calls' : 'stop', USAGE));
  res.write('data: [DONE]\n\n');
  res.end();
}

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  if (PORT_FILE) writeFileSync(PORT_FILE, String(port));
  console.log(`fake-openai listening on http://127.0.0.1:${port}/v1`);
});
