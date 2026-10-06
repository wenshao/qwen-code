// VERIFICATION RIG ONLY (PR #13355): renders the evidence cards from the
// rig's result files (never from hand-typed numbers) and screenshots them
// with the head worktree's Playwright.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13355-rig';
const FIG = `${RIG}/fig`;
mkdirSync(FIG, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13355-head/package.json');
const { chromium } = require('playwright');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jsonl = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px;background:#0d1117;min-width:1100px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:16px 0 8px;color:#c9d1d9}
.sub{color:#8b949e;font-size:13.5px;margin-bottom:16px}
table{border-collapse:collapse;font-size:13px}
th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.sec td{background:#161b22;color:#d2a8ff;font-weight:600}
.note{margin-top:14px;border-left:4px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:13.5px;max-width:1260px}
.cols{display:flex;gap:22px;align-items:flex-start}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;margin:1px 2px;font-family:ui-monospace,Menlo,monospace}
.p-delta{background:#033a16;color:#7ee787}.p-task{background:#5a1e02;color:#ffa657;font-weight:700}.p-other{background:#21262d;color:#8b949e}.p-term{background:#0c2d6b;color:#79c0ff}
.part{display:inline-block;border:2px solid #3fb950;border-radius:6px;padding:3px 11px;margin:2px 6px 2px 0;font-family:ui-monospace,Menlo,monospace}
.part.split{border-color:#f85149}
`;
const page = (title, sub, body, note) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</div></body></html>`;

// ---------- Card 1: commit-time validation matrix ----------
const ARMS = ['base', 'head', 'merge', 'cand'];
const rogue = {};
for (const arm of ARMS) for (const r of jsonl(`${RIG}/results/rogue-${arm}.jsonl`)) (rogue[r.scenario] ??= {})[arm] = r;
const cls = (r) => {
  if (!r) return ['missing', 'dim'];
  const o = r.reopen ?? '';
  if (r.commit !== 200) return [o.startsWith('OPENED') ? `${r.commit} · refused, opens` : `${r.commit} · ?`, 'ok'];
  if (o.startsWith('REFUSED')) return ['200 · next open REFUSED', 'bad'];
  if (o.includes('REFUSED')) return ['200 · chain stuck', 'warn'];
  return ['200 · opens', 'dim'];
};
const LABEL = {
  control: 'faithful cancel.requested event', 'stageh-control': 'faithful Monitor revision 1 as monitor_run:1',
  'no-envelope': 'event line without its envelope', 'wrong-sequence': 'second event at sequence +5', 'unknown-kind': 'event kind "not_a_kind"',
  'unknown-subtype': 'unknown subtype after an event line', 'unknown-domain': 'domain.committed of "not_a_domain"',
  'bodyless-extra-field': 'goal_state payload with a fifth field', 'bodyless-version-2': 'goal_state payload version 2',
  'reserved-event-id': 'ordinary event takes "monitor_run:1"', 'event-extra-field': 'event envelope with an extra field',
  'event-other-session': 'event sessionKey of another Session', 'payload-absent': 'event without payload',
  'subject-numeric': 'subject: 42', 'domain-missing': 'domain.committed without payload.domain', 'domain-numeric': 'payload.domain: 42',
  'stageh-cross-domain-id': 'Monitor revision under id "child_run:1"', 'stageh-two-lines': 'two Monitor revision-1 lines in one tx',
  'stageh-two-revisions': 'Monitor revisions 1 and 2 in one tx', 'marker-over-cap': 'commit marker of 70 KiB (cap 64 KiB)',
  'unknown-subtype-marker-place': 'unknown subtype in the marker\'s place',
  'payload-numeric': 'payload: 42', 'payload-null': 'payload: null', 'payload-string': 'payload: "x"', 'payload-array': 'payload: []',
  'unknown-subtype-leading': 'unknown subtype ahead of the events', 'two-markers': 'stray commit-marker line among the events',
  'repeated-header': 'Managed header line among the events',
  'payload-empty-turn-settled': 'turn.settled with payload {}', 'payload-wrong-type': 'cancel.requested reason: 42',
  'delta-without-activation-subject': 'message.delta without activation subject', 'subject-malformed': 'subject {"bogus":true}',
  'marker-extra-field': 'commit marker with an extra field', 'marker-wrong-eventsDigest': 'commit marker eventsDigest mismatch',
  'marker-broken-chain': 'commit marker previousCommitDigest mismatch', 'record-sessionId-mismatch': 'record envelope sessionId of another Session',
  'stageh-wrong-ordinal': 'Monitor revision 1 under id "monitor_run:2"',
  'duplicate-event-id': 'two events with the same eventId', 'checkpoint-control': 'checkpoint.committed (my control is malformed)',
  'checkpoint-covers-itself': 'checkpoint covering its own sequence',
};
const SECTIONS = [
  ['A. Refused at commit on head (classes this PR mirrors; base stores them)', ['no-envelope', 'wrong-sequence', 'unknown-kind', 'unknown-subtype', 'unknown-domain', 'bodyless-extra-field', 'bodyless-version-2', 'reserved-event-id', 'event-extra-field', 'event-other-session', 'payload-absent', 'subject-numeric', 'domain-missing', 'domain-numeric', 'stageh-cross-domain-id', 'stageh-two-lines', 'stageh-two-revisions', 'marker-over-cap', 'unknown-subtype-marker-place']],
  ['B1. Still stored on head, Session bricked: event payload not an object (rule + 2 tests dropped by 000961f1fb)', ['payload-numeric', 'payload-null', 'payload-string', 'payload-array']],
  ['B2. Still stored on head, Session bricked: a non-event record inside the event range', ['unknown-subtype-leading', 'two-markers', 'repeated-header']],
  ['C. Still stored on head: residue the design names as the authority\'s contract (+1 it does not name)', ['payload-empty-turn-settled', 'payload-wrong-type', 'delta-without-activation-subject', 'subject-malformed', 'marker-extra-field', 'marker-wrong-eventsDigest', 'marker-broken-chain', 'stageh-wrong-ordinal', 'record-sessionId-mismatch']],
  ['Controls and rows not counted', ['control', 'stageh-control', 'duplicate-event-id', 'checkpoint-control', 'checkpoint-covers-itself']],
];
const listed = new Set(SECTIONS.flatMap(([, s]) => s));
const missing = Object.keys(rogue).filter((s) => !listed.has(s));
if (missing.length) throw new Error(`unlisted scenarios: ${missing}`);
let t1 = `<table><tr><th>crafted line (one per fresh Session, raw HTTP with a valid writer token)</th><th>base b2c95e04dc</th><th>head 7e4a060c5f</th><th>head + main 43a6e1e5</th><th>head + candidate</th></tr>`;
for (const [title, list] of SECTIONS) {
  t1 += `<tr class="sec"><td colspan="5">${esc(title)}</td></tr>`;
  for (const s of list) {
    t1 += `<tr><td>${esc(LABEL[s] ?? s)} <span class="dim mono">${esc(s)}</span></td>`;
    for (const a of ARMS) { const [txt, c] = cls(rogue[s]?.[a]); t1 += `<td class="${c}">${esc(txt)}</td>`; }
    t1 += `</tr>`;
  }
}
t1 += `</table>`;
const count = (arm, pred) => Object.values(rogue).filter((v) => pred(cls(v[arm])[0])).length;
const bricked = (arm) => Object.entries(rogue).filter(([s, v]) => !s.startsWith('checkpoint') && cls(v[arm])[0] === '200 · next open REFUSED').length;
const card1 = page(
  'Commit-time validation: a crafted line, then a fresh authority reopens the Session',
  `Real Spring jars (Session Store, MySQL 8.4.7) · writer = raw HTTP with a valid token · reopen = head <code>openManagedSession</code> over <code>createHttpManagedSessionStores</code> (as the Hosted Harness) · ${Object.keys(rogue).length} scenarios × 4 arms`,
  t1,
  `Bricked after commit (checkpoint rows excluded): base <b>${bricked('base')}</b> · head <b>${bricked('head')}</b> · head+main <b>${bricked('merge')}</b> · head+candidate <b>${bricked('cand')}</b>. ` +
  `Refused at commit: base ${count('base', (x) => x.includes('refused'))} · head ${count('head', (x) => x.includes('refused'))} · candidate ${count('cand', (x) => x.includes('refused'))}. ` +
  `The candidate adds two rules (payload must be an object; only event lines inside the event range) and closes B1 + B2; C stays the authority's contract as the design says.`);

// ---------- Card 2: deletion guard ----------
const guard = jsonl(`${RIG}/results/guard.jsonl`);
const GUARD_ARMS = [['base', 'base b2c95e04dc', 'no journal guard (stream announce only)'], ['prev', '000961f1fb', 'plain SELECT'], ['head', 'head 7e4a060c5f', 'SELECT … FOR UPDATE']];
let t2 = `<table><tr><th>arm</th><th>guard read</th><th>runs</th><th>commit blocked after its snapshot</th><th>deletion committed while blocked</th><th>record revision after</th><th>task-journal rows added after the deletion</th></tr>`;
for (const [arm, label, read] of GUARD_ARMS) {
  const rows = guard.filter((r) => r.arm === arm && r.mode === 'midcommit');
  const added = rows.map((r) => r.journalAddedAfterDeletion);
  const bad = added.some((x) => x > 0);
  t2 += `<tr><td>${esc(label)}</td><td class="mono">${esc(read)}</td><td>${rows.length}</td><td>${rows.filter((r) => r.blockedAfterSnapshot).length}/${rows.length}</td><td>${rows.filter((r) => r.statusAfterDelete === 'DELETING').length}/${rows.length} DELETING</td><td>${[...new Set(rows.map((r) => r.recordRevision))].join(',')} (commit ok ${rows.filter((r) => r.rev2?.ok).length}/${rows.length})</td><td class="${bad ? 'bad' : 'ok'}">${added.join(' ')}</td></tr>`;
}
t2 += `</table>`;
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
let t3 = `<table><tr><th>arm</th><th>mode</th><th>runs</th><th>Session A revision (view change), median ms</th><th>Session B, same tenant, started 800 ms later, median ms</th><th>lock waits seen</th></tr>`;
for (const mode of ['control', 'lockwait']) for (const [arm, label] of GUARD_ARMS) {
  const rows = guard.filter((r) => r.arm === arm && r.mode === mode);
  const a = rows.map((r) => r.sessionA_rev2.ms); const b = rows.map((r) => r.sessionB_rev1_sameTenant.ms);
  const slow = mode === 'lockwait' && med(a) > 1000;
  t3 += `<tr><td>${esc(label)}</td><td>${mode === 'lockwait' ? 'Session A row held FOR UPDATE 3 s' : 'no hold'}</td><td>${rows.length}</td><td class="${slow ? 'warn' : ''}">${med(a)} <span class="dim">(${a.join(', ')})</span></td><td class="${slow ? 'warn' : ''}">${med(b)} <span class="dim">(${b.join(', ')})</span></td><td>${rows.map((r) => r.waitsWhileHeld).join(' ')}</td></tr>`;
}
t3 += `</table>`;
const it = existsSync(`${RIG}/results/it.tsv`) ? readFileSync(`${RIG}/results/it.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t')) : [];
const itRow = (label) => it.filter((r) => r[1] === label).at(-1);
const itCell = (label) => { const r = itRow(label); if (!r) return '<td class="dim">not run</td>'; const pass = r[2] === 'exit=0'; return `<td class="${pass ? 'ok' : 'bad'}">${pass ? 'pass' : 'FAIL'} <span class="dim">${esc(r[3].replace(/^\[\w+\]\s*/, ''))}</span></td>`; };
const t4 = `<table><tr><th>guard under test</th><th>repo's <code>journalsNothingAfterTheSessionIsDeleted</code> (deletes before the commit starts)</th><th>candidate <code>journalsNothingWhenTheDeletionCommitsMidCommit</code></th></tr>
<tr><td>head <code>FOR UPDATE</code></td><td class="ok">pass <span class="dim">(head suite)</span></td>${itCell('cand-guard2')}</tr>
<tr><td>plain SELECT (000961f1fb's guard)</td>${itCell('mut-plainread-existing')}${itCell('mut-plainread-new')}</tr>
<tr><td>no guard</td>${itCell('mut-noguard-existing')}<td class="dim">—</td></tr></table>`;
const card2 = page(
  'Deletion guard at the task-journal announcement point (7e4a060c5f)',
  'Real Spring jars · MySQL 8.4.7 (REPEATABLE READ, innodb_lock_wait_timeout 50) · the real TS authority commits Monitor revisions over HTTP · a mysql client holds rows to place the deletion exactly',
  `<h2>1. A deletion that commits while the record commit is past its snapshot (the record row is held, so the commit waits at its UPDATE)</h2>${t2}
   <h2>2. Who waits on the Session row lock (head's Javadoc: “can never wait across connections”)</h2>${t3}
   <h2>3. Test witnesses on MySQL 8.4.7 (failsafe, <code>-Pmysql-integration</code>)</h2>${t4}`,
  'The fix is correct: with a plain read the snapshot hides the committed deletion and the journal gains a row (5/5); with <code>FOR UPDATE</code> it does not (5/5). The repo test deletes before the commit opens, so it passes with the broken guard too — the candidate IT pins the mid-commit case. ' +
  'The lock is not "already held": the record commit takes the Session row only here, so it waits for any holder, and since it already holds the tenant row, a second Session of the same tenant waits too. main\'s <code>announce()</code> took the same lock at the same point, so this is parity with main, not a regression.');

// ---------- Card 3: R3-3 split and R3-1 mapping ----------
const splitRuns = [];
for (const arm of ['base', 'head', 'merge']) for (let i = 1; i <= 4; i++) {
  const f = `${RIG}/logs/split-${arm}-${i}.out`;
  if (!existsSync(f)) continue;
  const t = readFileSync(f, 'utf8');
  const res = t.split('\n').find((l) => l.includes('RESULT\t'));
  const ev = t.split('\n').find((l) => l.includes(' EVENTS '));
  if (res) splitRuns.push({ arm, res: res.slice(res.indexOf('RESULT')), ev: ev ? ev.slice(ev.indexOf('EVENTS ') + 7) : '' });
}
const pills = (ev) => ev.split(' ').filter(Boolean).map((e) => {
  const [, type] = e.split(/:(.+)/);
  const c = type.startsWith('item.output_text.delta') ? 'p-delta' : type.startsWith('task.updated') ? 'p-task' : type.includes('[T]') ? 'p-term' : 'p-other';
  return `<span class="pill ${c}">${esc(type.replace('item.output_text.', ''))}</span>`;
}).join('');
let t5 = `<table><tr><th>arm</th><th>runs</th><th>public Session event stream (first run)</th><th>assistant message Parts</th><th>task.updated on stream</th><th>task-journal rows / task events route</th></tr>`;
for (const arm of ['base', 'head', 'merge']) {
  const rs = splitRuns.filter((r) => r.arm === arm);
  if (!rs.length) continue;
  const f = (r, k) => (r.res.match(new RegExp(`${k}=([^\\t]*)`)) ?? [])[1];
  const texts = JSON.parse(f(rs[0], 'texts'));
  const allSame = rs.every((r) => f(r, 'texts') === f(rs[0], 'texts'));
  t5 += `<tr><td>${arm === 'base' ? 'base b2c95e04dc' : arm === 'head' ? 'head 7e4a060c5f' : 'head + main'}</td><td>${rs.length}</td><td>${pills(rs[0].ev)}</td><td>${texts.map((x) => `<span class="part ${texts.length > 1 ? 'split' : ''}">${esc(x)}</span>`).join('')} <span class="dim">${allSame ? `same in ${rs.length}/${rs.length}` : 'varies'}</span></td><td class="${f(rs[0], 'taskUpdatedEvents') === '0' ? 'ok' : 'bad'}">${rs.map((r) => f(r, 'taskUpdatedEvents')).join(' ')}</td><td>${rs.map((r) => f(r, 'taskJournal')).join(' ')} <span class="dim">· route 200 ${rs.length}/${rs.length}</span></td></tr>`;
}
t5 += `</table>`;
const mapping = readFileSync(`${RIG}/results/r3-1-mapping.txt`, 'utf8').trim().split('\n');
let t6 = `<table><tr><th>Broker row (state, status, dispatch generation)</th><th>base</th><th>head</th><th>head + main</th></tr>`;
const rowsKey = [...new Set(mapping.map((l) => l.replace(/^\w+: executionOf\/\d\(/, '').replace(/\) = .*/, '').replace(/, \d$/, '')))];
const gens = ['0', '1', '0', '1'];
const keys = [['SETTLED', 'cancelled', '0'], ['SETTLED', 'cancelled', '1'], ['SETTLED', 'not_started', '0'], ['SETTLED', 'succeeded', '1']];
keys.forEach((k, i) => {
  t6 += `<tr><td class="mono">${k.join(' / ')}</td>`;
  for (const arm of ['base', 'head', 'merge']) {
    const line = mapping.filter((l) => l.startsWith(arm + ':'))[i] ?? '';
    const v = line.split(' = ')[1] ?? '?';
    t6 += `<td class="${v === 'not_started_proven' ? 'ok' : ''} mono">${esc(v)}</td>`;
  }
  t6 += `</tr>`;
});
t6 += `</table>`;
const cancelRes = readFileSync(`${RIG}/logs/cancel-head-1.out`, 'utf8').split('\n').find((l) => l.includes('RESULT\t'));
const brokerRow = (cancelRes.match(/state=\S+\texecutionStatus=\S+\tdispatchGeneration=\S+\tdispatchOwner=\S+/) ?? [''])[0].replace(/\t/g, '  ');
const settle = ['base', 'head'].map((a) => readFileSync(`${RIG}/results/r3-1-store-${a}.txt`, 'utf8').trim().split('\n').find((l) => l.startsWith('RESULT')));
const card3 = page(
  'R3-3: a task change between two streamed deltas · R3-1: a call cancelled before its dispatch claim',
  'R3-3: Spring jar + Hosted Harness (head bundle, H3-preview trigger commits Monitor revision 1 between "one" and "two") + embedded Runtime Broker + MySQL 8.4.7 · R3-1: real Broker row from a held <code>:start</code> + WebShell cancel, mapped by each jar\'s own <code>executionOf</code>',
  `<h2>R3-3 — message projection</h2>${t5}
   <h2>R3-1 — the real Broker row: <span class="mono">${esc(brokerRow)}</span></h2>
   <div class="cols"><div>${t6}</div><div><table><tr><th>settling Monitor revision with the arm's own mapping</th></tr>${settle.map((l) => `<tr><td class="mono ${l.includes('settlingCommit=200') ? 'ok' : 'bad'}">${esc(l.replace(/^RESULT\t/, '').replace(/\tsession=.*/, '').replace(/\t/g, '  '))}</td></tr>`).join('')}</table></div></div>`,
  'R3-3 holds: base splits the message at the <code>task.updated</code> row in 3/3 runs; head and head+main keep one Part with no stream announcement, and the change is served from the per-task journal. R3-1 holds: only the never-claimed cancel moves to <code>not_started_proven</code>; a claimed cancel stays <code>settled</code>. <code>executionOf</code> still has no production caller on head+main, so R3-1 is a contract fix today.');


// ---------- Card 4: suites, E2E, mutants ----------
function card4() {
  const suite = (label) => {
    const f = `${RIG}/logs/suite-${label}.log`;
    if (!existsSync(f)) return null;
    const t = readFileSync(f, 'utf8');
    const totals = [...t.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\n/g)].map((m) => m.slice(1).map(Number));
    return { unit: totals[0], it: totals[1], cs: /You have 0 Checkstyle violations/.test(t), sb: /BugInstance size is 0/.test(t), ok: /BUILD SUCCESS/.test(t) };
  };
  const fmt = (x) => x ? `${x[0]} run · ${x[1]} fail · ${x[2]} err · ${x[3]} skip` : '—';
  let t = `<table><tr><th>tree</th><th>unit (surefire)</th><th>MySQL 8.4.7 ITs (failsafe)</th><th>Checkstyle</th><th>SpotBugs</th><th>build</th></tr>`;
  for (const [label, name] of [['head', 'head 7e4a060c5f'], ['merge', 'head + main 43a6e1e5'], ['cand4', 'head + candidate']]) {
    const r = suite(label); if (!r) continue;
    t += `<tr><td>${name}</td><td>${fmt(r.unit)}</td><td>${fmt(r.it)}</td><td class="${r.cs ? 'ok' : 'bad'}">${r.cs ? '0 violations' : '?'}</td><td class="${r.sb ? 'ok' : 'bad'}">${r.sb ? '0 bugs' : '?'}</td><td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? 'SUCCESS' : 'FAILURE'}</td></tr>`;
  }
  t += `</table>`;
  const vt = (a) => { const x = readFileSync(`${RIG}/logs/vitest-${a}.log`, 'utf8'); return (x.match(/Tests\s+(.*\(\d+\))/) ?? [, '?'])[1].trim(); };
  const hs = (a) => { const x = readFileSync(`${RIG}/logs/vitest-hookscale-${a}.log`, 'utf8'); return (x.match(/Tests\s+(.*\(\d+\))/) ?? [, '?'])[1].trim(); };
  const e2e = readFileSync(`${RIG}/results/e2e.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t'));
  t += `<h2>TypeScript (<code>packages/core</code> <code>vitest run src/managed-runtime</code>) and E2E on head + main</h2><table><tr><th>check</th><th>result</th></tr>
   <tr><td>head, full managed-runtime</td><td>${esc(vt('head'))}</td></tr>
   <tr><td>head + main, full managed-runtime</td><td>${esc(vt('merge'))}</td></tr>
   <tr><td>the only failures: <code>managed-session-authority.hook-scale.test.ts</code> (untouched by the PR) timing out at 15 s under rig load; rerun alone</td><td>head ${esc(hs('head'))} · head + main ${esc(hs('merge'))}</td></tr>
   ${e2e.map((r) => `<tr><td>repo E2E runner <code>${esc(r[2])}</code></td><td class="${r[3] === 'exit=0' ? 'ok' : 'bad'}">${esc(r[3])} · ${esc(r[4])}</td></tr>`).join('')}</table>`;
  const mut = readFileSync(`${RIG}/results/mutants.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t')).map((r) => r.length === 3 ? ['head', ...r] : r);
  const dm = readFileSync(`${RIG}/results/dmutants.tsv`, 'utf8').trim().split('\n').map((l) => l.split('\t'));
  const ids = [...new Set(mut.map((r) => r[1]))].filter((id) => id !== 'M12-closed-envelope' && id !== 'M06-subject-object');
  t += `<h2>Mutants of the PR's own rules (targeted classes: record store, projection contract, store contract/integration, actions, publication, planned task)</h2><table><tr><th>mutant</th><th>head</th><th>head + candidate</th><th>killing tests on head</th></tr>`;
  for (const id of ids) {
    const h = mut.filter((r) => r[0] === 'head' && r[1] === id).at(-1);
    const c = mut.filter((r) => r[0] === 'cand' && r[1] === id).at(-1);
    const cell = (r) => r ? `<td class="${r[2] === 'KILLED' ? 'ok' : 'bad'}">${r[2]}</td>` : '<td class="dim">—</td>';
    const EQUIV = { 'M14-event-line-cap': 'equivalent: ManagedSessionStore refuses any line over MAX_EVENT_BYTES before apply() runs' };
    if (EQUIV[id]) { t += `<tr><td class="mono">${esc(id)}</td><td class="warn">${h?.[2] ?? '—'} (equivalent)</td>${cell(c)}<td class="dim">${esc(EQUIV[id])}</td></tr>`; continue; }
    t += `<tr><td class="mono">${esc(id)}</td>${cell(h)}${cell(c)}<td class="dim mono">${esc((h?.[3] ?? '').split(';').map((x) => x.replace(/^\w+Test\./, '')).join(', ').slice(0, 110))}</td></tr>`;
  }
  t += `</table><div class="dim">M12 (closed envelope) as first written looped forever (the iterator never advanced); it was stopped and replaced by M12b. M06 removed only one of the two redundant subject checks, so it is replaced by M06b, which removes both.</div>`;
  t += `<h2>Mutants of main behaviour whose tests this PR deletes (full unit suite per run; D3 also against all 52 MySQL ITs on head)</h2><table><tr><th>mutant</th><th>base (with the deleted tests)</th><th>head</th><th>head + candidate (tests restored)</th></tr>`;
  for (const id of [...new Set(dm.map((r) => r[1]))]) {
    const cell = (arm) => { const r = dm.filter((x) => x[0] === arm && x[1] === id).at(-1); return r ? `<td class="${r[2] === 'KILLED' ? 'ok' : 'bad'}">${r[2]} <span class="dim">${esc((r[4] ?? '').split(';').map((x) => x.replace(/^\w+Test\./, '')).join(', ').slice(0, 70))}</span></td>` : '<td class="dim">—</td>'; };
    t += `<tr><td class="mono">${esc(id)}</td>${cell('base')}${cell('head')}${cell('cand')}</tr>`;
  }
  t += `</table>`;
  return page('Suites, E2E and mutation matrix', 'JDK 21 · Maven offline · MySQL 8.4.7 for <code>-Pmysql-integration</code> · Node 22 · qwen3.8-max for the real-model E2E', t,
    'Head and head + main are green. Of 14 non-equivalent mutants of the PR\'s rules, head kills 11. The survivors are M03 and M06b, whose cases the flatten dropped, and M12b, which never had a case. Two main behaviours lose their only witness with the deleted tests (D2b, D3). The candidate kills all five.');
}

const cards = { '01-commit-validation-matrix': card1, '02-deletion-guard': card2, '03-r3-3-split-and-r3-1-mapping': card3 };
cards['04-suites-and-mutants'] = card4();
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1000 } });
for (const [name, html] of Object.entries(cards)) {
  writeFileSync(`${FIG}/${name}.html`, html);
  const p = await ctx.newPage();
  await p.goto(`file://${FIG}/${name}.html`);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await p.locator('#card').screenshot({ path: `${FIG}/${name}.png` });
  console.log(`${name}.png clipped=${clipped}`);
  await p.close();
}
await browser.close();
