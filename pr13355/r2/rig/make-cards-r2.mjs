// VERIFICATION RIG ONLY (PR #13355, round 2): renders the round-2 card from
// the rig's result files and screenshots it with the head worktree's Playwright.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13355-rig';
const FIG = `${RIG}/fig`;
mkdirSync(FIG, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13355-head/package.json');
const { chromium } = require('playwright');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jsonl = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px;background:#0d1117;min-width:1100px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:16px 0 8px;color:#c9d1d9}
.sub{color:#8b949e;font-size:13.5px;margin-bottom:14px}
table{border-collapse:collapse;font-size:13px}
th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{margin-top:14px;border-left:4px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:13.5px;max-width:1260px}
.cols{display:flex;gap:22px;align-items:flex-start}
`;

// Real-stack matrix: previous head vs new head.
const cls = (r) => { const o = r.reopen ?? ''; if (r.commit !== 200) return 'refused'; if (o.startsWith('REFUSED')) return 'brick'; if (o.includes('REFUSED')) return 'chain'; return 'opens'; };
const prev = Object.fromEntries(jsonl(`${RIG}/results/rogue-head.jsonl`).map((r) => [r.scenario, cls(r)]));
const now = Object.fromEntries(jsonl(`${RIG}/results/rogue-head2.jsonl`).map((r) => [r.scenario, cls(r)]));
const count = (m, k) => Object.entries(m).filter(([s, v]) => !s.startsWith('checkpoint') && v === k).length;
const changed = Object.keys(now).filter((s) => prev[s] !== now[s]);
let t1 = `<table><tr><th></th><th>7e4a060c5f</th><th>a43bbc7bbd</th></tr>
<tr><td>refused at commit (409), Session opens</td><td>${count(prev, 'refused')}</td><td class="ok">${count(now, 'refused')}</td></tr>
<tr><td>stored, next open REFUSED (bricked)</td><td class="bad">${count(prev, 'brick')}</td><td class="warn">${count(now, 'brick')}</td></tr>
<tr><td>stored, Monitor chain stuck</td><td>${count(prev, 'chain')}</td><td>${count(now, 'chain')}</td></tr></table>
<div class="dim" style="margin-top:6px">${Object.keys(now).length} scenarios · changed: ${changed.map((s) => `<code>${esc(s)}</code> ${prev[s]}→${now[s]}`).join(' · ')}</div>`;

// Guard, witness ITs.
const g = jsonl(`${RIG}/results/guard.jsonl`).filter((r) => r.arm === 'head2' && r.mode === 'midcommit');
const it = readFileSync(`${RIG}/results/it.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t'));
const itRow = (kind, label) => it.filter((r) => r[0] === kind && r[1] === label).at(-1);
const itCell = (kind, label, expectRed) => {
  const r = itRow(kind, label); if (!r) return '<td class="dim">not run</td>';
  const red = r[2] !== 'exit=0';
  return `<td class="${red === expectRed ? 'ok' : 'bad'}">${red ? 'RED' : 'green'} <span class="dim">${esc(r[3].replace(/^\[\w+\]\s*/, ''))}</span></td>`;
};
const mariaLog = readFileSync(`${RIG}/logs/it-maria-head2-mysqlit-class.log`, 'utf8');
const mariaErr = [...mariaLog.matchAll(/ManagedAgentMySqlIT\.(\w+) -- Time elapsed: ([\d.]+) s <<< ERROR/g)].map((m) => `${m[1]} (${m[2]} s)`);
const baseHook = readFileSync(`${RIG}/logs/it-maria-base-hook.log`, 'utf8');
const baseHookErr = /writer grant is stale/.test(baseHook) ? (baseHook.match(/Time elapsed: ([\d.]+) s <<< ERROR/) ?? [, '?'])[1] : null;
const t2 = `<table><tr><th>check</th><th>MySQL 8.4.7 (native)</th><th>MariaDB 10.11.18 (CI image line, colima)</th></tr>
<tr><td><code>ManagedAgentMySqlIT</code> on a43bbc7bbd</td><td class="ok">20/20 (in the full verify)</td>${itCell('IT-MARIADB', 'head2-mysqlit-class', false).replace('class="bad"', 'class="warn"')}</tr>
<tr><td>new IT with the guard mutated to a plain read (000961f1fb's)</td>${itCell('IT', 'head2-plainread-mysql84', true)}${itCell('IT-MARIADB', 'head2-plainread', true)}</tr></table>
<div class="dim" style="margin-top:6px">MariaDB error: ${esc(mariaErr.join(', ') || 'none')} — base b2c95e04dc fails the same test the same way here (${baseHookErr ? `writer grant stale at ${baseHookErr} s` : '?'}): a 60 s writer lease over 2002 commits on a host at load 30–50. CI's MariaDB lane is green on this head. In the plain-read rows the new IT fails ("expected 1 but was 2") and the delete-first IT passes, so only the new IT is the witness.</div>`;

// Mutants.
const mut = readFileSync(`${RIG}/results/mutants.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t')).filter((r) => r[0] === 'head2');
const dm = readFileSync(`${RIG}/results/dmutants.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t')).filter((r) => r[0] === 'head2');
const t3 = `<table><tr><th>mutant on a43bbc7bbd</th><th>result</th><th>killing test</th></tr>${[...mut.map((r) => [r[1], r[2], r[3]]), ...dm.map((r) => [r[1], r[2], r[4]])].map(([id, st, by]) => `<tr><td class="mono">${esc(id)}</td><td class="${st === 'KILLED' ? 'ok' : 'bad'}">${st}</td><td class="dim mono">${esc((by ?? '').split(';').map((x) => x.replace(/^\w+Test\./, '')).join(', ').slice(0, 90))}</td></tr>`).join('')}</table>`;

// Suites, TS, E2E.
const suite = (label) => { const t = readFileSync(`${RIG}/logs/suite-${label}.log`, 'utf8'); const tot = [...t.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\n/g)].map((m) => m.slice(1)); return { u: tot[0], i: tot[1], cs: /You have 0 Checkstyle violations/.test(t), sb: /BugInstance size is 0/.test(t), ok: /BUILD SUCCESS/.test(t) }; };
const f = (x) => `${x[0]} run · ${x[1]} fail · ${x[2]} err · ${x[3]} skip`;
const vt = (a) => (readFileSync(`${RIG}/logs/vitest-r2-${a}-pr-files.log`, 'utf8').match(/Tests\s+(.*\(\d+\))/) ?? [, '?'])[1].trim();
const e2e = readFileSync(`${RIG}/results/e2e.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t')).filter((r) => r[1].startsWith('e2e-r2-'));
let t4 = `<table><tr><th>tree</th><th>unit</th><th>MySQL 8.4.7 ITs</th><th>Checkstyle / SpotBugs</th><th>PR's TS contract tests</th></tr>`;
for (const [l, name, ts] of [['head2', 'a43bbc7bbd', 'head'], ['merge2', 'a43bbc7bbd + main f3642d4e', 'merge']]) {
  const s = suite(l);
  t4 += `<tr><td>${name}</td><td class="ok">${f(s.u)}</td><td class="ok">${f(s.i)}</td><td class="${s.cs && s.sb ? 'ok' : 'bad'}">${s.cs ? '0' : '?'} / ${s.sb ? '0' : '?'}</td><td class="ok">${esc(vt(ts))}</td></tr>`;
}
t4 += `</table><table style="margin-top:8px"><tr><th>repo E2E runner on a43bbc7bbd + main</th><th>result</th></tr>${e2e.map((r) => `<tr><td class="mono">${esc(r[2])}</td><td class="${r[3] === 'exit=0' ? 'ok' : 'bad'}">${esc(r[3])} · ${esc(r[4])}</td></tr>`).join('')}</table>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card">
<h1>Round 2 — a43bbc7bbd (7a0678bf1f + 326ef6cd7a + a43bbc7bbd)</h1>
<div class="sub">7a0678bf1f equals the round-1 candidate patch line for line · same rig: Spring jars, MySQL 8.4.7, TS authority from head, rogue writer, mid-commit deletion probe · MariaDB 10.11.18 added for the IT</div>
<div class="cols"><div><h2>Real-stack commit matrix</h2>${t1}
<h2>Mid-commit deletion probe on a43bbc7bbd</h2><div>${g.length} runs: blocked after snapshot ${g.filter((r) => r.blockedAfterSnapshot).length}/${g.length}, deletion committed ${g.filter((r) => r.statusAfterDelete === 'DELETING').length}/${g.length}, record revision 2 ${g.filter((r) => r.recordRevision === '2').length}/${g.length}, journal rows added after the deletion: <span class="ok">${g.map((r) => r.journalAddedAfterDeletion).join(' ')}</span></div></div>
<div><h2>Mutants</h2>${t3}</div></div>
<h2>The mid-commit IT (processlist probe) on two engines</h2>${t2}
<h2>Suites, TS and E2E</h2>${t4}
<div class="note">The landed patch behaves exactly like the round-1 candidate on the real stack (bricked 15 → 8, only the design-named residue left), all seven targeted mutants are killed, and the processlist probe works on MySQL 8.4 — not covered by CI, whose ManagedAgentMySqlIT lane is MariaDB — and keeps the IT a witness on both engines.</div>
</div></body></html>`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1000 } });
writeFileSync(`${FIG}/05-round2.html`, html);
const p = await ctx.newPage();
await p.goto(`file://${FIG}/05-round2.html`);
const clipped = await p.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
await p.locator('#card').screenshot({ path: `${FIG}/05-round2.png` });
console.log(`05-round2.png clipped=${clipped}`);
await browser.close();
