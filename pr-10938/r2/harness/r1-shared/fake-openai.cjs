#!/usr/bin/env node
// OpenAI-compatible mock for PR 10938 (Session Workflow DAG / inspector).
// The real daemon's main turn gets a scripted plan:
//   1st main request  -> todo_write with a dependency plan (scenario-chosen)
//   2nd main request  -> N background `agent` calls linked by todo_id
//   later requests    -> short text (also answers background notifications)
// Scenario is chosen by `__SCN:<NAME>__` in a user message:
//   DAG   5-step, 3-layer diamond; 8 agent runs (ok / hold / fail) so the node
//         faces show agent counts + runtime, one node needs attention, and the
//         inspector's activity list overflows its 6-row preview.
//   BIG   50 steps, 525 dependencies (> MAX_RENDERED_PLAN_EDGES = 500), no agents.
// Subagent requests are recognised by `__SUB:<mode>:<ms>__` in their prompt:
//   ok   sleep ms, then a text answer (task completes)
//   hold never answer (task stays running)
//   fail HTTP 400 (task fails -> node attention)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 4938);
const OUT = process.env.OUT || path.join(__dirname, 'out', 'mock');
fs.mkdirSync(OUT, { recursive: true });
const REQLOG = path.join(OUT, 'requests.jsonl');
let seq = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const textOf = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('')
      : '';
const log = (o) =>
  fs.appendFileSync(REQLOG, JSON.stringify({ t: Date.now(), ...o }) + '\n');

const todo = (id, content, status, blockedBy) => ({
  id,
  content,
  status,
  ...(blockedBy ? { blockedBy } : {}),
});

const PLANS = {
  DAG: [
    todo('survey-api', 'Survey the public API surface', 'completed'),
    todo('read-tests', 'Read the existing test suite', 'in_progress'),
    todo('check-docs', 'Check the docs for stale examples', 'in_progress'),
    todo(
      'compare-findings',
      'Compare findings and draft the migration plan',
      'pending',
      ['survey-api', 'read-tests'],
    ),
    todo('write-summary', 'Write the migration summary', 'pending', [
      'compare-findings',
      'check-docs',
    ]),
  ],
  NEST: [
    todo('nest-step', 'Probe nested agents', 'in_progress'),
    todo('follow-up', 'Follow up on the nested result', 'pending', ['nest-step']),
  ],
  BIG: (() => {
    const roots = Array.from({ length: 25 }, (_, i) =>
      todo(`root-${i + 1}`, `Inventory module ${i + 1}`, i < 5 ? 'completed' : 'pending'),
    );
    const leaves = Array.from({ length: 25 }, (_, i) =>
      todo(
        `leaf-${i + 1}`,
        `Migrate consumer ${i + 1}`,
        'pending',
        roots.slice(i % 4, (i % 4) + 21).map((r) => r.id),
      ),
    );
    return [...roots, ...leaves];
  })(),
};

// description, todo_id, mode, ms
const AGENTS = {
  DAG: [
    ['Map exported symbols', 'survey-api', 'ok', 1500],
    ['List deprecated entry points', 'survey-api', 'ok', 2500],
    ['Diff API against v1', 'survey-api', 'ok', 3500],
    ['Read unit tests', 'read-tests', 'ok', 2000],
    ['Read integration tests', 'read-tests', 'ok', 4000],
    ['Profile slow suites', 'read-tests', 'hold', 0],
    ['Scan README examples', 'check-docs', 'fail', 0],
    ['Scan guide snippets', 'check-docs', 'ok', 3000],
  ],
  BIG: [],
  NEST: [['Parent agent', 'nest-step', 'nest', 0]],
};

function classify(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const users = msgs.filter((m) => m.role === 'user').map((m) => textOf(m.content));
  const all = users.join('\n');
  const sub = all.match(/__SUB:([a-z]+):(\d+)__/);
  const scn = all.match(/__SCN:([A-Z0-9_]+)__/);
  const toolNames = (body.tools || []).map((t) => t.function?.name).filter(Boolean);
  const calls = msgs
    .filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
    .flatMap((m) => m.tool_calls.map((c) => c.function?.name));
  return { msgs, users, sub, scn: scn?.[1], toolNames, calls };
}

