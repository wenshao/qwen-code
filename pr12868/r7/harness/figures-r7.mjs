// Round-7 evidence figures for PR #12868. Everything shown is read from the
// run logs in out/ and from git; titles and notes are the only hand-written text.
// usage: node figures-r7.mjs [card ids]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { superseded as superseded6 } from './mutants-r6.mjs';
import { superseded7 } from './mutants-r7.mjs';
import { superseded7b } from './mutants-r7b.mjs';
import { superseded7c } from './mutants-r7c.mjs';
import { superseded7d } from './mutants-r7d.mjs';
import { superseded7e } from './mutants-r7e.mjs';
import { superseded7f } from './mutants-r7f.mjs';

const RIG = path.dirname(new URL(import.meta.url).pathname);
const SP = path.dirname(RIG);
const OUT = path.join(SP, 'figures');
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(SP, 'wt-h13', 'package.json'));
const { chromium } = require('playwright');
const HEAD = 'ebea694e4e';
const FIT = '760174073b';
const LOST = '9cb9dc86e8';
const RULES = '50fb28301e';
const MERGED = '174f974e3e';
const FIX = 'e94f781523';
const PREV = '5c0c9bf323';
const MAIN = '12793013c4';
const MAIN_NOW = 'be1ebc74d7';
const MERGED_AS = '1f1209bc70';
const MAIN_AFTER = 'a63157304a';

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
const FOOT = `PR #12868 round 7 · head ${HEAD} = ${PREV} + seven commits, merged as ${MERGED_AS} · macOS 26 arm64 · Node 22.23.2 · JDK 21.0.12 · MySQL 8.4.7 · Spring server jar + embedded Runtime Broker + bundled workers`;
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
const okSum = (name) => mark(esc(sum(name)), [[/(\d+\/\d+ checks passed)(?! —)/g, 'ok'], [/(— failed: .*)$/, 'bad']]);

cards['r7-01-head'] = () => {
  const body = `<h2>The commits since round 6</h2><pre>${[...facts('head-facts.log', 'commit'), ...facts('head-facts.log', 'conflict')].join('\n')}</pre>
  <h2>The five commits of the branch itself (the first and the last four), by kind, and their production files</h2><pre>${[...facts('head-facts.log', 'kind'), ...facts('head-facts.log', 'file')].join('\n')}</pre>
  <h2>What was open, and what the commits say about it</h2><pre>${facts('head-facts.log', 'claim').join('\n')}</pre>
  <h2>CI, review and main</h2><pre>${[...facts('ci.log', 'ci'), ...facts('head-facts.log', 'main')].map((l) => l.replace(/(\d+ pass)/, '<span class="ok">$1</span>').replace(/(no conflict)/, '<span class="ok">$1</span>')).join('\n')}</pre>
  <div class="note">Seven commits. The first is the answer to the review: a released Session is no longer kept for the life of the worker, and what rounds 3 to 6 found without a test has one. The second merges main, which had moved by 38 commits; three files conflicted and were resolved by hand, one of them production code. The third corrects a number in a design document. The fourth gives the provider path three rules main had meanwhile given the raw path. The fifth lets the Broker ask the worker what became of a call whose answer was lost, and checks the directory of a Shell call a second time. The sixth lets the result fitter drop artifacts that cannot fit. The seventh sends the cancellation of such a lost call to the worker.</div>`;
  return page('What the head contains', `Head ${HEAD}: the answer to the round-4 review (${FIX}), a merge of main ${MAIN}, one line of documentation, main's input rules on the provider path (${RULES}), the reconciliation of lost answers (${LOST}), artifacts in the result fitter (${FIT}), and the cancellation of a lost call.`, body);
};

