// Real TUI run of /batch-api at PR #12492 head: scripted fake agent model +
// fake DashScope Batch API. The CLI under test is the built bundle launched
// through scripts/cli-entry.js (so QWEN_CODE_CLI is stamped the way an
// installed launch stamps it). No real network, no real keys.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { TerminalCapture } from './terminal-capture.mts';
import {
  startFakeOpenAIServer,
  fakeToolCall,
} from '/root/verify/pr12492/head/integration-tests/fake-openai-server.js';

const ARM = process.env['ARM'] ?? 'head';
const ROOT = `/root/verify/pr12492/${ARM}`;
const VARIANT = process.env['VARIANT'] ?? 'main';
const OUT = `/root/verify/pr12492/tui/out-${ARM}-${VARIANT}`;
const WORK = `/root/verify/pr12492/tui/work-${ARM}-${VARIANT}`;
fs.rmSync(WORK, { recursive: true, force: true });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const HOME = path.join(WORK, 'home');
const PROJ = path.join(WORK, 'proj');
fs.mkdirSync(path.join(HOME, '.qwen'), { recursive: true });
fs.mkdirSync(path.join(PROJ, 'docs/zh'), { recursive: true });
for (const n of ['01', '02', '03']) {
  fs.writeFileSync(
    path.join(PROJ, `docs/zh/notice-${n}.md`),
    `# 维护通知 ${n}\n\n标识：TEST-${n}\n\n本周六凌晨 2 点至 4 点，构建服务例行维护。\n`,
  );
}
if (process.env['PRESEED_RULE']) {
  fs.mkdirSync(path.join(PROJ, '.qwen'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, '.qwen/settings.json'), JSON.stringify({ permissions: { allow: [process.env['PRESEED_RULE']] } }, null, 2));
}
execSync(
  'git init -q . && git -c user.email=v@x -c user.name=v add -A && git -c user.email=v@x -c user.name=v commit -qm init',
  { cwd: PROJ },
);

