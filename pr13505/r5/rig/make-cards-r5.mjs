// VERIFICATION RIG ONLY (PR #13505 round 5): evidence cards for head 10a83866, rendered from result files.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13505-rig';
const FIG = `${RIG}/fig/r5`;
mkdirSync(FIG, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13505-h6/package.json');
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

// ---------- card 1: the findings since round 4 on the real stack ----------
const card1 = () => {
  const arms = { h4: [...jsonl(`${RIG}/results/probe-h4-r5.jsonl`)], h6: [...jsonl(`${RIG}/results/probe-h6-r5.jsonl`), ...jsonl(`${RIG}/results/probe-h6-r5b.jsonl`)], m6: [...jsonl(`${RIG}/results/probe-m6-r5.jsonl`), ...jsonl(`${RIG}/results/probe-m6-r5b.jsonl`)] };
  // a finding row: a refusal is the fix (green); a commit is the defect (red)
  const cell = (rows, c, p, expectRefuse) => {
    const r = rows.find((x) => x.case === c && x.path === p);
    if (!r) return ['–', 'dim'];
    const refused = r.outcome ? !r.outcome.startsWith('COMMITTED') : r.http !== 200;
    let v = r.outcome ? (r.outcome.startsWith('PREFIX') ? 'prefix refused' : r.outcome.split(' ')[0].toLowerCase()) : String(r.http);
    if (r.reopen === 'REFUSED') v += ' · Session no longer opens';
    return [v, refused === expectRefuse ? 'ok' : 'bad'];
  };
  const pair = (a, c, expectRefuse) => { const [t, tc] = cell(arms[a], c, 'ts-authority', expectRefuse); const [j, jc] = cell(arms[a], c, 'raw-http', expectRefuse); return `<td class="mono"><span class="${tc}">${esc(t)}</span> / <span class="${jc}">${esc(j)}</span></td>`; };
  const F = [
    ['My round-4 P2: dispatch_started, runtime null', ['dispatch-without-runtime']],
    ['05:19 P2: intent → outcome_unknown, runtime null', ['unknown-without-runtime']],
    ['Bot R1-4 (Critical): workingDirectory C:<U+2028>evil', ['drive-U+2028']],
    ['… and C:<U+2029>evil', ['drive-U+2029']],
    ['Bot R2-1: stopRequested cleared while running', ['stop-cleared']],
    ['Bot R2-1: fixed key changes (ownerScopeId)', ['fixed-key ownerScopeId']],
    ['Bot R2-1: fixed key changes (workingDirectory)', ['fixed-key workingDirectory']],
    ['Bot R2-1: fixed key changes (predecessorChildRunId)', ['fixed-key predecessorChildRunId']],
    ['Bot R2-1: fixed key changes (inputRef)', ['fixed-key inputRef']],
    ['Bot R1-5: settled child restates its result', ['settled restates result']],
    ['Bot R1-5: settled child restates its receipt', ['settled restates receipt']],
    ['Bot R2-1: acceptance names an unended sibling run', ['names unended sibling run-2']],
  ].map(([l, [c]]) => `<tr><td>${esc(l)}</td>${['h4', 'h6', 'm6'].map((a) => pair(a, c, true)).join('')}</tr>`).join('');
  const C = [
    ['a/C:x (drive check is a prefix rule)', 'control-a/C:x'],
    ['intent → not_started_proven, no binding', 'control: intent->not_started_proven no rt'],
    ['intent → corrupt, no binding', 'control: intent->corrupt no rt'],
    ['outcome_unknown with binding → re-attach', 'control: unknown(rt)->attach same rt'],
    ['dispatch with binding', 'control: dispatch'],
    ['stop request kept', 'control: stop kept'],
    ['settled delivery advances', 'control: settled delivery advances'],
    ['acceptance names the settled run', 'control: names settled run-1'],
  ].map(([l, c]) => `<tr><td>${esc(l)}</td>${['h6', 'm6'].map((a) => pair(a, c, false)).join('')}</tr>`).join('');
  const reg = readFileSync(`${RIG}/results/r6-probe-regression.txt`, 'utf8').split('\n').filter((l) => /^probe-h5(\.|-(nonfinite|settle|root|delivery))/.test(l)).map((l) => Number(l.match(/changed (\d+)/)[1])).reduce((a, b) => a + b, 0);
  return page('Round 5 (10a83866, merged as 1aba19c8): every finding since round 4, on a real stack',
    '10a83866 = e4b7f0fc (round 4) + 1682d3b3 (binding at dispatch) + b585e44c (bot R2 round) + 777e947b/10a83866 (binding at outcome_unknown) · m6 = trial merge into main 1753948e, tree byte-identical to the merged commit 1aba19c8 · Spring Session Store on native MySQL 8.4.7 · TS = the real authority, Java = a raw-HTTP second writer, so the store decides alone · each revision\'s only defect is the named rule',
    `<table><tr><th>finding</th><th>e4b7f0fc &nbsp;TS / Java</th><th>10a83866 &nbsp;TS / Java</th><th>m6 &nbsp;TS / Java</th></tr>${F}</table>
     <h2>Controls (must commit)</h2><table><tr><th>case</th><th>10a83866 &nbsp;TS / Java</th><th>m6 &nbsp;TS / Java</th></tr>${C}</table>
     <div class="dim" style="margin-top:6px;font-size:12.5px">regression: all 43 round-1…4 probe rows identical on b585e44c, 10a83866 and m6 (r4-guards' runtime case now stops at its unbound-dispatch prefix, as intended) · ${reg === 0 ? 'no other change' : reg + ' other changes'}</div>`,
    'Red cells on e4b7f0fc are the defects; every one is a refusal on the head and on the trial merge, in both languages, with the same message. The U+2028/U+2029 rows show the Critical\'s real cost: the Java store committed a line the TS authority cannot read, and the Session stopped opening. The R2-1 rules (stop request, fixed keys, settled restatement, sibling acceptance) were already enforced on e4b7f0fc; that finding was about missing tests, which the mutants on the next card measure.');
};

// ---------- card 2: parity, witnesses, suites ----------
const bmp = (L) => { let rows = 0, diff = 0, fields = 0; for (const l of readFileSync(`${RIG}/diff/bmp-${L}-summary.tsv`, 'utf8').split('\n')) { const m = l.match(/rows=(\d+).*DIFF=(\d+)/); if (m) { rows += +m[1]; diff += +m[2]; fields++; } } return { rows, diff, fields }; };
const bmpDiffs = (L) => existsSync(`${RIG}/diff/bmp-${L}-diff.jsonl`) ? jsonl(`${RIG}/diff/bmp-${L}-diff.jsonl`) : [];
const vd = (f) => { const s = readFileSync(`${RIG}/diff/${f}`, 'utf8').split('VERDICT-DIFFS ')[1].split('\n')[0]; const m = s.match(/'accept': (\d+)/); return m ? Number(m[1]) : 0; };
const card2 = () => {
  const B = Object.fromEntries(['h4', 'h5', 'h6'].map((L) => [L, bmp(L)]));
  const h4d = bmpDiffs('h4').map((d) => `${d.hex} ${d.shape.replace('cp', '<cp>')}`).join(', ');
  const bmpRows = [['e4b7f0fc', 'h4'], ['b585e44c', 'h5'], ['10a83866', 'h6']].map(([n, L]) => `<tr><td class="mono">${n}</td><td class="mono">${B[L].fields} fields · ${B[L].rows.toLocaleString('en-US')} rows</td><td class="mono ${B[L].diff ? 'bad' : 'ok'}">${B[L].diff} disagreements${L === 'h4' ? ' (' + esc(h4d) + '; Java accepts)' : ''}</td></tr>`).join('');
  const dif = [['seeded corpus (691,235 rows)', 'corpus6'], ['round-1 corpus (573,903 rows)', 'corpus']].map(([l, c]) => `<tr><td>${l}</td>${['h4', 'h6', 'm6'].map((L) => { const f = `compare-${L}-${c}.txt`; if (!existsSync(`${RIG}/diff/${f}`)) return '<td class="dim">–</td>'; const n = vd(f); return `<td class="mono ${n ? 'bad' : 'ok'}">${n}</td>`; }).join('')}</tr>`).join('');
  const xv = (f) => readFileSync(`${RIG}/diff/${f}`, 'utf8').split('\n').filter((l) => /^\s+\d+ \('(one|pair)'/.test(l)).map((l) => l.trim().replace(/ c\d+$/, '').replace(/^(\d+) \('(one|pair)', 'child_agent', /, '$1 $2 child_agent ').replace(/\)$/, ''));
  const xvRows = [['b585e44c → 10a83866 · TS', 'xver-ts-h5-h6.txt'], ['b585e44c → 10a83866 · Java', 'xver-java-h5-h6.txt'], ['e4b7f0fc → 10a83866 · TS', 'xver-ts-h4-h6.txt'], ['e4b7f0fc → 10a83866 · Java', 'xver-java-h4-h6.txt']].map(([l, f]) => `<tr><td>${l}</td><td class="mono">${xv(f).map(esc).join('<br>')}</td></tr>`).join('');
  const vac = readFileSync(`${RIG}/results/r5-succ-vacuity.txt`, 'utf8').split('\n').filter((l) => /^h[46]:/.test(l)).map((l) => { const n = l.match(/successors (\d+)/)[1]; const v = Number((l.match(/(?:unparseable side: |vacuous valid:false pairs )(\d+)/) || [])[1]); const mm = l.match(/mismatch:? (\d+)/)[1]; const w = l.match(/fixture:? (\d+)/)[1]; return `<tr><td class="mono">${esc(l.startsWith('h4') ? 'e4b7f0fc' : '10a83866')}</td><td class="mono ${v ? 'bad' : 'ok'}">${n} successors · ${v} vacuous valid:false pairs${v ? ' (agent-result-restated, agent-receipt-restated)' : ''} · TS/Java mismatch ${mm} · verdict ≠ fixture ${w}</td></tr>`; }).join('');
  const mut = tsv(`${RIG}/results/mutants-r6.tsv`).filter((r) => r[0] !== 'BASELINE' && !r[1].startsWith('ANCHOR'));
  const killed = mut.filter((r) => r[1] === 'KILLED').length;
  const rr = Object.fromEntries(tsv(`${RIG}/results/mutants-r6-rerun.tsv`).filter((r) => r[0] !== 'BASELINE').map((r) => [r[0], r]));
  const rb = tsv(`${RIG}/results/mutants-r6-rerun.tsv`).filter((r) => r[0] === 'BASELINE').map((r) => `${r[1]} ${r[3].replace('total=', '')} tests`).join(' · ');
  const st = (id) => { const r = mut.find((x) => x[0] === id); return r ? r[1] : '–'; };
  const M = [
    ['binding at dispatch / at outcome_unknown', ['T6-dispatch-rt', 'T6-unknown-rt'], ['J6-dispatch-rt', 'J6-unknown-rt']],
    ['drive spec removed', ['T5-drive-delete'], ['J5-drive-delete']],
    ['drive spec back to full-match matches()', [], ['J5-drive-matches']],
    ['stopRequested never cleared (bot M1)', ['T5-stop-cleared'], ['J5-stop-cleared']],
    ['terminal branch: whole / rest / run advance', ['T5-terminal-branch', 'T5-terminal-rest', 'T5-terminal-run'], ['J5-terminal-branch', 'J5-terminal-rest', 'J5-terminal-run']],
    ['failed-state freeze', ['T5-failed-freeze'], ['J5-failed-freeze']],
    ['fixed keys, one at a time (5)', ['ownerScopeId', 'rootSessionId', 'workingDirectory', 'inputRef', 'predecessorChildRunId'].map((k) => `T5-fixed-${k}`), ['ownerScopeId', 'rootSessionId', 'workingDirectory', 'inputRef', 'predecessorChildRunId'].map((k) => `J5-fixed-${k}`)],
    ['cancelled after settled exec / childSessionId id / a//b', ['T5-cancel-settled', 'T5-session-id', 'T5-empty-segment'], ['J5-cancel-settled', 'J5-session-id', 'J5-empty-segment']],
    ['depth === 1 qualifier (bot M7)', ['T5-depth1'], ['J5-depth1']],
    ['drive spec find() for lookingAt()', [], ['J5-drive-find']],
  ].map(([l, t, j]) => { const f = (ids) => ids.length ? ids.map((id) => { const s = st(id); const broad = rr[id] ? ` (broad: ${rr[id][1].toLowerCase()})` : ''; return `<span class="${s === 'KILLED' ? 'ok' : 'bad'}">${s.toLowerCase()}${broad}</span>`; }).join(' ') : '<span class="dim">–</span>'; return `<tr><td>${esc(l)}</td><td class="mono">${f(t)}</td><td class="mono">${f(j)}</td></tr>`; }).join('');
  const cw = tsv(`${RIG}/results/cand6-witness.tsv`).map((r) => `<tr><td class="mono">${esc(r[0])}</td><td>${esc(r[1] === 'baseline' ? 'candidate as is' : r[1] + ' → must go red')}</td><td class="mono ${r[1] === 'baseline' ? (r[2].startsWith('0') ? 'ok' : 'bad') : (r[2].startsWith('1') ? 'ok' : 'bad')}">${esc(r[2].replace(/^\d /, '').replace('[INFO] ', '').replace('[ERROR] ', '').trim())}</td></tr>`).join('');
  const suites = existsSync(`${RIG}/r5-suites-en.md`) ? readFileSync(`${RIG}/r5-suites-en.md`, 'utf8').split('\n').filter((l) => /^\| (?!Run|---)/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, ''))) : [];
  const srow = suites.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'mono' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
  return page('Round 5: parity, witnesses and suites',
    'code-point sweep = every string field of three valid bodies × every BMP code point (lone surrogates included) + every 256th astral one, as suffix and as whole value (+4 drive shapes for workingDirectory), through both real validators · mutants = one anchored edit each, PR suites rerun; survivors rerun on the whole TS managed-runtime suite and the whole Java unit suite',
    `<div class="cols"><div><h2 style="margin-top:0">Full-code-point sweep, TS ↔ Java</h2><table><tr><th>head</th><th>size</th><th>result</th></tr>${bmpRows}</table>
     <h2>Differential, TS ↔ Java (verdict disagreements)</h2><table><tr><th>corpus</th><th>e4b7f0fc</th><th>10a83866</th><th>m6</th></tr>${dif}</table>
     <h2>Cross-version verdict changes (same corpus)</h2><table>${xvRows}</table>
     <h2>Shared successor fixtures, merged as both harnesses do</h2><table>${vac}</table></div>
     <div><h2 style="margin-top:0">Mutants on 10a83866: ${killed}/${mut.length} killed by the PR suites</h2><table><tr><th>rule</th><th>TS</th><th>Java</th></tr>${M}</table>
     <div class="dim" style="margin-top:6px;font-size:12.5px">broad reruns: ${esc(rb)} (hook-scale timeouts and two main-side Java tests excluded) · J9 (pre-existing) also survives</div>
     <h2>Candidate (test-only) on 10a83866</h2><table><tr><th>lang</th><th>arm</th><th>result</th></tr>${cw}</table>
     <h2>Suites</h2><table><tr><th>run</th><th>arm</th><th>result</th><th>note</th></tr>${srow}</table></div></div>`,
    '');
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1800, height: 1200 } });
const pg = await ctx.newPage();
for (const [name, fn] of [['r5-01-findings', card1], ['r5-02-parity-witnesses', card2]]) {
  const html = fn();
  const file = `${FIG}/${name}.html`;
  writeFileSync(file, html);
  await pg.goto(`file://${file}`);
  await pg.locator('#card').screenshot({ path: `${FIG}/${name}.png` });
  console.log(`${name}.png`);
}
await browser.close();