cards['r7-02-retention'] = () => {
  const block = (name, picks) => log(name).filter((l) => new RegExp(`^\\[sample\\] released Sessions=(${picks}) |^\\[idle\\]|^\\[result\\] (mode|raw)`).test(l)).map((l) => l.replace(/ worker pid=\d+/, '').replace(/ elapsed=\d+s/, '').replace(/^\[result\] mode=v2 /, '[result] provider path, boot v2, ')).map((l) => mark(paint(l), [[/(\+\d{2,} MiB, [\d.]+ KiB per released Session)/, 'warn'], [/(-\d+ MiB, -[\d.]+ KiB per released Session)/, 'ok'], [/(\+\d MiB, [\d.]+ KiB per released Session)/, 'ok']])).join('\n');
  const body = `<h2>Provider path · previous head ${PREV} · 300 Sessions, each turn writes 200 KiB</h2><pre>${block('s3-retention-h7-v2-300x200KiB.log', '1|150|300')}</pre>
  <h2>Provider path · this head ${HEAD} · the same 300 Sessions</h2><pre>${block('s3-retention-h13-v2-300x200KiB.log', '1|150|300')}</pre>
  <h2>Provider path · this head ${HEAD} · 1,000 Sessions</h2><pre>${block('s3-retention-h13-v2-1000x200KiB.log', '1|100|500|1000')}</pre>
  <h2>Raw path, the one the Hosted harness uses today · this head ${HEAD}</h2><pre>${block('s3b-retention-raw-h13-v2-300x200KiB.log', '1|150|300')}</pre>
  <h2>Raw path · main ${MAIN}, the one the head holds, without this PR</h2><pre>${block('s3b-retention-raw-m9-v2-300x200KiB.log', '1|150|300')}</pre>
  <h2>How long a release takes at the worker, now that it may retire a Session</h2><pre>${facts('release-latency.log', 'release').join('\n')}</pre>
  <div class="note">R4-1 is closed on the path this PR adds. One worker, Sessions one after another, each used for one write_file of 200 KiB and released: the previous head ends 286 MiB higher after 300 of them, this head ends lower than it began, after 300 and after 1,000. A release costs what it cost. The raw path is unchanged by this PR and keeps about 325 KiB per released Session on main as well (329 on this head, 325 on main); that is the executor's journal, outside this diff. The memory is the resident set of the worker process 15 s after the last release.</div>`;
  return page('What a worker keeps after a release', 'R4-1 of the review bot, measured on the real chain before and after the fix.', body);
};

cards['r7-03-released'] = () => {
  const z1 = (name) => log(name).filter((l) => /^\[Z1-v2\] released Session/.test(l)).map((l) => l.replace(' (sent by the rig)', '').replace(/managed_runtime_provider_operation_failed/g, 'refused')).map((l) => mark(paint(l), [[/(status settled)/, 'ok'], [/(cancel settled)/, 'ok'], [/(history 200)/, 'ok'], [/(status unknown)/, 'hl'], [/(cancel unknown)/, 'hl'], [/(history 409 refused)/, 'hl']])).join('\n');
  const rest = (name, re) => log(name).filter((l) => re.test(l)).map(paint).join('\n');
  const z4 = (name) => log(name).filter((l) => /^\[Z4-v2\] warm/.test(l)).map((l) => mark(paint(l), [[/(400 runtime_broker_invalid_request)/, 'ok'], [/(503 runtime_scope_resolution_failed)/, 'warn']])).join('\n');
  const body = `<h2>Previous head ${PREV} · boot v2 · twelve Sessions released one after another; then the rig asks the worker about each</h2><pre>${z1('s21-r7-h7-Z1-v2.log')}</pre>
  <h2>This head ${HEAD} · the same</h2><pre>${z1('s21-r7-h13-Z1-v2.log')}\n${rest('s21-r7-h13-Z1-v2.log', /^\[Z1-v2\] (through the Broker|a new Session)/)}</pre>
  <h2>This head: a live Session while others are retired, and Sessions in parallel (boot v1)</h2><pre>${rest('s21-r7-h13-Z1Z2Z3-v1.log', /^\[Z[23]-v1\]/)}</pre>
  <h2>warm with a Harness Session id outside the allow-list · previous head ${PREV}</h2><pre>${z4('s21-r7-h7-Z4.log')}</pre>
  <h2>The same · this head ${HEAD}</h2><pre>${z4('s21-r7-h13-Z4.log')}</pre>
  <h2>This head: the checks of the probes</h2><pre>${[...checks('s21-r7-h13-Z1-v2.log'), ...checks('s21-r7-h13-Z1Z2Z3-v1.log'), ...checks('s21-r7-h13-Z4.log')].join('\n')}</pre>
  <div class="note">The eight Sessions released last answer as before. An older one is a tombstone: status and cancel answer unknown, history and new work are refused, and the Broker still reads its receipt from its own journal. A Session that was acquired first keeps working while twelve others are released and four of them retired, a command that runs meanwhile finishes, and 32 Sessions six at a time all run and release. Boot v2 admits one tool turn per Workspace at a time, so the last two probes run on boot v1.</div>`;
  return page('Released Sessions: eight in full, the rest as tombstones', 'Requests marked as sent by the rig go to the worker directly, with the Broker\'s own headers: the Broker sends nothing to a released Session.', body);
};

