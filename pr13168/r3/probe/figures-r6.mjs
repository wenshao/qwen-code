// VERIFICATION RIG ONLY (PR #13168 R6): figure 10 — the author's boundary-pinning
// commit (tip 6e151e6, test-only) is mutation-proven. Numbers read from out/r6pins/results.json
// and the inline mutation-run outputs captured this round. usage: node figures-r6.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13168-r2';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig`;
fs.mkdirSync(OUT, { recursive: true });
const W = 1000;
const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6edf3}
  #card{width:${W}px;padding:24px 28px 26px;background:#0d1117}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  h2{font-size:14.5px;margin:16px 0 8px}
  .sub{font-size:13px;color:#9da7b3;margin:0 0 14px;line-height:1.45}
  .note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin:4px 0 12px;line-height:1.5;background:#161b22}
  .note.ok{border-left-color:#3fb950}.note.bad{border-left-color:#f85149}.note.info{border-left-color:#58a6ff}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.6px;background:#1f2630;padding:1px 4px;border-radius:4px}
  table{border-collapse:collapse;width:100%;font-size:12.4px;margin-bottom:12px}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  .pass{color:#3fb950;font-weight:600}.fail{color:#f85149;font-weight:600}.amber{color:#d29922;font-weight:600}.dim{color:#8b949e}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => (c && typeof c === 'object' ? `<td class="${c.c ?? ''}">${c.t}</td>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</table>`;
const P = (t) => ({ c: 'pass', t });
const F = (t) => ({ c: 'fail', t });
const D = (t) => ({ c: 'dim', t });

const r = JSON.parse(fs.readFileSync(`${RIG}/out/r6pins/results.json`, 'utf8'));
const html = page(
  'Round 6, same head <code>6e151e6</code> — the author’s boundary-pinning commit is mutation-proven',
  `No new commit since my R5 report: the live PR head is still <code>6e151e6</code>. Its tip commit — <i>“${r.tip_commit}”</i> — is <b>test-only</b> (6 test files, zero production code), the author pinning the boundaries the review flagged. This round closes the “unit / mutation on the new gates” I listed as Not covered in R5. Production code is byte-identical to the R5 real-stack build, so the real-stack behavior is unchanged; this is pure vitest + mutation in a worktree at the head.`,
  table(
    ['The tip commit’s pins at 6e151e6', 'Result'],
    [
      ['5 TS pinning test files run clean', P(`${r.clean_run.passed}/${r.clean_run.tests} passed (${r.clean_run.files} files)`)],
      ['Java pin: <code>workspace-context</code> in the 1 MiB control tier', P('source-confirmed — HISTORY_KINDS={bind-history,checkpoint,history}; limit=CONTROL_LIMIT_BYTES=1 MiB')],
    ],
  ) +
    table(
      ['Mutation — is the pin non-vacuous? (break production → pin must go RED)', 'Pinned assertion', 'Result'],
      [
        [
          'A · <code>managed-runtime-tool-executor.ts</code>: force <code>outOfBoundary=true</code> on any Session-dir escape (revert to strict boot-v1)',
          '<code>managed-context-worker.test.ts:2769</code> — read a file outside the Session dir but inside the mount → <code>success</code>',
          F('RED — expected ‘error’ to be ‘success’'),
        ],
        [
          'B · <code>managed-runtime-provider-protocol.ts</code>: drop the <code>index&lt;next</code> name-allowlist gate (accept unknown names)',
          '<code>hosted-workspace-broker.test.ts:682</code> — <code>workspaceContext()</code> rejects <code>../etc/passwd</code>',
          F('RED — ../etc/passwd returned as a context file instead of rejected'),
        ],
      ],
    ) +
    '<div class="note ok"><b>Both pins are non-vacuous.</b> Pin A locks the <i>widened</i> boot-v2 boundary (shared mount reachable, only another installed Session’s directory vetoed) — it reds the moment the boundary is tightened or loosened at that point. Pin B locks the Workspace-context result parser so a traversal / out-of-allowlist name can never reach the injected system instruction — it reds the moment the allowlist gate is removed.</div>' +
    '<div class="note info"><b>Verdict unchanged from R5.</b> #13168’s own workspace-context injection stays confined to the Session directory (safe). The file-tool boundary is the <b>declared</b> boot-v2 design (search-profile doc: “worker-local, not a confidentiality guarantee across separate workers”), and it is now pinned by tests that genuinely catch a regression. The one maintainer call still stands: under the required <code>isolation=session</code> (one worker per Session), that worker-local exclusion covers the empty set, so a Session can read another Session’s files through an in-Session symlink — confirm that trade-off is acceptable for Hosted multi-tenant.</div>',
);
fs.writeFileSync(`${OUT}/10-round6.html`, html);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: W + 60, height: 900 } });
const p = await ctx.newPage();
await p.goto(`file://${OUT}/10-round6.html`);
const clipped = await p.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
await p.locator('#card').screenshot({ path: `${OUT}/10-round6.png` });
console.log(`10-round6.png written; overflowing cells=${clipped}`);
await browser.close();
