// VERIFICATION RIG ONLY (PR #13673 round 3): evidence cards -> PNG via Playwright element screenshots.
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
    return { cls: j.fail === 0 ? 'ok' : 'bad', html: `<b>${j.fail === 0 ? 'BLOCKED (correct)' : 'UNEXPECTED'}</b><br>${esc(d.op?.err)}<br>effects 0 · retirement 0 · holder kept<br>hooks: ${esc(hk.join(', '))} · ${j.pass}/${j.pass + j.fail}` };
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
  ['All 4 original product processes KILL', 'all', 'recover-all.json'],
  ['Actual guest OS reboot (VM stop/start)', 'boot', 'recover-reboot-resume.json'],
  ['Control: worker + Hook unit vanish while End unresolved (60 s)', 'unk', 'unknown-end.json'],
];
const arms = [
  ['r3b', 'base fe2dd7f6<br><span>the PR\'s merge base (main at the author\'s merge)</span>'],
  ['r3h', 'head 6d65c83b<br><span>main fe2dd7f6 merged + schema.sql fix</span>'],
  ['r3m', 'trial merge 87f37f91<br><span>head → current main df72e2d1 (+14 commits)</span>'],
];
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
.card{display:inline-block;padding:28px 32px;background:#0d1117}
h1{font-size:23px;margin:0 0 4px} .sub{color:#8b949e;font-size:14px;margin:0 0 18px;max-width:1180px;line-height:1.45}
table{border-collapse:separate;border-spacing:4px} th{font-size:13px;color:#c9d1d9;text-align:left;padding:6px 10px;font-weight:600;max-width:290px}
th span{color:#8b949e;font-weight:400} td{font-size:13px;padding:9px 11px;border-radius:6px;vertical-align:top;line-height:1.45}
td.f{color:#c9d1d9;max-width:290px;background:#161b22} td.ok{background:#0f2d1b;border:1px solid #2ea043} td.bad{background:#3a1416;border:1px solid #da3633}
td.na{background:#161b22;color:#6e7681;text-align:center} b{font-weight:650}
pre{font:12.5px/1.5 ui-monospace,Menlo,monospace;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px 14px;margin:0;white-space:pre;color:#c9d1d9}
.g{color:#3fb950}.r{color:#f85149}.y{color:#d29922}.m{color:#8b949e}.b{color:#58a6ff}
.note{border-left:3px solid #58a6ff;padding:6px 12px;color:#c9d1d9;font-size:13.5px;margin-top:14px;max-width:1180px;line-height:1.5}
.lane{margin:18px 0 6px} .lane h2{font-size:15px;margin:0 0 3px} .lane p{margin:0 0 8px;color:#8b949e;font-size:13px;max-width:1180px}
.axis{position:relative;width:1100px;height:86px;background:#161b22;border:1px solid #30363d;border-radius:6px}
.hold{position:absolute;top:10px;height:24px;background:#5a3d0a;border:1px solid #d29922;border-radius:4px;font-size:12px;color:#f0c674;padding:3px 6px;box-sizing:border-box;white-space:nowrap;overflow:hidden}
.tick{position:absolute;top:42px;width:2px;height:20px}
.tick.r{background:#f85149}.tick.g{background:#3fb950;width:4px}.tick.f{background:#8b949e}
.lbl{position:absolute;top:64px;font-size:11.5px;white-space:nowrap}
.scale{position:relative;width:1100px;height:16px;font-size:11px;color:#6e7681}
.scale span{position:absolute}
`;

function matrix() {
  let h = `<div class="card" id="c1"><h1>#13673 round 3 · head 6d65c83b (main merged + schema fix) on the real stack</h1>
<p class="sub">Same rig and probes as rounds 1–2: real Spring with the embedded durable Broker, the packaged Harness, real workers, and command Hooks under a delegated cgroup v2 root. A proxy holds the first <code>POST /session/&lt;id&gt;/detach</code> after the End and Delete effects are durable, then the fault is injected. MySQL 8.4, UTC. The base arm reuses head's Node bundle because the PR changes no Node sources.</p>
<table><tr><th>fault after durable End+Delete effects</th>${arms.map((a) => `<th>${a[1]}</th>`).join('')}</tr>`;
  for (const [label, key, file] of faults) {
    h += `<tr><td class="f">${esc(label)}</td>`;
    for (const [a] of arms) {
      const c = cell(`${a}-${key}/${file}`);
      h += `<td class="${c.cls}">${c.html}</td>`;
    }
    h += '</tr>';
  }
  h += `</table><div class="note">Targeted Java tests (RuntimeHarnessDrainTest, InMemoryRepositoryTest, JdbcRepositoryTest | WorkspaceRuntimeTest, RuntimeBrokerFlywaySchemaTest, SessionLifecycleCoordinatorTest): head Broker 93/93 · Server 52/52; trial merge Broker 93/93 · Server 53/53 (main added one SessionLifecycleCoordinatorTest case). RuntimeBrokerFlywaySchemaTest 4/4 on both. — = not run.</div></div>`;
  return h;
}

const X = (s) => (s / 200) * 1100;
function lane(file, title, sub) {
  const j = load(file);
  const m = row(j, 'emulated child-Workspace')?.detail ?? {};
  const tl = (row(j, 'operation timeline')?.detail ?? []).map((t) => { const [, s, k] = t.match(/^\+([\d.]+)s (.*)$/); return { s: +s, k }; });
  let h = `<div class="lane"><h2>${esc(title)}</h2><p>${sub}</p><div class="axis">`;
  h += `<div class="hold" style="left:${X(m.taken)}px;width:${X(m.released) - X(m.taken)}px">emulated child-Workspace hold +${m.taken}s → +${m.released}s</div>`;
  h += `<div class="tick f" style="left:0px"></div><div class="lbl m" style="left:2px">fault</div>`;
  const blocked = tl.filter((t) => t.k.startsWith('RECOVERY_BLOCKED'));
  for (const t of blocked) h += `<div class="tick r" style="left:${X(t.s)}px"></div>`;
  if (blocked.length) h += `<div class="lbl r" style="left:${X(blocked[0].s) + 4}px">${blocked.length} attempts refused: ${esc(blocked[0].k.split('/')[2])} (backoff doubling, cap 1 min)</div>`;
  const done = tl.find((t) => t.k.startsWith('COMPLETED'));
  if (done) h += `<div class="tick g" style="left:${X(done.s)}px"></div><div class="lbl g" style="${X(done.s) > 900 ? `right:${1100 - X(done.s) + 8}px` : `left:${X(done.s) + 6}px`};top:${blocked.length ? 46 : 64}px">COMPLETED +${done.s}s</div>`;
  h += `</div></div>`;
  return h;
}

function maint() {
  const scale = `<div class="scale">${[0, 25, 50, 75, 100, 125, 150, 175, 200].map((s) => `<span style="left:${X(s)}px">${s}s</span>`).join('')}</div>`;
  const t = load('r3h-tmaint/recover-spring-term-maint.json');
  const w = load('r3h-swmaint/recover-spring-workers-maint.json');
  const mt = row(t, 'emulated child-Workspace')?.detail ?? {};
  const mw = row(w, 'emulated child-Workspace')?.detail ?? {};
  return `<div class="card" id="c2"><h1>Deferred design note, measured: the child-Workspace hold delayed one recovery path and left the other alone</h1>
<p class="sub">An emulated child-Workspace step on the target's storage. It writes the row that main's <code>holdForMaintenance</code> writes (holder key <code>sha256("child-workspace\\0"+id+"\\0"+gen)</code>, Runtime columns NULL, <code>maintenance_id</code> set). It takes the hold the moment <code>holder_key</code> is NULL, which is the method's own admission condition, polling every 20 ms like a step that met <code>workspace_busy</code>. It releases after 90 s with <code>releaseMaintenance</code>'s UPDATE. Head 6d65c83b, same fault point as above.</p>
${scale}
${lane('r3h-tmaint/recover-spring-term-maint.json', 'Spring TERM restart, original worker alive (adopt → release → close)', `The hold landed at +${mt.taken}s while the Hook RuntimeSession was ${esc((mt.rtAtTake ?? []).join(' '))} and the binding was ${esc((mt.bindingAtTake ?? []).join(' '))}. The close step's <code>canStopDrained</code> then refused (409, retryable=false). SessionLifecycleCoordinator recorded RECOVERY_BLOCKED and kept re-arming anyway. Retirement completed ${(t?.doneMs / 1000 - mt.released).toFixed(0)} s after the release (the next backoff slot). 18/18 checks.`)}
${lane('r3h-swmaint/recover-spring-workers-maint.json', 'Spring + original workers KILL (stop → receipt → release + clear holder)', `The hold landed at +${mw.taken}s, after <code>completeStoppedSessionRelease</code> had already cleared the Runtime holder (binding ${esc((mw.bindingAtTake ?? []).join(' '))}, Hook session ${esc((mw.rtAtTake ?? []).join(' '))}). Retirement completed 1.4 s later with no refusal, and the hold stayed intact until its owner released it. The probe's 2 failing checks are expectations I wrote for the emulation, not product faults: "holder cleared" saw the child hold still in place, and "completed only after release" was wrong for this path.`)}
<div class="note">Neither run reached <code>clearStoppedHolder</code>'s non-retryable <code>workspace_close_identity_unverified</code>. That needs the hold to land before <code>completeStoppedSessionRelease</code> while the Runtime holder is already gone, and <code>holdForMaintenance</code> only admits on a NULL holder. The worker-alive path waits for the child step; the worker-absent path does not. The wait is bounded by the step plus at most one 1-min backoff slot. No holder was cleared that was not the target's own, and End and Delete each ran exactly once in both runs.</div></div>`;
}

const html = `<!doctype html><meta charset="utf-8"><style>${css}</style>${matrix()}<br>${maint()}`;
fs.writeFileSync(`${RIG}/fig/cards3.html`, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(`file://${RIG}/fig/cards3.html`);
for (const [id, name] of [['c1', 'r3-01-matrix'], ['c2', 'r3-02-maintenance-hold']]) {
  const clipped = await page.evaluate((i) => [...document.querySelectorAll(`#${i} pre, #${i} .hold`)].filter((p) => p.scrollWidth > p.clientWidth + 1).length, id);
  await page.locator(`#${id}`).screenshot({ path: `${RIG}/fig/${name}.png` });
  console.log(name, 'clipped=', clipped);
}
await browser.close();
