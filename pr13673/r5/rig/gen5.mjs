// VERIFICATION RIG ONLY (PR #13673 round 5, post-merge): evidence cards -> PNG via Playwright element screenshots.
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
    const states = row(j, 'binding states seen')?.detail ?? [];
    return { cls: j.fail === 0 ? 'ok' : 'bad', html: `<b>RETIRED ${(d.ms / 1000).toFixed(0)} s ${prep ? 'after restart' : 'after fault'}</b><br>op COMPLETED · Session DELETED<br>1 retirement · stop receipt · holder cleared<br>End×1 Delete×1 · checks ${pass}/${total}${states.length ? `<br><span class="m">binding: ${esc(states.join(' → '))}</span>` : ''}` };
  }
  if (path.includes('workers/')) {
    const br = row(j, 'Harness -> Broker answers')?.detail ?? [];
    const codes = [...new Set(br.map((x) => x.split(' -> ')[1]))];
    const states = row(j, 'binding states seen')?.detail ?? [];
    return { cls: 'warn', html: `<b>still BLOCKED at +${(d.ms / 1000).toFixed(0)} s</b><br>${esc(d.op?.state)} · ${esc(d.op?.err)}<br>${br.length}× release ${esc(codes.join(', '))}<br>binding ${esc(states.join(' → '))} · no receipt · holder held<br>Spring restart at +180 s did not unblock it` };
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
  ['r4m', 'round 4: trial merge 0aa2f8c9<br><span>head 6d65c83b → main fce50611</span>'],
  ['r5l', 'round 5: landed squash 7cbb993c<br><span>on main 78a1d33a (+14 commits since fce50611)</span>'],
];
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
.card{display:inline-block;padding:28px 32px;background:#0d1117}
h1{font-size:23px;margin:0 0 4px} .sub{color:#8b949e;font-size:14px;margin:0 0 18px;max-width:1180px;line-height:1.45}
table{border-collapse:separate;border-spacing:4px} th{font-size:13px;color:#c9d1d9;text-align:left;padding:6px 10px;font-weight:600;max-width:290px}
th span{color:#8b949e;font-weight:400} td{font-size:13px;padding:9px 11px;border-radius:6px;vertical-align:top;line-height:1.45}
td.f{color:#c9d1d9;max-width:290px;background:#161b22} td.ok{background:#0f2d1b;border:1px solid #2ea043} td.bad{background:#3a1416;border:1px solid #da3633}
td.warn{background:#2e2410;border:1px solid #d29922}
td.na{background:#161b22;color:#6e7681;text-align:center} b{font-weight:650}
.g{color:#3fb950}.r{color:#f85149}.y{color:#d29922}.m{color:#8b949e}.b{color:#58a6ff}
.note{border-left:3px solid #58a6ff;padding:6px 12px;color:#c9d1d9;font-size:13.5px;margin-top:14px;max-width:1180px;line-height:1.5}
.lane{margin:18px 0 6px} .lane h2{font-size:15px;margin:0 0 3px} .lane p{margin:0 0 8px;color:#8b949e;font-size:13px;max-width:1180px;line-height:1.45}
.axis{position:relative;width:1100px;height:104px;background:#161b22;border:1px solid #30363d;border-radius:6px}
.hold{position:absolute;top:8px;height:22px;background:#5a3d0a;border:1px solid #d29922;border-radius:4px;font-size:12px;color:#f0c674;padding:2px 6px;box-sizing:border-box;white-space:nowrap;overflow:hidden}
.lapse{position:absolute;top:34px;height:16px;background:#4a1518;border:1px solid #da3633;border-radius:4px;font-size:11px;color:#ff9b96;padding:0 6px;box-sizing:border-box;white-space:nowrap;overflow:hidden}
.tick{position:absolute;top:56px;width:2px;height:20px}
.tick.r{background:#f85149}.tick.g{background:#3fb950;width:4px}.tick.f{background:#8b949e}
.lbl{position:absolute;top:80px;font-size:11.5px;white-space:nowrap}
.scale{position:relative;width:1100px;height:16px;font-size:11px;color:#6e7681}
.scale span{position:absolute}
`;

function matrix() {
  let h = `<div class="card" id="c1"><h1>#13673 round 5 · merged · the landed squash 7cbb993c re-verified on the real stack</h1>
<p class="sub">Same rig and probes as rounds 1–4: real Spring with the embedded durable Broker, the packaged Harness, real workers, and command Hooks under a delegated cgroup v2 root. A proxy holds the first <code>POST /session/&lt;id&gt;/detach</code> after the End and Delete effects are durable, then the fault is injected. MySQL 8.4, UTC. Left: round 4's trial merge of the same head onto main fce50611. Right: the commit that actually landed (tree identical to a clean merge of head 6d65c83b onto main 78a1d33a), with its own Java and Node builds.</p>
<table><tr><th>fault after durable End+Delete effects</th>${arms.map((a) => `<th>${a[1]}</th>`).join('')}</tr>`;
  for (const [label, key, file] of faults) {
    h += `<tr><td class="f">${esc(label)}</td>`;
    for (const [a] of arms) {
      const c = cell(`${a}-${key}/${file}`);
      h += `<td class="${c.cls}">${c.html}</td>`;
    }
    h += '</tr>';
  }
  h += `</table><div class="note">${NOTE}</div></div>`;
  return h;
}

const NOTE = fs.existsSync(`${RIG}/fig/note5.html`) ? fs.readFileSync(`${RIG}/fig/note5.html`, 'utf8') : 'NOTE PENDING';
const SPAN = 120;
const X = (s) => (s / SPAN) * 1100;
function lane(file, title, sub, injected) {
  const j = load(file);
  const sm = row(j, '25 ms sampler')?.detail ?? {};
  const tl = (row(j, 'operation timeline')?.detail ?? []).map((t) => { const m = t.match(/^\+([\d.]+)s (.*)$/); return m ? { s: +m[1], k: m[2] } : null; }).filter(Boolean);
  let h = `<div class="lane"><h2>${esc(title)}</h2><p>${sub}</p><div class="axis">`;
  if (injected) h += `<div class="hold" style="left:${X(injected.from)}px;width:${X(injected.to) - X(injected.from)}px">${esc(injected.label)} · ${(injected.to - injected.from).toFixed(0)} s</div>`;
  for (const l of sm.lapses ?? []) if (l.to != null) h += `<div class="lapse" style="left:${X(l.from)}px;width:${Math.max(4, X(l.to) - X(l.from))}px">lease expired</div>`;
  h += `<div class="tick f" style="left:0px"></div><div class="lbl m" style="left:2px">fault</div>`;
  const blocked = tl.filter((t) => t.k.startsWith('RECOVERY_BLOCKED'));
  for (const t of blocked) h += `<div class="tick r" style="left:${X(t.s)}px"></div>`;
  const done = tl.find((t) => t.k.startsWith('COMPLETED'));
  if (blocked.length) h += `<div class="lbl r" style="${done && X(done.s) - X(blocked[0].s) < 420 ? `right:${1100 - X(blocked[0].s) + 6}px` : `left:${X(blocked[0].s) + 4}px`}">${blocked.length} attempt${blocked.length > 1 ? 's' : ''} recorded RECOVERY_BLOCKED, re-armed</div>`;
  if (done) h += `<div class="tick g" style="left:${X(done.s)}px"></div><div class="lbl g" style="${X(done.s) > 960 ? `right:${1100 - X(done.s) + 8}px` : `left:${X(done.s) + 6}px`};top:${blocked.length ? 60 : 80}px">COMPLETED +${done.s}s</div>`;
  h += `</div></div>`;
  return h;
}

function review() {
  const scale = `<div class="scale">${[0, 15, 30, 45, 60, 75, 90, 105, 120].map((s) => `<span style="left:${X(s)}px">${s}s</span>`).join('')}</div>`;
  const g = row(load('r5l-guard/recover-spring-workers-lock-guard.json'), 'injected guard lock')?.detail ?? {};
  const hd = row(load('r5l-holder/recover-spring-workers-lock-holder.json'), 'injected holder lock')?.detail ?? {};
  const fl = row(load('r5l-flock/recover-spring-workers-flock.json'), 'LockGrab')?.detail ?? [];
  const fg = fl.find((e) => e.event === 'grabbed') ?? {};
  const fr = fl.find((e) => e.event === 'released') ?? {};
  const flb = row(load('r5l-flock/recover-spring-workers-flock.json'), 'Harness -> Broker answers')?.detail ?? [];
  const n409 = flb.filter((x) => x.includes('409')).length;
  return `<div class="card" id="c2"><h1>Round 4's lock injections, repeated on the landed squash 7cbb993c: same shape, same outcome</h1>
<p class="sub">Landed 7cbb993c, fault = Spring KILL + both original workers KILL (the worker-absent path: reconcile → drain claim → second reconcile → stop → persist receipt → release Session + clear holder). Each lock is taken from a separate MySQL connection or process the moment the target binding turns DRAINING (or the registration turns RETIRED), held for a fixed time, then released. The amber bar is the injected hold. The red bar is where the 25 ms sampler saw the drain claim's <code>operation_lease_until</code> in the past. Ticks are the operation's attempts that recorded RECOVERY_BLOCKED, and green is COMPLETED. Operation lease 30 s, renewal every 10 s, <code>innodb_lock_wait_timeout</code> 50 s.</p>
${scale}
${lane('r5l-sw/recover-spring-workers.json', 'Baseline, no injection', 'The whole drain took about 1.3 s at host load ~126 (round 4: 0.3 s): DRAINING → receipt +1.0 s → Session RELEASING → RELEASED → binding RELEASED. The binding was never LOST. Retired 57 s after the fault (round 4 head: 52 s).')}
${lane('r5l-guard/recover-spring-workers-lock-guard.json', 'R2-1 / P2: tenant placement guard held 45 s once DRAINING', `Taken at +${g.taken}s, the same moment the binding turned DRAINING and before the stop receipt. The Broker queued on the guard inside the receipt write while holding the renewal monitor, so the 10 s renewal never ran: by the time the guard was released (+${g.released}s) the lease had been expired for ${(-Number(g.beforeRelease?.match(/leaseLeftMs=(-?\d+)/)?.[1]) / 1000).toFixed(1)} s. The receipt write was then fenced and the claim released (no receipt, Session still READY). The coordinator re-armed and the next drain stopped, released and retired in 0.05 s. Round 4 on head: expired 14.3 s, COMPLETED +100 s.`, { from: g.taken, to: g.released, label: 'placement guard FOR UPDATE' })}
${lane('r5l-holder/recover-spring-workers-lock-holder.json', 'R2-1 worst case: the storage holder row held 45 s, so the wait lands after the Session is RELEASING', `Receipt persisted and Session RELEASING at +57.1 s. Then <code>completeStoppedSessionRelease</code> waited inside <code>clearStoppedHolder</code>, holding the monitor and the tenant guard (7 other tenant transactions queued behind it; round 4: 5). The lease lapsed, and its second <code>requireStoppedRelease</code> rolled the transaction back, leaving the Session RELEASING. The next drain resumed from the durable receipt without a new stop and retired in 0.09 s. Round 4 on head: COMPLETED +102 s.`, { from: hd.taken, to: hd.released, label: 'holder row FOR UPDATE' })}
${lane('r5l-flock/recover-spring-workers-flock.json', 'R2-2 / P2: the LocalRuntimeStore lock taken between the two reconciles, held 20 s', `The first reconcile retired the registration and proved absence; ${fg.msAfterRetiredSeen} ms later (+${fg.at}s) an external process took the same fcntl lock and held it until +${fr.at}s. The drain claim went DRAINING, the second reconcile met the lock (busy → unknown), and the Broker answered <b>409 workspace_close_identity_unverified, retryable=false</b> ${n409} times. The coordinator kept re-arming (1.5, 3, 5, 9, 16 s), and the first attempt after the release retired the Session. The operation-level error stayed <code>workspace_lifecycle_hooks_unsettled</code>. Round 4 on head: 5 × 409, COMPLETED +96 s.`, { from: fg.at, to: fr.at, label: 'fcntl lock' })}
<div class="note">All three injected runs on the landed commit (17/17 checks each): End and Delete ran exactly once, one retirement row, the original binding/generation/handle kept, a stop receipt for the original resource, holder cleared, no replacement worker, no model replay. The cost is the lock time plus at most one backoff slot. The "terminal" 409 and the self-fence are per attempt, not per operation.</div></div>`;
}

const html = `<!doctype html><meta charset="utf-8"><style>${css}</style>${matrix()}<br>${review()}`;
fs.writeFileSync(`${RIG}/fig/cards5.html`, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(`file://${RIG}/fig/cards5.html`);
for (const [id, name] of [['c1', 'r5-01-matrix'], ['c2', 'r5-02-locks']]) {
  const clipped = await page.evaluate((i) => [...document.querySelectorAll(`#${i} .hold, #${i} .lapse`)].filter((p) => p.scrollWidth > p.clientWidth + 1).length, id);
  await page.locator(`#${id}`).screenshot({ path: `${RIG}/fig/${name}.png` });
  console.log(name, 'clipped=', clipped);
}
await browser.close();
