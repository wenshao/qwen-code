// Times three teardown implementations against four child behaviours.
// The two "main" implementations are copied verbatim from main 302e7d88ef;
// stopDaemon is imported from the PR's shared module.
import { spawn, type ChildProcess } from 'node:child_process';
import { stopDaemon } from '../integration-tests/helpers/daemon-process.js';

const DISPOSE_GRACE_MS = 5_000;

// main: integration-tests/cli/_daemon-harness.ts, dispose()
function mainHarnessDispose(daemon: ChildProcess) {
  return async () => {
    if (daemon.exitCode !== null) return;
    daemon.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          daemon.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        resolve();
      }, DISPOSE_GRACE_MS);
      daemon.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  };
}

// main: integration-tests/helpers/hosted-harness-process.ts, exited + close()
function mainHostedClose(child: ChildProcess) {
  const exited = new Promise<void>((resolve) => {
    child.once('error', () => resolve());
    child.once('close', () => resolve());
  });
  return async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child?.kill('SIGKILL'), 3_000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

const children = {
  'exits on SIGTERM': 'setInterval(() => {}, 1000)',
  'ignores SIGTERM': "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
  'already killed by SIGKILL': 'setInterval(() => {}, 1000)',
  'already exited (code 0)': '',
};
const impls = {
  'main harness dispose': mainHarnessDispose,
  'main Hosted close': mainHostedClose,
  'PR stopDaemon': (c: ChildProcess) => () => stopDaemon(c),
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const rows = [];
for (const [behaviour, code] of Object.entries(children)) {
  for (const [impl, make] of Object.entries(impls)) {
    const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
    const teardown = make(child); // created at spawn time, as in the helpers
    await new Promise((r) => setTimeout(r, 300));
    if (behaviour === 'already killed by SIGKILL') {
      child.kill('SIGKILL');
      await new Promise((r) => child.once('exit', r));
    }
    if (behaviour === 'already exited (code 0)' && child.exitCode === null)
      await new Promise((r) => child.once('exit', r));
    const t0 = performance.now();
    await teardown();
    const ms = Math.round(performance.now() - t0);
    const exitedAtResolve = child.exitCode !== null || child.signalCode !== null;
    const pidAliveAtResolve = alive(child.pid!);
    rows.push({ behaviour, impl, ms, exitedAtResolve, pidAliveAtResolve });
    if (alive(child.pid!)) child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 100));
  }
}
console.log(`TEARDOWN_JSON ${JSON.stringify(rows)}`);
for (const r of rows)
  console.log(
    `${r.behaviour.padEnd(26)} ${r.impl.padEnd(22)} ${String(r.ms).padStart(5)} ms  exit-event-seen=${r.exitedAtResolve} pid-alive=${r.pidAliveAtResolve}`,
  );