cards['r7-04-regression'] = () => {
  const arm = (a, label) => {
    const rows = [
      ['round 1 · reviewer test plan A to D', `s1-contract-${a}-ABCD.log`],
      ['round 1 · faults E, F, H, I', `s2-faults-${a}-EFHI.log`],
      ['round 2 · error envelope P to S', `s11-error-envelope-${a}-PQRS.log`],
      ['round 2 · lost control K, L', `s12-lost-control-${a}-KL.log`],
      ['round 3 · receipts and guards M1, M2, M4, M5', `s13-merge-${a}-M1M2M4M5.log`],
      ['round 4 · refused acquire, forgotten calls U1 to U4', `s15-fix-${a}-U1U1bU2U3U4.log`],
      ['round 5 · large results W1, where the cut lands W1d', `s16-r5-${a}-W1.log`, `s16-r5-${a}-W1d.log`],
      ['round 5 · observation, receipts, refusals W2, W4, W6', `s16-r5-${a}-W2W4W6.log`],
      ['round 6 · byte-exact fitting X1', `s18-r6-${a}-X1.log`],
      ['round 6 · Session ids X2, and every ASCII character', `s18-r6-${a}-X2.log`, `s18-r6-${a}-X2s-v1.log`],
      ['round 6 · content modification X5, large writes X6', `s18-r6-${a}-X5X6.log`],
      ['round 6 · worker lost under a live Broker X4', ...[`s18-r6-${a}-X4-v1.log`, `s18-r6-${a}-X4-v2.log`].filter(has)],
      ['round 7 · released Sessions Z1', `s21-r7-${a}-Z1-v2.log`],
      ['round 7 · Z1 to Z3 on boot v1, warm Z4', `s21-r7-${a}-Z1Z2Z3-v1.log`, `s21-r7-${a}-Z4.log`],
      ['round 7 · the rules of main, lost answers, refused starts Y1 to Y8', `s23-merge-r7-${a}-Y1Y2Y3Y4Y5Y6Y7Y8.log`],
    ];
    return `<span class="dim">${label}</span>\n${rows.filter(([, ...files]) => files.some(has)).map(([title, ...files]) => `${title.padEnd(66)} ${files.map((f) => sum(f)).join('; ')}`).map((l) => mark(esc(l), [[/(\d+\/\d+ checks passed)(?! —)/g, 'ok'], [/(— failed: .*)$/, 'bad']])).join('\n')}`;
  };
  const restart = (name, tag) => log(name).filter((l) => l.startsWith(`[${tag}]`) && /cancel #2|acquire again/.test(l)).map((l) => l.replace(/ \| GET .*$/, '').replace(/ \| Session READY.*$/, '')).map((l) => mark(paint(l), [[/(503 runtime_reconciliation_required retryable=true)/g, 'hl'], [/(answered after 1[12]\d\.\d s with 503 runtime_broker_reconcile_timeout)/, 'warn'], [/(answered after 0\.\d s with 200)/, 'ok'], [/(cancel #3 200 cancelled)/, 'ok']])).slice(0, 2).join('\n');
  const loss = (name) => log(name).filter((l) => /^\[N-v2\] (worker killed|GET, 0 s|start sent again)/.test(l)).map(paint).join('\n');
  const suites = log('suites.log').filter(Boolean).map((l) => mark(esc(l), [[/(, 0 failed)/g, 'ok'], [/(, [1-9]\d* failed)/g, 'bad'], [/(0 Checkstyle violations)/g, 'ok'], [/(\d+ passed \(\d+\))/g, 'ok']]).replace(/^\[([^\]]+)\]/, '<span class="dim">[$1]</span>')).join('\n');
  const model = log('s6-hosted-real-model-h13-p.log').filter((l) => /^\[(T\d|sessions|executions|holders)\]/.test(l)).map(paint).join('\n');
  const body = `<h2>Probes of all rounds</h2><pre>${arm('h13', `this head ${HEAD}`)}\n\n${arm('mn', `main ${MAIN_AFTER}, one commit after the merge`)}\n\n${arm('candmn', `main ${MAIN_AFTER} with candidate B in the Broker`)}</pre>
  <h2>The Broker process is replaced (SIGKILL) · default provisioner, macOS · this head</h2><pre>${restart('s19-restart-h13-v2-KILL.log', 'Y-v2')}</pre>
  <h2>The same on Linux · this head · durable-local-process=true</h2><pre>${restart('s20-linux-restart-h13-durable-v2-KILL.log', 'L-v2')}\n${['durable-v1-KILL', 'durable-v1-TERM', 'durable-v2-KILL', 'durable-v2-TERM'].map((k) => `<span class="dim">${k.replace('durable-', 'boot ').replace('-', ' · SIG').padEnd(18)}</span> ${okSum(`s20-linux-restart-h13-${k}.log`)}`).join('\n')}</pre>
  <h2>The worker is killed while a Shell command runs · macOS, this head</h2><pre>${loss('s22-loss-in-flight-h13-macos-v2.log')}\n${checks('s22-loss-in-flight-h13-macos-v2.log').join('\n')}</pre>
  <h2>The same on Linux · this head, durable provisioner</h2><pre>${loss('s22-loss-in-flight-h13-linux-durable-v2.log')}\n${checks('s22-loss-in-flight-h13-linux-durable-v2.log').join('\n')}</pre>
  <h2>Repository suites</h2><pre>${suites}</pre>
  <h2>Hosted loop with a live model on this head</h2><pre>${model}</pre>
  <div class="note warn">Two groups of earlier probes do not pass on this head nor on main, and both for one reason: a start the worker refuses no longer returns (figure 6). E.2 waits 30 s for it and gets no answer; checks of groups B and C that count requests to the worker find the status requests that start keeps sending. With candidate B in the Broker every probe passes, on the head and on main. The checks F.1, F.2 and S.exec state the rule of ${LOST}: a lost answer settles from what the worker kept. The restart behaves as in round 6: with the default provisioner the 503 repeats, with the durable provisioner the worker is adopted and the cancellation confirmed. A worker that dies under a running command leaves the record UNKNOWN, the call is not started again, and the Broker holds the storage until it knows the old writer stopped. The answer carries no details in either rig, so the terminal ABANDONED answer was not produced on the real stack.</div>`;
  return page('Regression on the head and on main after the merge', 'Same probes, same rig. Every group runs on a fresh database. The trial merge made before the merge, and the head with candidate B, give the results of main and of main with candidate B; their logs are beside this figure.', body);
};

