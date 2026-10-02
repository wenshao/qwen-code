// VERIFICATION RIG ONLY (PR #13194): evidence figures from the probe JSON files.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13135-rig';
const require = createRequire('/Users/wenshao/git/qwen-code-pr13194/package.json');
const { chromium } = require('playwright');
const OUT = `${RIG}/p94/fig`;
fs.mkdirSync(OUT, { recursive: true });
const res = (db, name) => JSON.parse(fs.readFileSync(`${RIG}/out/${db}/${name}.json`, 'utf8'));
const W = 1080;
const css = `
  body{margin:0;background:#fcfcfb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#0b0b0b}
  #card{width:${W}px;padding:22px 26px 24px;background:#fcfcfb;border:1px solid #d9d8d4;border-radius:10px}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:13px;color:#52514e;margin:0 0 14px;line-height:1.45}
  h2{font-size:14px;margin:16px 0 6px}
  table{border-collapse:collapse;width:100%;font-size:12.5px;margin:4px 0 10px}
  th,td{border:1px solid #d9d8d4;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#f0efec;color:#52514e;font-weight:600}
  td.num{text-align:right;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  td.mono,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
  pre{background:#f6f5f2;border:1px solid #d9d8d4;border-radius:6px;padding:8px 10px;margin:6px 0;white-space:pre;overflow:hidden}
  .ok{color:#0a7a0a;font-weight:600}.bad{color:#b42727;font-weight:600}.warn{color:#8a5a00;font-weight:600}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#f0efec;padding:1px 4px;border-radius:4px}
  .note{font-size:12.5px;border-left:3px solid #8a5a00;background:#f6f5f2;padding:7px 10px;margin:8px 0;line-height:1.5}
  .note.nbad{border-left-color:#b42727}.note.nok{border-left-color:#0a7a0a}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => (typeof c === 'object' && c !== null ? `<td class="${c.c ?? ''}">${c.t}</td>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</table>`;
const OK = (t) => ({ c: 'ok', t: `✔ ${t}` });
const BAD = (t) => ({ c: 'bad', t: `✘ ${t}` });
const WARN = (t) => ({ c: 'warn', t: `▲ ${t}` });
const cnt = (r) => `${r.pass}/${r.pass + r.fail}`;
const figs = {};

// ---------- figure 1 ----------
const p0 = res('q0', 'p0-base-ws-b0');
const p1p = res('q1', 'p1-public-ws-p1c-fromARCHIVED');
const p1w = res('q1', 'p1-web-ws-p1d-fromCLOSED');
const p2 = res('q1', 'p2-edges-ws-e');
const races = ['p3-race-ws-r-n16', 'p3-race-ws-r32a-n32', 'p3-race-ws-r32b-n32'].map((n) => res('q1', n));
const p4 = res('q1', 'p4-crash-ws-k-p94head');
const p6 = res('q2', 'p6-upgrade-after-ws-up');
const p7 = res('q1', 'p7-reads-ws-rd');
const row = (r, label) => r.rows.find((x) => x.label.startsWith(label))?.detail ?? '';
const dd = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const raceSum = races.reduce((a, r) => ({ pass: a.pass + r.pass, fail: a.fail + r.fail }), { pass: 0, fail: 0 });
figs['01-l1-l2-real-linux'] = page(
  'PR #13194 on a real Linux durable stack: close → archive → unarchive → delete',
  'Linux 6.8 aarch64 container (colima VM): Spring fat jar with the durable local-process Runtime Broker, packaged Hosted Harness (head CLI bundle), real worker processes, deterministic model; MySQL 8.4.7 on the host. main = <code>b3dda468f2</code> (base jar), PR = <code>2486d3dad7</code> (head jar).',
  table(['Scenario', 'main b3dda468f2', 'PR 2486d3dad7'], [
    ['files Session with a real write/edit/read Turn → #13135 reliable close', OK('worker PID gone, binding RELEASED'), OK('same (both surfaces)')],
    ['Archive the CLOSED Session (public / WebShell)', BAD('409 workspace_unavailable'), OK('202, operation already completed; replay on either surface → same op')],
    ['Unarchive (public / WebShell)', BAD('public 409 · WebShell route 404'), OK('200 CLOSED; replay=true on both surfaces; old key after re-archive → ARCHIVED, not unarchived')],
    ['Delete from ARCHIVED (public) / from CLOSED (WebShell)', BAD('409 workspace_unavailable'), OK('202 → completed in ~180 ms; Session/events 404; operations still readable; same-key replay → original op')],
    ['Permanent close fence after L1', '—', OK('Runtime warm 409 after archive and after unarchive (control: ACTIVE neighbour warm 200); close receipt + fence row unchanged')],
    ['Runtime/Harness/model work during L1 + L2 (spies)', '—', OK('0 Spring→Harness requests, 0 model calls, 0 SQL writes to runtime/lease/drain tables for the Session, registrations and workers unchanged')],
    ['Neighbour Session on the same storage', '—', OK('same worker throughout, warm 200 after delete; a new Session runs a file Turn')],
    ['Authorization', '—', OK(`reader 403 · unreadable / other tenant 404 · revoked creator: replay and operation read 404 · reader reusing creator key 403`)],
    ['State and proof', '—', OK('ACTIVE, CLOSING (Harness close held 8 s), DELETING, seeded CLOSED/ARCHIVED without close receipt → 409, nothing persisted')],
    ['Concurrency, 16 and 32 parallel requests over both surfaces', '—', OK(`${cnt(raceSum)} checks: one winner per distinct-key race, one command/operation per same key, one tombstone/event/retirement`)],
    ['kill -9 Spring inside the delete completion transaction', '—', OK('nothing committed; restart with Harness stopped, close support off, mount removed → takeover after 60.4 s, claim generation 2, exactly once')],
    ['Upgrade: Sessions closed by the main binary, then the PR jar', '—', OK('no migration needed (V32); archive/unarchive/delete them; an ACTIVE-under-main Session is closed by the PR and its old worker stops')],
    ['Reads', '—', OK('ARCHIVED: Session/events/items/turns/transcript/lists readable · DELETED: all 404 and unlisted · stored resources and Workspace files retained')],
  ]) +
  `<div class="note">Probe results — before (main) p0 ${cnt(p0)} · p1 public, delete from ARCHIVED ${cnt(p1p)} · p1 WebShell, delete from CLOSED ${cnt(p1w)} · p2 edges ${cnt(p2)} · p3 races ×3 ${cnt(raceSum)} · p4 crash/takeover/no Runtime ${cnt(p4)} · p6 upgrade ${cnt(p6)} · p7 reads ${cnt(p7)}</div>` +
  `<div class="note nok">Every acceptance claim in the PR's Reviewer Test Plan that can be exercised through the API held on the real Linux stack. Delete admission → completed: ${dd(row(p1p, 'delete operation completes')).match(/\d+ ms/)?.[0]} (public) and ${dd(row(p1w, 'delete operation completes')).match(/\d+ ms/)?.[0]} (WebShell).</div>`,
);

