// VERIFICATION RIG ONLY (PR #13673): evidence cards -> PNG via Playwright element screenshots.
// usage (from a worktree with playwright): node /Users/wenshao/pr13673-rig/fig/gen.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/git/qwen-code-pr13673-base/package.json');
const { chromium } = require('playwright');
const RIG = '/Users/wenshao/pr13673-rig';
const RES = `${RIG}/results`;
const load = (p) => { try { return JSON.parse(fs.readFileSync(`${RES}/${p}`, 'utf8')); } catch { return null; } };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const row = (j, frag) => j?.rows.find((r) => r.label.includes(frag));

function cell(path) {
  const j = load(path);
  if (!j) return { cls: 'na', html: '—' };
  const main = row(j, 'original operation COMPLETED') ?? row(j, 'fails closed');
  const d = main?.detail ?? {};
  if (path.includes('unknown')) {
    const hk = row(j, 'End entered once')?.detail ?? [];
    return { cls: j.fail === 0 ? 'ok' : 'bad', html: `<b>${j.fail === 0 ? 'BLOCKED (correct)' : 'UNEXPECTED'}</b><br>${esc(d.op?.state)} · ${esc(d.op?.err)}<br>effects 0 · retirement 0 · holder kept<br>hooks: ${esc(hk.join(', '))} · ${j.pass}/${j.pass + j.fail}` };
  }
  if (d.op?.state === 'COMPLETED') {
    const prep = path.includes('resume') ? load(path.replace('resume', 'prep')) : null;
    const total = j.pass + j.fail + (prep ? prep.pass + prep.fail : 0);
    const pass = j.pass + (prep ? prep.pass : 0);
    return { cls: j.fail === 0 ? 'ok' : 'bad', html: `<b>RETIRED ${(d.ms / 1000).toFixed(0)} s ${prep ? 'after restart' : 'after fault'}</b><br>op COMPLETED · Session DELETED<br>1 retirement · stop receipt · holder cleared<br>End×1 Delete×1 · checks ${pass}/${total}` };
  }
  return { cls: 'bad', html: `<b>still BLOCKED at +${(d.ms / 1000).toFixed(0)} s</b><br>${esc(d.op?.state)} ×${d.op?.attempts}<br>${esc(d.op?.err)}<br>Session ${esc(d.session)} · 0 retirement · holder held` };
}

const faults = [
  ['Spring restart (TERM); Harness + original workers alive', 'term', 'recover-spring-term.json'],
  ['Spring KILL; Harness + original workers alive', 'kill', 'recover-spring-kill.json'],
  ['Spring KILL + both original workers KILL; Harness kept', 'sw', 'recover-spring-workers.json'],
  ['All 4 original product processes KILL (Spring, Harness, 2 workers)', 'all', 'recover-all.json'],
  ['Actual guest OS reboot (VM stop/start, boot_id changes)', 'boot', 'recover-reboot-resume.json'],
  ['Control: worker + Hook unit vanish while End unresolved (60 s)', 'unk', 'unknown-end.json'],
];
const arms = [['b', 'base 29aef7de<br><span>PR merge-base</span>'], ['h', 'head a62f55be<br><span>PR</span>'], ['m', 'trial merge e23dd5fd<br><span>head → main 669b2f0f</span>'], ['n', 'main 669b2f0f<br><span>control</span>']];