cards['r7-07-mutation'] = () => {
  const superseded = new Set([...superseded6, ...superseded7, ...superseded7b, ...superseded7c, ...superseded7d, ...superseded7e, ...superseded7f]);
  const all = log(path.join('mutation', 'matrix.log'));
  const latest = new Map();
  for (const l of all) {
    const m = l.match(/^(\w+)\s+(KILLED|SURVIVED|INVALID|SKIPPED|SUPERSEDED)\s+(.*?) :: (.*?)(?: :: (.*))?$/);
    if (m) latest.set(m[1], { id: m[1], verdict: m[2], what: m[4], by: m[5] });
  }
  const before = JSON.parse(fs.readFileSync(path.join(SP, 'r6-archive', 'out', 'mutation', 'summary.json'), 'utf8'));
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
    // A test of the Hosted harness can fail for the load alone; the test that names the rule goes first.
    return found.sort((x, y) => Number(x.startsWith('hosted-harness')) - Number(y.startsWith('hosted-harness')));
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
  const order = (id) => ({ L: 0, M: 0.4, P: 0.6, Q: 0.8, R: 0.9, S: 0.95, K: 1, I: 2, H: 3, G: 4, J: 5, T: 6, N: 7 })[id[0]] * 1000 + Number(id.slice(1));
  const isNew = (id) => 'LMPQRS'.includes(id[0]);
  const row = (p) => {
    const cls = p.verdict === 'KILLED' ? 'ok' : p.verdict === 'SURVIVED' ? 'warn' : 'dim';
    const was = isNew(p.id) ? '<span class="dim">new</span>' : previous.has(p.id) ? '<span class="warn">SURVIVED</span>' : '<span class="dim">KILLED</span>';
    return `<tr><td class="dim">${p.id}</td><td>${was}</td><td class="${cls}">${p.verdict}</td><td class="t">${esc(p.what)}</td><td class="dim">${esc(p.killer.length > 96 ? `${p.killer.slice(0, 94)}…` : p.killer)}</td></tr>`;
  };
  const table = (list) => `<table><tr><th style="width:4%">id</th><th style="width:8%">round 6</th><th style="width:9%">this head</th><th style="width:36%">mutation (one edit of a production line)</th><th>first killing test</th></tr>${list.map(row).join('')}</table>`;
  const fresh = parsed.filter((p) => isNew(p.id)).sort((a, b) => order(a.id) - order(b.id));
  const old = parsed.filter((p) => !isNew(p.id));
  const ran = old.filter((p) => p.verdict === 'KILLED' || p.verdict === 'SURVIVED');
  const gone = [...superseded].map((id) => ({ id }));
  const changed = ran.filter((p) => (previous.has(p.id) ? 'SURVIVED' : 'KILLED') !== p.verdict).sort((a, b) => order(a.id) - order(b.id));
  const shown = ran.filter((p) => p.verdict === 'SURVIVED' || changed.includes(p)).sort((a, b) => order(a.id) - order(b.id));
  const count = (list, v) => list.filter((p) => p.verdict === v).length;
  const other = parsed.filter((p) => !['KILLED', 'SURVIVED', 'SUPERSEDED'].includes(p.verdict));
  fs.writeFileSync(path.join(RIG, 'out', 'mutation', 'summary.json'), JSON.stringify({
    total: parsed.length + gone.length, ran: fresh.length + ran.length, killed: count(parsed, 'KILLED'), survived: count(parsed, 'SURVIVED'), superseded: gone.map((p) => p.id), other: other.map((p) => `${p.id}:${p.verdict}`),
    survivors: parsed.filter((p) => p.verdict === 'SURVIVED').map((p) => p.id),
    round7: { total: fresh.length, killed: count(fresh, 'KILLED'), survived: count(fresh, 'SURVIVED'), survivors: fresh.filter((p) => p.verdict === 'SURVIVED').map((p) => p.id) },
    earlier: { total: ran.length, killed: count(ran, 'KILLED'), survived: count(ran, 'SURVIVED'), survivors: ran.filter((p) => p.verdict === 'SURVIVED').map((p) => p.id), changedVerdict: changed.map((p) => `${p.id}:${p.verdict}`) },
  }));
  const body = `<h2>${fresh.length} new mutants: L of the lines ${FIX} adds, M of the lines the merge wrote by hand, P of ${RULES}, Q of ${LOST}, R of ${FIT}, S of ${HEAD}</h2>${table(fresh)}
  <h2>The ${ran.length} earlier mutants that still have a line to edit, rerun on this head: survivors and changed verdicts</h2>${table(shown)}
  <div class="note">New mutants: ${count(fresh, 'KILLED')} of ${fresh.length} killed. Earlier mutants: ${count(ran, 'KILLED')} of ${ran.length} killed, ${count(ran, 'SURVIVED')} survive; ${changed.length === 0 ? 'no verdict changed' : `verdicts that changed: ${changed.map((p) => `${p.id} is now ${p.verdict.toLowerCase()}`).join(', ')}`}. ${gone.length} earlier mutants (${gone.map((p) => p.id).join(', ')}) edited lines that no longer exist. Failures of hosted-harness-session.test.ts are not counted as kills.</div>`;
  return page('Mutation matrix on this head', 'Suites: runtime-broker unit, managed-agent-server unit, cli serve managed/broker/hosted, core managed-tool. L, M, P, Q, R, S = this round, K = round 6, I = round 5, H = round 4, G = the merge of round 3, J = Java, T = TypeScript, N = round 2.', body);
};