// ---------- figure 2 ----------
const mxA = res('q3', 'p5-mixed-observe-ws-mxa-base-durable');
const mxB = res('q3', 'p5-mixed-observe-ws-mxb-base-norun');
const heal = res('q3', 'p5-heal-ws-mxb');
const cand = res('q3', 'p5-heal-ws-mxb-cand');
const n = (r, i) => dd(r.rows[i]?.detail ?? '');
const st = (o) => [{ c: 'mono', t: `${o[0]} / ${o[1]}` }, { c: 'num', t: o[2] }, { c: 'mono', t: o[4] || '—' }];
figs['02-rollout-older-coordinator'] = page(
  'Rolling upgrade: a bound DELETE admitted by the PR, then picked up by an older (main) lifecycle coordinator',
  'Same Linux stack. The PR instance admits DELETE on a CLOSED Session and is killed (kill -9) inside the completion transaction, so the operation stays LEASED; the next instance to start is the main jar. The design asks for a coordinated rollout before admitting L2; this measures what happens if that is not perfect.',
  table(['Older coordinator', 'What it did with the DELETE', 'Outcome'], [
    ['main jar, durable local-process on (Runtime close supported)', `re-ran Runtime close for an already-closed Session: one idempotent <code>INSERT INTO qwen_runtime_harness_drain</code> (fence rows still 1)`, OK('completed after lease expiry (claim gen 2), one tombstone')],
    ['main jar, durable off (no Runtime close support)', 'settle() throws <code>workspace_close_identity_unverified</code> → <code>RECOVERY_BLOCKED / BLOCKED</code>', BAD('Session DELETING')],
    ['…then every instance runs the PR jar (durable on), 180 s', 'PR <code>findDeliverableOperations</code>/<code>claimOperation</code> re-deliver BLOCKED only for CLOSE', BAD('still RECOVERY_BLOCKED; fresh delete/archive/unarchive 409, close 409 session_operation_active')],
    ['…same database, PR jar + 2-line candidate below', 'BLOCKED DELETE whose session_status_before is CLOSED/ARCHIVED is deliverable again; PR settle() skips Runtime for it', OK('completed on the first scan (claim gen 3), one tombstone/retirement')],
  ]) +
  `<pre>- (delivery_state = 'BLOCKED' AND operation_kind = 'CLOSE')
+ (delivery_state = 'BLOCKED' AND (operation_kind = 'CLOSE'
+     OR (operation_kind = 'DELETE' AND session_status_before IN ('CLOSED', 'ARCHIVED'))))
  -- ManagedAgentStore.findDeliverableOperations and claimOperation (2 lines)</pre>` +
  table(['Database state of the DELETE operation', 'state / delivery', 'claim gen', 'error', 'Session', 'when'], [
    ['older coordinator with Runtime close support', ...st(mxA.final), mxA.status, n(mxA, 0).match(/waited=[\d.]+ s/)?.[0] ?? ''],
    ['older coordinator without Runtime close support', ...st(mxB.final), mxB.status, n(mxB, 0).match(/waited=[\d.]+ s/)?.[0] ?? ''],
    ['then PR jar only (unchanged)', ...st(heal.final), n(heal, 0).match(/session=(\w+)/)?.[1] ?? '', n(heal, 0).match(/after \d+ s/)?.[0] ?? ''],
    ['then PR jar + candidate', ...st(cand.final), n(cand, 0).match(/session=(\w+)/)?.[1] ?? '', 'first scan'],
  ]) +
  `<div class="note nbad">Not a blocker under the documented coordinated rollout, but the failure is permanent and upgrading does not heal it. The PR's own coordinator never blocks such a DELETE (it returns before any Runtime call), so the candidate only lets the new binary finish work an old one parked.</div>`,
);

