/**
 * OpenAI-compatible mock for PR #11576 verification.
 *
 * Classifies every request by its system prompt and drives three distinct
 * checkpoint-verifier failure shapes from out/control.json, which is re-read
 * per request so an arm can be switched while the CLI is running.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const H = process.env.H || '/root/git/h11576';
const CONTROL = path.join(H, 'out', 'control.json');
const WIRE = path.join(H, 'out', 'wire.jsonl');
const PORT = Number(process.env.PORT || 4576);

function control() {
  try {
    return JSON.parse(fs.readFileSync(CONTROL, 'utf8'));
  } catch {
    return {};
  }
}

function log(entry) {
  fs.appendFileSync(WIRE, JSON.stringify({ t: Date.now(), ...entry }) + '\n');
}

const flat = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((p) => p?.text ?? '').join('')
      : '';

function classify(messages) {
  const sys = messages
    .filter((m) => m.role === 'system')
    .map((m) => flat(m.content))
    .join('\n');
  const all = messages.map((m) => flat(m.content)).join('\n');
  if (sys.includes('Goal Evidence Checkpoint Verifier')) return 'checkpoint';
  if (sys.includes('Goal Verifier') || sys.includes('Goal verifier'))
    return 'verifier';
  if (sys.includes('You are Qwen Code')) return 'agent';
  if (all.includes('SUGGESTION MODE')) return 'suggestion';
  return 'other';
}

let sseId = 0;
function sse(res, chunks) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const id = `chatcmpl-${++sseId}`;
  for (const delta of chunks) {
    res.write(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'mock-model',
        choices: [{ index: 0, delta, finish_reason: null }],
      })}\n\n`,
    );
  }
  res.write(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'mock-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

function json(res, body) {
  const payload = JSON.stringify(body);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** N distinct shell tool calls, so each result becomes its own evidence record. */
function agentToolCalls(turn, count) {
  const calls = [];
  for (let i = 0; i < count; i++) {
    calls.push({
      index: i,
      id: `call_t${turn}_${i}`,
      type: 'function',
      function: {
        name: 'run_shell_command',
        arguments: JSON.stringify({
          command: `printf 'probe turn ${turn} step ${i}: %s\\n' "$(printf 'x%.0s' $(seq 1 180))"`,
          description: `evidence probe ${turn}.${i}`,
        }),
      },
    });
  }
  return calls;
}

const turnCounts = new Map();

