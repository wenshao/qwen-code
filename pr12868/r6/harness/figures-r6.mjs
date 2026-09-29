// Round-6 evidence figures for PR #12868. Everything shown is read from the
// run logs in out/ and from git; titles and notes are the only hand-written text.
// usage: node figures-r6.mjs [card ids]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { superseded } from './mutants-r6.mjs';

const RIG = path.dirname(new URL(import.meta.url).pathname);
const SP = path.dirname(RIG);
const OUT = path.join(SP, 'figures');
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(SP, 'wt-h7', 'package.json'));
const { chromium } = require('playwright');
const HEAD = '5c0c9bf323';
const PREV = '42a059af96';
const MAIN = '1b69629708';

const has = (name) => fs.existsSync(path.join(RIG, 'out', name));
const log = (name) => fs.readFileSync(path.join(RIG, 'out', name), 'utf8').split('\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tidy = (s) => s.replace(/\/private\/tmp\/rig\/[^ "]*?\/rig\/roots[-a-z0-9]*/g, '<roots>').replace(/\/private\/tmp\/rig\/[^ "]*?\/scratchpad/g, '<rig>').replace(/\/private\/tmp\/rig\/[^ "]*/g, '<rig>/…');
const strip = (s) => s
  .replace(/refused status=(\d+|-) code=(\w+) (?:BrokerResponseError|ManagedToolProtocolError|ManagedRuntimeProviderError): (?:Managed Runtime Broker returned HTTP \d+\. ?)?/g, 'refused $1 $2: ')
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
  .note { border-left: 3px solid #1f6feb; padding: 6px 0 6px 12px; margin-top: 16px; color: #c9d1d9; font-size: 15px; line-height: 1.5; }
  .note.warn { border-left-color: #d29922; }
  .foot { color: #6e7681; font-size: 12.5px; margin-top: 16px; font-family: ui-monospace, Menlo, monospace; }
`;
const FOOT = `PR #12868 round 6 · head ${HEAD} = ${PREV} + one commit · macOS 26 arm64 · Node 22.23.2 · JDK 21.0.12 · MySQL 8.4.7 · Spring server jar + embedded Runtime Broker + bundled workers`;
const page = (title, sub, body, foot = FOOT) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${esc(foot)}</div></div>`;
const mark = (html, rules) => rules.reduce((h, [re, cls]) => h.replace(re, `<span class="${cls}">$1</span>`), html);
const paint = (l) => esc(strip(tidy(l)))
  .replace(/^\[PASS\]/, '<span class="ok">[PASS]</span>').replace(/^\[FAIL\]/, '<span class="bad">[FAIL]</span>')
  .replace(/^(\[[A-Za-z0-9-]+\])/, '<span class="dim">$1</span>')
  .replace(/\(sent by the rig\)/g, '<span class="dim">(sent by the rig)</span>');
const facts = (name, tag) => log(name).filter((l) => l.startsWith(`[${tag}]`)).map((l) => esc(l).replace(/^\[(\w+)\]/, '<span class="dim">[$1]</span>'));
const sum = (name) => (has(name) ? (log(name).find((l) => l.startsWith('[SUMMARY]')) ?? '').slice(10) : 'not run');
const checks = (name) => log(name).filter((l) => /^\[(PASS|FAIL)\]/.test(l)).map(paint);

const cards = {};

cards['r6-01-head'] = () => {
  const body = `<h2>The commit since round 5</h2><pre>${facts('head-facts.log', 'commit').join('\n')}</pre>
  <h2>By kind, and its production files</h2><pre>${[...facts('head-facts.log', 'kind'), ...facts('head-facts.log', 'file')].join('\n')}</pre>
  <h2>What round 5 left open, and what this commit says about it</h2><pre>${facts('head-facts.log', 'claim').join('\n')}</pre>
  <h2>CI and main</h2><pre>${[...facts('ci.log', 'ci'), ...facts('head-facts.log', 'main')].map((l) => l.replace(/(\d+ pass)/, '<span class="ok">$1</span>').replace(/(no conflict)/, '<span class="ok">$1</span>').replace(/(#12865[^·]*)/, '<span class="hl">$1</span>')).join('\n')}</pre>
  <div class="note">One commit, five production files. It answers the three items round 5 left open, each in its own way: the fitter is rewritten, the Broker now applies the worker's id rule at acquire, and a repeated cancellation after a restart asks for adoption instead of answering from the receipt. main moved 15 commits meanwhile and now holds the adoption this design relies on (#12865), so the trial merge was built and run as a third arm.</div>`;
  return page('What the head contains', `Head ${HEAD}: byte-exact result fitting, an ASCII allow-list for Session ids at both doors, and a retryable answer for a cancellation repeated after the Broker was replaced.`, body);
};

cards['r6-02-fitter'] = () => {
  const pick = (name) => {
    const out = [];
    let head = '';
    for (const l of log(name)) {
      const h = l.match(/^\[X1-v2\] ([^:]+): caller (\w+) \| worker execute -> (\d+) (\d+ KiB)(?: \(([\d.]+) % of the 1 MiB limit\))?/);
      if (h && !l.includes('edit of')) { head = `${h[1].padEnd(34)} worker ${h[4].padStart(8)}${h[5] ? ` = ${h[5].padStart(5)} %` : ''}`; continue; }
      const t = l.match(/^\[X1-v2\]\s+display\.text\s+execute, as the worker sent it: (.*)$/);
      if (t && head) {
        const d = t[1].match(/^(\d+) characters, (\d+ KiB) on the wire \| notice: (\d+) omitted \| payload kept (\d+) \+ omitted \d+ = (\d+) of (\d+)( \(not exact\))? \| lone surrogates (\d+)/);
        if (d) out.push(`${head} | display.text keeps ${d[4].padStart(6)} of ${d[6].padStart(6)} | notice says ${d[3].padStart(6)} omitted${d[7] ? ', which is not what is gone' : ', exactly'} | lone surrogates sent ${d[8]}`);
        head = '';
      }
      const e = l.match(/^\[X1-v2\] edit of a 700 KiB file: caller (\w+) \| worker execute -> (\d+) (\d+ KiB) \| llmContent (the stub|\d+ characters)[^|]*\| display (the stub|[^|]+) \|/);
      if (e) out.push(`${'edit of a 700 KiB file'.padEnd(34)} worker ${e[3].padStart(8)}           | llmContent: ${e[4]} | display: ${e[5].trim()}`);
    }
    return out;
  };
  const colour = (l) => mark(esc(l), [[/(, which is not what is gone)/, 'bad'], [/(, exactly)/, 'ok'], [/(lone surrogates sent [1-9]\d*)/, 'bad'], [/(llmContent: the stub)/, 'bad'], [/(llmContent: \d+ characters)/, 'ok'], [/(= +100\.0 %)/, 'ok'], [/(keeps +\d{1,3} of)/, 'bad']]);
  const fuzz = (name) => log(name).filter(Boolean).filter((l) => !l.startsWith('        ')).map((l) => paint(l.replace(/ arm=h\d /, ' '))).join('\n');
  const body = `<h2>Previous head ${PREV} · boot v2 · six shell outputs and one edit, through the provider</h2><pre>${pick('s18-r6-h6-X1.log').map(colour).join('\n')}</pre>
  <h2>This head ${HEAD} · the same calls</h2><pre>${pick('s18-r6-h7-X1.log').map(colour).join('\n')}</pre>
  <h2>This head: the checks of the probe, both boot versions</h2><pre>${checks('s18-r6-h7-X1.log').join('\n')}</pre>
  <h2>3,000 random results given to the built fitter of each head (same seed)</h2><pre><span class="dim">previous head ${PREV}</span>\n${fuzz('fit-fuzz-h6.log')}\n\n<span class="dim">this head ${HEAD}</span>\n${fuzz('fit-fuzz-h7.log')}</pre>
  <div class="note">All three observations of round 5 are closed. The cut is measured in the bytes the wire counts, so text in two-, three- and four-byte characters now fills the budget; whole code points are removed, so no pair is split; the notice counts what is gone; and an edit keeps its model content while only its display becomes the stub. What the worker sends for a cut field is what the caller receives, byte for byte.</div>`;
  return page('Result fitting: where the cut lands now', 'Each line is one tool call on the real chain. "worker" is the size of the worker\'s answer against the 1 MiB limit of the route.', body);
};

cards['r6-03-ids'] = () => {
  const pick = (name) => log(name).map((l) => l.match(/^\[X2-v2\] (.{26}) (.{44}) (acquire .*)$/)).filter(Boolean).map((m) => {
    const rest = m[3]
      .replace(/ "Runtime Broker request is invalid\."/, '')
      .replace(/ "acquire request\.runtimeSessionId must be a bounded non-empty[^"]*"?/, ' (length or NUL)')
      .replace(/ \| raw work: SETTLED\/success/, ' | raw work ok')
      .replace(/no Session row, requests that reached a worker: 0/, 'no Session, no worker request')
      .replace(/release 400 managed_runtime_provider_invalid/, 'release 400')
      .replace(/release 404 runtime_broker_route_not_found/, 'release 404')
      .replace(/ \| worker refusals: .*$/, '');
    return `${m[1]} ${m[2].trim().padEnd(30).slice(0, 30)} ${rest}`;
  });
  const colour = (l) => mark(esc(l), [[/(acquire 400 runtime_broker_invalid_request)/, 'hl'], [/(no Session, no worker request)/, 'ok'], [/(release 200)/, 'ok'], [/(Session now RELEASED)/, 'ok'], [/(storage held=false)/, 'ok'], [/(release 40[04])/, 'bad'], [/(Session now (?:RELEASING|READY))/, 'bad'], [/(storage held=true)/, 'bad'], [/(acquire 409[^|]*)/, 'warn']]);
  const sweep = (name) => log(name).filter((l) => l.startsWith('[X2s-v1]')).map((l) => paint(l.replace(/ \["0x01.*?\] \|/, ' |').replace(/ \["0x01: release.*$/, ''))).join('\n');
  const body = `<h2>Previous head ${PREV} · boot v2 · raw route · 24 spellings of the Runtime Session id</h2><pre>${pick('s18-r6-h6-X2.log').map(colour).join('\n')}</pre>
  <h2>This head ${HEAD} · the same spellings</h2><pre>${pick('s18-r6-h7-X2.log').map(colour).join('\n')}</pre>
  <h2>Every ASCII character, one at a time, in the middle of an id</h2><pre><span class="dim">previous head ${PREV}</span>\n${sweep('s18-r6-h6-X2s-v1.log')}\n\n<span class="dim">this head ${HEAD}</span>\n${sweep('s18-r6-h7-X2s-v1.log')}</pre>
  <h2>This head: the checks of both probes</h2><pre>${[...checks('s18-r6-h7-X2.log'), ...checks('s18-r6-h7-X2s-v1.log')].join('\n')}</pre>
  <div class="note">The rule is now a list of what is allowed (A-Z a-z 0-9 . _ -, 1 to 512 characters, not "." and no ".."), and the Broker applies it when it acquires. An id the worker would refuse to release can no longer be acquired: no Session row is written and no worker is asked. The Broker and the worker agree on all 128 ASCII characters. Ids with a space or outside ASCII were usable on the previous head and are refused now; the producers in the repository use UUIDs.</div>`;
  return page('Session ids: one rule at both doors', 'The provider route only ever admitted UUIDs (the client refuses others before any request), so the raw route is shown.', body);
};

cards['r6-04-restart'] = () => {
  const lost = (name) => log(name).filter((l) => /^\[X4-v2\] (prepared call|worker killed \| cancel #[2-4]|GET)/.test(l)).map((l) => l.replace(/ \| worker pid found on port \d+/, '').replace(/ \| requests sent towards the dead worker: \d+/, ''));
  const restart = (name, tag) => log(name).filter((l) => l.startsWith(`[${tag}]`) && /Broker process stopped|cancel #2|acquire again|start of the cancelled call|release |OBSERVED/.test(l)).filter((l) => !/^\[[^\]]+\] host:/.test(l));
  const colour = (l) => mark(paint(l), [[/(503 runtime_reconciliation_required retryable=true)/, 'hl'], [/(404 runtime_session_not_found retryable=false)/, 'bad'], [/(409 runtime_admission_closed retryable=false)/, 'bad'], [/(answered after 1[12]\d\.\d s with 503 runtime_broker_reconcile_timeout)/, 'warn'], [/(answered after 0\.\d s with 200)/, 'ok'], [/(cancel(?: #\d)? 200 cancelled)/, 'ok'], [/(release 200)/, 'ok'], [/(Session RELEASED)/, 'ok'], [/(record SETTLED\/success)/, 'ok'], [/(confirmed never)/, 'warn'], [/(release 503 runtime_reconciliation_required)/, 'warn']]);
  const body = `<h2>The worker is killed under a live Broker · previous head ${PREV}</h2><pre>${lost('s18-r6-h6-X4-v2.log').map(colour).join('\n')}</pre>
  <h2>The same · this head ${HEAD}</h2><pre>${lost('s18-r6-h7-X4-v2.log').map(colour).join('\n')}</pre>
  <h2>The Broker process is replaced (SIGKILL) · default provisioner · previous head ${PREV}</h2><pre>${restart('s19-restart-h6-v2-KILL.log', 'Y-v2').map(colour).join('\n')}</pre>
  <h2>The same · this head ${HEAD}</h2><pre>${restart('s19-restart-h7-v2-KILL.log', 'Y-v2').map(colour).join('\n')}</pre>
  <h2>The same on Linux · trial merge with main ${MAIN}, which holds #12865 · durable-local-process=true</h2><pre>${[...log('s20-linux-restart-tm7-durable-v2-KILL.log').filter((l) => /\] host:/.test(l)), ...restart('s20-linux-restart-tm7-durable-v2-KILL.log', 'L-v2')].map(colour).join('\n')}</pre>
  <h2>All Linux runs of the trial merge</h2><pre>${['durable-v1-KILL', 'durable-v1-TERM', 'durable-v2-KILL', 'durable-v2-TERM', 'default-v1-KILL'].map((k) => `<span class="dim">${k.replace('durable', 'durable-local-process=true ').replace('default', 'durable-local-process=false').replace(/-v/, ' · boot v').replace(/-(KILL|TERM)/, ' · SIG$1').padEnd(52)}</span> ${k.startsWith('default') ? esc(`${(log(`s20-linux-restart-tm7-${k}.log`).find((l) => l.includes('acquire again')) ?? '').replace(/^\[L-v1\] /, '').replace(/ retryable=true "[^"]*" \| cancel #3.*$/, '')}; the cancellation stays 503, as on macOS`) : `<span class="ok">${esc(sum(`s20-linux-restart-tm7-${k}.log`))}</span>`}`).join('\n')}</pre>
  <div class="note warn">Two different losses, two different answers. When the worker is lost under a live Broker, the binding becomes LOST and the receipt now answers (it was a 409 for good). When the Broker is replaced, the answer is a retryable 503 that asks the caller to acquire again. That works where the Broker can adopt its worker: on Linux with the durable provisioner of #12865 the acquire takes 0.2 s, the cancellation is confirmed, another prepared call runs on the adopted worker and the Session releases. With the default provisioner the acquire waits out the 120 s operation deadline and nothing changes, with the worker alive or dead. The receipt is readable by GET throughout, which is what the TypeScript provider reads first.</div>`;
  return page('A repeated cancellation after a loss', 'A prepared provider call is reserved and cancelled (200). Then something is lost, and the same cancellation is sent again.', body);
};

cards['r6-05-regression'] = () => {
  const arm = (a, label) => {
    const rows = [
      ['round 1 · reviewer test plan A to D', `s1-contract-${a}-ABCD.log`],
      ['round 1 · faults E, F, H, I', `s2-faults-${a}-EFHI.log`],
      ['round 2 · error envelope P to S', `s11-error-envelope-${a}-PQRS.log`],
      ['round 2 · lost control K, L', `s12-lost-control-${a}-KL.log`],
      ['round 3 · receipts and guards M1, M2, M4, M5', `s13-merge-${a}-M1M2M4M5.log`],
      ['round 4 · refused acquire, forgotten calls U1 to U4', `s15-fix-${a}-U1U1bU2U3U4.log`],
      ['round 5 · large results W1', `s16-r5-${a}-W1.log`],
      ['round 5 · observation, receipts, refusals W2, W4, W6', `s16-r5-${a}-W2W4W6.log`],
      ['round 6 · where the cut lands X1', `s18-r6-${a}-X1.log`],
      ['round 6 · Session ids X2, and every ASCII character', `s18-r6-${a}-X2.log`, `s18-r6-${a}-X2s-v1.log`],
      ['round 6 · content modification X5, large writes X6', `s18-r6-${a}-X5X6.log`],
      ['round 6 · worker lost under a live Broker X4', `s18-r6-${a}-X4-v1.log`, `s18-r6-${a}-X4-v2.log`],
    ];
    return `<span class="dim">${label}</span>\n${rows.map(([title, ...files]) => `${title.padEnd(58)} ${files.map((f) => sum(f)).join('; ')}`).map((l) => mark(esc(l), [[/(\d+\/\d+ checks passed)(?! —)/g, 'ok'], [/(— failed: .*)$/, 'bad']])).join('\n')}`;
  };
  const writes = log('s18-r6-h7-X5X6.log').filter((l) => /^\[X6-v1\] [a-z_]/.test(l)).map((l) => l
    .replace(/\[worker: [^\]]*?(prepare|confirmation|execute) -> (\d+)(?: (\d+ KiB))?[^\]]*\]/g, (m, kind, status, size) => `[${status}${size ? ` ${size}` : ''}]`)
    .replace(/\[worker: [^\]]*\]/g, '')
    .replace(/ +\|/g, ' |'));
  const paintWrite = (l) => mark(paint(l), [[/(prepare: 400 managed_runtime_provider_invalid)/, 'warn'], [/(confirmation: 400 managed_runtime_provider_invalid)/, 'warn'], [/(result success)/, 'ok']]);
  const suites = has('suites.log') ? log('suites.log').filter(Boolean).map((l) => mark(esc(l), [[/(, 0 failed)/g, 'ok'], [/(, [1-9]\d* failed)/g, 'bad'], [/(0 Checkstyle violations)/g, 'ok'], [/(\d+ passed \(\d+\))/g, 'ok']]).replace(/^\[([^\]]+)\]/, '<span class="dim">[$1]</span>')).join('\n') : '';
  const model = log('s6-hosted-real-model-h7-p.log').filter((l) => /^\[(T\d|sessions|executions|holders)\]/.test(l)).map(paint).join('\n');
  const body = `<h2>Probes of all rounds</h2><pre>${arm('h7', `this head ${HEAD}`)}\n\n${arm('tm7', `trial merge of this head with main ${MAIN}`)}</pre>
  <h2>Large writes on this head, step by step (boot v1)</h2><pre>${writes.map(paintWrite).join('\n')}\n${checks('s18-r6-h7-X5X6.log').filter((l) => l.includes('X6-')).join('\n')}</pre>
  <h2>Repository suites</h2><pre>${suites}</pre>
  <h2>Hosted loop with a live model on this head</h2><pre>${model}</pre>
  <div class="note">Nothing of the earlier rounds moved, on the head or on the trial merge. The follow-up the author recorded is as described: confirmation details of a write over a 900 KB file are refused, and the call can still be decided and run, and the Session releases. A write_file whose own content is above 256 KiB is refused at prepare; that limit is core's and is on main.</div>`;
  return page('Regression on the head and on the trial merge', 'Same probes, same rig, three builds. Every group runs on a fresh database.', body);
};

cards['r6-06-mutation'] = () => {
  const all = log(path.join('mutation', 'matrix.log'));
  const latest = new Map();
  for (const l of all) {
    const m = l.match(/^(\w+)\s+(KILLED|SURVIVED|INVALID|SKIPPED|SUPERSEDED)\s+(.*?) :: (.*?)(?: :: (.*))?$/);
    if (m) latest.set(m[1], { id: m[1], verdict: m[2], what: m[4], by: m[5] });
  }
  const before = JSON.parse(fs.readFileSync(path.join(SP, 'r5-archive', 'out', 'mutation', 'summary.json'), 'utf8'));
  const previous = new Set(before.survivors);
  const killers = (id) => {
    const found = [];
    for (const kind of ['cli', 'core']) {
      const file = path.join(RIG, 'out', 'mutation', `${id}-${kind}.log.json`);
      if (!fs.existsSync(file)) continue;
      for (const t of JSON.parse(fs.readFileSync(file, 'utf8')).testResults)
        for (const a of t.assertionResults)
          if (a.status === 'failed' && !path.basename(t.name).startsWith('hosted-harness-session')) found.push(`${path.basename(t.name)} › ${a.title}`);
    }
    return found;
  };
  const isTs = (id) => fs.existsSync(path.join(RIG, 'out', 'mutation', `${id}-cli.log.json`));
  const parsed = [...latest.values()].map((p) => {
    let list = p.by ? p.by.split(' | ') : [];
    let verdict = p.verdict;
    if (isTs(p.id) && (verdict === 'KILLED' || verdict === 'SURVIVED')) {
      list = killers(p.id);
      verdict = list.length ? 'KILLED' : 'SURVIVED';
    }
    return { ...p, verdict, killer: list[0] ? list[0] + (list.length > 1 ? ` (+${list.length - 1})` : '') : '' };
  });
  const order = (id) => ({ K: 0, I: 1, H: 2, G: 3, J: 4, T: 5, N: 6 })[id[0]] * 1000 + Number(id.slice(1));
  const row = (p) => {
    const cls = p.verdict === 'KILLED' ? 'ok' : p.verdict === 'SURVIVED' ? 'warn' : 'dim';
    const was = p.id.startsWith('K') ? '<span class="dim">new</span>' : previous.has(p.id) ? '<span class="warn">SURVIVED</span>' : '<span class="dim">KILLED</span>';
    return `<tr><td class="dim">${p.id}</td><td>${was}</td><td class="${cls}">${p.verdict}</td><td class="t">${esc(p.what)}</td><td class="dim">${esc(p.killer.length > 96 ? `${p.killer.slice(0, 94)}…` : p.killer)}</td></tr>`;
  };
  const table = (list) => `<table><tr><th style="width:4%">id</th><th style="width:8%">round 5</th><th style="width:9%">this head</th><th style="width:36%">mutation (one edit of a production line)</th><th>first killing test</th></tr>${list.map(row).join('')}</table>`;
  const fresh = parsed.filter((p) => p.id.startsWith('K')).sort((a, b) => order(a.id) - order(b.id));
  const old = parsed.filter((p) => !p.id.startsWith('K'));
  const ran = old.filter((p) => p.verdict === 'KILLED' || p.verdict === 'SURVIVED');
  const gone = [...superseded].map((id) => ({ id }));
  const changed = ran.filter((p) => (previous.has(p.id) ? 'SURVIVED' : 'KILLED') !== p.verdict).sort((a, b) => order(a.id) - order(b.id));
  const shown = ran.filter((p) => p.verdict === 'SURVIVED' || changed.includes(p)).sort((a, b) => order(a.id) - order(b.id));
  const count = (list, v) => list.filter((p) => p.verdict === v).length;
  const other = parsed.filter((p) => !['KILLED', 'SURVIVED', 'SUPERSEDED'].includes(p.verdict));
  fs.writeFileSync(path.join(RIG, 'out', 'mutation', 'summary.json'), JSON.stringify({
    total: parsed.length + gone.length, ran: fresh.length + ran.length, killed: count(parsed, 'KILLED'), survived: count(parsed, 'SURVIVED'), superseded: gone.map((p) => p.id), other: other.map((p) => `${p.id}:${p.verdict}`),
    survivors: parsed.filter((p) => p.verdict === 'SURVIVED').map((p) => p.id),
    round6: { total: fresh.length, killed: count(fresh, 'KILLED'), survived: count(fresh, 'SURVIVED'), survivors: fresh.filter((p) => p.verdict === 'SURVIVED').map((p) => p.id) },
    earlier: { total: ran.length, killed: count(ran, 'KILLED'), survived: count(ran, 'SURVIVED'), survivors: ran.filter((p) => p.verdict === 'SURVIVED').map((p) => p.id), changedVerdict: changed.map((p) => `${p.id}:${p.verdict}`) },
  }));
  const body = `<h2>${fresh.length} new mutants of the lines this commit adds</h2>${table(fresh)}
  <h2>The ${ran.length} earlier mutants that still have a line to edit, rerun on this head: survivors and changed verdicts</h2>${table(shown)}
  <div class="note">New mutants: ${count(fresh, 'KILLED')} of ${fresh.length} killed. Earlier mutants: ${count(ran, 'KILLED')} of ${ran.length} killed, ${count(ran, 'SURVIVED')} survive; ${changed.length === 0 ? 'no verdict changed' : `verdicts that changed: ${changed.map((p) => `${p.id} is now ${p.verdict.toLowerCase()}`).join(', ')}`}. ${gone.length} mutants of round 5 (${gone.map((p) => p.id).join(', ')}) edited the list of refused characters, which no longer exists; K1 to K8 take their place. Failures of hosted-harness-session.test.ts are not counted as kills.</div>`;
  return page('Mutation matrix on this head', 'Suites: runtime-broker unit, managed-agent-server unit, cli serve managed/broker/hosted, core managed-tool. K = this round, I = round 5, H = round 4, G = merge resolution, J = Java, T = TypeScript, N = round 2.', body);
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
