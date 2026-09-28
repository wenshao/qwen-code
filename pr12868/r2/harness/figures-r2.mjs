// Round-2 evidence figures for PR #12868. Everything shown is read from the
// run logs in out/; titles and notes are the only hand-written text.
// usage: node figures-r2.mjs [card ids]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const RIG = path.dirname(new URL(import.meta.url).pathname);
const SP = path.dirname(RIG);
const OUT = path.join(SP, 'figures');
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(SP, 'wt-pr', 'package.json'));
const { chromium } = require('playwright');
const HEAD = 'f0f217dfa5';
const PREV = 'f67bde6b41';

const log = (name) => fs.readFileSync(path.join(RIG, 'out', name), 'utf8').split('\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tidy = (s) => s.replace(/\/private\/tmp\/claude-501\/[^ "]*?\/rig\/roots[-a-z0-9]*/g, '<roots>').replace(/\/private\/tmp\/claude-501\/[^ "]*?\/scratchpad/g, '<rig>').replace(/\/private\/tmp\/claude-501\/[^ "]*/g, '<rig>/…');
const strip = (s) => s.replace(/BrokerResponseError:( Managed)?( Runt\w*)?( Broker)?( returne?d?)?( HT\w*)?( \d+\.?)?/g, '').replace(/BrokerRespons\w*/g, '').replace(/refused status=(\d+) code=/g, 'refused $1 ').replace(/\s+/g, ' ');

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
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${esc(`PR #12868 round 2 · head ${HEAD} · previous head ${PREV} · macOS 26 arm64 · Node 22.23.2 · JDK 21.0.12 · MySQL 8.4.7 · Spring server jar + embedded Runtime Broker + bundled workers`)}</div></div>`;

// Parses the three-hop blocks of s11-error-envelope logs.
function hops(name, group) {
  const cases = new Map();
  let current;
  for (const line of log(name)) {
    const head = line.match(new RegExp(`^\\[${group}-v1\\] (${group}\\d+) (.*)$`));
    if (head) {
      current = { id: head[1], title: head[2] };
      cases.set(head[1], current);
      continue;
    }
    const hop = line.match(new RegExp(`^\\[${group}-v1\\]\\s+(worker|Broker|provider) +-> (.*)$`));
    if (hop && current) {
      const m = hop[2].match(/^(\d+|-) (\S+) :: (.*?)(?: \[(\d+) chars\])?$/);
      current[hop[1]] = m ? { status: m[1], code: m[2], reason: m[3], length: m[4] ? Number(m[4]) : m[3].length } : { status: '', code: hop[2], reason: '', length: 0 };
    }
  }
  return cases;
}
const GENERIC = /control request failed|returned HTTP \d+\.$/;
function seen(hop, reasonOf) {
  if (!hop) return '<span class="dim">n/a</span>';
  const generic = GENERIC.test(hop.reason) && !reasonOf;
  const lost = !reasonOf || !hop.reason.includes(reasonOf.slice(0, 24));
  const cls = lost ? 'bad' : 'ok';
  const prefix = hop.reason.match(/^Managed Runtime Broker returned HTTP \d+\. ?/)?.[0] ?? '';
  const text = hop.reason.slice(prefix.length);
  const length = hop.length - prefix.length;
  const shown = text.length > 74 ? `${text.slice(0, 72)}…` : text;
  return `<span class="${cls}">${esc(hop.status)} ${esc(hop.code)}</span><br><span class="dim">${esc(shown) || '(no reason)'}${length > 200 ? ` [${length} chars]` : ''}</span>${generic ? '' : ''}`;
}
const workerCell = (hop) => `${esc(hop.status)} ${esc(hop.code)}<br><span class="dim">${esc(hop.reason.length > 74 ? `${hop.reason.slice(0, 72)}…` : hop.reason)}${hop.length > 200 ? ` [${hop.length} chars]` : ''}</span>`;

const cards = {};

cards['r2-01-error-envelope-ab'] = () => {
  const before = hops('s11-error-envelope-r1-PR.log', 'P');
  const after = hops('s11-error-envelope-pr-PQRS.log', 'P');
  const rows = [...after.values()].map((a) => {
    const b = before.get(a.id);
    const callerBefore = b.provider ?? b.Broker;
    const callerAfter = a.provider ?? a.Broker;
    return `<tr><td class="dim">${a.id}</td><td class="t">${esc(a.title)}</td><td>${workerCell(b.worker)}</td><td>${seen(callerBefore, null)}</td><td>${workerCell(a.worker)}</td><td>${seen(callerAfter, a.worker.reason)}</td></tr>`;
  }).join('');
  const body = `<table style="font-size:12.5px"><tr><th style="width:3%">#</th><th style="width:15%">refused operation</th><th style="width:20%">previous head · worker answers</th><th style="width:20%">previous head · caller sees</th><th style="width:21%">this head · worker answers</th><th>this head · caller sees</th></tr>${rows}</table>
  <div class="note">“Caller sees” is the error raised by the built TypeScript provider (the Broker answer for P10). On the previous head every reason was replaced by a generic sentence and an oversized argument was renamed to <b>attestation_invalid</b>. On this head the code and the reason arrive unchanged for all ten refusals. Tool input problems are now <b>400 managed_runtime_tool_invalid</b>.</div>`;
  return page('F2 fixed: what a refused provider control tells the caller', 'Same probe script on two builds, boot v1, real worker → Spring Broker on MySQL 8.4.7 → built TypeScript provider.', body);
};

cards['r2-02-reason-bound'] = () => {
  const head = hops('s11-error-envelope-pr-PQRS.log', 'R');
  const cand = hops('s11-error-envelope-cand-PRS.log', 'R');
  const rows = [...head.values()].map((h) => {
    const c = cand.get(h.id);
    return `<tr><td class="dim">${h.id}</td><td class="t">${esc(h.title)}</td><td>${h.worker.length} chars</td><td>${seen(h.provider, h.worker.reason)}</td><td>${c.worker.length} chars</td><td>${seen(c.provider, c.worker.reason)}</td></tr>`;
  }).join('');
  const body = `<table><tr><th style="width:3%">#</th><th style="width:25%">invalid input (write_file path or shell command)</th><th style="width:9%">this head · worker reason</th><th style="width:27%">this head · caller sees</th><th style="width:9%">candidate · worker reason</th><th>candidate · caller sees</th></tr>${rows}</table>
  <div class="note warn"><b>Residual of the F2 fix.</b> The Broker forwards a provider error only when the reason is at most 4,096 characters and holds no NUL. Validation messages echo the caller's input, so a long path or a model-written shell script (R10, 5,969 characters) pushes the reason over the bound; the Broker then drops the code together with the text and the caller is back at <b>400 managed_runtime_attestation_invalid</b>. The candidate bounds the reason in the worker (33 changed lines plus a test) and keeps the code in every case.</div>`;
  return page('Reason bound: the code is lost when the reason is too long', 'Boot v1, same stack. “Candidate” = this head plus a worker-side bound on the reason text; Java unchanged.', body);
};