const HEADLOG = 's23-merge-r7-h13-Y1Y2Y3Y4Y5Y6Y7Y8.log';
const yGroup = (name, tag, keep, rules) => log(name).filter((l) => l.startsWith('[' + tag + ']') && keep.test(l))
  .map((l) => l.replace(' | reserve 200', '').replace(/ \| file bytes: <no file>/, '').replace(/ "Runtime Session has an active operation"/, '').replace('Managed Runtime Broker returned HTTP 400. ', '').replace(/ \| cancel again, answer untouched: .*$/, '').replace(/ \| record [A-Z]+\/[a-z-]+(?= *$)/, ''))
  .map((l) => mark(paint(l), rules)).join('\n');
const GOOD = [[/(start 400 runtime_payload_invalid)/, 'ok'], [/(prepare 400 [a-z_]+)/, 'ok'], [/(requests to the worker: 0)/, 'ok'], [/(release afterwards 200)/, 'ok'], [/(the caller 400 managed_runtime_attestation_invalid)/, 'ok'], [/(pwd printed nothing)/, 'ok']];
const BAD = [[/(start 200)/, 'warn'], [/(prepare 200)/, 'warn'], [/(requests to the worker: 1)/, 'warn'], [/(data-\?\.txt)/, 'warn'], [/(a\?b)/g, 'warn'], [/(k\?)/, 'warn'], [/(the caller 200 cancelled)/, 'warn'], [/(pwd printed &quot;&lt;roots&gt;\/[a-z]\/child(?:\/y4-link)?&quot;)/, 'warn']];
const byBuild = (rows) => rows.filter(([name]) => has(name)).map(([name, label]) => `<span class="dim">${label.padEnd(62)}</span> ${okSum(name)}`).join('\n');

