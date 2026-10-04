// Evidence cards for PR #13359, built from the rig's result.json files and
// screenshotted with the head tree's Playwright. English only (no CJK fonts
// needed); the Chinese text lives in the PR comment's collapsed block.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const S =
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f2664731-3690-4937-833c-9c220ef51e4c/scratchpad';
const OUT = `${S}/figs/out`;
fs.mkdirSync(OUT, { recursive: true });
const R = (n) => JSON.parse(fs.readFileSync(`${S}/runs/${n}/result.json`, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sec = (ms) => (ms / 1000).toFixed(1) + ' s';

function turnFacts(r) {
  const ev = r.events ?? [];
  const turns = [...new Set(ev.map((e) => e.turn).filter(Boolean))];
  const facts = turns.map((t) => {
    const es = ev.filter((e) => e.turn === t);
    const term = es.find((e) => e.terminal);
    return { accepted: es.find((e) => e.type === 'turn.accepted')?.t, started: es.find((e) => e.type === 'turn.started')?.t, term: term && { t: term.t, type: term.type, code: term.data?.code ?? term.data?.error_code } };
  });
  return { facts, model: r.model ?? [], followups: r.followups ?? [], rows: r.rowSamples ?? [] };
}

const CSS = `
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--green:#3fb950;--red:#f85149;--amber:#d29922;--violet:#bc8cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
#card{width:1360px;padding:28px 32px 24px;background:var(--bg)}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 8px;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.sub{color:var(--mut);margin:0 0 16px;font-size:14px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid var(--line);padding:7px 10px;vertical-align:top;text-align:left}
th{background:var(--panel);color:var(--mut);font-weight:600}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.ok{color:var(--green)}.bad{color:var(--red)}.warn{color:var(--amber)}.mut{color:var(--mut)}.blue{color:var(--blue)}
.note{border-left:3px solid var(--amber);padding:8px 12px;margin-top:14px;background:var(--panel);font-size:14px}
.note.ok{border-color:var(--green)}.note.bad{border-color:var(--red)}
.pill{display:inline-block;padding:1px 7px;border-radius:10px;font-size:12px;font-weight:600}
.p-red{background:#3d1214;color:#ffa198}.p-green{background:#0f2e1a;color:#7ee787}.p-amber{background:#3a2a07;color:#e3b341}.p-blue{background:#0c2d4f;color:#79c0ff}
.foot{color:var(--mut);font-size:12px;margin-top:12px}
`;
const page = (title, sub, body, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}${foot ? `<div class="foot">${foot}</div>` : ''}</div></body></html>`;

// ---------- Figure 1: held stream timeline ----------
function fig1() {
  const lanes = [
    ...['head-held-20s-r1', 'head-held-20s-r2', 'head-held-20s-r3', 'head-held-20s-r4', 'head-held-20s-r5'].map((n, i) => ({ n, label: `head r${i + 1}`, arm: 'head' })),
    ...['base-held-r1', 'base-held-r2'].map((n, i) => ({ n, label: `base r${i + 1}`, arm: 'base' })),
  ];
  const W = 1296, L = 120, Rr = 20, top = 34, laneH = 46, T = 75000;
  const x = (t) => L + (Math.min(t, T) / T) * (W - L - Rr);
  let svg = `<svg width="${W}" height="${top + lanes.length * laneH + 40}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,Helvetica,Arial" font-size="12">`;
  for (let s = 0; s <= 75; s += 5) {
    svg += `<line x1="${x(s * 1000)}" y1="${top - 6}" x2="${x(s * 1000)}" y2="${top + lanes.length * laneH}" stroke="#21262d"/>`;
    svg += `<text x="${x(s * 1000)}" y="${top - 12}" fill="#8b949e" text-anchor="middle">${s}s</text>`;
  }
  const rows = [];
  lanes.forEach((ln, i) => {
    const r = R(ln.n);
    const f = turnFacts(r);
    const y = top + i * laneH + 8;
    const t1 = f.facts[0];
    const startRun = t1?.started ?? 2000;
    // deadline marker = admission + 20 s (prompt observed on the Spring->Harness tap)
    const admit = r.harnessPrompts?.[0]?.t;
    const end1 = t1?.term?.t ?? T;
    const col = t1?.term ? '#f85149' : '#58a6ff';
    svg += `<text x="10" y="${y + 15}" fill="${ln.arm === 'head' ? '#e6edf3' : '#d29922'}" font-weight="600">${ln.label}</text>`;
    svg += `<rect x="${x(startRun)}" y="${y}" width="${Math.max(2, x(end1) - x(startRun))}" height="18" rx="3" fill="${t1?.term ? '#1f3a5f' : '#1f3a5f'}" stroke="#58a6ff"/>`;
    svg += `<text x="${x(startRun) + 6}" y="${y + 13}" fill="#79c0ff">Turn 1 RUNNING</text>`;
    if (t1?.term) {
      svg += `<rect x="${x(end1) - 2}" y="${y - 3}" width="5" height="24" fill="${col}"/>`;
      svg += `<text x="${x(end1) + 8}" y="${y + 13}" fill="#ffa198">FAILED · ${t1.term.code} @ ${sec(end1)}</text>`;
    } else {
      svg += `<text x="${x(T) - 6}" y="${y + 13}" fill="#e3b341" text-anchor="end">still RUNNING · NULL error code</text>`;
    }
    if (ln.arm === 'head' && admit !== undefined) svg += `<line x1="${x(admit + 20000)}" y1="${y - 4}" x2="${x(admit + 20000)}" y2="${y + 22}" stroke="#d29922" stroke-dasharray="3,2"/>`;
    const m = f.model[0];
    if (m) svg += `<line x1="${x(m.arrivedAt)}" y1="${y + 26}" x2="${x(m.closedAt && m.closedAt < T ? m.closedAt : T)}" y2="${y + 26}" stroke="#8b949e" stroke-width="2"/>` + (m.closedAt && m.closedAt < T ? `<circle cx="${x(m.closedAt)}" cy="${y + 26}" r="3" fill="#8b949e"/>` : '');
    const fu = f.followups[0];
    if (fu) {
      const ok = fu.status === 202;
      const t2 = f.facts[1]?.term;
      svg += `<rect x="${x(fu.t) - 2}" y="${y + 20}" width="4" height="12" fill="${ok ? '#3fb950' : '#d29922'}"/>`;
      const label = ok ? `follow-up 202${t2 ? (t2.type === 'turn.completed' ? ' → completed @ ' + sec(t2.t) : ' → re-held by rig model, deadline again @ ' + sec(t2.t)) : ''}` : `follow-up ${fu.status} turn_active`;
      if (ln.arm === 'head') svg += `<text x="${x(fu.t) + 8}" y="${y + 36}" fill="${ok ? '#7ee787' : '#e3b341'}">${label}</text>`;
      else svg += `<text x="${x(fu.t) + 8}" y="${y + 36}" fill="#e3b341">${label}</text>`;
    }
    rows.push({ label: ln.label, t1: t1?.term ? `${t1.term.type} / ${t1.term.code} @ ${sec(t1.term.t)}` : 'none in window', modelClose: m?.closedAt && m.closedAt < T ? sec(m.closedAt) : 'open', fu: fu ? `${fu.status}` : '-', t2: f.facts[1]?.term?.type ?? '-' });
  });
  svg += `</svg>`;
  const legend = `<p class="mut" style="margin:6px 0 0;font-size:13px">Bar = Turn 1 state from the public event stream; thin grey line = the Harness's model HTTP request (dot = connection closed by the Harness); amber dashed tick = admission + 20 s; small bar = follow-up input at ≈35 s. Head r1–r3 follow-ups were admitted but held again by the rig's first fake model (it routed on the oldest marker); r4–r5 ran after the fix and complete.</p>`;
  const body = `<h2>Held model stream — one chunk, then the provider never sends or closes · deadline 20 s</h2>${svg}${legend}
  <div class="note ok"><b>Head 5/5:</b> Turn row <code>RUNNING → FAILED / hosted_turn_deadline_exceeded</code> at 21.6–23.4 s; exactly one terminal <code>turn.failed</code> per Turn; the Harness closes the provider connection at the deadline; the follow-up is 202-admitted. <b>Base 2/2:</b> <code>RUNNING / NULL</code> for the whole 75 s window, zero terminal events, follow-up 409 <code>turn_active</code>, provider connection left open.</div>`;
  return page('PR #13359 · Turn deadline on the packaged managed-agent stack', 'MySQL 26.7 + Spring jar + node dist/cli.js Hosted Harness + fake OpenAI-compatible model · base 2c591ecc08 vs head 426633c706 · same config both arms (--qwen.managed-agent.harness.turn-deadline=20s)', body, 'Times are from Session creation (POST /v1/agents/sessions). Each run: fresh database, fresh Spring + Harness, Workspace-bound Session.');
}

// ---------- Figure 2: shape matrix ----------
function fig2(extra) {
  const row = (shape, base, head, verdict) => `<tr><td>${shape}</td><td>${base}</td><td>${head}</td><td>${verdict}</td></tr>`;
  const body = `<table><tr><th style="width:24%">Stall shape (real stack)</th><th style="width:27%">Base (no deadline)</th><th style="width:31%">Head</th><th>Reading</th></tr>
  ${row('Pure idle: 1 chunk, then held forever (OpenAI-compatible wire)', 'Core 240 s idle guard closes the stream at 245 s, Harness retries → <span class="ok">turn.completed @ 248 s</span>', 'Default 30 m: identical, completed @ 247 s<br>20 s: <span class="bad">FAILED / deadline_exceeded @ 21.6–23.4 s</span> (5/5)', '<span class="pill p-amber">context</span> at defaults this shape is already bounded by the stream guard; the deadline only matters when set below 240 s')}
  ${row('Trickle: a new chunk every 10 s, never ends', `<span class="warn">RUNNING @ 120 s</span>${extra.trickleLong}`, '30 s: <span class="bad">FAILED / deadline_exceeded @ 31.2 s</span>, follow-up 202 → completed', '<span class="pill p-green">bounded earlier</span> idle guard never fires; on base the 900 s lifetime cap ends it (as completed after a retry); the deadline ends it as a classified failure')}
  ${row('Tool call whose Broker <code>:start</code> never answers', '<span class="warn">RUNNING</span>; at 152 s the Harness logs <i>recovery blocked</i>; still RUNNING @ 300 s, follow-up 409', `20 s: <span class="bad">FAILED / deadline_exceeded @ 33.4 s</span> (Broker request's own 30 s timeout first)${extra.broker200}`, '<span class="pill p-amber">partly</span> bounded only if the deadline fires before the 150 s observation window (overshoot ≤ one 30 s Broker request, same as cancel: CANCELLING 10.5 → 35.3 s); at the 30 m default this Turn pins exactly as on base')}
  ${row('Pending approval nobody answers (approval-timeout 90 s)', 'approval-timeout 30 s: action expires, model gets the refusal, <span class="ok">turn.completed @ 33.4 s</span>', '20 s: <span class="bad">FAILED / deadline_exceeded @ 21.8–23.5 s</span>; action state <b class="warn">cancelled</b> (see next figure)', '<span class="pill p-amber">finding</span> Turn classified correctly, approval channel still says cancelled')}
  ${row('Explicit cancel of the held stream', 'turn.cancelled 0.5 s after the request', 'turn.cancelled 0.3 s after the request; CANCELLED / NULL', '<span class="pill p-green">unchanged</span>')}
  ${row('Slow but finishing (8 s) under a 20 s deadline', '—', '<span class="ok">turn.completed @ 10.0 s</span>, no late event through 45 s', '<span class="pill p-green">no false positive</span>')}
  ${row('Harness + Spring restart after a deadline-settled Turn', '—', 'cold load accepts the <code>error / deadline_exceeded</code> record; follow-up completes', '<span class="pill p-green">durable record OK</span> (stale-writer retries identical after a cancel, both arms)')}
  </table>
  <div class="note">The PR description says such a Turn "never settled". On the default OpenAI-compatible wire both stream shapes already end through the core guards — idle at ≈4 min, trickle at ≈15 min — as <code>turn.completed</code> after a Harness retry, not as a failure. At the 30 m default the deadline is therefore the first bound only for shapes outside those guards (unguarded wires, long tool/approval loops); a hung Broker execution pins earlier via recovery-blocked. With a deadline below the guards it is a precise, classified, operator-tunable bound — which is what the 20 s / 30 s rows show.</div>`;
  return page('Which stalls does the Turn deadline actually bound?', 'Same packaged stack; each cell is a separate run with its own database. Deadline set per row via --qwen.managed-agent.harness.turn-deadline.', body, '');
}

// ---------- Figure 3: approval channel ----------
function fig3() {
  const g = (n) => {
    const r = R(n);
    const f = turnFacts(r);
    const after = (r.actionGets ?? []).filter((a) => a.t > 15000).at(-1)?.json?.state ?? r.responds?.[0]?.actionBefore?.state;
    const resp = r.responds?.[0];
    const code = resp ? JSON.parse(resp.body).error?.code : '-';
    const tool = (r.model.at(-1)?.messages ?? []).find((m) => m.role === 'tool')?.content ?? '';
    const toolText = (() => { try { return JSON.parse(tool)[0].text; } catch { return tool; } })();
    const t1 = f.facts[0]?.term;
    return { turn: t1 ? `${t1.type.replace('turn.', '')}${t1.code ? ' / ' + t1.code : ''} @ ${sec(t1.t)}` : 'none', after, late: `${resp?.status} ${code}`, toolText };
  };
  const a = g('head-approval-20s-b'), b = g('head-approval-cancel'), c = g('cand-approval-20s-b');
  const cell = (v, cls) => `<td class="${cls ?? ''}">${esc(v)}</td>`;
  const body = `<table><tr><th style="width:22%"></th><th>Head · deadline 20 s fires while the approval is pending</th><th>Head · user cancels while the approval is pending</th><th>Candidate patch · deadline 20 s</th></tr>
  <tr><td>Turn terminal</td>${cell(a.turn, 'ok')}${cell(b.turn)}${cell(c.turn, 'ok')}</tr>
  <tr><td>Action state after the Turn ends (GET /actions/{id})</td>${cell(a.after, 'bad')}${cell(b.after)}${cell(c.after, 'ok')}</tr>
  <tr><td>Late "allow" (POST /actions/{id}/responses)</td>${cell(a.late, 'bad')}${cell(b.late)}${cell(c.late, 'ok')}</tr>
  <tr><td>Tool result the model sees on the next Turn</td>${cell(a.toolText, 'bad')}${cell(b.toolText)}${cell(c.toolText, 'ok')}</tr></table>
  <div class="note bad">With this PR the Turn row tells deadline and cancel apart, but the approval channel does not: <code>ask()</code> ends the pending action with <code>signal.aborted ? 'cancelled' : 'expired'</code> and <code>approve()</code> fills <code>APPROVAL_REFUSALS.cancelled</code> for any aborted signal. A deadline therefore leaves a durable <b>cancelled</b> action, a 409 <b>action_cancelled</b> for the late answer, and tells the model the turn was cancelled. Measured here with approval-timeout above turn-deadline (a legal config: approval-timeout allows up to 24 h); by construction it is also reachable at defaults (10 m / 30 m) when several approvals in one Turn add up past 30 m.</div>
  <div class="note ok">Candidate (+25 −13 src, +33 test; moves <code>HOSTED_TURN_DEADLINE</code> into <code>hosted-turn-wait.ts</code>): deadline → <code>expired</code> / 409 <code>action_expired</code> / deadline-specific refusal; explicit cancel unchanged (column 2 also re-run on the candidate: cancelled / 409 action_cancelled).</div>`;
  return page('Deadline during a pending approval: the action still says "cancelled"', 'Approval mode default, approval-timeout 90 s, fake model calls write_file; nobody answers. Real stack, same Session API the Web Shell uses.', body, '');
}

// ---------- Figure 4: wire / config / tests ----------
function fig4(mut) {
  const wire = [['head, no property', R('head-ok-default').harnessPrompts?.[0]?.deadlineMs], ['head, QWEN_MANAGED_AGENT_HARNESS_TURN_DEADLINE=45s', R('head-ok-env45s').harnessPrompts?.[0]?.deadlineMs], ['head, turn-deadline=20s', R('head-held-20s-r1').harnessPrompts?.[0]?.deadlineMs], ['base (any config)', R('base-ok-default').harnessPrompts?.[0]?.deadlineMs ?? 'absent']];
  const boots = ['0s', 'neg', '999us', '1ms', '24d', '25d'].map((n) => { const r = R(`head-boot-${n}`); return [n === 'neg' ? '-5s' : n, r.boot.up, r.boot.message]; });
  const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
  <div><h2>deadlineMs on the Spring → Harness POST /session/:id/prompt</h2><table><tr><th>Config</th><th>deadlineMs</th></tr>${wire.map(([k, v]) => `<tr><td>${k}</td><td class="mono">${v}</td></tr>`).join('')}</table>
  <h2>Boot validation (real Spring start)</h2><table><tr><th>turn-deadline</th><th>Result</th></tr>${boots.map(([v, up, m]) => `<tr><td class="mono">${v}</td><td class="${up ? 'ok' : 'bad'}">${up ? 'boots' : 'refused: ' + esc(m ?? '')}</td></tr>`).join('')}</table></div>
  <div><h2>Mutation matrix (PR's own tests)</h2><table><tr><th>Mutant</th><th>Killed by</th></tr>${mut.map(([m, k]) => `<tr><td>${esc(m)}</td><td class="${k.startsWith('SURVIVES') ? 'warn' : 'ok'}">${esc(k)}</td></tr>`).join('')}</table></div></div>`;
  return page('Wire, configuration and test strength', 'Captured with a streaming tap between Spring and the Harness; boot runs start the real jar against a fresh database.', body, '');
}

async function shoot(name, html) {
  fs.writeFileSync(`${OUT}/${name}.html`, html);
  const req = createRequire(`${S}/wt-head/package.json`);
  const { chromium } = req('playwright');
  const browser = await chromium.launch();
  const pageObj = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await pageObj.goto(`file://${OUT}/${name}.html`);
  const clipped = await pageObj.evaluate(() => [...document.querySelectorAll('pre,td,th')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await pageObj.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  await browser.close();
  console.log(name, 'clipped cells:', clipped);
}

const extra = JSON.parse(fs.readFileSync(`${S}/figs/extra.json`, 'utf8'));
const mut = JSON.parse(fs.readFileSync(`${S}/figs/mut.json`, 'utf8'));
const which = process.argv.slice(2);
const all = { '01-held-stream-timeline': () => fig1(), '02-stall-shapes': () => fig2(extra), '03-approval-channel': () => fig3(), '04-wire-config-tests': () => fig4(mut) };
for (const [k, f] of Object.entries(all)) if (!which.length || which.includes(k)) await shoot(k, f());
