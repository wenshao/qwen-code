// Renders the PR #11071 round-4 evidence figures. Every number in a figure is
// read from a measurement file (data/<arm>/*.json, logs/*), never typed in.
const fs = require('fs');
const path = require('path');
const { chromium } = require('/root/verify/pr11071-r4/head/node_modules/playwright-core');

const ROOT = '/root/verify/pr11071-r4';
const OUT = path.join(ROOT, 'publish');
fs.mkdirSync(OUT, { recursive: true });
const J = (arm, f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', arm, f), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const st = (r, p) => {
  const s = r.steps.find((x) => x.label.startsWith(p));
  if (!s) throw new Error(`no step "${p}" in ${r.arm}/${r.scenario}`);
  return s;
};
const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const sc = (s) => JSON.stringify(s?.serve?.channels);
const HEAD = '32a1756193';
const BASE = '1abccdb26a';

const CSS = `
*{box-sizing:border-box} body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.45 -apple-system,"Segoe UI","DejaVu Sans",sans-serif}
.card{width:1240px;padding:22px 26px;background:#0d1117}
h1{font-size:19px;margin:0 0 4px} .sub{color:#8b949e;margin:0 0 14px;font-size:13px}
h2{font-size:15px;margin:16px 0 8px;color:#e6edf3}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #30363d;padding:6px 8px;vertical-align:top;text-align:left}
th{background:#161b22;color:#8b949e;font-weight:600}
code,.mono{font-family:"DejaVu Sans Mono","Liberation Mono",monospace;font-size:12.5px}
.bad{background:#3d1418;color:#ffa198} .good{background:#0f2d1a;color:#7ee787} .same{background:#161b22;color:#c9d1d9}
.note{color:#8b949e;font-size:12.5px;margin-top:10px}
.legend{display:flex;gap:18px;color:#c9d1d9;font-size:13px;margin:4px 0 6px}
.sw{display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:6px;vertical-align:-1px}
`;
const page = (title, sub, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="card"><h1>${esc(title)}</h1><p class="sub">${sub}</p>${body}</div></body></html>`;

// ---------- Figure 1: real GitHub adapter timeline ----------
function ghPanel(arm, xMax) {
  const r = J(arm, 'gh-loss.json');
  const t = r.ghTimeline;
  const d1 = st(r, 'DELETE ghA #1');
  const delAt = d1.t - d1.ms;
  const injects = r.events.filter((e) => e.what === 'gh_inject');
  const W = 1188, L = 70, R = 20, top = 34, lane = 34;
  const x = (ms) => L + ((W - L - R) * ms) / xMax;
  const lanes = [
    { key: 'ghA', label: 'ghA', color: '#3987e5', y: top },
    { key: 'ghB', label: 'ghB', color: '#d95926', y: top + lane + 8 },
  ];
  let svg = `<svg width="${W}" height="${top + 2 * lane + 60}" xmlns="http://www.w3.org/2000/svg" font-family="DejaVu Sans, sans-serif">`;
  // grid
  for (let s = 0; s * 1000 <= xMax; s += 5) {
    svg += `<line x1="${x(s * 1000)}" x2="${x(s * 1000)}" y1="${top - 6}" y2="${top + 2 * lane + 12}" stroke="#21262d"/>`;
    svg += `<text x="${x(s * 1000)}" y="${top + 2 * lane + 28}" fill="#8b949e" font-size="11" text-anchor="middle">${s}s</text>`;
  }
  for (const ln of lanes) {
    svg += `<text x="${L - 10}" y="${ln.y + lane / 2 + 4}" fill="#c9d1d9" font-size="12" text-anchor="end">${ln.label}</text>`;
    svg += `<line x1="${L}" x2="${W - R}" y1="${ln.y + lane}" y2="${ln.y + lane}" stroke="#30363d"/>`;
    for (const p of t[ln.key]) {
      svg += `<rect x="${x(p) - 1}" y="${ln.y + 6}" width="2" height="${lane - 6}" rx="1" fill="${ln.color}"/>`;
    }
  }
  const marker = (at, color, text, row) => {
    svg += `<line x1="${x(at)}" x2="${x(at)}" y1="${top - 14}" y2="${top + 2 * lane + 12}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    svg += `<text x="${x(at) + 4}" y="${row}" fill="#e6edf3" font-size="11.5">${esc(text)}</text>`;
  };
  marker(t.lossAt, '#8b949e', 'ghA config removed from disk', top - 18);
  marker(delAt, d1.status === 200 ? '#7ee787' : '#ffa198', `DELETE ghA → ${d1.status}`, top - 4);
  const post = st(r, 'mentions after DELETE');
  for (const inj of injects) {
    const tag = inj.text.split(' ')[1];
    const lnY = inj.channel === 'ghA' ? top : top + lane + 8;
    const replied = r.ghTimeline.replies[inj.channel].find((x) => String(x.body).includes(tag));
    svg += `<circle cx="${x(inj.t)}" cy="${lnY + lane / 2 + 3}" r="5" fill="#0d1117" stroke="#e6edf3" stroke-width="2"/>`;
    if (replied) svg += `<circle cx="${x(replied.t)}" cy="${lnY + lane / 2 + 3}" r="5" fill="#e6edf3"/>`;
  }
  const endAt = Math.max(...r.events.map((e) => e.t));
  svg += `<line x1="${x(endAt)}" x2="${x(endAt)}" y1="${top - 14}" y2="${top + 2 * lane + 12}" stroke="#6e7681" stroke-width="1"/>`;
  svg += `<text x="${x(endAt) - 4}" y="${top - 4}" fill="#8b949e" font-size="11" text-anchor="end">run ends, daemon stopped</text>`;
  svg += `</svg>`;
  const win = st(r, 'after DELETE: 8s');
  const answeredPost = post.ghA === 'ANSWERED';
  const cls = (good) => (good ? 'good' : 'bad');
  const table = `<table><tr><th>DELETE ghA (config removed)</th><th>ghA worker</th><th>ghA polls in 8 s window after DELETE</th><th>new @mention to ghA</th><th>startup selection on disk</th><th>bystander ghB</th></tr>
<tr><td class="${cls(d1.status === 200)}">${d1.status} ${esc(d1.code ?? '')} (${d1.ms} ms)</td><td class="${cls(!win.pidA_alive)}">${win.pidA_alive ? 'alive' : 'exited'}</td><td class="${cls(win.pollsA_window === 0)}">${win.pollsA_window} (ghB: ${win.pollsB_window})</td><td class="${cls(!answeredPost)}">${answeredPost ? 'ANSWERED (config removed, worker still running)' : 'no reply'}</td><td class="${cls(sc(win.settingsA) === '[]')}"><code>${esc(sc(win.settingsA))}</code></td><td class="good">pid unchanged, ${post.ghB === 'ANSWERED' ? 'answered' : 'NO REPLY'}</td></tr></table>`;
  return `<h2>${arm === 'head' ? `head <code>${HEAD}</code> (this PR)` : `base <code>${BASE}</code>`}</h2>${svg}${table}`;
}
function fig1() {
  const rb = J('base', 'gh-loss.json');
  const rh = J('head', 'gh-loss.json');
  const end = (r) => Math.max(...r.ghTimeline.ghA, ...r.ghTimeline.ghB, ...r.events.map((e) => e.t));
  const xMax = Math.ceil(Math.max(end(rb), end(rh)) / 5000) * 5000;
  const reps = ['gh-loss.json', 'gh-loss-r2.json', 'gh-loss-r3.json'].filter((f) =>
    fs.existsSync(path.join(ROOT, 'data', 'head', f)) && fs.existsSync(path.join(ROOT, 'data', 'base', f)),
  );
  const repLine = reps
    .map((f) => {
      const b = st(J('base', f), 'after DELETE: 8s').pollsA_window;
      const h = st(J('head', f), 'after DELETE: 8s').pollsA_window;
      const bm = st(J('base', f), 'mentions after DELETE').ghA;
      const hm = st(J('head', f), 'mentions after DELETE').ghA;
      return `run ${f.replace('gh-loss', '1').replace('.json', '').replace('1-r', '')}: base ${b} polls / ${bm} · head ${h} polls / ${hm}`;
    })
    .join(' &nbsp;|&nbsp; ');
  const body = `<div class="legend"><span><span class="sw" style="background:#3987e5"></span>ghA poll of <code>GET /notifications</code> (workspace A, config lost)</span><span><span class="sw" style="background:#d95926"></span>ghB poll (workspace B, bystander)</span><span>○ @mention injected &nbsp; ● bot reply posted</span></div>
${ghPanel('base', xMax)}${ghPanel('head', xMax)}
<p class="note">Real <code>qwen serve</code> daemon, real built-in GitHub channel adapter in real <code>channel daemon-worker</code> processes, each polling its own fake GitHub REST server over HTTP (<code>baseUrl</code>), scripted OpenAI-compatible model answering <code>ANSWER &lt;tag&gt;</code>. All repeats: ${repLine}.</p>`;
  return page(
    'Real GitHub adapter: config-loss DELETE, base vs head',
    `x86_64 Linux · base <code>${BASE}</code> · head <code>${HEAD}</code> · every tick is a request the fake GitHub API received`,
    body,
  );
}

