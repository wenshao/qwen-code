// Real Ink TUI captures (node-pty -> headless Chromium xterm.js) for PR 12688.
import { mkdirSync } from 'node:fs';
import { TerminalCapture } from '/root/verify/pr12688/head/integration-tests/terminal-capture/terminal-capture.ts';
import {
  ARMS, baseSettings, cliEnv, fakeToolCall, isAdvisorReq, prepareDirs,
  startFakeOpenAIServer, toolNames, toolResults, type J,
} from './lib.ts';

ARMS['fix'] = '/root/verify/pr12688/fix/dist/cli.js';
const OUT = '/root/verify/pr12688/shots';
mkdirSync(OUT, { recursive: true });
const only = process.env.ONLY?.split(',');
const SHA: Record<string, string> = { base: '90232f0 (base)', head: '3b49c69 (PR head)', fix: '3b49c69 + F1 patch' };

const ADVICE_TEXT =
  'The retry plan is sound, but cap the backoff: `attempt` grows without bound in `retry.ts`, so a flaky dependency can stall the task for minutes.\n\n- Add a maximum delay (for example 5 s).\n- Re-run the failing test before declaring completion.';
const ADVICE_JSON = {
  verdict: 'The retry plan is sound, with one gap.',
  risks: 'attempt grows without bound in retry.ts, so a flaky dependency can stall the task for minutes.',
  missingEvidence: 'No test covers the maximum delay.',
  recommendation: 'Add a maximum delay (for example 5 s) and re-run the failing test before declaring completion.',
};

function advisorReply(body: J) {
  // Honour whatever the arm asks for: base forces a structured-output
  // function; head asks for free text.
  const tools = toolNames(body);
  if (tools.length > 0) return { toolCalls: [fakeToolCall(tools[0]!, ADVICE_JSON)] };
  return { content: ADVICE_TEXT };
}

async function session(
  name: string,
  arm: string,
  opts: {
    settings?: J;
    handler: (body: J, server: { requests: { body: J }[] }) => unknown;
    steps: (t: TerminalCapture, server: { requests: { body: J }[] }) => Promise<void>;
    rows?: number;
    title: string;
    args?: string[];
    waitReady?: string;
  },
) {
  if (only && !only.includes(name)) return;
  const server = await startFakeOpenAIServer(async ({ body }) => (await opts.handler(body, server)) as never);
  const dirs = prepareDirs(`tui-${name}`, arm, {
    userSettings: baseSettings(server.baseUrl, { advisorModel: 'advisor-model', tools: { visible: ['advisor'] }, ...(opts.settings ?? {}) }),
  });
  const env = { ...cliEnv(dirs.home, server.baseUrl), FORCE_COLOR: '1', TERM: 'xterm-256color', NODE_NO_WARNINGS: '1' };
  const t = await TerminalCapture.create({
    cols: 112, rows: opts.rows ?? 34, cwd: dirs.ws, env, theme: 'github-dark' as never,
    chrome: true, title: `${SHA[arm]} — ${opts.title}`, outputDir: OUT, fontSize: 13,
  });
  try {
    await t.spawn('node', [ARMS[arm]!, '--no-chat-recording', '--yolo', '--auth-type', 'openai', '--model', 'executor-model', '--advisor', 'advisor-model', ...(opts.args ?? [])]);
    if (opts.waitReady !== '') await t.waitFor(opts.waitReady ?? 'Type your message', { timeout: 40000 });
    await opts.steps(t, server);
  } finally {
    const text = await t.getScreenText().catch(() => '');
    console.log(`----- ${name} ${arm} -----\n${text}`);
    await t.close();
    await server.close();
  }
}

async function send(t: TerminalCapture, text: string) {
  await t.type(text);
  await t.idle(400, 4000);
  await t.type('\r');
}

const executorAdvisorOnce = (body: J) => {
  if (isAdvisorReq(body)) return advisorReply(body);
  if (body['stream'] !== true) return { content: '{}' };
  if (toolResults(body).length > 0) return { content: 'Advice received — continuing: adding a 5 s cap to the backoff and re-running the test.' };
  return { content: "I'll get a second opinion before editing.", toolCalls: [fakeToolCall('advisor', {}, 'adv-1')] };
};

for (const arm of ['base', 'head']) {
  // T1 — the same advice, structured (base) vs free text (head).
  await session('t1-advice', arm, {
    title: 'Advisor result card',
    rows: 46,
    handler: executorAdvisorOnce,
    steps: async (t) => {
      await send(t, 'Plan the retry change, then continue.');
      await t.waitFor('Advice received', { timeout: 30000 });
      await t.idle(800, 8000);
      await t.capture(`t1-advice-${arm}.png`);
    },
  });

  // T3 — header while the Advisor request is in flight.
  let release: () => void = () => {};
  const hold = new Promise<void>((r) => (release = r));
  await session('t3-header', arm, {
    title: 'header while the Advisor request is in flight (ui.useTerminalBuffer)',
    rows: 30,
    settings: { ui: { enableFollowupSuggestions: false, useTerminalBuffer: true } },
    handler: async (body) => {
      if (isAdvisorReq(body)) { await hold; return advisorReply(body); }
      return executorAdvisorOnce(body);
    },
    steps: async (t, server) => {
      await send(t, 'Plan the retry change, then continue.');
      const t0 = Date.now();
      while (!server.requests.some((q) => isAdvisorReq(q.body)) && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 3500));
      await t.capture(`t3-header-${arm}.png`);
      release();
      await t.waitFor('Advice received', { timeout: 30000 });
    },
  });
}

// T2 — head: one-use limit, second consultation refused, executor continues,
// then `/advisor` reports the count.
await session('t2-limit', 'head', {
  title: 'advisorMaxUses: 1',
  rows: 40,
  settings: { advisorMaxUses: 1 },
  handler: (body) => {
    if (isAdvisorReq(body)) return advisorReply(body);
    if (body['stream'] !== true) return { content: '{}' };
    const n = toolResults(body).length;
    if (n >= 2) return { content: 'Advisor limit reached — continuing on my own and finishing the change.' };
    return { content: n === 0 ? 'Consulting before editing.' : 'Consulting again before declaring completion.', toolCalls: [fakeToolCall('advisor', {}, `adv-${n}`)] };
  },
  steps: async (t, server) => {
    await send(t, 'Make the change, consulting as needed.');
    await t.waitFor('continuing on my own', { timeout: 30000 });
    await t.idle(800, 8000);
    await t.capture('t2-limit-head.png');
    await send(t, '/advisor');
    await t.waitFor('Select Advisor Model', { timeout: 20000 });
    await t.idle(800, 8000);
    await t.capture('t2-picker-head.png');
    console.log('t2 advisor requests =', server.requests.filter((q) => isAdvisorReq(q.body)).length);
  },
});

// T4 — invalid advisorMaxUses in user settings: head refuses to start,
// head + F1 patch starts and warns.
for (const arm of ['head', 'fix']) {
  await session('t4-invalid', arm, {
    title: 'user settings "advisorMaxUses": -1',
    rows: 24,
    settings: { advisorMaxUses: -1 },
    handler: () => ({ content: 'unused' }),
    waitReady: arm === 'head' ? 'advisorMaxUses' : 'Type your message',
    steps: async (t) => {
      await t.idle(1500, 10000);
      await t.capture(`t4-invalid-${arm}.png`);
    },
  });
}