cards['r2-03-tampered-answers'] = () => {
  const lines = log('s11-error-envelope-pr-PQRS.log');
  const rows = lines.filter((l) => /^\[S-v1\] S\d+ /.test(l)).map((l) => {
    const m = l.match(/^\[S-v1\] (S\d+) (.*?)\s+Broker -> (\d+) (\S+) :: (.*)$/);
    const kept = !/control request failed/.test(m[5]);
    return `<tr><td class="dim">${m[1]}</td><td class="t">${esc(m[2])}</td><td class="${kept ? 'ok' : 'warn'}">${m[3]} ${esc(m[4])}</td><td class="dim">${esc(m[5])}</td><td>${kept ? '<span class="ok">forwarded</span>' : '<span class="warn">generic answer</span>'}</td></tr>`;
  }).join('');
  const exec = lines.filter((l) => /S-v1\.exec|what the caller is told/.test(l)).map((l) => esc(strip(tidy(l))).replace(/^\[PASS\]/, '<span class="ok">[PASS]</span>').replace(/^\[FAIL\]/, '<span class="bad">[FAIL]</span>'));
  const body = `<h2>The worker's answer to an invalid prepare is rewritten on the wire before the Broker reads it</h2>
  <table><tr><th style="width:4%">#</th><th style="width:36%">what the rig proxy changed</th><th style="width:26%">Broker answers the caller</th><th style="width:24%">reason in the answer</th><th>verdict</th></tr>${rows}</table>
  <h2>A well-formed refusal substituted for the answer of an execute that really ran</h2><pre>${exec.join('\n')}</pre>
  <div class="note">The production transport forwards a provider error only when status and code match, the body is the closed two-field object, the headers are as expected and the reason is non-empty. Anything else falls back to the generic answer. On <b>execute</b> even a well-formed refusal settles nothing: the record stays UNKNOWN, there is one dispatch and one effect, and the caller is told the outcome is unknown. Diagnostic text never becomes execution evidence.</div>`;
  return page('The Broker only trusts a closed, matching provider error', 'Fault injection on the real Broker → worker hop (JVM HTTP proxy), boot v1, this head.', body);
};

