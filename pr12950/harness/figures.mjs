// Evidence figures for PR #12950. Every number is read from the run artifacts
// in out/, run/ and ../logs; titles and notes are the only hand-written text.
// usage: node figures.mjs [card ids]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const RIG = path.dirname(new URL(import.meta.url).pathname);
const SP = path.dirname(RIG);
const OUT = path.join(SP, 'figures');
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(SP, 'wt-pr', 'package.json'));
const { chromium } = require('playwright');
const HEAD = 'e6aa30b141';
const BASE = 'a765229c0a';

const J = (f) => JSON.parse(fs.readFileSync(path.join(RIG, 'out', f), 'utf8'));
const T = (f) => fs.readFileSync(f, 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const css = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d1117; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }
  #card { width: 1600px; padding: 28px 32px 30px; background: #0d1117; color: #e6edf3; box-sizing: border-box; }
  h1 { font-size: 25px; margin: 0 0 4px; font-weight: 650; letter-spacing: -0.2px; }
  .sub { color: #8b949e; font-size: 15px; margin-bottom: 16px; line-height: 1.45; }
  h2 { font-size: 16px; color: #79c0ff; margin: 20px 0 8px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; font: 13.5px/1.45 ui-monospace, Menlo, monospace; }
  th { text-align: left; color: #8b949e; font-weight: 500; border-bottom: 1px solid #30363d; padding: 5px 10px 5px 0; }
  td { padding: 4px 10px 4px 0; border-bottom: 1px solid #21262d; vertical-align: top; overflow-wrap: anywhere; }
  .ok { color: #3fb950; } .bad { color: #f85149; } .warn { color: #d29922; } .dim { color: #8b949e; } .hl { color: #79c0ff; }
  .note { border-left: 3px solid #1f6feb; padding: 6px 0 6px 12px; margin-top: 16px; color: #c9d1d9; font-size: 15px; line-height: 1.5; }
  .note.warn { border-left-color: #d29922; }
  .foot { color: #6e7681; font-size: 12.5px; margin-top: 16px; font-family: ui-monospace, Menlo, monospace; }
  pre { margin: 0; font: 13.5px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px 14px; }
`;
const page = (title, sub, body) =>
  `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${esc(`PR #12950 head ${HEAD} vs base ${BASE} (main) · macOS 26 arm64 · Node 22.23.2 · JDK 21 · MySQL 8.4.7 · Spring server jar + embedded Runtime Broker + bundled workers · packaged Hosted Harness (dist/cli.js)`)}</div></div>`;
const table = (head, rows, widths) =>
  `<table><colgroup>${widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;

const SHAPE = {
  MISSING: '(absent)', NULL: 'null', EMPTY: '""', BLANK: '"&nbsp;&nbsp;&nbsp;"', NUMBER: '123',
  ABS_IN_WS_READ: '"&lt;ws&gt;/proof.txt"', ABS_IN_WS_WRITE: '"&lt;ws&gt;/abs-write.txt"', ABS_IN_WS_EDIT: '"&lt;ws&gt;/proof.txt"',
  ABS_OUTSIDE_WRITE: '"&lt;rig&gt;/outside-sentinel/escaped.txt"', ABS_PADDED: '" &lt;ws&gt;/proof.txt "', DOTDOT: '"../escape.txt"',
  BACKSLASH: '"a\\\\b.txt"', DRIVE: '"C:/secret-host-path"', NUL: '"a\\u0000b.txt"', SURROGATE: '"\\ud800.txt"',
  SHELL_SIBLING_FIRST: '[shell, write "&lt;ws&gt;/mixed.txt"]', SHELL_SIBLING_LAST: '[read "&lt;ws&gt;/proof.txt", shell]',
};

const cards = {};

cards['01-shapes-ab'] = () => {
  const pr = J('s1-shapes-pr.json');
  const base = J('s1-shapes-base.json');
  const baseErr = T(path.join(RIG, 'run', 'harness-s1-base.log')).match(/Hosted Harness turn \S+ failed: .*/g) ?? [];
  const rows = pr.results.map((r) => {
    const b = base.results.find((x) => x.key === r.key);
    const bErr = baseErr[base.results.indexOf(b)] ?? '';
    const bMsg = /cwdRelative/.test(bErr) ? 'cwdRelative is not a valid…' : /relative file_path/.test(bErr) ? 'require a relative file_path' : '?';
    const ids = (r.modelRound2Ids ?? []).map((id) => id.replace(`${r.key.toLowerCase()}-`, '')).join(', ');
    const brokerBefore = r.brokerBeforeCorrection.map((l) => l.replace(/ -> 200$/, '')).join(' ');
    const prOk = r.terminal === 'turn_complete' && !r.recoveryBlocked && !r.siblingFileAtEnd && !r.echoesPath && r.correctedFile;
    return [
      esc(r.key),
      esc(r.tool),
      SHAPE[r.key] ?? '?',
      `<span class="bad">${esc(b.terminal)}</span> <span class="dim">records=${b.persistedCalls.length}+${b.persistedResults.length} · ${esc(bMsg)}</span>`,
      `<span class="${prOk ? 'ok' : 'bad'}">${esc(r.terminal)}</span> <span class="dim">model got [${esc(ids)}] · before fix: ${esc(brokerBefore)} · sibling ran=${r.siblingFileAtEnd} · echo=${r.echoesPath} · corrected write=${r.correctedFile ? 'once' : 'no'}</span>`,
    ];
  });
  const s = pr.sentinels;
  const allOk = pr.results.every((r) => r.terminal === 'turn_complete' && !r.siblingFileAtEnd && !r.echoesPath);
  const baseAllErr = base.results.every((r) => r.terminal === 'turn_error' && r.persistedCalls.length === 0);
  return page(
    'Every invalid file_path shape, each batched with a valid sibling: base ends the turn, PR refuses durably and the model corrects',
    `One Session per case, fixture model: round 1 = [invalid call, valid sibling write/Shell], round 2 = corrected relative write, round 3 = text. Same script against the base and PR Harness bundles, same Spring/Broker/worker/MySQL. &lt;ws&gt; = the Session's real Workspace directory.`,
    table(['case', 'tool', 'file_path', `base ${BASE}`, `PR ${HEAD}`], rows, ['190px', '105px', '265px', '395px', '595px']) +
      `<h2>Side effects (checked on disk after all ${pr.results.length} cases)</h2><pre>` +
      esc(`absolute write inside Workspace created: ${s.absWrite}   write outside Workspace created: ${s.outsideWrite}   ../escape.txt created: ${s.dotdot}   proof.txt unchanged: ${s.proof === 'PROOF_IN_WORKSPACE'}`) +
      `</pre><div class="note">${allOk ? '<span class="ok">PR: 17/17</span>' : '<span class="bad">PR: not all</span>'} turns complete with ordered, ID-matched errors for both calls; the only Broker call before the correction is the parallel <code>runtimes:warm</code> (no acquire/prepare/start), the sibling never ran, and the corrected relative write landed exactly once. ${baseAllErr ? '<span class="bad">Base: 17/17</span>' : 'Base: not all'} end in <code>turn_error</code> with nothing persisted and no second model request.</div>`,
  );
};

cards['02-durability'] = () => {
  const s3 = J('s3-commit-fault-pr.json');
  const cold = T(path.join(RIG, 'out', 's3b-cold-pr.log')).trim().split('\n');
  const s3rows = s3.map((r, i) => [
    esc(r.fault),
    `hits=${r.injectedHits}`,
    `<span class="${r.recoveryBlocked ? 'ok' : 'bad'}">blocked=${r.recoveryBlocked}</span> <span class="dim">next prompt ${esc(r.samePromptAgain.replace(/^409 .*hosted_turn_recovery_required.*$/, '409 hosted_turn_recovery_required'))}</span>`,
    esc((cold[i] ?? '').replace(/^\[[A-Z_0-9]+:cold\] /, '').replace(/ blocked=undefined prompt=n\/a/, '').replace(/\{"error":"(\w+)".*\}/, '$1')),
    esc(r.otherSessionSameWorkspace.replace(/admit=202 terminal=/, '').replace(/ recoveryBlocked=\w+ \d+ms/, '') + (r.harnessLog.some((l) => l.includes('workspace_busy')) && /turn_error/.test(r.otherSessionSameWorkspace) ? ' (409 workspace_busy)' : '')),
    r.leaseRowsHeld === '<no row>' || r.leaseRowsHeld === '<none>' ? '<span class="ok">free</span>' : '<span class="warn">held by blocked turn</span>',
  ]);
  const s4pr = J('s4-rounds-pr.json');
  const s4base = J('s4-rounds-base.json');
  const s4v = J('s4-rounds-pr-LOOP16V.json');
  const brief = (x) => `${x.turn.replace(/admit=202 terminal=/, '').replace(/ \d+ms$/, '').replace('recoveryBlocked', 'blocked')} · model requests=${x.modelRequests} · persisted pairs=${x.persistedCalls}/${x.persistedResults} · holder after=${x.holderAfterTurn} · reload history paired=${/paired=true/.test(x.historyAfterReload ?? '')}`;
  const why = (x) => (x.harnessErr ?? '').replace(/^qwen serve: Hosted Harness turn \S+ failed: /, '').slice(0, 70);
  const s4rows = [
    ['model never corrects, varied paths', '—', `<span class="ok">${esc(brief(s4v.LOOP16V))}</span><br><span class="dim">${esc(why(s4v.LOOP16V))}</span>`],
    ['model never corrects, identical call', `<span class="dim">${esc(brief(s4base.LOOP16))}</span>`, `${esc(brief(s4pr.LOOP16))}<br><span class="warn">${esc(why(s4pr.LOOP16))}</span> <span class="dim">(core loop detector: 5 identical calls)</span>`],
    ['refused once, model answers in text', `<span class="dim">${esc(brief(s4base.REFUSE_THEN_TEXT))}</span>`, `<span class="ok">${esc(brief(s4pr.REFUSE_THEN_TEXT))}</span>`],
    ['valid write (acquires) → invalid batch → text', `<span class="dim">${esc(brief(s4base.ACQUIRE_REFUSE))}</span>`, `<span class="ok">${esc(brief(s4pr.ACQUIRE_REFUSE))}</span><br><span class="dim">Broker: ${esc(s4pr.ACQUIRE_REFUSE.brokerCalls.join(' '))}</span>`],
  ];
  const itPr = T(path.join(SP, 'logs', 'it-it-pr.log'));
  const itBase = T(path.join(SP, 'logs', 'it-it-base.log'));
  const itLine = (t) => (t.match(/Tests run: 1, Failures: \d, Errors: \d, Skipped: \d, Time elapsed: [\d.]+ s/) ?? ['?'])[0];
  const baseAssert = itBase.match(/driver\.ts:(\d+):\d+\)\s*\n[^\n]*\n?[^\n]*driver\.ts:(\d+):\d+\) \{[\s\S]*?actual: '(\w+)',\s*expected: '(\w+)'/);
  const u = (f) => J(`unit/${f}`);
  const up = u('pr.json');
  const ub = u('base-with-pr-tests.json');
  const mut = J('mut/mutants.json').filter((m) => m.verdict !== 'BASELINE OK');
  const killed = mut.filter((m) => m.verdict === 'KILLED').length;
  const survivors = mut.filter((m) => m.verdict === 'SURVIVED').map((m) => m.name);
  const gates = [
    ['HostedWorkspaceToolTurnIT (six Workspaces) on local MySQL', `<span class="ok">${esc(itLine(itPr))}</span> <span class="dim">HOSTED_WORKSPACE_TOOLS_OK</span>`, `<span class="bad">${esc(itLine(itBase))}</span> <span class="dim">driver.ts:${baseAssert?.[2]} prompt('INVALID_FILE_PATH') → ${baseAssert?.[3]}, expected ${baseAssert?.[4]} (assert in prompt() at :${baseAssert?.[1]})</span>`],
    ['hosted-workspace-tool-turn.test.ts (PR version)', `<span class="ok">${up.numPassedTests}/${up.numTotalTests}</span>`, `<span class="bad">${ub.numPassedTests}/${ub.numTotalTests}</span> <span class="dim">(on base source: the ${ub.numFailedTests} new behaviour tests fail; the normalized-path test passes on both)</span>`],
    ['mutants of the 27 production lines', `<span class="ok">${killed}/${mut.length} killed</span>`, `<span class="dim">survivor: ${esc(survivors.join('; '))} — equivalent: the validator only throws InvalidWorkspaceRelativePathError</span>`],
  ];
  return page(
    'Refusal commits keep the recovery contract; bounds and gates hold',
    'A Store proxy between the Harness and Spring failed (503) or dropped the reply of exactly the commit that carries the refusal. Cold load = a brand-new Harness process after the 60 s writer lease expired.',
    `<h2>Failed or uncertain refusal commit</h2>` +
      table(['fault on the refusal batch', 'injected', 'same Session', 'cold load, new Harness', 'other Session, same Workspace', 'Workspace lease'], s3rows, ['250px', '80px', '370px', '330px', '240px', '250px']) +
      `<h2>Paths the PR's driver does not walk</h2>` +
      table(['scenario', `base ${BASE}`, `PR ${HEAD}`], s4rows, ['260px', '560px', '700px']) +
      `<h2>The PR's own gates, A/B against the base bundle / source</h2>` +
      table(['gate', `PR ${HEAD}`, 'base'], gates, ['360px', '420px', '740px']) +
      `<div class="note">A failed or uncertain refusal commit is durably recovery-blocked (also after a cold load). Before any acquisition the Workspace stays usable for other Sessions; after an earlier acquisition in the same turn the lease stays with the blocked turn — the behaviour the PR pins in its unit test and that #12904 (Workspace lease recovery) is meant to address.</div>`,
  );
};

cards['03-real-model'] = () => {
  const load = (f) => (fs.existsSync(path.join(RIG, 'out', f)) ? J(f) : []);
  const rigError = (r) => /Connection error/.test(r.harnessErr ?? '');
  const pr = [...load('s5-real-pr-r1.json'), ...load('s5-real-pr-abs2.json'), ...load('s5-real-pr-r2-outside.json'), ...load('s5-real-pr-r3-outside.json')].filter((r) => !rigError(r));
  const excluded = [...load('s5-real-pr-r3-outside.json')].filter(rigError).length;
  const base = load('s5-real-base-r1.json');
  const cand = load('s5-real-cand-hint.json');
  const ok = (r) => /turn_complete/.test(r.turn) && !/recoveryBlocked=true/.test(r.turn);
  const untilRead = (r) => { const i = r.trace.findIndex((t) => /result read_file status=success .*demo-service/.test(t)); return i < 0 ? null : r.trace.slice(0, i).filter((t) => t.startsWith('call')).length; };
  const absCalls = (r) => r.trace.filter((t) => t.startsWith('call') && /file_path\":\"\//.test(t)).length;
  const median = (a) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const cell = (rows, scen, extra) => {
    const r = rows.filter((x) => x.scen === scen);
    if (!r.length) return '<span class="dim">not run</span>';
    const n = r.filter(ok).length;
    const errs = [...new Set(r.filter((x) => !ok(x)).map((x) => (x.harnessErr ?? '').replace(/^qwen serve: Hosted Harness turn \S+ failed: /, '').replace(/InvalidWorkspaceRelativePathError: /, '').replace(/^Error: /, '').slice(0, 64)))];
    return `<span class="${n === r.length ? 'ok' : n === 0 ? 'bad' : 'warn'}">${n}/${r.length} complete</span>${errs.length ? ` <span class="dim">turn_error: ${esc(errs.join('; '))}</span>` : ''}${extra ? `<br><span class="dim">${extra(r)}</span>` : ''}`;
  };
  const absExtra = (r) => r.some(ok) ? `calls until config.json was read: ${r.map(untilRead).join(', ')} (median ${median(r.map(untilRead))}) · summary.txt written ${r.filter((x) => x.summary).length}/${r.length}` : 'nothing persisted, model never saw an error';
  const outExtra = (r) => `wrote outside the Workspace: ${r.filter((x) => x.outsideWritten).length} · Session blocked: ${r.filter((x) => /recoveryBlocked=true/.test(x.turn)).length}`;
  const pwdExtra = (r) => `absolute file_path calls: ${r.reduce((a, x) => a + absCalls(x), 0)} (model used relative paths)`;
  const follow = (rows) => { const r = rows.filter((x) => x.nextPrompt); const bad = (xs) => xs.filter((x) => !/turn_complete/.test(x.nextPrompt)).length; const afterFail = r.filter((x) => !ok(x)); const afterOk = r.filter(ok); return `<span class="${bad(r) ? 'bad' : 'ok'}">${bad(afterFail)}/${afterFail.length} failed after a failed turn · ${bad(afterOk)}/${afterOk.length} after a completed turn</span>`; };
  const rows = [
    ['files profile: "Read &lt;ws&gt;/config.json and write a one-line summary to &lt;ws&gt;/summary.txt."', cell(base, 'ABS_GIVEN', absExtra), cell(pr, 'ABS_GIVEN', absExtra), cell(cand, 'ABS_GIVEN', absExtra)],
    ['files profile: "Save the text … to &lt;rig&gt;/outside-sentinel/hello.txt." (outside the Workspace)', cell(base, 'OUTSIDE_TMP', outExtra), cell(pr, 'OUTSIDE_TMP', outExtra), '<span class="dim">not run</span>'],
    ['Shell profile: "Run pwd …, then use write_file to create notes.md in that directory …"', cell(base, 'PWD_THEN_WRITE', pwdExtra), cell(pr, 'PWD_THEN_WRITE', pwdExtra), '<span class="dim">not run</span>'],
    ['follow-up "Reply with the single word READY." in the same Session', `${follow(base)}<br><span class="dim">the unanswered prompt stays in tool-profile history, so the model retries the absolute path</span>`, follow(pr), follow(cand)],
  ];
  const t2 = pr.filter((x) => x.scen === 'ABS_GIVEN')[1];
  const trace = (t2?.trace ?? []).slice(0, 12).map((l) => esc(l.replace(/\/private\/tmp\/claude-501\/[^"\\ ]*?\/rig\/roots\/[a-z]\/child/g, '<ws>').replace(/\/private\/tmp\/claude-501\/[^"\\ ]*?scratchpad/g, '<rig>').replace(/\/private\/tmp\/claude-501\/[^"\\ )]*/g, '<ws>/config.json (absolute, truncated)').replace(/ id=call_[0-9a-f]+/, '')).replace(/(Hosted file tools require[^"]*|This tool was not executed[^"]*)/, '<span class="warn">$1</span>').replace(/status=success/, '<span class="ok">status=success</span>')).join('\n');
  return page(
    'Real model (qwen3.8-max): absolute paths no longer end the turn; the model recovers, but has to guess what "relative" means',
    `Packaged Harness with a real provider, one new Session per trial, same Spring/Broker/worker/MySQL. "candidate" = PR + one clause in the refusal text: <code>a file directly in that directory is just its name, for example "notes.txt"</code>.${excluded ? ` ${excluded} trial lost to a rig error (my recording proxy refused the connection) is excluded.` : ''}`,
    table(['prompt', `base ${BASE}`, `PR ${HEAD}`, 'candidate hint (PR + 1 clause)'], rows, ['330px', '370px', '470px', '366px']) +
      `<h2>PR trial ${t2?.trial ?? ''} of the first prompt (first 12 transcript entries, from the durable transcript)</h2><pre>${trace}</pre>` +
      `<div class="note">On the PR all absolute-path read/write turns completed; 14 of 15 outside-path turns completed (the other hit the pre-existing "profile refused a tool call" throw, not the path check); every follow-up prompt worked and nothing was written outside the Workspace. The refusal says "relative to the saved Session working directory" but the model does not know which prefix that is, so it walks down the absolute path (rig/roots/…, roots/…, child/…) before trying config.json. Successful write results still echo the native absolute path (the follow-up the design doc keeps open), which is where later absolute paths come from.</div>`,
  );
};

const want = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1680, height: 1200 } });
const pg = await ctx.newPage();
for (const [id, make] of Object.entries(cards)) {
  if (want.length && !want.includes(id)) continue;
  const html = make();
  const file = path.join(OUT, `${id}.html`);
  fs.writeFileSync(file, html);
  await pg.goto(`file://${file}`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre, td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: path.join(OUT, `${id}.png`) });
  console.log(id, 'clipped elements:', clipped);
}
await browser.close();