cards['r7-05-merge'] = () => {
  const diff = log('remerge-a4849e2938.diff');
  const at = diff.findIndex((l) => l.startsWith('diff --git') && l.includes('RuntimeBrokerService.java'));
  const written = diff.slice(at).filter((l) => /^\+(?!\+\+)/.test(l)).map((l) => esc(l)).map((l) => l.replace(/(isWellFormedJson\([a-zA-Z]+\))/, '<span class="hl">$1</span>')).join('\n');
  const y1 = (name, rules) => yGroup(name, 'Y1', /raw path|release afterwards|the caller cancels/, rules);
  const y2 = (name, rules) => {
    const lines = log(name);
    const i = lines.findIndex((l) => l.startsWith('[Y2] provider path, an unpaired surrogate in a Shell command'));
    const block = [lines[i]];
    for (let j = i + 1; j < lines.length && lines[j].startsWith('[Y2]   '); j++) block.push(lines[j]);
    return block.map((l) => l.replace('Managed Runtime Broker returned HTTP 400. ', '')).map((l) => mark(paint(l), rules)).join('\n');
  };
  const y4 = (name, rules) => [yGroup(name, 'Y4', /provider path/, rules), yGroup(name, 'Y4', /raw path/, [[/(record SETTLED\/error)/, 'ok'], [/(pwd printed nothing)/, 'ok']])].join('\n');
  const y5 = (name, rules) => yGroup(name, 'Y5', /lastSeq written as/, rules);
  const gate = facts('fault-gate-repeat.log', 'gate').map((l) => mark(l, [[/(10 of 10 pass)/g, 'ok'], [/(\d+ of 10 fail)/g, 'warn']])).join('\n');
  const asserts = facts('fault-gate-repeat.log', 'assertion').join('\n');
  const body = `<h2>What the merge wrote by hand in RuntimeBrokerService.java (git show --remerge-diff a4849e2938)</h2><pre>${written}</pre>
  <h2>Y1 · raw path, a deferred payload with an unpaired surrogate · ${FIX}, before the merge</h2><pre>${y1('s23-merge-r7-h8-Y1Y2Y3.log', BAD)}</pre>
  <h2>Y1 · the same on this head ${HEAD}; main ${MAIN} answers the same</h2><pre>${y1(HEADLOG, GOOD)}</pre>
  <h2>Y2 · provider path, prepare of a Shell command with an unpaired surrogate · ${MERGED}, the merge</h2><pre>${y2('s23-merge-r7-h9-Y1Y2Y3Y4Y5.log', BAD)}</pre>
  <h2>Y2 · the same on this head</h2><pre>${y2(HEADLOG, GOOD)}</pre>
  <h2>Y4 · a Shell call with a directory outside the Session's workspace · ${MERGED}, the merge</h2><pre>${y4('s23-merge-r7-h9-Y1Y2Y3Y4Y5.log', BAD)}</pre>
  <h2>Y4 · the same on this head</h2><pre>${y4(HEADLOG, GOOD)}</pre>
  <h2>Y5 · the worker writes a status cursor in a form that is not an exact integer · ${MERGED}, the merge</h2><pre>${y5('s23-merge-r7-h9-Y1Y2Y3Y4Y5.log', BAD)}</pre>
  <h2>Y5 · the same on this head</h2><pre>${y5(HEADLOG, GOOD)}</pre>
  <h2>One fault gate that main brought: DurableLocalRuntimeFaultGateTest, the class run by itself and repeated on a loaded host</h2><pre>${gate}\n${asserts}</pre>
  <div class="note">The merge is right where it was written by hand: on the raw path this head refuses what main refuses, and nothing is sent. The provider path is this branch's own, and main's rules did not reach it by merging. On the merge commit a Shell command with an unpaired surrogate ran with a question mark in its place and listed two files the caller never named, a Shell call ran in the directory of another storage, and a cursor written as 65540S was read as a number. ${RULES} closes all three. The fault gate fails under load on every build that has it, main included, in the same two assertions; it is not this PR's.</div>`;
  return page('The merge with main, and the rules main had meanwhile', 'main gave the raw path three rules while this branch was in review. What merging brought, and what ' + RULES + ' adds for the provider path.', body);
};