cards['r2-04-regression'] = () => {
  const sum = (name) => (log(name).find((l) => l.startsWith('[SUMMARY]')) ?? '').slice(10);
  const q = log('s11-error-envelope-pr-PQRS.log').filter((l) => /^\[(PASS|FAIL)\] Q-/.test(l)).map((l) => esc(l).replace(/^\[PASS\]/, '<span class="ok">[PASS]</span>').replace(/^\[FAIL\]/, '<span class="bad">[FAIL]</span>'));
  const driver = log('s9-author-driver-mysql-pr.log').filter((l) => /^\[(driver|driver-out|mysql|executions|release order)\]/.test(l)).map((l) => esc(l));
  const model = log('s6-hosted-real-model-pr-o.log').filter((l) => /^\[(T\d|T\d wire|sessions|executions|holders|status)\]/.test(l)).map((l) => esc(tidy(l)).replace(/(turn_complete\(end_turn\)|recoveryBlocked=false)/g, '<span class="ok">$1</span>').replace(/(\/provider\/v1\/control\[release\] -&gt; 200, \/v3\/activation -&gt; 200)/g, '<span class="warn">$1</span>'));
  const suites = (tag) => {
    const dir = path.join(SP, 'logs', `suites-${tag}`);
    const pick = (f, re) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => re.test(l)).pop() ?? '' : '');
    const clean = (l) => l.replace(/^\[(INFO|WARNING)\]\s*/, '').replace(/ -- in .*/, '').trim();
    return [
      ['runtime-broker unit', clean(pick('broker-unit.log', /Tests run: \d+, Failures/))],
      ['runtime-broker fault gates', clean(pick('fault-gates.log', /Tests run: \d+, Failures/))],
      ['runtime-broker MySQL integration', clean(pick('broker-mysql.log', /Tests run: \d+, Failures/))],
      ['managed-agent-server unit + MySQL integration', `${clean(pick('server-mysql.log', /Tests run: 1\d\d, Failures/))} · IT ${clean(pick('server-mysql.log', /Tests run: \d+, Failures/))}`],
      ['Hosted ITs (HostedHarnessMySqlIT on MySQL, HostedWorkspaceToolTurnIT on H2)', clean(pick('hosted-mysql.log', /Tests run: \d+, Failures/))],
      ['core managed-tool*', clean(pick('ts-core.log', /^\s*Tests\s/))],
      ['cli src/serve', clean(pick('ts-serve.log', /^\s*Tests\s/))],
    ];
  };
  const paint = (l) => esc(tidy(l)).replace(/^\[PASS\]/, '<span class="ok">[PASS]</span>').replace(/^\[FAIL\]/, '<span class="bad">[FAIL]</span>').replace(/^(\[[KL]-v[12]\])/, '<span class="dim">$1</span>');
  const lost = log('s12-lost-control-pr-KL.log').filter((l) => /^\[K-v2\] |^\[(PASS|FAIL)\] K-v2/.test(l)).map(paint);
  const agree = log('s12-lost-control-pr-KL.log').filter((l) => /^\[(PASS|FAIL)\] L-|^\[L-v1\] (core|kinds)/.test(l)).map(paint);
  const head = suites('pr');
  const merged = suites('mg');
  const table = `<table><tr><th style="width:40%">repository suite</th><th style="width:30%">this head</th><th>trial merge: current main + this head</th></tr>${head.map(([n, v], i) => `<tr><td class="t">${esc(n)}</td><td>${esc(v) || '<span class="dim">not run</span>'}</td><td>${esc(merged[i][1]) || '<span class="dim">not run</span>'}</td></tr>`).join('')}</table>`;
  const body = `<h2>Round-1 probes rerun on this head</h2><pre>reviewer test plan, sections A–D:  ${esc(sum('s1-contract-pr-ABCD.log'))}
fault injection, sections E–I:     ${esc(sum('s2-faults-pr-EFGHI.log'))}
lost control replies and enumerations, sections K–L (new): ${esc(sum('s12-lost-control-pr-KL.log'))}</pre>
  <h2>After a refusal, the same Session and the same call identity still work</h2><pre>${q.join('\n')}</pre>
  <h2>New in round 2 · the reply to a control is lost, then the same request is sent again (boot v2 shown)</h2><pre>${lost.join('\n')}</pre>
  <h2>New in round 2 · both sides agree on confirm outcomes and operation kinds</h2><pre>${agree.join('\n')}</pre>
  <h2>Hosted Workspace loop: the PR's own driver, unchanged, on MySQL 8.4.7</h2><pre>${driver.join('\n')}</pre>
  <h2>Hosted Workspace loop: live model (qwen3.8-max), three turns</h2><pre>${model.join('\n')}</pre>
  <h2>Repository suites</h2>${table}
  <div class="note">The author did not rerun the Hosted integration for this revision; both Hosted runs above are on this head. The 36 cli failures are in 4 files this PR does not touch and are local to this machine (same files as in round 1).</div>`;
  return page('Nothing else moved: regression on the new head', 'The head now contains a merge of main (#12863, #12864) and the fix commit. The merge commit equals the mechanical merge tree.', body);
};

