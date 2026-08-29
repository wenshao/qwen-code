#!/usr/bin/env node
/**
 * Scriptable OpenAI-compatible mock model for PR #10083 verification.
 *
 * Reactive: it inspects the conversation the CLI sends and picks the next
 * scripted assistant turn from a plan file. Every request/response pair is
 * appended to a JSONL transcript so assertions can run on real wire data.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.MOCK_PORT || 8731);
const PLAN_PATH = process.env.MOCK_PLAN;
const LOG = process.env.MOCK_LOG || '/tmp/mock-model.jsonl';

const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
let step = 0;

function log(obj) {
  fs.appendFileSync(LOG, JSON.stringify(obj) + '\n');
}

function sseChunk(id, model, delta, finish) {
  return (
    'data: ' +
    JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    }) +
    '\n\n'
  );
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (!req.url.includes('chat/completions')) {
      res.writeHead(404).end('{}');
      return;
    }
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch (e) {}
    const msgs = parsed.messages || [];
    // Only the *main* session drives the script. Teammate/sub-agent sessions
    // get an immediate, inert stop so they never consume script steps.
    const isMain = JSON.stringify(msgs).includes('__PR10083_MAIN__');

    const model = parsed.model || 'mock-model';
    const id = 'chatcmpl-mock-' + Date.now();

    let turn;
    if (!isMain) {
      // Keep sub-sessions (teammate + background agent) alive so the
      // destination probes run against a *running* task, not a finished one.
      const blob = JSON.stringify(msgs);
      if (process.env.MOCK_KEEP_SUBAGENTS_ALIVE === '1' && !blob.includes('sleep 90')) {
        turn = {
          text: 'starting',
          tool_calls: [{ name: 'run_shell_command', args: { command: 'sleep 90' } }],
        };
      } else {
        turn = { text: 'ok' };
      }
    } else {
      turn = plan.turns[Math.min(step, plan.turns.length - 1)] || { text: 'done' };
      step += 1;
      // Late-bind {{TASK_ID}} to the most recent background-task id the CLI
      // reported back in a tool result.
      if (JSON.stringify(turn).includes('{{TASK_ID}}')) {
        const blob = JSON.stringify(msgs);
        const ids = [...blob.matchAll(/task_id: ([A-Za-z0-9_.@-]+)/g)].map((m) => m[1]);
        const id = ids.length ? ids[ids.length - 1] : 'UNRESOLVED';
        turn = JSON.parse(JSON.stringify(turn).split('{{TASK_ID}}').join(id));
      }
    }

    log({
      t: new Date().toISOString(),
      isMain,
      step: isMain ? step - 1 : null,
      lastMessages: msgs.slice(-4),
      chosen: turn,
    });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(sseChunk(id, model, { role: 'assistant', content: '' }));
    if (turn.text) {
      res.write(sseChunk(id, model, { content: turn.text }));
    }
    if (turn.tool_calls) {
      turn.tool_calls.forEach((tc, i) => {
        res.write(
          sseChunk(id, model, {
            tool_calls: [
              {
                index: i,
                id: tc.id || 'call_' + Date.now() + '_' + i,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.args),
                },
              },
            ],
          }),
        );
      });
      res.write(sseChunk(id, model, {}, 'tool_calls'));
    } else {
      res.write(sseChunk(id, model, {}, 'stop'));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('mock model listening on ' + PORT + ' plan=' + PLAN_PATH);
});
