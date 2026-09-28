// Round-5 evidence figures for PR #12868. Everything shown is read from the
// run logs in out/ and from git; titles and notes are the only hand-written text.
// usage: node figures-r5.mjs [card ids]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const RIG = path.dirname(new URL(import.meta.url).pathname);
const SP = path.dirname(RIG);
const OUT = path.join(SP, 'figures');
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(SP, 'wt-h6', 'package.json'));
const { chromium } = require('playwright');
const HEAD = '42a059af96';
const PREV = 'cc06ee0e4e';
const MID = 'fe7895d330';

const log = (name) => fs.readFileSync(path.join(RIG, 'out', name), 'utf8').split('\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tidy = (s) => s.replace(/\/private\/tmp\/rig\/[^ "]*?\/rig\/roots[-a-z0-9]*/g, '<roots>').replace(/\/private\/tmp\/rig\/[^ "]*?\/scratchpad/g, '<rig>').replace(/\/private\/tmp\/rig\/[^ "]*/g, '<rig>/…');
const strip = (s) => s
  .replace(/refused status=(\d+|-) code=(\w+) (?:BrokerResponseError|ManagedToolProtocolError|ManagedRuntimeProviderError): (?:Managed Runtime Broker returned HTTP \d+\. ?)?/g, 'refused $1 $2: ')
  .replace(/refused - /g, 'refused by the client: ')
  .replace(/ \[directory,error,exitCode,notices,outcome,output,outputFiles,pid,signal,text,truncated,type,version\]/g, '')
  .replace(/(refused 409 runtime_session_busy): Managed Runtime Broker r(?= \||$)/g, '$1')
  .replace(/\s+$/g, '');

const css = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d1117; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }
  #card { width: 1560px; padding: 28px 32px 30px; background: #0d1117; color: #e6edf3; box-sizing: border-box; }
  h1 { font-size: 25px; margin: 0 0 4px; font-weight: 650; letter-spacing: -0.2px; }
  .sub { color: #8b949e; font-size: 15px; margin-bottom: 18px; line-height: 1.45; }
  h2 { font-size: 16px; color: #79c0ff; margin: 20px 0 8px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; font: 13.5px/1.45 ui-monospace, Menlo, monospace; }
  th { text-align: left; color: #8b949e; font-weight: 500; border-bottom: 1px solid #30363d; padding: 5px 10px 5px 0; }
  td { padding: 4px 10px 4px 0; border-bottom: 1px solid #21262d; vertical-align: top; overflow-wrap: break-word; }
  td.t { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; font-size: 14.5px; color: #e6edf3; }
  pre { margin: 0; font: 13.5px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px 14px; }
  .ok { color: #3fb950; } .bad { color: #f85149; } .warn { color: #d29922; } .dim { color: #8b949e; } .hl { color: #79c0ff; }
  .add { color: #3fb950; } .del { color: #f85149; }
  .note { border-left: 3px solid #1f6feb; padding: 6px 0 6px 12px; margin-top: 16px; color: #c9d1d9; font-size: 15px; line-height: 1.5; }
  .note.warn { border-left-color: #d29922; } .note.bad { border-left-color: #f85149; }
  .foot { color: #6e7681; font-size: 12.5px; margin-top: 16px; font-family: ui-monospace, Menlo, monospace; }
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${esc(`PR #12868 round 5 · head ${HEAD} = ${PREV} + five commits + merge of main · macOS 26 arm64 · Node 22.23.2 · JDK 21.0.12 · MySQL 8.4.7 · Spring server jar + embedded Runtime Broker + bundled workers`)}</div></div>`;
const paint = (l) => esc(strip(tidy(l)))
  .replace(/^\[PASS\]/, '<span class="ok">[PASS]</span>').replace(/^\[FAIL\]/, '<span class="bad">[FAIL]</span>')
  .replace(/^(\[[UW]\d[a-z]?-v[12]\])/, '<span class="dim">$1</span>')
  .replace(/\(sent by the rig\)/g, '<span class="dim">(sent by the rig)</span>');
const mark = (html, rules) => rules.reduce((h, [re, cls]) => h.replace(re, `<span class="${cls}">$1</span>`), html);
const lines = (name, re) => log(name).filter((l) => re.test(l)).map(paint);
const facts = (name, tag) => log(name).filter((l) => l.startsWith(`[${tag}]`)).map((l) => esc(l).replace(/^\[(\w+)\]/, '<span class="dim">[$1]</span>'));

const cards = {};

cards['r5-01-head'] = () => {
  const commits = facts('head-facts.log', 'commit').join('\n');
  const merge = facts('head-facts.log', 'merge').join('\n');
  const kinds = facts('head-facts.log', 'kind').join('\n');
  const files = facts('head-facts.log', 'file').join('\n');
  const main = facts('head-facts.log', 'main').map((l) => l.replace(/(no conflict)/, '<span class="ok">$1</span>')).join('\n');
  const ci = facts('ci.log', 'ci').map((l) => l.replace(/(failed: .*$)/, '<span class="warn">$1</span>').replace(/(\d+ pass)/, '<span class="ok">$1</span>').replace(/(\] pass)/, '] <span class="ok">pass</span>')).join('\n');
  const body = `<h2>Commits since round 4</h2><pre>${commits}</pre>
  <h2>The merge commit: git show --remerge-diff</h2><pre>${merge}</pre>
  <h2>The five fix commits by kind (git diff ${PREV} 17a8360a9f), and their production files</h2><pre>${kinds}\n${files}</pre>
  <h2>CI and main</h2><pre>${ci}\n${main}</pre>
  <div class="note">The head moved three times while this round ran (803761aabd, ${MID}, ${HEAD}). Every result below is from ${HEAD} unless a line names another build, and every jar was packaged from a clean target. The merge has four conflicted files and nothing edited beyond them; they are the four files the earlier rounds named for #12848.</div>`;
  return page('What the head contains', `Head ${HEAD}: fitted results, the envelope id gate and its correction, terminal receipts without a READY Session, a definite refusal for unconfirmed cancellations, 24 review suggestions, and main with #12848.`, body);
};

cards['r5-02-large-results'] = () => {
  const pick = (name) => log(name).filter((l) => /^\[W1-v2\] \S/.test(l) || /^\[W1-v2\] {20,}record/.test(l)).map((l) => l.replace(/ \| GET .*$/, (m) => m)).map(paint);
  const red = [[/(worker execute -&gt; 400 managed_runtime_provider_invalid &quot;[^&]*&quot;)/, 'bad'], [/(record UNKNOWN\/-)/, 'bad'], [/(release refused 409 runtime_session_busy)/, 'bad'], [/(storage held=true)/, 'bad']];
  const green = [[/(worker execute -&gt; 200 \d+ KiB)/, 'ok'], [/(record SETTLED\/success)/, 'ok'], [/(release ok)/, 'ok'], [/(truncated=true, notice=true)/, 'hl']];
  const prev = pick('s16-r5-r4-W1.log').map((l) => mark(l, red).replace(/caller: refused 409 runtime_broker_execution_unknown: Runtime execution outcome is unknown\./, 'caller: 409 runtime_broker_execution_unknown')).join('\n');
  const now = pick('s16-r5-h6-W1.log').map((l) => mark(l, green)).join('\n');
  const w2 = lines('s16-r5-h6-W2W4W6.log', /^\[W2-v2\] |^\[(PASS|FAIL)\] W2-v2/).join('\n');
  const body = `<h2>${PREV} (round 4) · boot v2</h2><pre>${prev}</pre>
  <h2>This head ${HEAD} · boot v2</h2><pre>${now}</pre>
  <h2>This head · status and cancel of a large result, and heavy progress, at the worker</h2><pre>${w2}</pre>
  <div class="note">On the previous head six of seven large results were refused by the worker after the tool had run: the record became UNKNOWN, the Session could not be released and the Workspace storage stayed held, while the edit was already on disk. On this head all seven settle, the record holds the fitted result in MySQL (LONGTEXT, up to 1,024 KiB), GET answers, and the Session releases. status and cancel of a large result are fitted the same way, and evicted progress is announced through firstAvailableSeq and progressGap.</div>`;
  return page('Large tool results are fitted, not refused', 'Seven tool calls with large results through the provider, the Broker on MySQL 8.4.7 and a real worker. Same probe on two builds.', body);
};

cards['r5-03-cut-anatomy'] = () => {
  const all = log('s16-r5-h6-W1d.log').filter((l) => /^\[W1d-v2\]/.test(l)).map((l) => l.replace(/^\[W1d-v2\] /, ''));
  const shown = all.filter((l) => !/llmContent|^\s+at the caller: \d+ chars, \d+ KiB, not cut|display\.output/.test(l) || /: caller/.test(l));
  const html = shown.map((l) => esc(l))
    .map((l) => l.replace(/(lone surrogates [1-9]\d*)/, '<span class="warn">$1</span>').replace(/(&quot;\?&quot; [1-9]\d*)/, '<span class="warn">$1</span>').replace(/(\[[0-9a-f ]*\b3f\b[0-9a-f ]*\])/g, '<span class="warn">$1</span>').replace(/(cut: 250065 characters omitted, kept 97)/, '<span class="warn">$1</span>')).join('\n');
  const edit = log('s16-r5-h6-W1.log').filter((l) => /edit of a 700 KiB file/.test(l)).map(paint).map((l) => mark(l, [[/(llmContent 74 chars, display 74 chars \[string\])/, 'warn']])).join('\n');
  const body = `<h2>Field display.text of four shell results, at the worker and at the caller</h2><pre>${html}</pre>
  <h2>A result whose bulk is not text the fit can cut</h2><pre>${edit}</pre>
  <div class="note warn">Three observations on how the cut is made. None of them loses a result, and none blocks. <b>1.</b> The cut can land inside a surrogate pair: the worker then sends one or two lone surrogates, and the Broker path turns each into "?" (3f). <b>2.</b> The cut removes as many <i>characters</i> as there are excess <i>bytes</i>. For text of three bytes per character that is three times too much: the CJK field keeps 97 of 250,163 characters where about 95,000 would have fitted. <b>3.</b> A file tool's display is an object (diff, old and new content) that has no text the fit can cut. The whole result is then replaced by the stub, including the short llmContent that would have fitted.</div>`;
  return page('Where the cut lands', 'display.output is never cut in these cases; display.text holds the same output and is the largest field, so the fit cuts it.', body);
};

cards['r5-04-id-gate'] = () => {
  const pick = (name, more) => [...log(name), ...(more ? log(more).filter((l) => l.includes('with an emoji')) : [])].map((l) => l.match(/^\[W3-v2\] (.+?)\s+raw\s+(Broker Session.*)$/)).filter(Boolean).map((m) => `[W3-v2] ${m[1].padEnd(24)} ${m[2]}`).map((l) => l.replace(/ \| acquired \| work: worker 200, record SETTLED\/success/, ' | raw work SETTLED/success').replace(/release 400 managed_runtime_provider_invalid "Managed Runtime provider Session identity must be (a lowercase UUID|printable and path-safe)\."/, 'release 400 "…must be $1."').replace(/Broker Session none \| 400 runtime_broker_invalid_request "Runtime Broker request is invalid\."/, 'acquire 400 runtime_broker_invalid_request').replace(/ \| release 404 runtime_(session_not_found "Runtime Session was not found"|broker_route_not_found "Runtime Broker route was not found\.") \| Session now none \| storage held=false$/, ' | nothing acquired, nothing held')).map(paint);
  const red = [[/(release 400 &quot;…must be [^&]*&quot;)/, 'bad'], [/(Session now RELEASING)/, 'bad'], [/(storage held=true)/, 'bad'], [/(release 404 runtime_broker_route_not_found &quot;[^&]*&quot;)/, 'warn'], [/(Session now READY)/, 'warn']];
  const green = [[/(release 200)/, 'ok'], [/(Session now RELEASED)/, 'ok'], [/(storage held=false)/, 'ok'], [/(acquire 400 runtime_broker_invalid_request)/, 'hl'], [/(nothing acquired, nothing held)/, 'ok']];
  const both = (l) => mark(mark(l, red), green);
  const gates = log('fault-gates-id-ab.log').filter(Boolean).map((l) => esc(l).replace(/^\[([^\]]+)\]/, '<span class="dim">[$1]</span>').replace(/(Failures: [1-9]\d*)/, '<span class="bad">$1</span>').replace(/(Failures: 0)/, '<span class="ok">$1</span>').replace(/(400 managed_runtime_provider_invalid .*$)/, '<span class="bad">$1</span>')).join('\n');
  const body = `<h2>${PREV} (round 4) · boot v2 · raw route · eleven spellings of the Runtime Session id</h2><pre>${pick('s16-r5-r4-W3.log', 's16-r5-r4-W3-emoji.log').map(both).join('\n')}</pre>
  <h2>${MID} · ids must be lowercase UUIDs</h2><pre>${pick('s16-r5-pr-W3.log').map(both).join('\n')}</pre>
  <h2>This head ${HEAD} · ids must be printable and path-safe</h2><pre>${pick('s16-r5-h6-W3.log', 's16-r5-h6-W3-emoji.log').map(both).join('\n')}</pre>
  <h2>This head plus the candidate: the Broker applies the same rule when it acquires</h2><pre>${pick('s16-r5-cand-W3.log', 's16-r5-cand-W3-emoji.log').map(both).join('\n')}</pre>
  <h2>The repository's fault gates: the two classes that release through a real worker</h2><pre>${gates}</pre>
  <div class="note warn">The correction at 17a8360a9f works: every printable, path-safe id releases again, and the fault gates pass, here and in CI. What is left is the gap between the two sides. The Broker admits any id up to 512 characters, and it releases every Runtime Session through the worker's envelope. An id with a backslash, two dots, a control character or an emoji can therefore still be acquired and can still run raw work, and then cannot be released: the Session stays RELEASING and, on boot v2, its Workspace storage stays held. At round 4 these ids released. The emoji is refused although it is printable: the rule tests UTF-16 code units, so it refuses a well-formed surrogate pair as well as a lone one. An id with a slash could never be released, on any head, because the Broker's release route cannot address it. No producer in the repository uses such ids. The candidate makes the Broker refuse at acquire what the worker would refuse at release.</div>`;
  return page('Session ids: the worker\'s rule and the Broker\'s door', 'The provider route never admitted ids that are not UUIDs (the client refuses them before any request), so only the raw route is shown. Same probe on four builds.', body);
};

cards['r5-05-receipts'] = () => {
  const w4 = (name) => lines(name, /^\[W4-v2\] (cancel #2|second release)/).join('\n');
  const w5 = (name) => log(name).filter((l) => /^\[W5-v2\] (after the restart|cancel #2)/.test(l)).map(paint).join('\n');
  const u2 = (name) => log(name).filter((l) => /^\[U2-v2\] cancel #2/.test(l)).map(paint).join('\n');
  const red = (h) => mark(h, [[/(cancel #2 while RELEASING: 409 runtime_session_not_ready)/, 'bad'], [/(cancel #2 404 runtime_session_not_found)/, 'bad'], [/(caller 503 runtime_execution_cancel_failed retryable=true)/, 'bad']]);
  const green = (h) => mark(h, [[/(cancel #2 while RELEASING: 200 cancelled)/, 'ok'], [/(cancel #2 200 cancelled)/, 'ok'], [/(caller 409 runtime_execution_cancel_unconfirmed retryable=false)/, 'hl']]);
  const body = `<h2>1 · Session RELEASING (the release acknowledgement was lost) · boot v2</h2><pre><span class="dim">${PREV} (round 4)</span>\n${red(w4('s16-r5-r4-W2W3W4.log'))}\n<span class="dim">this head</span>\n${green(w4('s16-r5-h6-W2W4W6.log'))}</pre>
  <h2>2 · Broker process stopped with SIGKILL and started again on the same database · boot v2</h2><pre><span class="dim">${PREV} (round 4)</span>\n${red(w5('s17-restart-r4-v2-KILL.log'))}\n<span class="dim">this head</span>\n${red(w5('s17-restart-h6-v2-KILL.log'))}\n<span class="dim">this head plus the candidate (one condition in RuntimeBrokerService.java)</span>\n${green(w5('s17-restart-cand-v2-KILL.log'))}</pre>
  <h2>3 · Session READY, the worker forgot the call (round 4, section 3) · boot v2</h2><pre><span class="dim">${PREV} (round 4)</span>\n${red(u2(path.join('..', '..', 'r4-archive', 'out', 's15-fix-pr-U1U1bU2U3.log')))}\n<span class="dim">this head</span>\n${green(u2('s15-fix-h6-U1U1bU2U3U4.log'))}</pre>
  <div class="note warn">Case 1 is fixed: a repeated cancellation is answered from the stored receipt while the Session is RELEASING. Case 3 is settled the other way round from the round-4 candidate: unknown never confirms, and the refusal is now a definite 409 that a caller will not retry. Case 2 is not covered yet, although the fix note names it. After the Broker process is replaced the stored Session is still READY, because nothing rewrites it, so the new rule "not READY" does not apply and the request is refused 404 as before, with SIGKILL and with SIGTERM, on boot v1 and boot v2. The regression test sets the Session to RELEASING before it restarts the service, which is case 1. The candidate also answers from the receipt when this Broker process holds no live Session for the id.</div>`;
  return page('Terminal cancellation receipts without a READY Session', 'A prepared provider call is cancelled (200). Then the cancellation is repeated in three situations.', body);
};

cards['r5-06-regression'] = () => {
  const sum = (name) => (log(name).find((l) => l.startsWith('[SUMMARY]')) ?? '').slice(10);
    const model = log('s6-hosted-real-model-h6-p.log').filter((l) => /^\[(T\d|sessions|executions|holders|status)\]/.test(l)).map((l) => esc(tidy(l)).replace(/(turn_complete\(end_turn\)|recoveryBlocked=false)/g, '<span class="ok">$1</span>'));
  const kept = log('s11-error-envelope-h6-PQRS.log').filter((l) => /code kept=/.test(l));
  const p = kept.filter((l) => /^\[P-/.test(l));
  const r = kept.filter((l) => /^\[R-/.test(l));
  const death = ['s13-merge-h6-M3p-v1.log', 's13-merge-h6-M3p-v2.log', 's13-merge-h6-M3r-v2.log'].map((n) => (log(n).find((l) => /binding LOST/.test(l)) ? 'LOST' : '?'));
  const suites = (tag) => {
    const dir = path.join(SP, 'logs', `suites-${tag}`);
    const text = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n') : []);
    const last = (f, re) => (text(f).filter((l) => re.test(l)).pop() ?? '').replace(/^\[(INFO|WARNING|ERROR)\]\s*/, '').replace(/ -- in .*/, '').trim();
    return [
      ['runtime-broker unit', last('broker-unit.log', /Tests run: \d+, Failures/)],
      ['runtime-broker fault gates', last('fault-gates.log', /Tests run: \d+, Failures/)],
      ['runtime-broker MySQL integration (MySQL 8.4.7)', last('broker-mysql.log', /Tests run: \d+, Failures/)],
      ['managed-agent-server unit', last('server-mysql.log', /Tests run: 1\d\d, Failures/)],
      ['managed-agent-server MySQL integration + Checkstyle', [last('server-mysql.log', /Tests run: \d+, Failures/), last('server-mysql.log', /Checkstyle violations/)].filter(Boolean).join(' · ')],
      ['Hosted ITs', last('hosted-mysql.log', /Tests run: \d+, Failures/)],
      ['core managed-tool*', last('ts-core.log', /^\s*Tests\s/)],
    ];
  };
  const head = suites('h6');
  const cell = (v) => esc(v || 'not run').replace(/(Failures: [1-9]\d*)/, '<span class="bad">$1</span>').replace(/(Errors: [1-9]\d*)/, '<span class="warn">$1</span>');
  const table = head.map(([n, v]) => `<tr><td class="t">${esc(n)}</td><td>${cell(v)}</td></tr>`).join('');
  const gates = log('fault-gates-full.log').filter(Boolean).map((l) => esc(l).replace(/^\[(\w+)\]/, '<span class="dim">[$1]</span>').replace(/(Failures: [1-9]\d*|Errors: [1-9]\d*)/g, '<span class="warn">$1</span>')).join('\n');
  const labels = log('labels-ab.log').filter(Boolean).map((l) => esc(l).replace(/^\[(\w+)\]/, '<span class="dim">[$1]</span>')).join('\n');
  const w6 = lines('s16-r5-h6-W2W4W6.log', /^\[W6-v2\] (control|reservation)/).map((l) => mark(l, [[/(413 runtime_control_operation_too_large retryable=false)/, 'ok'], [/(400 runtime_broker_invalid_request)/, 'ok']])).join('\n');
  const w6prev = lines('s16-r5-r4-W6.log', /^\[W6-v2\] (control|reservation)/).map((l) => mark(l, [[/(503 runtime_control_failed retryable=true)/, 'warn']])).join('\n');
  const serve = log('ts-serve-attribution.log').filter(Boolean).map((l) => l.replace(/failed: (\[.*\])$/, (m, list) => `${JSON.parse(list).length} failed, other tests than in the other runs`).replace(/\s+$/, '')).map(esc).join('\n');
  const body = `<h2>All earlier probes rerun on this head</h2><pre>round 1 · reviewer test plan, sections A–D          ${esc(sum('s1-contract-h6-ABCD.log'))}
round 1 · fault injection, sections E, F, H, I       ${esc(sum('s2-faults-h6-EFHI.log'))}
round 2 · error envelope, groups P, Q, R, S          ${esc(sum('s11-error-envelope-h6-PQRS.log'))}; ${p.filter((l) => /code kept=true reason kept at Broker=true/.test(l)).length} of ${p.length} refusals keep code and reason; long-reason residual unchanged: ${r.filter((l) => /code kept=false/.test(l)).length} of ${r.length} lose the code
round 2 · lost control replies, enumerations K, L     ${esc(sum('s12-lost-control-h6-KL.log'))}
round 3 · receipts, repeated cancellation M1, M2, M4, M5  ${esc(sum('s13-merge-h6-M1M2M4M5.log'))}
round 3 · worker death, 3 scenarios on fresh databases    placement ${death.join(', ')}; nothing executed, nothing replayed
round 4 · refused acquire, forgotten calls, cursor U1 to U4 ${esc(sum('s15-fix-h6-U1U1bU2U3U4.log'))}
round 5 · fitted results W1 (7 cases) and W1d             ${esc(sum('s16-r5-h6-W1.log'))}; ${esc(sum('s16-r5-h6-W1d.log'))}
round 5 · observation, receipts, refusals W2, W4, W6      ${esc(sum('s16-r5-h6-W2W4W6.log'))}</pre>
  <h2>The merge: what main and this head answer on the raw path (main has no provider path)</h2><pre>${log('main-vs-head.log').filter(Boolean).map((l) => esc(l).replace(/^\[(\w+)\]/, '<span class="dim">[$1]</span>').replace(/(identical)/g, '<span class="ok">$1</span>')).join('\n')}</pre>
  <h2>Refusals this head re-labels · boot v2</h2><pre><span class="dim">${PREV} (round 4)</span>\n${w6prev}\n<span class="dim">this head</span>\n${w6}\n${labels}</pre>
  <h2>Hosted loop: the repository's Hosted ITs on MySQL 8.4.7 (they run the drivers of #12831 and #12848)</h2><pre>${log('hosted-its.log').filter(Boolean).map(esc).join('\n')}</pre>
  <h2>Hosted Workspace loop: live model (qwen3.8-max), three turns</h2><pre>${model.join('\n')}</pre>
  <h2>Repository suites</h2><table><tr><th style="width:45%">suite</th><th>this head (it contains main cd0b35c153)</th></tr>${table}</table>
  <h2>Fault gates, full runs</h2><pre>${gates}</pre>
  <h2>cli src/serve on this machine</h2><pre>${serve}</pre>
  <div class="note">Everything from rounds 1 to 4 still holds on the merged head. On the raw path and after a worker death this head answers as main does; the one difference is the worker release this PR adds before the Workspace is deactivated. Failures that remain in the suites depend on the load of this host (30 to 100 during the round) and also occur on main.</div>`;
  return page('Regression on this head', 'Rounds 1 to 4 probes, the Hosted loop and the repository suites.', body);
};

cards['r5-07-mutation'] = () => {
  const all = fs.readFileSync(path.join(RIG, 'out', 'mutation', 'matrix.log'), 'utf8').split('\n');
  const rows = all.filter((l) => /^[JTNGHI]\d+\s/.test(l));
  const before = JSON.parse(fs.readFileSync(path.join(SP, 'r4-archive', 'out', 'mutation', 'summary.json'), 'utf8'));
  const previous = new Set([...before.survivors, 'G4']);
  const isTs = (file) => fs.existsSync(path.join(RIG, 'out', 'mutation', `${file}-cli.log.json`));
  const killers = (id) => {
    const found = [];
    for (const kind of ['cli', 'core']) {
      const file = path.join(RIG, 'out', 'mutation', `${id}-${kind}.log.json`);
      if (!fs.existsSync(file)) continue;
      for (const t of JSON.parse(fs.readFileSync(file, 'utf8')).testResults)
        for (const a of t.assertionResults)
          if (a.status === 'failed' && !path.basename(t.name).startsWith('hosted-harness-')) found.push(`${path.basename(t.name)} › ${a.title}`);
    }
    return found;
  };
  const parsed = rows.map((l) => {
    const m = l.match(/^(\w+)\s+(KILLED|SURVIVED|INVALID|SKIPPED)\s+(.*?) :: (.*?)(?: :: (.*))?$/);
    let [, id, verdict, , what, by] = m;
    let list = by ? by.split(' | ') : [];
    if (isTs(id)) {
      list = killers(id);
      verdict = list.length ? 'KILLED' : 'SURVIVED';
    }
    return { id, verdict, what, killer: list[0] ? list[0] + (list.length > 1 ? ` (+${list.length - 1})` : '') : '' };
  });
  const order = (id) => ({ I: 0, H: 1, G: 2, J: 3, T: 4, N: 5 })[id[0]] * 1000 + Number(id.slice(1));
  const row = (p) => {
    const cls = p.verdict === 'KILLED' ? 'ok' : p.verdict === 'SURVIVED' ? 'warn' : 'dim';
    const was = p.id.startsWith('I') ? '<span class="dim">new</span>' : previous.has(p.id) ? '<span class="warn">SURVIVED</span>' : '<span class="dim">KILLED</span>';
    return `<tr><td class="dim">${p.id}</td><td>${was}</td><td class="${cls}">${p.verdict}</td><td class="t">${esc(p.what)}</td><td class="dim">${esc(p.killer.length > 96 ? `${p.killer.slice(0, 94)}…` : p.killer)}</td></tr>`;
  };
  const table = (list) => `<table><tr><th style="width:4%">id</th><th style="width:8%">round 4</th><th style="width:8%">this head</th><th style="width:36%">mutation (one edit of a production line)</th><th>first killing test</th></tr>${list.map(row).join('')}</table>`;
  const fresh = parsed.filter((p) => p.id.startsWith('I')).sort((a, b) => order(a.id) - order(b.id));
  const old = parsed.filter((p) => !p.id.startsWith('I'));
  const changed = old.filter((p) => (previous.has(p.id) ? 'SURVIVED' : 'KILLED') !== p.verdict).sort((a, b) => order(a.id) - order(b.id));
  const survivors = old.filter((p) => p.verdict === 'SURVIVED' || changed.includes(p)).sort((a, b) => order(a.id) - order(b.id));
  const count = (list, v) => list.filter((p) => p.verdict === v).length;
  fs.writeFileSync(path.join(RIG, 'out', 'mutation', 'summary.json'), JSON.stringify({
    total: parsed.length, killed: count(parsed, 'KILLED'), survived: count(parsed, 'SURVIVED'), other: parsed.length - count(parsed, 'KILLED') - count(parsed, 'SURVIVED'),
    survivors: parsed.filter((p) => p.verdict === 'SURVIVED').map((p) => p.id),
    round5: { total: fresh.length, killed: count(fresh, 'KILLED'), survived: count(fresh, 'SURVIVED'), survivors: fresh.filter((p) => p.verdict === 'SURVIVED').map((p) => p.id) },
    earlier: { total: old.length, killed: count(old, 'KILLED'), survived: count(old, 'SURVIVED'), changedVerdict: changed.map((p) => `${p.id}:${p.verdict}`) },
  }));
  const body = `<h2>${fresh.length} new mutants of the lines the five commits add</h2>${table(fresh)}
  <h2>The ${old.length} mutants of rounds 1 to 4, rerun on this head: survivors and changed verdicts</h2>${table(survivors)}
  <div class="note">New mutants: ${count(fresh, 'KILLED')} of ${fresh.length} killed. Earlier mutants: ${count(old, 'KILLED')} of ${old.length} killed, ${count(old, 'SURVIVED')} survive; ${changed.length === 0 ? 'no verdict changed' : `verdicts that changed: ${changed.map((p) => `${p.id} is now ${p.verdict}`).join(', ')}`}. Failures in hosted-harness-session.test.ts during full runs under load are not counted as kills.</div>`;
  return page('Mutation matrix on this head', 'Suites: runtime-broker unit, managed-agent-server unit, cli serve managed/broker/hosted, core managed-tool. I = this round, H = round 4, G = merge resolution, J = Java, T = TypeScript, N = round 2.', body);
};

const want = process.argv[2] ? process.argv[2].split(',') : Object.keys(cards);
const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });
for (const id of want) {
  const key = Object.keys(cards).find((k) => k.startsWith(id));
  const html = cards[key]();
  const file = path.join(OUT, `${key}.html`);
  fs.writeFileSync(file, html);
  const tab = await context.newPage();
  await tab.goto(`file://${file}`);
  const clipped = await tab.evaluate(() => [...document.querySelectorAll('pre, td')].filter((el) => el.scrollWidth > el.clientWidth + 1).length);
  await tab.locator('#card').screenshot({ path: path.join(OUT, `${key}.png`) });
  const box = await tab.locator('#card').boundingBox();
  console.log(`${key}.png ${Math.round(box.width)}x${Math.round(box.height)} clipped-elements=${clipped}`);
  await tab.close();
}
await browser.close();