cards['r2-05-mutation'] = () => {
  const all = fs.readFileSync(path.join(RIG, 'out', 'mutation', 'matrix.log'), 'utf8').split('\n');
  const lines = all.filter((l) => /^[JTN]\d+\s/.test(l));
  const r1 = fs.readFileSync(path.join(SP, 'r1-archive', 'out', 'mutation', 'summary.json'), 'utf8');
  const previous = new Set(JSON.parse(r1).survivors);
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
  const parsed = lines.map((l) => {
    const m = l.match(/^(\w+)\s+(KILLED|SURVIVED|INVALID|SKIPPED)\s+(.*?) :: (.*?)(?: :: (.*))?$/);
    let [, id, verdict, , what, by] = m;
    let list = by ? by.split(' | ') : [];
    if (!id.startsWith('J') && !(id.startsWith('N') && Number(id.slice(1)) <= 10)) {
      list = killers(id);
      verdict = list.length ? 'KILLED' : 'SURVIVED';
    }
    return { id, verdict, what, killer: list[0] ? list[0] + (list.length > 1 ? ` (+${list.length - 1})` : '') : '' };
  });
  const order = (id) => ({ J: 0, T: 1, N: 2 })[id[0]] * 1000 + Number(id.slice(1));
  const row = (p) => {
    const cls = p.verdict === 'KILLED' ? 'ok' : p.verdict === 'SURVIVED' ? 'warn' : 'dim';
    const was = p.id.startsWith('N') ? '<span class="dim">new</span>' : previous.has(p.id) ? '<span class="warn">SURVIVED</span>' : '<span class="dim">KILLED</span>';
    return `<tr><td class="dim">${p.id}</td><td>${was}</td><td class="${cls}">${p.verdict}</td><td class="t">${esc(p.what)}</td><td class="dim">${esc(p.killer.length > 96 ? `${p.killer.slice(0, 94)}…` : p.killer)}</td></tr>`;
  };
  const table = (list) => `<table><tr><th style="width:4%">id</th><th style="width:8%">round 1</th><th style="width:8%">this head</th><th style="width:34%">mutation (one edit of a production line)</th><th>first killing test</th></tr>${list.map(row).join('')}</table>`;
  const changed = parsed.filter((p) => previous.has(p.id)).sort((a, b) => order(a.id) - order(b.id));
  const fresh = parsed.filter((p) => p.id.startsWith('N')).sort((a, b) => order(a.id) - order(b.id));
  const rest = parsed.filter((p) => !previous.has(p.id) && !p.id.startsWith('N'));
  const count = (list, v) => list.filter((p) => p.verdict === v).length;
  fs.writeFileSync(path.join(RIG, 'out', 'mutation', 'summary.json'), JSON.stringify({
    total: parsed.length, killed: count(parsed, 'KILLED'), survived: count(parsed, 'SURVIVED'),
    survivors: parsed.filter((p) => p.verdict === 'SURVIVED').map((p) => p.id),
    round1Survivors: { killed: count(changed, 'KILLED'), survived: count(changed, 'SURVIVED') },
    round2: { total: fresh.length, killed: count(fresh, 'KILLED'), survived: count(fresh, 'SURVIVED') },
    rest: { total: rest.length, killed: count(rest, 'KILLED'), survived: count(rest, 'SURVIVED') },
  }));
  const body = `<h2>The 7 mutants that survived the unit suites in round 1</h2>${table(changed)}
  <h2>${fresh.length} new mutants of the lines the fix commit adds</h2>${table(fresh)}
  <div class="note">Round-1 survivors: ${count(changed, 'KILLED')} of ${changed.length} are now killed by the repository's unit suites. New mutants: ${count(fresh, 'KILLED')} of ${fresh.length} killed, ${count(fresh, 'SURVIVED')} survive. The other ${rest.length} round-1 mutants were rerun on this head: ${count(rest, 'KILLED')} killed, ${count(rest, 'SURVIVED')} survive. Failures in hosted-harness-session.test.ts during full runs under load are not counted as kills.</div>`;
  return page('Mutation matrix on the new head', 'Suites: runtime-broker unit (390), managed-agent-server unit (138), cli serve managed/broker/hosted (2117), core managed-tool (190). J = Java, T = TypeScript, N = new in round 2.', body);
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