const server = http.createServer((req, res) => {
  if (req.url.includes('/models')) {
    return json(res, {
      object: 'list',
      data: [{ id: 'mock-model', object: 'model', owned_by: 'mock' }],
    });
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    let payload = {};
    try {
      payload = JSON.parse(body);
    } catch {
      /* ignore */
    }
    const messages = payload.messages || [];
    const kind = classify(messages);
    const ctl = control();
    const runId = ctl.runId || 'run';
    log({
      kind,
      runId,
      stream: !!payload.stream,
      tools: (payload.tools || []).map((t) => t.function?.name),
      lastUser: flat(messages[messages.length - 1]?.content).slice(0, 200),
    });

    if (kind === 'checkpoint') {
      const mode = ctl.verifier || 'timeout';
      // Cite the real evidence uuids the runtime just sent, so a "valid"
      // checkpoint is actually accepted and only the shape under test fails.
      let refs = [];
      try {
        const req = JSON.parse(
          flat(messages[messages.length - 1]?.content) || '{}',
        );
        refs = [
          ...(req.evidence || []).map((e) => ({
            id: e.uuid,
            proofKind: e.proofKind,
          })),
          ...(req.previousClaims || []).map((c) => ({
            id: c.id,
            proofKind: c.proofKind,
          })),
        ].filter((r) => r.id && r.proofKind);
      } catch {
        /* ignore */
      }
      log({
        event: 'checkpoint-request',
        runId,
        mode,
        evidenceCount: refs.length,
      });
      if (mode === 'timeout') {
        // Never answer. The runtime's own verifier timeout ends the check.
        return;
      }
      if (mode === 'error') {
        const msg = JSON.stringify({
          error: { message: 'mock upstream failure', type: 'server_error' },
        });
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(msg),
        });
        return res.end(msg);
      }
      let text;
      if (mode === 'empty') text = JSON.stringify({ claims: [] });
      else if (mode === 'garbage') text = 'not json at all';
      else if (mode === 'full') {
        // A full claim list: the runtime reads this as compaction that gave
        // no relief while the window overflows.
        const claims = [];
        const n = ctl.claimCount ?? 32;
        for (let i = 0; i < n; i++) {
          const src = refs[i % Math.max(refs.length, 1)];
          claims.push({
            proofKind: src?.proofKind || 'delivered_output',
            claim: `claim ${i}: probe output recorded`,
            sourceRefs: [src?.id || 'e1'],
          });
        }
        text = JSON.stringify({ claims });
      } else if (mode === 'badref') {
        text = JSON.stringify({
          claims: [
            {
              proofKind: 'delivered_output',
              claim: 'the probe commands produced output',
              sourceRefs: ['e1'],
            },
          ],
        });
      } else {
        text = JSON.stringify({
          claims: [
            {
              proofKind: refs[0]?.proofKind || 'delivered_output',
              claim: 'the probe commands produced output',
              sourceRefs: [refs[0]?.id || 'e1'],
            },
          ],
        });
      }
      return payload.stream
        ? sse(res, [{ role: 'assistant', content: text }])
        : json(res, {
            id: 'chatcmpl-cp',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'mock-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: text },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 10,
              total_tokens: 60,
            },
          });
    }

    if (kind === 'verifier') {
      const text = JSON.stringify({
        verdict: 'not_met',
        reason: 'mock verifier: keep working',
      });
      return payload.stream
        ? sse(res, [{ role: 'assistant', content: text }])
        : json(res, {
            id: 'chatcmpl-v',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'mock-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: text },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 5,
              total_tokens: 25,
            },
          });
    }

    if (kind === 'agent') {
      const convo = messages.map((m) => flat(m.content)).join('\n');
      if (convo.includes('MOCK_GETGOAL')) {
        const lastRole = messages[messages.length - 1]?.role;
        if (lastRole === 'tool') {
          const result = flat(messages[messages.length - 1]?.content);
          log({ event: 'get_goal-result', runId, result });
          fs.writeFileSync(path.join(H, 'out', 'getgoal-result.json'), result);
          return payload.stream
            ? sse(res, [{ role: 'assistant', content: 'read the goal' }])
            : json(res, {
                id: 'chatcmpl-g',
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: 'mock-model',
                choices: [
                  {
                    index: 0,
                    message: { role: 'assistant', content: 'read the goal' },
                    finish_reason: 'stop',
                  },
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 2,
                  total_tokens: 12,
                },
              });
        }
        const call = {
          index: 0,
          id: 'call_getgoal',
          type: 'function',
          function: { name: 'get_goal', arguments: '{}' },
        };
        return payload.stream
          ? sse(res, [{ role: 'assistant', content: '' }, { tool_calls: [call] }])
          : json(res, {
              id: 'chatcmpl-g',
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: 'mock-model',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: '', tool_calls: [call] },
                  finish_reason: 'tool_calls',
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 2,
                total_tokens: 12,
              },
            });
      }
      // One batch of tool calls per Goal turn: the batch goes out on the
      // turn's first request, and the request that carries its results is
      // answered with text only, which is what ends the turn and lets the
      // runtime run its checkpoint.
      const lastRole = messages[messages.length - 1]?.role;
      if (lastRole === 'tool') {
        const n = turnCounts.get(runId) ?? 0;
        log({ event: 'agent-turn-end', runId, turn: n });
        const text = `Step ${n} done: ${n} probe batches recorded.`;
        return payload.stream
          ? sse(res, [{ role: 'assistant', content: text }])
          : json(res, {
              id: 'chatcmpl-a',
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: 'mock-model',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: text },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 500,
                completion_tokens: 20,
                total_tokens: 520,
              },
            });
      }
      const n = (turnCounts.get(runId) ?? 0) + 1;
      turnCounts.set(runId, n);
      const perTurn = ctl.callsPerTurn ?? 60;
      const count = n <= (ctl.bulkTurns ?? 2) ? perTurn : (ctl.tailCalls ?? 2);
      log({ event: 'agent-turn', runId, turn: n, toolCalls: count });
      if (count <= 0) {
        // A turn that records nothing at all: the evidence window stays
        // empty, so the runtime settles the check as 'room'.
        const text = `Nothing to report on step ${n}.`;
        return payload.stream
          ? sse(res, [{ role: 'assistant', content: text }])
          : json(res, {
              id: 'chatcmpl-q',
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: 'mock-model',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: text },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 10,
                total_tokens: 110,
              },
            });
      }
      const chunks = [
        { role: 'assistant', content: `Working, step ${n}.` },
        { tool_calls: agentToolCalls(n, count) },
      ];
      return payload.stream
        ? sse(res, chunks)
        : json(res, {
            id: 'chatcmpl-a',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'mock-model',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: `Working, step ${n}.`,
                  tool_calls: agentToolCalls(n, count),
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: {
              prompt_tokens: 500,
              completion_tokens: 100,
              total_tokens: 600,
            },
          });
    }

    const text = 'ok';
    return payload.stream
      ? sse(res, [{ role: 'assistant', content: text }])
      : json(res, {
          id: 'chatcmpl-o',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'mock-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: text },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        });
  });
});

server.setTimeout(0);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock listening on ${PORT}`);
});
