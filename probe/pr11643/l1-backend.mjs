// L1 — raw @lydell/node-pty A/B: does `useConptyDll` change what a naturally
// exited PTY leaves behind? One arm per process so each arm starts clean.
// usage: node l1-backend.mjs <inbox|bundled> [count]
import * as pty from '@lydell/node-pty';
import { ourHosts, summarize, sleep } from './hosts.mjs';

const arm = process.argv[2] ?? 'inbox';
const count = Number(process.argv[3] ?? 6);
const useConptyDll = arm === 'bundled';

const report = {
  arm,
  useConptyDll,
  count,
  node: process.version,
  pid: process.pid,
};
report.baseline = summarize(ourHosts());

const procs = [];
for (let i = 0; i < count; i++) {
  procs.push(
    pty.spawn(process.env['COMSPEC'] ?? 'cmd.exe', [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env,
      useConptyDll,
    }),
  );
}
// Let each shell reach its prompt (first output) before asking it to exit.
await Promise.all(
  procs.map(
    (p) =>
      new Promise((res) => {
        let done = false;
        p.onData(() => {
          if (!done) {
            done = true;
            res();
          }
        });
        setTimeout(res, 5000);
      }),
  ),
);
report.afterSpawn = summarize(ourHosts());

// Natural exit: the shell exits on its own, which is the path node-pty#965 is about.
await Promise.all(
  procs.map(
    (p) =>
      new Promise((res) => {
        p.onExit(() => res());
        p.write('exit\r');
        setTimeout(res, 15000);
      }),
  ),
);
await sleep(3000);
report.afterExit3s = summarize(ourHosts());
await sleep(10000);
report.afterExit13s = summarize(ourHosts());

console.log('PROBE_JSON ' + JSON.stringify(report));
process.exit(0);
