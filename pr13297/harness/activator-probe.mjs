// PR 13297 activator probe: real node worker processes, real filesystem
// failures (chmod -> EACCES on rm), real process trees. No mocks.
// usage: node probe.mjs <repo-worktree> <scenario>
import { chmod, mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, scenario] = process.argv.slice(2);
const { LocalProcessRuntimeActivator } = await import(
  pathToFileURL(
    path.join(repo, 'packages/cli/dist/src/serve/local-process-runtime-activator.js'),
  ).href
);
setTimeout(() => {
  console.log('RESULT probe_timeout = true');
  process.exit(3);
}, 120_000).unref();
const result = (key, value) => console.log(`RESULT ${key} = ${JSON.stringify(value)}`);

// The worker records its pid (and, for the env scenario, its whole env) under
// QWEN_HOME, which is on the allowlist. `stubborn` ignores SIGTERM and keeps a
// `sleep` grandchild in its process group.
const worker = (stubborn) => `
const fs = require('node:fs');
const cp = require('node:child_process');
const home = process.env.QWEN_HOME;
process.on('message', b => {
  if (b.type === 'shutdown') process.exit(0);
  if (b.type !== 'boot') return;
  const info = { pid: process.pid, env: process.env };
  ${stubborn ? "const g = cp.spawn('sleep', ['600'], { stdio: 'ignore' }); info.grandchild = g.pid;" : ''}
  fs.writeFileSync(home + '/' + b.workspaceId + '.json', JSON.stringify(info));
  process.send({ ...b, token: undefined, type: 'ready', url: 'http://127.0.0.1:12345' });
});
process.on('disconnect', () => {${stubborn ? '' : ' process.exit(0); '}});
process.on('SIGTERM', () => {${stubborn ? '' : ' process.exit(0); '}});
${stubborn ? 'setInterval(() => {}, 1000);' : ''}
`;

const stateDir = await mkdtemp(path.join(os.tmpdir(), 'pr13297-activator-'));
const home = path.join(stateDir, 'home');
await mkdir(home);
const scope = (id) => ({
  tenantId: 'tenant',
  runtime: { workspaceId: id, workspaceCwd: os.tmpdir(), trusted: true },
});
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const info = async (id) => JSON.parse(await readFile(path.join(home, `${id}.json`), 'utf8'));
const outcome = (p) =>
  p.then(
    () => 'started',
    (e) => `refused:${e?.code ?? e?.message}`,
  );
result('stateDir', stateDir);

if (scenario === 'slot') {
  // R2-9: a worker whose outputRoot rm fails (real EACCES) must not keep its
  // capacity slot after the filesystem heals.
  const activator = new LocalProcessRuntimeActivator({
    stateDir,
    cliEntry: process.execPath,
    launcher: ['-e', worker(false)],
    env: { ...process.env, QWEN_HOME: home },
    maxWorkers: 1,
    startupMs: 15_000,
    log: () => {},
  });
  const a = scope('a');
  const useA = activator.activate(a);
  await useA.endpoint;
  const pidA = (await info('a')).pid;
  const workers = path.join(stateDir, 'workers');
  await chmod(workers, 0o500);
  const revoked = await activator.revokeWorkspace(a.runtime).then(
    () => 'resolved',
    (e) => `rejected:${e?.code ?? e?.message}`,
  );
  await chmod(workers, 0o700);
  useA.release('completed');
  result('revoke_with_rm_EACCES', revoked);
  result('worker_a_alive_after_revoke', alive(pidA));
  result('filesystem_healed_leftover_dirs', (await readdir(workers)).length);
  const b = scope('b');
  result('activate_b_immediately', await outcome(activator.activate(b).endpoint));
  await new Promise((r) => setTimeout(r, 3000));
  result('activate_b_again_after_3s', await outcome(activator.activate(b).endpoint));
  result('close', await activator.close().then(() => 'resolved', (e) => `rejected:${e?.code ?? e?.message}`));
  process.exit(0);
}

if (scenario === 'close') {
  // R2-2: one generation's cleanup already failed (real EACCES); close() must
  // still wait for the other generation's tree to die before it settles. The
  // caller exits right after close() settles.
  const activator = new LocalProcessRuntimeActivator({
    stateDir,
    cliEntry: process.execPath,
    launcher: ['-e', worker(true)],
    env: { ...process.env, QWEN_HOME: home },
    maxWorkers: 2,
    startupMs: 15_000,
    log: () => {},
  });
  const a = scope('a');
  const b = scope('b');
  const useA = activator.activate(a);
  const useB = activator.activate(b);
  await Promise.all([useA.endpoint, useB.endpoint]);
  const ia = await info('a');
  const ib = await info('b');
  result('pids', { a: ia.pid, a_grandchild: ia.grandchild, b: ib.pid, b_grandchild: ib.grandchild });
  const workers = path.join(stateDir, 'workers');
  await chmod(workers, 0o500);
  const revoked = await activator.revokeWorkspace(a.runtime).then(
    () => 'resolved',
    (e) => `rejected:${e?.code ?? e?.message}`,
  );
  await chmod(workers, 0o700);
  useA.release('completed');
  useB.release('completed');
  result('revoke_a_with_rm_EACCES', revoked);
  const t0 = Date.now();
  const closed = await activator.close().then(
    () => 'resolved',
    (e) => `rejected:${e?.code ?? e?.message}`,
  );
  result('close', closed);
  result('close_ms', Date.now() - t0);
  result('b_alive_when_close_settled', alive(ib.pid));
  result('b_grandchild_alive_when_close_settled', alive(ib.grandchild));
  // The caller exits as soon as close() settles.
  process.exit(0);
}

if (scenario === 'env') {
  // R1-6 / R2-7: what a real spawned worker observes.
  const secrets = {
    OPENAI_API_KEY: 'sk-probe',
    DASHSCOPE_API_KEY: 'probe',
    QWEN_SERVER_TOKEN: 'probe',
    GITHUB_TOKEN: 'probe',
    AWS_SECRET_ACCESS_KEY: 'probe',
    NODE_OPTIONS: '--require=/tmp/evil.js',
    Https_Proxy: 'http://proxy.example:8080',
    no_proxy: 'localhost',
    Lang: 'C.UTF-8',
  };
  const activator = new LocalProcessRuntimeActivator({
    stateDir,
    cliEntry: process.execPath,
    launcher: ['-e', worker(false)],
    env: { ...process.env, ...secrets, QWEN_HOME: home, QWEN_CODE_TRUSTED_FOLDERS_PATH: 'relative/trusted.json' },
    maxWorkers: 1,
    startupMs: 15_000,
    log: () => {},
  });
  const use = activator.activate(scope('e'));
  await use.endpoint;
  const seen = (await info('e')).env;
  result('leaked_secrets', Object.keys(secrets).filter((k) => /KEY|TOKEN|SECRET|NODE_OPTIONS/.test(k) && k in seen));
  result('case_variant_names_forwarded', ['Https_Proxy', 'no_proxy', 'Lang'].filter((k) => k in seen));
  result('PATH_forwarded', 'PATH' in seen);
  result('trusted_folders_path', seen.QWEN_CODE_TRUSTED_FOLDERS_PATH);
  use.release('completed');
  await activator.close().catch(() => {});
  process.exit(0);
}
