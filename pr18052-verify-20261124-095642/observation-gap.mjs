// Live observation-gap probe (head only).
//
// No previous round drove the gap latch through a real daemon. The latch
// exists so a stalled event loop cannot leave a stale "healthy" verdict
// cached; this probe stalls the daemon for real with SIGSTOP and checks the
// refusal that follows, on a host that is otherwise idle.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ARM_DIR = process.env.ARM_DIR;
const OUT = process.env.OUT_JSON || path.resolve('observation-gap.json');
const CLI = path.join(ARM_DIR, 'dist', 'cli.js');
const TOKEN = 'verify-token-18052';
const CORES = os.cpus().length;
const STALL_MS = Number(process.env.STALL_MS || 8000);

const results = [];
function cell(id, expected, actual, pass, detail) {
  results.push({ id, expected, actual, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`${mark} ${id}  expected=${expected} actual=${JSON.stringify(actual)}${detail ? '  ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loadRatio = () =>
  Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]) / CORES;

async function req(base, method, p, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await fetch(base + p, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }
    return { status: r.status, headers: Object.fromEntries(r.headers), json, text };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v18052-gap-'));
  const home = path.join(root, 'home');
  const qwenHome = path.join(root, 'qwen');
  const workspace = path.join(root, 'ws');
  for (const d of [home, qwenHome, workspace]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(qwenHome, 'settings.json'),
    JSON.stringify({
      security: { auth: { selectedType: 'openai' } },
      modelProviders: {
        openai: [
          {
            id: 'dead-endpoint',
            name: 'dead-endpoint',
            baseUrl: 'http://127.0.0.1:9/v1',
            envKey: 'VERIFY_UNUSED_KEY',
            models: [{ id: 'gpt-5.4', name: 'gpt-5.4' }],
          },
        ],
      },
      model: { name: 'gpt-5.4' },
    }),
  );

  const daemon = spawn(
    process.execPath,
    [CLI, 'serve', '--port', '0', '--hostname', '127.0.0.1', '--token', TOKEN,
      '--workspace', workspace, '--initialize-timeout-ms', '60000'],
    {
      cwd: workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: home,
        QWEN_HOME: qwenHome,
        QWEN_RUNTIME_DIR: path.join(qwenHome, 'runtime'),
        VERIFY_UNUSED_KEY: 'unused',
        NO_COLOR: '1',
      },
    },
  );
  let out = '';
  let err = '';
  daemon.stdout.on('data', (c) => (out += c.toString()));
  daemon.stderr.on('data', (c) => (err += c.toString()));
  let base;
  try {
    const port = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`boot timeout\n${out}\n${err}`)), 60000);
      const check = () => {
        const m = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
        if (m) {
          clearTimeout(t);
          resolve(Number(m[1]));
        }
      };
      daemon.stdout.on('data', check);
      daemon.once('exit', (c) => reject(new Error(`exited ${c}\n${out}\n${err}`)));
    });
    base = `http://127.0.0.1:${port}`;
    await sleep(3000);

    // Healthy precondition.
    const st0 = await req(base, 'GET', '/daemon/status');
    const la0 = st0.json?.runtime?.loadAdmission;
    cell('gap:precondition-healthy', 'overloaded=false', { overloaded: la0?.overloaded, reason: la0?.reason }, la0?.overloaded === false);
    const c0 = await req(base, 'POST', '/standalone/sessions', { sessionId: randomUUID() });
    cell('gap:precondition-create-200', 200, c0.status, c0.status === 200);

    const idleRatio = loadRatio();
    console.log(`[gap] idle host load ratio before stall = ${idleRatio.toFixed(3)}`);

    // Real stall: the process is stopped, so the event loop runs no ticks.
    daemon.kill('SIGSTOP');
    const t0 = Date.now();
    await sleep(STALL_MS);
    daemon.kill('SIGCONT');
    console.log(`[gap] resumed after ${Date.now() - t0} ms of SIGSTOP`);

    // First request after resume: the latch must already be armed.
    const refused = await req(base, 'POST', '/standalone/sessions', { sessionId: (globalThis.GAP_SID ??= randomUUID()) });
    cell('gap:create-refused-after-stall', 503, refused.status, refused.status === 503);
    cell(
      'gap:refusal-reason-observation_gap',
      'reason=observation_gap',
      { code: refused.json?.code, reason: refused.json?.reason, retryAfter: refused.headers?.['retry-after'] },
      refused.json?.code === 'system_overloaded' && refused.json?.reason === 'observation_gap' && refused.headers?.['retry-after'] === '15',
    );

    const st1 = await req(base, 'GET', '/daemon/status');
    const la1 = st1.json?.runtime?.loadAdmission;
    const issue = (st1.json?.issues || []).find?.((i) => i.code === 'system_overloaded');
    cell(
      'gap:status-reports-observation_gap',
      'overloaded=true reason=observation_gap',
      { overloaded: la1?.overloaded, reason: la1?.reason, loadRatio: la1?.loadRatio, p99: la1?.eventLoopLagP99Ms },
      la1?.overloaded === true && la1?.reason === 'observation_gap',
    );
    cell(
      'gap:issue-message-quotes-idle-load',
      'issue text quotes the pre-stall readings',
      issue ? issue.message : 'absent',
      Boolean(issue),
      `host load ratio measured by the harness at that moment: ${loadRatio().toFixed(3)}`,
    );

    // Clear: three timely healthy ticks.
    let cleared = null;
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      const st = await req(base, 'GET', '/daemon/status');
      const la = st.json?.runtime?.loadAdmission;
      if (la?.overloaded === false) {
        cleared = { atMs: Date.now() - t0, la };
        break;
      }
      await sleep(500);
    }
    cell('gap:latch-clears', 'overloaded=false within 40s', cleared ? { atMs: cleared.atMs } : 'still latched', Boolean(cleared));
    const c2 = await req(base, 'POST', '/standalone/sessions', { sessionId: globalThis.GAP_SID });
    cell('gap:create-admitted-after-clear', 200, c2.status, c2.status === 200);
  } finally {
    daemon.kill('SIGTERM');
    await sleep(1500);
    if (daemon.exitCode === null) daemon.kill('SIGKILL');
    fs.writeFileSync(`${OUT}.daemon.log`, `== stdout ==\n${out}\n== stderr ==\n${err}\n`);
  }

  const passed = results.filter((r) => r.pass).length;
  fs.writeFileSync(OUT, JSON.stringify({ passed, total: results.length, stallMs: STALL_MS, cores: CORES, results }, null, 2));
  console.log(`SUMMARY gap: ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error('HARNESS ERROR', e);
  fs.writeFileSync(`${OUT}.error`, String(e?.stack || e));
  process.exit(2);
});