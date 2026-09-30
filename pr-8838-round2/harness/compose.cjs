// Composes the report figures from the raw 2x Web Shell screenshots.
// All coordinates are CSS px of the 1280x900 capture viewport.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const R = '/root/verify/pr8838/runs';
const OUT = '/root/verify/pr8838/publish/pr-8838-round2';
fs.mkdirSync(OUT, { recursive: true });
const X0 = 262;
const X1 = 1280;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const uri = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');

function panel({ img, slices, label, tone, marks = [] }) {
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
    '01-webshell-cold-replay-ab.png',
    'Real qwen serve daemon, cold restart, Web Shell replay: schedule every minute → 1 fire → follow-up',
    [
      {
        img: `${R}/base-ok/out/webshell-cold.png`,
        slices: [[80, 525]],
        tone: 'before',
        label: 'BEFORE · main 57e720bc97 — the scheduled result is folded into the user’s SCHEDULE-IT turn ("Processed 21s"); that turn’s real reply ("Scheduled. It will run every minute.") is no longer shown',
        marks: [{ x0: 272, y0: 162, x1: 1262, y1: 236, note: 'scheduled result shown as the answer to the user’s prompt', noteX: 420 }],
      },
      {
        img: `${R}/head-ok/out/webshell-cold.png`,
        slices: [[80, 715]],
        tone: 'after',
        label: 'AFTER · PR head a8ad4d3b67 merged onto the same main — the scheduled task is replayed as its own turn, followed by its result',
        marks: [{ x0: 668, y0: 368, x1: 1262, y1: 415, note: 'replayed cron record (subtype=cron)', noteX: 420 }],
      },
    ],
  );
  await figure(
    '02-failed-fire-before.png',
    'BEFORE (main): a scheduled fire fails (provider 400), then the daemon restarts',
    [
      {
        img: `${R}/base-fail/out/webshell-live.png`,
        slices: [[80, 345], [705, 770]],
        tone: 'before',
        label: 'Live session, fresh tab (before restart): the recovery banner already appears, but the request it refers to is not in the transcript',
        marks: [{ x0: 276, y0: 713, x1: 1262, y1: 766 }],
      },
      {
        img: `${R}/base-fail/out/webshell-cold.png`,
        slices: [[80, 345], [705, 770]],
        tone: 'before',
        label: 'After restart: the failed fire and the banner are both gone; GET /session/:id/context → recovery.kind = "clean" (live said "interrupted_prompt")',
      },
    ],
  );
  await figure(
    '03-failed-fire-after.png',
    'AFTER (PR): the same failed fire, restart, then "Continue execution"',
    [
      {
        img: `${R}/head-fail/out/webshell-cold.png`,
        slices: [[80, 425], [705, 770]],
        tone: 'after',
        label: 'After restart: the failed task is replayed and the banner matches the live session (recovery.kind = "interrupted_prompt" both live and cold)',
        marks: [
          { x0: 955, y0: 368, x1: 1262, y1: 415 },
          { x0: 276, y0: 713, x1: 1262, y1: 766 },
        ],
      },
      {
        img: `${R}/head-fail/out/webshell-continue.png`,
        slices: [[80, 520]],
        tone: 'after',
        label: 'After clicking "Continue execution" (POST /session/:id/continue): the task is answered; the transcript still holds exactly one cron record',
        marks: [{ x0: 272, y0: 440, x1: 700, y1: 510 }],
      },
    ],
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
