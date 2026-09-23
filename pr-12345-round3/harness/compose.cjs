const { chromium } = require('playwright'); const fs = require('fs');
const H = '/root/verify/pr12345-r3-harness/out';
const pairs = [
  ['r3-split-menu.png', 'old-split-menu-au.png', 'new-split-menu-au.png', 'Split pane, typing "/au"', ],
  ['r3-split-typed-auth.png', 'old-split-auth.png', 'new-split-auth.png', 'Split pane, submitting "/auth"'],
  ['r3-side-task-auth.png', 'p2-old-side-false-_auth.png', 'p2-new-side-false-_auth.png', 'Side-task pane, submitting "/auth"'],
];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1640, height: 600 }, deviceScaleFactor: 1 });
  for (const [out, a, c, title] of pairs) {
    const img = f => 'data:image/png;base64,' + fs.readFileSync(`${H}/${f}`).toString('base64');
    await p.setContent(`<body style="margin:0;background:#1e1e1e;color:#eee;font:15px system-ui"><div style="padding:8px 12px;font-weight:600">${title} — daemon has slashCommands.disabled:["auth"], host allowAdd:false</div><div style="display:flex;gap:10px;padding:0 10px 10px">
      <div style="flex:1"><div style="padding:4px 0;color:#f88">Before fix: abaf6e85</div><img style="width:100%;border:1px solid #555" src="${img(a)}"></div>
      <div style="flex:1"><div style="padding:4px 0;color:#8f8">After fix: 51c74d01 (PR head)</div><img style="width:100%;border:1px solid #555" src="${img(c)}"></div></div></body>`);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${H}/${out}`, fullPage: true });
  }
  await b.close();
})();
