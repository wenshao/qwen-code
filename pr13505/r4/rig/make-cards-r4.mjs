// VERIFICATION RIG ONLY (PR #13505 round 4): evidence cards for head e4b7f0fc, rendered from result files.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13505-rig';
const FIG = `${RIG}/fig/r4`;
mkdirSync(FIG, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13505-h4/package.json');
const { chromium } = require('playwright');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jsonl = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tsv = (f) => existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px;background:#0d1117;min-width:1100px}
h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:18px 0 8px;color:#c9d1d9}
.sub{color:#8b949e;font-size:13.5px;margin-bottom:14px;max-width:1700px}
table{border-collapse:collapse;font-size:13px}
th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{margin-top:14px;border-left:4px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:13.5px;max-width:1500px}
.cols{display:flex;gap:24px;align-items:flex-start}
`;
const page = (title, sub, body, note) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</div></body></html>`;
const vd = (f) => { const s = readFileSync(`${RIG}/diff/${f}`, 'utf8').split('VERDICT-DIFFS ')[1].split('\n')[0]; const m = s.match(/'accept': (\d+)/); return m ? Number(m[1]) : 0; };
const crit = Object.fromEntries(tsv(`${RIG}/results/critall-r4.tsv`).map((r) => [r[0], r]));

const card1 = () => {
  const g = Object.fromEntries(['h4', 'm4'].map((a) => [a, jsonl(`${RIG}/results/probe-${a}-r4-guards.jsonl`)]));
  const rb = Object.fromEntries(['h4', 'm4'].map((a) => [a, jsonl(`${RIG}/results/probe-${a}-root-binding.jsonl`)]));
  const nf = jsonl(`${RIG}/results/probe-h4-nonfinite.jsonl`);
  const cell = (rows, c, p) => { const r = rows.find((x) => x.case === c && x.path === p); if (!r) return ['–', 'dim']; const refused = r.outcome ? r.outcome.startsWith('REFUSED') : r.http === 409; return [r.outcome ? r.outcome.split(' ')[0] : `${r.http}`, refused ? 'ok' : 'bad']; };
  const rows = [
    ['Definition pin at dispatch (R1-3 / P2)', 'definition-at-dispatch', 'g'],
    ['Runtime binding for an attached child Session (R1-2 / P1)', 'runtime-for-attached-session', 'g'],
    ['Drive-qualified workingDirectory (R1-4 / P1)', 'drive-working-directory', 'g'],
    ['First-level child: rootSessionId ≠ this Session (new rule)', 'depth1-foreign-root', 'rb'],
  ].map(([label, c, kind]) => {
    const src = kind === 'g' ? g : rb;
    const ct = kind === 'g' ? c : `ts-${c}`, cj = kind === 'g' ? c : `java-${c}`;
    const cells = ['h4', 'm4'].flatMap((a) => [cell(src[a], ct, 'ts-authority'), cell(src[a], cj, 'raw-http')]);
    return `<tr><td>${esc(label)}</td>${cells.map(([v, cl]) => `<td class="mono ${cl}">${esc(v)}</td>`).join('')}</tr>`;
  }).join('');
  const ctrl = ['h4', 'm4'].map((a) => `${a}: depth-2 foreign root ${rb[a].filter((r) => r.case.includes('depth2')).map((r) => r.outcome ?? r.http).join('/')} · own root ${rb[a].filter((r) => r.case.includes('own-root')).map((r) => r.outcome ?? r.http).join('/')}`).join(' · ');
  const nrH = tsv(`${RIG}/results/noruntime-h4.tsv`).filter((r) => r[0].startsWith('pair'));
  const deH = tsv(`${RIG}/results/deadend-h4.tsv`);
  const nrC = Object.fromEntries(tsv(`${RIG}/results/nr2-cand4.tsv`).map((r) => [r[0], r]));
  const lab = (id) => id.replace('pair dispatch(no rt) -> ', 'dispatch(no rt) → ').replace(' -> ', ' → ');
  const nr = [...deH.filter((r) => !r[0].startsWith('body')), ...nrH].map((r) => { const c = nrC[r[0]]; const dead = r[0].includes('WITH runtime'); return `<tr><td class="mono">${esc(lab(r[0]))}${dead ? ' <span class="warn">(dead end)</span>' : ''}</td><td class="mono ${dead ? 'warn' : 'dim'}">${esc(r[1])} / ${esc(r[2])}</td><td class="mono dim">${c ? esc(c[1]) + ' / ' + esc(c[2]) : '–'}</td></tr>`; }).join('');
  const dh = deH.find((r) => r[0].startsWith('body')); const dc = nrC['body dispatch_started runtime null'];
  const mut = tsv(`${RIG}/results/mutants-r4.tsv`).filter((r) => r[0] !== 'BASELINE');
  const killed = mut.filter((r) => r[1] === 'KILLED').length;
  const surv = mut.filter((r) => r[1] !== 'KILLED').map((r) => r[0]);
  const newm = mut.filter((r) => /^(J4|T4)-(def|runtime|drive|root|finite)/.test(r[0])).map((r) => `${r[0]} ${r[1]}`).join(' · ');
  const cli = tsv(`${RIG}/results/r1-1-r4.tsv`).map((r) => `${r[0]}: ${r[1]}`).join(' · ');
  return page('Round 4 (e4b7f0fc): the review findings are fixed, verified on a real stack',
    'e4b7f0fc = 27ba5c26 (the fix commit) + an automatic merge of main ac497aee (tree identical to git\'s own merge) · m4 = trial merge into current main f3385785 · Spring Session Store on native MySQL 8.4.7 · each refusal is the only reason the revision fails (the chain is otherwise legal) · TS = the real authority, raw-HTTP = a second writer, so the Java store decides alone',
    `<div class="cols"><div><table><tr><th>rule</th><th>h4 TS</th><th>h4 Java</th><th>m4 TS</th><th>m4 Java</th></tr>${rows}</table>
     <div class="dim" style="margin-top:6px;font-size:12.5px">controls: ${esc(ctrl)} · resultVersion 1e400 over HTTP: ${esc(nf.map((r) => r.http).join(' / '))} (reader refuses first) · every Session reopens</div>
     <h2>A dispatch recorded with runtime: null (P2 on this head, review 5436103482)</h2>
     <table><tr><th>the dispatch itself</th><th class="mono warn">${esc(dh[1])} / ${esc(dh[2])} on e4b7f0fc</th><th class="mono ok">refused / refused · candidate</th></tr>
     <tr><th>next revision</th><th>e4b7f0fc (TS / Java)</th><th>candidate (TS / Java)</th></tr>${nr}</table></div>
     <div><h2 style="margin-top:0">Mutants on e4b7f0fc (PR suites)</h2><table>
     <tr><td>all</td><td class="mono ${surv.length === 1 ? 'ok' : 'warn'}">${killed}/${mut.length} killed · survivors: ${esc(surv.join(', '))} (pre-existing)</td></tr>
     <tr><td>round-4 rules</td><td class="mono ok">${esc(newm)}</td></tr>
     <tr><td>R1-1 restore (cli)</td><td class="mono ok">${esc(cli)}</td></tr></table></div></div>`,
    'Every finding both reviews called blocking is fixed, in TS and Java with the same message, on the head and on the trial merge. Each new rule is pinned: removing it turns a PR test red. One gap remains, raised as a P2 on this head. The Runtime binding is required only once a child Session id appears, so a dispatch recorded without a binding is still accepted and committed. Its child can then never be attached, not even with a binding or via outcome_unknown recovery. The candidate (TS + Java + 1 fixture) requires the binding at dispatch and exempts not_started_proven.');
};

const card2 = () => {
  const xv = readFileSync(`${RIG}/diff/xver-ts-h3-h4.txt`, 'utf8').split('\n');
  const xvj = readFileSync(`${RIG}/diff/xver-java-h3-h4.txt`, 'utf8').split('\n');
  const vc = xv.filter((l) => /^\s+\d+ \('(one|pair)'/.test(l)).map((l) => l.trim().replace(/ c\d+$/, ''));
  const shellClause = xv.filter((l) => l.includes("('shell'")).reduce((n, l) => n + Number(l.trim().split(' ')[0]), 0);
  const diffRows = [
    ['corpus seeded from the round-4 fixtures (644,324 rows)', vd('compare-h4-corpus4.txt'), vd('compare-m4-corpus4.txt')],
    ['round-1 corpus (573,903 rows)', vd('compare-h4-corpus.txt'), vd('compare-m4-corpus.txt')],
  ].map(([l, a, b]) => `<tr><td>${esc(l)}</td><td class="mono ${a ? 'bad' : 'ok'}">${a} disagreements</td><td class="mono ${b ? 'bad' : 'ok'}">${b} disagreements</td></tr>`).join('');
  const ts = tsv(`${RIG}/results/ts.tsv`).filter((r) => ['h4', 'm4'].includes(r[2]));
  const it = tsv(`${RIG}/results/it.tsv`).filter((r) => r[1] === 'm4');
  const jt = tsv(`${RIG}/results/jtest.tsv`).filter((r) => r[1] === 'store-on-mysql-h4');
  const suite = existsSync(`${RIG}/logs/suite-m4.log`) ? (() => { const s = readFileSync(`${RIG}/logs/suite-m4.log`, 'utf8'); const m = [...s.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].sort((a, b) => Number(b[1]) - Number(a[1]))[0]; const e = [...s.matchAll(/managedagent\.(\w+\.\w+)[^\n]*<<< (?:ERROR|FAILURE)!$/gm)].map((x) => x[1]); return [m ? `run ${m[1]} · failed ${m[2]} · errors ${m[3]} · skipped ${m[4]}` : '?', e.join(', ')]; })() : ['(pending)', ''];
  const reruns = tsv(`${RIG}/results/r4-reruns.tsv`);
  const srow = [
    ...ts.map((r) => [`TS ${r[1]} · ${r[2]}`, r[5].trim().replace(' | ', ' · '), r[3]]),
    ['Java surefire · m4', suite[0], suite[1]],
    ...it.map((r) => ['Java MySQL ITs (native 8.4.7) · m4', r[4].replace('[INFO] ', ''), r[3]]),
    ...jt.map((r) => ['PR ManagedExtensionRecordStoreTest on MySQL 8.4.7 · h4', r[3].replace('[INFO] ', ''), r[2]]),
    ...reruns.map((r) => [r[0], r[1], r[2] ?? '']),
  ].map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'mono' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
  return page('Round 4: parity, cross-version behaviour, and suites',
    'TS ↔ Java differential through both record registries; cross-version = the same round-1 corpus through the round-3 head (3261e4d4) and the round-4 head, per language',
    `<div class="cols"><div><h2 style="margin-top:0">TS ↔ Java differential</h2><table><tr><th>corpus</th><th>h4</th><th>m4</th></tr>${diffRows}</table>
     <h2>What changed from 3261e4d4 to e4b7f0fc (verdicts; TS and Java identical)</h2>
     <table><tr><th>change</th></tr>${vc.map((l) => `<tr><td class="mono">${esc(l)}</td></tr>`).join('')}
     <tr><td class="mono ok">shell bodies: 0 verdict changes · successor pairs: 0 verdict changes</td></tr>
     <tr><td class="mono dim">shell clause-order only (doubly broken bodies, stop-reason dedupe): ${shellClause} rows, mirrored in Java</td></tr></table></div>
     <div><h2 style="margin-top:0">Suites</h2><table><tr><th>run</th><th>result</th><th>note</th></tr>${srow}</table></div></div>`,
    'NOTE2');
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1800, height: 1200 } });
const pg = await ctx.newPage();
for (const [name, fn] of [['r4-01-fixes', card1], ['r4-02-parity-suites', card2]]) {
  let html = fn();
  if (html.includes('NOTE2')) html = html.replace('NOTE2', esc(readFileSync(`${RIG}/r4-note2.txt`, 'utf8').trim()));
  const file = `${FIG}/${name}.html`;
  writeFileSync(file, html);
  await pg.goto(`file://${file}`);
  await pg.locator('#card').screenshot({ path: `${FIG}/${name}.png` });
  console.log(`${name}.png`);
}
await browser.close();
