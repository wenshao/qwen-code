// Shared helpers for PR 12688 verification: spawn a real bundled CLI arm
// (base / head) against a scripted fake OpenAI server with an isolated
// HOME and a separate workspace directory.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fakeToolCall,
  startFakeOpenAIServer,
  type FakeOpenAIHandler,
  type FakeOpenAIServer,
} from '/root/verify/pr12688/head/integration-tests/fake-openai-server.ts';

export { fakeToolCall, startFakeOpenAIServer };
export type J = Record<string, unknown>;

export const ARMS: Record<string, string> = {
  base: '/root/verify/pr12688/base/dist/cli.js',
  head: '/root/verify/pr12688/head/dist/cli.js',
  fix: '/root/verify/pr12688/fix/dist/cli.js',
};
export const RUN_ROOT = '/root/verify/pr12688/runs';

export function messages(body: J): J[] {
  return Array.isArray(body['messages']) ? (body['messages'] as J[]) : [];
}
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) =>
      p && typeof p === 'object' && typeof (p as J)['text'] === 'string'
        ? String((p as J)['text'])
        : '',
    )
    .join('\n');
}
export function requestText(body: J): string {
  return messages(body)
    .map((m) => contentText(m['content']))
    .join('\n');
}
export function toolNames(body: J): string[] {
  return Array.isArray(body['tools'])
    ? (body['tools'] as J[]).flatMap((t) => {
        const fn = t?.['function'] as J | undefined;
        return typeof fn?.['name'] === 'string' ? [fn['name'] as string] : [];
      })
    : [];
}
export function toolResults(body: J): string[] {
  return messages(body)
    .filter((m) => m['role'] === 'tool')
    .map((m) => contentText(m['content']));
}
export const REMINDER_MARK = 'Advisor is available for independent guidance';
export function countOf(hay: string, needle: string): number {
  let n = 0;
  let i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) {
    n++;
    i += needle.length;
  }
  return n;
}

export type Setup = {
  userSettings?: J;
  workspaceSettings?: J;
  systemSettings?: J;
  agents?: Record<string, string>;
  files?: Record<string, string>;
};

export function baseSettings(baseUrl: string, extra: J = {}): J {
  return {
    modelProviders: {
      openai: [
        { id: 'executor-model', name: 'Executor Model', baseUrl, envKey: 'OPENAI_API_KEY' },
        { id: 'advisor-model', name: 'Advisor Model', baseUrl, envKey: 'OPENAI_API_KEY' },
      ],
    },
    security: { auth: { selectedType: 'openai' } },
    model: { name: 'executor-model' },
    toolSearch: { threshold: 0 },
    ui: { enableFollowupSuggestions: false },
    telemetry: { enabled: false },
    sandbox: false,
    ...extra,
  };
}

export function prepareDirs(name: string, arm: string, setup: Setup) {
  const root = join(RUN_ROOT, `${name}-${arm}`);
  rmSync(root, { recursive: true, force: true });
  const home = join(root, 'home');
  const ws = join(root, 'ws');
  mkdirSync(join(home, '.qwen'), { recursive: true });
  mkdirSync(ws, { recursive: true });
  if (setup.userSettings)
    writeFileSync(join(home, '.qwen', 'settings.json'), JSON.stringify(setup.userSettings, null, 2));
  if (setup.workspaceSettings) {
    mkdirSync(join(ws, '.qwen'), { recursive: true });
    writeFileSync(join(ws, '.qwen', 'settings.json'), JSON.stringify(setup.workspaceSettings, null, 2));
  }
  let systemPath: string | undefined;
  if (setup.systemSettings) {
    systemPath = join(root, 'system-settings.json');
    writeFileSync(systemPath, JSON.stringify(setup.systemSettings, null, 2));
  }
  for (const [n, body] of Object.entries(setup.agents ?? {})) {
    mkdirSync(join(ws, '.qwen', 'agents'), { recursive: true });
    writeFileSync(join(ws, '.qwen', 'agents', `${n}.md`), body);
  }
  for (const [n, body] of Object.entries(setup.files ?? {})) writeFileSync(join(ws, n), body);
  return { root, home, ws, systemPath };
}

export function cliEnv(home: string, baseUrl: string, systemPath?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_COLOR', 'QWEN_CODE_SIMPLE', 'CI'])
    delete env[k];
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    QWEN_HOME: join(home, '.qwen'),
    QWEN_RUNTIME_DIR: join(home, '.qwen'),
    OPENAI_API_KEY: 'fake-key',
    OPENAI_BASE_URL: baseUrl,
    OPENAI_MODEL: 'executor-model',
    QWEN_MODEL: 'executor-model',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    QWEN_SANDBOX: 'false',
    QWEN_CODE_NO_RELAUNCH: '1',
    QWEN_CODE_SUPPRESS_YOLO_WARNING: '1',
  });
  if (systemPath) env['QWEN_CODE_SYSTEM_SETTINGS_PATH'] = systemPath;
  return env;
}

export type RunResult = { code: number | null; signal: string | null; stdout: string; stderr: string; ms: number };

export function runCli(
  arm: string,
  dirs: { home: string; ws: string; systemPath?: string },
  baseUrl: string,
  args: string[],
  stdin?: string,
  timeoutMs = 90_000,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('node', [ARMS[arm]!, '--no-chat-recording', ...args], {
      cwd: dirs.ws,
      env: cliEnv(dirs.home, baseUrl, dirs.systemPath),
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, ms: Date.now() - t0 });
    });
  });
}

export function streamInput(prompts: string[]): string {
  const sessionId = crypto.randomUUID();
  return [
    { type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } },
    ...prompts.map((p) => ({
      type: 'user',
      session_id: sessionId,
      message: { role: 'user', content: p },
      parent_tool_use_id: null,
    })),
  ]
    .map((m) => JSON.stringify(m))
    .join('\n');
}

export const STREAM_ARGS = [
  '--yolo',
  '--auth-type', 'openai',
  '--model', 'executor-model',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
];

export async function withServer<T>(handler: FakeOpenAIHandler, fn: (s: FakeOpenAIServer) => Promise<T>): Promise<T> {
  const server = await startFakeOpenAIServer(handler);
  try {
    return await fn(server);
  } finally {
    await server.close();
  }
}

export function isAdvisorReq(body: J): boolean {
  return body['model'] === 'advisor-model';
}
export function isExecutorStream(body: J): boolean {
  return body['model'] === 'executor-model' && body['stream'] === true;
}
