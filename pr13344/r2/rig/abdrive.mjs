// A/B driver for scripts/run-managed-agent-server-e2e.ts variants.
// Launches the runner through tsx in its own process group (Ctrl-C shape),
// watches the runner's direct children, and fires one trigger.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const opts = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1];
const label = opts.label;
const out = path.join(opts.out, label);
mkdirSync(out, { recursive: true });
const tsx = opts.tsx;
const runnerArgs = (opts.args ?? '').split(' ').filter(Boolean);
const trigger = opts.trigger ?? 'none';
const killAfter = Number(opts['kill-after'] ?? 900) * 1000;
const harnessGen = Number(opts['harness-gen'] ?? 1);
const env = { ...process.env };
if (opts.home) env.HOME = opts.home;
if (opts['mysql-pwd']) env.MYSQL_PWD = opts['mysql-pwd'];
if (opts['login-file']) env.MYSQL_TEST_LOGIN_FILE = opts['login-file'];
if (opts['keep-tmp']) env.QWEN_MANAGED_E2E_KEEP_TMP = '1';

const t0 = Date.now();
const ms = () => Date.now() - t0;
const events = [];
const note = (msg) => {
  events.push(`${(ms() / 1000).toFixed(2)}s ${msg}`);
};
let stdout = '';
let stderr = '';
const child = spawn(tsx, [opts.script, ...runnerArgs], {
  cwd: opts.cwd,
  env,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (c) => {
  stdout += c;
  if (trigger === 'sigint-on-stdout' && !fired && new RegExp(opts.match).test(stdout)) {
    fired = true;
    note(`stdout matched /${opts.match}/ (bytes=${stdout.length}, mainJsonPrinted=${stdout.includes('"sessionId"')}); sending SIGINT to group`);
    try { process.kill(-child.pid, 'SIGINT'); note(`sent SIGINT to process group ${child.pid}`); } catch (e) { note(`SIGINT failed ${e.code}`); }
  }
});
let errorNoted = false;
child.stderr.on('data', (c) => {
  stderr += c;
  if (!errorNoted && /Error: /.test(stderr)) {
    errorNoted = true;
    note(`first "Error:" on stderr: ${/Error: [^\n]*/.exec(stderr)[0].slice(0, 200)}`);
  }
});
note(`spawned tsx pid=${child.pid} cwd=${opts.cwd} script=${opts.script} args=${runnerArgs.join(' ')} trigger=${trigger}`);

const seen = new Map(); // pid -> {kind, cmd, gone}
let runnerPid;
let fired = false;
const tracked = new Set();
function psAll() {
  if (process.platform === 'linux') {
    const out = [];
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
        const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0').join(' ').trim();
        out.push({ pid: +d, ppid: +rest[1], stat: rest[0], cmd });
      } catch {}
    }
    return out;
  }
  const text = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,stat=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      return m && { pid: +m[1], ppid: +m[2], stat: m[3], cmd: m[4] };
    })
    .filter(Boolean);
}
function kindOf(cmd) {
  if (/\bmysqld\b/.test(cmd) && !/initialize/.test(cmd)) return 'mysqld';
  if (/java/.test(cmd) && /-jar/.test(cmd)) return 'spring';
  if (/dist\/cli\.js/.test(cmd) && /\bserve\b/.test(cmd)) return 'harness';
  return 'other';
}
function signal(pid, sig) {
  try {
    process.kill(pid, sig);
    note(`sent ${sig} to pid ${pid}`);
  } catch (e) {
    note(`failed ${sig} to ${pid}: ${e.code}`);
  }
}
let harnessGone = 0;
let springGone = 0;
let listenWatch;
function springPort(pid) {
  try {
    const text = execFileSync('ps', ['-wwE', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    return text.match(/\bSERVER_PORT=(\d+)/)?.[1];
  } catch {
    return undefined;
  }
}
const poll = setInterval(() => {
  let procs;
  try {
    procs = psAll();
  } catch {
    return;
  }
  if (runnerPid === undefined && opts.direct) {
    runnerPid = child.pid;
    note(`runner pid=${runnerPid} (direct)`);
  }
  if (runnerPid === undefined) {
    const r = procs.find((p) => p.ppid === child.pid && /node/.test(p.cmd));
    if (r) {
      runnerPid = r.pid;
      note(`runner pid=${runnerPid}`);
    }
    return;
  }
  const live = new Set();
  for (const p of procs.filter((p) => p.ppid === runnerPid)) {
    live.add(p.pid);
    if (!seen.has(p.pid)) {
      const kind = kindOf(p.cmd);
      seen.set(p.pid, { kind, cmd: p.cmd.slice(0, 800), gone: false });
      tracked.add(p.pid);
      note(`child up ${kind} pid=${p.pid}`);
      if (trigger === 'freeze-spring-at-start' && kind === 'spring' && !fired) {
        fired = true;
        signal(p.pid, 'SIGSTOP');
      }
      if (trigger === 'freeze-spring-at-listen' && kind === 'spring' && !fired && !listenWatch) {
        const pid = p.pid;
        const startWatch = () => {
          const port = springPort(pid);
          if (!port) return setTimeout(startWatch, 20);
          note(`spring SERVER_PORT=${port}; probing connect every 5ms`);
          listenWatch = setInterval(() => {
            const s = net.connect({ host: '127.0.0.1', port: +port });
            s.on('connect', () => {
              s.destroy();
              if (fired) return;
              fired = true;
              clearInterval(listenWatch);
              signal(pid, 'SIGSTOP');
              note('spring frozen right after its listener accepted a connection');
            });
            s.on('error', () => {});
          }, 5);
        };
        startWatch();
      }
    }
  }
  if (trigger === 'kill-spring-at-inflight' && !fired) {
    // Outside actor (OOM-killer shape): SIGKILL the original Spring once the
    // in-flight boundary is durable (PREPARED execution + checkpoint).
    const m = [...seen].find(([, v]) => v.kind === 'mysqld' && !v.gone);
    const sp = [...seen].find(([, v]) => v.kind === 'spring' && !v.gone);
    const port = m && /--port=(\d+)/.exec(m[1].cmd)?.[1];
    if (port && sp) {
      const q = spawnSync('mysql', ['--no-defaults', '--protocol=tcp', '-h127.0.0.1', `-P${port}`, '-uroot', '-N', '-B', '-e',
        "SELECT (SELECT COUNT(*) FROM qwen_managed_agent.qwen_tool_execution WHERE execution_state='PREPARED') > 0 AND (SELECT COUNT(*) FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE latest_checkpoint_resource_id IS NOT NULL) > 0"],
        { encoding: 'utf8', timeout: 2000 });
      if (q.stdout?.trim() === '1') {
        fired = true;
        note('in-flight boundary durable (PREPARED execution + checkpoint)');
        signal(sp[0], 'SIGKILL');
        note('original Spring killed by an outside SIGKILL before the runner injects its crash');
      }
    }
  }
  for (const [pid, info] of seen) {
    if (!info.gone && !live.has(pid)) {
      info.gone = true;
      note(`child gone ${info.kind} pid=${pid}`);
      if (info.kind === 'harness') {
        harnessGone += 1;
        if (trigger === 'sigint-teardown' && !fired && harnessGone === harnessGen) {
          fired = true;
          note(`teardown trigger: stdout bytes so far=${stdout.length} jsonPrinted=${stdout.includes('"sessionId"')}`);
          try {
            process.kill(-child.pid, 'SIGINT');
            note(`sent SIGINT to process group ${child.pid} (Ctrl-C shape)`);
          } catch (e) {
            note(`SIGINT group failed ${e.code}`);
          }
        }
      }
      if (info.kind === 'spring') {
        springGone += 1;
        if (trigger === 'freeze-mysql-at-lease' && !fired && springGone === 1) {
          fired = true;
          const m = [...seen].find(([, v]) => v.kind === 'mysqld' && !v.gone);
          if (m) {
            signal(m[0], 'SIGSTOP');
            note('mysqld frozen right after the original Spring died (before the lease poll)');
          }
        }
      }
    }
  }
}, 40);

// Fast trigger: the runner's post-hold checks (boot id, journal head,
// execution row, checkpoint) run as mysql children between observing the
// held execution start and injecting its own crash. SIGKILL the original
// Spring from outside the moment one of them appears.
let fastWatch;
if (trigger === 'kill-spring-after-hold' && process.platform === 'linux') {
  const marks = [
    'SELECT harness_boot_id FROM qwen_managed_agent.managed_agent_session',
    'SELECT writer_generation, journal_revision, committed_sequence FROM qwen_managed_agent.qwen_managed_session_journal_head',
    'SELECT latest_checkpoint_resource_id',
  ];
  fastWatch = setInterval(() => {
    if (fired || runnerPid === undefined) return;
    let kids = [];
    try {
      kids = readFileSync(`/proc/${runnerPid}/task/${runnerPid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean);
    } catch { return; }
    for (const k of kids) {
      let cmd = '';
      try { cmd = readFileSync(`/proc/${k}/cmdline`, 'utf8').split('\0').join(' '); } catch { continue; }
      const mark = marks.find((m) => cmd.includes(m));
      if (!mark) continue;
      const sp = [...seen].find(([, v]) => v.kind === 'spring' && !v.gone);
      if (!sp) return;
      fired = true;
      note(`runner post-hold check seen (${mark.slice(7, 40)}...): held start observed by the runner`);
      signal(sp[0], 'SIGKILL');
      note('original Spring killed by an outside SIGKILL before the runner injects its crash');
      return;
    }
  }, 5);
}
const killTimer = setTimeout(() => {
  note(`kill-after ${killAfter / 1000}s reached: runner still running`);
  // Resume anything we froze, then interrupt the run so it tears down.
  for (const [pid, info] of seen) if (!info.gone) signal(pid, 'SIGCONT');
  try {
    process.kill(-child.pid, 'SIGINT');
    note('sent SIGINT to group after kill-after');
  } catch {}
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
      note('sent SIGKILL to group');
    } catch {}
  }, 60_000);
}, killAfter);

child.on('exit', (code, sig) => {
  clearInterval(poll);
  clearTimeout(killTimer);
  if (fastWatch) clearInterval(fastWatch);
  if (listenWatch) clearInterval(listenWatch);
  note(`tsx exit code=${code} signal=${sig}`);
  setTimeout(() => {
    // Leftover processes we tracked (by PID only).
    const procs = psAll();
    const left = procs.filter((p) => tracked.has(p.pid));
    for (const p of left) {
      note(`leftover pid=${p.pid} stat=${p.stat} ${kindOf(p.cmd)}; killing`);
      try {
        process.kill(p.pid, 'SIGCONT');
        process.kill(p.pid, 'SIGKILL');
      } catch {}
    }
    const result = {
      label,
      exitCode: code,
      exitSignal: sig,
      elapsedSec: +(ms() / 1000).toFixed(1),
      triggerFired: fired,
      jsonOnStdout: stdout.includes('"sessionId"'),
      interruptedMessage: /Interrupted by SIG\w+/.exec(stderr)?.[0] ?? null,
      keptTmp: /Keeping temporary directory: (\S+)/.exec(stderr)?.[1] ?? null,
      leftovers: left.length,
    };
    writeFileSync(path.join(out, 'stdout.txt'), stdout);
    writeFileSync(path.join(out, 'stderr.txt'), stderr);
    writeFileSync(path.join(out, 'events.txt'), events.join('\n') + '\n');
    writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(`RESULT ${JSON.stringify(result)}`);
    process.exit(0);
  }, 1500);
});
