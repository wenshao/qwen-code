// Rig driver for PR #13083: packaged Managed Agent stack (private mysqld + Spring fat jar + Hosted
// Harness bundle + Runtime Broker/worker + fake model) with optional fault taps.
// Run with tsx, cwd = the source tree under test (dist/cli.js and the server jar come from it).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http, { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const root = process.cwd();
const t0 = Date.now();
export const ms = () => Date.now() - t0;
export const sleep = (n: number) => new Promise((r) => setTimeout(r, n));

function which(name: string): string {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`missing command: ${name}`);
  return realpathSync(result.stdout.trim());
}

export interface Proc {
  name: string;
  child: ChildProcess;
  logFile: string;
  url: string;
  port: number;
  brokerPort?: number;
  home?: string;
}

export type TapAction =
  | 'pass'
  | 'drop-reply' // forward, let the upstream finish, then cut the caller's socket
  | 'drop-request' // cut the caller's socket without forwarding
  | 'hold' // neither forward nor answer; the caller stays parked on the request
  | { status: number; body: string }
  | { delayMs: number };

export interface TapInfo {
  method: string;
  path: string;
  body: string;
  n: number; // how many earlier requests matched the same method+path
}

export interface Tap {
  baseUrl: string;
  log: { t: number; line: string }[];
  /** Destroys every open SSE response, as a network gap between caller and upstream would. */
  cutStreams: () => number;
  close: () => Promise<void>;
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

// Streaming reverse proxy: request bodies are buffered (small JSON), responses are piped so SSE
// keeps flowing. An upstream abort tears the caller down too, and the Host header is rewritten.
export async function startTap(
  name: string,
  targetOrigin: string,
  hook: (info: TapInfo) => TapAction | Promise<TapAction> = () => 'pass',
): Promise<Tap> {
  const target = new URL(targetOrigin);
  const log: { t: number; line: string }[] = [];
  const seen = new Map<string, number>();
  const openStreams = new Set<http.ServerResponse>();
  const note = (line: string) => log.push({ t: ms(), line: `[${name}] ${line}` });
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      void (async () => {
        const method = request.method ?? 'GET';
        const url = request.url ?? '/';
        const key = `${method} ${url.split('?')[0]}`;
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        const body = Buffer.concat(chunks);
        const action = await hook({ method, path: url, body: body.toString('utf8'), n });
        const label = typeof action === 'string' ? action : JSON.stringify(action);
        if (action === 'hold') {
          note(`${method} ${url} #${n} -> held (never forwarded)`);
          request.socket.once('close', () => response.destroy());
          return;
        }
        if (action === 'drop-request') {
          note(`${method} ${url} #${n} -> drop-request`);
          request.socket.destroy();
          return;
        }
        if (typeof action === 'object' && 'status' in action) {
          note(`${method} ${url} #${n} -> injected ${action.status}`);
          response.writeHead(action.status, { 'content-type': 'application/json' });
          response.end(action.body);
          return;
        }
        if (typeof action === 'object' && 'delayMs' in action) await sleep(action.delayMs);
        const headers = { ...request.headers, host: target.host };
        delete headers['content-length'];
        const upstream = http.request(
          {
            host: target.hostname,
            port: target.port,
            method,
            path: url,
            headers: { ...headers, 'content-length': String(body.length) },
          },
          (upstreamResponse) => {
            if (action === 'drop-reply') {
              const parts: Buffer[] = [];
              upstreamResponse.on('data', (chunk: Buffer) => parts.push(chunk));
              upstreamResponse.on('end', () => {
                note(
                  `${method} ${url} #${n} -> upstream ${upstreamResponse.statusCode} ${Buffer.concat(parts).toString('utf8').slice(0, 300)} :: reply DROPPED`,
                );
                request.socket.destroy();
              });
              return;
            }
            const sse = String(upstreamResponse.headers['content-type'] ?? '').includes(
              'text/event-stream',
            );
            const parts: Buffer[] = [];
            if (!sse) upstreamResponse.on('data', (chunk: Buffer) => parts.push(chunk));
            upstreamResponse.on('end', () =>
              note(
                `${method} ${url} #${n} -> ${upstreamResponse.statusCode}${sse ? ' (sse end)' : ` ${Buffer.concat(parts).toString('utf8').slice(0, 400)}`}${label === 'pass' ? '' : ` [${label}]`}`,
              ),
            );
            if (sse) {
              note(`${method} ${url} #${n} -> ${upstreamResponse.statusCode} (sse open)`);
              openStreams.add(response);
              response.on('close', () => openStreams.delete(response));
            }
            response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
            upstreamResponse.pipe(response);
            upstreamResponse.on('aborted', () => response.destroy());
            upstreamResponse.on('close', () => {
              if (!response.writableEnded) response.destroy();
            });
          },
        );
        upstream.on('error', (error) => {
          note(`${method} ${url} #${n} -> upstream error ${String(error).slice(0, 120)}`);
          if (!response.headersSent) request.socket.destroy();
          else response.destroy();
        });
        response.on('close', () => {
          if (!response.writableEnded) upstream.destroy();
        });
        upstream.end(body);
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('tap has no address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    log,
    cutStreams: () => {
      const count = openStreams.size;
      for (const stream of openStreams) stream.destroy();
      note(`cut ${count} open SSE stream(s)`);
      return count;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export interface RigOptions {
  label: string;
  workspace: boolean; // Workspace-bound file-tool Sessions (trusted actor header, mounts)
  durable?: boolean; // durable local-Worker reclaim (Linux only)
  leaseEnv?: Record<string, string>;
}

export async function createRig(options: RigOptions) {
  const outDir = process.env['RIG_OUT'] ?? path.join(tmpdir(), 'rig-out');
  mkdirSync(outDir, { recursive: true });
  const cliBundle = path.join(root, 'dist', 'cli.js');
  const springJar = path.join(
    root,
    'packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar',
  );
  for (const required of [cliBundle, springJar])
    if (!existsSync(required)) throw new Error(`missing ${required}`);
  const java = which('java');
  const mysqld = which('mysqld');
  const mysql = which('mysql');
  const mysqladmin = which('mysqladmin');
  const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), `rig13083-${options.label}-`)));
  const workspace = path.join(tmp, 'workspace');
  const workspaceMount = path.join(tmp, 'workspace-mount');
  const runtimeState = path.join(tmp, 'runtime-state');
  const trustedFolders = path.join(tmp, 'trusted-folders.json');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(workspaceMount, { recursive: true });
  mkdirSync(runtimeState, { recursive: true, mode: 0o700 });
  writeFileSync(trustedFolders, JSON.stringify({ [workspace]: 'TRUST_FOLDER' }), { mode: 0o600 });
  const tenant = `rig-${options.label}`;
  const actorHeader = 'x-qwen-e2e-trusted-actor';
  const actor = 'e2e-actor';
  const boundWorkspaceId = 'e2e-workspace';
  const boundStorageId = 'e2e-storage';
  const harnessToken = randomBytes(24).toString('base64url');
  // hex, not base64url: a token that starts with '-' is parsed by `qwen serve` as flags
  const brokerToken = randomBytes(24).toString('hex');
  const credentialKey = randomBytes(32).toString('base64');
  const capabilityDigest = `sha256:${randomBytes(32).toString('hex')}`;
  const workspaceId = createHash('sha256').update(workspace).digest('hex').slice(0, 16);
  const procs: Proc[] = [];
  const taps: Tap[] = [];
  const cleanEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(https?|all)_proxy$/i.test(key) &&
        !/^(qwen|dashscope|openai|anthropic|google|gemini|azure|aws|vertex|rig)_/i.test(key) &&
        !/(api_?key|token|secret|password|credentials?)$/i.test(key),
    ),
  );

