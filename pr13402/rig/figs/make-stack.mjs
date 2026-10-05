// Builds 01-stack-ab.html from results/stack.json.
import fs from 'node:fs';

const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/54b7ab90-ab14-4aaa-958e-1d2b84bfc2f7/scratchpad';
const rows = JSON.parse(fs.readFileSync(`${S}/results/stack.json`, 'utf8'));
const by = Object.fromEntries(rows.map((r) => [r.name, r]));
const s = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);

const order = [
  ['SSE subscribers on 300 idle sessions + 8 Turns', ['idle300-main-1', 'idle300-main-2', 'idle300-merge-1', 'idle300-merge-2']],
  ['300 SSE subscribers watching the 8 Turn sessions', ['fanout300-main-1', 'fanout300-main-2', 'fanout300-merge-1', 'fanout300-merge-2']],
  ['1000 subscribers', ['idle1000-main-1', 'idle1000-merge-1', 'fanout1000-merge-1']],
  ['Controls', ['fanout200-main-1', 'idle300-main-jdk25']],
];
const label = (r) => {
  const arm = r.arm === 'main' ? '<span class="base">main</span>' : '<span class="fix">main + #13402</span>';
  const jdk = r.jdk === 'jdk25' ? ' <span class="dim">JDK 25</span>' : '';
  return arm + jdk;
};
const scen = (r) => `${r.scenario === 'fanout' ? 'watch' : 'idle'} ×${r.subscribers}`;
function hubCell(r) {
  const b = r.beforeSubmit;
  if (b.hubWaitersUnmounted) return `<span class="ok">${b.hubWaitersUnmounted} Condition.awaitNanos</span>`;
  const pinnedLabel = r.jdk === 'jdk25' ? 'Object.wait (unpinned, JEP 491)' : 'Object.wait, pinned';
  const cls = r.jdk === 'jdk25' ? 'ok' : 'bad';
  return `<span class="${cls}">${b.hubWaitersPinned} ${pinnedLabel}</span>`;
}
let body = '';
for (const [title, names] of order) {
  body += `<tr class="group"><td colspan="9">${title}</td></tr>`;
  for (const n of names) {
    const r = by[n];
    if (!r) throw new Error(`missing ${n}`);
    const b = r.beforeSubmit;
    const openCls = r.subsOpenBeforeSubmit === r.subscribers ? 'ok' : 'bad';
    const carrCls = b.carriersBusy > 50 ? 'bad' : 'ok';
    const settleCls = r.settleMs > 15000 ? 'bad' : 'ok';
    const saw = r.subsSawCompletion == null ? '—' : `${r.subsSawCompletion}/${r.subscribers} · p50 ${s(r.completionMsP50)} · max ${s(r.completionMsMax)}`;
    const sawCls = r.completionMsMax > 15000 ? 'bad' : 'ok';
    const svd = r.streamVsDurable ? `${r.streamVsDurable.identical}/${r.subscribers}` : '—';
    body += `<tr><td>${label(r)}</td><td>${scen(r)}</td><td class="${openCls}">${r.subsOpenBeforeSubmit}/${r.subscribers}</td>`
      + `<td class="${carrCls}">${b.carrierThreads} / ${b.carriersBusy} busy</td><td>${hubCell(r)}</td>`
      + `<td class="${r.submitMsMax > 1000 ? 'bad' : 'ok'}">${r.submitMsMax >= 1000 ? s(r.submitMsMax) : r.submitMsMax + ' ms'}</td><td class="${settleCls}">${s(r.settleMs)}</td><td class="${r.subsSawCompletion == null ? '' : sawCls}">${saw}</td><td class="${r.streamVsDurable ? 'ok' : ''}">${svd}</td></tr>`;
  }
}
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#c9d1d9}
#card{display:inline-block;padding:26px 30px 22px;background:#0d1117}
h1{font-size:22px;margin:0 0 4px;color:#f0f6fc}
.sub{font-size:13.5px;color:#8b949e;margin-bottom:14px}
table{border-collapse:collapse;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
th{color:#8b949e;font-weight:600;text-align:left;padding:6px 12px;border-bottom:1px solid #30363d;white-space:nowrap}
td{padding:5px 12px;border-bottom:1px solid #21262d;white-space:nowrap}
tr.group td{color:#58a6ff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-weight:600;padding-top:12px;border-bottom:none}
.base{color:#f0883e}.fix{color:#3fb950}.ok{color:#3fb950}.bad{color:#f85149}.dim{color:#8b949e}
.note{margin-top:14px;border-left:3px solid #3fb950;padding:4px 12px;font-size:13.5px;color:#c9d1d9;max-width:1280px;line-height:1.45}
</style><div id="card">
<h1>Packaged stack A/B — SSE subscribers vs. Turn latency (JDK 21.0.12)</h1>
<div class="sub">Spring fat jar of main 8d864a9f21 vs. trial merge main + #13402 (6bf9785da7) · real MySQL 8.4.7 · packaged Hosted Harness (dist/cli.js serve --profile hosted-harness) · fake model replying in 5 s · fresh JVM per row · 10-core arm64 · *subscribers given 5 s to open (10 s for ×1000) before the 8 Turns are submitted</div>
<table><tr><th>arm</th><th>subscribers</th><th>SSE open before submit*</th><th>carriers (FJP workers)</th><th>stream threads in SessionBuffer.await</th><th>POST submit max</th><th>8 Turns settle</th><th>subscribers saw turn.completed</th><th>stream = durable list</th></tr>
${body}</table>
<div class="note">On JDK 21, main pins one carrier per parked subscriber and stops at the scheduler's 256 ceiling: subscribers past 256 do not open, the threads behind them sit in JDBC (16 holding a connection they cannot finish, 28 waiting for the Druid pool at 300; 643 at 1000), POST submits take 4.6–19.7 s, Turns take 30–75 s, and at 1000 subscribers 647 streams die with CannotGetJdbcConnectionException (Druid wait 30 s, active 20/20). With #13402 the same 300 or 1000 subscribers park unmounted on 10 carriers and Turns settle in ~6.3 s, the same as main below the ceiling (200) or on JDK 25. Every subscriber's event stream equals the session's durable REST list (same ids, names, order) in both arms.</div>
</div>`;
fs.writeFileSync(`${S}/figs/01-stack-ab.html`, html);
console.log('ok');