// ── fake DashScope Batch API ────────────────────────────────────────────
const log: string[] = [];
const files = new Map<string, string>();
const jobs = new Map<string, Record<string, unknown>>();
let nextFile = 1;
let nextJob = 1;
const SETTLE_MS = Number(process.env['SETTLE_MS'] ?? 15000);
const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
function settle(job: Record<string, unknown>) {
  const input = files.get(job['input_file_id'] as string) ?? '';
  const out: string[] = [];
  for (const raw of input.split('\n')) {
    if (!raw.trim().startsWith('{')) continue;
    const line = JSON.parse(raw);
    const src: string = line.body.messages.at(-1).content;
    const doc = /<document path="[^"]*">\n([\s\S]*)\n<\/document>/.exec(src);
    const zh = doc ? doc[1] : src;
    const id = /TEST-\d+/.exec(zh)?.[0] ?? 'TEST-??';
    const n = id.slice(5);
    out.push(
      JSON.stringify({
        custom_id: line.custom_id,
        response: {
          status_code: 200,
          body: {
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: `# Maintenance notice ${n}\n\nID: ${id}\n\nThe build service has routine maintenance this Saturday from 02:00 to 04:00.\n`,
                },
              },
            ],
            usage: { prompt_tokens: 120, completion_tokens: 40 },
          },
        },
      }),
    );
  }
  const outId = `file-out-${nextFile++}`;
  files.set(outId, out.join('\n') + '\n');
  Object.assign(job, {
    status: 'completed',
    output_file_id: outId,
    completed_at: Math.floor(Date.now() / 1000),
    request_counts: { total: out.length, completed: out.length, failed: 0 },
  });
}
const batchServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const send = (code: number, obj: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  log.push(`${new Date().toISOString()} ${req.method} ${url.pathname}${url.search} auth=${req.headers.authorization === 'Bearer fake-batch-key' ? 'ok' : 'BAD'}`);
  const body = await readBody(req);
  if (req.method === 'POST' && url.pathname === '/v1/files') {
    const id = `file-in-${nextFile++}`;
    files.set(id, body);
    return send(200, { id });
  }
  if (req.method === 'POST' && url.pathname === '/v1/batches') {
    const b = JSON.parse(body);
    const id = `batch_${String(nextJob++).padStart(4, '0')}`;
    const lines = (files.get(b.input_file_id) ?? '').split('\n').filter((l) => l.trim().startsWith('{')).length;
    const job = {
      id,
      status: 'in_progress',
      created_at: Math.floor(Date.now() / 1000),
      input_file_id: b.input_file_id,
      request_counts: { total: lines, completed: 0, failed: 0 },
      _createdMs: Date.now(),
    };
    jobs.set(id, job);
    const { _createdMs, ...pub } = job;
    return send(200, pub);
  }
  if (req.method === 'GET' && url.pathname === '/v1/batches') {
    return send(200, { data: [...jobs.values()], has_more: false });
  }
  let m = /^\/v1\/batches\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && m) {
    const job = jobs.get(m[1]);
    if (!job) return send(404, { error: 'no such batch' });
    if (job['status'] === 'in_progress' && Date.now() - (job['_createdMs'] as number) >= SETTLE_MS) settle(job);
    const { _createdMs, ...pub } = job;
    return send(200, pub);
  }
  m = /^\/v1\/files\/([^/]+)\/content$/.exec(url.pathname);
  if (req.method === 'GET' && m) {
    const f = files.get(m[1]);
    if (f === undefined) return send(404, { error: 'no such file' });
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end(f);
  }
  m = /^\/v1\/files\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'DELETE' && m) {
    files.delete(m[1]);
    return send(200, { id: m[1], deleted: true });
  }
  return send(404, { error: `unhandled ${req.method} ${url.pathname}` });
});
await new Promise<void>((r) => batchServer.listen(0, '127.0.0.1', () => r()));
const batchPort = (batchServer.address() as { port: number }).port;

// ── fake agent model: scripted /batch-api SKILL steps ───────────────────
const CLI = '"${QWEN_CODE_CLI:-qwen}"';
const PLAN = '.qwen/batch/plans/notice-en.json';
const planJson = JSON.stringify(
  {
    version: 1,
    name: 'notice-en',
    kind: 'document-transform',
    shared: {
      instructions:
        'Translate the Markdown document inside <document> from Simplified Chinese to English. Keep TEST-XX identifiers verbatim. Return ONLY the translated document.',
    },
    items: ['01', '02', '03'].map((n) => ({
      id: `n${n}`,
      source: `docs/zh/notice-${n}.md`,
      target: `docs/en/notice-${n}.md`,
    })),
  },
  null,
  2,
);
type Msg = { role: string; content?: unknown; tool_call_id?: string };
const text = (c: unknown): string =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('')
      : '';