  function launch(name: string, executable: string, args: string[], env: NodeJS.ProcessEnv) {
    const logFile = path.join(outDir, `${options.label}-${name}.log`);
    writeFileSync(logFile, '');
    const child = spawn(executable, args, {
      cwd: root,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = (chunk: Buffer) => appendFileSync(logFile, chunk);
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    return { child, logFile };
  }

  async function until(name: string, predicate: () => Promise<boolean> | boolean, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        if (await predicate()) return;
      } catch {
        // not ready
      }
      if (Date.now() >= deadline) throw new Error(`timeout waiting for ${name}`);
      await sleep(100);
    }
  }

  const mysqlPort = await freePort();
  const mysqlData = path.join(tmp, 'mysql-data');
  mkdirSync(mysqlData);
  const rootArg = process.getuid?.() === 0 ? ['--user=root'] : [];
  const init = spawnSync(
    mysqld,
    ['--no-defaults', ...rootArg, '--initialize-insecure', `--datadir=${mysqlData}`],
    { encoding: 'utf8' },
  );
  if (init.status !== 0) throw new Error(`mysqld init failed: ${init.stderr}`);
  const db = launch(
    'mysql',
    mysqld,
    [
      '--no-defaults',
      ...rootArg,
      `--datadir=${mysqlData}`,
      `--socket=${path.join(tmp, 'mysql.sock')}`,
      `--port=${mysqlPort}`,
      '--bind-address=127.0.0.1',
      '--mysqlx=0',
      `--pid-file=${path.join(tmp, 'mysql.pid')}`,
      `--log-error=${path.join(tmp, 'mysql-error.log')}`,
    ],
    process.env,
  );
  procs.push({ name: 'mysql', ...db, url: '', port: mysqlPort });
  await until(
    'mysql',
    () =>
      spawnSync(
        mysqladmin,
        ['--protocol=tcp', '--host=127.0.0.1', `--port=${mysqlPort}`, '--user=root', 'ping'],
        { stdio: 'ignore' },
      ).status === 0,
    90_000,
  );
  function sql(statement: string): string {
    const result = spawnSync(
      mysql,
      [
        '--protocol=tcp',
        '--host=127.0.0.1',
        `--port=${mysqlPort}`,
        '--user=root',
        '--batch',
        '--skip-column-names',
        '--execute',
        statement,
      ],
      { encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error(`mysql: ${result.stderr}`);
    return result.stdout.trim();
  }
  sql('CREATE DATABASE qwen_managed_agent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  const dbVersion = sql('SELECT VERSION()');

  const fakeModule = (await import(
    pathToFileURL(path.join(root, 'integration-tests', 'fake-openai-server.ts')).href
  )) as typeof import('../src-pr/integration-tests/fake-openai-server.js');
  let model: Awaited<ReturnType<typeof fakeModule.startFakeOpenAIServer>> | undefined;
  async function startModel(handler: Parameters<typeof fakeModule.startFakeOpenAIServer>[0]) {
    model = await fakeModule.startFakeOpenAIServer(handler);
    return model;
  }

  let seeded = false;
  async function startSpring(
    name: string,
    input: { harnessUrl: string; extraEnv?: Record<string, string>; tree?: string },
  ): Promise<Proc> {
    const jar = input.tree
      ? path.join(input.tree, 'packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar')
      : springJar;
    const bundle = input.tree ? path.join(input.tree, 'dist', 'cli.js') : cliBundle;
    const port = await freePort();
    const brokerPort = await freePort();
    const home = path.join(tmp, `runtime-home-${name}`);
    mkdirSync(path.join(home, '.qwen'), { recursive: true });
    writeFileSync(
      path.join(home, '.qwen', 'settings.json'),
      JSON.stringify({ ui: { enableFollowupSuggestions: false } }),
      { mode: 0o600 },
    );
    const url = `http://127.0.0.1:${port}`;
    const args = ['-jar', jar];
    if (options.workspace)
      args.push(
        `--qwen.managed-agent.runtime-broker.workspace-mounts[0].tenant-id=${tenant}`,
        `--qwen.managed-agent.runtime-broker.workspace-mounts[0].storage-id=${boundStorageId}`,
        `--qwen.managed-agent.runtime-broker.workspace-mounts[0].root=${workspaceMount}`,
      );
    const launched = launch(`spring-${name}`, java, args, {
      ...cleanEnvironment,
      HOME: home,
      LANG: 'C',
      LC_ALL: 'C',
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
      QWEN_HOME: path.join(home, '.qwen'),
      TMPDIR: tmp,
      SERVER_PORT: String(port),
      SPRING_DATASOURCE_PASSWORD: '',
      SPRING_DATASOURCE_URL: `jdbc:mysql://127.0.0.1:${mysqlPort}/qwen_managed_agent?useSSL=false&allowPublicKeyRetrieval=true`,
      SPRING_DATASOURCE_USERNAME: 'root',
      QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo',
      QWEN_MANAGED_AGENT_CAPABILITY_DIGEST: capabilityDigest,
      QWEN_MANAGED_AGENT_HARNESS_BASE_URL: input.harnessUrl,
      QWEN_MANAGED_AGENT_HARNESS_ENABLED: 'true',
      QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT: '120s',
      QWEN_MANAGED_AGENT_HARNESS_TOKEN: harnessToken,
      ...(options.workspace
        ? {
            QWEN_MANAGED_AGENT_TRUSTED_ACTOR_HEADER: actorHeader,
            QWEN_MANAGED_AGENT_WORKSPACE_FILES_ENABLED: 'true',
            ...(options.durable ? { QWEN_MANAGED_AGENT_RUNTIME_DURABLE_LOCAL_PROCESS: 'true' } : {}),
          }
        : {}),
      QWEN_MANAGED_AGENT_DISPATCH_LEASE_DURATION: '2s',
      QWEN_MANAGED_AGENT_DISPATCH_LEASE_RENEW_INTERVAL: '500ms',
      QWEN_MANAGED_AGENT_DISPATCH_SCAN_DELAY: '200ms',
      QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: url,
      QWEN_MANAGED_AGENT_SESSION_STORE_ENABLED: 'true',
      QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION: '1s',
      QWEN_MANAGED_AGENT_WORKSPACE_ID: workspaceId,
      QWEN_MANAGED_AGENT_RUNTIME_BROKER_ENABLED: 'true',
      QWEN_MANAGED_AGENT_RUNTIME_BROKER_PORT: String(brokerPort),
      QWEN_MANAGED_AGENT_RUNTIME_BROKER_TOKEN: brokerToken,
      QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY: credentialKey,
      QWEN_MANAGED_AGENT_RUNTIME_CREDENTIAL_KEY_ID: 'e2e-local-v1',
      QWEN_MANAGED_AGENT_RUNTIME_STATE_DIRECTORY: runtimeState,
      QWEN_MANAGED_AGENT_RUNTIME_WORKER_ENTRY: bundle,
      QWEN_MANAGED_AGENT_NODE_EXECUTABLE: process.execPath,
      QWEN_MANAGED_AGENT_CLI_ENTRY: bundle,
      QWEN_MANAGED_AGENT_WORKSPACE_CWD: workspace,
      ...(options.leaseEnv ?? {}),
      ...(input.extraEnv ?? {}),
    });
    const proc: Proc = { name: `spring-${name}`, ...launched, url, port, brokerPort, home };
    procs.push(proc);
    await until(`spring-${name}`, async () => (await fetch(`${url}/actuator/health`)).ok, 300_000);
    if (options.workspace && !seeded) {
      seeded = true;
      sql(
        `INSERT INTO qwen_managed_agent.managed_workspace_registry (tenant_id, workspace_id, workspace_generation, storage_id, display_name, config_ref, policy_ref, state) VALUES ('${tenant}', '${boundWorkspaceId}', 1, '${boundStorageId}', 'E2E', 'managed-runtime-tools/1', 'preapproved-workspace-tools/1', 'ACTIVE')`,
      );
      sql(
        `INSERT INTO qwen_managed_agent.managed_workspace_access (tenant_id, workspace_id, actor_id, can_read, can_create) VALUES ('${tenant}', '${boundWorkspaceId}', '${actor}', TRUE, TRUE)`,
      );
    }
    return proc;
  }

  async function startHarness(
    name: string,
    input: { port?: number; brokerUrl?: string; extraEnv?: Record<string, string>; tree?: string } = {},
  ): Promise<Proc> {
    const bundle = input.tree ? path.join(input.tree, 'dist', 'cli.js') : cliBundle;
    const port = input.port ?? (await freePort());
    const home = path.join(tmp, `harness-home-${name}`);
    mkdirSync(path.join(home, '.qwen'), { recursive: true });
    writeFileSync(
      path.join(home, '.qwen', 'settings.json'),
      JSON.stringify({ ui: { enableFollowupSuggestions: false } }),
      { mode: 0o600 },
    );
    if (!model) throw new Error('start the model first');
    const launched = launch(
      `harness-${name}`,
      process.execPath,
      [
        bundle,
        'serve',
        '--profile',
        'hosted-harness',
        '--port',
        String(port),
        '--hostname',
        '127.0.0.1',
        '--require-auth',
        '--no-web',
        '--workspace',
        workspace,
        ...(input.brokerUrl
          ? [
              '--managed-runtime-broker-url',
              input.brokerUrl,
              '--managed-runtime-broker-token',
              brokerToken,
            ]
          : []),
      ],
      {
        ...cleanEnvironment,
        HOME: home,
        LANG: 'C',
        LC_ALL: 'C',
        QWEN_HOME: path.join(home, '.qwen'),
        QWEN_CODE_TRUSTED_FOLDERS_PATH: trustedFolders,
        QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST: capabilityDigest,
        QWEN_SERVER_TOKEN: harnessToken,
        OPENAI_API_KEY: 'fake-key',
        OPENAI_BASE_URL: model.baseUrl,
        OPENAI_MODEL: 'fake-model',
        QWEN_MODEL: 'fake-model',
        ...(input.brokerUrl
          ? { QWEN_RUNTIME_BROKER_TOKEN: brokerToken, QWEN_RUNTIME_BROKER_URL: input.brokerUrl }
          : {}),
        ...(input.extraEnv ?? {}),
      },
    );
    const url = `http://127.0.0.1:${port}`;
    const proc: Proc = { name: `harness-${name}`, ...launched, url, port, home };
    procs.push(proc);
    await until(
      `harness-${name}`,
      async () =>
        (await fetch(`${url}/health`, { headers: { authorization: `Bearer ${harnessToken}` } })).ok,
      300_000,
    );
    return proc;
  }

  const headers = (extra: Record<string, string> = {}) => ({
    'x-qwen-tenant-id': tenant,
    ...(options.workspace ? { [actorHeader]: actor } : {}),
    ...extra,
  });

  async function createSession(springUrl: string, text: string, bound = options.workspace) {
    const response = await fetch(`${springUrl}/v1/agents/sessions`, {
      method: 'POST',
      headers: headers({
        'content-type': 'application/json',
        'idempotency-key': `create-${randomBytes(6).toString('hex')}`,
      }),
      body: JSON.stringify({
        agent_id: 'qwen-code',
        input: [{ type: 'text', text }],
        ...(bound ? { workspace: { workspace_id: boundWorkspaceId } } : {}),
        metadata: { title: `rig ${options.label}` },
      }),
    });
    const body = await response.text();
    if (response.status !== 202) throw new Error(`create ${response.status}: ${body}`);
    return JSON.parse(body) as { id: string; status: string; last_event_id: number };
  }

  async function postMessage(springUrl: string, sessionId: string, text: string) {
    const response = await fetch(`${springUrl}/v1/agents/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: headers({
        'content-type': 'application/json',
        'idempotency-key': `msg-${randomBytes(6).toString('hex')}`,
      }),
      body: JSON.stringify({ type: 'agent.session.input.message', input: [{ type: 'text', text }] }),
    });
    return { status: response.status, body: await response.text() };
  }

  interface PublicEvent {
    sequence: number;
    terminal: boolean;
    type: string;
    data?: Record<string, unknown>;
  }
  async function events(springUrl: string, sessionId: string, after = 0): Promise<PublicEvent[]> {
    const all: PublicEvent[] = [];
    let cursor = after;
    for (;;) {
      const response = await fetch(
        `${springUrl}/v1/agents/sessions/${sessionId}/events?after=${cursor}&limit=100`,
        { headers: headers() },
      );
      if (!response.ok) throw new Error(`events ${response.status} ${await response.text()}`);
      const page = ((await response.json()) as { data: PublicEvent[] }).data;
      all.push(...page);
      if (page.length < 100) return all;
      cursor = page.at(-1)!.sequence;
    }
  }

  // Waits until `count` terminal events exist after `after`; returns null on timeout.
  async function waitTerminal(
    springUrl: string,
    sessionId: string,
    after: number,
    timeoutMs: number,
  ): Promise<PublicEvent | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const terminal = (await events(springUrl, sessionId, after)).find((e) => e.terminal);
        if (terminal) return terminal;
      } catch {
        // owner may be restarting
      }
      await sleep(150);
    }
    return null;
  }

  function alive(child: ChildProcess): boolean {
    if (child.pid === undefined) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  // tree=true kills the whole process group (Harness); tree=false kills only the JVM so a durable
  // Runtime worker outlives its Broker, as in the PR's own runner.
  async function kill9(proc: Proc, tree: boolean) {
    if (proc.child.pid === undefined) return;
    try {
      process.kill(tree ? -proc.child.pid : proc.child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
    const deadline = Date.now() + 5000;
    while (proc.child.exitCode === null && proc.child.signalCode === null && Date.now() < deadline)
      await sleep(25);
  }

  async function cleanup() {
    for (const tap of taps) await tap.close().catch(() => undefined);
    for (const proc of [...procs].reverse()) {
      if (!alive(proc.child)) continue;
      try {
        process.kill(-proc.child.pid!, 'SIGTERM');
      } catch {
        // gone
      }
    }
    const deadline = Date.now() + 10_000;
    while (procs.some((p) => alive(p.child)) && Date.now() < deadline) await sleep(100);
    for (const proc of procs)
      if (alive(proc.child))
        try {
          process.kill(-proc.child.pid!, 'SIGKILL');
        } catch {
          // gone
        }
    await model?.close().catch(() => undefined);
    // Durable workers are detached from every process group above; sweep anything rooted in tmp.
    spawnSync('pkill', ['-9', '-f', tmp]);
    if (process.env['RIG_KEEP'] !== '1') rmSync(tmp, { recursive: true, force: true });
  }

  return {
    options,
    outDir,
    tmp,
    tenant,
    workspace,
    workspaceMount,
    runtimeState,
    harnessToken,
    brokerToken,
    dbVersion,
    sql,
    startModel,
    modelRequests: () => model?.requests ?? [],
    startSpring,
    startHarness,
    tap: async (name: string, target: string, hook?: Parameters<typeof startTap>[2]) => {
      const tap = await startTap(name, target, hook);
      taps.push(tap);
      return tap;
    },
    headers,
    createSession,
    postMessage,
    events,
    waitTerminal,
    kill9,
    alive,
    until,
    cleanup,
    fakeToolCall: fakeModule.fakeToolCall,
    sessionFilter: (sessionId: string) => `tenant_id='${tenant}' AND session_id='${sessionId}'`,
    save: (name: string, value: unknown) =>
      writeFileSync(
        path.join(outDir, `${options.label}-${name}`),
        typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      ),
  };
}

export type Rig = Awaited<ReturnType<typeof createRig>>;
