// Live A/B: does the headline change (refuse fresh child allocation under
// sustained host load) actually hold at the PR head, and not at the base?
//
// Oracle independence: the harness reads /proc/loadavg and os.cpus().length
// itself and requires its OWN load ratio before probing, so both arms are
// judged against a measurement the PR cannot influence.
//
// Usage: ARM_DIR=<tree> ARM_LABEL=head|base EXTRA_ARGS= node live-ab.mjs
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ARM_DIR = process.env.ARM_DIR;
const ARM_LABEL = process.env.ARM_LABEL || 'head';
const EXTRA_ARGS = (process.env.EXTRA_ARGS || '').split(' ').filter(Boolean);
const OUT = process.env.OUT_JSON || path.resolve('live-ab-results.json');
const CLI = path.join(ARM_DIR, 'dist', 'cli.js');
const TOKEN = 'verify-token-18052';
const LOAD_TARGET = 2.05;
const CORES = os.cpus().length;

const results = [];
const logs = [];
function cell(id, expected, actual, pass, detail) {
  results.push({ id, arm: ARM_LABEL, expected, actual, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  logs.push(
    `${mark} ${id}  expected=${expected} actual=${JSON.stringify(actual)}${detail ? '  ' + detail : ''}`,
  );
  console.log(logs[logs.length - 1]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadRatio() {
  const one = Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
  return one / CORES;
}

function hdr(extra = {}) {
  return { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...extra };
}

async function req(base, method, p, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch(base + p, {
      method,
      headers: hdr(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: r.status, headers: Object.fromEntries(r.headers), json, text };
  } finally {
    clearTimeout(timer);
  }
}

function makeHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `v18052-${ARM_LABEL}-`));
  const home = path.join(root, 'home');
  const qwenHome = path.join(root, 'qwen');
  const workspace = path.join(root, 'ws');
  for (const d of [home, qwenHome, workspace]) fs.mkdirSync(d, { recursive: true });
  // No model is ever contacted in this harness; point the provider at a
  // closed local port so any accidental call fails fast and visibly.
  fs.writeFileSync(
    path.join(qwenHome, 'settings.json'),
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
  return {
    root,
    workspace,
    env: {
      ...process.env,
      HOME: home,
      QWEN_HOME: qwenHome,
      QWEN_RUNTIME_DIR: path.join(qwenHome, 'runtime'),
      VERIFY_UNUSED_KEY: 'unused',
      QWEN_CODE_SERVE: '',
      NO_COLOR: '1',
    },
  };
}

async function startDaemon(label, extraArgs) {
  const envs = makeHome();
  const daemon = spawn(
    process.execPath,
    [
      CLI,
      'serve',
      '--port', '0',
      '--hostname', '127.0.0.1',
      '--token', TOKEN,
      '--workspace', envs.workspace,
      '--initialize-timeout-ms', '60000',
      ...extraArgs,
    ],
    { cwd: envs.workspace, stdio: ['ignore', 'pipe', 'pipe'], env: envs.env },
  );
  let out = '';
  let err = '';
  daemon.stdout.on('data', (c) => (out += c.toString()));
  daemon.stderr.on('data', (c) => (err += c.toString()));
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} boot timeout\nstdout=${out}\nstderr=${err}`)),
      60000,
    );
    const check = () => {
      const m = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
      if (m) {
        clearTimeout(t);
        resolve(Number(m[1]));
      }
    };
    daemon.stdout.on('data', check);
    daemon.once('exit', (code) =>
      reject(new Error(`${label} exited ${code} before listening\nstdout=${out}\nstderr=${err}`)),
    );
  });
  return {
    label,
    daemon,
    base: `http://127.0.0.1:${port}`,
    port,
    envs,
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

async function waitForStatus(d, pred, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await req(d.base, 'GET', '/daemon/status');
      if (last.status === 200 && pred(last.json)) return last;
    } catch {
      /* daemon may still be wiring */
    }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${what}; last status=${JSON.stringify(last?.json?.runtime?.loadAdmission ?? null)}`);
}

const burners = [];
function startBurners(n) {
  for (let i = 0; i < n; i++) {
    const b = spawn('/usr/bin/nice', ['-n', '19', '/usr/bin/yes'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    burners.push(b);
  }
}
function stopBurners() {
  for (const b of burners.splice(0)) {
    try {
      b.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

async function main() {
  let d;
  try {
    d = await startDaemon(ARM_LABEL, EXTRA_ARGS);
    logs.push(`[${ARM_LABEL}] daemon listening on ${d.base} (cores=${CORES})`);

    const healthyStatus = await waitForStatus(
      d,
      (j) => j?.runtime !== undefined,
      60000,
      'first status',
    );
    // Give the 2 s sampler one tick before reading the admission verdict.
    await sleep(4000);
    const st1 = await req(d.base, 'GET', '/daemon/status');
    const la1 = st1.json?.runtime?.loadAdmission;

    // Healthy create on the documented fresh-child path.
    const createHealthy = await req(d.base, 'POST', '/standalone/sessions', {
      sessionId: (globalThis.SID_HEALTHY ??= randomUUID()),
    });
    cell(
      'healthy:standalone-create-admitted',
      200,
      createHealthy.status,
      createHealthy.status === 200,
    );

    // Load-admission status shape (head only has the section).
    if (ARM_LABEL === 'head') {
      cell(
        'head:status-has-loadAdmission',
        'enabled=true overloaded=false sampledAtMs>0',
        { enabled: la1?.enabled, overloaded: la1?.overloaded, sampledAtMs: la1?.sampledAtMs },
        la1?.enabled === true && la1?.overloaded === false && (la1?.sampledAtMs ?? 0) > 0,
      );
    } else {
      cell(
        'base:status-has-no-loadAdmission',
        'absent',
        la1 === undefined ? 'absent' : la1,
        la1 === undefined,
      );
    }

    // ---- apply real host load ----
    const n = Number(process.env.BURNERS || 30);
    startBurners(n);
    const loadDeadline = Date.now() + 150000;
    let ratio = loadRatio();
    while (ratio < LOAD_TARGET && Date.now() < loadDeadline) {
      await sleep(1000);
      ratio = loadRatio();
    }
    logs.push(`[${ARM_LABEL}] burner load ratio=${ratio.toFixed(2)} (${n} burners, ${CORES} cores)`);
    cell(`load:own-oracle-ratio>=${LOAD_TARGET}`, `>=${LOAD_TARGET}`, Number(ratio.toFixed(3)), ratio >= LOAD_TARGET);

    // ---- the headline cell ----
    if (ARM_LABEL === 'head') {
      await waitForStatus(
        d,
        (j) => j?.runtime?.loadAdmission?.overloaded === true,
        40000,
        'overload latch',
      ).catch((e) => logs.push(`[warn] ${e.message}`));
      const stT = await req(d.base, 'GET', '/daemon/status');
      const la = stT.json?.runtime?.loadAdmission;
      cell(
        'head:status-overloaded-latched',
        'overloaded=true',
        { overloaded: la?.overloaded, reason: la?.reason, loadRatio: la?.loadRatio },
        la?.overloaded === true,
      );
      const issue = (stT.json?.issues || []).find?.((i) => i.code === 'system_overloaded');
      cell(
        'head:status-issue-system_overloaded',
        'issues[] has code=system_overloaded',
        issue ? { code: issue.code, severity: issue.severity } : 'absent',
        Boolean(issue),
      );
    }

    const refused = await req(d.base, 'POST', '/standalone/sessions', {
      sessionId: (globalThis.SID_UNDERLOAD ??= randomUUID()),
    });
    if (ARM_LABEL === 'head') {
      cell(
        'head:standalone-create-refused-under-load',
        503,
        refused.status,
        refused.status === 503,
      );
      cell(
        'head:refusal-contract',
        'code=system_overloaded + Retry-After=15 + numeric loadRatio/eventLoopLagP99Ms',
        {
          code: refused.json?.code,
          retryAfter: refused.headers?.['retry-after'],
          loadRatio: refused.json?.loadRatio,
          eventLoopLagP99Ms: refused.json?.eventLoopLagP99Ms,
          reason: refused.json?.reason,
        },
        refused.json?.code === 'system_overloaded' &&
          refused.headers?.['retry-after'] === '15' &&
          typeof refused.json?.loadRatio === 'number' &&
          typeof refused.json?.eventLoopLagP99Ms === 'number',
      );
      cell(
        'head:refusal-quotes-real-load',
        `loadRatio >= ${LOAD_TARGET}`,
        refused.json?.loadRatio,
        (refused.json?.loadRatio ?? 0) >= LOAD_TARGET * 0.9,
      );
    } else {
      cell(
        'base:standalone-create-admitted-under-same-load',
        200,
        refused.status,
        refused.status === 200,
      );
    }

    // ---- control plane stays usable (head) ----
    if (ARM_LABEL === 'head') {
      const warmPrompt = await req(d.base, 'POST', `/session/${globalThis.SID_HEALTHY}/prompt`, {
        prompt: [{ type: 'text', text: 'ping' }],
      });
      cell(
        'head:warm-prompt-not-gated',
        'not 503 system_overloaded',
        { status: warmPrompt.status, code: warmPrompt.json?.code },
        !(warmPrompt.status === 503 && warmPrompt.json?.code === 'system_overloaded'),
      );
      const cancel = await req(d.base, 'POST', `/session/${globalThis.SID_HEALTHY}/cancel`, {});
      cell(
        'head:cancel-not-gated',
        'not 503 system_overloaded',
        { status: cancel.status, code: cancel.json?.code },
        !(cancel.status === 503 && cancel.json?.code === 'system_overloaded'),
      );
    }

    // ---- opt-out arm (head only) ----
    if (ARM_LABEL === 'head' && process.env.SKIP_OPTOUT !== '1') {
      const opt = await startDaemon('head-optout', ['--no-load-admission']);
      try {
        await waitForStatus(opt, (j) => j?.runtime !== undefined, 60000, 'optout status');
        await sleep(2500);
        const ost = await req(opt.base, 'GET', '/daemon/status');
        const ola = ost.json?.runtime?.loadAdmission;
        cell(
          'optout:status-disabled',
          'enabled=false overloaded=false',
          { enabled: ola?.enabled, overloaded: ola?.overloaded },
          ola?.enabled === false && ola?.overloaded === false,
        );
        const ocreate = await req(opt.base, 'POST', '/standalone/sessions', {
          sessionId: randomUUID(),
        });
        cell(
          'optout:create-admitted-under-load',
          200,
          ocreate.status,
          ocreate.status === 200,
        );
      } finally {
        opt.daemon.kill('SIGTERM');
        await sleep(1500);
      }
    }

    // ---- recovery (head) ----
    if (ARM_LABEL === 'head') {
      stopBurners();
      const recovDeadline = Date.now() + 180000;
      let rr = loadRatio();
      while (rr >= 1.0 && Date.now() < recovDeadline) {
        await sleep(2000);
        rr = loadRatio();
      }
      cell('recovery:own-oracle-ratio<1.0', '<1.0', Number(rr.toFixed(3)), rr < 1.0);
      const cleared = await waitForStatus(
        d,
        (j) => j?.runtime?.loadAdmission?.overloaded === false,
        60000,
        'overload clear',
      ).catch((e) => {
        logs.push(`[warn] ${e.message}`);
        return null;
      });
      const cla = cleared?.json?.runtime?.loadAdmission;
      cell(
        'recovery:overload-cleared',
        'overloaded=false',
        { overloaded: cla?.overloaded, reason: cla?.reason },
        cla?.overloaded === false,
      );
      // The refused caller-supplied id must be reusable (reservation released).
      const reuse = await req(d.base, 'POST', '/standalone/sessions', {
        sessionId: globalThis.SID_UNDERLOAD,
      });
      cell('recovery:refused-id-reused', 200, reuse.status, reuse.status === 200);
    }
  } finally {
    stopBurners();
    if (d) {
      d.daemon.kill('SIGTERM');
      await sleep(2000);
      if (d.daemon.exitCode === null) d.daemon.kill('SIGKILL');
      fs.writeFileSync(`${OUT}.${ARM_LABEL}.daemon.log`, `== stdout ==\n${d.out}\n== stderr ==\n${d.err}\n`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  fs.writeFileSync(OUT, JSON.stringify({ arm: ARM_LABEL, cores: CORES, loadTarget: LOAD_TARGET, passed, total: results.length, results, logs }, null, 2));
  console.log(`SUMMARY ${ARM_LABEL}: ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error('HARNESS ERROR', e);
  stopBurners();
  fs.writeFileSync(`${OUT}.${ARM_LABEL}.error`, String(e?.stack || e));
  process.exit(2);
});