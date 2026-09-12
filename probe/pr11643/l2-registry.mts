// L2 — the real WebTerminalRegistry from the checked-out tree: create N web
// terminals, let each shell exit naturally, count what is left parented to
// this process. Run once per tree (BASE / HEAD) so each arm starts clean.
// usage: npx tsx l2-registry.mts <label> [rounds] [perRound]
import { WebTerminalRegistry } from '../../packages/core/src/services/web-terminal-registry.js';
import { ourHosts, summarize, sleep } from './hosts.mjs';

const label = process.argv[2] ?? 'unknown';
const rounds = Number(process.argv[3] ?? 3);
const perRound = Number(process.argv[4] ?? 6);

const registry = new WebTerminalRegistry();
const report: Record<string, unknown> = {
  label,
  rounds,
  perRound,
  pid: process.pid,
  node: process.version,
  comspec: process.env['COMSPEC'],
};
report['baseline'] = summarize(ourHosts());
const rssStart = process.memoryUsage().rss;

for (let r = 0; r < rounds; r++) {
  const ids: string[] = [];
  for (let i = 0; i < perRound; i++) {
    const res = await registry.create({ workspaceCwd: process.cwd() });
    if ('error' in res) throw new Error(`create failed: ${res.error}`);
    ids.push(res.terminalId);
  }
  await Promise.all(
    ids.map(
      (id) =>
        new Promise<void>((resolve) => {
          let off: (() => void) | undefined;
          off = registry.addOutputListener(id, () => {
            off?.();
            resolve();
          });
          setTimeout(resolve, 8000);
        }),
    ),
  );
  report[`round${r + 1}Live`] = summarize(ourHosts());
  await Promise.all(
    ids.map(
      (id) =>
        new Promise<void>((resolve) => {
          registry.addExitListener(id, () => resolve());
          registry.write(id, 'exit\r');
          setTimeout(resolve, 20000);
        }),
    ),
  );
  await sleep(3000);
  report[`round${r + 1}AfterExit`] = summarize(ourHosts());
}

await sleep(8000);
report['final'] = summarize(ourHosts());
report['rssDeltaMB'] = +(
  (process.memoryUsage().rss - rssStart) /
  1024 /
  1024
).toFixed(1);
console.log('PROBE_JSON ' + JSON.stringify(report));
process.exit(0);
