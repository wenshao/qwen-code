// VERIFICATION RIG ONLY (PR #13166): the worker-local sibling-ownership checks on a REAL built
// Runtime worker process. The Java Broker refuses Workspace mounts unless isolation is per Session,
// so it never installs two Sessions in one worker; this drives `node dist/<arm>/cli.js
// managed-runtime-worker` directly (boot v2 over stdin, workspace-capability digest, loopback HTTP,
// real directories), the topology a workspace-isolated provisioner would produce.
// usage: ARM=head|base node w1-worker.mjs [caseFilter]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

const RIG = '/root/verify/pr13166/rig';
const ARM = process.env.ARM ?? 'head';
const CLI_DIST = '/root/verify/pr13166/head/packages/cli/dist/src/serve';
const { WORKSPACE_CAPABILITY_DIGEST, WORKSPACE_CONTEXT_CONFIG_REF, WORKSPACE_EXECUTION_PROFILE, WORKSPACE_ACTIVATION_ROUTE } =
  await import(`${CLI_DIST}/managed-workspace-activation.js`);
const { computeManagedContextDigest } = await import(`${CLI_DIST}/managed-workspace-binding.js`);
const { MANAGED_CONTEXT_PROTOCOL } = await import(`${CLI_DIST}/managed-context-envelope.js`);

const OUT = `${RIG}/out/w1`;
fs.mkdirSync(OUT, { recursive: true });
const jsonl = `${OUT}/w1-${ARM}.jsonl`;
const logf = `${OUT}/w1-${ARM}.log`;
fs.writeFileSync(jsonl, '');
fs.writeFileSync(logf, `# w1-worker arm=${ARM} cli=${fs.realpathSync(`${RIG}/dist/${ARM}`)}/cli.js ${new Date().toISOString()}\n`);
const say = (s) => {
  console.log(s);
  fs.appendFileSync(logf, s + '\n');
};

const BOOT = {
  type: 'boot',
  version: 2,
  managedContext: MANAGED_CONTEXT_PROTOCOL,
  capabilityDigest: WORKSPACE_CAPABILITY_DIGEST,
  epoch: 4,
  isolationClass: 'workspace',
  leaseId: 'lease-01',
  provisionRequestId: 'provision-01',
  runtimeIncarnation: 'boot-01',
  runtimeInstanceId: 'runtime-01',
  storageId: 'storage://pvc/workspace-a',
  tenantId: 'tenant-a',
  token: 'rig-13166-worker-token',
  workspaceGeneration: '7',
  workspaceId: 'workspace-a',
};
const HEADERS = {
  authorization: `Bearer ${BOOT.token}`,
  'cache-control': 'no-store',
  'content-type': 'application/json',
  'x-qwen-managed-lease-id': BOOT.leaseId,
  'x-qwen-managed-lease-epoch': String(BOOT.epoch),
};
const CONTEXT = '/internal/managed-runtime/v3/context';
const EXECUTE = '/internal/managed-runtime/v2/execute';

