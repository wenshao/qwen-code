// Collects every packaged-stack run into results/stack.json (one row per round).
import fs from 'node:fs';

const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/412871d7-f412-4b9c-905e-0d2a8afab8a8/scratchpad';
const rows = [];
for (const name of fs.readdirSync(`${S}/runs`).sort()) {
  const dir = `${S}/runs/${name}`;
  if (!fs.statSync(dir).isDirectory() || !fs.existsSync(`${dir}/summary.json`)) continue;
  const cfg = JSON.parse(fs.readFileSync(`${S}/rig/configs/${name}.json`, 'utf8'));
  const summary = JSON.parse(fs.readFileSync(`${dir}/summary.json`, 'utf8'));
  const rounds = fs.existsSync(`${dir}/rounds.jsonl`)
    ? fs.readFileSync(`${dir}/rounds.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const jdk = /jdk25/.test(cfg.java ?? '') ? 25 : 21;
  const opts = (cfg.javaOpts ?? []).join(' ');
  for (const r of rounds) {
    const status = typeof r.turnStatus === 'string'
      ? Object.fromEntries(r.turnStatus.split('\n').filter(Boolean).map((l) => l.split('\t')).map(([k, v]) => [k, Number(v)]))
      : r.turnStatus;
    rows.push({
      run: name, arm: cfg.arm, jdk, opts, scenario: r.scenario, n: r.n, rep: r.rep,
      submit: r.submit ?? null, subscribers: r.subscribers ?? null, subsOpen: r.subsOpen ?? null, subsSawCompletion: r.subsSawCompletion ?? null,
      beforeSubmit: r.beforeSubmit ?? null,
      settleMs: r.settleMs, stalled: !!r.stalled, status, pinned: r.pinnedVirtualThreads ?? null,
      carriersBusy: r.carriersBusy ?? null, carrierThreads: r.carrierThreads ?? null,
      mid: r.midAtMs ? { atMs: r.midAtMs, trx: r.midTrx, lockWaits: r.midLockWaits, carriersBusy: r.midCarriersBusy, pinned: r.midPinned, poolWaiters: r.midPoolWaiters } : null,
      lockWaitTimeouts: summary.springCannotAcquireLock,
      pinnedMonitorFrames: summary.pinnedMonitorFrames ?? {},
      error: summary.error,
    });
  }
}
fs.mkdirSync(`${S}/results`, { recursive: true });
fs.writeFileSync(`${S}/results/stack.json`, JSON.stringify(rows, null, 1));
for (const r of rows) {
  const st = Object.entries(r.status ?? {}).map(([k, v]) => `${k}:${v}`).join(',');
  console.log(`${r.run.padEnd(24)} ${r.arm.padEnd(7)} jdk${r.jdk} ${r.scenario.padEnd(9)} n=${String(r.n).padEnd(3)} rep=${r.rep} ${r.stalled ? 'STALL' : `${(r.settleMs / 1000).toFixed(1)}s`.padEnd(5)} ${st} pinned=${r.pinned ?? '-'}${r.subscribers ? ` subs=${r.subsOpen}/${r.subscribers}` : ''}${r.mid ? ` mid=${JSON.stringify(r.mid)}` : ''}`);
}
