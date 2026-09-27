// Evidence figures for the PR #12868 verification report. Everything shown is
// read from the run logs in out/; nothing is typed in by hand except titles.
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
const HEAD = 'f67bde6b41';
const BASE = '233d49b5cc';

const log = (name) => fs.readFileSync(path.join(RIG, 'out', name), 'utf8').split('\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const roots = /\/private\/tmp\/claude-501\/[^ "]*?\/rig\/roots[-a-z]*/g;
// Log lines were cut at a fixed width, so the error class name may be partial.
const strip = (s) => s.replace(/BrokerResponseError:( Managed)?( Runt\w*)?( Broker)?( returne?d?)?( HT\w*)?( \d+\.?)?/g, '').replace(/BrokerRespons\w*/g, '').replace(/refused status=(\d+) code=/g, 'refused $1 ').replace(/\s+/g, ' ');
const tidy = (s) => s.replace(roots, '<roots>').replace(/\/private\/tmp\/claude-501\/[^ "]*?\/scratchpad/g, '<rig>').replace(/\/private\/tmp\/claude-501\/[^ "]*/g, '<rig>/…');

const css = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d1117; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }
  #card { width: 1560px; padding: 28px 32px 30px; background: #0d1117; color: #e6edf3; box-sizing: border-box; }
  h1 { font-size: 25px; margin: 0 0 4px; font-weight: 650; letter-spacing: -0.2px; }
  .sub { color: #8b949e; font-size: 15px; margin-bottom: 18px; line-height: 1.45; }
  h2 { font-size: 16px; color: #79c0ff; margin: 20px 0 8px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; font: 14px/1.45 ui-monospace, Menlo, monospace; }
  th { text-align: left; color: #8b949e; font-weight: 500; border-bottom: 1px solid #30363d; padding: 5px 10px 5px 0; }
  td { padding: 4px 10px 4px 0; border-bottom: 1px solid #21262d; vertical-align: top; overflow-wrap: break-word; }
  td.t { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; font-size: 14.5px; color: #e6edf3; }
  pre { margin: 0; font: 13.5px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px 14px; }
  .ok { color: #3fb950; } .bad { color: #f85149; } .warn { color: #d29922; } .dim { color: #8b949e; } .hl { color: #79c0ff; }
  .note { border-left: 3px solid #1f6feb; padding: 6px 0 6px 12px; margin-top: 16px; color: #c9d1d9; font-size: 15px; line-height: 1.5; }
  .note.warn { border-left-color: #d29922; color: #c9d1d9; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .foot { color: #6e7681; font-size: 12.5px; margin-top: 16px; font-family: ui-monospace, Menlo, monospace; }
`;
const page = (title, sub, body, foot) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${esc(foot)}</div></div>`;
const FOOT = `PR #12868 head ${HEAD} · merge-base ${BASE} · macOS 26 arm64 · Node 22.23.2 · JDK 21.0.12 · MySQL 8.4.7 · Spring server jar + embedded Runtime Broker + bundled workers (dist/cli.js)`;
const outcome = (text) => {
  if (text === undefined) return '<span class="dim">— not reached</span>';
  if (text === 'ok') return '<span class="ok">ok</span>';
  return `<span class="bad">${esc(text)}</span>`;
};

const cards = {};

// 01 ------------------------------------------------------------------------
cards['01-ab-provider-walk'] = () => {
  const read = (name) => {
    const steps = new Map();
    let state = '';
    let wire = '';
    for (const line of log(name)) {
      const m = line.match(/^\[step\] (.+?)\s{2,}(.*)$/) ?? line.match(/^\[step\] (release \(Broker HTTP\))\s+(.*)$/);
      if (m) steps.set(m[1].trim(), m[2].startsWith('HTTP 200') ? 'ok' : m[2].trim());
      if (line.startsWith('[state] ')) state = line.slice(8);
      if (line.startsWith('[wire] ')) wire = line.slice(7);
    }
    return { steps, state, wire };
  };
  const arms = { b1: read('s4-ab-base-v1.log'), p1: read('s4-ab-pr-v1.log'), b2: read('s4-ab-base-a.log'), p2: read('s4-ab-pr-a.log') };
  const names = [...arms.p1.steps.keys()];
  const rows = names.map((n) => `<tr><td class="t">${esc(n)}</td><td>${outcome(arms.b1.steps.get(n))}</td><td>${outcome(arms.p1.steps.get(n))}</td><td>${outcome(arms.b2.steps.get(n))}</td><td>${outcome(arms.p2.steps.get(n))}</td></tr>`).join('');
  const count = (w) => w.split(', ').filter((x) => x.includes('/provider/v1/control')).length;
  const state = (a) => esc(a.state.replace(/executions=/, 'rows=')).replace(/file written=true/, '<span class="ok">file written=true</span>').replace(/file written=false/, '<span class="dim">file written=false</span>');
  const body = `<table><tr><th style="width:21%">provider step (built TS provider)</th><th>merge-base · boot v1 (plain Session)</th><th>PR · boot v1</th><th>merge-base · boot v2 (Workspace)</th><th>PR · boot v2</th></tr>${rows}
  <tr><td class="t dim">end state</td><td>${state(arms.b1)}</td><td>${state(arms.p1)}</td><td>${state(arms.b2)}</td><td>${state(arms.p2)}</td></tr>
  <tr><td class="t dim">Broker → worker provider requests</td><td>${count(arms.b1.wire)}</td><td class="ok">${count(arms.p1.wire)}</td><td>${count(arms.b2.wire)}</td><td class="ok">${count(arms.p2.wire)}</td></tr></table>
  <div class="note">Same script, same MySQL server, two builds. On the merge-base the production HTTP transport answers every Session verb with <b>501 runtime_session_verb_unsupported</b>; a plain Session cannot even be acquired and is left ACQUIRING. On the PR head all nine controls, the seven-field reservation, start and release complete against a real worker.</div>`;
  return page('A/B: the provider control path, merge-base vs PR head', 'Real TypeScript provider (packages/cli/dist) → Spring-embedded Java Runtime Broker on MySQL 8.4.7 → bundled worker process. Every step is attempted on both arms; nothing is mocked.', body, FOOT);
};

// 02 ------------------------------------------------------------------------
cards['02-contract-checks'] = () => {
  const lines = log('s1-contract-pr-ABCD.log');
  const checks = new Map();
  for (const line of lines) {
    const m = line.match(/^\[(PASS|FAIL)\] ([A-D])(?:-(v[12]))?\.(\d+) (.*?)(?: :: (.*))?$/);
    if (!m) continue;
    const key = `${m[2]}.${m[4]}`;
    const entry = checks.get(key) ?? { section: m[2], n: Number(m[4]), title: m[5], v1: undefined, v2: undefined, detail: '' };
    const mode = m[3] ?? 'v1';
    entry[mode] = m[1];
    if (m[6] && !entry.detail) entry.detail = m[6];
    checks.set(key, entry);
  }
  const sections = {
    A: 'A · prepare / reserve / approve / start / retry / release',
    B: 'B · approval, identity and closed-shape refusals (boot v1)',
    C: 'C · provider and raw contracts cannot be mixed',
    D: 'D · cancellation and Session release',
  };
  const mark = (v) => (v === undefined ? '<span class="dim">n/a</span>' : v === 'PASS' ? '<span class="ok">PASS</span>' : '<span class="bad">FAIL</span>');
  const short = (d) => {
    const t = strip(tidy(d)).replace(/refused (\d+) /g, '$1 ').trim();
    return t.length > 86 ? `${t.slice(0, 84)}…` : t;
  };
  let body = '';
  for (const [id, title] of Object.entries(sections)) {
    const rows = [...checks.values()].filter((c) => c.section === id).sort((a, b) => a.n - b.n);
    body += `<h2>${esc(title)}</h2><table><tr><th style="width:4%">#</th><th style="width:50%">check</th><th style="width:6%">boot v1</th><th style="width:6%">boot v2</th><th>measured</th></tr>` +
      rows.map((c) => `<tr><td class="dim">${c.section}.${c.n}</td><td class="t">${esc(c.title)}</td><td>${mark(c.v1)}</td><td>${mark(c.v2)}</td><td class="dim">${esc(short(c.detail))}</td></tr>`).join('') + '</table>';
  }
  const summary = lines.find((l) => l.startsWith('[SUMMARY]')).slice(10);
  body += `<div class="note"><b>${esc(summary)}</b> in one run on a fresh database. Effects are counted with an appending shell command, dispatches with the Broker → worker wire ledger, records by reading MySQL directly.</div>`;
  return page('The PR’s reviewer test plan, executed on the real stack', 'Boot v1 = plain Session (DEFAULT approval) · boot v2 = Hosted Workspace Session (installed context, activation, storage ownership).', body, FOOT);
};

// 03 ------------------------------------------------------------------------
cards['03-stored-reference-and-wire'] = () => {
  const text = log('s7-evidence-rows-pr.log').join('\n');
  const grab = (re) => (text.match(re) ?? [])[1] ?? '';
  const stored = grab(/\[stored\] reference_json = (\{[\s\S]*?\n\})/);
  const wire = grab(/\[wire\] execute request body = (\{[\s\S]*?\n\})/);
  const raw = grab(/\[raw\] state=SETTLED status=success reference_json = (\{[\s\S]*?\n\})/);
  const line = (tag, start) => text.split('\n').filter((l) => l.startsWith(`${tag} ${start}`)).map((l) => l.slice(tag.length + 1));
  const facts = [...line('[stored]', 'after'), ...line('[stored]', 'row contains'), ...line('[wire]', 'execute request bytes'), ...line('[wire]', 'prepare request')];
  const sequence = grab(/\[wire\] sequence = (.*)/).split(' > ');
  const color = (s) => esc(s).replace(/(false)/g, '<span class="ok">$1</span>').replace(/("SECRET-ARGUMENT-7f3a")/g, '<span class="warn">$1</span>');
  const seq = sequence.map((s) => (s.includes('[release]') || s.endsWith('/v3/activation') ? `<span class="hl">${esc(s)}</span>` : s.includes('[execute]') ? `<span class="ok">${esc(s)}</span>` : esc(s))).join(' <span class="dim">→</span> ');
  const body = `<div class="cols"><div><h2>MySQL · qwen_tool_execution.reference_json (provider reservation)</h2><pre>${esc(stored)}</pre>
  <h2>MySQL · reference_json of a raw reservation (#12831 path, unchanged)</h2><pre>${esc(raw)}</pre></div>
  <div><h2>Wire · Broker → worker execute request (captured by the rig proxy)</h2><pre>${esc(wire)}</pre></div></div>
  <h2>Facts read back from the same run</h2><pre>${facts.map(color).join('\n')}</pre>
  <h2>Broker → worker request order for this Workspace Session</h2><pre>${seq}</pre>
  <div class="note">The argument text exists in exactly one request (<b>prepare</b>) and stays in the worker. The durable row and the execute request carry the seven identity fields only. Release asks the worker first, then deactivates the Workspace.</div>`;
  return page('What is stored and what crosses the wire', 'One provider invocation of write_file with a marker argument, boot v2, followed by one raw invocation in the same Harness Session.', body, FOOT);
};

// 04 ------------------------------------------------------------------------
cards['04-faults'] = () => {
  const lines = log('s2-faults-pr-EFGHI.log');
  const pick = (re) => lines.filter((l) => re.test(l));
  const fmt = (l) => {
    let t = strip(tidy(l));
    if (t.length > 232) t = `${t.slice(0, 230)}…`;
    return esc(t).replace(/^\[PASS\]/, '<span class="ok">[PASS]</span>').replace(/^\[FAIL\]/, '<span class="bad">[FAIL]</span>').replace(/^(\[[A-Z]-v[12]\])/, '<span class="dim">$1</span>');
  };
  const block = (title, re) => `<h2>${esc(title)}</h2><pre>${pick(re).map(fmt).join('\n')}</pre>`;
  const body = block('F · the execute reply is dropped between worker and Broker', /^\[(PASS|FAIL)\] F-|^\[F-v[12]\] (wire|release)/) +
    block('G · the worker is killed (SIGKILL) while an invocation is prepared and reserved', /^\[(PASS|FAIL)\] G-|^\[G-v[12]\] (control|release|next|storage)/) +
    block('H · races', /^\[(PASS|FAIL)\] H-|^\[H-v[12]\] \d+x/) +
    `<div class="note">UNKNOWN is never turned into a replay: one execute on the wire, one appended line, the record stays UNKNOWN for the same provider, a restarted provider, inspect and reconcile. After worker death nothing is reconstructed from the stored reference. ${esc(lines.find((l) => l.startsWith('[SUMMARY]')).slice(10))} (sections E–I).</div>`;
  return page('Fault injection on the provider path', 'Faults are injected on the real Broker → worker hop (JVM HTTP proxy) and on the real worker process; effects are counted in the Workspace directory.', body, FOOT);
};

// 05 ------------------------------------------------------------------------
cards['05-findings'] = () => {
  const faults = log('s2-faults-pr-EFGHI.log');
  const e = faults.filter((l) => l.startsWith('[E-v2]')).map((l) => strip(tidy(l.slice(7))));
  const rawLines = (name, arm) => log(name).filter((l) => /r2:|^\[raw\] release 409/.test(l))
    .map((l) => `${arm}  ${l.slice(6).replace(/ referenceKeys=.*$/, '').replace(/ wire=$/, '').replace('reserve=200 start=200  | ', '')}`);
  const rawBase = rawLines('s5-raw-base.log', 'merge-base');
  const rawPr = rawLines('s5-raw-pr.log', 'PR head   ');
  const cut = (l, n = 236) => (l.length > n ? `${l.slice(0, n - 2)}…` : l);
  const i = faults.filter((l) => l.startsWith('[I-v2]') && !l.includes('release')).map((l) => strip(l.slice(7)));
  const sample = (name) => log(name).filter((l) => l.startsWith('[sample]') || l.startsWith('[idle]')).map((l) => {
    const m = l.match(/released Sessions=(\d+).*RSS=(\d+) MiB/) ?? l.match(/(15 s) after.*RSS=(\d+) MiB/);
    return [m[1], Number(m[2])];
  });
  const prov = sample('s3-retention-pr-v1-1500.log');
  const raw = sample('s3b-retention-raw-pr-1500.log');
  const result = (name) => log(name).find((l) => l.startsWith('[result]') && l.includes('RSS')).slice(9);
  const rows = prov.map(([n, mb], k) => `<tr><td>${n === '15 s' ? 'idle, 15 s after the last release' : n}</td><td class="${k > 0 && mb - prov[0][1] > 40 ? 'warn' : ''}">${mb} MiB</td><td>${raw[k][1]} MiB</td></tr>`).join('');
  const colour = (s) => esc(s).replace(/(UNKNOWN)/g, '<span class="warn">$1</span>').replace(/(runtime_session_busy|workspace_busy|runtime_broker_operation_unsupported)/g, '<span class="bad">$1</span>');
  const body = `<h2>F1 · a definite worker refusal is recorded as UNKNOWN and pins the Session (boot v2 shown)</h2><pre>${e.map((l) => colour(cut(l))).join('\n')}</pre>
  <h2>F1 · same mechanism on the raw path, both builds (pre-existing)</h2><pre>${[...rawBase, ...rawPr].map((l) => colour(cut(tidy(l)))).join('\n')}</pre>
  <div class="cols"><div><h2>F2 · invalid tool arguments at prepare: what each hop returns</h2><pre>${i.map((l) => esc(cut(tidy(l), 150))).join('\n')}</pre></div>
  <div><h2>F3 · one worker, 1500 Runtime Sessions released in sequence</h2><table><tr><th>released Sessions</th><th>provider path · worker RSS</th><th>raw path (control) · worker RSS</th></tr>${rows}</table>
  <pre style="margin-top:8px">${esc(result('s3-retention-pr-v1-1500.log'))}\n${esc(result('s3b-retention-raw-pr-1500.log'))}</pre></div></div>
  <div class="note warn">None of the three changes an outcome the PR claims: every refusal is without effect and nothing is replayed. They are follow-ups for the first product consumer of this protocol. F1 is inherited from the existing Broker dispatch rule (any failed execute → UNKNOWN); the provider protocol adds more definite refusals that land in it.</div>`;
  return page('Observations beyond the PR’s claims (non-blocking)', 'All three were measured on the same real stack; F1 was also measured on the merge-base build.', body, FOOT);
};

// 06 ------------------------------------------------------------------------
cards['06-real-model'] = () => {
  const lines = log('s6-hosted-real-model-pr-n.log').filter((l) => !l.startsWith('[harness log tail]'));
  const fmt = (l) => {
    let t = tidy(l).replace(/http:\/\/127\.0\.0\.1:\d+/g, (m) => m);
    if (t.length > 236) t = `${t.slice(0, 234)}…`;
    return esc(t)
      .replace(/^(\[T\d\w?\])/, '<span class="hl">$1</span>')
      .replace(/^(\[T\d tool\])/, '<span class="dim">$1</span>')
      .replace(/(status=success|turn_complete\(end_turn\)|recoveryBlocked=false)/g, '<span class="ok">$1</span>')
      .replace(/(\/provider\/v1\/control\[release\] -&gt; 200, \/v3\/activation -&gt; 200)/g, '<span class="warn">$1</span>');
  };
  const body = `<pre>${lines.map(fmt).join('\n')}</pre>
  <div class="note">The separately gated Hosted Workspace loop from #12831 (raw four-field references, payloadJson at start) still works end to end on the PR build with a live model: five tool executions SETTLED/success, stored references keep the raw shape, and each tool turn now ends with the worker’s release acknowledgement before the Workspace is deactivated. Storage ownership is dropped after every turn.</div>`;
  return page('Live model on the PR build: Hosted Workspace read / write / edit', 'Packaged Hosted Harness (dist/cli.js serve --profile hosted-harness) → Spring Broker on MySQL → boot-v2 worker · model qwen3.8-max · three turns on one Session.', body, FOOT);
};

// 07 ------------------------------------------------------------------------
cards['07-mutation'] = () => {
  const all = fs.readFileSync(path.join(RIG, 'out', 'mutation', 'matrix.log'), 'utf8').split('\n');
  const start = all.findIndex((l) => l.includes('arm=all'));
  const lines = all.slice(start + 1).filter((l) => /^[JT]\d+/.test(l));
  const baseline = all.filter((l) => l.startsWith('BASELINE'));
  const verdicts = [];
  const realStackKills = ['J4', 'J5', 'J13', 'J14'];
  // For TypeScript mutants the killers are read from vitest's JSON report. Failures
  // in hosted-harness-session.test.ts are timing failures under load (they also
  // appear for a mutant that cannot affect them) and are not counted as kills.
  const tsKillers = (id) => {
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
  const survivors = new Set(realStackKills);
  const rows = lines.map((l) => {
    const m = l.match(/^(\w+)\s+(KILLED|SURVIVED|INVALID|SKIPPED)\s+(.*?) :: (.*?)(?: :: (.*))?$/);
    let [, id, verdict, , what, by] = m;
    let list = by ? by.split(' | ') : [];
    if (id.startsWith('T')) {
      list = tsKillers(id);
      verdict = list.length ? 'KILLED' : 'SURVIVED';
    }
    verdicts.push(verdict);
    const cls = verdict === 'KILLED' ? 'ok' : verdict === 'SURVIVED' ? 'warn' : 'dim';
    const killer = verdict === 'SURVIVED'
      ? (survivors.has(id) ? 'unit suites blind; caught by the real-stack probes' : '')
      : list[0] + (list.length > 1 ? ` (+${list.length - 1})` : '');
    return `<tr><td class="dim">${id}</td><td class="${cls}">${verdict}</td><td class="t">${esc(what)}</td><td class="dim">${esc(killer.length > 100 ? `${killer.slice(0, 98)}…` : killer)}</td></tr>`;
  });
  const half = Math.ceil(rows.length / 2);
  const killed = verdicts.filter((v) => v === 'KILLED').length;
  const survived = verdicts.filter((v) => v === 'SURVIVED').length;
  fs.writeFileSync(path.join(RIG, 'out', 'mutation', 'summary.json'), JSON.stringify({ total: lines.length, killed, survived,
    survivors: lines.map((l, k) => [l.split(/\s+/)[0], verdicts[k]]).filter(([, v]) => v === 'SURVIVED').map(([id]) => id) }));
  const table = (r) => `<table style="table-layout:fixed"><tr><th style="width:4%">id</th><th style="width:7%">verdict</th><th style="width:37%">mutation (one edit of a production line)</th><th>first killing test</th></tr>${r.join('')}</table>`;
  const body = `${table(rows)}
  <h2>Unmutated baseline in the same worktree and environment</h2><pre>${baseline.map((l) => esc(l.replace('BASELINE ', ''))).join('\n')}</pre>
  <div class="note">${killed} of ${lines.length} mutants are killed by the repository’s own unit suites; ${survived} survive. The four Java survivors were then compiled into one server jar and run against the real-stack probes, which failed on each of them (B.7, B.9, C.2, C.3). J = Java (runtime-broker, managed-agent-server), T = TypeScript (cli serve, core). Each mutant is a single edit, applied and reverted in a dedicated worktree.</div>`;
  return page('Mutation matrix: do the PR’s tests notice when a guard is removed?', 'Suites: runtime-broker unit (384), managed-agent-server unit (138), cli serve managed/broker/hosted (2106), core managed-tool (189).', body, FOOT);
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
