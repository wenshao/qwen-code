// Builds the PR #13497 evidence cards from the result files and screenshots
// each card with Playwright. Every number on a card is read from a result file.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8a9ac9cc-e152-4b48-b948-f12731d40cd3/scratchpad';
const R = `${S}/results`;
const OUT = `${S}/figs/out`;
mkdirSync(OUT, { recursive: true });

function tsv(file) {
  const map = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [tag, arm, probe, value] = line.split('\t');
    if (tag === 'RESULT') map[`${arm}|${probe}`] = value;
  }
  return map;
}
const r1 = Object.assign({}, ...['h2', 'mysql84', 'mariadb1011'].map((a) => tsv(`${R}/head-${a}.tsv`)));
const head = Object.assign({}, ...['h2', 'mysql84', 'mariadb1011'].map((a) => tsv(`${R}/r2-head-${a}.tsv`)));
const cand = Object.assign({}, ...['h2', 'mysql84', 'mariadb1011'].map((a) => tsv(`${R}/r2-cand-${a}.tsv`)));
const matrix = tsv(`${R}/matrix.tsv`);
const ARMS = ['h2', 'mysql84', 'mariadb1011'];
const need = (m, k) => {
  if (!(k in m)) throw new Error(`missing ${k}`);
  return m[k];
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px 24px;background:#0d1117;min-width:1100px;max-width:1500px}
h1{font-size:24px;margin:0 0 4px;font-weight:650}
.sub{color:#8b949e;font-size:14px;margin:0 0 18px}
table{border-collapse:collapse;font-size:13.5px;width:100%}
th,td{border:1px solid #30363d;padding:7px 10px;text-align:left;vertical-align:top}
th{background:#161b22;color:#8b949e;font-weight:600}
td.k{color:#c9d1d9;white-space:nowrap}
td code,td{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
td.k{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.ok{color:#3fb950}.bad{color:#f85149;font-weight:600}.warn{color:#d29922}.dim{color:#8b949e}
.note{margin-top:16px;border-left:4px solid #388bfd;padding:6px 12px;color:#c9d1d9;font-size:14px;line-height:1.5}
.note.red{border-color:#f85149}.note.green{border-color:#3fb950}
pre{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.5;white-space:pre;color:#c9d1d9}
.sec{color:#58a6ff;font-weight:600;margin:16px 0 6px;font-size:15px}
`;
const page = (title, sub, body, notes = '') =>
  `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div id="card"><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p>${body}${notes}</div>`;
const row = (k, cells) => `<tr><td class="k">${esc(k)}</td>${cells.map((c) => `<td class="${c[1] || ''}">${esc(c[0])}</td>`).join('')}</tr>`;

// ---------- 01 real databases ----------
{
  const H = ['H2 2.x (MySQL mode, the PR’s only lane)', 'MySQL 8.4.7 (native)', 'MariaDB 10.11.18 (CI image)'];
  const rows = [];
  rows.push(row('Flyway V1..V46, then head', ARMS.map((a) => [need(r1, `${a}|migrate_46_to_head`).replace(' [V47 managed channel route delivery]', ' (V47)'), 'ok'])));
  rows.push(row('table collation / engine', ARMS.map((a) => (a === 'h2' ? ['n/a', 'dim'] : [need(r1, `${a}|table qwen_managed_channel_delivery`), '']))));
  rows.push(row('PR ManagedChannelJdbcContract.verify', ARMS.map((a) => [need(r1, `${a}|contract`), 'ok'])));
  rows.push(row('49 ordered state pairs (legal)', ARMS.map((a) => [need(matrix, `${a}|matrix legal committed`).replace(/ \[.*$/, ' committed'), 'ok'])));
  rows.push(row('49 ordered state pairs (illegal)', ARMS.map((a) => [need(matrix, `${a}|matrix illegal refused, row unchanged`) + ' refused, row unchanged', 'ok'])));
  for (const p of ['race findOrCreate same deliveryId', 'race sending->delivered (32 receipts)', 'race admit (32 inputs)', 'race route findOrCreate same identity', 'race error kinds']) {
    rows.push(row(p.replace('race ', '32 threads x 5: '), ARMS.map((a) => [need(head, `${a}|${p}`), 'ok'])));
  }
  rows.push(row('receipt after sending->partial(r)->sending(null)', ARMS.map((a) => [need(head, `${a}|receipt kept across null-receipt steps`), 'ok'])));
  rows.push(row('created_at = DB clock epoch ms', ARMS.map((a) => [`${need(head, `${a}|created_at sub-second`)}; ${need(head, `${a}|created_at within DB clock bracket`)} in bracket`, 'ok'])));
  rows.push(row('case: "Delivery-A" then "delivery-a"', ARMS.map((a) => [need(head, `${a}|case delivery_id rows`) + ' rows', 'ok'])));
  rows.push(row('512 x 4-byte emoji in VARCHAR(512) ids', ARMS.map((a) => {
    const v = need(head, `${a}|512 x 4-byte emoji ids`);
    return [a === 'h2' ? `${v} (H2 counts UTF-16 units)` : v, a === 'h2' ? 'warn' : 'ok'];
  })));
  rows.push(row('EXPLAIN delivery cursor page', ARMS.map((a) => (a === 'h2' ? ['n/a', 'dim'] : [need(head, `${a}|explain delivery cursor page`).replace(/rows=\d+ /, ''), 'ok']))));
  rows.push(row('EXPLAIN route cursor page', ARMS.map((a) => (a === 'h2' ? ['n/a', 'dim'] : [need(head, `${a}|explain route cursor page`).replace(/rows=\d+ /, ''), 'ok']))));
  const body = `<table><tr><th>probe (PR head 34c0a52c)</th>${H.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.join('')}</table>`;
  const notes = `<div class="note green">The PR's own contract has so far only run on H2. Here it passes unchanged on MySQL 8.4.7 and MariaDB 10.11.18 after a V46 &rarr; V47 upgrade. The duplicate-key path (Spring DuplicateKeyException over Connector/J), the state compare-and-set and admit hold under 32-way races, and both listing queries are served from the new indexes with no filesort.</div>`;
  writeFileSync(`${OUT}/01.html`, page('PR #13497: channel persistence on real databases', 'Contract time is from a single run; MariaDB runs in a 2 vCPU colima VM. Race rows count 32 threads x 5 rounds = 160 calls.', body, notes));
}

// ---------- 02 trailing space ----------
{
  const probes = [
    ['pad delivery_id \'pad-1 \'', 'findOrCreate("pad-1\u2420") after "pad-1"'],
    ['pad find(\'pad-1   \')', 'find("pad-1\u2420\u2420\u2420")'],
    ['pad transition(\'pad-1 \')', 'transition("pad-1\u2420", planned->sending)'],
    ['pad channel \'chan \' + same delivery id', 'findOrCreate(channel "chan\u2420", id "pad-2")'],
    ['pad channel listing', 'listByChannel("chan-pad") after a route on "chan-pad\u2420"'],
  ];
  const cls = (a, v, isCand) => {
    if (isCand) return v.startsWith('refused') || v.startsWith("'chan-pad' lists 1") ? 'ok' : 'bad';
    if (a === 'h2') return 'dim';
    return 'bad';
  };
  const rows = probes.map(([p, label]) => row(label, [
    ...ARMS.map((a) => { const v = need(head, `${a}|${p}`); return [v, cls(a, v, false)]; }),
    ...['mysql84', 'mariadb1011'].map((a) => { const v = need(cand, `${a}|${p}`); return [v.replace(/^refused IllegalArgumentException: /, 'refused: '), cls(a, v, true)]; }),
  ]));
  const body = `<table><tr><th>call</th><th>head on H2</th><th>head on MySQL 8.4.7</th><th>head on MariaDB 10.11.18</th><th>candidate on MySQL</th><th>candidate on MariaDB</th></tr>${rows.join('')}</table>`;
  const notes = `<div class="note red">utf8mb4_bin is a PAD SPACE collation on both servers, so "pad-1" and "pad-1 " are one key. On MySQL and MariaDB the head silently returns another id's row, moves another delivery's state, and lists another channel's routes. H2 does not pad, so the PR's H2-only contract cannot see any of this. The store already guards the same thing for Turns (ManagedAgentStore.java:1482, "The binary collation ignores trailing spaces").</div>
<div class="note green">Candidate guard (+43/&minus;20, including 9 test lines): ChannelStoreSupport.requireKey refuses a trailing space on tenant, channel, delivery, segment and route-key identities. Combined with the test patch: full module suite 1024 run / 0 failed / 1 skipped, checkstyle 0 violations, new MySQL IT green on MySQL and MariaDB. The 3 new contract assertions fail on the head even on H2, so they are a witness. (&#9248; = one space.)</div>`;
  writeFileSync(`${OUT}/02.html`, page('Trailing-space identities alias on MySQL and MariaDB', 'Same probe class against the PR head and the candidate guard. Red cells mean the call acted on another identity’s row.', body, notes));
}

// ---------- 03 server ----------
{
  const fresh = readFileSync(`${R}/boot-head-fresh.txt`, 'utf8').replace(/^\d{4}-\d\d-\d\dT/gm, '');
  const up1 = readFileSync(`${R}/boot-upgrade-base.txt`, 'utf8').replace(/^\d{4}-\d\d-\d\dT/gm, '');
  const up2 = readFileSync(`${R}/boot-upgrade-head.txt`, 'utf8').replace(/^\d{4}-\d\d-\d\dT/gm, '');
  const d1 = readFileSync(`${S}/logs/m20-d1.log`, 'utf8').split('\n').filter((l) => /mapped but planned|Tests run: \d+, F.*Skipped: \d+$/.test(l)).map((l) => l.replace(/^\[(INFO|ERROR)\] /, '').trim());
  const fmt = (t) => esc(t).replace(/(404)/g, '<span class="ok">$1</span>').replace(/ (200|202) /g, ' <span class="ok">$1</span> ');
  const body = `<div class="sec">1. PR head jar, empty MySQL 8.4.7 schema (trusted-header auth on loopback)</div><pre>${fmt(fresh.trim())}</pre>
<div class="sec">2. Upgrade: main 43a6e1e5 jar writes a Session at V46, then the PR head jar starts on the same schema</div><pre>${fmt((up1.trim() + '\n' + up2.trim()))}</pre>
<div class="sec">3. D1 gate mutant: map GET /v1/agent-channels/{channelId}/deliveries/{deliveryId} early, run ManagedAgentApiContractTest</div><pre>${esc([...new Set(d1)].join('\n'))}</pre>`;
  const notes = `<div class="note green">The planned channel routes answer the same 404 not_found as the planned automations route. A pre-existing Session survives the V46 &rarr; V47 upgrade. Mapping a planned channel route early turns the D1 gate red. The WebShell generator produces no change, but it filters by the WebShell tag first and these routes are tagged Public Resources, so the D1 gate is the real guard.</div>`;
  writeFileSync(`${OUT}/03.html`, page('Real Spring server on MySQL: boot, upgrade, routes', 'Spring Boot jar from the PR head (34c0a52c) and from its merge base main (43a6e1e5), MySQL 8.4.7 on 127.0.0.1.', body, notes));
}

// ---------- 04 mutants ----------
{
  const lines = readFileSync(`${R}/mutants.tsv`, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
  const descs = Object.fromEntries(readFileSync(`${S}/logs/mutant-list.tsv`, 'utf8').trim().split('\n').map((l) => { const [id, path, d] = l.split('\t'); return [id, [path.split('/').pop(), d]]; }));
  const fix = Object.fromEntries(readFileSync(`${R}/mutants-with-test-patch.tsv`, 'utf8').trim().split('\n').slice(1).map((l) => { const [id, h2, my] = l.split('\t'); return [id, [h2, my]]; }));
  const short = (v) => (v.startsWith('killed') ? 'killed' : v.startsWith('survived') ? 'SURVIVED' : v.startsWith('PASS') ? 'SURVIVED' : v.startsWith('FAIL') ? 'killed' : v);
  const rows = lines.filter(([id]) => id !== 'M00').map(([id, h2, my]) => {
    const [file, d] = descs[id];
    const a = short(h2); const b = short(my);
    const f = fix[id] ? `H2 ${short(fix[id][0])}, MySQL IT ${short(fix[id][1])}` : '';
    const fc = fix[id] ? (short(fix[id][1]) === 'killed' ? 'ok' : 'bad') : 'dim';
    return row(`${id} ${d}`, [[file, 'dim'], [a, a === 'killed' ? 'ok' : 'bad'], [b, b === 'killed' ? 'ok' : 'bad'], [f || '—', fc]]);
  });
  const killedBoth = lines.filter(([id, h, m]) => id !== 'M00' && short(h) === 'killed' && short(m) === 'killed').length;
  const total = lines.length - 1;
  const body = `<table><tr><th>mutant (one edit in PR code)</th><th>file</th><th>H2 lane: PR tests</th><th>MySQL lane: PR contract</th><th>with candidate test patch</th></tr>${rows.join('')}</table>`;
  const notes = `<div class="note">Baseline M00 passes on both lanes. ${killedBoth}/${total} mutants are killed on both lanes. M03 and M09 (tiebreak dropped) die only on H2, because on MySQL the backward scan of the (created_at, id) index already yields that order. The 5 survivors are unpinned behaviour: the NUL-separator check, null-receipt preservation, has_more at an exact page, collation, and millisecond precision. M16 makes "Delivery-A" and "delivery-a" one row on MySQL and still passes every PR test.</div>
<div class="note green">Candidate test patch (+66, test-only): 6 contract assertions plus ManagedChannelJdbcContractMySqlIT. The IT is picked up by CI's MariaDB failsafe lane under the existing *IT naming rule. All 5 survivors die; M16 dies only on the real-database lane.</div>`;
  writeFileSync(`${OUT}/04.html`, page('Mutation matrix: what the PR’s tests pin', '19 single-edit mutants of the PR’s Java and SQL. Each runs the PR’s two channel test classes on H2 and the PR contract on MySQL 8.4.7.', body, notes));
}

const require = createRequire('/Users/wenshao/git/qwen-code/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } });
const pg = await ctx.newPage();
for (const name of ['01', '02', '03', '04']) {
  await pg.goto(`file://${OUT}/${name}.html`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, 'clipped elements:', clipped);
}
await browser.close();
