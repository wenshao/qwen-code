const { chromium } = require('playwright-core');
const fs = require('fs');
const OUT = '/root/verify/pr12475-publish/pr-12475';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CSS = `
body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.45 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{padding:22px 26px;display:block}
h1{font-size:18px;margin:0 0 4px}
.sub{color:#8b949e;margin:0 0 14px;font-size:13px}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #30363d;padding:7px 9px;vertical-align:top;text-align:left}
th{background:#161b22;color:#8b949e;font-weight:600;font-size:12.5px}
.chip{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;white-space:nowrap;font-family:ui-monospace,Menlo,monospace}
.ok{background:#1f6f3f;color:#e6ffed}.no{background:#8e1519;color:#ffdce0}.pair{background:#9e6a03;color:#fff8c5}
.mute{background:#30363d;color:#c9d1d9}.perm{background:#1f4a8a;color:#dbeafe}.cmdno{background:#5a1e02;color:#ffd8b5;border:1px solid #d1242f}
.probe{display:grid;grid-template-columns:150px 1fr 1fr;gap:6px;align-items:center;padding:2px 0}
.diff{outline:2px solid #d29922;border-radius:4px;background:#2d2208}
.lbl{color:#c9d1d9;font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
.cfg{color:#79c0ff;font-family:ui-monospace,Menlo,monospace;font-size:12px}
.note{color:#8b949e;font-size:12px;margin-top:10px}
.k{color:#8b949e}
.pre{white-space:pre-wrap;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 12px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#c9d1d9}
.hl{color:#3fb950;font-weight:700}.bad{color:#f85149;font-weight:700}
`;
const chip = (v) => {
  if (!v) return '<span class="chip mute">—</span>';
  if (v === 'ANSWERED') return '<span class="chip ok">answered</span>';
  if (v.startsWith('REJECTED')) return '<span class="chip no">denied</span>';
  if (v === 'PAIRING_CODE') return '<span class="chip pair">pairing code</span>';
  if (v.startsWith('NO_REPLY(unmentioned')) return '<span class="chip mute">no reply (not @)</span>';
  if (v === 'NO_REPLY') return '<span class="chip no">no reply</span>';
  if (v === 'PERMISSION_PROMPTED') return '<span class="chip perm">permission prompt</span>';
  if (v === 'COMMAND_DENIED') return '<span class="chip cmdno">"Only authorized members…"</span>';
  if (v === 'APPROVED_AND_ANSWERED') return '<span class="chip ok">approved → answered</span>';
  if (v === 'STARTUP_FAILED') return '<span class="chip no">startup error</span>';
  if (v === 'KILLED') return '<span class="chip ok">killed</span>';
  if (v === 'SURVIVED') return '<span class="chip no">survived</span>';
  return `<span class="chip mute">${esc(v)}</span>`;
};
async function shot(browser, name, html, width = 1180) {
  const p = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="wrap">${html}</div></body></html>`);
  const box = await p.locator('.wrap').boundingBox();
  await p.setViewportSize({ width, height: Math.ceil(box.height) + 20 });
  await p.locator('.wrap').screenshot({ path: `${OUT}/${name}` });
  await p.close();
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });

  // ---------- Fig 1: DingTalk matrix
  const dt = JSON.parse(fs.readFileSync('/root/verify/pr12475-runs/dingtalk/results-1790087857475.json'));
  const byId = {}; for (const r of dt) (byId[r.id] ??= {})[r.arm] = r;
  const cfgStr = (c) => Object.keys(c).length ? Object.entries(c).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ') : '(no new keys)';
  let rows = '';
  for (const id of Object.keys(byId)) {
    const b = byId[id].base, h = byId[id].head;
    let cell = '';
    if (h.startup !== 'connected' || b.startup !== 'connected') {
      const bv = b.startup === 'connected' ? b.probes[0].verdict : 'STARTUP_FAILED';
      const hv = h.startup === 'connected' ? h.probes[0].verdict : 'STARTUP_FAILED';
      cell = `<div class="probe ${bv !== hv ? 'diff' : ''}"><span class="lbl">daemon start / G·bob</span><span>${chip(bv)}</span><span>${chip(hv)} <span class="mono k">field "groupSenderPolicy" must be one of: inherit, open, allowlist</span></span></div>`;
    } else {
      h.probes.forEach((hp, i) => {
        const bp = b.probes[i];
        const lab = `${hp.kind === 'D' ? 'DM' : hp.kind === 'g' ? 'group (no @)' : 'group @'}·${hp.sender}${hp.extra ? ' ' + hp.extra : ''}`;
        const hh = hp.modelSawHistory ? ' <span class="chip perm">prompt carries bob\'s un-@ line</span>' : '';
        const bh = bp.modelSawHistory ? ' <span class="chip perm">history</span>' : '';
        const bchip = bp.verdict === 'NO_REPLY' && hp.extra?.startsWith('/') ? '<span class="chip mute">nothing pending</span>' : chip(bp.verdict);
        cell += `<div class="probe ${bp.verdict !== hp.verdict || bp.modelSawHistory !== hp.modelSawHistory ? 'diff' : ''}"><span class="lbl">${esc(lab)}</span><span>${bchip}${bh}</span><span>${chip(hp.verdict)}${hh}</span></div>`;
      });
    }
    rows += `<tr><td style="width:250px"><b>${id}</b><br><span class="cfg">${esc(cfgStr(b.cfg))}</span></td><td><div class="probe" style="color:#8b949e;font-size:12px"><span>probe</span><span>base f5beafb</span><span>head 1713e95</span></div>${cell}</td></tr>`;
  }
  await shot(browser, 'fig1-dingtalk-ab-matrix.png', `
    <h1>DingTalk, real daemon: who gets an answer, base vs head</h1>
    <p class="sub">Every row is a fresh <code>qwen serve --channel dingtalk</code> (real channel worker, real DingTalk adapter + vendor stream SDK, real ACP sessions) against a TLS-spoofed DingTalk gateway and a scripted model that replies <code>ANSWER &lt;token&gt;</code>. Common config: <code>senderPolicy: "allowlist", allowedUsers: ["alice"], groupPolicy: "open", dmPolicy: "open"</code>. "answered" = the reply carrying that probe's token was posted back to the DingTalk webhook; "denied" = <code>preflight rejected reason=sender_denied</code> and nothing posted. Amber outline = base and head differ.</p>
    <table>${rows}</table>
    <p class="note">S0/S3 identical on both arms (default unchanged). S5: on head the group message is answered and the pairing store gets a single request, created by the DM (group admission does not unlock DMs); on base the pairing code is posted into the group chat. S7 vs S7u: in a shared group session (sessionScope "thread") bob is admitted and can trigger a tool call, but bob's own /approve is refused — only alice (allowedUsers) can approve it; in a per-user session bob can.</p>`, 1260);

  // ---------- Fig 2: GitHub case normalization
  const g1 = JSON.parse(fs.readFileSync('/root/verify/pr12475-runs/github/results-base_head_fix-1790088183835.json'));
  const g2 = JSON.parse(fs.readFileSync('/root/verify/pr12475-runs/github/results-base_head-1790088278683.json'));
  const gh = {}; for (const r of [...g1, ...g2]) (gh[r.id] ??= { title: r.title, cfg: r.cfg })[r.arm] = r.probes[0];
  let grows = '';
  for (const [id, v] of Object.entries(gh)) {
    const differs = new Set(['base', 'head', 'fix'].map((a) => v[a]?.verdict).filter(Boolean)).size > 1;
    grows += `<tr class="${id === 'G1' ? 'diff' : ''}"><td><b>${id}</b></td><td>${esc(v.title)}<br><span class="cfg">${esc(cfgStr(v.cfg))}</span></td><td class="mono">${esc(v.head.login)}</td><td>${chip(v.base?.verdict)}</td><td>${chip(v.head?.verdict)}</td><td>${v.fix ? chip(v.fix.verdict) : '<span class="k">not run</span>'}</td></tr>`;
  }
  await shot(browser, 'fig2-github-case-normalization.png', `
    <h1>GitHub, real adapter: a mixed-case <code>allowedGroupUsers</code> entry silently denies the member</h1>
    <p class="sub">Real <code>qwen serve --channel github</code> polling a fake GitHub REST API (<code>baseUrl: http://127.0.0.1:28190</code>, real Octokit). A comment by login <code>Alice</code> mentioning <code>@qwen-bot</code> (G4/G5: an unmentioned comment on a <code>reason: "comment"</code> notification, i.e. the aggregate lane). Common config: <code>senderPolicy: "allowlist", allowedUsers: ["maintainer"], groupPolicy: "open"</code>. <b>fix</b> = head + the 15-line normalization patch below.</p>
    <table><tr><th></th><th>scenario</th><th>commenter</th><th>base</th><th>head</th><th>fix</th></tr>${grows}</table>
    <p class="note">G0 is the control: the adapter lowercases <code>allowedUsers</code>, so <code>"Alice"</code> works. G1 is the finding: the same spelling in <code>allowedGroupUsers</code> never matches the lowercased login; the only trace is a generic <code>preflight rejected reason=sender_denied</code>, identical to a real stranger. G3/G4: every GitHub thread is a "group", so <code>groupSenderPolicy: "open"</code> admits any commenter — including an unmentioned drive-by comment through the aggregate lane.</p>`, 1180);

  // ---------- Fig 4: mutation matrix
  const mh = JSON.parse(fs.readFileSync('/root/verify/pr12475-logs/mut/results-1790088120.json')).results;
  const mf = JSON.parse(fs.readFileSync('/root/verify/pr12475-logs/mut-fix/results-1790088902.json')).results;
  const m4 = JSON.parse(fs.readFileSync('/root/verify/pr12475-logs/mut-fix-m04/results-1790088984.json')).results;
  const fixBy = {}; for (const r of mf) fixBy[r.id] = r; for (const r of m4) fixBy[r.id] = r;
  let mrows = '';
  for (const r of mh) {
    const f = fixBy[r.id];
    mrows += `<tr class="${!r.killed ? 'diff' : ''}"><td class="mono">${r.id}</td><td class="mono" style="font-size:11.5px">${esc(r.file.replace('packages/', ''))}</td><td>${esc(r.desc)}</td><td>${chip(r.killed ? 'KILLED' : 'SURVIVED')}</td><td>${chip(f.killed ? 'KILLED' : 'SURVIVED')}</td></tr>`;
  }
  const kh = mh.filter((r) => r.killed).length, kf = mh.filter((r) => fixBy[r.id].killed).length;
  await shot(browser, 'fig4-mutation-matrix.png', `
    <h1>Mutation matrix: which converted call sites the tests actually pin</h1>
    <p class="sub">Each mutant reverts or bends one changed line, then the whole owning suite runs (channels/base 1403 tests, channels/github 209, channels/dws 392, cli channel commands 477, cli settings store + management service 150). Unmutated controls all green. Killed at head: <b>${kh}/19</b>; with the optional test patch: <b>${kf}/19</b>.</p>
    <table><tr><th>id</th><th>file</th><th>mutation</th><th>head tests</th><th>head + test patch</th></tr>${mrows}</table>
    <p class="note">M03 is near-equivalent: the only caller that passes <code>deferPairingRequests</code> (Feishu replies) runs the full preflight again before processing, so the outcome is the same; the guard only saves the parent-message fetch.</p>`, 1180);

  // ---------- Fig 5: lint gate
  await shot(browser, 'fig5-prettier-gate.png', `
    <h1>Lint &amp; Static is red on Prettier only — one command fixes it</h1>
    <div class="pre"><span class="k"># CI job "Lint &amp; Static (ubuntu-latest, Node 22.x)", step "Run node scripts/lint.js --prettier"</span>
[warn] packages/channels/base/src/ChannelBase.test.ts
[warn] packages/channels/base/src/ChannelBase.ts
[warn] packages/channels/base/src/types.ts
[warn] packages/channels/dws/src/dws-channel.ts
[warn] packages/channels/github/src/GithubAdapter.ts
[warn] packages/cli/src/serve/channel-settings-store.ts
[warn] Code style issues found in 6 files. Run Prettier with --write to fix.
<span class="bad">##[error]Process completed with exit code 1.</span>

<span class="k"># local, same 13 files: base f5beafb → "All matched files use Prettier code style!"; head → the same 6 files warn</span>
<span class="k"># after npx prettier --write on those 6 files, every churn hunk returns byte-for-byte to base:</span>
PR as pushed:            13 files, <span class="bad">+289 / −64</span>
after prettier --write:  13 files, <span class="hl">+268 / −13</span>     (72 churn lines gone, 0 semantic lines touched)</div>
    <p class="note">ESLint (<code>--max-warnings 0</code>) on the 13 changed files: clean. Full workspace build on a real install (which runs <code>tsc --build</code> for every package, including <code>packages/cli</code>): exit 0 on both arms.</p>`, 1000);

  const img = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const W = '/root/verify/pr12475-runs/webshell';
  const reqs = JSON.parse(fs.readFileSync(W + '/shots/editor-requests.json'));
  const put = reqs.find((r) => r.method === 'PUT');
  const putCfg = JSON.parse(put.body).config;
  const disk = JSON.parse(fs.readFileSync(W + '/ws/.qwen/settings.json')).channels['team-bot'];
  const hl = (o) => esc(JSON.stringify(o, null, 1)).replace(/(&quot;|")(groupSenderPolicy|allowedGroupUsers)(&quot;|")/g, '<span class="hl">"$2"</span>');
  const probes = fs.readFileSync(W + '/runtime-after-editor-save.txt', 'utf8').trim().split('\n').map((l) => { const [a, , , v] = l.split(' '); return `${a.replace('G:', 'group @').replace('D:', 'DM ')} → ${v.startsWith('ANSWERED') ? '<span class="hl">answered</span>' : '<span class="bad">denied</span>'}`; }).join('\n');
  await shot(browser, 'fig3-webshell-editor-keeps-keys.png', `
    <h1>Web Shell channel editor keeps both keys on save (contrary to the PR's docs note)</h1>
    <p class="sub">Real daemon + the Web Shell it serves (head build), Chromium via Playwright. A workspace-managed DingTalk channel is seeded with <code>groupSenderPolicy: "allowlist", allowedGroupUsers: ["carol"]</code>. In the editor only an unrelated field (Instructions) is changed, then <b>Save</b>, then <b>Start</b> from the channel list.</p>
    <div style="display:grid;grid-template-columns:430px 1fr;gap:16px;align-items:start">
      <div><img src="${img(W + '/shots/editor-dialog.png')}" style="width:430px;border:1px solid #30363d;border-radius:6px"><div class="note">Edit dialog: no field for either key is rendered.</div></div>
      <div>
        <div class="k" style="margin-bottom:4px">1) PUT body the browser actually sent (<code>…/channels/team-bot</code>) — the editor starts from <code>...instance.config</code>:</div>
        <div class="pre">${hl(putCfg)}</div>
        <div class="k" style="margin:10px 0 4px">2) <code>.qwen/settings.json</code> on disk after the save:</div>
        <div class="pre">${hl(disk)}</div>
        <div class="k" style="margin:10px 0 4px">3) Channel started from the UI, then probed through the fake DingTalk gateway:</div>
        <div class="pre">${probes}</div>
      </div>
    </div>
    <div style="margin-top:14px;height:600px;overflow:hidden;border:1px solid #30363d;border-radius:6px"><img src="${img(W + '/shots/channels-running.png')}" style="width:100%;display:block"></div><div><div class="note">The saved channel running ("Connected") after Start.</div></div>`, 1240);
  await browser.close();
  console.log('rendered');
})();
