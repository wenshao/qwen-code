// Round-3 card: bot round-6 probe findings re-checked on the real stack (head unchanged, 5cd1c832f4).
import fs from 'node:fs';
import { createRequire } from 'node:module';

const RIG = '/Users/wenshao/pr13214-rig';
const R = (f) => JSON.parse(fs.readFileSync(`${RIG}/results/${f}.json`, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = fs.readFileSync(`${RIG}/fig/gen.mjs`, 'utf8').match(/const css = `([\s\S]*?)`;/)[1];
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div></body></html>`;
const G = (s) => `<span class="good">${s}</span>`;
const B = (s) => `<span class="bad">${s}</span>`;
const W = (s) => `<span class="warn">${s}</span>`;

const stress = fs.readFileSync(`${RIG}/logs/stress.status`, 'utf8').trim().split('\n').filter((l) => l.includes('RESULT'));
const sum = (arm) => stress.filter((l) => l.startsWith(arm + ' ')).reduce((a, l) => {
  const m = l.match(/runs=(\d+) red=(\d+)/); return { runs: a.runs + +m[1], red: a.red + +m[2] };
}, { runs: 0, red: 0 });
const order = fs.readFileSync(`${RIG}/logs/order.status`, 'utf8').trim().split('\n');
const maria = fs.readFileSync(`${RIG}/logs/order-maria.status`, 'utf8').trim().split('\n');
const it = (lines, re) => { const sel = lines.filter((l) => re.test(l)); return { n: sel.length, red: sel.filter((l) => l.includes('exit=1')).length }; };
const sh = sum('head'), s1 = sum('mut'), s2 = sum('mut2');
const ih = it(order, /^head/), i1 = it(order, /^mut run/), i2 = it(order, /^mut2 run/);
const mh = it(maria, /^head/), m1 = it(maria, /^mut run/);
const raceH = R('race-head-l0'), race1 = R('race-mut-l0'), race2 = R('race-mut2-l0');

let t = `<h2>Read-order mutants vs every oracle — this settles D6-8 against round 2's G1</h2>
<table><tr><th>oracle</th><th>head</th><th>M1: extra consistent read <i>added</i> before FOR UPDATE</th><th>M2: the execution read <i>hoisted</i> before FOR UPDATE (bot D6-8)</th></tr>
<tr><td>two-JVM race, real MySQL 8.4.7 (REPEATABLE READ), 300 rounds</td><td class="mono good">${raceH.contradictions} contradictions</td><td class="mono bad">${race1.contradictions} contradictions</td><td class="mono bad">${race2.contradictions} contradictions</td></tr>
<tr><td>PR's H2 stress <code>concurrentCrossProcessAdmitAndReleaseNeverContradict</code>, ${sh.runs} runs each, host load 100–150</td><td class="mono good">${sh.red}/${sh.runs} red</td><td class="mono bad">${s1.red}/${s1.runs} red — invisible to H2</td><td class="mono good">${s2.red}/${s2.runs} red — H2 catches it</td></tr>
<tr><td>candidate InnoDB IT · MySQL 8.4.7</td><td class="mono good">${ih.n - ih.red}/${ih.n} green</td><td class="mono good">${i1.red}/${i1.n} red</td><td class="mono good">${i2.red}/${i2.n} red</td></tr>
<tr><td>candidate InnoDB IT · MariaDB 10.11.18 (round 2)</td><td class="mono good">${mh.n - mh.red}/${mh.n} green</td><td class="mono good">${m1.red}/${m1.n} red</td><td class="mono dim">not run</td></tr></table>
<div class="note">Both readings were half right. H2 runs these connections at READ COMMITTED, where every statement sees the latest commit: a <b>hoisted</b> read (M2) loses the race on H2 too, so the PR's stress test catches it (bot D6-8 is right). An <b>added</b> read (M1) only matters under InnoDB REPEATABLE READ, because the first consistent read freezes the snapshot; on H2 the later read still sees the admission, so all 30 stress runs stay green (round 2's G1 is right). The comment "H2 would not show it" is wrong for M2 and right for M1. The candidate IT kills both deterministically.</div>`;

const sm = R('spring-matrix-head-r3');
const mm = R('spring-matrix-merge-r3');
const win = (rows, n) => { const r = rows.find((x) => x.name.startsWith(n)); return r.outcome === 'started' ? (r.broker.match(/\(v3 result window [^)]+\)/) ?? [''])[0] : 'startup refused'; };
t += `<h2>R1-2 / D6-4 — suffix-less window on the real Spring server</h2><table><tr><th>QWEN_MANAGED_AGENT_RUNTIME_BROKER_V3_RESULT_WINDOW</th><th>head 5cd1c832f4</th><th>head + main 6136786c0c (trial merge)</th></tr>
<tr><td class="mono">500</td><td class="mono good">startup refused (&lt; PT1S)</td><td class="mono good">${esc(win(mm, 'V3_RESULT_WINDOW=500'))}</td></tr>
<tr><td class="mono">1800 (meant as 30 min)</td><td class="mono bad">${esc(win(sm, 'V3_RESULT_WINDOW=1800'))}</td><td class="mono bad">${esc(win(mm, 'V3_RESULT_WINDOW=1800'))}</td></tr>
<tr><td class="mono">3600</td><td class="mono bad">${esc(win(sm, 'V3_RESULT_WINDOW=3600'))}</td><td class="dim">—</td></tr></table>`;

t += `<h2>Bot round 6 probe findings vs the real stack</h2><table><tr><th>finding</th><th>real-stack status</th></tr>
<tr><td>D6-8 "H2 would not show a reordering" measured false</td><td>${W('confirmed for a hoisted read, not for an added one')} — see above</td></tr>
<tr><td>D6-7 renewal pool survives one stall, not two</td><td>${G('confirmed')} — rounds 1 and 2: one parked renewal → healthy execution SETTLED; two → UNKNOWN</td></tr>
<tr><td>R1-2 / D6-4 suffix-less 1800 binds as PT1.8S and is accepted</td><td>${G('confirmed')} on the real Spring server (startup log shows the window)</td></tr>
<tr><td>D6-3 settlement blocks the coordination thread; D6-6 managed-context drain exit untested</td><td class="dim">not reproduced here (v3 publication / managed-context placement); unit-level probes only</td></tr></table>`;
t += '<div class="note">Head unchanged since round 2. Trial merge with today\'s main (6136786c0c: Druid pool swap, V35 migration, harness changes) is clean; qwencode + runtime-broker + managed-agent-server build, fix-adjacent tests 19/19, and the Spring startup subset (non-loopback refusal, opt-in, window floor, port message) behaves exactly as on head.</div>';

const require = createRequire('/Users/wenshao/git/qwen-code-x9/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1280, height: 900 } });
const name = '09-round6-probes';
const file = `${RIG}/fig/${name}.html`;
fs.writeFileSync(file, page('Bot round-6 probe findings, re-checked on the real stack', 'Round 3 · head still 5cd1c832f4 · read-order mutants M1/M2, Spring window binding, trial merge with main', t));
const p = await ctx.newPage();
await p.goto('file://' + file);
const clipped = await p.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
await p.locator('#card').screenshot({ path: `${RIG}/fig/${name}.png` });
console.log(name, 'clipped elements:', clipped, JSON.stringify({ sh, s1, s2, ih, i1, i2, mh, m1 }));
await browser.close();