cards['r7-06-lost-answers'] = () => {
  const y = (name, tag, rules) => log(name).filter((l) => l.startsWith('[' + tag + ']') && !/OBSERVED/.test(l)).map((l) => l.replace(/ "Runtime execution outcome is unknown\."/g, '').replace(/refused status=409 code=runtime_session_busy Runtime Session has an active operation/, '409 runtime_session_busy').replace(/refused status=409 code=runtime_broker_execution_unknown Runtime execution outcome is unknown\./, '409 runtime_broker_execution_unknown')).map((l) => mark(paint(l), rules)).join('\n');
  const good = [[/(200 settled\/success)/g, 'ok'], [/(record SETTLED\/success)/g, 'ok'], [/(release: ok)/, 'ok'], [/(start: error)/, 'ok'], [/(pwd -P printed nothing)/, 'ok'], [/(409 runtime_broker_execution_unknown after 0\.\d s)/, 'ok'], [/(status 0)/, 'ok'], [/(no answer after [\d.]+ s, still waiting)/, 'bad'], [/(status \d{2,})/, 'bad'], [/(200 prepared)/g, 'warn']];
  const old = [[/(409 runtime_broker_execution_unknown)/g, 'warn'], [/(record UNKNOWN\/-)/g, 'warn'], [/(storage held=true)/, 'warn'], [/(start: success)/, 'warn'], [/(pwd -P printed &quot;&lt;roots&gt;\/[a-z]\/child&quot;)/, 'warn']];
  const before = 's23-merge-r7-h10-Y1Y2Y3Y4Y5Y6Y7Y8.log';
  const cand = 's23-merge-r7-cand13-Y1Y2Y3Y4Y5Y6Y7Y8.log';
  const art = (name) => log(name).filter((l) => l.startsWith('[A]')).map((l) => mark(paint(l), [[/(fits=false)/, 'warn'], [/(for the model: replaced by the stub)/, 'warn'], [/(hook result dropped)/, 'warn'], [/(artifacts dropped)/, 'hl'], [/(for the model: kept whole)/, 'ok'], [/(hook result kept)/, 'ok']])).join('\n');
  const changed = (name) => log(name).filter((l) => /^\[(PASS|FAIL)\] (E-v\d\.2|F-v\d\.[12]|S-v1\.exec|C-v\d\.\d) /.test(l) && (/^\[FAIL\]/.test(l) || /^\[(PASS|FAIL)\] (E-v\d\.2|F-v\d\.[12]|S-v1\.exec) /.test(l))).map((l) => paint(l.replace(/ :: .*$/, (d) => d.slice(0, 120)))).join('\n');
  const body = `<h2>Y6 · the answer to execute is lost · ${RULES}, before ${LOST}</h2><pre>${y(before, 'Y6', old)}</pre>
  <h2>Y6 · the same on this head ${HEAD}</h2><pre>${y(HEADLOG, 'Y6', good)}</pre>
  <h2>Y7 · the directory of a Shell call is a link, moved out of the workspace after prepare · ${RULES}</h2><pre>${y(before, 'Y7', old)}</pre>
  <h2>Y7 · the same on this head</h2><pre>${y(HEADLOG, 'Y7', good)}</pre>
  <h2>Y8 · a start the worker refuses: the call was prepared and reserved, preflight never permitted it · ${RULES}</h2><pre>${y(before, 'Y8', [[/(409 runtime_broker_execution_unknown after 0\.\d s)/, 'ok'], [/(status 0)/, 'ok']])}</pre>
  <h2>Y8 · the same on ${LOST}</h2><pre>${y('s23-merge-r7-h11-Y1Y2Y3Y4Y5Y6Y7Y8.log', 'Y8', [...good, [/(409 runtime_session_busy)/, 'warn'], [/(storage held=true)/, 'warn'], [/(record UNKNOWN\/-)/g, 'warn']])}</pre>
  <h2>Y8 · the same on this head ${HEAD}</h2><pre>${y(HEADLOG, 'Y8', [...good, [/(200 settled\/not_started)/, 'ok'], [/(release 200)/, 'ok']])}</pre>
  <h2>Y8 · main ${MAIN_AFTER}, after the merge</h2><pre>${y('s23-merge-r7-mn-Y1Y2Y3Y4Y5Y6Y7Y8.log', 'Y8', [...good, [/(200 settled\/not_started)/, 'ok'], [/(release 200)/, 'ok']])}</pre>
  <h2>Y8 · main ${MAIN_AFTER} with candidate B in the Broker (one condition)</h2><pre>${y('s23-merge-r7-candmn-Y1Y2Y3Y4Y5Y6Y7Y8.log', 'Y8', [...good, [/(200 settled\/not_started)/, 'ok'], [/(release 200)/, 'ok'], [/(status 1)/, 'ok']])}</pre>
  <h2>The checks of Y1 to Y8, by build</h2><pre>${byBuild([['s23-merge-r7-h8-Y1Y2Y3.log', FIX + ', before the merge (Y1 to Y3)'], ['s23-merge-r7-h9-Y1Y2Y3Y4Y5.log', MERGED + ', the merge (Y1 to Y5)'], [before, RULES + ', before ' + LOST], ['s23-merge-r7-h11-Y1Y2Y3Y4Y5Y6Y7Y8.log', LOST], ['s23-merge-r7-h12-Y1Y2Y3Y4Y5Y6Y7Y8.log', FIT], [HEADLOG, 'this head ' + HEAD], [cand, 'this head with candidate B'], ['s23-merge-r7-tm13-Y1Y2Y3Y4Y5Y6Y7Y8.log', 'trial merge of this head with main ' + MAIN_NOW], ['s23-merge-r7-mn-Y1Y2Y3Y4Y5Y6Y7Y8.log', 'main ' + MAIN_AFTER + ', after the merge'], ['s23-merge-r7-candmn-Y1Y2Y3Y4Y5Y6Y7Y8.log', 'main ' + MAIN_AFTER + ' with candidate B'], ['s23-merge-r7-m9-Y1.log', 'main ' + MAIN + ' (Y1 only, main has no provider)']])}</pre>
  <h2>Earlier probes ${LOST} touches, on this head</h2><pre>${[changed('s2-faults-h13-EFHI.log'), changed('s11-error-envelope-h13-PQRS.log'), changed('s1-contract-h13-ABCD.log')].filter(Boolean).join('\n')}</pre>
  <h2>The same on main with candidate B</h2><pre>${[changed('s2-faults-candmn-EFHI.log'), changed('s11-error-envelope-candmn-PQRS.log')].filter(Boolean).join('\n')}</pre>
  <h2>${FIT} · artifacts in the result fitter, limit 1 MiB · ${LOST}, before it</h2><pre>${art('fit-artifacts-h11.log')}</pre>
  <h2>The same on this head</h2><pre>${art('fit-artifacts-h13.log')}\n${checks('fit-artifacts-h13.log').join('\n')}</pre>
  <div class="note warn">${LOST} does what it says for a lost answer: the call ran once, the Broker asks the worker, and the record settles from the result the worker kept; before, it stayed UNKNOWN and held the Session and its storage. A link moved after prepare no longer takes the call out of the workspace. But the same change answers 200 prepared for a call the worker refused to start. Nothing will ever start that call, and the provider client waits for it without an end, asking the worker about it 17 times a second until the provider is disposed. Before that commit the caller had its answer, 409, in a tenth of a second. One condition in the Broker restores that and keeps the rest. ${HEAD} gives the caller a way out that it did not have: its cancellation now reaches the worker, the record settles as not started, and the Session is released; but the start itself still does not return. ${FIT} does what it says: artifacts that cannot fit are dropped, and what the model gets stays whole.</div>`;
  return page('Lost answers, moved links, a start the worker refuses, and artifacts', 'Each probe on the commit before the change and on the head. Boot v2, provider path, real worker; the proxy between Broker and worker drops one answer in Y6.', body);
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
