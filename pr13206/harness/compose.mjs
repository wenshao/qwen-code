// VERIFICATION RIG ONLY (PR #13206): compose labelled base/head evidence figures from the raw screenshots.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const RIG = '/Users/wenshao/pr13206-rig';
const require = createRequire(`${RIG}/wt-head/package.json`);
const { chromium } = require('playwright');
const RAW = `${RIG}/fig/raw`;
const OUT = `${RIG}/fig/pr13206`;
fs.mkdirSync(OUT, { recursive: true });

const FIGS = [
  {
    file: '01-corrupt-delta-frame.png',
    title: 'One corrupt delta frame (truncated JSON), served again on every replay',
    sub: 'Real Java server + Hosted Harness; the wire corrupts delta #10 of turn 2. Both arms watch the same Session at the same time.',
    crop: 1060,
    panels: [
      { img: 's1-delta-base-live.png', arm: 'main 5130c1a (base)', bad: true, note: 'Transcript frozen at [S1DELT-009] while the header says Completed. Decode error on screen; the stream reconnects every 3.01 s from the same cursor (22) and replays the same bad frame.' },
      { img: 's1-delta-head-live.png', arm: 'PR #13206 head 52867f3 merged into main (head)', bad: false, note: 'The frame is skipped with one console warning naming it (id 23); 29 of 30 chunks render and the stream stays connected. [S1DELT-010] is the documented hole; a page reload restores it (30/30 on both arms).' },
    ],
  },
  {
    file: '02-stale-page-after-gap.png',
    title: 'An older-page fetch lands after a real server gap and a full-history reload',
    sub: 'Page opened before materialization (raw paging), page 3 in flight; server restarted with the materializer on; real agent.session.resync_required; the stale page (cursor 67) lands last. The red hosted_harness_unavailable is the turn sent during the rig restart; it only supplies the events that move the server past the browsers.',
    crop: 1540,
    panels: [
      { img: 's8-lag-gap-stale-page-base-at-end-of-answer.png', arm: 'main 5130c1a (base)', bad: true, tag: 'duplicated', note: 'The raw page is merged into the assembled snapshot: after [LG-260] the answer restarts at [LG-002]. LG-002..LG-061 render twice (320 markers for 260 chunks). Reproduced 2/2.' },
      { img: 's8-lag-gap-stale-page-head-at-end-of-answer.png', arm: 'PR #13206 head 52867f3 merged into main (head)', bad: false, note: 'The full-history reload cleared the paging cursor, so the stale page is discarded: 260 markers, each once, in order. Reproduced 2/2.' },
    ],
  },
  {
    file: '03-corrupt-store-row.png',
    title: 'Out of scope, for the record: a corrupt row in the Java event store',
    sub: "managed_agent_event.data_json of chunk #30 set to '{\"delta\":\"tru' while both arms were disconnected below it.",
    crop: 1040,
    panels: [
      { img: 's0-poisoned-row-base-wedged.png', arm: 'main 5130c1a (base)', bad: true, note: 'The server never serves a corrupt frame: its row mapper throws "Stored event is invalid" and every replay from cursor 26 answers HTTP 500. The panel retries every ~3 s forever.' },
      { img: 's0-poisoned-row-head-wedged.png', arm: 'PR #13206 head 52867f3 merged into main (head)', bad: true, note: 'Identical: same cursor, same 500 loop, same banner. A full page reload escapes on both arms (the snapshot already covers the row).' },
    ],
  },
];

const css = `
  body { margin: 0; background: #f6f8fa; font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #1f2328; }
  .card { width: 1180px; padding: 22px 24px 26px; box-sizing: border-box; }
  h1 { font-size: 21px; margin: 0 0 4px; }
  .sub { color: #59636e; margin: 0 0 16px; font-size: 14px; }
  .panel { background: #fff; border: 1px solid #d1d9e0; border-radius: 10px; margin-bottom: 16px; overflow: hidden; }
  .head { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-bottom: 1px solid #d1d9e0; font-weight: 600; }
  .tag { font-size: 12px; padding: 2px 8px; border-radius: 999px; color: #fff; }
  .bad .tag { background: #cf222e; } .good .tag { background: #1a7f37; }
  .shot { height: VAR; overflow: hidden; border-bottom: 1px solid #d1d9e0; }
  .shot img { width: 1130px; display: block; }
  .note { padding: 10px 14px; font-size: 14px; }
  .bad .note { border-left: 4px solid #cf222e; } .good .note { border-left: 4px solid #1a7f37; }
`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
for (const fig of FIGS) {
  const h = Math.round((fig.crop * 1130) / 2360);
  const panels = fig.panels
    .map((p) => {
      const data = fs.readFileSync(`${RAW}/${p.img}`).toString('base64');
      return `<div class="panel ${p.bad ? 'bad' : 'good'}"><div class="head"><span class="tag">${p.tag ?? (p.bad ? 'stuck' : 'ok')}</span>${p.arm}</div><div class="shot"><img src="data:image/png;base64,${data}"></div><div class="note">${p.note}</div></div>`;
    })
    .join('');
  await page.setContent(`<html><head><style>${css.replace('VAR', `${h}px`)}</style></head><body><div class="card"><h1>${fig.title}</h1><p class="sub">${fig.sub}</p>${panels}</div></body></html>`);
  await page.waitForTimeout(200);
  await page.locator('.card').screenshot({ path: `${OUT}/${fig.file}` });
  console.log(fig.file, fs.statSync(`${OUT}/${fig.file}`).size);
}
await browser.close();
