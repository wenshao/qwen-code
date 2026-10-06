// VERIFICATION RIG ONLY (PR #13247 round 4): evidence card rendered from the round-4 ledgers.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13247-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/r4/fig`;
fs.mkdirSync(OUT, { recursive: true });
const R = (p) => JSON.parse(fs.readFileSync(`${RIG}/r4/results/${p}`, 'utf8'));
const sc = (p) => { const r = R(p); return `${r.pass}/${r.pass + r.fail}`; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const W = 1000;
const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6edf3}
  #card{width:${W}px;padding:22px 26px 24px;background:#0d1117}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:12.5px;color:#9da7b3;margin:0 0 14px;line-height:1.45}
  h2{font-size:14px;margin:14px 0 7px}
  table{border-collapse:collapse;width:${W}px;font-size:12.5px;margin-bottom:10px;table-layout:fixed}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4;overflow-wrap:anywhere}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  td.n{font-family:ui-monospace,Menlo,monospace}
  .ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#1f2630;padding:1px 4px;border-radius:4px}
  pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#161b22;border:1px solid #30363d;padding:8px 10px;margin:0 0 10px;white-space:pre-wrap;word-break:break-all;line-height:1.45}
  .note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin-top:8px;line-height:1.5;background:#161b22}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const row = (cells, cls = []) => `<tr>${cells.map((c, i) => `<td class="${cls[i] ?? ''}">${c}</td>`).join('')}</tr>`;
const ok = (t) => `<span class="ok">${t}</span>`, bad = (t) => `<span class="bad">${t}</span>`, warn = (t) => `<span class="warn">${t}</span>`, dim = (t) => `<span class="dim">${t}</span>`;
const s21 = R('r4t/s21-retry-budget.json').rows.find((r) => r.label.startsWith('ascii: attempt timeline')).detail;
const tl = JSON.parse(s21).map((x) => `t=${x.t}s attempts=${x.attempts} ${x.status}`).join('\n');
const g = (p) => R(p).rows.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.label.replace('G0 into a ', '').replace(' → typed failure, no lease held', '')}: ${r.detail.replace(/ last=.*$/, '').replace(/create=202 /, '')}`).join('\n');
const card = page(
  'PR #13247 · round 4 — <code>98e1ab90ae</code> (V45, contract v1.31.0)',
  'Head = merge result (main <code>69d5db2ff2</code> has not moved). Since round 3: retry bounded at 8 attempts, probe classified by verdict, acquire path restored to terminal verdicts, migration V45. macOS host, JDK 21, MySQL 8.4.7, real Spring + embedded Broker + packaged Harness.',
  `<table><colgroup><col style="width:740px"><col style="width:260px"></colgroup><tr><th>scenario</th><th>result</th></tr>
  ${row(['B1 V45: unique on main; merge clean; main jar V44 → V45 → rollback → roll-forward (S7)', ok('8/8') + ' ' + warn('#13260 #13354 #13265 also claim V45')], ['', 'n'])}
  ${row(['S1 · S4 · S9/S13/S17 · S14 Action gate · S8 opt-in off · S19 · S20 same-tenant burst', ok(`${sc('r4t/s1-basic.json')} · ${sc('r4t/s4-races.json')} · ${sc('r4t/s9-later-turns-nolock.json')}/${sc('r4t/s13-reverse-race.json')}/${sc('r4t/s17-interplay.json')} · ${sc('r4t/s14-actions.json')} · ${sc('r4t/s8-optin-off.json')} · ${sc('r4t/s19-barrier-population.json')} · ${sc('r4t/s20-tenant-burst.json')}`)], ['', 'n'])}
  ${row(['S3 probe verdicts incl. new structural ancestors (file → ENOTDIR, symlink loop, mode-000 parent, dangling link): terminal, attempts 0', ok(sc('r4t/s3-settlement.json'))], ['', 'n'])}
  ${row(['F1 stays fixed (000/444/111 refused; G0 typed, 0 leases) · S15b vanished mount root → terminal at once · S16', ok('3/3 · ' + sc('r4t/s15b-mount-root.json') + ' · ' + sc('r4t/s16-destroyed-current.json'))], ['', 'n'])}
  ${row(['S22 acquire path: committed cwd whose ancestor becomes a file / dangling link → next Turn FAILED fast, 0 leases, recoverable', ok(sc('r4t/s22-acquire-legacy.json'))], ['', 'n'])}
  ${row(['S5 retry / kill -9 in commit / in claim / facts move', ok('11/11') + dim(' (D1 from DB row)')], ['', 'n'])}
  ${row(['<code>clean verify checkstyle:check</code> (SpotBugs) · Hosted IT H2 / MySQL', ok('990 run, 0 failures · 3/3 · 3/3')], ['', 'n'])}
  ${row(['Mutation: 15 mutants of R4–R6 + earlier survivors vs focused tests', warn('12/15') + dim(' — round-2 gaps closed (N5/N11/N12 now killed)')], ['', 'n'])}
  </table>
  <h2>F2 — ENAMETOOLONG is classified retryable: a lexically valid 300-char component holds the Session 124 s</h2>
  <pre>${esc(tl)}\nlater Turn → 409 session_context_busy · another change → 409 session_context_busy · then FAILED workspace_unavailable, Session usable
(86 CJK chars = 258 bytes → NoSuchFileException on APFS → terminal in 1 s; on Linux ext4, not run here, any component over 255 bytes is expected to hit ENAMETOOLONG)</pre>
  <div class="note">The input is deterministic, not momentary. The PR's own witness <code>aMomentaryIoFailureClassifiesRetryable</code> pins <code>"a".repeat(256)</code> as retryable. Option: cap each component at 255 UTF-8 bytes lexically (400 <code>invalid_cwd</code> at admission, no operation row) and give the transient arm an injected IOException witness.</div>
  <h2>T3 — the acquire path's own access checks are pinned only by the real stack</h2>
  <pre>head:              ${esc(g('g0h/s23-g0-modes-r4.json')).replace(/\n/g, '\n                   ')}
acquire −isReadable: ${esc(g('g0r6/s23-g0-modes-mr6.json').split('\n')[0])}
acquire −isExecutable: ${esc(g('g0r7/s23-g0-modes-mr7.json').split('\n')[1])}</pre>
  <div class="note">R6/R7 survive all 990 unit tests and the Hosted IT: <code>refusesAnUnreadableSessionDirectoryBeforeClaimingStorage</code> only uses mode 000, which fails both conjuncts. Candidate (+29/−22, test-only): the same test over 000 / 111 / 444 — 26/26 on head, kills R6 and R7. R8 (acquire catch → retryable) is near-unreachable (predicates never throw on ENOTDIR), so the comment above <code>refusesAPlainFileDescendantCwdTerminallyBeforeClaimingStorage</code> claiming it reddens that mutation overstates it.</div>`,
);
const browser = await chromium.launch();
const pg = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: W + 60, height: 900 } });
fs.writeFileSync(`${OUT}/r4-01-overview.html`, card);
await pg.goto(`file://${OUT}/r4-01-overview.html`);
await pg.locator('#card').screenshot({ path: `${OUT}/r4-01-overview.png` });
console.log(`${OUT}/r4-01-overview.png`);
await browser.close();