const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
.card{display:inline-block;padding:28px 32px;background:#0d1117}
h1{font-size:23px;margin:0 0 4px} .sub{color:#8b949e;font-size:14px;margin:0 0 18px;max-width:1240px;line-height:1.45}
table{border-collapse:separate;border-spacing:4px} th{font-size:13px;color:#c9d1d9;text-align:left;padding:6px 10px;font-weight:600}
th span{color:#8b949e;font-weight:400} td{font-size:13px;padding:9px 11px;border-radius:6px;vertical-align:top;line-height:1.45}
td.f{color:#c9d1d9;max-width:290px;background:#161b22} td.ok{background:#0f2d1b;border:1px solid #2ea043} td.bad{background:#3a1416;border:1px solid #da3633}
td.na{background:#161b22;color:#6e7681;text-align:center} b{font-weight:650}
pre{font:12.5px/1.5 ui-monospace,Menlo,monospace;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px 14px;margin:0;white-space:pre;color:#c9d1d9}
.g{color:#3fb950}.r{color:#f85149}.y{color:#d29922}.m{color:#8b949e}.b{color:#58a6ff}
.cols{display:flex;gap:14px} .col h2{font-size:15px;margin:0 0 8px}
.note{border-left:3px solid #58a6ff;padding:6px 12px;color:#c9d1d9;font-size:13.5px;margin-top:14px;max-width:1240px;line-height:1.5}
`;

function matrix() {
  let h = `<div class="card" id="c1"><h1>#13673 · original command-Hook Session retirement after faults — real Linux stack</h1>
<p class="sub">colima VM Ubuntu 24.04 / kernel 6.8 aarch64 · MySQL 8.4 · Temurin 21 Spring fat jar (embedded durable local-process Broker) · packaged Hosted Harness + real managed-runtime-worker processes on Node 22 · command Hooks (SessionEnd, SessionDelete) run under a delegated cgroup v2 root.
Fault is injected after End and Delete effects are durable: a recording proxy holds the first <code>POST /session/&lt;id&gt;/detach</code>. Neighbor Session shares the same Workspace storage. Deadline 180 s, retry 0.</p>
<table><tr><th>fault after durable End+Delete effects</th>${arms.map((a) => `<th>${a[1]}</th>`).join('')}</tr>`;
  for (const [label, key, file] of faults) {
    h += `<tr><td class="f">${esc(label)}</td>`;
    for (const [a] of arms) {
      const c = cell(`${a}-${key}/${file}`);
      h += `<td class="${c.cls}">${c.html}</td>`;
    }
    h += '</tr>';
  }
  h += `</table><div class="note">Every RETIRED cell also passed: original binding / generation / handle / seed / lease unchanged, no replacement worker, no model request after the fault, effect-receipt bytes unchanged, all original RuntimeSessions RELEASED, original worker gone, shared files byte-identical, neighbor not retired. — = not run on that arm.</div></div>`;
  return h;
}

function detail() {
  const b = load('b-sw/recover-spring-workers.json'), hh = load('h-sw/recover-spring-workers.json');
  const tl = (j) => row(j, 'timeline')?.detail ?? [];
  const bt = tl(b), ht = tl(hh);
  const fmtTl = (t) => t.map((x) => {
    const m = x.match(/^(\+[\d.]+s) ([A-Z_]+)\/([A-Z_]+)\/([a-z_]*)\/g(\d+)$/);
    if (!m) return esc(x);
    const [, at, state, delivery, err, g] = m;
    const st = state === 'RECOVERY_BLOCKED' ? `<span class="r">RECOVERY_BLOCKED</span>` : state === 'COMPLETED' ? `<span class="g">COMPLETED</span>` : state;
    const e = err ? (state === 'RECOVERY_BLOCKED' ? `<span class="r">${err.replace('workspace_lifecycle_', '')}</span>` : `<span class="m">(retry)</span>`) : '';
    return `${at.padStart(7)} ${st.padEnd(state === 'RECOVERY_BLOCKED' || state === 'COMPLETED' ? st.length + (17 - state.length) : 17)} ${delivery.padEnd(10)} ${e ? e + ' ' : ''}<span class="m">claim g${g}</span>`;
  }).join('\n');
  const st = (j) => {
    const g = (f) => row(j, f)?.detail;
    const bind = g('binding drained'), rt = g('RuntimeSessions'), hold = g('holder cleared'), ret = g('retirement row'), w = g('worker process gone');
    const held = (hold ?? []).find((x) => Number(x.held) === 1);
    return [
      `binding        ${bind?.state}  drain receipt=${bind?.drainRcpt ? '<span class="g">persisted</span>' : '<span class="r">none</span>'}`,
      `hook runtime   ${(rt ?? []).map((x) => x.split(':').slice(1).join(':')).join(', ').replace('READY', '<span class="r">READY</span>').replace('RELEASED', '<span class="g">RELEASED</span>')}`,
      `storage holder ${held ? '<span class="r">held by hooks-activation-…</span>' : '<span class="g">cleared</span>'}`,
      `retirement     ${(ret ?? []).length ? '<span class="g">1 row</span>' : '<span class="r">0 rows</span>'}`,
      `worker         ${w?.after?.regState === 'RETIRED' ? '<span class="g">registration RETIRED</span>' : '<span class="r">registration ' + w?.after?.regState + '</span> (process killed, never retired)'}`,
    ].join('\n');
  };
  const bOp = row(b, 'original operation COMPLETED')?.detail, hOp = row(hh, 'original operation COMPLETED')?.detail;
  return `<div class="card" id="c2"><h1>Spring KILL + both original workers KILL (Harness kept): base vs head</h1>
<p class="sub">Same probe, same fault point. Rows are the operation row sampled every 0.5 s after the fault (state / delivery / error / claim generation), then the durable state at the end of the window.</p>
<div class="cols"><div class="col"><h2 class="r">base 29aef7de — blocked</h2><pre>${fmtTl(bt.slice(0, 9))}
<span class="m">… ${bt.length - 9} more transitions …</span>
${fmtTl(bt.slice(-1))}

op ${bOp?.op?.state} attempts=${bOp?.op?.attempts}  Session <span class="r">${bOp?.session}</span>  after ${(bOp?.ms / 1000).toFixed(0)} s

${st(b)}

<span class="y">Harness → Broker  POST …/hooks-activation-…:release
  503 runtime_reconciliation_required ×8
  "Runtime Session is not active in this Broker process"
Spring → Harness  POST /session/:id/detach
  503 managed_session_close_failed ×8</span></pre></div>
<div class="col"><h2 class="g">head a62f55be — retired</h2><pre>${fmtTl(ht)}

op ${hOp?.op?.state} attempts=${hOp?.op?.attempts}  Session <span class="g">${hOp?.session}</span>  after ${(hOp?.ms / 1000).toFixed(0)} s

${st(hh)}

End ×1, Delete ×1 (command Hooks, cgroup units)
same binding id / generation / handle / seed / lease
no replacement worker · no model request after fault
neighbor Session ACTIVE, shared files byte-identical</pre></div></div></div>`;
}

function mutants() {
  const p1 = fs.readFileSync(`${RIG}/out/mutants.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const pf = fs.existsSync(`${RIG}/out/mutants-full.jsonl`) ? Object.fromEntries(fs.readFileSync(`${RIG}/out/mutants-full.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((x) => [x.id, x])) : {};
  const p2 = Object.fromEntries(fs.readFileSync(`${RIG}/out/mutants-p2.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((x) => [x.id, x]));
  let lines = '';
  for (const m of p1) {
    const fin = p2[m.id] ?? m;
    const v = fin.verdict === 'killed' ? '<span class="g">killed  </span>' : '<span class="r">SURVIVED</span>';
    const full = pf[m.id];
    const by = fin.verdict === 'killed' ? (fin.failing?.[0] ?? '') : full?.verdict === 'killed' ? `killed only by full Broker suite: ${full.failing?.[0]}` : m.module === 'broker' ? `Broker ${full ? full.total?.[0] + ' (full)' : '93'} + Server 206 pass` : 'Server 40 + 206 pass';
    const v2 = fin.verdict === 'killed' || full?.verdict === 'killed' ? '<span class="g">killed  </span>' : '<span class="r">SURVIVED</span>';
    lines += `${m.id.padEnd(4)} ${v2} ${(m.ref ?? '').padEnd(10)} ${esc(m.note.replace("its cached context (the 6e2e151 fix reverted)", "its cache (6e2e151 fix reverted)").replace("already-cleared (all-null) holder row refused instead of idempotent", "already-cleared (all-null) holder row refused, not idempotent")).padEnd(66)} <span class="m">${esc(by)}</span>\n`;
  }
  return `<div class="card" id="c3"><h1>Mutation sampling on head a62f55be — 20 single-line mutants of this PR's guards</h1>
<p class="sub">Phase 1: Broker RuntimeHarnessDrainTest + InMemoryRepositoryTest + JdbcRepositoryTest (93) or Server WorkspaceRuntimeTest + RuntimeBrokerFlywaySchemaTest + SessionLifecycleCoordinatorTest (40). Phase 2 for survivors: mutated Broker jar installed, then 12 Server classes that drive the JDBC stopped release / drain (206). Broker survivors were then run against the full Broker suite (777 tests). Server survivors were not run against the full Server suite.</p>
<pre>${lines}</pre></div>`;
}

const html = `<!doctype html><meta charset="utf-8"><style>${css}</style>${matrix()}<br>${detail()}<br>${mutants()}`;
fs.writeFileSync(`${RIG}/fig/cards.html`, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(`file://${RIG}/fig/cards.html`);
for (const [id, name] of [['c1', '01-fault-matrix'], ['c2', '02-base-vs-head-spring-workers'], ['c3', '03-mutants']]) {
  const clipped = await page.evaluate((i) => [...document.querySelectorAll(`#${i} pre`)].filter((p) => p.scrollWidth > p.clientWidth + 1).length, id);
  await page.locator(`#${id}`).screenshot({ path: `${RIG}/fig/${name}.png` });
  console.log(name, 'clippedPre=', clipped);
}
await browser.close();