const mainReqs: string[] = [];
const model = await startFakeOpenAIServer(({ body }) => {
  const tools = (body['tools'] as Array<{ function?: { name?: string } }> | undefined) ?? [];
  const isMain = tools.some((t) => t.function?.name === 'run_shell_command');
  if (!isMain) return { content: 'Batch translate notices' };
  const messages = body['messages'] as Msg[];
  // Everything after the last genuine user message.
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUser = i;
      break;
    }
  }
  const userText = text(messages[lastUser]?.content);
  const done = new Map<string, string>();
  for (const m of messages.slice(lastUser + 1)) {
    if (m.role === 'tool' && m.tool_call_id) done.set(m.tool_call_id, text(m.content));
  }
  const all = new Map<string, string>();
  for (const m of messages) if (m.role === 'tool' && m.tool_call_id) all.set(m.tool_call_id, text(m.content));
  const tc = (id: string, name: string, args: Record<string, unknown>) => {
    const call = fakeToolCall(name, args);
    call.id = id;
    return call;
  };
  if (userText.includes('<task-notification')) {
    mainReqs.push('notification');
    if (!done.has('call_verify'))
      return { toolCalls: [tc('call_verify', 'read_file', { file_path: path.join(PROJ, 'docs/en/notice-02.md') })], finishReason: 'tool_calls' };
    const summary = /task notice-en-[^\n]*/.exec(userText)?.[0] ?? '(summary not found)';
    return {
      content:
        `The batch finished and the waiter collected it:\n\n\`${summary}\`\n\n` +
        `I spot-checked docs/en/notice-02.md — the TEST-02 identifier is preserved. ` +
        `Nothing failed or was held, so there is nothing to retry.`,
    };
  }
  const steps: Array<[string, () => unknown]> = [
    ['call_help', () => tc('call_help', 'run_shell_command', { command: `${CLI} batch --help`, is_background: false, description: 'Confirm this CLI has the batch subcommands' })],
    ['call_check', () => tc('call_check', 'run_shell_command', { command: `${CLI} batch check`, is_background: false, description: 'Check Batch readiness (no billed request)' })],
    ['call_glob', () => tc('call_glob', 'glob', { pattern: 'docs/zh/*.md' })],
    ['call_read', () => tc('call_read', 'read_file', { file_path: path.join(PROJ, 'docs/zh/notice-01.md') })],
    ['call_write', () => tc('call_write', 'write_file', { file_path: path.join(PROJ, PLAN), content: planJson + '\n' })],
    ['call_dry', () => tc('call_dry', 'run_shell_command', { command: `${CLI} batch run ${PLAN} --dry-run`, is_background: false, description: 'Preview the batch (uploads nothing)' })],
    ['call_run', () => {
      const digest = /--expect ([0-9a-f]{16})/.exec(all.get('call_dry') ?? '')?.[1] ?? 'MISSING';
      return tc('call_run', 'run_shell_command', { command: `${CLI} batch run ${PLAN} --expect ${digest}`, is_background: false, description: 'Submit exactly the previewed batch (billed)' });
    }],
    ['call_wait', () => {
      const task = /task (notice-en-[0-9-]+)/.exec(all.get('call_run') ?? '')?.[1] ?? 'MISSING';
      return tc('call_wait', 'run_shell_command', { command: `${CLI} batch collect ${task} --wait`, is_background: true, description: 'Wait for the batch in the background' });
    }],
  ];
  for (const [id, make] of steps) {
    if (!done.has(id)) {
      mainReqs.push(id);
      if (id === 'call_run') {
        const preview = (all.get('call_dry') ?? '').trim();
        return {
          content: `Here is the preview — nothing has been uploaded or billed yet:\n\n\`\`\`\n${preview}\n\`\`\`\n\nApproving the next command submits exactly this snapshot.`,
          toolCalls: [make() as ReturnType<typeof fakeToolCall>],
          finishReason: 'tool_calls',
        };
      }
      return { toolCalls: [make() as ReturnType<typeof fakeToolCall>], finishReason: 'tool_calls' };
    }
  }
  mainReqs.push('final');
  return {
    content:
      'Submitted. The waiter is polling the Batch API in the background (see /tasks); I will report when the results arrive.',
  };
});

