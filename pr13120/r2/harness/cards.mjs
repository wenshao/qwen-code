// Evidence cards for PR #13120, rendered from the recorded lane results.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { MUTANTS } from '../harness/mutants.mjs';

const S = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(S, 'wt-pr/package.json'));
const { chromium } = require('playwright');
const OUT = path.join(S, 'fig');
const BASE = 'd3c2edc606', MID = '6921388b8e', HEAD = '90d6f93764';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sp = (c, s) => `<span class="${c}">${esc(s)}</span>`;
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const card = (title, sub, body, note) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:22px 26px 20px;background:#0d1117}
h1{font-size:21px;margin:0 0 4px;font-weight:650}.sub{color:#8b949e;font-size:13.5px;margin-bottom:14px;max-width:1180px}
pre{font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;white-space:pre;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px 14px}
.g{color:#3fb950}.r{color:#f85149}.a{color:#d29922}.b{color:#79c0ff}.m{color:#8b949e}.w{color:#e6edf3;font-weight:600}
.note{margin-top:12px;border-left:3px solid #3fb950;padding:4px 0 4px 12px;font-size:13.5px;color:#c9d1d9;max-width:1180px}
</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div><pre>${body}</pre><div class="note">${note}</div></div></body></html>`;

const read = (lang, arm, id) => {
  const f = path.join(S, 'results', lang, `${arm}-${id}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
// Case ids a failing run names: Java lists them in the assertion message,
// Vitest in the (possibly …-shortened) test title.
const javaCases = (r) => r.red.flatMap((x) => {
  const m = /but was: <\[(.*)\]>/.exec(x.message ?? '');
  return m ? m[1].split(', ').map((s) => s.split('/').pop()) : [`${x.name} ${x.type?.split('.').pop()}`];
});
const tsCases = (r) => r.red.map((x) => {
  const m = /'([^']+)'/.exec(x.name);
  return m ? m[1] : x.name;
});
const cases = (lang, r) => (lang === 'java' ? javaCases(r) : tsCases(r));
const verdict = (lang, r) => (!r ? sp('m', 'not run') : r.red.length === 0 ? sp('a', `survives ${r.tests}/${r.tests}`) : sp('r', `FAILS ${r.red.length} test${r.red.length > 1 ? 's' : ''}`));

const cell = (r, w) => {
  const t = !r ? 'not run' : r.red.length === 0 ? `survives ${r.tests}/${r.tests}` : `FAILS ${r.red.length} test${r.red.length > 1 ? 's' : ''}`;
  return sp(!r ? 'm' : r.red.length ? 'r' : 'a', pad(t, w));
};
const cards = [];

// ---- 1. issue #12887 item 1 matrix, both languages
{
  const ROWS = [
    ['J01', 'runtime_lost operand dropped'],
    ['T01', 'runtime_lost operand dropped'],
    ['J02', 'high surrogate need not be followed by a low one'],
    ['T02', 'well-formedness only checks lone surrogates at the end'],
    ['J03', 'count drops isNumber(): text reads as 0'],
    ['J03b', 'count also takes text (reads as 0)'],
    ['J04', 'digest drops isTextual()'],
    ['J05', 'closed() drops isObject(): array key accepted'],
    ['J06', 'corrupt execution treated as unstarted'],
    ['T06', 'corrupt execution treated as unstarted'],
    ['J07', 'phase needs two or more characters'],
    ['T07', 'phase needs two or more characters'],
    ['J08', 'one observation allowed without a start receipt'],
    ['T08', 'one observation allowed without a start receipt'],
    ['J09', 'durable ref byteLength minimum 1'],
    ['T09', 'durable ref byteLength minimum 1'],
    ['J10a', 'isTransitionAllowed: line == null check dropped'],
    ['J10b', 'isTransitionAllowed: from == null check dropped'],
    ['J11', 'execution may step settled -> running_attached'],
    ['T11', 'execution may step settled -> running_attached'],
  ];
  const lines = [sp('b', `${pad('id', 5)}${pad('lang', 5)}${pad('regression in the production validator', 62)}${pad(`base ${BASE}`, 18)}${pad(`PR ${HEAD}`, 16)}case that fails at head`)];
  let kills = 0;
  for (const [id, what] of ROWS) {
    const lang = id.startsWith('J') ? 'java' : 'ts';
    const b = read(lang, 'base', id), h = read(lang, 'head', id);
    const okPattern = b && h && b.red.length === 0 && h.red.length > 0;
    if (okPattern) kills++;
    let at = h && h.red.length ? cases(lang, h).join(', ') : '';
    if (id === 'J04') at = 'scope-record-digest-as-number + replacement-… (NPE, see card 3)';
    if (id.startsWith('J10')) at = `${id === 'J10a' ? 'null line' : 'null from'} assertion → NullPointerException`;
    lines.push(`${pad(id, 5)}${sp('m', pad(lang === 'java' ? 'Java' : 'TS', 5))}${pad(what, 62)}${cell(b, 18)}${cell(h, 16)}${sp('g', at)}`);
  }
  lines.push('');
  lines.push(sp('w', `survive at base, fail at head: ${kills}/${ROWS.length}`) + sp('m', '  (Java runs ManagedExtensionRecordContractTest; TS runs the record + gate suites)'));
  lines.push('');
  const OTHER = [
    ['T03', 'TS count takes numeric text', 'already pinned at base by revision-text'],
    ['T05', 'TS object() drops the array check', 'survives both: assertNoUnknownKeys still refuses; row 5 is Java'],
    ['J12', 'probe: rebinding allowed from any execution', 'same failing cases on both arms'],
    ['J13', 'probe: rebuild may keep the old receipt', 'same failing cases on both arms'],
    ['JP1', 'control: 65-character phase', 'phase-too-long on both arms'],
    ['TP2', 'control: lost-Runtime-while-attached rule removed', 'blocked-by-a-lost-runtime… on both arms'],
    ['J09s', 'durable ref schemaVersion minimum 1 (issue code column :669)', 'SURVIVES BOTH: no case has schemaVersion 0'],
  ];
  for (const [id, what, why] of OTHER) {
    const lang = id.startsWith('J') ? 'java' : 'ts';
    const b = read(lang, 'base', id), h = read(lang, 'head', id);
    const same = b && h && JSON.stringify(cases(lang, b)) === JSON.stringify(cases(lang, h));
    const cls = id === 'J09s' ? 'a' : 'm';
    lines.push(`${pad(id, 5)}${sp('m', pad(lang === 'java' ? 'Java' : 'TS', 5))}${pad(what, 62)}base ${b.red.length ? sp('r', 'fails') : sp('a', 'passes')} · head ${h.red.length ? sp('r', 'fails') : sp('a', 'passes')}${same && b.red.length ? sp('g', ' (identical)') : ''}  ${sp(cls, why)}`);
  }
  cards.push(['01-issue-12887-matrix', card('#12887 item 1: each listed regression now fails the suite of its language',
    `Maven 3.9.16 + Zulu JDK 21.0.12 (surefire, offline) and Vitest on Node 22.23.2 · every arm runs on the ${HEAD} tree (main merged); the base arm puts back the ${BASE} fixture JSON and test files · each mutant is one find/replace`,
    lines.join('\n'),
    `Every row of the issue's table and the proven-end isolation: the regression passes the base corpus and fails at head, and the failure names exactly the case the PR added for it. Positive controls fail on both arms, and the two binding/receipt probes fail on the same cases on both arms, so rewriting the proven-end pair cost no coverage. One leftover: the issue's code column also cites the schemaVersion floor (:669); no case pins it.`)]);
}

// ---- 2. gate preservation across base / 6921388b / head
{
  const G = [
    ['G1', 'a malformed grant clears the installed grants'],
    ['G2', 'a malformed grant is stored over the installed one, then thrown'],
    ['G3', 'a malformed grant shortens the installed lease to expiresAt=1'],
  ];
  const lines = [sp('b', `${pad('id', 4)}${pad('regression in ManagedOperationGrantGate.install()', 66)}${pad(`base ${BASE}`, 18)}${pad(`${MID} (admits)`, 26)}${pad(`head ${HEAD} (+unchanged)`, 28)}`)];
  for (const [id, what] of G) {
    const cell = (arm, w) => {
      const r = read('ts', arm, id);
      const s = r.red.length ? `${r.red.length}/3 cases fail` : 'survives';
      return `${sp(r.red.length === 3 ? 'g' : r.red.length ? 'a' : 'r', s)}${' '.repeat(Math.max(1, w - s.length))}`;
    };
    lines.push(`${pad(id, 4)}${pad(what, 66)}${cell('base', 18)}${cell('mid', 26)}${cell('head', 28)}`);
  }
  lines.push('');
  const g2 = read('ts', 'mid', 'G2');
  lines.push(sp('m', `G2 at ${MID}: only ${tsCases(g2).join(', ')} fails (its refused next narrows phases); the other two refused grants keep the phases, so admits() still says true`));
  lines.push(sp('m', `G3 at ${MID}: admits() is probed at now=0, so a shortened lease is invisible`));
  lines.push(sp('m', `the cases: invalid-next, next-past-double-range, replacement-with-a-non-text-digest (new)`));
  for (const arm of ['base', 'mid', 'head']) {
    const r = read('ts', arm, 'none');
    lines.push(`${sp('w', `pristine ${pad(arm, 4)}`)} record + gate suites ${sp('g', `${r.tests - r.red.length}/${r.tests} pass`)}`);
  }
  cards.push(['02-gate-keeps-the-previous-grant', card('Gate: a refused malformed replacement leaves the previous grant installed',
    'Vitest, managed-operation-grant-gate.test.ts replayed over grantSuccessorCases · all arms on the 90d6f93764 tree; they differ only in the test file and fixtures',
    lines.join('\n'),
    `${MID} added the admits() probe; 00a6dbe7b8 added "install(previous) answers unchanged", which is what tells which grant survived. At ${MID} the shortened lease passes and the eager write is caught by invalid-next alone; at head all three malformed-replacement cases catch both.`)]);
}

// ---- 3. per-case verdicts + census + merge + suites
{
  const ts = JSON.parse(fs.readFileSync(path.join(S, 'results/ts-verdicts.json'), 'utf8'));
  const tsv = (v) => Object.fromEntries(fs.readFileSync(path.join(S, `results/java-drive-${v}.tsv`), 'utf8').trim().split('\n').map((l) => l.split('\t')).map((c) => [c[2], c]));
  const jp = tsv('pristine'), j4 = tsv('J04'), j10a = tsv('J10a'), j10b = tsv('J10b');
  const LIST = { grantCases: 'grant', grantSuccessorCases: 'grant pair', runCases: 'run', monitorRunCases: 'monitor', monitorRunSuccessorCases: 'monitor pair' };
  const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const lines = [sp('b', `${pad('case (list)', 64)}${pad('label', 7)}${pad('TS dist', 9)}${pad('Java', 7)}${pad('Ajv', 7)}refusal (Java)`)];
  let agree = 0;
  for (const r of ts) {
    const j = jp[r.id];
    const jv = j[4];
    const ok = String(r.verdict) === String(r.label) && jv === String(r.label);
    if (ok) agree++;
    const schema = r.schema === undefined ? '—' : String(r.schema);
    const msg = (j[5] || '').replace('InvalidRecordException: ', '').replace(/\.$/, '');
    const list = r.list.replace('Cases', '').replace('SuccessorCases', '');
    lines.push(`${pad(`${r.id} (${LIST[r.list]})`, 64)}${pad(r.label, 7)}${sp(String(r.verdict) === String(r.label) ? 'g' : 'r', pad(r.verdict, 9))}${sp(jv === String(r.label) ? 'g' : 'r', pad(jv, 7))}${sp(schema === 'true' && !r.label ? 'a' : 'm', pad(schema, 7))}${sp('m', cut(msg, 58))}`);
  }
  lines.push(`${sp('w', `${agree}/${ts.length} agree in both languages`)}; Ajv differs from the label only on the surrogate case (the one BEYOND_SCHEMA line the PR adds)`);
  lines.push('');
  lines.push(sp('b', 'Java exceptions the new checks catch (mutant classes on the classpath):'));
  lines.push(`  J04  scope-record-digest-as-number      → ${sp('r', j4['scope-record-digest-as-number'][4])} ${esc(j4['scope-record-digest-as-number'][5].split(' because')[0])}`);
  lines.push(`  J04  replacement-with-a-non-text-digest → ${sp('r', j4['replacement-with-a-non-text-digest'][4])} out of isOperationGrantSuccessor (pristine: ${jp['replacement-with-a-non-text-digest'][4]})`);
  lines.push(`  J10a isTransitionAllowed(null, …)        → ${sp('r', j10a['isTransitionAllowed(null,reserved,admitted)'][4])} ${esc(j10a['isTransitionAllowed(null,reserved,admitted)'][5].split(' because')[0])}`);
  lines.push(`  J10b isTransitionAllowed(run, null, …)   → ${sp('r', j10b['isTransitionAllowed(run,null,admitted)'][4])} (pristine: false)`);
  lines.push('');
  const base = JSON.parse(fs.readFileSync(path.join(S, 'arms/base/fixtures.json'), 'utf8'));
  const head = JSON.parse(fs.readFileSync(path.join(S, 'arms/head/fixtures.json'), 'utf8'));
  const lists = Object.keys(head).filter((k) => k.endsWith('Cases'));
  const n = (f) => lists.map((k) => f[k].length);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  lines.push(`${sp('w', 'census')}  base ${n(base).join('/')} = ${sum(n(base))}  →  head ${sp('g', `${n(head).join('/')} = ${sum(n(head))}`)}  (both design docs say 568 with these eight numbers)`);
  let unchanged = 0;
  for (const k of lists) for (const c of base[k]) { const h = head[k].find((x) => x.id === c.id); if (h && JSON.stringify(h) === JSON.stringify(c)) unchanged++; }
  lines.push(`${sp('w', 'shape ')}  ${unchanged}/${sum(n(base))} existing cases byte-identical; 10 added; 1 rewritten (binding + receipt kept, renamed)`);
  const hm = JSON.parse(fs.readFileSync(path.join(S, 'results/head-managed-runtime.json'), 'utf8'));
  const merge = fs.readFileSync(path.join(S, 'results/trial-merge.txt'), 'utf8');
  const mainSha = /main=([0-9a-f]{10})/.exec(merge)[1];
  lines.push(`${sp('w', 'suites')}  head: Java contract ${sp('g', `${read('java', 'head', 'none').tests - read('java', 'head', 'none').red.length}/${read('java', 'head', 'none').tests}`)} · managed-runtime ${sp('g', `${hm.numPassedTests}/${hm.numTotalTests}`)} (record 578 + gate 28 + authority.extension 36 + …) · tsc, eslint, prettier, checkstyle ${sp('g', 'clean')}`);
  lines.push(`${sp('w', 'merge ')}  head already merges main e083d6a6b8; trial merge onto main ${mainSha}: clean, adds only runtime-broker files, contract files identical`);
  cards.push(['03-case-verdicts', card('The ten new cases and the rewritten pair, judged by the built modules',
    `packages/core/dist (npm run build) + Ajv 2020 · managed-agent-server target/classes (JDK 21) · fixtures at ${HEAD}`,
    lines.join('\n'),
    'Both shipped validators agree with every new label, each refusal names the rule the case is aimed at, and the Java exceptions the issue describes are exactly what the new cases catch. The rest of the corpus is untouched, and the change merges cleanly onto current main.')]);
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1500, height: 900 } });
for (const [name, html] of cards) {
  const file = path.join(OUT, `${name}.html`);
  fs.writeFileSync(file, html);
  await page.goto(`file://${file}`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
  await page.locator('#card').screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name, 'clipped-pre', clipped);
}
await browser.close();