async function startWorker(mountRoot) {
  const child = spawn(process.execPath, [`${RIG}/dist/${ARM}/cli.js`, 'managed-runtime-worker'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: path.dirname(mountRoot), TMPDIR: process.env.TMPDIR ?? '/tmp' },
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  child.stdin.end(JSON.stringify({ ...BOOT, mountRoot }));
  const rl = createInterface({ input: child.stdout });
  const ready = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`worker not ready: ${stderr}`)), 30_000);
    rl.once('line', (l) => {
      clearTimeout(t);
      resolve(JSON.parse(l));
    });
    child.once('exit', (c) => reject(new Error(`worker exited ${c}: ${stderr}`)));
  });
  return {
    pid: child.pid,
    url: ready.url,
    async close() {
      child.kill('SIGTERM');
      const code = await new Promise((r) => (child.exitCode !== null ? r(child.exitCode) : child.once('exit', (c, s) => r(c ?? s))));
      return code;
    },
  };
}
const post = (origin, route, body) =>
  fetch(`${origin}${route}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });

function installation(sessionId, cwdRelative) {
  const binding = {
    tenantId: BOOT.tenantId,
    workspaceId: BOOT.workspaceId,
    workspaceGeneration: BOOT.workspaceGeneration,
    storageId: BOOT.storageId,
    cwdRelative,
    contextConfigRef: WORKSPACE_CONTEXT_CONFIG_REF,
    contextRevision: '1',
  };
  return {
    protocolVersion: 3,
    managedContext: MANAGED_CONTEXT_PROTOCOL,
    operationId: `op-${sessionId}`,
    sessionId,
    binding,
    contextDigest: computeManagedContextDigest(binding),
  };
}
async function install(origin, sessionId, cwdRelative, activate = true) {
  const req = installation(sessionId, cwdRelative);
  const a = await post(origin, CONTEXT, req);
  let b = { status: '-' };
  if (activate)
    b = await post(origin, WORKSPACE_ACTIVATION_ROUTE.path, {
      protocolVersion: 1,
      operation: 'activate',
      sessionId,
      contextDigest: req.contextDigest,
      contextConfigRef: WORKSPACE_CONTEXT_CONFIG_REF,
      profile: WORKSPACE_EXECUTION_PROFILE,
    });
  return `${sessionId}@${cwdRelative} install=${a.status} activate=${b.status}`;
}

let callN = 0;
function makeMount(caseName, dirs, files = {}, links = {}) {
  const base = `${RIG}/run/w1/${ARM}/${caseName}`;
  fs.rmSync(base, { recursive: true, force: true });
  const root = `${base}/mount`;
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), c);
  }
  for (const [l, t] of Object.entries(links)) fs.symlinkSync(t, path.join(root, l));
  return fs.realpathSync(root);
}

const results = [];
async function exec(c, origin, mount, sessionId, toolName, input, note = '') {
  const callId = `call-${++callN}`;
  const r = await post(origin, EXECUTE, {
    protocolVersion: 2,
    reference: { sessionId, promptId: 'prompt-1', callId, argsDigest: `digest-${callId}` },
    toolName,
    input,
  });
  const body = await r.json().catch(() => ({}));
  const res = body.result ?? {};
  const status = res.executionStatus ?? `http-${r.status}`;
  const text =
    res.error?.message ??
    (typeof res.output === 'string' ? res.output : JSON.stringify(res.output ?? res.llmContent ?? body));
  const raw = JSON.stringify(body);
  const row = {
    arm: ARM,
    case: c,
    session: sessionId,
    tool: toolName,
    input,
    status,
    text: String(text).replaceAll(mount, '<MOUNT>'),
    leaksMount: raw.includes(mount),
    note,
  };
  results.push(row);
  fs.appendFileSync(jsonl, JSON.stringify(row) + '\n');
  say(
    `  ${sessionId.padEnd(12)} ${toolName}(${JSON.stringify(input)}) -> ${status}${row.leaksMount ? ' [LEAKS MOUNT PATH]' : ''} :: ${row.text.replace(/\n/g, '\\n').slice(0, 170)}`,
  );
  return row;
}

const CASES = {
  // R10-1: a build-time failure must not beat the boundary refusal.
  async r10_build_vs_boundary(c) {
    const m = makeMount(c, ['services/api/src', 'services/web/assets'], { 'services/web/secret.txt': 'SIBLING' });
    const w = await startWorker(m);
    say(`  ${await install(w.url, 'session-1', 'services/api')}; ${await install(w.url, 'session-2', 'services/web', false)}`);
    await exec(c, w.url, m, 'session-1', 'write_file', { file_path: '../web', content: 'x' }, 'sibling dir as write target');
    await exec(c, w.url, m, 'session-1', 'write_file', { file_path: '../web/assets', content: 'x' }, 'sibling subdir');
    await exec(c, w.url, m, 'session-1', 'write_file', { file_path: '../web/nope', content: 'x' }, 'sibling non-dir (control)');
    await exec(c, w.url, m, 'session-1', 'read_file', { file_path: '../web/x.ipynb', offset: 1 }, 'ipynb+offset build error');
    say(`  fs: services/web/nope exists=${fs.existsSync(`${m}/services/web/nope`)}; worker exit=${await w.close()}`);
  },
  // R11-1: root-bound Session, glob aimed at a sibling estate via `path`.
  async r11_1_glob_input(c) {
    const m = makeMount(c, ['services/api/src', 'shared'], { 'services/api/src/index.ts': 'API_SECRET', 'shared/note.txt': 'shared text' });
    const w = await startWorker(m);
    say(`  ${await install(w.url, 'session-root', '.')}; ${await install(w.url, 'session-1', 'services/api', false)}`);
    await exec(c, w.url, m, 'session-root', 'glob', { pattern: '**/*.ts', path: 'services/api' }, 'matched');
    await exec(c, w.url, m, 'session-root', 'glob', { pattern: '**/*.md', path: 'services/api' }, 'unmatched');
    await exec(c, w.url, m, 'session-root', 'glob', { pattern: '**/*.txt', path: 'shared' }, 'unowned control');
    say(`  worker exit=${await w.close()}`);
  },
  // Same oracle through the PATTERN instead of `path` (no `path`): is it closed too?
  async r11_1_glob_pattern_oracle(c) {
    const m = makeMount(c, ['services/api/src', 'shared'], {
      'services/api/src/index.ts': 'API_SECRET',
      'services/api/src/billing-v2.ts': 'API_SECRET',
      'shared/note.txt': 'shared text',
      'README.md': 'root readme',
    });
    const w = await startWorker(m);
    say(`  ${await install(w.url, 'session-root', '.')}; ${await install(w.url, 'session-1', 'services/api', false)}`);
    await exec(c, w.url, m, 'session-root', 'glob', { pattern: 'services/api/**/billing-v2.ts' }, 'name exists in sibling');
    await exec(c, w.url, m, 'session-root', 'glob', { pattern: 'services/api/**/billing-v3.ts' }, 'name absent in sibling');
    await exec(c, w.url, m, 'session-root', 'glob', { pattern: 'services/api/src/b*' }, 'prefix probe: b*');
    await exec(c, w.url, m, 'session-root', 'glob', { pattern: 'services/api/src/c*' }, 'prefix probe: c*');
    await exec(c, w.url, m, 'session-root', 'read_file', { file_path: 'services/api/src/billing-v2.ts' }, 'read same file (control)');
    await exec(c, w.url, m, 'session-root', 'read_file', { file_path: 'services/api/src/billing-v3.ts' }, 'read absent file (control)');
    say(`  worker exit=${await w.close()}`);
  },
  // R11-2: escaped and unescaped spellings of one link into a sibling.
  async r11_2_escaped_path(c) {
    const m = makeMount(c, ['services/api', 'services/web'], { 'services/web/secret.txt': 'SIBLING' }, { 'services/api/shared notes': '../web' });
    const w = await startWorker(m);
    say(`  ${await install(w.url, 'session-1', 'services/api')}; ${await install(w.url, 'session-2', 'services/web', false)}`);
    await exec(c, w.url, m, 'session-1', 'glob', { pattern: '*', path: 'shared notes' }, 'unescaped');
    await exec(c, w.url, m, 'session-1', 'glob', { pattern: '*', path: 'shared\\ notes' }, 'escaped');
    say(`  worker exit=${await w.close()}`);
  },
  // R11-3: ancestor Session vs a Session installed strictly below it.
  async r11_3_nested(c) {
    const m = makeMount(c, ['services/api/src', 'services/docs', 'shared'], {
      'services/api/src/index.ts': 'NESTED_PRIVATE',
      'services/docs/guide.md': 'ancestor own md',
      'services/top.ts': 'ancestor own ts',
      'shared/note.txt': 'shared text',
    });
    const w = await startWorker(m);
    say(`  ${await install(w.url, 'session-a', 'services')}; ${await install(w.url, 'session-b', 'services/api')}`);
    await exec(c, w.url, m, 'session-a', 'read_file', { file_path: 'api/src/index.ts' }, 'ancestor reads nested estate');
    await exec(c, w.url, m, 'session-a', 'write_file', { file_path: 'api/src/pwned.txt', content: 'pwned' }, 'ancestor writes nested estate');
    await exec(c, w.url, m, 'session-a', 'edit', { file_path: 'api/src/index.ts', old_string: 'NESTED_PRIVATE', new_string: 'EDITED' }, 'ancestor edits nested estate');
    await exec(c, w.url, m, 'session-a', 'glob', { pattern: '**/*.ts' }, 'ancestor broad glob');
    await exec(c, w.url, m, 'session-b', 'read_file', { file_path: 'src/index.ts' }, 'nested reads own (control)');
    await exec(c, w.url, m, 'session-a', 'read_file', { file_path: 'top.ts' }, 'ancestor reads own (control)');
    await exec(c, w.url, m, 'session-a', 'read_file', { file_path: '../shared/note.txt' }, 'ancestor shared (control)');
    say(
      `  fs: api/src/pwned.txt exists=${fs.existsSync(`${m}/services/api/src/pwned.txt`)}; index.ts=${JSON.stringify(fs.readFileSync(`${m}/services/api/src/index.ts`, 'utf8'))}; worker exit=${await w.close()}`,
    );
  },
  // What the ancestor can still do / learn with glob once a nested Session exists.
  async r11_3_ancestor_glob(c) {
    const m = makeMount(c, ['services/api/src', 'services/docs'], {
      'services/api/src/index.ts': 'NESTED_PRIVATE',
      'services/api/src/billing-v2.ts': 'NESTED_PRIVATE',
      'services/docs/guide.md': 'ancestor own md',
      'services/top.ts': 'ancestor own ts',
    });
    const w = await startWorker(m);
    say(`  ${await install(w.url, 'session-a', 'services')}; ${await install(w.url, 'session-b', 'services/api', false)}`);
    await exec(c, w.url, m, 'session-a', 'glob', { pattern: '**/*.md' }, 'own-only type');
    await exec(c, w.url, m, 'session-a', 'glob', { pattern: '*.ts' }, 'own top level');
    await exec(c, w.url, m, 'session-a', 'glob', { pattern: '**/*' }, 'everything');
    await exec(c, w.url, m, 'session-a', 'glob', { pattern: 'api/**/billing-v2.ts' }, 'name exists in nested');
    await exec(c, w.url, m, 'session-a', 'glob', { pattern: 'api/**/billing-v3.ts' }, 'name absent in nested');
    say(`  worker exit=${await w.close()}`);
  },
};

const filter = process.argv[2];
for (const [name, fn] of Object.entries(CASES)) {
  if (filter && !name.includes(filter)) continue;
  say(`== ${name} (arm ${ARM})`);
  try {
    await fn(name);
  } catch (e) {
    say(`  CASE ERROR ${e.stack}`);
  }
}
say(`# ${results.length} calls recorded -> ${jsonl}`);
