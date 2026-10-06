// Usage: node mut.mjs <worktree> <mutant>[+<mutant>...]
// Resets the touched files to the worktree's HEAD, then applies each mutant.
//   PS   HarnessEventStream.next() -> synchronized method (pre-#13388 shape)
//   PSC  every strict context.lock()/try/finally/context.unlock() site -> synchronized (context)
//   PBR  every monitor.lock()/try/finally/monitor.unlock() in BindingRenewal -> synchronized (this)
//   PDR  same for DispatchRenewal
//   WCPS / WCPV / WCPR  witness wiring (stream / session / renewal) -> ForkJoinPool.getCommonPoolParallelism()
//   HCP  CarrierCount.resolve() -> getCommonPoolParallelism()
//   HAP  CarrierCount.resolve() ignores the property (availableProcessors)
//   HGI  CarrierCount.resolve() -> Integer.getInteger(prop, availableProcessors())
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [wt, spec] = process.argv.slice(2);
const J = 'packages/sdk-java';
const STREAM = `${J}/qwencode/src/main/java/com/alibaba/qwen/code/daemon/HarnessEventStream.java`;
const BROKER = `${J}/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java`;
const TB = `${J}/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker`;
const WS = `${J}/qwencode/src/test/java/com/alibaba/qwen/code/daemon/HarnessEventStreamPinningTest.java`;
const WV = `${TB}/BrokerVirtualThreadPinningTest.java`;
const WR = `${TB}/BrokerRenewalPinningTest.java`;
const CC = `${TB}/CarrierCount.java`;
const ALL = [STREAM, BROKER, WS, WV, WR, CC];

const exists = (p) => { try { execFileSync('git', ['-C', wt, 'cat-file', '-e', `HEAD:${p}`]); return true; } catch { return false; } };
for (const p of ALL) if (exists(p)) execFileSync('git', ['-C', wt, 'checkout', 'HEAD', '--', p]);

const rd = (p) => fs.readFileSync(`${wt}/${p}`, 'utf8');
const wr = (p, t) => fs.writeFileSync(`${wt}/${p}`, t);
const once = (t, from, to) => {
  const n = t.split(from).length - 1;
  if (n !== 1) throw new Error(`expected one match, got ${n}: ${from.slice(0, 80)}`);
  return t.replace(from, to);
};
// Rewrites lock/try/finally/unlock blocks to synchronized blocks within [lo, hi).
function toSync(text, lo, hi, recv, syncOn) {
  const lines = text.split('\n');
  let pos = 0, first = -1, last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (first < 0 && pos >= lo) first = i;
    if (pos < hi) last = i;
    pos += lines[i].length + 1;
  }
  let n = 0;
  for (let i = last; i >= first; i--) {
    const m = new RegExp(`^(\\s*)${recv}\\.lock\\(\\);$`).exec(lines[i]);
    if (!m) continue;
    const ind = m[1];
    if (lines[i + 1] !== `${ind}try {`) continue;
    let j = i + 2;
    while (j <= last && !(lines[j] === `${ind}} finally {` && lines[j + 1] === `${ind}    ${recv}.unlock();` && lines[j + 2] === `${ind}}`)) j++;
    if (j > last) throw new Error(`no finally for line ${i + 1}`);
    lines.splice(j, 3, `${ind}}`);
    lines.splice(i, 2, `${ind}synchronized (${syncOn}) {`);
    n++;
  }
  return [lines.join('\n'), n];
}
const classRange = (t, header, nextHeader) => {
  const s = t.indexOf(header);
  const e = nextHeader ? t.indexOf(nextHeader, s + 1) : t.length;
  if (s < 0 || e < 0) throw new Error(`class bounds ${header}`);
  return [s, e];
};

const notes = [];
for (const m of spec.split('+')) {
  if (m === 'NONE') continue;
  if (m === 'PS') {
    let t = rd(STREAM);
    t = once(t, '    public DaemonEvent next() {\n        lock.lock();\n        try {\n            ensureOpen();',
      '    public synchronized DaemonEvent next() {\n        {\n            ensureOpen();');
    t = once(t, '                throw e;\n            }\n        } finally {\n            lock.unlock();\n        }\n    }\n',
      '                throw e;\n            }\n        }\n    }\n');
    wr(STREAM, t);
  } else if (m === 'PSC') {
    const [t, n] = toSync(rd(BROKER), 0, Infinity, 'context', 'context');
    wr(BROKER, t); notes.push(`PSC sites=${n}`);
  } else if (m === 'PBR' || m === 'PDR') {
    const t0 = rd(BROKER);
    const [s, e] = m === 'PBR'
      ? classRange(t0, '    private final class BindingRenewal implements AutoCloseable {', '    private final class DispatchRenewal implements AutoCloseable {')
      : classRange(t0, '    private final class DispatchRenewal implements AutoCloseable {', null);
    const [t, n] = toSync(t0, s, e, 'monitor', 'this');
    wr(BROKER, t); notes.push(`${m} sites=${n}`);
  } else if (m === 'WCPS') {
    wr(WS, once(rd(WS), '        int carriers = carrierCount();', '        int carriers = java.util.concurrent.ForkJoinPool.getCommonPoolParallelism();'));
  } else if (m === 'WCPV') {
    wr(WV, once(rd(WV), '        int carriers = CarrierCount.resolve();', '        int carriers = java.util.concurrent.ForkJoinPool.getCommonPoolParallelism();'));
  } else if (m === 'WCPR') {
    wr(WR, once(rd(WR), '        int carriers = CarrierCount.resolve();', '        int carriers = java.util.concurrent.ForkJoinPool.getCommonPoolParallelism();'));
  } else if (m === 'HCP' || m === 'HAP' || m === 'HGI') {
    const body = {
      HCP: 'return java.util.concurrent.ForkJoinPool.getCommonPoolParallelism();',
      HAP: 'return Runtime.getRuntime().availableProcessors();',
      HGI: 'return Integer.getInteger("jdk.virtualThreadScheduler.parallelism", Runtime.getRuntime().availableProcessors());',
    }[m];
    let t = rd(CC);
    const s = t.indexOf('    static int resolve() {');
    const e = t.indexOf('\n    }\n', s);
    t = t.slice(0, s) + `    static int resolve() {\n        ${body}` + t.slice(e);
    wr(CC, t);
  } else {
    throw new Error(`unknown mutant ${m}`);
  }
}
const stat = execFileSync('git', ['-C', wt, 'diff', '--shortstat'], { encoding: 'utf8' }).trim();
console.log(`${spec}: ${stat || 'no change'} ${notes.join(' ')}`);
