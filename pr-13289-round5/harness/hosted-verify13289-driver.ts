/**
 * PR #13289 maintainer verification driver (scratch, not part of the PR).
 *
 * Real topology: Spring Session Store + embedded Runtime Broker (durable
 * local-process workers, MySQL/MariaDB) + one packaged `qwen serve`
 * hosted-harness process. Operator steps run the PR's trusted entry points
 * (`WorkspaceCsiRegistrationMain`, `WorkspaceRecoveryCommand`) as separate
 * JVMs against the same database.
 *
 * Cases (each on its own LOCAL Workspace mount):
 *  - warmonly:  the first turn is text-only (warm, no acquire), then the
 *               operator registers a CSI alias for the same tenant+storage,
 *               then the original worker is SIGKILLed.
 *  - toolfirst: control; the first turn runs a tool (acquire -> lease row),
 *               then the same operator registration and SIGKILL.
 *
 * It records observations only; arm expectations are judged afterwards.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { fakeToolCall, startFakeOpenAIServer } from '../fake-openai-server.js';
import { HostedHarnessProcess, waitUntil } from './hosted-harness-process.js';

const run = promisify(execFile);
const configPath = process.argv[2]!;
const config = JSON.parse(await readFile(configPath, 'utf8')) as {
  tenantId: string;
  storeUrl: string;
  brokerUrl: string;
  sqlUrl: string;
  java: string;
  classpath: string;
  jdbcUrl: string;
  jdbcUser: string;
  jdbcPassword: string;
  workerEntry: string;
  database: string;
  phase: number;
  observeSeconds: number;
  cases: Array<{
    name: string;
    workspaceId: string;
    storageId: string;
    directory: string;
    sessions: string[];
  }>;
};

const T0 = Date.now();
const now = () => Date.now() - T0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (label: string, value: unknown) =>
  console.log(`VERIFY13289 t=${now()} ${label} ${JSON.stringify(value)}`);

type BrokerEntry = { at: number; op: string; status: number; code?: unknown };
const brokerOps = new Map<string, BrokerEntry[]>();
const clients = new Map<string, string>();
let proxyFailure: unknown;

const proxy = createServer(async (req, res) => {
  try {
    const store = req.url!.startsWith('/internal/managed-session-store/');
    const url = new URL(req.url!, store ? config.storeUrl : config.brokerUrl);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const fields = body.length
      ? JSON.parse(body.toString())
      : Object.fromEntries(url.searchParams);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers))
      if (value && !['host', 'connection', 'content-length'].includes(name))
        headers.set(name, Array.isArray(value) ? value.join(',') : value);
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      ...(body.length ? { body } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (!store && typeof fields.harnessSessionId === 'string') {
      let json: Record<string, unknown> | undefined;
      try {
        json = JSON.parse(bytes.toString());
      } catch {
        json = undefined;
      }
      const op =
        req.method === 'GET'
          ? 'status'
          : url.pathname.includes('/control')
            ? 'control'
            : url.pathname.split(/[:/]/).at(-1)!;
      const list = brokerOps.get(fields.harnessSessionId) ?? [];
      list.push({
        at: now(),
        op,
        status: upstream.status,
        ...(upstream.ok ? {} : { code: json?.['code'] }),
      });
      brokerOps.set(fields.harnessSessionId, list);
    }
    for (const [name, value] of upstream.headers)
      if (!['content-length', 'transfer-encoding', 'connection'].includes(name))
        res.setHeader(name, value);
    res.writeHead(upstream.status);
    res.end(bytes);
  } catch (cause) {
    proxyFailure = cause;
    res.destroy();
  }
});
await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const address = proxy.address();
assert(address && typeof address !== 'string');
const proxyUrl = 'http://127.0.0.1:' + address.port;

const model = await startFakeOpenAIServer(({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const marker = JSON.stringify(messages).match(
    /VERIFY13289 case=(\w+) mode=(\w+) n=(\d+)/g,
  );
  const last = marker?.at(-1)?.match(/case=(\w+) mode=(\w+) n=(\d+)/);
  if (messages.at(-1)?.role === 'tool' || !last || last[2] !== 'tool')
    return { content: 'text answer ' + (last?.[3] ?? '?') };
  return {
    toolCalls: [
      fakeToolCall(
        'run_shell_command',
        { command: `printf verify13289-${last[1]}-${last[3]} > proof-${last[3]}.txt`, timeout: 60_000 },
        'shell-' + randomUUID().slice(0, 8),
      ),
    ],
  };
});

async function sql(query: string) {
  const response = await fetch(config.sqlUrl, { method: 'POST', body: query });
  const text = await response.text();
  if (!response.ok) throw new Error('SQL failed: ' + text);
  return JSON.parse(text) as Array<Record<string, unknown>>;
}

const localKey = (storageId: string) =>
  createHash('sha256').update(config.tenantId + '\u0000' + storageId).digest('hex');
const quoteSql = (value: string) => "'" + value.replaceAll("'", "''") + "'";

async function snapshot(storageId: string) {
  return {
    bindings: await sql(
      'SELECT binding_id, runtime_generation, binding_state, workspace_id, record_version,' +
        ' loss_evidence_json IS NOT NULL AS has_loss, stop_evidence_json IS NOT NULL AS has_stop' +
        ' FROM qwen_runtime_binding WHERE tenant_id = ' +
        quoteSql(config.tenantId) +
        ' AND storage_id = ' +
        quoteSql(storageId) +
        ' ORDER BY created_at',
    ).catch(async () =>
      sql(
        'SELECT binding_id, runtime_generation, binding_state, workspace_id, record_version,' +
          ' loss_evidence_json IS NOT NULL AS has_loss, stop_evidence_json IS NOT NULL AS has_stop' +
          ' FROM qwen_runtime_binding WHERE tenant_id = ' +
          quoteSql(config.tenantId) +
          ' AND storage_id = ' +
          quoteSql(storageId),
      ),
    ),
    localLeaseRows: await sql(
      'SELECT storage_kind, holder_key IS NOT NULL AS held, csi_phase FROM managed_workspace_execution_lease' +
        ' WHERE storage_key = ' +
        quoteSql(localKey(storageId)),
    ),
    csiRegistrations: await sql(
      'SELECT storage_id, registration_revision FROM managed_workspace_csi_registration WHERE tenant_id = ' +
        quoteSql(config.tenantId) +
        ' AND storage_id = ' +
        quoteSql(storageId),
    ),
  };
}

async function workerPids() {
  const { stdout } = await run('ps', ['-eo', 'pid=,args=']);
  return stdout
    .split('\n')
    .filter((line) => line.includes(config.workerEntry) && line.includes('managed-runtime-worker'))
    .map((line) => Number(line.trim().split(/\s+/)[0]));
}

async function javaMain(mainClass: string, args: string[], env: Record<string, string> = {}, jvm: string[] = []) {
  const started = now();
  try {
    const { stdout, stderr } = await run(config.java, [...jvm, '-cp', config.classpath, mainClass, ...args], {
      env: { PATH: process.env['PATH']!, ...env },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
    return { exit: 0, ms: now() - started, stdout: stdout.trim().split('\n').slice(-3), stderr: tail(stderr) };
  } catch (cause) {
    const error = cause as { code?: number; stdout?: string; stderr?: string };
    return {
      exit: error.code ?? -1,
      ms: now() - started,
      stdout: (error.stdout ?? '').trim().split('\n').slice(-3),
      stderr: tail(error.stderr ?? ''),
    };
  }
}

function tail(text: string) {
  return text
    .split('\n')
    .filter((line) => /Exception|refus|unavailable|Caused by|blocked/.test(line))
    .slice(0, 6)
    .map((line) => line.slice(0, 300));
}

async function registerCsi(entry: (typeof config.cases)[number]) {
  const file = path.join(path.dirname(configPath), `csi-${entry.name}.json`);
  await writeFile(
    file,
    JSON.stringify({
      tenantId: config.tenantId,
      storageId: entry.storageId,
      clusterDomain: 'cluster.local',
      namespace: 'qwen-csi',
      pvcName: 'workspace-' + entry.name,
      pvcUid: 'pvc-uid-' + entry.name,
      pvName: 'pv-' + entry.name,
      pvUid: 'pv-uid-' + entry.name,
      driver: 'diskplugin.csi.alibabacloud.com',
      volumeHandle: 'd-verify13289-' + entry.name,
      backendDomain: 'ecs.cn-verify.aliyuncs.com',
      diskSerial: 'serial-' + entry.name,
      mountRoot: '/workspace',
      revision: 1,
    }),
  );
  return javaMain('com.alibaba.qwen.code.managedagent.store.WorkspaceCsiRegistrationMain', ['register', file], {
    K2_JDBC_URL: config.jdbcUrl,
    K2_JDBC_USER: config.jdbcUser,
    K2_JDBC_PASSWORD: config.jdbcPassword,
  });
}

async function operatorInspect(bindingId: string, generation: string) {
  const stateDirectory = path.join(path.dirname(configPath), 'runtime-state');
  return javaMain(
    'com.alibaba.qwen.code.managedagent.service.WorkspaceRecoveryCommand',
    ['inspect', bindingId, generation],
    {},
    [
      '-Dspring.datasource.url=' + config.jdbcUrl,
      '-Dspring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver',
      '-Dspring.datasource.username=' + config.jdbcUser,
      '-Dspring.datasource.password=' + config.jdbcPassword,
      '-Dqwen.managed-agent.runtime-broker.provisioner=local-process',
      '-Dqwen.managed-agent.runtime-broker.operator-recovery-enabled=true',
      '-Dqwen.managed-agent.runtime-broker.durable-local-process=true',
      '-Dqwen.managed-agent.runtime-broker.state-directory=' + stateDirectory,
      '-Dqwen.managed-agent.runtime-broker.credential-key-id=test',
      '-Dqwen.managed-agent.runtime-broker.credential-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    ],
  );
}

let cli = new HostedHarnessProcess();

async function call(sessionId: string, route: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown) {
  if (proxyFailure) throw proxyFailure;
  const response = await cli.request('/session/' + sessionId + route, {
    method,
    headers: { ...cli.headers(clients.get(sessionId)), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function open(entry: (typeof config.cases)[number], sessionId: string) {
  const response = await cli.request('/session', {
    method: 'POST',
    headers: { ...cli.headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      managedSessionStore: {
        baseUrl: proxyUrl,
        tenantId: config.tenantId,
        workspaceId: entry.workspaceId,
        writerId: cli.bootId,
        leaseDurationMs: 5_000,
      },
      toolProfile: 'hosted-workspace-shell/1',
      sessionId,
      sessionScope: 'thread',
    }),
  });
  const created = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 200, JSON.stringify(created));
  clients.set(sessionId, created['clientId'] as string);
}

async function turn(entry: (typeof config.cases)[number], sessionId: string, mode: 'text' | 'tool', n: number) {
  const before = (brokerOps.get(sessionId) ?? []).length;
  const content = [{ type: 'text', text: `VERIFY13289 case=${entry.name} mode=${mode} n=${n}` }];
  const admitted = await call(sessionId, '/prompt', 'POST', {
    promptId: randomUUID(),
    prompt: content,
    payloadDigest: 'sha256:' + createHash('sha256').update(JSON.stringify(content)).digest('hex'),
  });
  let idle = true;
  try {
    await waitUntil(async () => {
      const body = (await call(sessionId, '/status', 'GET')).body as { hasActivePrompt: boolean };
      return !body.hasActivePrompt;
    }, 120_000);
  } catch {
    idle = false;
  }
  const page = (await call(sessionId, '/transcript?limit=256', 'GET')).body as {
    events: Array<Record<string, unknown>>;
  };
  const tailEvents = page.events.slice(-6).map((event) => {
    const data = (event['data'] ?? {}) as Record<string, unknown>;
    return {
      type: event['type'],
      ...(event['type'] === 'turn_error' ? { code: data['code'], message: String(data['message'] ?? '').slice(0, 160) } : {}),
      ...(event['type'] === 'turn_complete' ? { stopReason: data['stopReason'] } : {}),
    };
  });
  const result = {
    session: sessionId.slice(0, 8),
    mode,
    n,
    admitted: admitted.status,
    idle,
    broker: (brokerOps.get(sessionId) ?? []).slice(before).filter((entry) => entry.op !== 'status'),
    transcriptTail: tailEvents.filter((event) => event.type !== 'message_part'),
    proof: await readFile(path.join(entry.directory, `proof-${n}.txt`), 'utf8').catch(() => null),
  };
  log(`${entry.name} turn`, result);
  return result;
}

async function observe(storageId: string, seconds: number, label: string) {
  const transitions: Array<{ at: number; states: string }> = [];
  const end = Date.now() + seconds * 1000;
  let last = '';
  while (Date.now() < end) {
    const rows = (await snapshot(storageId)).bindings;
    const states = rows.map((row) => `${String(row['binding_id']).slice(0, 8)}:g${row['runtime_generation']}:${row['binding_state']}`).join(',');
    if (states !== last) {
      transitions.push({ at: now(), states });
      last = states;
    }
    await sleep(2_000);
  }
  log(`${label} transitions`, transitions);
  return transitions;
}

const results: Record<string, Record<string, unknown>> = {};

async function waitReady(storageId: string) {
  try {
    await waitUntil(async () => (await snapshot(storageId)).bindings.some((row) => row['binding_state'] === 'READY'), 90_000);
    return true;
  } catch {
    return false;
  }
}

try {
  log('config', { phase: config.phase, database: config.database, tenant: config.tenantId });
  await cli.start(model.baseUrl, {
    extraArgs: ['--managed-runtime-broker-url', proxyUrl, '--managed-runtime-broker-token', 'hosted-tools-broker-token'],
  });
  if (config.phase === 1) {
    for (const entry of config.cases) {
      const result: Record<string, unknown> = {};
      results[entry.name] = result;
      const [s1] = entry.sessions as [string, string];
      await open(entry, s1);
      result['turn1'] = await turn(entry, s1, entry.name === 'toolfirst' ? 'tool' : 'text', 1);
      result['ready'] = await waitReady(entry.storageId);
      result['warmOps'] = (brokerOps.get(s1) ?? []).filter((op) => op.op !== 'status');
      result['afterTurn1'] = await snapshot(entry.storageId);
      log(`${entry.name} afterTurn1`, { ready: result['ready'], warmOps: result['warmOps'], ...(result['afterTurn1'] as object) });
      if (entry.name !== 'warmnoreg') {
        result['register'] = await registerCsi(entry);
        log(`${entry.name} operator CSI register`, result['register']);
        result['afterRegister'] = await snapshot(entry.storageId);
        log(`${entry.name} afterRegister`, result['afterRegister']);
      }
      if (entry.name === 'warmreg') result['turn2tool'] = await turn(entry, s1, 'tool', 2);
    }
    // A host reboot ends every worker; do the same to this run's workers.
    const workers = await workerPids();
    for (const pid of workers) process.kill(pid, 'SIGKILL');
    log('SIGKILL workers', workers);
    const transitions: Record<string, unknown> = {};
    await Promise.all(config.cases.map(async (entry) => {
      transitions[entry.name] = await observe(entry.storageId, config.observeSeconds, `${entry.name} boot-A after-kill`);
    }));
    results['bootA'] = { transitions };
    for (const entry of config.cases) {
      const snap = await snapshot(entry.storageId);
      results[entry.name]!['bootAFinal'] = snap;
      log(`${entry.name} bootA final`, snap);
      const original = snap.bindings[0];
      if (original && entry.name !== 'toolfirst') {
        const inspect = await operatorInspect(String(original['binding_id']), String(original['runtime_generation']));
        results[entry.name]!['operatorInspect'] = inspect;
        log(`${entry.name} operator inspect`, inspect);
      }
    }
  } else {
    const transitions: Record<string, unknown> = {};
    await Promise.all(config.cases.map(async (entry) => {
      transitions[entry.name] = await observe(entry.storageId, config.observeSeconds, `${entry.name} boot-B`);
    }));
    results['bootB'] = { transitions };
    for (const entry of config.cases) {
      const result: Record<string, unknown> = {};
      results[entry.name] = result;
      const [, s2] = entry.sessions as [string, string];
      await open(entry, s2);
      result['session2text'] = await turn(entry, s2, 'text', 3);
      result['ready'] = await waitReady(entry.storageId);
      result['final'] = await snapshot(entry.storageId);
      log(`${entry.name} bootB final`, { ready: result['ready'], ...(result['final'] as object) });
    }
  }
  if (proxyFailure) throw proxyFailure;
  await writeFile(configPath + '.results', JSON.stringify(results, null, 2));
  console.log('HOSTED_VERIFY13289_OK');
} catch (cause) {
  console.error('VERIFY13289 failure', cause, cli.output);
  await writeFile(configPath + '.results', JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await cli.close();
  await model.close();
  proxy.closeAllConnections();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
}
