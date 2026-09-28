// Round-4 evidence figures for PR #12868. Everything shown is read from the
// run logs in out/ and from git; titles and notes are the only hand-written text.
// usage: node figures-r4.mjs [card ids]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const RIG = path.dirname(new URL(import.meta.url).pathname);
const SP = path.dirname(RIG);
const OUT = path.join(SP, 'figures');
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(SP, 'wt-pr', 'package.json'));
const { chromium } = require('playwright');
const HEAD = 'cc06ee0e4e';
const PREV = 'ac0b6cf966';

const log = (name) => fs.readFileSync(path.join(RIG, 'out', name), 'utf8').split('\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tidy = (s) => s.replace(/\/private\/tmp\/claude-501\/[^ "]*?\/rig\/roots[-a-z0-9]*/g, '<roots>').replace(/\/private\/tmp\/claude-501\/[^ "]*?\/scratchpad/g, '<rig>').replace(/\/private\/tmp\/claude-501\/[^ "]*/g, '<rig>/…').replace(/\/privat$/, '…');
const strip = (s) => s
  .replace(/refused status=(\d+) code=(\w+) BrokerResponseError: Managed Runtime Broker returned HTTP \d+\. ?/g, 'refused $1 $2: ')
  .replace(/: Managed Runtime still$/, '')
  .replace(/\{"executionStatus":"success","responseParts".*$/, '{"executionStatus":"success", …}')
  .replace(/,"lastSeq":0,"firstAvailableSeq":\d,"progressGap":false,"progress":\[\]/g, ', …')
  .replace(/,"result":\{\]/g, ', "result": …}]')
  .replace(/ok \{"state":"settled","cancelRequested":true, …,"result":\{.*$/, 'ok {"state":"settled", "result": cancelled}')
  .replace(/\s+/g, ' ');

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
  .note.warn { border-left-color: #d29922; }
  .foot { color: #6e7681; font-size: 12.5px; margin-top: 16px; font-family: ui-monospace, Menlo, monospace; }
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${esc(`PR #12868 round 4 · head ${HEAD} = ${PREV} + one TypeScript commit · macOS 26 arm64 · Node 22.23.2 · JDK 21.0.12 · MySQL 8.4.7 · Spring server jar + embedded Runtime Broker + bundled workers`)}</div></div>`;
const paint = (l) => esc(strip(tidy(l)))
  .replace(/^\[PASS\]/, '<span class="ok">[PASS]</span>').replace(/^\[FAIL\]/, '<span class="bad">[FAIL]</span>')
  .replace(/^(\[U\d[a-z]?-v[12]\])/, '<span class="dim">$1</span>')
  .replace(/\(sent by the rig\)/g, '<span class="dim">(sent by the rig)</span>');
const mark = (html, rules) => rules.reduce((h, [re, cls]) => h.replace(re, `<span class="${cls}">$1</span>`), html);
const lines = (name, re) => log(name).filter((l) => re.test(l)).map(paint);

const cards = {};

cards['r4-01-head'] = () => {
  const facts = log('head-facts.log').filter(Boolean);
  const files = facts.filter((l) => l.startsWith('[file]')).map((l) => l.match(/^\[file\] (\S+)\s+\+(\d+)\s+-(\d+)\s+(.*)$/));
  const notes = {
    'managed-runtime-provider-worker.ts': 'a refused acquire removes its provisional claim and its Session entry; status and cancel answer { state: "unknown" } for a call the worker no longer retains',
    'managed-runtime-tool-executor.ts': 'new unclaimProviderSession(): removes only the provisional claim',
    'managed-tool-runtime.ts': 'new findStatus(): undefined for an unknown invocation id, the strict status() for a known one',
    'managed-runtime-provider-worker.test.ts': 'regression tests for both fixes on a real worker',
    'managed-tool-runtime.test.ts': 'findStatus with forged references',
    '2026-09-27-broker-provider-control.md': 'both behaviours written down',
    '2026-09-27-broker-provider-control.zh-CN.md': 'the same in Chinese',
  };
  const rows = files.map(([, kind, add, del, file]) => `<tr><td>${esc(path.basename(file))}</td><td class="${kind === 'production' ? 'hl' : 'dim'}">${esc(kind)}</td><td><span class="add">+${add}</span> <span class="del">−${del}</span></td><td class="t">${esc(notes[path.basename(file)] ?? '')}</td></tr>`).join('');
  const rest = facts.filter((l) => !l.startsWith('[file]')).map((l) => esc(l).replace(/^\[(\w+)\]/, '<span class="dim">[$1]</span>').replace(/(0 differ|: 0$|no conflict)/, '<span class="ok">$1</span>')).join('\n');
  const body = `<h2>git diff ${PREV} ${HEAD}</h2>
  <table><tr><th style="width:27%">file</th><th style="width:10%">kind</th><th style="width:9%">lines</th><th>what it does</th></tr>${rows}</table>
  <h2>Facts</h2><pre>${rest}</pre>
  <div class="note">One commit, TypeScript only: 23 production lines in the worker, its executor and the core runtime. No Java line changed, and the classes in the two server jars are equal by CRC, so the Broker of this head is the Broker verified in round 3. main now holds one migration per version; the collision reported in round 3 is gone.</div>`;
  return page('What the head contains', `Head ${HEAD} answers two findings of the automated review, R1-30 and R1-32. Both are in the worker.`, body);
};

cards['r4-02-refused-acquire'] = () => {
  const red = [[/(409 managed_runtime_identity_conflict &quot;Managed Runtime protocol conflicts\.&quot;)/g, 'bad'], [/(record UNKNOWN\/-)/, 'bad'], [/(release 409 runtime_session_busy)/, 'bad'], [/(storage held=true)/, 'bad'], [/(refused 409 workspace_busy[^|]*)/, 'bad'], [/(: 200 true)/g, 'warn']];
  const green = [[/(-&gt; 200 \{&quot;executionStatus&quot;:&quot;success&quot;, …\})/, 'ok'], [/(record SETTLED\/success)/, 'ok'], [/(release 200)/, 'ok'], [/(storage held=false)/, 'ok'], [/(through the provider: ok)/, 'ok']];
  const prev = lines('s15-fix-r3-U1U1bU2U3.log', /^\[U1-v2\] /).slice(1).map((l) => mark(l, red)).join('\n');
  const now = lines('s15-fix-pr-U1U1bU2U3.log', /^\[U1-v2\] |^\[(PASS|FAIL)\] U1-v2/).filter((l) => !/listens on a loopback/.test(l)).map((l) => mark(l, green)).join('\n');
  const both = lines('s15-fix-pr-U1U1bU2U3.log', /^\[U1b-v2\] |^\[(PASS|FAIL)\] U1b-v2/).join('\n');
  const body = `<h2>Previous head ${PREV} · boot v2</h2><pre>${prev}</pre>
  <h2>This head ${HEAD} · boot v2</h2><pre>${now}</pre>
  <h2>This head · the refusals do not change what a successful acquire does</h2><pre>${both}</pre>
  <div class="note">The worker and its credentials are the ones the Broker launched; only the first request is sent by the rig, because the Broker activates a Session before it ever acquires it and so never sends this order itself. On the previous head one refused provider acquire fenced the Session against the raw protocol for good. The raw call the Broker sent next was refused, its record became UNKNOWN, the Session could not be released and the Workspace storage stayed held. On this head the raw call runs once and the Workspace moves on. A Session that has run raw work still cannot switch to the provider, a released one stays closed, and a successful provider acquire still fences raw calls.</div>`;
  return page('R1-30: a refused provider acquire no longer fences the raw protocol', 'Same probe on two builds, Spring Broker on MySQL 8.4.7, real workers. Requests marked "sent by the rig" go to the Broker\'s worker with the Broker\'s own headers.', body);
};

cards['r4-03-forgotten-observation'] = () => {
  const red = [[/(409 managed_runtime_provider_operation_failed &quot;Managed tool invocation identity does not match\.&quot;)/g, 'bad']];
  const pick = (name, rules) => lines(name, /^\[U3-v2\] (status|cancel|execute|retained|the retained)/).map((l) => mark(l, rules)).join('\n');
  const prev = pick('s15-fix-r3-U1U1bU2U3.log', [[/^(<span class="dim">\[U3-v2\]<\/span> (?:status|cancel) +<span class="dim">\(sent by the rig\)<\/span> 409 .*)$/, 'bad'], [/(other invocation id: status 409 managed_runtime_provider_operation_failed &quot;[^&]*&quot;)/, 'bad']]);
  const now = pick('s15-fix-pr-U1U1bU2U3.log', [[/(200 \{&quot;state&quot;:&quot;unknown&quot;\})/g, 'ok']]);
  const checks = lines('s15-fix-pr-U1U1bU2U3.log', /^\[(PASS|FAIL)\] U3-v2/).join('\n');
  const body = `<h2>Previous head ${PREV} · a call of prompt p1 after prompt p2 began</h2><pre>${prev}</pre>
  <h2>This head ${HEAD} · the same requests (boot v2; boot v1 is identical)</h2><pre>${now}\n${checks}</pre>
  <div class="note">The worker forgets the calls of a prompt when the next prompt begins. For such a call, status and cancel now answer exactly <b>{ "state": "unknown" }</b>, the one-key shape both readers accept. The fix is narrow, as its description says: execute for a forgotten call is still refused and the file shows one effect; a changed reference of a call the worker does retain is still a conflict and cancels nothing; an invocation id the worker never issued answers unknown and tells the caller nothing.</div>`;
  return page('R1-32: the worker can say "unknown"', 'status, cancel and execute sent to the Broker\'s worker for a reference it no longer retains, and for changed references of one it does retain.', body);
};

cards['r4-04-cancel-residual'] = () => {
  const pick = (name, rules) => lines(name, /^\[U2-v2\] (cancel #|the same cancellation|record |begin-turn)/).map((l) => mark(l, rules)).join('\n');
  const prev = pick('s15-fix-r3-U1U1bU2U3.log', [[/(caller 409 managed_runtime_provider_operation_failed(?: retryable=false)?)/g, 'warn'], [/(refused 409 managed_runtime_provider_operation_failed)/, 'warn']]);
  const now = pick('s15-fix-pr-U1U1bU2U3.log', [[/(caller 503 runtime_execution_cancel_failed(?: retryable=true)?)/g, 'bad'], [/(refused 503 runtime_execution_cancel_failed)/, 'bad'], [/(cancel -&gt; 200 \{&quot;state&quot;:&quot;unknown&quot;\})/g, 'ok'], [/(record SETTLED\/cancelled)/, 'hl'], [/(GET 200 settled\/cancelled)/, 'hl']]);
  const cand = pick('s15-fix-cand-U2.log', [[/(caller 200)/g, 'ok'], [/(ok \{&quot;state&quot;:&quot;settled&quot;, &quot;result&quot;: cancelled\})/, 'ok'], [/(cancel -&gt; 200 \{&quot;state&quot;:&quot;unknown&quot;\})/g, 'ok']]);
  const patch = fs.readFileSync(path.join(SP, 'candidate-unknown-confirms-cancel.patch'), 'utf8').split('\n');
  const from = patch.findIndex((l) => l.startsWith('@@'));
  const to = patch.findIndex((l, i) => i > from && l.startsWith('diff --git'));
  const hunk = patch.slice(from, to).map((l) => esc(l)).map((l) => (l.startsWith('+') ? `<span class="add">${l}</span>` : l.startsWith('@@') ? `<span class="dim">${l}</span>` : l)).join('\n');
  const body = `<h2>Previous head ${PREV} · boot v2</h2><pre>${prev}</pre>
  <h2>This head ${HEAD} · boot v2 (boot v1 is identical)</h2><pre>${now}</pre>
  <h2>This head plus the candidate (4 lines in RuntimeBrokerService.java, worker unchanged)</h2><pre>${cand}</pre>
  <h2>Candidate, production part</h2><pre>${hunk}</pre>
  <div class="note warn">The fix stops at the worker, as its description says. The Broker does not yet accept the new answer when it confirms the cancellation of a prepared call, so a repeated cancellation of a call the worker forgot now reaches the caller as <b>503 runtime_execution_cancel_failed, retryable: true</b>, every time, while the record is SETTLED/cancelled and GET returns it. Before the fix the same request was a definite 409. Nothing executes in any arm, the Session keeps working and releases, and after release the receipt answers 200. The candidate treats "unknown" as the confirmation it is: the worker retains nothing to clean up and refuses to execute what it forgot.</div>`;
  return page('What remains of R1-32: the Broker does not accept "unknown" yet', 'A prepared call is cancelled, the next prompt begins, and the cancellation is repeated. Three builds, same probe.', body);
};

cards['r4-05-regression'] = () => {
  const sum = (name) => (log(name).find((l) => l.startsWith('[SUMMARY]')) ?? '').slice(10);
  const driver = log('s9-author-driver-mysql-pr.log').filter((l) => /^\[(driver|driver-out|mysql|executions|release order)\]/.test(l)).map((l) => esc(l));
  const model = log('s6-hosted-real-model-pr-p.log').filter((l) => /^\[(T\d|T\d wire|sessions|executions|holders|status)\]/.test(l)).map((l) => esc(tidy(l)).replace(/(turn_complete\(end_turn\)|recoveryBlocked=false)/g, '<span class="ok">$1</span>').replace(/(\/provider\/v1\/control\[release\] -&gt; 200, \/v3\/activation -&gt; 200)/g, '<span class="warn">$1</span>'));
  const kept = log('s11-error-envelope-pr-PQRS.log').filter((l) => /code kept=/.test(l));
  const p = kept.filter((l) => /^\[P-/.test(l));
  const r = kept.filter((l) => /^\[R-/.test(l));
  const death = ['s13-merge-pr-M3p-v1.log', 's13-merge-pr-M3p-v2.log', 's13-merge-pr-M3r-v2.log'].map((n) => log(n).find((l) => /binding LOST/.test(l)) ? 'LOST' : '?');
  const suites = (tag) => {
    const dir = path.join(SP, 'logs', `suites-${tag}`);
    const last = (f, re) => (fs.existsSync(path.join(dir, f)) ? (fs.readFileSync(path.join(dir, f), 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => re.test(l)).pop() ?? '') : '').replace(/^\[(INFO|WARNING|ERROR)\]\s*/, '').replace(/ -- in .*/, '').trim();
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
  const head = suites('pr');
  const merged = suites('mg2');
  const table = head.map(([n, v], i) => `<tr><td class="t">${esc(n)}</td><td>${esc(v)}</td><td>${esc(merged[i][1] || 'not run')}</td></tr>`).join('');
  const serve = log('ts-serve-attribution.log').filter(Boolean).map((l) => l.replace(/failed: (\[.*\])$/, (m, list) => `${JSON.parse(list).length} failed, other tests than in the other runs`).replace(/\s+$/, '')).map(esc).join('\n');
  const gates = log('fault-gate-flake-summary.log').filter(Boolean).map((l) => esc(l).replace(/^\[(\w+)\]/, '<span class="dim">[$1]</span>').replace(/(Failures: [1-9]\d*|[1-9]\d* fail)/g, '<span class="warn">$1</span>')).join('\n');
  const bundle = log('broker-unit-with-bundle.log').filter(Boolean).map(esc).join('\n');
  const body = `<h2>All earlier probes rerun on this head</h2><pre>round 1 · reviewer test plan, sections A–D          ${esc(sum('s1-contract-pr-ABCD.log'))}
round 1 · fault injection, sections E, F, H, I       ${esc(sum('s2-faults-pr-EFHI.log'))}
round 2 · error envelope, groups P, Q, R, S          ${esc(sum('s11-error-envelope-pr-PQRS.log'))}; ${p.filter((l) => /code kept=true reason kept at Broker=true/.test(l)).length} of ${p.length} refusals keep code and reason; long-reason residual unchanged: ${r.filter((l) => /code kept=false/.test(l)).length} of ${r.length} lose the code
round 2 · lost control replies, enumerations K, L     ${esc(sum('s12-lost-control-pr-KL.log'))}
round 3 · receipts, repeated cancellation M1, M2, M4, M5  ${esc(sum('s13-merge-pr-M1M2M4M5.log'))}
round 3 · worker death, 3 scenarios on fresh databases    placement ${death.join(', ')}; nothing executed, nothing replayed, as in round 3
round 4 · refused acquire, forgotten calls U1, U1b, U2, U3 ${esc(sum('s15-fix-pr-U1U1bU2U3.log'))}; progress cursor U4 ${esc(sum('s15-fix-pr-U4.log'))}\ntrial merge with main b32f261afd on the real stack     A–D ${esc(sum('s1-contract-mg2-ABCD.log'))}; U1 to U4 ${esc(sum('s15-fix-mg2-U1U1bU2U3U4.log'))}</pre>
  <h2>Hosted Workspace loop: the PR's own driver, unchanged, on MySQL 8.4.7</h2><pre>${driver.join('\n')}</pre>
  <h2>Hosted Workspace loop: live model (qwen3.8-max), three turns</h2><pre>${model.join('\n')}</pre>
  <h2>Repository suites</h2><table><tr><th style="width:36%">suite</th><th style="width:32%">this head</th><th>trial merge with main b32f261afd</th></tr>${table}</table>
  <pre style="margin-top:8px">${bundle}</pre>
  <h2>A fault gate of #12839 that depends on host load (not code of this PR)</h2><pre>${gates}</pre>
  <h2>cli src/serve on this machine</h2><pre>${serve}</pre>
  <div class="note">Nothing from rounds 1 to 3 moved. The Hosted loop uses the raw path, which this commit touches through the executor's admission fence, so both Hosted runs were repeated on this head. Two things in the suites depend on the load of this host, which stayed between 30 and 150 during the round: one process-crash fault gate that came with #12839 fails now and then on main's Java as well, and server.test.ts fails other tests on every run on both heads. CI on this head is green.</div>`;
  return page('Nothing else moved: regression on this head', 'Rounds 1 to 3 probes, the Hosted loop and the repository suites.', body);
};

cards['r4-06-mutation'] = () => {
  const all = fs.readFileSync(path.join(RIG, 'out', 'mutation', 'matrix.log'), 'utf8').split('\n');
  const rows = all.filter((l) => /^[JTNGH]\d+\s/.test(l));
  const previous = new Set(JSON.parse(fs.readFileSync(path.join(SP, 'r3-archive', 'out', 'mutation', 'summary.json'), 'utf8')).survivors);
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
    const [, id, , , what] = m;
    const list = killers(id);
    return { id, verdict: list.length ? 'KILLED' : 'SURVIVED', what, killer: list[0] ? list[0] + (list.length > 1 ? ` (+${list.length - 1})` : '') : '' };
  });
  const order = (id) => ({ H: 0, G: 1, J: 2, T: 3, N: 4 })[id[0]] * 1000 + Number(id.slice(1));
  const row = (p) => {
    const cls = p.verdict === 'KILLED' ? 'ok' : p.verdict === 'SURVIVED' ? 'warn' : 'dim';
    const was = p.id.startsWith('H') ? '<span class="dim">new</span>' : previous.has(p.id) ? '<span class="warn">SURVIVED</span>' : '<span class="dim">KILLED</span>';
    return `<tr><td class="dim">${p.id}</td><td>${was}</td><td class="${cls}">${p.verdict}</td><td class="t">${esc(p.what)}</td><td class="dim">${esc(p.killer.length > 96 ? `${p.killer.slice(0, 94)}…` : p.killer)}</td></tr>`;
  };
  const table = (list) => `<table><tr><th style="width:4%">id</th><th style="width:8%">round 3</th><th style="width:8%">this head</th><th style="width:36%">mutation (one edit of a production line)</th><th>first killing test</th></tr>${list.map(row).join('')}</table>`;
  const fresh = parsed.filter((p) => p.id.startsWith('H')).sort((a, b) => order(a.id) - order(b.id));
  const old = parsed.filter((p) => !p.id.startsWith('H'));
  const changed = old.filter((p) => (previous.has(p.id) ? 'SURVIVED' : 'KILLED') !== p.verdict).sort((a, b) => order(a.id) - order(b.id));
  const survivors = old.filter((p) => p.verdict === 'SURVIVED').sort((a, b) => order(a.id) - order(b.id));
  const count = (list, v) => list.filter((p) => p.verdict === v).length;
  fs.writeFileSync(path.join(RIG, 'out', 'mutation', 'summary.json'), JSON.stringify({
    rerun: parsed.length, killed: count(parsed, 'KILLED'), survived: count(parsed, 'SURVIVED'),
    survivors: parsed.filter((p) => p.verdict === 'SURVIVED').map((p) => p.id),
    round4: { total: fresh.length, killed: count(fresh, 'KILLED'), survived: count(fresh, 'SURVIVED') },
    earlierTypeScript: { total: old.length, killed: count(old, 'KILLED'), survived: count(old, 'SURVIVED'), changedVerdict: changed.map((p) => p.id) },
    javaNotRerun: 35,
  }));
  const body = `<h2>${fresh.length} new mutants of the lines this commit adds</h2>${table(fresh)}
  <h2>The ${old.length} TypeScript mutants of rounds 1 to 3, rerun on this head: survivors</h2>${table(survivors)}
  <div class="note">New mutants: ${count(fresh, 'KILLED')} of ${fresh.length} killed. Earlier TypeScript mutants: ${count(old, 'KILLED')} of ${old.length} killed, ${count(old, 'SURVIVED')} survive; ${changed.length === 0 ? 'no verdict changed' : `verdicts that changed: ${changed.map((p) => p.id).join(', ')}`}. The 35 Java mutants were not rerun: no Java line changed and the classes are equal by CRC, so their round-3 verdicts stand (34 killed, G4 survives). Failures in hosted-harness-session.test.ts during full runs under load are not counted as kills.</div>`;
  return page('Mutation matrix on this head', 'Suites: cli serve managed/broker/hosted (2128 tests), core managed-tool (190). H = this commit, G = merge resolution, T = TypeScript, N = round 2.', body);
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