let callSeq = 0;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    if (req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] }));
      return;
    }
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {}
    const id = ++seq;
    const c = classify(body);
    const model = body.model || 'fake-model';
    const chunkId = 'chatcmpl-' + id;

    const json = (obj) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (body.stream !== true) {
      log({ id, kind: 'side-query' });
      return json({
        id: chunkId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'Mock title' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      });
    }

    const frame = (delta, finish, usage) =>
      `data: ${JSON.stringify({
        id: chunkId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: usage ? [] : [{ index: 0, delta, finish_reason: finish ?? null }],
        ...(usage ? { usage } : {}),
      })}\n\n`;
    const open = () =>
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const end = (reason) => {
      res.write(frame({}, reason));
      res.write(frame(null, null, { prompt_tokens: 1200, completion_tokens: 40, total_tokens: 1240 }));
      res.write('data: [DONE]\n\n');
      res.end();
    };
    const say = async (text) => {
      open();
      res.write(frame({ role: 'assistant', content: '' }));
      for (const p of text.match(/[\s\S]{1,16}/g) || []) {
        res.write(frame({ content: p }));
        await sleep(5);
      }
      end('stop');
    };
    const toolCalls = (list) => {
      open();
      res.write(frame({ role: 'assistant', content: '' }));
      list.forEach(([name, args], index) => {
        res.write(
          frame({
            tool_calls: [
              {
                index,
                id: `call_${++callSeq}_${name}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          }),
        );
      });
      end('tool_calls');
    };

    if (c.sub) {
      const [, mode, ms] = c.sub;
      log({ id, kind: 'subagent', mode, ms: Number(ms) });
      if (mode === 'hold') return new Promise(() => {});
      if (mode === 'nest') {
        // A subagent that spawns a nested foreground agent which never returns,
        // so both the parent and the nested child stay live.
        const nestedCalls = c.calls.filter((x) => x === 'agent').length;
        log({ id, kind: 'subagent-nest', hasAgentTool: c.toolNames.includes('agent'), nestedCalls, tools: c.toolNames.length });
        if (c.toolNames.includes('agent') && nestedCalls === 0) {
          return toolCalls([['agent', { description: 'Nested probe', prompt: 'Nested probe. __SUB:hold:0__', subagent_type: 'general-purpose', run_in_background: false }]]);
        }
        return new Promise(() => {});
      }
      if (mode === 'fail') {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(
          JSON.stringify({ error: { message: 'mock: subagent request rejected', type: 'invalid_request_error', code: 'mock_rejected' } }),
        );
      }
      await sleep(Number(ms));
      return say('Subagent finished: nothing blocking found.');
    }

    const scn = c.scn;
    const plan = scn && PLANS[scn];
    log({ id, kind: 'main', scn, tools: c.toolNames.length, calls: c.calls });
    const count = (n) => c.calls.filter((x) => x === n).length;
    const has = (n) => c.toolNames.includes(n);
    // The real Plan & Review flow: enter plan mode, write the dependency plan,
    // ask for approval, then (approved) mark progress and launch linked agents.
    if (plan && has('enter_plan_mode') && count('enter_plan_mode') === 0 && count('todo_write') === 0) {
      return toolCalls([['enter_plan_mode', { userRequested: true }]]);
    }
    if (plan && has('todo_write') && count('todo_write') === 0) {
      return toolCalls([['todo_write', { todos: plan.map((t) => ({ ...t, status: 'pending' })) }]]);
    }
    if (plan && has('exit_plan_mode') && count('exit_plan_mode') === 0) {
      const md = ['## Plan', ...plan.slice(0, 12).map((t, i) => `${i + 1}. ${t.content}`)].join('\n');
      return toolCalls([['exit_plan_mode', { plan: md }]]);
    }
    if (plan && has('todo_write') && count('todo_write') === 1) {
      return toolCalls([['todo_write', { todos: plan }]]);
    }
    const agents = scn ? AGENTS[scn] || [] : [];
    if (plan && has('agent') && agents.length && count('agent') === 0) {
      return toolCalls(
        agents.map(([description, todo_id, mode, ms]) => [
          'agent',
          {
            description,
            todo_id,
            subagent_type: 'general-purpose',
            run_in_background: true,
            prompt: `${description}. __SUB:${mode}:${ms}__`,
          },
        ]),
      );
    }
    return say(plan ? 'The plan is running; I will report back as steps finish.' : 'OK.');
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`mock listening ${PORT} out=${OUT}`));
