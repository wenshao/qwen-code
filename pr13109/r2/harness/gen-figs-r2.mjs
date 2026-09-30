// Round 2 cards for PR 13109 (real model, cross-host, multi-instance, R2-1),
// generated from RESULT lines; no number is typed by hand.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const S = path.resolve(import.meta.dirname, '..');
const res = (file) => {
  if (!existsSync(file)) throw new Error('missing ' + file);
  const line = readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('RESULT ')).at(-1);
  if (!line) throw new Error('no RESULT in ' + file);
  return JSON.parse(line.replace(/^RESULT \S+ /, ''));
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ev = (t) => {
  let m;
  if ((m = /^S (.+)→(\d+)(?:!(.+))?$/.exec(t))) return `<span class="s">commit</span> ${esc(m[1].replace(/:/g, '='))}${m[2] !== '200' ? ` <span class="bad">${m[2]}</span>` : ''}`;
  if ((m = /^B (\S+?):(\d+)(?:!(\S+))?(?: (.*))?$/.exec(t))) {
    const [, name, status, fault, extra] = m;
    const bad = Number(status) >= 400 || status === '0';
    const label = name.replace('owner-acquire', 'acquire').replace('owner-release', 'release');
    const tail = fault ? (status === '200' ? ' <span class="warn">reply dropped</span>' : ' <span class="warn">not forwarded</span>') : '';
    const st = extra ? ` ${esc(extra)}` : '';
    return `<span class="b">${esc(label)}</span> <span class="${bad ? 'bad' : 'ok'}">${status === '0' ? 'timeout' : status}</span>${/unknown|409|conflict|not_|timeout|reconcil/.test(st) ? `<span class="bad">${st}</span>` : `<span class="dim">${st}</span>`}${tail}`;
  }
  return esc(t);
};
const tl = (list) => {
  const out = [];
  for (const t of list ?? []) { const l = out.at(-1); if (l && l.t === t) l.n++; else out.push({ t, n: 1 }); }
  return out.map((x) => ev(x.t) + (x.n > 1 ? ` <span class="dim">×${x.n}</span>` : '')).join(' · ') || '<span class="dim">no Broker request</span>';
};
const st = (s) => `<span class="${String(s).startsWith('204') ? 'ok' : 'bad'}">${esc(String(s ?? '—').replace(':managed_session_close_failed', ''))}</span>`;
const seq = (list) => list.map((d) => st(d.status)).join(' → ');
const page = (title, sub, body, note) => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.5 -apple-system,Helvetica,Arial,sans-serif}
#card{width:1560px;padding:26px 30px 24px;background:#0d1117}
h1{font-size:23px;margin:0 0 4px}.sub{color:#8b949e;margin:0 0 14px;font-size:14.5px}h3{font-size:16px;margin:16px 0 4px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#161b22;color:#8b949e;font-weight:600}td.m{font:12.5px/1.55 ui-monospace,Menlo,monospace}
.ok{color:#3fb950}.bad{color:#ff7b72}.warn{color:#d29922}.dim{color:#8b949e}.b{color:#79c0ff}.s{color:#d2a8ff}
.note{border-left:3px solid #1f6feb;padding:6px 12px;margin-top:14px;color:#c9d1d9;font-size:14.5px}
</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}${note ? `<div class="note">${note}</div>` : ''}</div>`;

// ---- card 5: real model ----
const rm = (arm, name) => res(`${S}/runs/${arm}/${name}.log`);
const rmRow = (label, r) => `<tr><td>${label}</td><td class="m">${esc(r.arm)} · ${esc(r.model)}</td><td class="m">${(r.turn1.toolResults ?? []).map(esc).join('<br>')}</td><td class="m">${seq(r.detach)}${r.detach.some((d) => d.then) ? `<br><span class="dim">${esc(r.detach.find((d) => d.then).then)}</span>` : ''}<br>${tl(r.detach.at(-1).timeline)}</td><td class="m">${r.fresh ? `turn ${esc(r.fresh.turn.admit)} ${esc(r.fresh.turn.terminal ?? '')}<br>${(r.fresh.turn.toolResults ?? []).length} tool results` : ''}</td></tr>`;
const card5 = page(
  'PR #13109 round 2 · real model (qwen3.8-flash) drives the MCP turns before each release fault',
  'macOS rig, MySQL 8.4.11. The model is asked to call the side-effect tool of every pinned server with a per-run tag; the tags are read back from the MCP servers\' ledger. Then detach with a fault on the release path, and a fresh Session on the same Workspace runs another real turn.',
  `<table><tr><th style="width:21%">Case</th><th style="width:11%">build</th><th style="width:19%">turn 1: tool results</th><th>detach attempts · the last one</th><th style="width:14%">fresh Session, same Workspace</th></tr>
${rmRow('first <code>mcp-release</code> not delivered, 1 server', rm('br', 'rm-undelivered-1'))}
${rmRow('same', rm('hr', 'rm-undelivered-1'))}
${rmRow('owner release ack lost, 2 servers, then a new Harness', rm('hr', 'rm-lostack-2'))}
${rmRow('stdout held 45 s (sticky + HTTP)', rm('hr', 'rm-sticky-remote'))}
</table>`,
  'With a real model the release paths behave exactly as with the scripted one. On base the stuck one-server Session also blocks the Workspace: the fresh Session\'s real-model turn is refused (503 <code>hosted_prompt_admission_failed</code>). The sticky row\'s fresh Session detaches with 503 right after its own turn because its pipe is held again, as designed.',
);

// ---- card 6: cross-host ----
const X = (n) => ({ a: res(`${S}/runs/r2c/h98/${n}-A.log`), b: res(`${S}/runs/r2c/h87/${n}-B.log`) });
const xRow = (label, n) => {
  const { a, b } = X(n);
  const last = b.detachB.at(-1);
  return `<tr><td>${label}</td><td class="m">${esc(a.arm)} on .98<br>${st(a.detachA.status)} then SIGKILL</td><td class="m">${esc(b.arm)} on .87<br>load ${esc(b.load.status)} · ${seq(b.detachB)}</td><td class="m">${tl(last.timeline)}</td><td class="m">holder ${last.holder === 'free' ? '<span class="ok">free</span>' : '<span class="bad">held</span>'}</td></tr>`;
};
const card6 = page(
  'PR #13109 round 2 · cross-host recovery: the Harness host dies mid-detach, another host takes the Session over',
  'Spring store + Broker + durable workers + MariaDB 10.11.18 on 192.168.0.54 (Linux arm64, JDK 21). Harness A on 192.168.0.98 (macOS arm64): turn, detach with a fault, then its Harness is SIGKILLed. Harness B on 192.168.0.87 (macOS x86_64) loads the Session after the 60 s writer lease and detaches. Rows marked ⟳ also restart the Broker JVM (worker survives) between A and B.',
  `<table><tr><th style="width:24%">Case</th><th style="width:13%">host A</th><th style="width:18%">host B</th><th>last detach on host B</th><th style="width:8%">after</th></tr>
${xRow('first <code>mcp-release</code> not delivered, 1 server', 'x1-undelivered')}
${xRow('owner release ack lost, 2 servers', 'x2-lostack')}
${xRow('stdout held 45 s (sticky + HTTP)', 'x3-sticky')}
${xRow('⟳ R1-1: drained, owner release not delivered', 'x4-r1-1-head')}
${xRow('⟳ R1-1, host B runs the suggested retry', 'x4-r1-1-cand')}
${xRow('⟳ R2-1 shape: base writer, ack lost (durable Broker)', 'x5-r2-1-durable')}
</table>`,
  'Recovery crosses hosts and CPU architectures with the same owner and release identity. R1-1 reproduces unchanged when the recovering Harness is on another host; the suggested retry fixes it there too. With durable workers the R2-1 shape recovers (acquire adopts, then 409 <code>runtime_session_not_acquirable</code> allows the owner release).',
);

// ---- card 7: multi-instance + R2-1 ----
const M = (dir, n) => res(`${S}/runs/${dir}/${n}.log`);
const mRow = (label, r, key = 'detach') => `<tr><td>${label}</td><td class="m">${esc(r.arm)}</td><td class="m">${seq(r[key])}</td><td class="m">${tl(r[key].at(-1).timeline)}</td></tr>`;
const r9h = res(`${S}/runs/hx/r9-head-restart.log`);
const r9b = res(`${S}/runs/hx/r9-base-restart.log`);
const r9n = res(`${S}/runs/hx/r9-head-none.log`);
const nw = (r) => `<tr><td>${r.break === 'none' ? 'no restart (control)' : 'Broker restarted, non-durable'}</td><td class="m">${esc(r.arm)}</td><td class="m">${seq(r.newWriter)} <span class="dim">(${r.newWriter.map((d) => d.seconds + ' s').join(', ')})</span></td><td class="m">${tl(r.newWriter.at(-1).timeline)}<br><span class="dim">Workspace holder ${esc(r.newWriter.at(-1).holder)}</span></td></tr>`;
const card7 = page(
  'PR #13109 round 2 · several store / Broker instances, and review thread R2-1',
  'Two Spring instances (store + Broker) on 192.168.0.54 share MariaDB, the Workspace roots and the durable worker state. Harness on 192.168.0.98 or on this Mac; the rig proxies choose the instance per request.',
  `<h3>Two store instances, requests alternated (≈50/50 by the store ledger); one Broker</h3><table><tr><th style="width:30%">Case</th><th style="width:8%">build</th><th style="width:16%">detach</th><th>last detach</th></tr>
${mRow('first <code>mcp-release</code> not delivered, 1 server', M('r2c/h98', 'm1-store-rr-undelivered-1'))}
${mRow('owner release ack lost, 2 servers', M('r2c/h98', 'm1-store-rr-lostack-2'))}
${mRow('no fault, 3 servers', M('r2c/h98', 'm1-store-rr-none-3'))}
</table>
<h3>Two Broker instances: the drain receipt is committed on B1, the owner release does not arrive</h3><table><tr><th style="width:30%">Then</th><th style="width:8%">build</th><th style="width:16%">detach</th><th>last detach</th></tr>
${mRow('B1 killed, every request goes to B2', M('multi', 'mf2-failover-head'))}
${mRow('same', M('multi', 'mf2-failover-cand'))}
${mRow('same', M('multi', 'mf2-failover-base'))}
${mRow('B1 alive, requests alternate B2, B1', M('multi', 'mf-rr-head'))}
${mRow('B1 alive, owner release always sent to B2', M('r2c/h98', 'm2-release2-head'))}
${mRow('same', M('r2c/h98', 'm2-release2-cand'))}
${mRow('same', M('r2c/h98', 'm2-release2-base'))}
</table>
<h3>R2-1: base writer lost the owner-release ack (records <code>releasing</code>, Broker row RELEASED), then a new Harness (macOS, default provisioner)</h3><table><tr><th style="width:30%">Broker</th><th style="width:8%">new writer</th><th style="width:16%">detach</th><th>last detach</th></tr>
${nw(r9h)}${nw(r9b)}${nw(r9n)}
</table>`,
  'Failover to a peer Broker is R1-1 without a restart: the peer answers 503 <code>runtime_reconciliation_required</code> until someone acquires, and only the candidate and base acquire. When the release keeps landing on an instance that does not hold the live Session, no build recovers, so the Broker tier needs Session affinity regardless of this PR. R2-1: after a restart the non-durable Broker answers acquire only after about 121 s (503 <code>runtime_broker_reconcile_timeout</code>), so the Harness hits its own 30 s request timeout; the PR cannot close the Session, base closes it with one release. The Workspace itself is already free.',
);

const out = { '05-real-model.html': card5, '06-cross-host.html': card6, '07-multi-instance-and-r2-1.html': card7 };
for (const [name, html] of Object.entries(out)) writeFileSync(`${S}/fig/${name}`, html);
const require = createRequire(`${S}/wt-head/package.json`);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1640, height: 1200 } });
for (const name of Object.keys(out)) {
  const p = await ctx.newPage();
  await p.goto(`file://${S}/fig/${name}`);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('td.m')].filter((el) => el.scrollWidth > el.clientWidth + 1).length);
  await p.locator('#card').screenshot({ path: `${S}/fig/${name.replace('.html', '.png')}` });
  console.log(name, 'clipped cells:', clipped);
}
await browser.close();
