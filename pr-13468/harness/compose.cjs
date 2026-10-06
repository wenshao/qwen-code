// Compose report figures from raw 2x screenshots (data-URI + Playwright).
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const S = '/root/verify/pr13468/shots/final';
const O = '/root/verify/pr13468/publish';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const img = (f) => `data:image/png;base64,${fs.readFileSync(path.join(S, f)).toString('base64')}`;
const css = `body{margin:0;background:#0d1117;font-family:'DejaVu Sans',sans-serif;color:#e6edf3}
.wrap{display:inline-block;padding:18px;background:#0d1117}
.title{font-size:20px;font-weight:700;margin:0 0 12px}
.panel{margin:0 0 16px;border:1px solid #30363d;border-radius:8px;overflow:hidden;width:1040px}
.cap{padding:8px 12px;font-size:14px;background:#161b22;border-bottom:1px solid #30363d}
.cap b{color:#fff}.bad{color:#ff7b72}.good{color:#3fb950}.mono{font-family:'DejaVu Sans Mono',monospace;font-size:12.5px}
.panel img{display:block;width:1040px}`;
const figs = [
  { out: 'fig1-ab-busy-parent.png', title: 'PR #13468 — /btw side in a trusted SECONDARY workspace while the parent is still responding (real daemon, real Web Shell)', panels: [
    { f: 'base-1-busy-parent-side-task.png', cap: '<b>Before</b> — base build (merge-base 85ea235, same tree with the PR\'s session.ts reverted): <span class="bad">POST /session/:id/side-task → 400 non_primary_session_route_not_supported</span>, panel shows "Failed to create side task"' },
    { f: 'head-1-busy-parent-side-task.png', cap: '<b>After</b> — PR head 0507359: <span class="good">201</span>, child opens in <span class="mono">secondary</span> and answers from the inherited parent context while the parent turn is still held open by the fake model ("Processing", Esc)' },
  ] },
  { out: 'fig2-restore-after-daemon-restart.png', title: 'PR #13468 — after a full daemon restart: persisted secondary side task reopens (head 0507359)', panels: [
    { f: 'head-3-restored-list.png', cap: 'Cold load of the parent after restart → right panel › Side task lists <b>exactly one</b> child ("What is the codeword?"); the parent transcript contains no child prompt' },
    { f: 'head-4-reopened-continued.png', cap: 'Reopened the <b>same child</b> (prior Q&amp;A restored), asked a follow-up in it: model request carried the inherited parent context; workspace chip still <span class="mono">secondary</span>. Close + reopen afterwards issued <b>0</b> new side-task creates' },
  ] },
  { out: 'fig3-ssh-workspace.png', title: 'PR #13468 — SSH workspace (real ssh:// registration against a throwaway local sshd), head 0507359', panels: [
    { f: 'head-6-ssh-side-task.png', cap: 'Still refused, but now by the ACP child\'s SSH deny-list: <span class="mono">400 unsupported_operation</span> "This operation is unavailable for SSH workspaces." (base: <span class="mono">400 non_primary_session_route_not_supported</span> from the route). No child persisted; 5 repeated attempts leaked no session slot' },
  ] },
];
(async () => {
  const b = await chromium.launch();
  for (const fig of figs) {
    const p = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
    const html = `<style>${css}</style><div class="wrap"><div class="title">${esc(fig.title)}</div>${fig.panels.map((x) => `<div class="panel"><div class="cap">${x.cap}</div><img src="${img(x.f)}"></div>`).join('')}</div>`;
    await p.setContent(html);
    await p.waitForTimeout(300);
    const box = await p.locator('.wrap').boundingBox();
    await p.setViewportSize({ width: Math.ceil(box.width) + 20, height: Math.ceil(box.height) + 20 });
    await p.locator('.wrap').screenshot({ path: path.join(O, fig.out) });
    console.log(fig.out, Math.ceil(box.width), Math.ceil(box.height));
    await p.close();
  }
  await b.close();
})();
