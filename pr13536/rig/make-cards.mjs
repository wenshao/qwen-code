// VERIFICATION RIG ONLY (PR #13536): evidence cards rendered from the rig's result files.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const RIG = '/Users/wenshao/git/pr13536-rig';
const FIG = `${RIG}/fig`;
const require = createRequire('/Users/wenshao/git/pr13536-head/package.json');
const { chromium } = require('playwright');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jsonl = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tsv = (f) => existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px;background:#0d1117;min-width:1000px}
h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:18px 0 8px;color:#c9d1d9}
.sub{color:#8b949e;font-size:13.5px;margin-bottom:14px;max-width:1500px}
table{border-collapse:collapse;font-size:13px}
th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{margin-top:14px;border-left:4px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:13.5px;max-width:1500px}
.cols{display:flex;gap:24px;align-items:flex-start}
`;
const page = (title, sub, body, note) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</div></body></html>`;
const head = jsonl(`${RIG}/results/probe-head.jsonl`);
const base = jsonl(`${RIG}/results/probe-base.jsonl`);
const cand = jsonl(`${RIG}/results/probe-cand.jsonl`);

// ---------- card 1: the Java store gate, base vs head, and the faithful lifecycle ----------
const card1 = () => {
  const gate = (rows, arm, c) => rows.find((r) => r.arm === arm && r.scenario === 'java-body-gate' && r.case === c);
  const cases = head.filter((r) => r.scenario === 'java-body-gate').map((r) => r.case);
  const cell = (r, expect409) => {
    if (!r) return '<td class="dim">–</td>';
    const okHttp = expect409 ? r.http === 409 : r.http === 200;
    const reopen = r.reopen === 'OPENED' ? '<span class="ok">opens</span>' : '<span class="bad">no longer opens</span>';
    return `<td class="mono"><span class="${okHttp ? 'ok' : 'bad'}">${r.http}</span> · ${reopen}</td>`;
  };
  const rows = cases.map((c) => {
    const expect409 = !(c.startsWith('control') || c === 'goal-1365-lone-surrogates');
    const h = gate(head, 'head', c);
    const msg = h?.code?.message ?? '';
    return `<tr><td class="mono">${esc(c)}</td><td>${expect409 ? 'invalid' : '<span class="dim">valid</span>'}</td>${cell(gate(base, 'base-store+head-reader', c), expect409)}${cell(h, expect409)}<td class="mono dim">${esc(msg.slice(0, 64))}</td></tr>`;
  }).join('');
  const f = head.filter((r) => r.scenario === 'faithful-chain' && r.views).pop();
  const nInvalid = cases.filter((c) => !(c.startsWith('control') || c === 'goal-1365-lone-surrogates')).length;
  const nBricked = cases.filter((c) => gate(base, 'base-store+head-reader', c)?.reopen === 'REFUSED').length;
  const views = f.views.map((v) => `<tr><td class="mono">${esc(v.d)}${v.rec ? ' ' + esc(v.rec) : ''}</td><td class="mono">rev ${v.rev}</td><td class="mono">${esc((v.tasks || '(no task)').replace(/\/started=\w+\/settled=\w+/g, ''))}</td></tr>`).join('');
  const ref = Object.entries(f.refusals).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td class="mono ${v.startsWith('REFUSED') ? 'ok' : 'warn'}">${esc(v.replace('ManagedSessionConflictError: ', '').slice(0, 70))}</td></tr>`).join('');
  return page('PR #13536 · Java store gate and lifecycle on a real stack',
    'Spring Managed Agent Server (Session Store) on MySQL 8.4.7, Flyway V47 · base 1aba19c8 vs head 9a709b3b · each crafted body is committed by a second writer over the raw Session Store HTTP API, then a fresh head TypeScript authority reopens the Session the way the Hosted Harness does',
    `<div class="cols"><div><h2 style="margin-top:0">One crafted Stage H line per Session</h2><table><tr><th>body</th><th></th><th>base store</th><th>head store</th><th>head store's refusal</th></tr>${rows}</table></div>
     <div><h2 style="margin-top:0">Faithful chain through the real authority (domains enabled in-process only)</h2><table><tr><th>record</th><th>revision</th><th>task view after commit</th></tr>${views}</table>
     <h2>Follow-ups on that Session</h2><table>${ref}</table>
     <div class="dim" style="margin-top:6px;font-size:12.5px">command replay: rev ${f.replay.rev}, replayed=${f.replay.replayed} · fresh reopen: ${esc(f.reopen.status)} ${esc(f.reopen.sc.join(','))} ${esc(f.reopen.ar.join(','))}</div></div></div>`,
    `On base, the store has no body for either domain and stores all ${nInvalid} invalid bodies (200); the head reader then refuses to open ${nBricked} of those Sessions. On head, the Java mirror refuses each one at commit (409) and every Session still opens. The faithful lifecycle commits end to end: a Schedule projects no task, an AutomationRun task moves pending → running (unbound → provisioning → ready) → completed, a terminal Schedule and a settled run refuse further revisions. A second run with the same occurrenceKey under a new automationRunId commits — dedup is H6b\'s claim, not this contract.`);
};

// ---------- card 2: promptRef scope ----------
const card2 = () => {
  const ps = (rows, arm, c) => rows.find((r) => r.arm === arm && r.scenario === 'prompt-scope' && r.case === c);
  const rec = head.find((r) => r.scenario === 'dangling-recover');
  const fmt = (r) => {
    if (!r) return '<td class="dim">–</td>';
    const s = r.schedule.startsWith('COMMITTED') ? `<span class="${r.case.endsWith('session-local') ? 'ok' : 'bad'}">committed</span>` : `<span class="${r.case.endsWith('session-local') ? 'bad' : 'ok'}">refused</span> <span class="dim">${esc(r.schedule.replace(/^REFUSED \w+: /, '').slice(0, 56))}</span>`;
    let next = '';
    if (r.thenAutomationRun) next = `<br>next commit: ${r.thenAutomationRun.startsWith('COMMITTED') ? '<span class="ok">committed</span>' : `<span class="bad">refused</span> <span class="dim">${esc(r.thenAutomationRun.replace(/^REFUSED \w+: /, '').slice(0, 52))}</span>`}`;
    const reopen = `<br>reopen right after: ${r.reopen.status === 'OPENED' ? '<span class="ok">opens</span>' : `<span class="warn">refused</span> <span class="dim">${esc((r.reopen.error || '').replace(/^\w+: /, '').slice(0, 52))}</span>`}`;
    return `<td class="mono">${s}${next}${reopen}</td>`;
  };
  const C = [['hosted-dangling', 'HTTP store · promptRef names a resource no Session holds (fixture template)'],
    ['hosted-other-session', 'HTTP store · promptRef names a resource another Session committed'],
    ['hosted-session-local', 'HTTP store · promptRef published into this Session first'],
    ['local-file-dangling', 'local file store · promptRef names a resource no Session holds']];
  const rows = C.map(([c, l]) => `<tr><td>${esc(l)}</td>${fmt(ps(head, 'head', c))}${fmt(ps(cand, 'cand', c))}</tr>`).join('');
  const raw = (rows, arm) => rows.find((r) => r.arm === arm && r.scenario === 'java-body-gate' && r.case === 'control-schedule');
  const rh = raw(head, 'head'), rc = raw(cand, 'cand');
  const rawRow = `<tr><td>raw HTTP writer · same dangling promptRef, body shipped in the transaction</td><td class="mono"><span class="bad">${rh.http}</span> stored · reopen ${esc(rh.reopen)}</td><td class="mono"><span class="ok">${rc.http}</span> ${esc(rc.code?.message ?? '')}</td></tr>`;
  return page('PR #13536 · Where must a Schedule\'s promptRef live?',
    'Same Schedule template committed through the real TypeScript authority (schedule enabled in-process) · head 9a709b3b vs candidate = R1-5\'s one-line verifyExtensionResources branch + its Java applyRevision mirror · HTTP = real Spring Session Store on MySQL 8.4.7',
    `<table><tr><th>case</th><th>head</th><th>candidate</th></tr>${rows}${rawRow}</table>
     <div class="dim" style="margin-top:8px;font-size:12.5px">head, hosted-dangling: close() reports "${esc(rec.closeErr.slice(0, 60))}…"; reopen refused immediately and again 7 s later; the Session opened (empty) on the next try once the stale writer grant lapsed.</div>`,
    'The HTTP client walks every staged extension-record body for nested durable refs (EXTENSION_RECORD_KINDS is derived from the body registry), so registering schedule already makes promptRef part of each hosted commit\'s resource closure: a promptRef outside this Session is refused by the Java store after the body was published, the authority stops writing, and the writer grant blocks reopen until it lapses. The local file store has no such closure and commits the same record. So "publication-scope promptRef, resolved at H6b admission" cannot be committed on the hosted path as built, and the two stores disagree. The candidate makes both refuse it before publishing (clean, retryable) and keeps a Session-local promptRef working.');
};

// ---------- card 3: parity and witnesses ----------
const card3 = () => {
  const mts = tsv(`${RIG}/results/mut-ts-head.tsv`), mj = tsv(`${RIG}/results/mut-java.tsv`);
  const corpusTs = Object.fromEntries(tsv(`${RIG}/results/mut-ts-corpus.tsv`).map((r) => [r[0], r[1]]));
  const tsRows = mts.map((r) => [r[0], r[1], (r[3] || '').includes('JS-PATTERN') ? (corpusTs[r[0]] || '') : r[3]]);
  const jRows = []; const seen = new Set();
  for (const r of mj) { if (seen.has(r[0])) continue; seen.add(r[0]); jRows.push([r[0], r[1], r[4]]); }
  const candTs = Object.fromEntries(tsv(`${RIG}/logs/mut-ts-cand.log`).map((r) => [r[0], r[1]]));
  const candJ = Object.fromEntries(tsv(`${RIG}/results/mut-java.tsv`).slice(-12).map((r) => [r[0], r[1]]));
  const rule = (id) => id.replace(/^[TJ]\d+-/, '');
  const ids = [...new Set([...tsRows.map((r) => rule(r[0])), ...jRows.map((r) => rule(r[0]))])];
  const look = (rows, c) => rows.find((r) => rule(r[0]) === c);
  const cell = (r, candMap) => {
    if (!r) return '<td class="dim">–</td><td class="dim">–</td>';
    let n = (r[2] || '').replace('corpusRowsChanged=', '');
    const eq = n === '0';
    if (!/^\d+$/.test(n)) n = 'n/a';
    if (r[1] === 'KILLED' && n === '0') n = '0 rows · clause only';
    const st = r[1] === 'KILLED' ? '<span class="ok">killed</span>' : eq ? '<span class="dim">equivalent</span>' : '<span class="bad">survives</span>';
    const cd = r[1] === 'KILLED' || eq ? '<span class="dim">–</span>' : candMap[r[0]] === 'KILLED' ? '<span class="ok">killed</span>' : '<span class="warn">survives</span>';
    return `<td class="mono">${st} <span class="dim">(${esc(/rows/.test(n) || n === 'n/a' ? n : n + ' rows')})</span></td><td class="mono">${cd}</td>`;
  };
  const M = ids.map((c) => `<tr><td class="mono">${esc(c)}</td>${cell(look(tsRows, c), candTs)}${cell(look(jRows, c), candJ)}</tr>`).join('');
  const k = (rows) => rows.filter((r) => r[1] === 'KILLED').length;
  const eqn = (rows) => rows.filter((r) => r[1] !== 'KILLED' && (r[2] || '').endsWith('=0')).length;
  const bmp = tsv(`${RIG}/diff/bmp-head-summary.tsv`).filter((r) => r[1]?.startsWith('rows='));
  const bmpRows = bmp.reduce((s, r) => s + Number(r[1].split('=')[1]), 0), bmpDiff = bmp.reduce((s, r) => s + Number(r[5].split('=')[1]), 0);
  const D = [['head 9a709b3b', '634,486', '<span class="ok">0</span>', '150 · all in pre-existing shared helpers'],
    ['h1 9367b0ba (before the fix commit)', '634,486', '<span class="bad">2,263</span> · Java accepts goal of 1,366+ lone surrogates', '–'],
    ['head, full code points (26 string fields)', bmpRows.toLocaleString('en-US'), `<span class="ok">${bmpDiff}</span>`, '–'],
    ['head, edge: goal of 4,097 B + U+0001', '1', '0', '<span class="warn">1</span> · TS "exceeds 4096 UTF-8 bytes", Java "must not contain control characters"'],
    ['candidate boundedText order', '634,486 + edge', '<span class="ok">0</span>', '<span class="ok">150 (edge split gone)</span>']]
    .map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'mono' : ''}">${c}</td>`).join('')}</tr>`).join('');
  return page('PR #13536 · TS ↔ Java parity and what the shared fixture pins',
    'differential = every fixture case/pair × every path × value pool (cron, timezone, slot and occurrenceKey grammars, raw numeric spellings) + 20k random crons + 4.4k slot dates, fed to TS parseManagedSessionRecordJson + MANAGED_EXTENSION_RECORD_BODIES and Java ManagedExtensionRecordStore.parse + RECORD_BODIES · mutants = one anchored edit each, PR suites rerun, then the whole corpus re-evaluated to tell equivalent mutants from real gaps',
    `<div class="cols"><div><h2 style="margin-top:0">Differential (verdicts and refusal clauses)</h2><table><tr><th>arm</th><th>rows</th><th>verdict disagreements</th><th>clause disagreements (refused both)</th></tr>${D}</table>
     <h2>Suites</h2><table><tr><th>run</th><th>result</th></tr>
     <tr><td>TS automation + projection + extension + child-agent authority, head</td><td class="mono ok">330/330</td></tr>
     <tr><td>Java automation + projection + record store, head</td><td class="mono ok">37/37</td></tr>
     <tr><td>with candidate (15 witness cases + 1 clause case + promptRef tests)</td><td class="mono ok">TS 347/347 (5 files) · Java 38/38</td></tr>
     <tr><td>CI on 9a709b3b</td><td class="mono ok">all finished lanes green</td></tr></table></div>
     <div><h2 style="margin-top:0">Mutants: TS ${k(tsRows)}/${tsRows.length} killed (${eqn(tsRows)} equivalent) · Java ${k(jRows)}/${jRows.length} killed (${eqn(jRows)} equivalent)</h2><table><tr><th>rule removed or loosened</th><th>TS · head suites</th><th>TS · candidate</th><th>Java · head suites</th><th>Java · candidate</th></tr>${M}</table></div></div>`,
    'Verdict parity holds everywhere I could push it. What the fixture does not pin: Schedule\'s physical-identity guards (effectId 4,166 rows, dispatchId 4,162, session delivery 21), run scheduleId immutability (1,005), day-of-month/month/day-of-week bounds, equal-ended ranges, the 3-segment timezone cap, manual:&lt;empty&gt;, a Schedule run moving backwards, and on Java only the slot round-trip (Instant.parse already refuses Feb 30, so slot-invalid-date never reaches it). 15 shared cases kill all 12 Java and 11 of 12 TS survivors; the remaining TS one narrows zero-padded atoms and is left unpinned on purpose.');
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1900, height: 1200 } });
const pg = await ctx.newPage();
for (const [name, fn] of [['01-store-gate-and-lifecycle', card1], ['02-promptref-scope', card2], ['03-parity-and-witnesses', card3]]) {
  const file = `${FIG}/${name}.html`;
  writeFileSync(file, fn());
  await pg.goto(`file://${file}`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: `${FIG}/${name}.png` });
  console.log(`${name}.png clipped=${clipped}`);
}
await browser.close();
