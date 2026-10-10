// VERIFICATION RIG ONLY (PR #13673 round 2): evidence cards -> PNG via Playwright element screenshots.
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
  ['bz2', 'base 29aef7de<br><span>MariaDB 10.11 · DB +08:00 · JVM/Node Asia/Shanghai</span>'],
  ['hz', 'head a62f55be<br><span>MariaDB 10.11 · DB +08:00 · JVM/Node Asia/Shanghai</span>'],
  ['m2', 'trial merge ba6b1ddb<br><span>head → main 1f4484d3 · MySQL 8.4 · UTC</span>'],
  ['n2', 'main 1f4484d3<br><span>control · MySQL 8.4 · UTC</span>'],
];
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
.card{display:inline-block;padding:28px 32px;background:#0d1117}
h1{font-size:23px;margin:0 0 4px} .sub{color:#8b949e;font-size:14px;margin:0 0 18px;max-width:1240px;line-height:1.45}
table{border-collapse:separate;border-spacing:4px} th{font-size:13px;color:#c9d1d9;text-align:left;padding:6px 10px;font-weight:600;max-width:260px}
th span{color:#8b949e;font-weight:400} td{font-size:13px;padding:9px 11px;border-radius:6px;vertical-align:top;line-height:1.45}
td.f{color:#c9d1d9;max-width:270px;background:#161b22} td.ok{background:#0f2d1b;border:1px solid #2ea043} td.bad{background:#3a1416;border:1px solid #da3633}
td.na{background:#161b22;color:#6e7681;text-align:center} b{font-weight:650}
pre{font:12.5px/1.5 ui-monospace,Menlo,monospace;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px 14px;margin:0;white-space:pre;color:#c9d1d9}
.g{color:#3fb950}.r{color:#f85149}.y{color:#d29922}.m{color:#8b949e}.b{color:#58a6ff}
.note{border-left:3px solid #58a6ff;padding:6px 12px;color:#c9d1d9;font-size:13.5px;margin-top:14px;max-width:1240px;line-height:1.5}
.grid{display:grid;grid-template-columns:auto auto;gap:14px} .col h2{font-size:15px;margin:0 0 8px}
`;

function matrix() {
  let h = `<div class="card" id="c1"><h1>#13673 round 2 · head a62f55be unchanged — new engine / time zone and current main</h1>
<p class="sub">Same rig and probes as round 1 (real Spring + embedded durable Broker, packaged Harness, real workers, command Hooks under a delegated cgroup v2 root; the proxy holds the first <code>POST /session/&lt;id&gt;/detach</code> after End and Delete effects are durable). New in round 2: MariaDB 10.11.18 with <code>--default-time-zone=+08:00</code> and JVM/Node <code>TZ=Asia/Shanghai</code>, and a trial merge onto current main 1f4484d3 (32 commits newer than round 1).</p>
<table><tr><th>fault after durable End+Delete effects</th>${arms.map((a) => `<th>${a[1]}</th>`).join('')}</tr>`;
  for (const [label, key, file] of faults) {
    h += `<tr><td class="f">${esc(label)}</td>`;
    for (const [a] of arms) {
      const c = cell(`${a}-${key}/${file}`);
      h += `<td class="${c.cls}">${c.html}</td>`;
    }
    h += '</tr>';
  }
  h += `</table><div class="note">On MariaDB +08:00 the Broker stored <code>operation_lease_until</code> as UTC wall clock (94 s before UTC_TIMESTAMP(), 8 h before NOW()), so <code>canStopDrained</code>'s UTC read against <code>UNIX_TIMESTAMP()</code> is consistent in both directions. — = not run.</div></div>`;
  return h;
}

function schema() {
  return `<div class="card" id="c2"><h1>Merging a62f55be into current main turns RuntimeBrokerFlywaySchemaTest red</h1>
<p class="sub">main #13781 (V60) added <code>maintenance_id</code> and <code>idx_execution_lease_maintenance</code> to <code>managed_workspace_execution_lease</code>. This PR adds that table to the standalone Broker's <code>schema.sql</code> without them, and its parity test compares the two schemas. Neither side is red alone.</p>
<div class="grid"><div class="col"><h2>targeted Server tests (WorkspaceRuntimeTest + RuntimeBrokerFlywaySchemaTest + SessionLifecycleCoordinatorTest)</h2><pre>main  1f4484d3   parity test (no lease table in schema.sql)     4/4 <span class="g">green</span>
head  a62f55be   (base 29aef7de has no maintenance_id)        40/40 <span class="g">green</span>
merge ba6b1ddb   head → main 1f4484d3                          <span class="r">51/52 RED</span>
merge + 4-line schema.sql patch                               52/52 <span class="g">green</span>  (Broker 93/93)

<span class="r">RuntimeBrokerFlywaySchemaTest.flywayCreatesTheBrokerSchema:50</span>
 [columns of managed_workspace_execution_lease]
   unexpected: "maintenance_id"="CHARACTER(32, 0)"
 [indexes of managed_workspace_execution_lease]
   unexpected: "INDEX [maintenance_id]"

full Server suite on merge ba6b1ddb: 1722 run, 2 failures
  RuntimeBrokerFlywaySchemaTest   <span class="r">merge-induced</span>
  ChildWorktreeGitTest.namesBeyondAscii…  <span class="m">fails on main 1f4484d3 too (macOS)</span></pre></div>
<div class="col"><h2>candidate patch (schema.sql)</h2><pre>     csi_registration_revision BIGINT,
<span class="r">-    csi_provision_request_id VARCHAR(512)</span>
<span class="g">+    csi_provision_request_id VARCHAR(512),
+    maintenance_id CHAR(32),
+    INDEX idx_execution_lease_maintenance (maintenance_id)</span>
 ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

schema.sql executed twice on real engines
  MySQL 8.4      merge: ok/ok 24 cols   patched: ok/ok 25 cols + index
  MariaDB 10.11  merge: ok/ok 24 cols   patched: ok/ok 25 cols + index</pre></div></div></div>`;
}

const html = `<!doctype html><meta charset="utf-8"><style>${css}</style>${matrix()}<br>${schema()}`;
fs.writeFileSync(`${RIG}/fig/cards2.html`, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(`file://${RIG}/fig/cards2.html`);
for (const [id, name] of [['c1', 'r2-01-matrix'], ['c2', 'r2-02-schema-parity-on-merge']]) {
  const clipped = await page.evaluate((i) => [...document.querySelectorAll(`#${i} pre`)].filter((p) => p.scrollWidth > p.clientWidth + 1).length, id);
  await page.locator(`#${id}`).screenshot({ path: `${RIG}/fig/${name}.png` });
  console.log(name, 'clippedPre=', clipped);
}
await browser.close();
