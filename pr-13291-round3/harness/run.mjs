// Real Managed ACP child (shipped bundle dist/cli.js) behind the arm's own
// compiled ACP bridge, with a scripted OpenAI-compatible model.
// usage: node run.mjs <armDir> <scenario> <outDir>
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, writeFile, cp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [armDir, scenario, outDirArg] = process.argv.slice(2);
const outDir = path.resolve(outDirArg);
const arm = path.resolve(armDir);
const imp = (p) => import(pathToFileURL(path.join(arm, p)).href);
const { createAcpSessionBridge } = await imp('packages/cli/dist/src/serve/acp-session-bridge.js');
const { createManagedEngineChannelFactory } = await imp('packages/cli/dist/src/serve/managed-engine-channel-factory.js');
const { createSpawnChannelFactory } = await imp('packages/acp-bridge/dist/spawnChannel.js');
const { ProcessRegistry } = await imp('packages/acp-bridge/dist/process-registry.js');
const { SessionService } = await imp('packages/core/dist/src/services/sessionService.js');

const MODEL = 'm5b-r3';
const HERE = path.dirname(new URL(import.meta.url).pathname);
await mkdir(outDir, { recursive: true });
const root = await realpath(await mkdtemp(path.join(tmpdir(), `pr13291-${scenario}-`)));
const workspace = path.join(root, 'workspace');
const qwenHome = path.join(root, 'config');
const runtimeDir = path.join(root, 'runtime');
await mkdir(workspace);
await mkdir(qwenHome);
const probeLog = path.join(outDir, 'probe.jsonl');
const report = { arm, scenario, root, phases: [] };
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s]`, ...a);

// ---- fake model -----------------------------------------------------------
let turns = [];
const modelRequests = [];
let callSeq = 0;
let currentSessionId;
let transcriptPathFor = () => undefined;
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const conversation = body.tools !== undefined;
  let logKinds;
  if (conversation) {
    const tp = transcriptPathFor();
    logKinds = tp && existsSync(tp) ? summarizeLog(readFileSync(tp, 'utf8')) : undefined;
    modelRequests.push({ at: Date.now() - t0, phase: report.phases.length, messages: body.messages, log: logKinds });
  }
  const turn = (conversation ? turns.shift() : undefined) ?? { text: 'DONE' };
  const deltas =
    'text' in turn
      ? [[{ role: 'assistant', content: turn.text }, null], [{}, 'stop']]
      : [
          [
            {
              role: 'assistant',
              tool_calls: turn.toolCalls.map((call, index) => ({
                index,
                id: call.id ?? `call_${++callSeq}`,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            },
            null,
          ],
          [{}, 'tool_calls'],
        ];
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const [delta, fr] of deltas)
    res.write(`data: ${JSON.stringify({ id: 'f', object: 'chat.completion.chunk', created: 0, model: MODEL, choices: [{ index: 0, delta, finish_reason: fr }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
await writeFile(
  path.join(qwenHome, 'settings.json'),
  JSON.stringify({
    security: { auth: { selectedType: 'openai' } },
    model: { name: MODEL },
    tools: { approvalMode: 'default' },
    telemetry: { enabled: false },
    privacy: { usageStatisticsEnabled: false },
    modelProviders: { openai: [{ id: MODEL, envKey: 'OPENAI_API_KEY', baseUrl }] },
  }),
);

function summarizeLog(text) {
  const lines = text.split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { unparsable: true }; }
  });
  const counts = {};
  let lastPhase;
  const phases = [];
  for (const l of lines) {
    const k = l.managedSession?.kind ?? l.type ?? (l.unparsable ? 'unparsable' : 'other');
    counts[k] = (counts[k] ?? 0) + 1;
    const s = JSON.stringify(l);
    const m = [...s.matchAll(/"phase":"([a-z_]+)"/g)].map((x) => x[1]);
    if (m.length) { lastPhase = m.at(-1); phases.push(m.at(-1)); }
  }
  return { lines: lines.length, counts, lastPhase, phases };
}

function makeBridge(extraEnv = {}) {
  const sourceEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PROBE_') && !k.startsWith('R3_')));
  Object.assign(sourceEnv, {
    HOME: root,
    QWEN_HOME: qwenHome,
    QWEN_RUNTIME_DIR: runtimeDir,
    QWEN_CLI_ENTRY: path.join(arm, process.env.R3_ENTRY_DIR ?? 'dist', 'cli.js'),
    NODE_OPTIONS: `--require ${path.join(HERE, 'probe.cjs')}`,
    PROBE_LOG: probeLog,
    OPENAI_API_KEY: 'm5b-r3-key',
    OPENAI_BASE_URL: baseUrl,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    NO_COLOR: '1',
    ...extraEnv,
  });
  const registry = new ProcessRegistry();
  const opts = { sourceEnv, processRegistry: registry };
  const bridge = createAcpSessionBridge({
    boundWorkspace: workspace,
    sessionScope: 'thread',
    channelIdleTimeoutMs: 0,
    initializeTimeoutMs: 60_000,
    executionEngines: {
      legacy: createSpawnChannelFactory(opts),
      managed: createManagedEngineChannelFactory(opts),
      select: () => 'managed',
    },
  });
  return { bridge, registry };
}

async function prompt(bridge, sessionId, text = 'go') {
  const permissions = [];
  const events = bridge.subscribeEvents(sessionId);
  const watching = (async () => {
    for await (const event of events) {
      if (event.type === 'permission_request') {
        const data = event.data;
        permissions.push(data.toolCall?._meta?.toolName ?? '');
        bridge.respondToPermission(data.requestId, {
          outcome: { outcome: 'selected', optionId: data.options.find((o) => o.kind === 'allow_once').optionId },
        });
      }
      if (event.type === 'turn_complete') return;
    }
  })();
  watching.catch(() => undefined);
  try {
    const response = await bridge.sendPrompt(sessionId, { sessionId, prompt: [{ type: 'text', text }] });
    return { ok: true, stopReason: response.stopReason, permissions };
  } catch (error) {
    return { ok: false, error: { message: String(error?.message ?? error).slice(0, 400), data: error?.data, code: error?.code }, permissions };
  }
}

const waitFor = async (probe, ms = 30_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};

function toolMessages(req) {
  return (req?.messages ?? [])
    .filter((m) => m.role === 'tool')
    .map((m) => ({ id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));
}
function assistantCalls(req) {
  return (req?.messages ?? []).flatMap((m) => (m.role === 'assistant' && m.tool_calls ? m.tool_calls.map((c) => c.id) : []));
}

const marker = `r3-${scenario}-${Math.random().toString(36).slice(2, 8)}`;
let sessionId;
const transcript = () => new SessionService(workspace, { runtimeBaseDir: runtimeDir }).getSessionTranscriptPath(sessionId);
transcriptPathFor = () => (sessionId ? transcript() : undefined);

async function snapshot(label) {
  const tp = transcript();
  const text = existsSync(tp) ? await readFile(tp, 'utf8') : '';
  await writeFile(path.join(outDir, `log-${label}.jsonl`), text);
  return summarizeLog(text);
}

try {
  // ---------------- phase 1: produce the log --------------------------------
  const killMode = { s14: 'after-receipt', s6: 'after-results-ready', s7: 'after-results-consumed' }[scenario];
  let { bridge, registry } = makeBridge(killMode ? { PROBE_KILL: killMode } : {});
  const s = await bridge.spawnOrAttach({ workspaceCwd: workspace, sessionScope: 'thread' });
  sessionId = s.sessionId;
  report.sessionId = sessionId;
  log('session', sessionId);
  const shellOut = path.join(workspace, 'shell.txt');
  const sleeper = path.join(workspace, 'sleeper.pid');
  if (scenario === 's4') {
    turns.push({
      toolCalls: [{ name: 'run_shell_command', args: { command: `echo "$PPID" > ${shellOut}; echo $$ > ${sleeper}; exec sleep 120`, description: 'long' } }],
    });
  } else if (scenario === 'oversize') {
    turns.push(
      { toolCalls: [{ name: 'write_file', args: { file_path: path.join(workspace, 'big.txt'), content: 'x'.repeat(300 * 1024) } }] },
      { toolCalls: [{ name: 'run_shell_command', args: { command: `echo ${marker}`, description: 'after oversize' } }] },
      { text: 'DONE' },
    );
  } else {
    turns.push(
      { toolCalls: [{ name: 'run_shell_command', args: { command: `echo ${marker}`, description: 'echo marker' } }] },
      { text: 'DONE' },
    );
  }
  let p1;
  if (scenario === 's4') {
    const running = prompt(bridge, sessionId);
    const childPid = Number((await waitFor(async () => (await readFile(shellOut, 'utf8').catch(() => '')).trim() || undefined)));
    // shell's $PPID is the worker; the worker's parent is the Managed child.
    const { execFileSync } = await import('node:child_process');
    const managedChild = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(childPid)], { encoding: 'utf8' }).trim());
    const sleepPid = Number((await readFile(sleeper, 'utf8')).trim());
    log('worker', childPid, 'managed child', managedChild, 'sleep', sleepPid);
    await new Promise((r) => setTimeout(r, 300));
    process.kill(managedChild, 'SIGKILL');
    p1 = await running;
    try { process.kill(sleepPid, 'SIGKILL'); } catch {}
  } else {
    p1 = await prompt(bridge, sessionId);
  }
  log('phase1 prompt ->', JSON.stringify(p1).slice(0, 300));
  const phase1Requests = modelRequests.length;
  await bridge.shutdown().catch((e) => log('shutdown1 err', String(e)));
  await registry.shutdown().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 500));
  const snap1 = await snapshot('after-phase1');
  report.phases.push({ name: 'phase1', prompt: p1, modelRequests: phase1Requests, log: snap1 });
  log('log after phase1', JSON.stringify(snap1));
  const lockDir = path.join(runtimeDir);
  report.lockFiles = (await import('node:child_process')).execSync(`find ${lockDir} -name '*.lock*' -o -name '*lease*' 2>/dev/null | head -20`, { encoding: 'utf8' });

  if (scenario === 'oversize') {
    report.modelRequests = modelRequests.map((r) => ({ at: r.at, phase: r.phase, tools: toolMessages(r), calls: assistantCalls(r), log: r.log }));
  } else {
    // ---------------- phase 2: reopen through the real session/load ---------
    ({ bridge, registry } = makeBridge(process.env.R3_ENTRY_DIR?.startsWith('dist-') ? { R3_SIM_M6_MANAGED_LOAD: '1', ...(process.env.R3_RECLAIM === '1' ? { R3_SIM_M6_RECLAIM: '1' } : {}), ...(process.env.R3_MUT === '1' ? { R3_MUT_NO_REREAD: '1' } : {}) } : {}));
    const before = modelRequests.length;
    turns.push({ text: 'CONTINUED' });
    let loadResult;
    try {
      const restored = await bridge.loadSession({ sessionId, workspaceCwd: workspace });
      loadResult = { ok: true, sessionId: restored.sessionId };
    } catch (error) {
      loadResult = { ok: false, error: { message: String(error?.message ?? error).slice(0, 500), data: error?.data, code: error?.code } };
    }
    log('load ->', JSON.stringify(loadResult).slice(0, 400));
    const snapLoaded = await snapshot('after-load');
    let p2;
    if (loadResult.ok) {
      p2 = await prompt(bridge, sessionId, 'continue');
      log('phase2 prompt ->', JSON.stringify(p2).slice(0, 300));
    }
    const req = modelRequests[before];
    report.phases.push({
      name: 'phase2-reopen',
      load: loadResult,
      logAfterLoad: snapLoaded,
      prompt: p2,
      modelRequests: modelRequests.length - before,
      firstRequest: req ? { tools: toolMessages(req), calls: assistantCalls(req), log: req.log } : undefined,
    });
    await bridge.shutdown().catch(() => undefined);
    await registry.shutdown().catch(() => undefined);
    report.phases.at(-1).logAfterPhase2 = await snapshot('after-phase2');
    // ---------------- phase 3: a second open of the same log ----------------
    if (process.env.R3_SECOND_OPEN === '1') {
      ({ bridge, registry } = makeBridge(process.env.R3_ENTRY_DIR?.startsWith('dist-') ? { R3_SIM_M6_MANAGED_LOAD: '1', ...(process.env.R3_RECLAIM === '1' ? { R3_SIM_M6_RECLAIM: '1' } : {}), ...(process.env.R3_MUT === '1' ? { R3_MUT_NO_REREAD: '1' } : {}) } : {}));
      const before3 = modelRequests.length;
      turns.push({ text: 'CONTINUED-2' });
      let load3;
      try {
        await bridge.loadSession({ sessionId, workspaceCwd: workspace });
        load3 = { ok: true };
      } catch (error) {
        load3 = { ok: false, error: { message: String(error?.message ?? error).slice(0, 500), data: error?.data, code: error?.code } };
      }
      const p3 = load3.ok ? await prompt(bridge, sessionId, 'again') : undefined;
      const req3 = modelRequests[before3];
      report.phases.push({ name: 'phase3-second-open', load: load3, prompt: p3, modelRequests: modelRequests.length - before3,
        firstRequest: req3 ? { tools: toolMessages(req3), calls: assistantCalls(req3), log: req3.log } : undefined });
      await bridge.shutdown().catch(() => undefined);
      await registry.shutdown().catch(() => undefined);
      report.phases.at(-1).logAfter = await snapshot('after-phase3');
    }
  }
  report.marker = marker;
} catch (error) {
  report.fatal = String(error?.stack ?? error);
  log('FATAL', report.fatal);
} finally {
  report.elapsedMs = Date.now() - t0;
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  server.closeAllConnections();
  server.close();
  await cp(root, path.join(outDir, 'root'), { recursive: true }).catch(() => undefined);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  log('done');
  setTimeout(() => process.exit(0), 200);
}
