// VERIFICATION RIG ONLY: S24 several bounded globs in one model response: sequential (N x 5 s) or
// concurrent, and the Runtime worker's peak RSS while the glob threads run.
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';

const N = Number(process.env.N ?? 6);
const name = `s24-batch-glob-${L.ARM}-${N}`;
L.openLog(name);
const st = process.env.ST ?? 'd';
const ws = `ws-${st}`;
L.seedRegistry(ws, `st-${st}`);
// Distinct patterns: identical repeated calls trip core loop detection.
const batch = (mk) => ({ round }) => (round === 0 ? { calls: Array.from({ length: N }, (_, i) => ['glob', { pattern: mk(i) }]) } : { text: 'DONE' });
const FAST = ['**/*.ts', '**/*.json', 'src/**/*.ts', '*.json', '**/index.ts', '**/*.md', '*.ts', '**/package*'];
const model = await L.startModel({ slow: batch((i) => `+(?|?|?)Z${i}`), fast: batch((i) => FAST[i % FAST.length]) });
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s24-${L.ARM}-${N}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const workers = () =>
  new Map(
    execFileSync('/bin/ps', ['-axo', 'pid=,rss=,pcpu=,command='], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.includes(`${L.RIG}/dist/`) && l.includes('managed-runtime-worker'))
      .map((l) => l.trim().split(/\s+/))
      .map(([pid, rss, cpu]) => [pid, { rss: Number(rss), cpu: Number(cpu) }]),
  );
try {
  const before = workers();
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'w'), L.storeConnection(h, ws));
  await A.create({ toolProfile: 'hosted-workspace-files/2' });
  for (const k of ['fast', 'slow', 'fast']) {
    let peak = 0, peakCpu = 0, idleRss = 0;
    const mine = () => [...workers()].filter(([pid]) => !before.has(pid)).map(([, v]) => v);
    idleRss = Math.max(0, ...mine().map((v) => v.rss));
    const sampler = setInterval(() => {
      for (const v of mine()) { peak = Math.max(peak, v.rss); peakCpu = Math.max(peakCpu, v.cpu); }
    }, 200);
    const r = await A.prompt(`[[S:${k}]] go`, 600_000);
    clearInterval(sampler);
    const resp = L.toolResponses(r.events).map((t) => JSON.stringify(t.response?.output ?? t.response?.error ?? '').slice(0, 40));
    L.say(`${k} x${N}`, `${L.summarizeTurn(r)} responses=${resp.length} first=${resp[0]} rssBefore=${(idleRss / 1024).toFixed(0)}MB peakRss=${(peak / 1024).toFixed(0)}MB peakCpu=${peakCpu}%`);
  }
  await L.sleep(2000);
  L.say('after', JSON.stringify([...workers()].filter(([pid]) => !before.has(pid))));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
