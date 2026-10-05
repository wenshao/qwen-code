// Compact table of every finished run in runs/*/rounds.jsonl + summary.json
import fs from 'node:fs';
const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad';
const names = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(`${S}/runs`);
for (const n of names) {
  const d = `${S}/runs/${n}`;
  if (!fs.existsSync(`${d}/summary.json`)) { console.log(`${n}: (running)`); continue; }
  const sum = JSON.parse(fs.readFileSync(`${d}/summary.json`, 'utf8'));
  const rounds = fs.existsSync(`${d}/rounds.jsonl`) ? fs.readFileSync(`${d}/rounds.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  for (const r of rounds) {
    console.log([n.padEnd(20), `n=${r.n}`, `settle=${r.settleMs == null ? 'STALL' : (r.settleMs / 1000).toFixed(1) + 's'}`, `turns=${JSON.stringify(r.turnStatus)}`,
      `createInFlightMax=${r.proxyCreateInFlightMax}`, `dupCreates=${r.proxyDuplicateCreates}`, `caps=${r.proxyCapabilities}`, `liveLocks=${r.liveAttachmentLocks}`,
      r.midAtMs != null ? `mid@${r.midAtMs}ms busy=${r.midCarriersBusy} inCIA=${r.midCarriersInComputeIfAbsent} inClient=${r.midCarriersInClient} pinned=${r.midPinned} poolWait=${r.midPoolWaiters} trx=${r.midTrx} lockWaits=${r.midLockWaits}` : '',
      r.stalled ? `STALL pinnedVT=${r.pinnedVirtualThreads} busy=${r.carriersBusy}` : '', `err=${sum.error ? 'Y' : 'N'}`].join('  '));
  }
  if (!rounds.length) console.log(`${n}: no rounds, error=${(sum.error ?? '').slice(0, 200)}`);
}
