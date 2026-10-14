// Evidence cards for the PR #14131 verification report. node gen.mjs -> fig/*.png (Playwright, 2x).
// Every number comes from results.json, which collect.mjs builds from the rig logs.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/Users/wenshao/git/qwen-code-x3/package.json');
const { chromium } = require('playwright');
const DIR = '/Users/wenshao/pr14131-rig';
const OUT = `${DIR}/fig`;
const d = JSON.parse(fs.readFileSync(`${DIR}/results.json`, 'utf8'));
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
.card{width:1400px;padding:28px 32px 26px;box-sizing:border-box;background:#0d1117}
h1{font-size:25px;margin:0 0 4px;font-weight:650}
.sub{color:#8b949e;font-size:14.5px;margin-bottom:16px;line-height:1.45}
table{border-collapse:collapse;width:100%;font-size:14.5px;margin:6px 0 14px}
th{color:#8b949e;font-weight:600;text-align:left;border-bottom:1px solid #30363d;padding:6px 9px;vertical-align:bottom}
td{border-bottom:1px solid #21262d;padding:6px 9px;vertical-align:top}
.mono,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{border-left:4px solid #d29922;padding:8px 14px;background:#161b22;font-size:14.5px;margin-top:6px;line-height:1.5}
.note.red{border-color:#f85149}.note.green{border-color:#3fb950}
.h2{font-size:17px;font-weight:650;margin:16px 0 4px}
pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#161b22;border:1px solid #30363d;padding:10px 14px;margin:6px 0 12px;white-space:pre;overflow:hidden;line-height:1.5}
pre .r{color:#f85149}pre .g{color:#3fb950}pre .y{color:#d29922}pre .d{color:#8b949e}
`;
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="card" id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}</div></body></html>`;
const td = (v, cls = '') => `<td class="${cls}">${esc(v)}</td>`;
const th = (v) => `<th>${v}</th>`;
const fe = (r) => (r ? `${r.run} run · ${r.f}F / ${r.e}E` : '—');
const cls = (r) => (!r ? 'dim' : r.f + r.e === 0 ? 'ok' : 'bad');
const env = esc(d.env);
const cards = {};

// ---- 1. Verify step: CI main vs local base vs local head vs no-pin mutant ----
{
  const rows = d.classes.map((c) => `<tr>${td(c.name, 'mono')}${td(fe(c.ci), cls(c.ci))}${td(fe(c.base), cls(c.base))}${td(fe(c.head), cls(c.head))}${td(fe(c.nopin), cls(c.nopin))}</tr>`);
  const t = d.totals;
  rows.push(`<tr>${td(`other Hosted classes (${t.otherCount})`, 'dim')}${td(fe(t.ciOther), cls(t.ciOther))}${td(fe(t.baseOther), cls(t.baseOther))}${td(fe(t.headOther), cls(t.headOther))}${td('not run', 'dim')}</tr>`);
  rows.push(`<tr>${td('failsafe total', '')}${td(fe(t.ci), cls(t.ci))}${td(fe(t.base), cls(t.base))}${td(fe(t.head), cls(t.head))}${td(fe(t.nopin), cls(t.nopin))}</tr>`);
  const body = `${`<table><tr>${th('Hosted failsafe class')}${th(`CI on main <code>91385884</code><br><span class="dim">job ${esc(d.ciJob)}</span>`)}${th('local base <code>91385884</code>')}${th(`local PR head <code>${esc(d.head.slice(0, 8))}</code>`)}${th('mutant: head minus the 4 fixture pins')}</tr>${rows.join('')}</table>`}
<pre>${d.headCi.map((l) => `<span class="${l.startsWith('!') ? 'r' : 'g'}">${esc(l.replace(/^[!+] /, ''))}</span>`).join('\n')}</pre>
<div class="note green">${d.notes.card1}</div>`;
  cards['01-hosted-verify-matrix'] = page(`Hosted process fault gates — Verify step, base vs PR head`, env, body);
}

// ---- 2. Mechanism: birth time, alias key, operator CLI cause ----
{
  const bt = d.birth.rows.map((r) => `<tr>${td(r.shape, 'mono')}${td(r.pin ? 'setLastModifiedTime(checked dir, 1 ms)' : 'none (as on base)')}${td(`${r.refused}/${r.n}`, r.refused ? 'bad' : 'ok')}${td(r.sample, 'mono')}</tr>`);
  const body = `<div class="h2">A. Birth-time check — production <code>WorkspaceStorageGuard.verifiedBirthTime</code> on the real ext4 /tmp</div>
<table><tr>${th('fixture shape')}${th('mtime pin')}${th('refused')}${th('first sample')}</tr>${bt.join('')}</table>
<div class="h2">B. Owner lookup — every storage the base run's HostedWorkspaceToolTurnIT registered in MySQL</div>
<table><tr>${th('lookup')}${th('formula')}${th('rows matched')}</tr>
<tr>${td('old probe helpers (base)', 'mono')}${td('sha256(tenant + "\\0storage-N")  — no domain tag, no length prefixes', 'mono')}${td(`${d.alias.oldHits} of ${d.alias.n} storages found`, 'bad')}</tr>
<tr>${td('PR probe helpers', 'mono')}${td('ma_storage_owner JOIN ma_storage ON physical_key WHERE alias_key = storageAliasKey(tenant, storage)', 'mono')}${td(`${d.alias.joinOne} of ${d.alias.n} storages: exactly 1 row`, 'ok')}</tr></table>
<div class="h2">C. Operator CLI <code>WorkspaceStorageRegistrationMain register</code> on an ambiguous root (birth == mtime)</div>
<pre>${d.cli.map((l) => `<span class="${/Caused by/.test(l) ? 'g' : /^\[base\]/.test(l) ? 'd' : ''}">${esc(l)}</span>`).join('\n')}</pre>
<div class="note">${d.notes.card2}</div>`;
  cards['02-root-causes'] = page('Why the leg was red — both breakages reproduced on the real stack', env, body);
}

// ---- 3. Remaining CI steps on head + commit-2 controls ----
{
  const st = d.steps.map((s) => `<tr>${td(s.name)}${td(s.cmd, 'mono')}${td(s.result, s.ok ? 'ok' : 'bad')}${td(s.wall, 'dim')}</tr>`);
  const un = d.unitControls.map((u) => `<tr>${td(u.arm, 'mono')}${td(u.what)}${td(u.result, u.expectFail ? (u.failed ? 'warn' : 'bad') : (u.failed ? 'bad' : 'ok'))}${td(u.detail, 'mono')}</tr>`);
  const body = `<div class="h2">Every later step of the same CI job, run in order on PR head <code>${esc(d.head.slice(0, 8))}</code></div>
<table><tr>${th('CI step')}${th('command')}${th('result')}${th('wall')}</tr>${st.join('')}</table>
<div class="h2">Commit 2 (<code>errorCode</code> scans shallowest-first): <code>WorkspaceMigrationStoreTest</code></div>
<table><tr>${th('arm')}${th('tree')}${th('result')}${th('detail')}</tr>${un.join('')}</table>
<div class="note">${d.notes.card3}</div>`;
  cards['03-rest-of-job-and-commit2'] = page('The rest of the job on PR head, and the errorCode follow-up', env, body);
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
const p = await ctx.newPage();
for (const [name, html] of Object.entries(cards)) {
  fs.writeFileSync(`${OUT}/${name}.html`, html);
  await p.setContent(html, { waitUntil: 'load' });
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 80)));
  if (clipped.length) console.log(`CLIPPED in ${name}:`, clipped);
  await p.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', `${OUT}/${name}.png`);
}
await browser.close();
