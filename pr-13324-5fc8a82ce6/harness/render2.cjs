// Render evidence figures to PNG with Playwright (data comes from the real runs).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const R = '/root/verify/pr13324/runs';
const OUT = '/root/verify/pr13324/publish/pr-13324-final-img';
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const J = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const CSS = `
body{margin:0;background:#0d1117;color:#c9d1d9;font:14px/1.45 'DejaVu Sans Mono',Menlo,monospace}
.wrap{padding:22px 26px;display:inline-block;min-width:1100px}
h1{font-size:18px;margin:0 0 4px;color:#f0f6fc}
.sub{color:#8b949e;margin-bottom:14px;font-size:12.5px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
.pane{border:1px solid #30363d;border-radius:8px;padding:12px 14px;background:#161b22}
.pane.bad{border-color:#da3633}.pane.good{border-color:#2ea043}
.pane h2{font-size:14.5px;margin:0 0 8px}
.bad h2{color:#ff7b72}.good h2{color:#56d364}
table{border-collapse:collapse;width:100%;font-size:12.5px}
td,th{border-bottom:1px solid #21262d;padding:4px 6px;text-align:left;vertical-align:top}
th{color:#8b949e;font-weight:normal}
.k-ext{color:#ffa657}.k-exec{color:#79c0ff}.k-del{color:#d2a8ff}
.y{color:#ff7b72;font-weight:bold}.n{color:#56d364;font-weight:bold}
.mono{white-space:pre-wrap;word-break:break-all;color:#adbac7}
.note{margin-top:12px;color:#8b949e;font-size:12px}
.pill{display:inline-block;padding:0 6px;border-radius:9px;background:#21262d;margin-right:4px}
img.shot{width:100%;border-radius:6px;border:1px solid #30363d}
`;