// ── settings for the isolated session ──────────────────────────────────
fs.writeFileSync(
  path.join(HOME, '.qwen/settings.json'),
  JSON.stringify(
    {
      security: { auth: { selectedType: 'openai' } },
      model: { name: 'fake-agent' },
      modelProviders: {
        openai: [
          { id: 'fake-agent', name: 'fake-agent', baseUrl: model.baseUrl, envKey: 'FAKE_AGENT_KEY' },
          { id: 'qwen3.7-plus', name: 'qwen3.7-plus', baseUrl: `http://127.0.0.1:${batchPort}/v1`, envKey: 'FAKE_BATCH_KEY', generationConfig: { extra_body: { enable_thinking: false } } },
        ],
      },
      env: { FAKE_AGENT_KEY: 'fake-agent-key', FAKE_BATCH_KEY: 'fake-batch-key' },
      batch: { model: 'qwen3.7-plus' },
      general: { language: 'en', enableAutoUpdate: false },
      ui: { hideTips: true },
      privacy: { usageStatisticsEnabled: false },
    },
    null,
    2,
  ),
);
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
for (const k of ['NO_COLOR', 'QWEN_CODE_SIMPLE', 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'QWEN_CODE_CLI', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL'])
  delete env[k];
Object.assign(env, {
  HOME,
  USERPROFILE: HOME,
  QWEN_HOME: path.join(HOME, '.qwen'),
  QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(HOME, 'system-settings.json'),
  QWEN_SANDBOX: 'false',
  QWEN_CODE_NO_RELAUNCH: '1',
  TERM: 'xterm-256color',
  FORCE_COLOR: '1',
  NODE_NO_WARNINGS: '1',
});

const t = await TerminalCapture.create({ cols: 130, rows: 46, cwd: PROJ, env, theme: 'github-dark' as never, chrome: false, outputDir: OUT, title: `qwen-code ${ARM}` });
const shot = async (name: string) => {
  await t.capture(`${name}.png`);
  fs.writeFileSync(path.join(OUT, `${name}.txt`), await t.getScreenText());
};
const approve = async (label: string) => {
  // Wait for an approval prompt, capture it, then choose "Yes, allow once".
  await t.waitFor('Yes, allow once', { timeout: 60000 });
  await t.idle(600, 8000);
  await shot(label);
  await t.type('\r');
  await t.idle(800, 10000);
};
const approveUntil = async (marker: string, labelFor: (screen: string) => string | undefined, max = 12) => {
  for (let i = 0; i < max; i++) {
    const screen = await t.getScreenText();
    if (screen.includes(marker) && !screen.includes('Yes, allow once')) return;
    if (screen.includes('Yes, allow once')) {
      const label = labelFor(screen);
      if (label) await shot(label);
      await t.type('\r');
      await t.idle(800, 10000);
      continue;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
};
try {
  if ((process.env['MODE'] ?? '') === 'autocollect') {
    fs.mkdirSync(path.join(PROJ, '.qwen/batch/plans'), { recursive: true });
    fs.writeFileSync(path.join(PROJ, PLAN), planJson);
    const { execFile } = await import('node:child_process');
    const out = await new Promise<string>((resolve, reject) => execFile('node', [`${ROOT}/scripts/cli-entry.js`, 'batch', 'run', PLAN], { cwd: PROJ, env }, (e, so, se) => (e ? reject(new Error(`${e.message}\n${se}`)) : resolve(so + se))));
    fs.writeFileSync(path.join(OUT, 'autocollect-run.txt'), out);
    // The terminal that ran it is gone; the batch settles while no session is open.
    await new Promise((r) => setTimeout(r, SETTLE_MS + 1000));
    log.push('--- session starts ---');
  }
  await t.spawn('node', [`${ROOT}/scripts/cli-entry.js`, '--approval-mode', 'default']);
  await t.waitFor('Type your message', { timeout: 60000 });
  await t.idle(1000, 10000);
  const MODE = process.env['MODE'] ?? 'skill';
  if (MODE === 'nonuser') {
    await t.type('hello', { slow: true } as never);
    await t.idle(400, 4000);
    await t.type('\r');
    await t.idle(1500, 20000);
    const t0 = Date.now();
    while (Date.now() - t0 < 70000) await new Promise((r) => setTimeout(r, 1000));
    await shot('nonuser-after-70s');
    fs.writeFileSync(path.join(OUT, 'nonuser.txt'), `batch home exists: ${fs.existsSync(path.join(HOME, '.qwen/batch'))}\nbatch server requests: ${log.length}\n`);
    throw new Error('MODE_DONE');
  }
  if (MODE === 'autocollect') {
    await t.waitFor('result(s) delivered', { timeout: 120000 });
    await t.idle(800, 8000);
    await shot('autocollect-notice');
    throw new Error('MODE_DONE');
  }
  await t.type('/batch-api translate docs/zh/*.md into English under docs/en/', { slow: true } as never);
  await t.idle(500, 5000);
  await shot('00-typed');
  await t.type('\r');
  // Approve every prompt; record which commands prompted at all.
  const ALWAYS = process.env['ALWAYS'] === '1';
  const prompted: string[] = [];
  let first = true;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const screen = await t.getScreenText();
    if (screen.includes('I will report') && !screen.includes('Yes, allow once')) break;
    if (!screen.includes('Yes, allow once')) continue;
    await t.idle(600, 8000);
    const s = await t.getScreenText();
    const q = s.slice(s.lastIndexOf('? '));
    const which = q.includes('--expect') ? 'run --expect (PAID)' : q.includes('--dry-run') ? 'run --dry-run' : q.includes('batch check') ? 'batch check' : q.includes('batch --help') ? 'batch --help' : q.includes('collect') ? 'collect --wait' : q.includes('WriteFile') || q.includes('notice-en.json') ? 'write plan' : 'other';
    prompted.push(which);
    const tag = ALWAYS ? 'always-' : '';
    if (which === 'run --expect (PAID)') await shot(`${tag}02-approve-paid-submit`);
    else if (which === 'run --dry-run') await shot(`${tag}01-approve-dry-run`);
    else if (which === 'batch check') await shot(`${tag}00b-approve-check`);
    else if (which === 'batch --help') await shot(`${tag}00a-approve-help`);
    else if (which === 'collect --wait') await shot(`${tag}03-approve-background-wait`);
    if (ALWAYS && first && which === 'batch --help') {
      await t.type('\u001b[B');
      await t.idle(300, 3000);
      await shot('always-00a-choose-always');
      await t.type('\r');
    } else {
      await t.type('\r');
    }
    first = false;
    await t.idle(800, 10000);
  }
  fs.writeFileSync(path.join(OUT, 'prompted.txt'), prompted.join('\n') + '\n');
  console.log('prompted:', prompted.join(' | '));
  await t.waitFor('I will report', { timeout: 60000 });
  await t.idle(800, 8000);
  await shot('04-submitted-composer-free');
  await t.type('/tasks');
  await t.idle(400, 4000);
  await t.type('\r');
  await t.idle(800, 8000);
  await shot('05-tasks-panel');
  await t.type('\u001b');
  await t.idle(500, 4000);
  // Wait for the waiter to finish and the agent to be woken.
  await t.waitFor('Nothing failed', { timeout: 180000 });
  await t.idle(1000, 10000);
  await shot('06-woken-report');
  await t.captureFull('07-full-transcript.png');
} catch (error) {
  console.error('SCENARIO ERROR', error);
  await t.capture('ERR.png').catch(() => {});
  fs.writeFileSync(path.join(OUT, 'ERR.txt'), await t.getScreenText().catch(() => ''));
} finally {
  fs.writeFileSync(path.join(OUT, 'batch-server.log'), log.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'model-steps.txt'), mainReqs.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'raw.ansi'), t.getRawOutput());
  // Model-visible skill listing (first main request) for the invocation check.
  const first = model.requests.find((r) => ((r.body['tools'] as unknown[]) ?? []).length > 0);
  fs.writeFileSync(path.join(OUT, 'first-main-request.json'), JSON.stringify(first?.body ?? {}, null, 1));
  await t.close();
  batchServer.close();
  await model.close?.();
  const delivered = fs.existsSync(path.join(PROJ, 'docs/en')) ? fs.readdirSync(path.join(PROJ, 'docs/en')) : [];
  console.log('delivered:', delivered.join(', '));
  console.log('git status:', execSync('git status --short', { cwd: PROJ }).toString() || '(clean)');
  console.log('model steps:', mainReqs.join(' → '));
  process.exit(0);
}
