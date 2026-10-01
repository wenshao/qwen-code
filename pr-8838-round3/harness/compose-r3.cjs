// Composes the report figures from the raw 2x Web Shell screenshots.
// All coordinates are CSS px of the 1280x900 capture viewport.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const R = '/root/verify/pr8838/runs';
// Round 3 output directory.
const OUT = '/root/verify/pr8838/publish/pr-8838-round3';
fs.mkdirSync(OUT, { recursive: true });
const X0 = 262;
const X1 = 1280;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const uri = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');

function panel({ img, slices, label, tone, marks = [], footer }) {
  const src = uri(img);
  let html = `<div class="panel"><div class="label ${tone}">${esc(label)}</div>`;
  for (const [y0, y1] of slices) {
    html += `<div class="slice" style="width:${X1 - X0}px;height:${y1 - y0}px">`;
    html += `<img src="${src}" style="width:1280px;height:900px;left:${-X0}px;top:${-y0}px">`;
    for (const m of marks) {
      if (m.y0 >= y0 && m.y1 <= y1) {
        html += `<div class="mark" style="left:${m.x0 - X0}px;top:${m.y0 - y0}px;width:${m.x1 - m.x0}px;height:${m.y1 - m.y0}px"></div>`;
        if (m.note)
          html += `<div class="note" style="left:${m.noteX ?? m.x0 - X0}px;top:${m.y1 - y0 + 4}px">${esc(m.note)}</div>`;
      }
    }
    html += `</div>`;
  }
  if (footer) html += `<pre class="foot">${esc(footer)}</pre>`;
  return html + `</div>`;
}

async function figure(file, title, panels) {
  const html = `<!doctype html><html><head><style>
    body{margin:0;background:#0d1117;font-family:'DejaVu Sans',sans-serif;color:#e6edf3}
    #fig{display:inline-block;padding:18px 18px 8px;width:${X1 - X0 + 2}px}
    h1{font-size:19px;font-weight:600;margin:0 0 12px}
    .panel{margin-bottom:14px;border:1px solid #30363d;border-radius:8px;overflow:hidden;width:${X1 - X0}px}
    .label{font-size:15px;padding:8px 12px;line-height:1.35}
    .before{background:#3d1d20;color:#ffb3ae}
    .after{background:#12301d;color:#a6f0b8}
    .slice{position:relative;overflow:hidden;border-top:1px dashed #30363d}
    .slice img{position:absolute}
    .mark{position:absolute;border:3px solid #ff9f1c;border-radius:6px;box-sizing:border-box}
    .foot{margin:0;padding:10px 12px;background:#161b22;border-top:1px solid #30363d;font:13px/1.5 'DejaVu Sans Mono',monospace;color:#e6edf3;white-space:pre-wrap}
    .neutral{background:#1f2a3d;color:#c9d7ff}
    .note{position:absolute;background:#ff9f1c;color:#111;font-size:13px;font-weight:600;padding:2px 6px;border-radius:4px}
  </style></head><body><div id="fig"><h1>${esc(title)}</h1>${panels.map(panel).join('')}</div></body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.waitForTimeout(300);
  const box = await page.locator('#fig').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 20, height: Math.ceil(box.height) + 20 });
  const box2 = await page.locator('#fig').boundingBox();
  await page.screenshot({ path: path.join(OUT, file), clip: box2 });
  await browser.close();
  console.log('wrote', file, Math.round(box2.width), 'x', Math.round(box2.height));
}

(async () => {
  await figure(
    '01-retry-strip-preexists-on-main.png',
    'R11-1 has the same shape as an existing main behavior: a retry strips trailing prompts from live history, the transcript keeps them',
    [
      {
        img: `${R}/base-uretry/out/webshell-cold.png`,
        slices: [[80, 530]],
        tone: 'neutral',
        label: 'main 310f4ba3ab, no scheduled task at all — two ordinary prompts fail (provider 400), the user retries the second (retry: true), then the daemon restarts',
        marks: [{ x0: 930, y0: 88, x1: 1266, y1: 232, note: 'both prompts replayed; live history kept only the retried one', noteX: 330 }],
        footer:
          'model history, live : user "OUTAGE-PROMPT: check the build status."\n' +
          'model history, cold : user "OUTAGE-PROMPT: check the release notes.OUTAGE-PROMPT: check the build status."',
      },
      {
        img: `${R}/head-retry/out/webshell-cold.png`,
        slices: [[200, 745]],
        tone: 'neutral',
        label: 'PR acab7be2a0 on the same main (the R11-1 path) — the user prompt fails, the scheduled fire fails, the user retries, then the daemon restarts',
        marks: [{ x0: 930, y0: 310, x1: 1266, y1: 454, note: 'same shape: the stripped entry is replayed after the retried prompt', noteX: 330 }],
        footer:
          'model history, live : user "OUTAGE-PROMPT: check the build status."\n' +
          'model history, cold : user "OUTAGE-PROMPT: check the build status.FAILING-TASK: rebuild the search index."',
      },
    ],
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
