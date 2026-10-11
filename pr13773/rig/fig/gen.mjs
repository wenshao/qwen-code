// VERIFICATION RIG ONLY (PR #13773): evidence cards -> PNG via Playwright element screenshots.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/git/qwen-code-pr13773-head/package.json');
const { chromium } = require('playwright');
const RIG = '/Users/wenshao/pr13773-rig';
const load = (db) => JSON.parse(fs.readFileSync(`${RIG}/results/${db}/agent-snaps.json`, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const base = { ...load('b1') };
const b2 = load('b2');
for (const k of ['F1', 'F2']) base[k] = b2[k]; // b1's F1 lost its catalog to a Spring create retry (rig artifact); b2 re-ran F1/F2
const head = load('h2');
const leaseOf = (db) => JSON.parse(fs.readFileSync(`${RIG}/results/${db}/leases-final.json`, 'utf8'));
const LEASE = { base: { ...leaseOf('b1'), F1: leaseOf('b2').F1, F2: leaseOf('b2').F2 }, head: leaseOf('h2'), cand: fs.existsSync(`${RIG}/results/c1/leases-final.json`) ? leaseOf('c1') : {} };
if (!LEASE.base.F1) delete LEASE.base.F1;
const cand = fs.existsSync(`${RIG}/results/c1/agent-snaps.json`) ? load('c1') : null;

const rows = [
  ['F1', 'fresh', 'PostToolUse command', 'bg', 'present hold'],
  ['F2', 'fresh', 'PostToolUse command, enabled:false', 'bg', 'present hold'],
  ['D1', 'detach + restart', 'PostToolUse command', 'bg', 'target'],
  ['D2', 'detach + restart', 'PostToolUse command', 'fg', 'target'],
  ['D3', 'detach + restart', 'PostToolBatch command', 'bg', 'target'],
  ['D4', 'detach + restart', 'PostToolUseFailure command', 'bg', 'target'],
  ['D5', 'detach + restart', 'PostToolUse command, enabled:false', 'bg', 'control'],
  ['D7', 'detach + restart', 'PostToolUse command, onceKey consumed', 'bg', 'control'],
  ['D8', 'detach + restart', 'no catalog', 'fg', 'control'],
  ['D6', 'detach + restart', 'Stop command', 'bg', 'not counted'],
  ['R1', 'restart only', 'PostToolUse command', 'bg', 'target'],
  ['R2', 'restart only', 'PostToolUse command', 'fg', 'target'],
  ['R3', 'restart only', 'no catalog', 'bg', 'control'],
  ['R4', 'restart only', 'PostToolUse command, enabled:false', 'bg', 'not counted'],
  ['R5', 'restart only', 'Stop command', 'bg', 'not counted'],
];

function outcome(s, arm, id) {
  if (!s) return { cls: 'na', html: '—' };
  const held = LEASE[arm]?.[id] ? '<br><span class="lease">lease at end: HELD by a Hook owner</span>' : '<br><span class="lease">lease at end: free</span>';
  const r = outcomeCore(s);
  return { ...r, cls: r.cls === 'ok' && LEASE[arm]?.[id] && /fg/.test(r.html) ? 'warn' : r.cls, html: r.html + held };
}
function outcomeCore(s) {
  const f = s.final;
  const a = f.parentAnswer ?? '';
  const turn = f.childTurns.join(',');
  const parentFailed = f.parentTurns.slice(1).find((t) => t.startsWith('FAILED'));
  if (/unavailable while/.test(a))
    return { cls: 'refused', html: `<b>REFUSED</b> before admission<br>child_run 0 · tasks 0 · relay 0` };
  const mode = /started in the background/.test(a) ? 'admitted (bg)' : /G_DONE kind=CHILD/.test(a) ? 'admitted (fg), answer inline' : parentFailed ? 'admitted (fg)' : 'admitted';
  if (/FAILED/.test(turn) || f.brokerBusy409ForChild > 0)
    return { cls: 'bad', html: `<b>${mode} → child WEDGED</b><br>${f.brokerBusy409ForChild}× 409 workspace_busy<br>child ${esc(turn.replace(' nulls', ''))}${parentFailed ? `<br>parent ${esc(parentFailed)}` : ''}` };
  if (parentFailed)
    return { cls: 'bad', html: `<b>${mode}; child completed</b><br>parent turn ${esc(parentFailed)}<br>(its Stop Hook got 409 workspace_busy)` };
  return { cls: 'ok', html: `<b>${mode} → child COMPLETED</b><br>write_file ok · child Session CLOSED${f.hookRuns.includes('PostToolUse') && mode.includes('fg') ? '<br><i>then PostToolUse took the mount</i>' : ''}` };
}

const css = `
body{margin:0;background:#0d1117;color:#e6edf3;font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
.card{display:inline-block;padding:22px 24px;background:#0d1117}
h1{font-size:19px;margin:0 0 4px} .sub{color:#8b949e;margin:0 0 14px;font-size:12.5px;max-width:1240px}
table{border-collapse:collapse} th,td{border:1px solid #30363d;padding:6px 9px;vertical-align:top;text-align:left}
th{background:#161b22;color:#c9d1d9;font-weight:600} td.k{color:#c9d1d9;white-space:nowrap} td.k code{color:#79c0ff}
td.ok{background:#0f2a1a;color:#aff5b4} td.bad{background:#3d1214;color:#ffc1bd} td.refused{background:#0c2d4f;color:#a5d6ff} td.na{color:#6e7681} td.warn{background:#3b2a05;color:#f2cc60} .lease{opacity:.8;font-size:11.5px}
.tag{display:inline-block;padding:0 6px;border-radius:9px;font-size:11px;margin-left:4px} .t-target{background:#1f6feb33;color:#79c0ff} .t-control{background:#2386363a;color:#7ee787} .t-not{background:#9e6a033a;color:#e3b341} .t-present{background:#8b949e33;color:#c9d1d9}
.note{border-left:3px solid #e3b341;padding:6px 10px;margin-top:14px;color:#c9d1d9;max-width:1240px} .note.g{border-color:#3fb950}
pre{background:#161b22;border:1px solid #30363d;padding:10px 12px;margin:8px 0;white-space:pre-wrap;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e6edf3;max-width:1240px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:1260px} .grid h3{margin:0 0 4px;font-size:14px}
.bad-t{color:#ff7b72} .ok-t{color:#7ee787} .ref-t{color:#79c0ff}
`;
const tagCls = (t) => (t === 'target' ? 't-target' : t === 'control' ? 't-control' : t === 'not counted' ? 't-not' : 't-present');

function matrixCard() {
  const cols = cand ? ['base a7e26add', 'head 47cb7576 (current)', 'candidate: 0a69658a + release on restore'] : ['base a7e26add', 'head 47cb7576 (current)'];
  let h = `<div class="card" id="c1"><h1>Real-stack child admission matrix — base vs head${cand ? ' vs candidate' : ''}</h1>
<p class="sub">Spring managed-agent-server jar + embedded local-process Runtime Broker + MySQL 8.4 Session Store + packaged Hosted Harness (<code>qwen serve --profile hosted-harness</code>), Linux container (aarch64, cgroup v2 delegated so command Hooks really execute), deterministic fake model. Parent calls <code>agent</code>; the child calls <code>write_file</code> (needs the Workspace mount). Spring's ChildResultRelay creates and runs the child Session. Child turn deadline 90 s. Each row is its own Session and Workspace storage.</p>
<table><tr><th>#</th><th>restore precondition</th><th>Hook catalog</th><th>mode</th>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>`;
  for (const [id, pre, cat, mode, kind] of rows) {
    const cells = [outcome(base[id], 'base', id), outcome(head[id], 'head', id), ...(cand ? [outcome(cand[id], 'cand', id)] : [])];
    h += `<tr><td class="k">${id}</td><td class="k">${pre}</td><td class="k">${esc(cat)}<span class="tag ${tagCls(kind)}">${kind}</span></td><td class="k">${mode}</td>${cells.map((c) => `<td class="${c.cls}">${c.html}</td>`).join('')}</tr>`;
  }
  h += `</table>
<div class="note g"><b>The fix holds:</b> every <span class="tag t-target">target</span> row (enabled result command Hook, restored owner) refuses on head with no <code>child_run</code>, task or relay row; on base the background ones wedge for the full 90 s deadline (≈300× 409) and D2/R2 show the foreground path. <span class="tag t-control">control</span> rows complete on every arm, so head does not over-refuse.</div>
<div class="note"><b>Not closed by this PR (pre-existing, same on base):</b> after a plain Harness restart (R4, R5) the previous boot's Hook lease is still held at the Broker while the restored owner reports <code>mountHeld=false</code>, so a catalog head does not count admits a child that then wedges — measured for a disabled command Hook (R4) and a Stop command Hook (R5); the 5-line candidate releases the stale lease on restore and fixes R4. D6/R5 on the candidate: a Stop command Hook (not counted by this PR) fires at the end of the parent turn, takes the Session mount, and the child waits it out (or, D6 on base and head 47cb7576, the child wins and the parent turn fails on its Stop Hook's 409).</div></div>`;
  return h;
}

function lines(db, k) {
  const s = (db === 'b1' ? base : db === 'h1' ? head : cand)[k];
  return s;
}

function detailCard() {
  const b = base.D1.final, h = head.D1.final, r4h = head.R4, r4c = cand?.R4;
  const pa = (s) => esc(JSON.parse(s.parentAnswer)[0].text);
  return `<div class="card" id="c2"><h1>D1 — restored PostToolUse command Hook, background child (the #13709 case)</h1>
<p class="sub">Same input on both arms: setup turn, Session detached (Hook mount released), Harness restarted, Spring reloads the Session (restored Hook owner, no mount), then one <code>agent</code> call with <code>run_in_background: true</code>.</p>
<div class="grid"><div><h3 class="bad-t">base a7e26add — admitted, then wedged</h3><pre>tool result the model saw:
  ${pa(b)}
child_run      ${b.childRuns.join(', ')}
public tasks   ${b.tasks.join(', ')}
relay          ${b.relay.join(', ')}
parent Hooks   ${b.hookRuns.join(', ')}  (PostToolUse ran after admission)
child turn     ${b.childTurns.join(', ').replace(' nulls', '')}
Broker 409 workspace_busy to the child: ${b.brokerBusy409ForChild}
Harness: "turn … waits for the Workspace mount held by another Session."
child file written: ${b.childFile}</pre></div>
<div><h3 class="ref-t">head 47cb7576 — refused before admission</h3><pre>tool result the model saw:
  ${pa(h)}
child_run      ${h.childRuns.length} record(s)
public tasks   ${h.tasks.length} task(s)
relay          ${h.relay.length} row(s)
child Sessions ${h.childSessions.length}
Broker 409 to any child: ${h.brokerBusy409ForChild}</pre></div></div>
<div class="note g">R1-5 as shipped in 47cb7576: the refusal now states the lifetime and an in-turn fallback ("read the work through ordinary tools instead"). <code>agent</code> stays in the declared tool list on later requests of this Session (model log), so a model that ignores the advice can still retry it.</div></div>`;
}

function restartCard() {
  const leasesBefore = (db) => JSON.parse(fs.readFileSync(`${RIG}/results/${db}/agent.json`, 'utf8')).rows.find((r) => r.label.startsWith('leases before')).detail;
  const h = head.R4.final, c = cand?.R4?.final;
  return `<div class="card" id="c3"><h1>R4 — Harness restart leaves the previous boot's Hook lease held; the restored owner reports mountHeld=false</h1>
<p class="sub">Session with a catalog head intentionally admits (one PostToolUse command Hook, <code>enabled:false</code>). Setup turn → Hook owner configures the catalog and acquires the Session-scoped mount → Harness SIGTERM + start → Spring reloads the Session → one background <code>agent</code> call. Same on base (R4 base column) — pre-existing, not introduced here.</p>
<div class="grid"><div><h3 class="bad-t">head 47cb7576</h3><pre>admission     ${esc(JSON.parse(h.parentAnswer)[0].text.slice(0, 60))}…
child_run     ${h.childRuns.join(', ')}
child turn    ${h.childTurns.join(', ').replace(' nulls', '')}
Broker 409 workspace_busy to the child: ${h.brokerBusy409ForChild}
lease holder  hooks-activation-… id that already held it after
              the restart, before Spring reloaded the Session;
              unchanged at the end (restored owner never acquired)</pre></div>
${c ? `<div><h3 class="ok-t">0a69658a + 5-line candidate (release settled earlier owners on restore)</h3><pre>admission     ${esc(JSON.parse(c.parentAnswer)[0].text.slice(0, 60))}…
child_run     ${c.childRuns.join(', ')}
child turn    ${c.childTurns.join(', ').replace(' nulls', '')}
Broker 409 to the child: ${c.brokerBusy409ForChild}
child file written: ${c.childFile}</pre></div>` : ''}</div>
<pre>// candidate, hosted-hook-session.ts ensureReady() restore branch (after the catalog read)
      // A restored owner starts with acquired=false, but the previous
      // activation's Session-scoped mount is still held at the Broker until
      // someone releases it; release settled earlier owners now so neither
      // child admission nor a child's acquire sees a hold nobody reports.
      await this.releaseEarlierOwners();</pre></div>`;
}

function mutantCard() {
  const FLAKY = new Set(['drains a long settled history without rescanning it per occurrence', 'rejects a changed input while the same occurrence is still running']);
  const judge = (r) => { const real = (r.failed ?? []).filter((t) => !FLAKY.has(t)); return { ...r, failed: real, verdict: r.error ? 'error' : real.length ? 'killed' : 'SURVIVED' }; };
  const old = fs.readFileSync(`${RIG}/out/mutants.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.id !== 'BASELINE').map(judge);
  const f2 = `${RIG}/out/mutants-h2-survivors.jsonl`;
  const raw2 = fs.existsSync(f2) ? fs.readFileSync(f2, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  for (const t of raw2.find((r) => r.id === 'BASELINE')?.failed ?? []) FLAKY.add(t); // failures of the unmutated tree in the same load window
  const now = Object.fromEntries(raw2.filter((r) => r.id !== 'BASELINE').map(judge).map((r) => [r.id, r]));
  // At 47cb7576 only M07/M16 can change (the new tests target the matcher breadth and the turn arm). The re-run of
  // M09/M13–M15 under host load 60–105 failed only foreground-admission / timing rows that flake on the unmutated tree;
  // they never reach the mutated clause, so those four stay as measured in the clean 0a69658a run.
  for (const id of Object.keys(now)) if (/^M(09|1[345])-/.test(id)) now[id] = { ...now[id], verdict: 'SURVIVED', failed: [], noisy: now[id].failed.length > 0 };
  const PREFER = { 'M07-getter-skips-matcher-hooks(R1-4)': 'refuses a background child on a result Hook whose matcher cannot match agent', 'M16-turn-arm-drop-fg-guard(R1-6)': 'admits a background agent call while this Turn holds the mount' };
  for (const [id, t] of Object.entries(PREFER)) if (now[id]?.failed?.includes(t)) now[id].failed = [t, ...now[id].failed.filter((x) => x !== t)];
  const final = old.map((r) => now[r.id] ?? r);
  const killed = final.filter((r) => r.verdict === 'killed').length;
  let h = `<div class="card" id="c4"><h1>Mutation check of the PR's tests — ${killed}/${final.length} killed at head 47cb7576</h1>
<p class="sub">Each mutant applied alone to a copy of the head; suites: hosted-workspace-tool-turn.child-agent.test.ts + hosted-hook-session.test.ts. Full matrix at 0a69658a (143 tests); the six survivors re-run at 47cb7576 (145 tests: +matcher row, +background turn-arm row, +"ordinary tools" assertion). Tests that also fail on the unmutated tree in the same load window (host load 45–105; timing tests in hosted-hook-session.test.ts) are not counted as kills.</p><table><tr><th>mutant</th><th>at 0a69658a</th><th>at 47cb7576</th><th>killing test</th></tr>`;
  for (const r of old) {
    const n = now[r.id];
    const fin = n ?? r;
    h += `<tr><td class="k"><code>${esc(r.id)}</code></td><td class="${r.verdict === 'killed' ? 'ok' : 'bad'}">${r.verdict}</td><td class="${n ? (n.verdict === 'killed' ? 'ok' : 'bad') : 'na'}">${n ? (n.noisy ? 'SURVIVED (re-run noisy: only load flakes failed)' : n.verdict) : 'not re-run (tests only added)'}</td><td class="k">${esc((fin.failed?.[0] ?? '').slice(0, 96))}</td></tr>`;
  }
  return h + `</table><div class="note">M09 and M13–M15 mutate clauses that are either in the new settled filter (<code>recovery_blocked</code>) or predate this PR and moved verbatim into <code>isHookEligible</code> (owner session, agentScope, dispatch <code>agent_id</code>).</div></div>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${matrixCard()}<br>${detailCard()}<br>${cand ? restartCard() + '<br>' : ''}${mutantCard()}</body></html>`;
fs.writeFileSync(`${RIG}/fig/cards.html`, html);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1000 } });
await page.goto(`file://${RIG}/fig/cards.html`);
const names = { c1: '01-admission-matrix', c2: '02-d1-base-vs-head', c3: '03-restart-stale-lease', c4: '04-mutants' };
for (const [id, name] of Object.entries(names)) {
  const el = await page.$(`#${id}`);
  if (!el) continue;
  await el.screenshot({ path: `${RIG}/fig/${name}.png` });
  console.log('wrote', name);
}
await browser.close();