// ---------- figure 3 (filled when mutation results exist) ----------
const mutFile = `${RIG}/p94/mut/results.json`;
if (process.env.FIG3 === '1' && fs.existsSync(mutFile)) {
  const m = JSON.parse(fs.readFileSync(mutFile, 'utf8'));
  const rows = Object.values(m).filter((x) => x.id !== 'BASELINE').map((x) => [x.id, dd(x.what), x.verdict === 'KILLED' ? OK('killed') : x.verdict === 'SURVIVED' ? WARN('survived') : x.verdict, dd((x.failed ?? []).slice(0, 2).map((t) => t.replace('WorkspaceSessionRetentionTest.', 'RetentionTest.').replace('WorkspaceSessionRetentionMySqlIT.', 'RetentionMySqlIT.').replace('WorkspaceSessionCloseTest.', 'CloseTest.').replace('ManagedSessionLifecycleTest.', 'LifecycleTest.')).join(', ') + ((x.failed ?? []).length > 2 ? ` … (+${x.failed.length - 2})` : ''))]);
  const tests = JSON.parse(fs.readFileSync(`${RIG}/p94/tests.json`, 'utf8'));
  figs['03-tests-and-mutation'] = page(
    'Suites and mutation check of the PR\'s new tests',
    'Same macOS host, JDK 21, MySQL 8.4.7. Mutants are single exact-anchor edits to the PR head; each runs the focused unit tests (57) plus WorkspaceSessionRetentionMySqlIT and WorkspaceSessionCloseMySqlIT (19) on real MySQL.',
    table(['Suite', 'PR head 2486d3dad7', 'note'], tests.rows) +
    table(['Mutant', 'Change', 'Result', 'Killed by'], rows) +
    `<div class="note">${tests.note}</div>`,
  );
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: W + 80, height: 900 } });
const pg = await ctx.newPage();
for (const [name, html] of Object.entries(figs)) {
  const file = `${OUT}/${name}.html`;
  fs.writeFileSync(file, html);
  await pg.goto(`file://${file}`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('td,pre')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${name}.png ${clipped ? `(${clipped} clipped!)` : ''}`);
}
await browser.close();
