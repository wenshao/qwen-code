// Shared harness for PR #12492 R3 finding reproductions.
// Fake DashScope Batch API (derived from docs/verification/batch-api/workflow-e2e.mjs)
// + an isolated CLI runner. Every script is launched by run-all.sh inside
// `unshare -mn` (private network namespace with only `lo`), so the CLI
// physically cannot reach a real endpoint.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const CLI = process.env.CLI ?? '/root/verify/pr12492/head/dist/cli.js';
export const SCRATCH = process.env.SCRATCH ?? '/root/verify/pr12492/r3-repro/scratch';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * hooks (all optional):
 *  resultFor(line) -> body override object {finish_reason, content} | {status_code, body}
 *  transformOutput(lines:string[], job) -> string (final file text)
 *  errorLinesFor(job) -> string[] error-file lines
 *  requestCounts(job, outLines) -> request_counts
 *  deleteStatus(fileId) -> number|undefined (non-2xx fails)
 *  createStatus(createNo) -> number|undefined
 *  downloadStatus(fileId) -> number|undefined
 *  getStatus(jobId, pollNo) -> number|undefined
 */
export async function startFake(hooks = {}, opts = {}) {
  const state = {
    files: new Map(),
    jobs: new Map(),
    polls: new Map(),
    deleted: [],
    log: [],
    nextFile: 1,
    nextJob: 1,
    creates: 0,
    behavior: 'auto', // 'auto' settles on the first GET; 'stay' never
    hooks,
    uploads: [], // raw JSONL lines per upload
    chat: [], // realtime /chat/completions bodies
  };
  function settle(job) {
    job.status = 'completed';
    job.completed_at = Math.floor(Date.now() / 1000);
    const input = state.files.get(job.input_file_id);
    const outLines = [];
    for (const raw of input.split('\n')) {
      if (!raw.trim().startsWith('{')) continue;
      const line = JSON.parse(raw);
      const customId = line.custom_id;
      const src = line.body.messages.at(-1).content;
      const docMatch = src.match(/<document path="[^"]*">\n([\s\S]*)\n<\/document>/);
      const override = state.hooks.resultFor?.(line);
      const content = override?.content ?? `TRANSLATED(${line.body.model}): ${docMatch ? docMatch[1] : src}`;
      outLines.push(
        JSON.stringify({
          custom_id: customId,
          response: {
            status_code: override?.status_code ?? 200,
            body: override?.body ?? {
              choices: [
                {
                  finish_reason: override?.finish_reason ?? 'stop',
                  message: { role: 'assistant', content },
                },
              ],
              usage: { prompt_tokens: 50, completion_tokens: 10 },
            },
          },
        }),
      );
    }
    const text = state.hooks.transformOutput
      ? state.hooks.transformOutput(outLines, job)
      : outLines.join('\n') + '\n';
    const outId = `file-${state.nextFile++}`;
    state.files.set(outId, text);
    job.output_file_id = outId;
    const errLines = state.hooks.errorLinesFor?.(job);
    if (errLines && errLines.length) {
      const errId = `file-${state.nextFile++}`;
      state.files.set(errId, errLines.join('\n') + '\n');
      job.error_file_id = errId;
    }
    job.request_counts = state.hooks.requestCounts
      ? state.hooks.requestCounts(job, outLines)
      : { total: outLines.length, completed: outLines.length, failed: 0 };
  }
  const handler = async (req, res) => {
    const url = new URL(req.url.replace(/^\/compatible-mode/, ''), 'http://x');
    const send = (code, obj) => {
      state.log.push(`${req.method} ${url.pathname} -> ${code}`);
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      state.chat.push({ host: req.headers.host, body });
      state.log.push(`POST ${url.pathname} (host ${req.headers.host}, stream=${body.stream})`);
      const msg = { role: 'assistant', content: 'hi' };
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const base = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: body.model };
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: msg, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } })}\n\n`);
        return res.end('data: [DONE]\n\n');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 'c1', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: msg, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }));
    }
    if (req.method === 'POST' && url.pathname === '/v1/files') {
      const body = (await readBody(req)).toString('utf8');
      const id = `file-${state.nextFile++}`;
      state.files.set(id, body);
      state.uploads.push(body.split('\n').filter((l) => l.trim().startsWith('{')));
      return send(200, { id });
    }
    if (req.method === 'POST' && url.pathname === '/v1/batches') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      state.creates += 1;
      const refuse = state.hooks.createStatus?.(state.creates);
      if (refuse) return send(refuse, { error: { message: `fake refusal #${state.creates}` } });
      const id = `batch-${state.nextJob++}`;
      const job = {
        id,
        status: 'in_progress',
        created_at: Math.floor(Date.now() / 1000),
        input_file_id: body.input_file_id,
        request_counts: { total: 0, completed: 0, failed: 0 },
      };
      state.jobs.set(id, job);
      state.polls.set(id, 0);
      return send(200, job);
    }
    const batchMatch = url.pathname.match(/^\/v1\/batches\/([^/]+)(\/cancel)?$/);
    if (batchMatch) {
      const job = state.jobs.get(batchMatch[1]);
      if (!job) return send(404, { error: 'no such batch' });
      if (req.method === 'POST' && batchMatch[2] === '/cancel') {
        job.status = 'cancelled';
        return send(200, job);
      }
      if (req.method === 'GET') {
        const polls = state.polls.get(job.id) + 1;
        state.polls.set(job.id, polls);
        const fail = state.hooks.getStatus?.(job.id, polls);
        if (fail) return send(fail, { error: { message: 'fake transient' } });
        if (state.behavior === 'auto' && job.status === 'in_progress' && polls >= (state.settleAt ?? 1)) settle(job);
        return send(200, job);
      }
    }
    if (req.method === 'GET' && url.pathname === '/v1/batches') {
      return send(200, { data: [...state.jobs.values()], has_more: false });
    }
    const fileMatch = url.pathname.match(/^\/v1\/files\/([^/]+)(\/content)?$/);
    if (fileMatch) {
      const content = state.files.get(fileMatch[1]);
      if (req.method === 'GET' && fileMatch[2] === '/content') {
        const code = state.hooks.downloadStatus?.(fileMatch[1]);
        if (code) return send(code, { error: { message: 'fake download failure' } });
        if (content === undefined) return send(404, { error: 'no such file' });
        state.log.push(`GET ${url.pathname} -> 200 (${Buffer.byteLength(content)} bytes)`);
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(content);
      }
      if (req.method === 'DELETE') {
        const code = state.hooks.deleteStatus?.(fileMatch[1]);
        if (code) return send(code, { error: { message: 'fake delete refusal' } });
        state.deleted.push(fileMatch[1]);
        state.files.delete(fileMatch[1]);
        return send(200, { id: fileMatch[1], deleted: true });
      }
    }
    return send(404, { error: `${req.method} ${url.pathname}` });
  };
  const server = opts.https ? https.createServer(opts.https, handler) : http.createServer(handler);
  await new Promise((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  state.port = server.address().port;
  state.baseUrl = `http://127.0.0.1:${state.port}/v1`;
  state.close = () => new Promise((r) => server.close(r));
  return state;
}

/** Fresh scratch sandbox: project dir (with docs/zh/{a,b}.md), fake home. */
export function makeSandbox(name, { git = false, gitignore = false } = {}) {
  const root = path.join(SCRATCH, name);
  fs.rmSync(root, { recursive: true, force: true });
  const project = path.join(root, 'project');
  const fakeHome = path.join(root, 'fakehome');
  const batchHome = path.join(root, 'batchhome');
  fs.mkdirSync(path.join(project, 'docs', 'zh'), { recursive: true });
  fs.mkdirSync(path.join(fakeHome, '.qwen'), { recursive: true });
  fs.writeFileSync(path.join(project, 'docs', 'zh', 'a.md'), '# A\n\n甲文档。\n');
  fs.writeFileSync(path.join(project, 'docs', 'zh', 'b.md'), '# B\n\n乙文档。\n');
  if (gitignore) fs.writeFileSync(path.join(project, '.gitignore'), 'node_modules/\n');
  return { root, project, fakeHome, batchHome, qwenHome: path.join(fakeHome, '.qwen') };
}

export function writePlan(project, file, name, items, extra = {}) {
  fs.writeFileSync(
    path.join(project, file),
    JSON.stringify({
      version: 1,
      name,
      kind: 'document-transform',
      shared: { instructions: 'Translate to English. Return only the document.' },
      items,
      ...extra,
    }),
  );
}

export const TWO_ITEMS = (suffix = '') => [
  { id: 'a', source: 'docs/zh/a.md', target: `docs/en/a${suffix}.md` },
  { id: 'b', source: 'docs/zh/b.md', target: `docs/en/b${suffix}.md` },
];

export function baseEnv(sb, fake, extra = {}) {
  // Built from scratch (not a spread of process.env): no real key, proxy or
  // settings path can leak into the CLI.
  const env = {
    PATH: process.env.PATH,
    TERM: 'dumb',
    NO_COLOR: '1',
    HOME: sb.fakeHome,
    USERPROFILE: sb.fakeHome,
    QWEN_HOME: sb.qwenHome,
    QWEN_CODE_SYSTEM_SETTINGS_PATH: path.join(sb.fakeHome, 'system-settings.json'),
    QWEN_CODE_SYSTEM_DEFAULTS_PATH: path.join(sb.fakeHome, 'system-defaults.json'),
    OPENAI_API_KEY: 'fake-key',
    OPENAI_BASE_URL: fake ? fake.baseUrl : 'http://127.0.0.1:9/v1',
    OPENAI_MODEL: 'qwen-plus',
    QWEN_BATCH_HOME: sb.batchHome,
    ...extra,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
}

let transcript = [];
export function logLine(s) {
  transcript.push(s);
  console.log(s);
}

export function run(cwd, env, args, { label, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn('node', raw ? [CLI, ...args] : [CLI, 'batch', ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('exit', (code) => {
      const r = { code: code ?? 1, stdout, stderr, ms: Date.now() - t0 };
      logLine(`\n$ qwen ${raw ? '' : 'batch '}${args.join(' ')}${label ? `   # ${label}` : ''}   (cwd=${cwd})`);
      logLine(`[exit ${r.code}, ${r.ms} ms]`);
      if (stdout.trim()) logLine(stdout.trimEnd().split('\n').map((l) => `  out| ${l}`).join('\n'));
      if (stderr.trim()) logLine(stderr.trimEnd().split('\n').map((l) => `  err| ${l}`).join('\n'));
      resolve(r);
    });
  });
}

export const taskIdOf = (r) => /task (\S+):/.exec(r.stdout)?.[1];

export function readTask(sb, id) {
  return JSON.parse(fs.readFileSync(path.join(sb.batchHome, 'tasks', id, 'task.json'), 'utf8'));
}

const verdicts = [];
export function verdict(name, cond, detail = '') {
  verdicts.push([name, Boolean(cond)]);
  logLine(`${cond ? 'CONFIRMED' : 'NOT-CONFIRMED'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
export function finish() {
  const bad = verdicts.filter(([, ok]) => !ok);
  logLine(`\n== ${verdicts.length - bad.length}/${verdicts.length} expectations matched`);
}
