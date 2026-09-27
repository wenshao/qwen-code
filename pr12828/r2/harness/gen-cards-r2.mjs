// Round-2 evidence cards (head 26c51b351a): refusal logging A/B, the new
// value-comparison tests, and the regression re-run.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const RIG = path.dirname(new URL(import.meta.url).pathname);
const { chromium } = createRequire(path.join(process.env.WT, 'package.json'))('playwright');
const read = (f) => JSON.parse(fs.readFileSync(path.join(RIG, f), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const ok = (s) => `<span class="ok">${esc(s)}</span>`;
const bad = (s) => `<span class="bad">${esc(s)}</span>`;
const warn = (s) => `<span class="warn">${esc(s)}</span>`;
const css = `
body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.card{display:inline-block;padding:22px 26px;background:#0d1117;min-width:1180px}
h1{font-size:21px;margin:0 0 4px}.sub{color:#8b949e;margin:0 0 14px;font-size:13.5px}
table{border-collapse:collapse;width:100%;margin:6px 0 12px}
th,td{border:1px solid #30363d;padding:6px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
td code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{border-left:4px solid #58a6ff;background:#161b22;padding:8px 12px;margin-top:6px;font-size:14px}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div class="card"><h1>${esc(title)}</h1><p class="sub">${sub}</p>${body}</div>`;

// refusal logging, from out-log/rows.txt and the daemon log
const rows = fs.readFileSync(path.join(RIG, 'out-log/rows.txt'), 'utf8').split('\n');
const arms = {};
let cur;
for (const l of rows) {
  const m = /^== (\S+)/.exec(l);
  if (m) { cur = m[1]; arms[cur] = {}; continue; }
  const r = /^\s{2}(.{24}) (\d{3}) (\S*)\s+(\d+)ms bytes (\S+) \| log: (.*)$/.exec(l);
  if (r && cur) arms[cur][r[1].trim()] = { status: r[2], code: r[3], ms: r[4], bytes: r[5], log: r[6] };
}
const reason = (log) => (log === '(nothing)' ? null : (/Session execution engine for [0-9a-f-]+: (.*)$/.exec(log)?.[1] ?? log));
const dlog = fs.readFileSync(path.join(RIG, 'out-log/home/.qwen/debug/daemon/daemon.log'), 'utf8');
const full = (label) => { // untruncated reason from the daemon log
  const want = { 'torn last line': 'incomplete transcript', 'unknown record subtype': 'invalid transcript record', 'Managed owner': 'belongs to managed', 'Managed owner not first': 'belongs to managed' }[label];
  return dlog.split('\n').find((l) => l.includes('errorType=SessionExecutionEngineError') && l.includes(want))?.replace(/^.*Session execution engine for [0-9a-f-]+: /, '') ?? '';
};
const labels = ['torn last line', 'unknown record subtype', 'Managed owner', 'Managed owner not first'];
const logRows = labels.map((lb) => {
  const a = arms['45f09d5c61']?.[lb], b = arms['26c51b351a']?.[lb], u = arms['26c51b351a-unpaired']?.[lb], z = arms['base']?.[lb];
  return `<tr><td>${esc(lb)}</td><td class="mono">${bad(`${a.status}`)} · log ${bad('nothing')}</td><td class="mono">${ok(`${b.status}`)} · warn: <b>${esc(full(lb))}</b></td><td class="mono">${u.status} / ${z.status}</td><td>${a.bytes === 'same' && b.bytes === 'same' ? ok('unchanged') : bad('CHANGED')}</td></tr>`;
}).join('');
const d7a = (fs.readFileSync(path.join(RIG, 'out-dmut2-D7/home/.qwen/debug/daemon/daemon.log'), 'utf8').match(/WARN.*route=POST \/session\/:id\/(load|resume).*belongs to managed, cannot execute with legacy/g) ?? []).length;
const d7b = (fs.readFileSync(path.join(RIG, 'out-dmut3-D7/home/.qwen/debug/daemon/daemon.log'), 'utf8').match(/WARN.*route=POST \/session\/:id\/(load|resume).*belongs to managed, cannot execute with legacy/g) ?? []).length;
const p26 = read('mut3-p.json'), p45 = read('mut2-p.json');
const pRows = ['P01', 'P02', 'P03'].map((id) => {
  const a = p45.find((m) => m.id === id), b = p26.find((m) => m.id === id);
  return `<tr><td class="mono">${id}</td><td>${esc(b.desc)}</td><td>${a.verdict === 'KILLED' ? ok('killed') : bad('survived')} <span class="dim mono">${esc(a.tests)}</span></td><td>${b.verdict === 'KILLED' ? ok('killed') : bad('survived')} <span class="dim mono">${esc(b.tests)}</span></td></tr>`;
}).join('');
const card1 = page('Round 2 · what 188ffd4bdd, 76bad6dd2f and 26c51b351a change',
  'Same storage, one fixture per shape, cold <code>POST /session/:id/load</code> on each arm; reasons read from <code>~/.qwen/debug/daemon/daemon.log</code>. Response bodies are unchanged on every arm.',
  `<table><tr><th>Transcript</th><th>45f09d5c61 paired</th><th>26c51b351a paired</th><th>26c no flag / base</th><th>bytes</th></tr>${logRows}
  <tr><td>Legacy child refuses (dist mutant D7: selector sends a Managed owner to Legacy; <code>-32024</code> path)</td><td>${bad('409')} · route warn lines ${bad(d7a)}</td><td>${ok('409')} · route warn lines ${ok(d7b)}: <b>belongs to managed, cannot execute with legacy</b></td><td>—</td><td>${ok('unchanged')}</td></tr></table>
  <table><tr><th>ID</th><th>Paired branch changes another Bridge option (source mutant)</th><th>tests at 45f09d5c61</th><th>tests at 26c51b351a</th></tr>${pRows}</table>
  <table><tr><th>Other claim</th><th>Result on this Mac (load ~25)</th></tr>
  <tr><td>Owner read of a 100 MB Legacy transcript runs inside the 10 s selection budget</td><td>${ok('153–173 ms')} (selector from the 26c bundle's dist, 3 runs, result <code>legacy</code>)</td></tr>
  <tr><td><code>serve --help</code> names the private Conversations runtime</td><td>${ok('yes')}: "build workspace runtimes, other than the private Conversations one, …"</td></tr></table>
  <div class="note">P01/P02 (session shell turned off, <code>childEnvOverrides</code> cleared on a paired runtime) pass every test at 45f09d5c61 and are caught at 26c51b351a by the new by-value comparison. P03 is caught at both heads because <code>maxSessions: 1</code> breaks the embedded host tests; 26c fails one more test.</div>`);

// regression
const norm = (f, ph) => read(f).filter((o) => !ph || ph.includes(o.phase)).map((o) => `${o.phase} ${o.step} ${o.key} ${JSON.stringify(o.value).replace(/out-[a-z0-9-]+?(\/|-home)/g, 'out-X$1').replace(/--port \d+/, '').replace(/(unchanged) [0-9a-f]+/, '$1').replace(/"ms":\d+/, '').replace(/"acpChildrenSeen":\d+/, '').replace(/127\.0\.0\.1:\d+/, '').replace(/"id\\":\\"[0-9a-f]+\\"/, '').replace(/scratch-[A-Za-z0-9]+/g, 'scratch')}`.replace(/(readyMs|Ms) .*$/, '$1'));
const same = (a, b) => { const x = norm(...a), y = norm(...b); return `${x.filter((l, i) => l === y[i]).length}/${Math.max(x.length, y.length)}`; };
const mu = read('mut3-unit.json');
const card2 = page('Round 2 · regression at 26c51b351a',
  'Every round-1 check re-run on the new head with the same scripts; "identical" = same observations after normalizing ports, timings, hashes, paths and child counts.',
  `<table><tr><th>Check</th><th>Result</th></tr>
  <tr><td>Paired daemon plan (P1 paired → P1R replacement → P2 unpaired → P3 paired → P4 fresh → P5 Hosted)</td><td>${ok(same(['out-head2/obs.json'], ['out-head3/obs.json']))} identical to 45f09d5c61</td></tr>
  <tr><td>Flag off vs base</td><td>${ok(same(['out-base/obs.json', ['P1']], ['out-head3-single/obs.json', ['P1']]))} identical</td></tr>
  <tr><td>Torn line, upper-case id, scratch probes</td><td>${ok(same(['out-extra2/obs.json'], ['out-extra3/obs.json']))} identical</td></tr>
  <tr><td>Overdue restore on a Legacy-only host</td><td>paired: sibling S1 → 404 after quarantine, new sessions 200; no flag: S1 keeps prompting, new sessions 503 until settled — ${ok('as before')}</td></tr>
  <tr><td><code>user_text_elements</code> written by the real CLI</td><td>26c paired ${ok('200')} · 907dae03ac paired ${bad('409')} · base ${ok('200')}</td></tr>
  <tr><td>Dist mutants D1–D7 in the real daemon</td><td>${ok('7/7')} same effect as before (D6 standalone 503, D7 child refusal)</td></tr>
  <tr><td>13 listed files + <code>error-response.test.ts</code></td><td>${ok('2313/2313')} (14 files); core <code>transcript-records.test.ts</code> ${ok('72/72')}</td></tr>
  <tr><td>Source mutants</td><td>${ok(`${mu.filter((m) => m.verdict === 'KILLED').length}/${mu.length} killed`)} — the round-1 survivors S16/S16b/S16c now killed by the adopted <code>RESTORE_PURPOSES</code> tests; new L01/L02 (drop either refusal log call) killed by <code>logs why an execution engine rejection happened</code></td></tr>
  </table>`);

const browser = await chromium.launch();
for (const [name, html] of [['r2-01-delta', card1], ['r2-02-regression', card2]]) {
  const f = path.join(RIG, 'cards', `${name}.html`);
  fs.writeFileSync(f, html);
  const p = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(`file://${f}`);
  await p.locator('.card').screenshot({ path: path.join(RIG, 'cards', `${name}.png`) });
  await p.close();
  console.log('wrote', name);
}
await browser.close();