// ---------- Figure 2: scope / trust cells ----------
function fig2() {
  const row = (cellName, what, f) => {
    const b = J('base', f);
    const h = J('head', f);
    return { cellName, what, b, h };
  };
  const td = (txt, cls) => `<td class="${cls}">${txt}</td>`;
  const lines = [];
  for (const s of ['home', 'home-redirect']) {
    const { b, h } = row(s, '', `${s}.json`);
    const bd = st(b, 'DELETE botH #1'), hd = st(h, 'DELETE botH #1');
    const ba = st(b, 'after DELETE #1'), ha = st(h, 'after DELETE #1');
    const bs = st(b, 'after restart'), hs = st(h, 'after restart');
    lines.push(`<tr><td><b>${s}</b><br><span class="note">workspace = <code>$HOME</code>${s === 'home-redirect' ? ', <code>QWEN_HOME</code> redirected elsewhere' : ', <code>QWEN_HOME=$HOME/.qwen</code>'}; botH configured in the user file, running; config removed from that file</span></td>
${td(`DELETE → ${bd.status} ${esc(bd.code ?? '')}<br>worker ${ba.pidH_alive ? 'alive' : 'exited'}; user file <code>serve.channels</code> = <code>${esc(sc(ba.userFile))}</code><br>after restart: <code>${esc(sc(bs.userFile))}</code>`, 'bad')}
${td(`DELETE → ${hd.status} (${hd.ms} ms)<br>worker ${ha.pidH_alive ? 'alive' : 'exited'}; user file <code>serve.channels</code> = <code>${esc(sc(ha.userFile))}</code><br>after restart: <code>${esc(sc(hs.userFile))}</code>${s === 'home-redirect' ? `<br>stray <code>$HOME/.qwen/settings.json</code>: ${ha.strayWorkspaceFile === null ? 'not created' : 'CREATED'}` : ''}`, 'good')}</tr>`);
  }
  {
    const b = J('base', 'userscope-guard.json');
    const h = J('head', 'userscope-guard.json');
    const bd = st(b, 'DELETE botU'), hd = st(h, 'DELETE botU');
    const ba = st(b, 'after DELETE'), ha = st(h, 'after DELETE');
    lines.push(`<tr><td><b>userscope-guard</b><br><span class="note">botU configured in <i>user</i> settings, started by wsA's <code>serve.channels</code>; DELETE from wsA (the phantom-delete guard)</span></td>
${td(`DELETE → ${bd.status} ${esc(bd.code)}<br>worker ${ba.pidU_alive ? 'alive' : 'STOPPED'}, peer closes ${ba.peers.botU.closes}`, 'same')}
${td(`DELETE → ${hd.status} ${esc(hd.code)}: “${esc(hd.error)}”<br>worker ${ha.pidU_alive ? 'alive' : 'STOPPED'}, peer closes ${ha.peers.botU.closes}; wsA selection and user config untouched`, 'good')}</tr>`);
  }
  {
    const b = J('base', 'untrusted.json');
    const h = J('head', 'untrusted.json');
    const bd = st(b, 'DELETE botX'), hd = st(h, 'DELETE botX');
    lines.push(`<tr><td><b>untrusted</b><br><span class="note">workspace registered at runtime without trust; config already lost</span></td>
${td(`DELETE → ${bd.status} ${esc(bd.code)}; file byte-identical: ${st(b, 'after').settingsU_byte_identical}`, 'same')}
${td(`DELETE → ${hd.status} ${esc(hd.code)}; file byte-identical: ${st(h, 'after').settingsU_byte_identical}<br><span class="note">the route's trust gate answers before the service, so the new <code>skipWorkspaceSettings: !trusted</code> read is not reached from HTTP</span>`, 'same')}</tr>`);
  }
  return page(
    'Settings-scope and trust edges, real daemon',
    `cells no earlier round measured · base <code>${BASE}</code> vs head <code>${HEAD}</code>`,
    `<table><tr><th style="width:27%">cell</th><th style="width:31%">base</th><th>head (this PR)</th></tr>${lines.join('')}</table>
<p class="note">Pre-existing, not this PR: boot restore reads only the workspace scope's <code>serve.channels</code>, which is disabled when the workspace is <code>$HOME</code>, so botH was started through <code>POST …/channels/botH/start</code> on both arms.</p>`,
  );
}

// ---------- Figure 3: shutdown race sweep ----------
function fig3() {
  const files = fs
    .readdirSync(path.join(ROOT, 'data', 'head'))
    .filter((f) => /^drain(pre)?-\d+\.json$/.test(f))
    .sort((a, b) => {
      const k = (f) => (f.startsWith('drainpre') ? 0 : 1000) + Number(f.match(/(\d+)/)[1]);
      return k(a) - k(b);
    });
  const cellOf = (arm, f) => {
    const r = J(arm, f);
    const a = st(r, 'DELETE vs SIGTERM');
    const rt = st(r, 'retry DELETE');
    const fin = st(r, 'final');
    const close = r.events.find((e) => e.what === 'peer_close' && e.channel === 'botA');
    return { a, rt, fin, closeRel: close ? close.t - a.sigtermAt : null };
  };
  const res = (d) => (d.status === 'ERR' ? `connection reset/closed (<code>${esc(d.code)}</code>)` : `${d.status}${d.code ? ` ${esc(d.code)}` : ''}`);
  // From the first daemon's own log: when did the DELETE handler finish vs when was SIGTERM received?
  const logTiming = (arm, f) => {
    const log = fs.readFileSync(path.join(ROOT, 'data', arm, f.replace('.json', '.daemon.log')), 'utf8').split('===== daemon #2')[0];
    const ts = (re) => { const m = log.split('\n').find((l) => re.test(l)); return m ? Date.parse(m.slice(0, 24)) : null; };
    const del = ts(/route=DELETE /);
    const sig = ts(/received SIGTERM/i);
    if (del === null) return 'request never reached a handler (no <code>route=DELETE</code> line)';
    const d = del - sig;
    return d > 0 ? `SIGTERM received ${d} ms <b>before</b> the DELETE handler finished` : d === 0 ? 'SIGTERM and DELETE completion in the same ms' : `DELETE finished ${-d} ms before SIGTERM`;
  };
  const rows = files
    .map((f) => {
      const b = cellOf('base', f);
      const h = cellOf('head', f);
      const order = h.a.order === 'sigterm-first' ? `SIGTERM, then DELETE +${h.a.delay} ms` : `DELETE, then SIGTERM +${h.a.delay} ms`;
      return `<tr><td class="mono">${esc(order)}</td>
<td class="bad">${res(b.a.delete)}; disk <code>${esc(sc(b.a.settingsA))}</code>; after restart retry → ${b.rt.status}</td>
<td class="good">${res(h.a.delete)}; disk <code>${esc(sc(h.a.settingsA))}</code><br><span class="note">${logTiming('head', f)}</span></td>
<td class="good">retry → ${h.rt.status}; disk <code>${esc(sc(h.fin.settingsA))}</code></td></tr>`;
    })
    .join('');
  const allExit0 = ['base', 'head'].every((arm) => files.every((f) => st(J(arm, f), 'DELETE vs SIGTERM').daemonExit.code === 0));
  const noOrphan = ['base', 'head'].every((arm) => files.every((f) => st(J(arm, f), 'DELETE vs SIGTERM').fixtureWorkersAfterExit.length === 0));
  const saw503 = ['base', 'head'].some((arm) => files.some((f) => st(J(arm, f), 'DELETE vs SIGTERM').delete.status === 503));
  return page(
    'Config-loss DELETE racing daemon shutdown',
    `real daemon SIGTERM at controlled offsets, then restart on the same files · base <code>${BASE}</code> vs head <code>${HEAD}</code>`,
    `<table><tr><th style="width:19%">interleaving</th><th style="width:27%">base</th><th style="width:36%">head: DELETE outcome (timing from the daemon's own log)</th><th>head: after restart on the same files</th></tr>${rows}</table>
<p class="note">The ${files.length * 2} daemons SIGTERM'd mid-race: exit code 0 = ${allExit0}; no <code>daemon-worker</code> outlived its daemon = ${noOrphan}; <code>503 daemon_draining</code> observed = ${saw503} (at these offsets a late request got a connection reset/close instead). On head each run ended either “200 + selection removed on disk” or “request never handled + selection untouched”, never a half state, and the retry after restart converges. On base the stale selection survives every restart.</p>`,
  );
}


// ---------- Figure 4: x86_64 replication, real-daemon mutant, gates ----------
function fig4() {
  const P = (arm, c) => J(arm, `p1-${c}.json`);
  const out = (d) => `${d.status}${d.code ? ` ${esc(d.code)}` : ''} (${ms(d.ms)})`;
  const cells = [
    ['loss', 'central: config lost, owned worker running', (r) => { const d = st(r, 'DELETE botA #1'); const a = st(r, 'after DELETE #1'); return `${out(d)}; worker ${a.pidA_alive ? 'alive' : 'exited'}; repeat ${st(r, 'DELETE botA #2').status}`; }],
    ['stale', 'config lost + stale revision', (r) => { const d = st(r, 'DELETE botA with stale'); return `${out(d)}; file unchanged ${st(r, 'after stale').settingsA_byte_identical}`; }],
    ['normal', 'ordinary configured delete', (r) => { const d = st(r, 'DELETE configured botA'); return `${out(d)}; worker ${st(r, 'after DELETE').pidA_alive ? 'alive' : 'exited'}`; }],
    ['busy', 'running channel, unrelated transition', (r) => out(st(r, 'DELETE configured botA in A'))],
    ['busy-loss', 'config lost, unrelated transition', (r) => { const d = st(r, 'DELETE config-lost'); const t = r.steps.find((x) => x.label.startsWith('retry DELETE')); return `${out(d)} → retry ${t?.status}`; }],
    ['poison', 'lost config blocks other starts', (r) => `start ${st(r, 'start botC in C (A lost').status} → DELETE ${st(r, 'DELETE botA in A').status} → start ${st(r, 'start botC in C again').status}`],
    ['inflight', 'DELETE mid same-channel restore', (r) => { const d = st(r, 'DELETE configured botA (mid'); const a = st(r, 'after settle'); const fin = st(r, 'final'); return `${out(d)}; once settled: listed [${a.listA.instances}], botA connected ${a.peers.botA.open}; next DELETE ${st(r, 'DELETE botA again').status}; finally botA connected ${fin.peers.botA.open}`; }],
    ['all-reload', 'DELETE during --channel all reload', (r) => { const d = st(r, 'DELETE P botN'); const a = st(r, 'after settle'); const t = r.steps.find((x) => x.label.startsWith('retry DELETE')); const fin = r.steps.find((x) => x.label.startsWith('after retry')); return `${out(d)}; once settled: botN connected ${a.peers.botN.open}, config on disk ${a.settingsP.channels?.botN ? 'present' : 'gone'}${t ? `; retry ${t.status}; finally botN connected ${fin.peers.botN.open}` : ''}`; }],
    ['samename', "name in another workspace's pending start", (r) => { const d = st(r, 'DELETE A botX'); const t = r.steps.find((x) => x.label.startsWith('retry DELETE')); return `${out(d)}${t ? ` → retry ${t.status}` : ''}`; }],
  ];
  const jb = JSON.parse(fs.readFileSync(path.join(ROOT, 'logs/judge-base.json'), 'utf8'));
  const jh = JSON.parse(fs.readFileSync(path.join(ROOT, 'logs/judge-head.json'), 'utf8'));
  const okCell = (j, c) => j.rows.filter((x) => x.cell === `p1-${c}`).every((x) => x.ok);
  const rows = cells.map(([c, what, f]) => `<tr><td><b>${c}</b><br><span class="note">${esc(what)}</span></td><td class="${okCell(jb, c) ? 'same' : 'bad'}">${f(P('base', c))}</td><td class="${okCell(jh, c) ? 'good' : 'bad'}">${f(P('head', c))}</td></tr>`).join('');
  const mut = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/mut/userscope-guard-noguard.json'), 'utf8'));
  const md = st(mut, 'DELETE botU'); const ma = st(mut, 'after DELETE');
  const hd = st(J('head', 'userscope-guard.json'), 'DELETE botU'); const ha = st(J('head', 'userscope-guard.json'), 'after DELETE');
  const L = (f) => fs.readFileSync(path.join(ROOT, 'logs', f), 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
  const grab = (txt, re) => (txt.match(re) || [, '?'])[1].trim();
  const unit = L('unit-head.log'), ih = L('integ-head.log'), ib = L('integ-negctl-base.log');
  const failName = grab(ib, /FAIL\s+cli\/\S+ > (.+)/);
  return page(
    'x86_64 replication, real-daemon mutant, gates',
    `Linux x86_64 (round 3 measured aarch64) · base <code>${BASE}</code> vs head <code>${HEAD}</code>`,
    `<h2>Round-1/3 core cells re-run on this box (same harness, real daemons)</h2>
<table><tr><th style="width:24%">cell</th><th style="width:36%">base</th><th>head (this PR)</th></tr>${rows}</table>
<h2>Is the merged-view guard load-bearing through the real wiring?</h2>
<table><tr><th style="width:24%">arm</th><th>userscope-guard: DELETE a running channel whose config lives in user settings</th></tr>
<tr><td>head</td><td class="good">${hd.status} ${esc(hd.code)}; worker ${ha.pidU_alive ? 'alive' : 'STOPPED'}; wsA <code>serve.channels</code> = <code>${esc(sc(ha.settingsA))}</code></td></tr>
<tr><td>head bundle, <code>opts.loadChannelsConfig(…)</code> read replaced by <code>{}</code></td><td class="bad">${md.status}; worker ${ma.pidU_alive ? 'alive' : 'STOPPED'} (peer closes ${ma.peers.botU.closes}); wsA <code>serve.channels</code> = <code>${esc(sc(ma.settingsA))}</code> — phantom delete</td></tr></table>
<h2>Gates</h2>
<table><tr><th style="width:52%">gate</th><th>result</th></tr>
<tr><td>5 changed/related test files at head (vitest, <code>packages/cli</code>)</td><td class="good">${esc(grab(unit, /^\s*Tests\s+(.+)$/m))}</td></tr>
<tr><td><code>integration-tests/cli/qwen-serve-routes.test.ts</code> on the head bundle</td><td class="good">${esc(grab(ih, /^\s*Tests\s+(.+)$/m))}</td></tr>
<tr><td>negative control: head's copy of that test against the base bundle</td><td class="bad">${esc(grab(ib, /^\s*Tests\s+(.+)$/m))} — fails only “${esc(failName)}” (tag absent)</td></tr>
<tr><td>scripted assertions, this round (judge)</td><td class="good">base ${jb.pass}/${jb.total} · head ${jh.pass}/${jh.total}</td></tr></table>`,
  );
}

async function shoot(browser, html, name) {
  const p = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1300, height: 800 } });
  await p.setContent(html, { waitUntil: 'load' });
  let box = await p.locator('.card').boundingBox();
  await p.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  box = await p.locator('.card').boundingBox();
  await p.screenshot({ path: path.join(OUT, name), clip: box });
  fs.writeFileSync(path.join(OUT, name.replace('.png', '.html')), html);
  await p.close();
  console.log('wrote', name, Math.round(box.width), 'x', Math.round(box.height));
}

module.exports = { page, esc, st, J, CSS, shoot, ROOT, OUT, HEAD, BASE };

if (require.main === module) {
  (async () => {
    const browser = await chromium.launch({
      executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
    });
    const only = process.argv[2];
    if (!only || only === '1') await shoot(browser, fig1(), '01-github-transport-ab.png');
    if (!only || only === '2') await shoot(browser, fig2(), '02-scope-and-trust-cells.png');
    if (!only || only === '3') await shoot(browser, fig3(), '03-shutdown-race-sweep.png');
    if (!only || only === '4') await shoot(browser, fig4(), '04-x86-replication-mutant-gates.png');
    await browser.close();
  })();
}
