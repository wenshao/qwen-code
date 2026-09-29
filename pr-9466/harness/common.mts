// Shared driver for the PR #9466 real-TUI scenarios.
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { TerminalCapture } from './terminal-capture.mjs';
import { startFake, type Reply, type Req, msgText } from './fake.mjs';

export const ROOT = '/root/verify/pr9466';
export const ARM = (process.env.ARM ?? 'head') as 'head' | 'base';
export const CLI = join(ROOT, ARM, 'dist', 'cli.js');

export function userMarkers(req: Req): string[] {
  // Every T<n>: marker that appears in a user message, in order.
  const out: string[] = [];
  for (const m of req.body.messages) {
    if (m.role !== 'user') continue;
    const t = msgText(m);
    const re = /\bT(\d+):/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(t))) out.push(`T${mm[1]}`);
  }
  return out;
}

export function notificationCount(req: Req): number {
  return req.body.messages.filter((m) => m.role === 'user' && msgText(m).includes('<task-notification>')).length;
}

export function isMain(req: Req): boolean {
  // Main agent turns carry the tool list and the long agent system prompt.
  const sys = msgText(req.body.messages[0]);
  return Array.isArray(req.body.tools) && req.body.tools.length > 5 && !sys.includes('SUGGESTION MODE');
}

export async function setupRun(name: string, extraSettings: Record<string, unknown> = {}) {
  const runDir = join(ROOT, 'runs', `${name}-${ARM}`);
  rmSync(runDir, { recursive: true, force: true });
  const ws = join(runDir, 'ws');
  const home = join(runDir, 'home');
  const shots = join(runDir, 'shots');
  mkdirSync(ws, { recursive: true });
  mkdirSync(join(home, '.qwen'), { recursive: true });
  mkdirSync(shots, { recursive: true });
  writeFileSync(join(ws, 'README.md'), '# demo workspace\n');
  execFileSync('git', ['init', '-q'], { cwd: ws });
  execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', 'add', '-A'], { cwd: ws });
  execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init'], { cwd: ws });
  writeFileSync(
    join(home, '.qwen', 'settings.json'),
    JSON.stringify(
      {
        ui: { enableFollowupSuggestions: false, enableUserFeedback: false, hideTips: true },
        general: { disableAutoUpdate: true, disableUpdateNag: true },
        privacy: { usageStatisticsEnabled: false },
        ...extraSettings,
      },
      null,
      2,
    ),
  );
  return { runDir, ws, home, shots };
}

export function cliEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_COLOR', 'QWEN_CODE_SIMPLE', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'DASHSCOPE_API_KEY']) delete env[k];
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    QWEN_SANDBOX: 'false',
    QWEN_CODE_NO_RELAUNCH: '1',
    TERM: 'xterm-256color',
    FORCE_COLOR: '1',
    NODE_NO_WARNINGS: '1',
    LANG: 'en_US.UTF-8',
  };
}

export async function boot(
  t: TerminalCapture,
  baseUrl: string,
  extraArgs: string[] = [],
  cli: string = CLI,
) {
  await t.spawn('node', [
    cli,
    '--auth-type', 'openai',
    '--openai-api-key', 'dummy',
    '--openai-base-url', baseUrl,
    '--model', 'dummy',
    ...extraArgs,
  ]);
  await t.waitFor('Type your message', { timeout: 60000 });
  await t.idle(800, 8000);
}

export async function send(t: TerminalCapture, text: string) {
  await t.type(text);
  await t.idle(300, 3000);
  await t.type('\n');
}

export async function doubleEsc(t: TerminalCapture) {
  await t.type('\x1b');
  await new Promise((r) => setTimeout(r, 120));
  await t.type('\x1b');
  await t.idle(500, 4000);
}

export function listFiles(ws: string): string[] {
  return readdirSync(ws).filter((f) => !f.startsWith('.')).sort();
}

export function findSessionFiles(home: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (p.endsWith('.jsonl') && p.includes('chats')) out.push(p);
    }
  };
  walk(join(home, '.qwen'));
  return out;
}

export function readJsonl(p: string): any[] {
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export { TerminalCapture, startFake, msgText };
export type { Reply, Req };