async function shoot(browser, name, html) {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="wrap">${html}</div></body></html>`);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  const box2 = await page.locator('.wrap').boundingBox();
  await page.screenshot({ path: path.join(OUT, name), clip: box2 });
  await page.close();
  console.log('wrote', name);
}

function evidencePane(arm, s, cls, title) {
  const kindCls = (k) => (k === 'external_fact' ? 'k-ext' : k === 'execution_output' ? 'k-exec' : 'k-del');
  const rows = s.verifierEvidence
    .map((e) => {
      const tags = Object.entries(e.has).filter(([, v]) => v).map(([k]) => `<span class="pill">${esc(k)}</span>`).join('');
      return `<tr><td class="${kindCls(e.proofKind)}">${esc(e.proofKind)}</td><td>${tags || '<span style="color:#6e7681">—</span>'}</td><td class="mono">${esc(e.content.replace(/\/root\/verify\/pr13324\/runs\/[a-z0-9-]+\/ws\//, '<ws>/').slice(0, 92))}…</td></tr>`;
    })
    .join('');
  const o = s.oracle;
  const yn = (v, badWhenTrue) => `<span class="${v === badWhenTrue ? 'y' : 'n'}">${v}</span>`;
  const tr = s.transcriptPhase1.toolResults;
  return `<div class="pane ${cls}"><h2>${esc(title)}</h2>
  <table><tr><th>proofKind sent to verifier</th><th>contains</th><th>content</th></tr>${rows}</table>
  <table style="margin-top:10px">
   <tr><td>script's invented "999 tests passed" is an external_fact</td><td>${yn(o.inventedClaimInExternalFact, true)}</td></tr>
   <tr><td>script's Goal-metadata echo is an external_fact</td><td>${yn(o.goalEchoInExternalFact, true)}</td></tr>
   <tr><td>real fixture bytes (silent read) reach verifier as external_fact</td><td>${yn(o.realFileBytesInExternalFact, false)}</td></tr>
   <tr><td>swallowed missing-file error reaches verifier as external_fact</td><td>${yn(o.swallowedErrorInExternalFact, false)}</td></tr>
   <tr><td>computation 6*7 = 42 still available</td><td>${yn(o.computationAvailable, false)}</td></tr>
   <tr><td>tool_result records in JSONL (outer / nested internal)</td><td>${tr.filter((t) => !t.subtype).length} / ${tr.filter((t) => t.subtype === 'code_mode_tool_result').length}</td></tr>
   <tr><td>resumed process: orphan tool messages sent to provider</td><td>${s.resumeFirstRequest.orphanToolMessages.length}</td></tr>
   <tr><td>Goal final status / CLI exits</td><td>${esc(s.goalStates[s.goalStates.length - 1])} / ${esc(s.exit.filter((x) => /EXIT/.test(x)).join(' '))}</td></tr>
  </table></div>`;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  // Figure 1: real headless CLI A/B on the verifier wire.
  const head = J(`${R}/head2/summary.json`);
  const base = J(`${R}/base/summary.json`);
  const tuiHead = J(`${R}/tui-head2/summary.json`);
  const tuiBase = J(`${R}/tui-base/summary.json`);
  await shoot(
    browser,
    '01-real-cli-verifier-evidence-ab.png',
    `<h1>Real bundled CLI on Linux · /goal + Code Mode · identical deterministic provider script on both arms (head = 5fc8a82ce6)</h1>
     <div class="sub">One exec script: get_goal echo → silent read_file(fact.txt) → read_file(missing.txt) in try/catch → text("Claim: fixture overwritten and 999 tests passed.") → text(6*7). Oracle = the evidence array of the actual Goal-verifier HTTP request.</div>
     <div class="grid">${evidencePane('base', base, 'bad', 'base 691a374d2a (merge-base) — headless -p')}${evidencePane('head', head, 'good', 'head 5fc8a82ce6 — headless -p')}</div>
     <div class="note">Interactive TUI path (node-pty, same script) gives the same split: base proofKinds ${esc(JSON.stringify(tuiBase.verifierProofKindCounts))}, head ${esc(JSON.stringify(tuiHead.verifierProofKindCounts))}; invented claim as external_fact: base ${tuiBase.oracle.inventedClaimInExternalFact}, head ${tuiHead.oracle.inventedClaimInExternalFact}.</div>`,
  );

  // Figure 2: one head-written transcript read by both binaries.
  const acpH = J(`${R}/acp2-head2/acp.json`).summary;
  const acpB = J(`${R}/acp2-base/acp.json`).summary;
  const exp = (a) => {
    const f = fs.readdirSync(`${R}/xread2-${a}/exports`).find((x) => x.endsWith('.json'));
    const d = J(`${R}/xread2-${a}/exports/${f}`);
    const calls = d.messages.filter((m) => m.type === 'tool_call').map((m) => m.toolCall.toolCallId);
    return { n: d.messages.length, calls };
  };
  const eH = exp('head2');
  const eB = exp('base');
  const res = (a) => {
    const L = fs.readFileSync(`${R}/xread2-${a}/requests.jsonl`, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    const first = L.filter((r) => r.kind === 'worker')[0].body.messages;
    const ann = new Set(first.flatMap((m) => (m.tool_calls || []).map((t) => t.id)));
    return first.filter((m) => m.role === 'tool' && !ann.has(m.tool_call_id)).length;
  };
  const list = (xs) => xs.map((x) => `<div class="${/:code:/.test(x) ? 'y' : ''}">${esc(x)}</div>`).join('');
  await shoot(
    browser,
    '02-reader-compat-same-transcript.png',
    `<h1>Same head-written session (4 internal Code Mode records: 2 read_file results + get_goal + update_goal) read by each real binary</h1>
     <div class="sub">ACP: real <code>--acp</code> agent, initialize → session/load, every session/update recorded. Export: real <code>/export json</code>. Resume: real <code>--resume</code> turn, first provider request inspected.</div>
     <div class="grid">
      <div class="pane bad"><h2>base reader (old binary on new transcript)</h2><table>
        <tr><td>ACP replay tool_call / tool_call_update</td><td>${acpB.toolCalls.length} / ${acpB.toolCallUpdates.length}</td></tr>
        <tr><td>ACP unannounced completions</td><td class="y">${acpB.unannouncedCompletions.length}</td></tr>
        <tr><td colspan="2" class="mono">${list(acpB.unannouncedCompletions)}</td></tr>
        <tr><td>/export json messages / tool calls</td><td>${eB.n} / ${eB.calls.length}</td></tr>
        <tr><td colspan="2" class="mono">${list(eB.calls)}</td></tr>
        <tr><td>resume: orphan tool messages to provider</td><td>${res('base')}</td></tr>
      </table></div>
      <div class="pane good"><h2>head reader</h2><table>
        <tr><td>ACP replay tool_call / tool_call_update</td><td>${acpH.toolCalls.length} / ${acpH.toolCallUpdates.length}</td></tr>
        <tr><td>ACP unannounced completions</td><td class="n">${acpH.unannouncedCompletions.length}</td></tr>
        <tr><td colspan="2" class="mono">${list(acpH.toolCalls)}</td></tr>
        <tr><td>/export json messages / tool calls</td><td>${eH.n} / ${eH.calls.length}</td></tr>
        <tr><td colspan="2" class="mono">${list(eH.calls)}</td></tr>
        <tr><td>resume: orphan tool messages to provider</td><td>${res('head2')}</td></tr>
      </table></div></div>
     <div class="note">Left column is also the concrete downgrade cost the PR declares ("older binaries do not recognize the new internal-result subtype"): an older client replays/exports the internal records as phantom tool calls; model history on resume stays clean.</div>`,
  );

  // Figure 3: TUI screenshots (Ink live + resumed, OpenTUI resumed with both readers).
  const b64 = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
  await shoot(
    browser,
    '03-tui-ink-and-opentui-resume.png',
    `<h1>Interactive TUIs on the same head-written session (real bundle under node-pty, xterm.js render)</h1>
     <div class="sub">Top: Ink on head 5fc8a82ce6 — live /goal run, then a fresh-process --resume: exactly the two outer Exec cards both times; the 4 internal records in the JSONL add no rows (base Ink renders the same screens: text diff = workspace path + Goal id only).<br>Bottom: OpenTUI (bun 1.3.14, QWEN_TUI_RENDERER=opentui + QWEN_TUI_RENDERER_STRICT=1, so no silent Ink fallback) resuming that session with the head and the base binary — two Exec cards each; the screens differ only by a transient update-check notice.</div>
     <div class="grid"><img class="shot" src="${b64(`${R}/tui-head2/shots/1-goal-live.png`)}"><img class="shot" src="${b64(`${R}/tui-head2/shots/2-resumed.png`)}"><img class="shot" src="${b64(`${R}/otui2-head2/resumed.png`)}"><img class="shot" src="${b64(`${R}/otui2-base/resumed.png`)}"></div>`,
  );

  // Figure 4: build break found at cfdfa97a73, fixed by f17ece2151, re-verified at 5fc8a82ce6.
  const tscHead = fs.readFileSync('/root/verify/pr13324/gates/tsc-cli-head.log', 'utf8').trim();
  const patch = fs.readFileSync('/root/verify/pr13324/gates2/author-fix-f17ece2151.patch', 'utf8');
  const ci = fs.readFileSync('/root/verify/pr13324/gates/ci-failures.txt', 'utf8').trim();
  const fixed = fs.readFileSync('/root/verify/pr13324/gates2/fix-results.txt', 'utf8').trim();
  await shoot(
    browser,
    '04-build-break-found-and-fixed.png',
    `<h1>Found at cfdfa97a73: the head did not compile · fixed by f17ece2151 · re-verified at 5fc8a82ce6</h1>
     <div class="sub">vitest strips types, so DataProcessor.test.ts was green while tsc --build (npm run build / CI prepare) failed. The author's concurrent fixture fix is the same test-only change I had validated locally.</div>
     <div class="grid">
      <div class="pane bad"><h2>cfdfa97a73: cd packages/cli && npx tsc --noEmit</h2><div class="mono">${esc(tscHead)}</div>
        <h2 style="margin-top:12px">CI on cfdfa97a73 — every failing job, same first error</h2><div class="mono">${esc(ci)}</div></div>
      <div class="pane good"><h2>f17ece2151 (author): full FileDiff fixtures</h2><div class="mono" style="font-size:11.5px">${esc(patch)}</div>
        <h2 style="margin-top:12px">re-verified</h2><div class="mono">${esc(fixed)}</div></div>
     </div>`,
  );
  await browser.close();
})();
