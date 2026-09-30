const fs = require('fs');
const { chromium } = require('playwright-core');
const R = '/root/verify/pr13119/run';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const load = (f) => JSON.parse(fs.readFileSync(`${R}/${f}`, 'utf8'));
const shortLabel = (l) => l.replace('unlinkSync()', 'unlinkSync(write-XXXXXX/settings.json.orig) [inside rmSync]').replace(/settings\.json\.write-[A-Za-z0-9]{6}/g, 'write-XXXXXX').replace(/ -> \[object Object\]/, '');
const cls = (row) => row.agent.startsWith('ESCAPED') ? 'bad' : 'good';
const sb = (s) => s.startsWith('Tool execution sandbox: none') ? 'none' : (s.startsWith('Boundary') ? 'bwrap (full)' : s);
const CSS = `body{margin:0;background:#ffffff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2328}
.wrap{display:inline-block;padding:20px}
h1{font-size:18px;margin:0 0 4px}
.sub{font-size:12.5px;color:#59636e;margin:0 0 14px}
h2{font-size:14px;margin:16px 0 6px}
table{border-collapse:collapse;font-size:12.5px;margin-bottom:6px}
th,td{border:1px solid #d1d9e0;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#f6f8fa;font-weight:600}
td.mono{font-family:DejaVu Sans Mono,monospace;font-size:11.5px}
tr.bad td{background:#ffebe9}
tr.good td.st{color:#1a7f37;font-weight:600}
tr.bad td.st{color:#cf222e;font-weight:700}
td.ok{color:#1a7f37;font-weight:600;background:#ffffff !important}
td.ko{color:#cf222e;font-weight:700;background:#ffebe9 !important}
tr.plain td{background:#ffffff}
.cols{display:flex;gap:18px;align-items:flex-start}
.note{font-size:12px;color:#59636e;max-width:1500px;margin-top:8px}`;
function probeTable(rows) {
  return `<table><tr><th>checkpoint (writer paused after)</th><th>settings.json</th><th><code>qwen sandbox</code></th><th>agent shell tool: write outside workspace</th></tr>
  ${rows.map((r) => `<tr class="${cls(r)}"><td class="mono">${esc(shortLabel(r.label))}</td><td>${esc(r.target === 'ABSENT' ? 'ABSENT' : r.target.split(' ')[0] + (r.policy === 'MISSING' ? ', policy MISSING' : ', policy present'))}</td><td>${esc(sb(r.sandbox.replace(/ \[rc=\d+\]$/, '')))}</td><td class="st">${esc(r.agent.startsWith('ESCAPED') ? 'ESCAPED (file written on host)' : 'blocked: EROFS')}</td></tr>`).join('')}</table>`;
}
function killTable(arm, n) {
  const rows = [];
  for (let k = 1; k <= n; k++) {
    const j = load(`result-${arm}-kill${k}.json`);
    const [after, next] = j.rows;
    const cell = (r) => `${r.target === 'ABSENT' ? 'ABSENT' : 'complete'}${r.policy === 'MISSING' ? ', policy MISSING' : r.policy === 'present' ? ', policy present' : ''} · ${r.agent.startsWith('ESCAPED') ? 'ESCAPED' : 'confined'}`;
    const bad = after.agent.startsWith('ESCAPED') || next.agent.startsWith('ESCAPED');
    const left = after.listing.split('  ').filter((x) => x !== 'settings.json').map((x) => x.replace(/write-[A-Za-z0-9]{6}/, 'write-XXXXXX')).join(' ') || '—';
    rows.push(`<tr class="${bad ? 'bad' : 'good'}"><td class="mono">${esc(shortLabel(j.killedAt))}</td><td class="st">${esc(cell(after))}</td><td class="st">${esc(cell(next))}</td><td class="mono">${esc(left)}</td></tr>`);
  }
  return `<table><tr><th>SIGKILL at</th><th>next startup</th><th>after the next ordinary save</th><th>artifacts left</th></tr>${rows.join('')}</table>`;
}
async function shot(html, out) {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2400, height: 1400 } });
  await page.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body><div class="wrap">${html}</div></body></html>`);
  const el = page.locator('.wrap');
  let box = await el.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  await el.screenshot({ path: out });
  box = await el.boundingBox();
  console.log('wrote', out, Math.round(box.width), 'x', Math.round(box.height));
  await browser.close();
}
(async () => {
  const base = load('result-base.json').rows, head = load('result-head.json').rows;
  await shot(`<h1>Real CLI writer paused after every fs step — independent real readers at each checkpoint</h1>
  <p class="sub">Writer: bundled <code>qwen -p "/language ui en"</code> (User settings). Readers: separate <code>qwen sandbox</code> and a <code>qwen -p</code> agent whose scripted model runs a shell command. Linux 6.12, bubblewrap 0.12.0, policy <code>workspace-write / network closed</code>.</p>
  <div class="cols"><div><h2>BASE 78143fe335</h2>${probeTable(base)}</div><div><h2>PR HEAD d0be922868</h2>${probeTable(head)}</div></div>
  <h2>Crash matrix — writer SIGKILLed at each checkpoint, then a new process starts, then an ordinary save by another new process</h2>
  <div class="cols"><div><h2>BASE</h2>${killTable('base', 4)}</div><div><h2>PR HEAD</h2>${killTable('head', 6)}</div></div>
  <p class="note">Base kill at #2 is permanent: the target stays absent, the next ordinary save re-creates settings.json <b>without</b> the policy (loadSettings saw an empty User scope), and the policy survives only in an orphaned <code>settings.json.orig</code> that nothing reads. PR head keeps a complete target with the policy at every point; crashed writers leave a private <code>settings.json.write-XXXXXX/</code> directory that later saves do not remove.</p>`,
  '/root/verify/pr13119/publish/pr-13119/02-checkpoint-and-crash-matrix.png');

  const st = (f) => { const d = `${R}/${f}`; const w = fs.readdirSync(d).filter((x) => x.startsWith('writer')).map((x) => JSON.parse(fs.readFileSync(`${d}/${x}`, 'utf8'))); const r = fs.readdirSync(d).filter((x) => x.startsWith('reader')).map((x) => JSON.parse(fs.readFileSync(`${d}/${x}`, 'utf8'))); const sum = (a, k) => a.reduce((n, x) => n + x[k], 0); return { saves: sum(w, 'ok') + sum(w, 'refused') + w.reduce((n, x) => n + Object.values(x.errors).reduce((a, b) => a + b, 0), 0), ok: sum(w, 'ok'), failed: w.reduce((n, x) => n + Object.values(x.errors).reduce((a, b) => a + b, 0), 0), samples: sum(r, 'samples'), absent: sum(r, 'absent'), parse: sum(r, 'parseError'), lost: sum(r, 'policyLost'), threw: sum(r, 'readerThrew') }; };
  const rows = [['BASE', '1', st('stress-base-w1')], ['PR HEAD', '1', st('stress-head-w1')], ['BASE', '2', st('stress-base-w2')], ['PR HEAD', '2', st('stress-head-w2')], ['PR HEAD + suggested patch', '2', st('stress-patched-w2')]];
  const bad = (s) => s.failed + s.absent + s.parse + s.lost + s.threw > 0;
  await shot(`<h1>Concurrency stress — compiled production writer and operator-policy reader, separate processes</h1>
  <p class="sub">Each writer process performs 300 full-scope saves through <code>updateSettingsFilePreservingFormat → writeWithBackupSync</code>; two reader processes loop raw read + JSON.parse + <code>readOperatorSandboxSettings()</code> until the writers finish. Linux ext4.</p>
  <table><tr><th>arm</th><th>writers</th><th>saves ok / attempted</th><th>reader samples</th><th>target absent</th><th>torn / unparseable JSON</th><th>policy lost (real reader)</th><th>reader threw</th></tr>
  ${rows.map(([a, w, s]) => { const c = (v) => `<td class="${v ? 'ko' : 'ok'}">${v}</td>`; return `<tr class="plain"><td>${a}</td><td>${w}</td><td class="${s.ok < s.saves ? 'ko' : 'ok'}">${s.ok} / ${s.saves}</td><td>${s.samples.toLocaleString('en-US')}</td>${c(s.absent)}${c(s.parse)}${c(s.lost)}${c(s.threw)}</tr>`; }).join('')}</table>
  <h2>Publication that keeps failing — single-file bind mount of settings.json (rename → EBUSY), 3 real CLI startups with an older <code>$version</code></h2>
  <table><tr><th>arm</th><th>settings saves</th><th>target</th><th>directories left in QWEN_HOME</th></tr>
  <tr class="plain"><td>BASE</td><td>fail (EBUSY on rename-away)</td><td>intact</td><td class="ok">0</td></tr>
  <tr class="plain"><td>PR HEAD</td><td>fail (EBUSY on publication)</td><td>intact</td><td class="ko">3 (one full settings copy per startup, silently)</td></tr>
  <tr class="plain"><td>PR HEAD + suggested patch</td><td>fail (EBUSY on publication)</td><td>intact</td><td class="ok">0</td></tr></table>
  <p class="note">Base two-writer failures come from the shared <code>settings.json.tmp</code>/<code>.orig</code> paths (ENOENT on rename, "Target was automatically restored", one writer publishing another's half-written temp file → the 3 torn reads). The suggested patch only changes the failure path: it drops a recovery copy that is byte-identical to the untouched target.</p>`,
  '/root/verify/pr13119/publish/pr-13119/03-concurrency-and-persistent-failure.png');
})();
