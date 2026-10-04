// Renders the PR #13355 verification figures from the captured results.
// Run: NODE_PATH=/root/verify/pr13355/head/node_modules node render.cjs
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = '/root/verify/pr13355';
const OUT = path.join(ROOT, 'publish', 'pr-13355');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #ffffff; font-family: -apple-system, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif; color: #1f2328; }
.card { display: inline-block; padding: 22px 24px 18px; background: #ffffff; }
h1 { font-size: 19px; margin: 0 0 4px; }
.sub { font-size: 13px; color: #59636e; margin: 0 0 14px; }
table { border-collapse: collapse; font-size: 13px; }
th, td { border: 1px solid #d1d9e0; padding: 5px 9px; vertical-align: top; text-align: left; }
th { background: #f6f8fa; font-weight: 600; }
td.id { font-family: ui-monospace, 'DejaVu Sans Mono', monospace; font-weight: 600; white-space: nowrap; }
tr.group td { background: #eef1f4; font-weight: 600; color: #31373d; }
.ok { background: #dafbe1; color: #116329; }
.bad { background: #ffebe9; color: #a40e26; }
.warn { background: #fff8c5; color: #7d4e00; }
.mono { font-family: ui-monospace, 'DejaVu Sans Mono', monospace; font-size: 12px; }
.small { font-size: 11.5px; color: #59636e; }
.legend { font-size: 12px; color: #59636e; margin-top: 10px; max-width: 1180px; line-height: 1.45; }
.panes { display: flex; gap: 14px; align-items: stretch; }
.pane { width: 640px; border-radius: 8px; overflow: hidden; border: 1px solid #d1d9e0; }
.pane .bar { padding: 7px 12px; font-size: 13px; font-weight: 600; }
.pane.red .bar { background: #ffebe9; color: #a40e26; }
.pane.green .bar { background: #dafbe1; color: #116329; }
.pane pre { margin: 0; padding: 12px; background: #0d1117; color: #d0d7de; font-family: 'DejaVu Sans Mono', ui-monospace, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; height: 100%; }
.pane pre .cmd { color: #79c0ff; }
.pane pre .err { color: #ff7b72; font-weight: 600; }
.pane pre .good { color: #7ee787; font-weight: 600; }
`;

function page(title, sub, body, legend = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body><div class="card"><h1>${esc(title)}</h1><p class="sub">${sub}</p>${body}${legend ? `<div class="legend">${legend}</div>` : ''}</div></body></html>`;
}

function term(text, kind) {
  return text
    .split('\n')
    .map((line) => {
      const e = esc(line);
      if (line.startsWith('$ ')) return `<span class="cmd">${e}</span>`;
      if (kind === 'green' && /unique|BUILD SUCCESS|Failures: 0, Errors: 0|identical|now at version v36|0 Checkstyle|size is 0/.test(line))
        return `<span class="good">${e}</span>`;
      if (/::error::|Found more than one|failed|exit=1|claim version/i.test(line))
        return `<span class="err">${e}</span>`;
      return e;
    })
    .join('\n');
}

// ---------------------------------------------------------------- fig 1
function fig1() {
  const left = fs.readFileSync(path.join(ROOT, 'fig1-left.txt'), 'utf8').trimEnd();
  const right = fs.readFileSync(path.join(ROOT, 'fig1-right.txt'), 'utf8').trimEnd();
  const body = `<div class="panes">
  <div class="pane red"><div class="bar">As merged today: PR head 4e6a855 + main 1fb5a71 (after #13301)</div><pre>${term(left, 'red')}</pre></div>
  <div class="pane green"><div class="bar">After renumbering the outbox migration to V36</div><pre>${term(right, 'green')}</pre></div>
</div>`;
  return page(
    'Merge safety: duplicate Flyway V35',
    'GitHub reports the PR as MERGEABLE/CLEAN because the two files have different names; the merged tree cannot boot.',
    body,
  );
}

// ---------------------------------------------------------------- fig 2
function short(reason) {
  return reason
    .replace(/^ManagedSessionRecordError: /, '')
    .replace(/: input\.accepted, wake\.requested.*$/, ': …')
    .replace(/: config_install, workspace_initialization.*$/, ': …');
}
function wireCell(r) {
  const w = r.wire;
  if (!w) return '<td class="bad">no commit sent</td>';
  if (w.status === 200) return '<td>200 stored</td>';
  return `<td class="ok">${w.status} rejected<br><span class="small">${esc((w.message || '').slice(0, 70))}${(w.message || '').length > 70 ? '…' : ''}</span></td>`;
}
function reopenCell(r) {
  if (!r.reopen.ok)
    return `<td class="bad"><b>Session bricked</b><br><span class="small">${esc(short(r.reopen.error))}</span></td>`;
  if (r.id === 'N3' && r.wire && r.wire.status === 200)
    return '<td class="warn">opens; the stored line keeps a reserved Stage H id<br><span class="small">monitor_run is not enabled for submission in TS yet, so no wedge is observable today (see N3b)</span></td>';
  if (r.followUp && r.followUp.startsWith('refused'))
    return `<td class="warn">opens, but the first MCP record commit is refused for good<br><span class="small">${esc(r.followUp.replace(/^refused: ManagedSessionConflictError: /, ''))}</span></td>`;
  return `<td class="ok">opens${r.followUp ? '; MCP record commits' : ''}</td>`;
}
function fig2() {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'xlang/result-base.json'), 'utf8')).results;
  const head = JSON.parse(fs.readFileSync(path.join(ROOT, 'xlang/result-head.json'), 'utf8')).results;
  const byId = Object.fromEntries(head.map((r) => [r.id, r]));
  const groups = {
    control: 'Controls: genuine authority-written transactions',
    'pr-negative': 'Commit-time refusal shapes (10 mirror the PR’s new negative cases; N3b, N11, N12 added)',
    residual: 'Residual shapes the head store still accepts',
  };
  let rows = '';
  let last = '';
  for (const b of base) {
    if (b.group !== last) {
      rows += `<tr class="group"><td colspan="6">${esc(groups[b.group])}</td></tr>`;
      last = b.group;
    }
    const h = byId[b.id];
    rows += `<tr><td class="id">${esc(b.id)}</td><td>${esc(b.label)}</td>${wireCell(b)}${reopenCell(b)}${wireCell(h)}${reopenCell(h)}</tr>`;
  }
  const body = `<table><thead>
<tr><th rowspan="2">Case</th><th rowspan="2">Single defect injected into a genuine transaction</th><th colspan="2">Base 2c591ec (merge-base)</th><th colspan="2">PR head 4e6a855</th></tr>
<tr><th>Java store commit</th><th>TS authority reopen</th><th>Java store commit</th><th>TS authority reopen</th></tr>
</thead><tbody>${rows}</tbody></table>`;
  const legend =
    'Real Spring <span class="mono">managed-agent-server</span> jars on MySQL 8.4.11 and the real TypeScript <span class="mono">LocalManagedSessionAuthority</span> + <span class="mono">HttpManagedSessionStore</span>. ' +
    'For each case the authority writes a genuine goal_state transaction. A fetch shim rewrites one defect into the record bytes on the wire and recomputes the commit marker, so the injected line is the only defect. A fresh writer then reopens the Session through the production read path. ' +
    'The real TS client refuses to send any of these shapes itself (it parses every event line before committing), so every row needs a writer that bypasses the contract on the internal commit route. That is the same precondition as the PR’s own tests.';
  return page(
    'Commit-time refusal vs. reopen: cross-language differential (22 cases)',
    'Java store answer vs. what the TypeScript authority does when it reopens the same Session.',
    body,
    legend,
  );
}

// ---------------------------------------------------------------- fig 3
function fig3() {
  const control = JSON.parse(fs.readFileSync(path.join(ROOT, 'arms/split-control.json'), 'utf8'));
  const revert = JSON.parse(fs.readFileSync(path.join(ROOT, 'arms/split-revert-r3.json'), 'utf8'));
  const table = (dump) => {
    const ev = dump.events
      .map((e) => `<tr${e.event_type === 'task.updated' ? ' class="bad"' : ''}><td class="mono">${e.sequence_id}</td><td class="mono">${esc(e.event_type)}</td><td class="mono">${esc(e.content_part_id ?? '—')}</td></tr>`)
      .join('');
    const parts = dump.parts
      .map((p) => `<tr><td class="mono">${esc(p.part_id)}</td><td class="mono"><b>"${esc(p.part_text)}"</b></td></tr>`)
      .join('');
    return `<p class="small"><b>managed_agent_event</b></p><table><tr><th>seq</th><th>event_type</th><th>content_part_id</th></tr>${ev}</table>
<p class="small" style="margin-top:12px"><b>managed_agent_item_part</b> (durable Parts)</p><table><tr><th>part_id</th><th>part_text</th></tr>${parts}</table>`;
  };
  const body = `<div class="panes">
<div class="pane green" style="width:520px"><div class="bar">PR head: announcement goes to managed_agent_task_event</div><div style="padding:12px">${table(control)}</div></div>
<div class="pane red" style="width:520px"><div class="bar">Same tree, announcement routed back to the Session event stream (main’s behavior)</div><div style="padding:12px">${table(revert)}</div></div>
</div>`;
  return page(
    'Fix 3: a task announcement between two text deltas',
    'Scenario of keepsOneTextPartAcrossATaskAnnouncement: delta "one", commit a monitor_run revision, then delta "two", then materialize. Rows are read back from the store.',
    body,
  );
}

// ---------------------------------------------------------------- fig 4
function fig4() {
  const arms = JSON.parse(fs.readFileSync(path.join(ROOT, 'arms/results-control-revert-r1-revert-r2-revert-r3-base-prtests.json'), 'utf8'));
  const muts = JSON.parse(fs.readFileSync(path.join(ROOT, 'arms/results-mutants.json'), 'utf8'));
  const describe = {
    control: 'PR head, unmodified',
    'revert-r1': 'Fix 1 reverted: executionOf ignores dispatchGeneration',
    'revert-r2': 'Fix 2 reverted: base apply() validation (outbox kept)',
    'revert-r3': 'Fix 3 reverted: announcement back on the event stream',
    'base-prtests': 'Base production code + the PR’s witness tests',
  };
  const equivalent = {
    'M03-foreign-line-cap': 'equivalent: validateUtf8JsonLines already caps every line at 1 MiB',
    'M04-event-line-cap': 'equivalent: validateUtf8JsonLines already caps every line at 1 MiB',
    'M09-event-id-shape': 'test gap: arm is live (differential N11) but no test pins it',
    'M18-operation-id': 'test gap: arm is live (differential N12) but no test pins it',
  };
  const killers = (r) =>
    [...new Set(r.failed.map((f) => f.split(' :: ')[0].replace('ManagedExtensionRecordStoreTest.', 'RecordStoreTest.').replace('ManagedExtensionProjectionContractTest.', 'ProjectionContractTest.')))].join('<br>');
  let rows = '<tr class="group"><td colspan="3">Revert arms (run against the 120 store tests the PR touches)</td></tr>';
  for (const [k, d] of Object.entries(describe)) {
    const r = arms[k];
    rows += `<tr><td class="mono">${esc(d)}</td><td class="${r.failed.length ? 'ok' : (k === 'control' ? 'ok' : 'bad')}">${r.failed.length} / ${r.total} red</td><td class="mono small">${killers(r) || 'all green'}</td></tr>`;
  }
  rows += '<tr class="group"><td colspan="3">One mutant per arm of the new validator (and the generation arm of Fix 1)</td></tr>';
  for (const [k, r] of Object.entries(muts)) {
    const cls = r.failed.length ? 'ok' : equivalent[k]?.startsWith('equivalent') ? 'warn' : 'bad';
    rows += `<tr><td class="mono">${esc(k)}</td><td class="${cls}">${r.failed.length ? 'killed' : 'survived'} (${r.failed.length} red)</td><td class="mono small">${r.failed.length ? killers(r) : esc(equivalent[k] || '')}</td></tr>`;
  }
  return page(
    'Do the new tests discriminate? Revert arms and mutation matrix',
    'Each arm is a copy of managed-agent-server at the PR head with one production change, run offline (JDK 21) against the store test classes.',
    `<table><tr><th>Arm</th><th>Result (green = the change was caught)</th><th>Red tests</th></tr>${rows}</table>`,
    '19 of 23 mutants are killed. 2 are equivalent because the store already caps every line at 1 MiB. 2 are live arms that no test pins.',
  );
}

(async () => {
  const browser = await chromium.launch({
    executablePath:
      '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  const figures = {
    'fig1-merge-v35.png': fig1(),
    'fig2-cross-language-differential.png': fig2(),
    'fig3-part-split.png': fig3(),
    'fig4-revert-and-mutation.png': fig4(),
  };
  for (const [name, html] of Object.entries(figures)) {
    fs.writeFileSync(path.join(ROOT, 'publish', name.replace('.png', '.html')), html);
    const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } });
    const p = await context.newPage();
    await p.setContent(html, { waitUntil: 'load' });
    const box = await p.locator('.card').boundingBox();
    await p.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
    const fresh = await p.locator('.card').boundingBox();
    await p.screenshot({ path: path.join(OUT, name), clip: fresh });
    await context.close();
    console.log(name, Math.round(fresh.width), 'x', Math.round(fresh.height));
  }
  await browser.close();
})();
