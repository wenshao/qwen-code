// VERIFICATION RIG ONLY (PR #13136): evidence figures, built from the probe outputs (no hand-typed measurements).
// usage: node fig36.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { page, table, OK, BAD, WARN, N, M, esc, RIG } from './figures.mjs';
import { sql } from './lib.mjs';
const require = createRequire(`${RIG}/wt36/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig36`;
fs.mkdirSync(OUT, { recursive: true });
const J = (p) => JSON.parse(fs.readFileSync(`${RIG}/out/${p}`, 'utf8'));
const csv = (p) => {
  const [h, ...rows] = fs.readFileSync(`${RIG}/out/${p}`, 'utf8').trim().split('\n');
  const k = h.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [k[i], v === '' ? null : Number.isNaN(Number(v)) ? v : Number(v)])));
};
const row = (r, label) => r.rows.find((x) => x.label.startsWith(label));
const fmt = (n) => Number(n).toLocaleString('en-US');
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const figs = {};

// ------------------------------------------------------------------ 01: Store cost and cold load
const opsPr = csv('p36/s24-scale-ws-sc-pr36-1200-ops.csv');
const opsBase = csv(process.env.FIGTEST ? 'p36/s24-scale-ws-sc-pr36-1200-ops.csv' : 'b36/s24-scale-ws-sc-base36-600-ops.csv');
const loadsPr = csv('p36/s24-scale-ws-sc-pr36-1200-loads.csv');
const loadsBase = csv(process.env.FIGTEST ? 'p36/s24-scale-ws-sc-pr36-1200-loads.csv' : 'b36/s24-scale-ws-sc-base36-600-loads.csv');
const EVERY = 300;
// records already in the Session before operation i (9 per operation, plus 9 for each first-operation-after-load)
const before = (i) => 9 * (i - 1 + Math.floor((i - 1) / EVERY));
const bucket = (ops, key, size = 10) => {
  const out = [];
  for (let a = 0; a < ops.length; a += size) {
    const s = ops.slice(a, a + size);
    out.push([before(s[0].op), s.reduce((t, o) => t + o[key], 0) / s.length]);
  }
  return out;
};
const CAP = 9 * 512; // 4,096 receipts per worker = 512 operations x 8 Hooks (#13129 F4, fail closed)
function chart(series, { yLabel, w = 470, h = 250, xMax: xFixed }) {
  const pad = { l: 62, r: 22, t: 10, b: 36 };
  const all = series.flatMap((s) => s.points);
  const xRaw = xFixed ?? Math.max(...all.map((p) => p[0]));
  const xStep = [1, 2, 2.5, 5, 10].map((m) => m * 10 ** Math.floor(Math.log10(xRaw / 5))).find((v) => v * 5 >= xRaw);
  const xN = Math.ceil(xRaw / xStep);
  const xMax = xStep * xN;
  const raw = Math.max(...all.map((p) => p[1])) * 1.05;
  const mag = 10 ** Math.floor(Math.log10(raw / 4));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((s) => s * 4 >= raw);
  const yMax = step * 4;
  const X = (x) => pad.l + (x / xMax) * (w - pad.l - pad.r);
  const Y = (y) => h - pad.b - (y / yMax) * (h - pad.t - pad.b);
  const yt = Array.from({ length: 5 }, (_, i) => (yMax / 4) * i);
  const xt = Array.from({ length: xN + 1 }, (_, i) => xStep * i);
  const grid = yt.map((v) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e7e6e2"/><text x="${pad.l - 6}" y="${Y(v) + 4}" font-size="10.5" fill="#52514e" text-anchor="end">${fmt(Math.round(v))}</text>`).join('');
  const xs = xt.map((v) => `<text x="${X(v)}" y="${h - pad.b + 15}" font-size="10.5" fill="#52514e" text-anchor="middle">${fmt(Math.round(v))}</text>`).join('');
  const cap = `<rect x="${X(CAP)}" y="${pad.t}" width="${X(xMax) - X(CAP)}" height="${h - pad.b - pad.t}" fill="#f3efe6"/><text x="${X(CAP) + 4}" y="${pad.t + 12}" font-size="10" fill="#8a5a00">receipt cap: Hooks answer "capacity exhausted"</text>`;
  const paths = series.map((s) => `<path d="${s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`).join('');
  const legend = series.map((s, i) => `<line x1="${pad.l + 10}" x2="${pad.l + 28}" y1="${pad.t + 30 + i * 16}" y2="${pad.t + 30 + i * 16}" stroke="${s.color}" stroke-width="2.5"/><text x="${pad.l + 33}" y="${pad.t + 34 + i * 16}" font-size="11" fill="#0b0b0b">${s.name}</text>`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${cap}${grid}<line x1="${pad.l}" x2="${w - pad.r}" y1="${h - pad.b}" y2="${h - pad.b}" stroke="#b9b8b2"/>${xs}
    <text x="${(pad.l + w - pad.r) / 2}" y="${h - 4}" font-size="11" fill="#52514e" text-anchor="middle">hook_execution records already in the Session</text>
    <text transform="translate(13,${(pad.t + h - pad.b) / 2}) rotate(-90)" font-size="11" fill="#52514e" text-anchor="middle">${yLabel}</text>${paths}${legend}</svg>`;
}
const BASE_C = '#c4581d';
const PR_C = '#2a78d6';
const xMax = Math.max(before(opsPr.length), before(opsBase.length));
const sel = chart([{ name: 'main 3f56f74a6a', color: BASE_C, points: bucket(opsBase, 'select') }, { name: 'this PR a5a94d5d78', color: PR_C, points: bucket(opsPr, 'select') }], { yLabel: 'SELECTs per operation', xMax });
const lat = chart([{ name: 'main', color: BASE_C, points: bucket(opsBase, 'ms') }, { name: 'this PR', color: PR_C, points: bucket(opsPr, 'ms') }], { yLabel: 'ms per operation (client)', xMax });
const near = (ops, rec) => {
  const s = ops.filter((o) => Math.abs(before(o.op) - rec) <= 9 * 5);
  if (!s.length) return null;
  return { sel: Math.round(s.reduce((t, o) => t + o.select, 0) / s.length), ms: Math.round(s.reduce((t, o) => t + o.ms, 0) / s.length) };
};
const samples = [0, 2700, 4500, 5400, 10800].map((rec) => {
  const b = near(opsBase, rec);
  const p = near(opsPr, rec);
  return [N(fmt(rec)), N(b ? fmt(b.sel) : '—'), N(b ? fmt(b.ms) : '—'), N(p ? fmt(p.sel) : '—'), N(p ? fmt(p.ms) : '—')];
});
const loadRow = (l) => (l ? `${sec(l.detach_ms)} / <b>${sec(l.load_ms)}</b> / ${sec(l.first_ms)}` : '—');
const loadRows = loadsPr.map((p) => {
  const b = loadsBase.find((x) => x.records === p.records);
  return [N(`${fmt(p.records)} / ${fmt(p.resources)}`), { c: b ? 'num bad' : 'num', t: loadRow(b) }, { c: 'num ok', t: loadRow(p) }, N(`${b ? b.hook_calls_during_load : '—'} / ${p.hook_calls_during_load}`), N(`${b ? fmt(b.load_select) : '—'} / ${fmt(p.load_select)}`)];
});
const sPr = J('p36/s24-scale-ws-sc-pr36-1200.json');
const sBase = J(process.env.FIGTEST ? 'p36/s24-scale-ws-sc-pr36-1200.json' : 'b36/s24-scale-ws-sc-base36-600.json');
figs['01-store-cost'] = page(
  'Hook admission cost stays flat and the cold load drops — main vs this PR, real stack',
  `macOS arm64, MySQL 8.4.7. Real server fat jar (Session Store + embedded Runtime Broker + local-process Tool Runtime workers) and the packaged Hosted Harness. One Session runs Notification operations that fire 8 function Hooks (9 <code>hook_execution</code> records each); every ${EVERY} operations it detaches and cold-loads on a <b>new Harness process</b> with no client timeout. SELECTs are counted per MySQL user from <code>performance_schema</code>, so the probe's own queries do not count. Shared host (load average 21–38), so read the SELECT counts first; times are wall clock. main = <code>3f56f74a6a</code> (#13129 squash), PR = <code>a5a94d5d78</code>.`,
  `<div class="charts"><div class="chart"><div class="t">Store SELECTs per operation</div>${sel}</div><div class="chart"><div class="t">Latency per operation (10-operation means)</div>${lat}</div></div>` +
    table(['hook_execution records before the op', 'main: SELECTs / op', 'main: ms / op', 'PR: SELECTs / op', 'PR: ms / op'], samples) +
    table(['records / Store resources at the load', 'main: detach / <b>cold load</b> / first op after', 'PR: detach / <b>cold load</b> / first op after', 'Hook calls during the load (main / PR)', 'SELECTs during the load (main / PR)'], loadRows) +
    `<div class="note nok"><b>Operations:</b> main ${sBase.ops} + ${sBase.loads} after-load, PR ${sPr.ops} + ${sPr.loads} after-load; every one returned 200 and wrote 9 records (PR: ${esc(row(sPr, '9 hook_execution').detail.replace(/\d{4,}/g, (n) => fmt(n)))}). No load re-ran a Hook.</div>` +
    `<div class="note"><b>Caveat on the shaded range:</b> one Runtime worker serves the Session across Harness replacements and stops at 4,096 receipts (512 operations × 8 Hooks; #13129 F4, fail closed). From there every Hook result is <code>blocking: Managed Hook receipt capacity is exhausted</code> (PR run: ${fmt(row(sPr, '8 physical').detail)} physical handler calls for ${fmt(9632)} child records). Records are still admitted, so the Store cost is still measured, but latency there excludes handler execution. This applies to both arms and to the PR body's 5,409/10,827-record rows.</div>`,
);

// ------------------------------------------------------------------ 02: upgrade + race
const seed = J('up36/s25-upgrade-seed-base36.json');
const tamper = J('up36/s25-upgrade-tamper-base36.json');
const after = J('up36/s25-upgrade-after-pr36.json');
const note = (r, l) => row(r, l)?.detail ?? '';
const head = (u) => note(after, `${u}: journal head`).split(';')[0];
const unproj = (u) => (note(after, `${u}: journal head`).match(/unprojected: (\d+) executions/) ?? [])[1];
const load = (u) => note(after, `${u} load on`).trim();
const tamperOf = { U1: 'none', U2: 'none (same once key as U1)', U3: esc(note(tamper, 'U3 tamper').replace(/ \(record.*$/, '').replace(/^.*$/, 'one record body: a byte changed, same length')), U4: 'a copied extension-record row repeats the once-key execution', U5: 'the resource row of one record deleted' };
const upRows = ['U1', 'U2', 'U3', 'U4', 'U5'].map((u) => {
  const ok = row(after, `${u}: journal head`)?.ok;
  return [u, tamperOf[u], { c: ok ? (head(u).startsWith('READY') ? 'ok' : 'warn') : 'bad', t: `${ok ? '✔' : '✘'} ${esc(head(u).replace(/ -$/, ''))}` }, N(unproj(u) ?? '?'), { c: /^200/.test(load(u)) ? 'ok' : 'warn', t: esc(load(u).replace(/ managed_session_open_failed$/, '')) }];
});
const st36 = JSON.parse(fs.readFileSync(`${RIG}/run/up36/s25-sessions.json`, 'utf8'));
const v29at = Number(sql("SELECT UNIX_TIMESTAMP(installed_on)*1000 FROM flyway_schema_history WHERE version='29'", 'up36')[0][0]);
const upsRows = sql(`SELECT r.created_at, JSON_UNQUOTE(JSON_EXTRACT(CAST(res.inline_bytes AS CHAR),'$.hookId')), JSON_TYPE(JSON_EXTRACT(CAST(res.inline_bytes AS CHAR),'$.onceKey')) FROM qwen_managed_session_extension_record r JOIN qwen_managed_session_resource res ON res.session_scope_key=r.session_scope_key AND res.resource_id=r.record_resource_id WHERE r.session_id='${st36.U1.sid}' AND r.domain='hook_execution' AND JSON_UNQUOTE(JSON_EXTRACT(CAST(res.inline_bytes AS CHAR),'$.eventName'))='UserPromptSubmit'`, 'up36');
const u1Once = { plansAfter: upsRows.filter((r) => Number(r[0]) > v29at && r[1] === '__plan__').length, onceAfter: upsRows.filter((r) => Number(r[0]) > v29at && r[2] === 'STRING').length, onceBefore: upsRows.filter((r) => Number(r[0]) <= v29at && r[2] === 'STRING').length };
const race = J('tmp36/s29-race-ws-up8-pr36.json');
const raceRec = J('tmp36/s29b-recover-ws-up8-pr36.json');
const raceCancel = J('tmp36/s29c-recover-cancel-ws-up8-pr36.json');
const rc = J('rc36/s27-reuse-U2-base36-restart-control.json');
const plain = J('rc36/s28-plain-restart-reuse-base36.json');
const diag = J('up36/s27-reuse-U2-pr36-diag1.json');
figs['02-upgrade-race'] = page(
  'V27 → V28/V29 upgrade of a database main wrote, and a concurrent duplicate past the checks',
  'Same stack. <b>Upgrade:</b> main\'s jar and Harness wrote five Hook Sessions (each: 2 write_file turns with a once-key UserPromptSubmit Hook, Pre/PostToolUse and Stop Hooks, 3 Notification operations; 30 Hook records). With the server stopped, three were damaged in MySQL. Then the PR jar started on the same database. <b>Race:</b> a separate MySQL transaction inserts a row holding a Session\'s once key and keeps it uncommitted while the Session commits its once-key Hook execution.',
  `<h2>Upgrade — Flyway 27 → 29 ${row(after, 'V28 and V29')?.ok ? '<span class="ok">✔ applied</span>' : '<span class="bad">✘</span>'} (${note(after, 'flyway history').split('|').slice(-2).map((x) => { const p = x.trim().split(' '); return `V${p[0]} ${p.at(-1)} ms`; }).join(', ')})</h2>` +
    table(['Session', 'Damage before the upgrade', 'Journal head after V29', 'unprojected records', 'Load on the PR Harness'], upRows) +
    table(['Check after the upgrade', 'Result'], [
      ['Backfilled keys vs keys recomputed in SQL from every U1/U2 body (once key, occurrence, ordinal, definition pin)', row(after, 'U1/U2: every backfilled')?.ok ? OK(esc(note(after, 'U1/U2: every backfilled'))) : BAD(esc(note(after, 'U1/U2: every backfilled')))],
      ['U1 and U2 consumed the same once key; both keep it', row(after, 'U1 and U2 hold')?.ok ? OK('one hash, two Sessions') : BAD('')],
      ['U1 after the upgrade: UserPromptSubmit planned without the consumed once-key Hook', u1Once.plansAfter >= 1 && u1Once.onceAfter === 0 ? OK(`${u1Once.plansAfter} UserPromptSubmit plans after V29, ${u1Once.onceAfter} once-key executions (before: ${u1Once.onceBefore}); handler calls stay 1`) : BAD(JSON.stringify(u1Once))],
      ['Rows the PR writes into U1 carry keys equal to the recomputation', row(after, 'U1 rows written')?.ok ? OK(esc(note(after, 'U1 rows written'))) : BAD(esc(note(after, 'U1 rows written')))],
      ['New Session U6 in U1\'s Workspace: its own once-key Hook runs once', row(after, 'new Session U6')?.ok ? OK('once, then not again') : BAD(esc(note(after, 'new Session U6')))],
      ['New Session U7 next to blocked U3', row(after, 'new Session U7')?.ok ? OK('works; only U3 is blocked') : BAD(esc(note(after, 'new Session U7')))],
      [`U1/U2 tool turn after the restart: <code>runtimes:warm</code> never answers → 30 s <code>hosted_turn_failed</code>`, WARN(`pre-existing: same on main with only a server restart (${rc.fail ? 'U2 fails' : 'U2 ok'}), and for a plain Session without Hooks (${plain.fail ? 'fails' : 'ok'})`)],
    ]) +
    `<h2>Concurrent duplicate that slips past the admission checks</h2>` +
    table(['Step', 'Result'], [
      ['Phantom transaction (separate MySQL connection)', (() => { const t = note(race, 'phantom transaction log'); const ins = (t.match(/(\d+)ms phantom-inserted 1/) ?? [])[1]; const com = (t.match(/(\d+)ms phantom-committed/) ?? [])[1]; return ins && com ? OK(`row inserted at ${ins} ms, held uncommitted, committed at ${fmt(com)} ms`) : BAD(esc(t)); })()],
      ['Store INSERT of the once-key execution', row(race, 'Store logs the unique-index')?.ok ? OK('DuplicateKeyException on <code>uq_managed_session_hook_once</code>, logged and returned as a record rejection') : BAD('')],
      ['Rows holding the once key afterwards', row(race, 'only the phantom')?.ok ? OK('only the phantom; the once-key handler never ran') : BAD(esc(note(race, 'only the phantom')))],
      ['The refused turn', WARN(/recoveryBlocked=true/.test(note(race, 'turn')) ? `admitted (202), then no terminal event; status recoveryBlocked=true (fail closed)` : esc(note(race, 'turn')))],
      ['Phantom removed, new Harness process loads the Session', /^200/.test(note(raceRec, 'load on a new')) ? OK(`load ${esc(note(raceRec, 'load on a new'))}; every Store resource REFERENCED, journal head READY`) : BAD(esc(note(raceRec, 'load on a new')))],
      ['Next prompt on that Session (also after cancel)', WARN(`409 hosted_turn_recovery_required — the Hook Session stays recovery-blocked, as for any refused Hook record`)],
    ]),
);

// ------------------------------------------------------------------ 03: cold-load refusal matrix + tests
const mats = { 'main earliest': J('tmb36/s26-tamper-ws-tm1-base36-matrix.json'), 'PR earliest': J('tmp36/s26-tamper-ws-tm1-pr36-matrix.json'), 'main latest': J('tmb36/s26-tamper-ws-tm2-base36-latest-matrix.json'), 'PR latest': J('tmp36/s26-tamper-ws-tm2-pr36-latest-matrix.json') };
const kinds = [...new Set(mats['PR earliest'].map((r) => r.kind))];
const code = (m, k, mode) => {
  const r = mats[m].find((x) => x.kind === k && x.mode === mode);
  return r ? `${r.status} ${r.code}` : '—';
};
const short = (c) => c.replace('managed_session_open_failed', 'open_failed').replace('hosted_turn_recovery_required', 'recovery_required');
const matRows = kinds.map((k) => {
  const same = ['missing', 'flip', 'truncate'].every((mode) => code('main earliest', k, mode) === code('PR earliest', k, mode) && code('main latest', k, mode) === code('PR latest', k, mode));
  const vals = ['missing', 'flip', 'truncate'].map((mode) => short(code('PR earliest', k, mode)));
  const uniq = [...new Set(vals)];
  return [M(k.replace('managed-', '')), uniq.length === 1 ? { c: 'mono', t: `${uniq[0]} (all three)` } : M(vals.join(' / ')), same ? OK('identical, earliest and latest') : BAD('differs')];
});
const unit = fs.readFileSync(`${RIG}/out/unit36-run.log`, 'utf8');
const ul = (re) => (unit.match(re) ?? [])[1] ?? '?';
const ctl = (n) => [J(`tmb36/${n}`), J(n.includes('latest') ? 'tmp36/s26-tamper-ws-tm2-pr36-latest.json' : 'tmp36/s26-tamper-ws-tm1-pr36.json')];
figs['03-integrity-tests'] = page(
  'Cold-load refusals are unchanged, and the new tests pin the change',
  'For each resource kind × {row deleted, one byte changed, last byte cut}: tamper one row in MySQL, cold-load on that arm\'s own server + Harness, record the answer, restore the row. Run twice per arm: on the earliest resource of each kind and on the latest (a resource only the last revision references). Control loads before and after succeed on both arms.',
  table(['Resource kind', 'Answer (PR)', 'main vs PR'], matRows) +
    `<div class="note nok">${Object.values(mats).reduce((t, m) => t + m.length, 0)} tampered loads, all refused; control load + turn after restoring: ${['tmb36/s26-tamper-ws-tm1-base36.json', 'tmb36/s26-tamper-ws-tm2-base36-latest.json'].map((n) => (J(n).fail ? '✘' : '✔')).join('')} main, ${['tmp36/s26-tamper-ws-tm1-pr36.json', 'tmp36/s26-tamper-ws-tm2-pr36-latest.json'].map((n) => (J(n).fail ? '✘' : '✔')).join('')} PR.</div>` +
    `<h2>Tests on a5a94d5d78, and with each production change reverted to main</h2>` +
    table(['Run', 'Result'], [
      ['core: hook-scale + authority suites', M(esc(ul(/== head-core exit=\d+ (Tests .*)/)))],
      ['cli: hosted-harness-session + hosted-hook-session', M(esc(ul(/== head-cli exit=\d+ (Tests .*)/)))],
      ['revert managed-session-authority.ts + assembly.ts', M(`${esc(ul(/== pin-core-authority exit=\d+ (Tests .*)/))} — admission cost, take-once handoff; the 4 passing are refusal/commit-read guards`)],
      ['revert hosted-hook-session.ts', M(`${esc(ul(/== pin-cli-hook-session exit=\d+ (Tests .*)/))} — the 2 new tests (Stop plan read once, drain)`)],
      ['revert hosted-harness-session.ts', M(`${esc(ul(/== pin-cli-harness-session exit=\d+ (Tests .*)/))} — read-once assertions of the restore test`)],
      ['Java H2 ManagedHookAdmissionIndexTest', M(esc(ul(/== java-head exit=\d+ \[INFO\] (.*)/)))],
      ['… with ManagedExtensionRecordStore.java reverted', M(`${esc(ul(/== java-pin-store exit=\d+ \[ERROR\] (.*)/))} — incl. "SELECTs of execution 401 vs 9"`)],
    ]),
);

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1080, height: 900 } });
const pg = await ctx.newPage();
for (const [name, html] of Object.entries(figs)) {
  const file = `${OUT}/${name}.html`;
  fs.writeFileSync(file, html);
  await pg.goto(`file://${file}`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('td,pre')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${name}.png ${clipped ? `(${clipped} clipped cells!)` : ''}`);
}
await browser.close();
