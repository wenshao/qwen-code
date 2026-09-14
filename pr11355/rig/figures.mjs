// Renders the A/B evidence cards (HTML -> PNG) from the scenario summaries.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { RIG, RUNS } from './lib.mjs';

const require = createRequire(path.join(RIG, '..', 'wt-head', 'package.json'));
const { chromium } = require('playwright');

const FIGS = path.join(RIG, 'figs');
fs.mkdirSync(FIGS, { recursive: true });
const load = (name, arm) => JSON.parse(fs.readFileSync(path.join(RUNS, `${name}-${arm}`, 'summary.json'), 'utf8'));
const HEAD = 'PR head 025e4bf';
const BASE = 'base 4a029e6';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const iso = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString().slice(11, 23) : String(ms));

const CSS = `
  body { margin: 0; background: #0d1117; color: #e6edf3; font: 14px/1.45 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
  .card { width: 1080px; padding: 22px 26px 18px; box-sizing: border-box; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  .sub { color: #8b949e; margin: 0 0 14px; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #30363d; padding: 6px 9px; vertical-align: top; text-align: left; }
  th { background: #161b22; color: #c9d1d9; font-weight: 600; }
  td.scn { background: #161b22; font-weight: 600; width: 150px; }
  td.obs { width: 175px; color: #c9d1d9; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  .bad { color: #ff7b72; } .good { color: #3fb950; } .dim { color: #8b949e; } .warn { color: #d29922; }
  .note { border-left: 3px solid #388bfd; padding: 6px 10px; margin-top: 12px; color: #c9d1d9; background: #0f1620; font-size: 13px; }
  ul { margin: 0; padding-left: 16px; }
  .ts { color: #8b949e; font-size: 12px; }
`;

function list(items, cls = '') {
  if (!items || items.length === 0) return `<span class="dim">none</span>`;
  return `<ul>${items.map((i) => `<li class="${cls}"><code>${esc(i)}</code></li>`).join('')}</ul>`;
}

function subs(s) { return list(s.subscriptions.map((x) => x.replace('event consume ', ''))); }
function polls(s) { return `<code>list-all ×${s.polls['chat message list-all']}</code><br><code>list-mentions ×${s.polls['chat message list-mentions']}</code><br><code>todo task list ×${s.polls['todo task list']}</code>`; }

async function render(browser, name, html) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="card" id="card">${html}</div></body></html>`);
  const file = path.join(FIGS, `${name}.png`);
  await page.locator('#card').screenshot({ path: file });
  await page.close();
  process.stdout.write(`${file}\n`);
}

const browser = await chromium.launch();

// ---- Figure: source gating matrix ----
{
  const g = { head: load('group-only', 'head'), base: load('group-only', 'base') };
  const d = { head: load('dm-only', 'head'), base: load('dm-only', 'base') };
  const t = { head: load('todo-only', 'head'), base: load('todo-only', 'base') };
  const row = (scn, obs, b, h) => `<tr>${scn ? `<td class="scn" rowspan="${scn.n}">${scn.t}</td>` : ''}<td class="obs">${obs}</td><td>${b}</td><td>${h}</td></tr>`;
  const html = `
  <h1>Disabled chat sources: what the real <code>dws</code> process boundary sees</h1>
  <p class="sub">Same fake <code>dws</code> CLI on PATH, same fake OpenAI upstream, same seeded history (DM + document card + @mention), same injected live events. Bundled <code>qwen channel start</code>, ~25 s per run. Counts are argv invocations of the fake <code>dws</code> binary; "model prompts" are the probe markers found in the last user message of each <code>/v1/chat/completions</code> request.</p>
  <table>
    <tr><th style="width:150px">Scenario</th><th style="width:175px">Observation</th><th>${BASE}</th><th>${HEAD}</th></tr>
    ${row({ t: `Group-only<br><span class="dim mono">dmPolicy=disabled<br>groupPolicy=open<br>groups["*"].requireMention=true</span>`, n: 4 }, 'live subscriptions (<code>event consume</code>)', subs(g.base), subs(g.head))}
    ${row(null, 'history polls', `<span class="bad">${polls(g.base)}</span>`, `<span class="good">${polls(g.head)}</span>`)}
    ${row(null, 'document card in DM history', `<span class="bad">doc read ×${g.base.docReads}, doc comment reply ×${g.base.docCommentReplies} → a task ran from the disabled source</span>`, `<span class="good">doc read ×${g.head.docReads}, doc comment reply ×${g.head.docCommentReplies}</span>`)}
    ${row(null, 'model prompts', list(g.base.modelPrompts), list(g.head.modelPrompts))}
    ${row({ t: `DM-only<br><span class="dim mono">groupPolicy=disabled<br>dmPolicy=open<br>groups["grp-ambient"].requireMention=false</span>`, n: 4 }, 'live subscriptions', `<span class="bad">${subs(d.base)}</span>`, `<span class="good">${subs(d.head)}</span>`)}
    ${row(null, 'history polls', `<span class="bad">${polls(d.base)}</span>`, `<span class="good">${polls(d.head)}</span>`)}
    ${row(null, 'model prompts', list(d.base.modelPrompts), list(d.head.modelPrompts))}
    ${row(null, 'channel stderr', list(d.base.logLines.map((l) => l.replace('[Channel:dws-probe] ', ''))), list(d.head.logLines))}
    ${row({ t: `Todo-only<br><span class="dim mono">groupPolicy=disabled<br>dmPolicy=disabled<br>watchTodos=true</span>`, n: 3 }, 'live subscriptions', `<span class="bad">${subs(t.base)}</span>`, `<span class="good">${subs(t.head)}</span>`)}
    ${row(null, 'history / todo polls', `<span class="bad">${polls(t.base)}</span>`, `<span class="good">${polls(t.head)}</span>`)}
    ${row(null, 'changed todo → task', `${list(t.base.modelPrompts)} todo comment add ×${t.base.todoCommentAdds}`, `${list(t.head.modelPrompts)} todo comment add ×${t.head.todoCommentAdds}`)}
  </table>
  <div class="note">On base the disabled source is still subscribed and polled, and its messages are only rejected after the fact (<code>preflight rejected reason=dm_disabled / group_disabled</code>); a document-notification card slips through that rejection and starts a task. On the PR head the disabled source has no subscription and no history poll, so nothing from it is fetched at all. Native todo polling is unaffected on both arms.</div>`;
  await render(browser, '04-source-gating-ab', html);
}

// ---- Figure: restart with pending work from a disabled source ----
{
  const h = load('restart', 'head');
  const b = load('restart', 'base');
  const cur = (c) => c ? `pendingMessages: ${JSON.stringify(c.pendingMessages)}<br>pendingDocumentNotifications: ${JSON.stringify(c.pendingDocumentNotifications)}<br>directMessagesEnabled: ${JSON.stringify(c.directMessagesEnabled)}` : 'n/a';
  const parkedDocsAfter = (s) => (s.phase2.cursorAfter?.pendingDocumentNotifications ?? []).map((p) => `${p.documentId} (${p.senderId})`);
  const html = `
  <h1>Restart with persisted work from a source that is now disabled</h1>
  <p class="sub">Phase 1 (both chat sources open, <code>senderPolicy=pairing</code>, Alice/Carol/Dave allowed, Bob unpaired): the model upstream hangs, three turns are in flight, then the channel is SIGKILLed. Phase 2: <code>dmPolicy</code> flipped to <code>disabled</code>, model healthy, channel restarted. Identical phase-1 state on both arms.</p>
  <table>
    <tr><th style="width:230px">Phase 1 persisted cursor (both arms)</th><td colspan="2"><code>pendingMessages = ${esc(JSON.stringify(h.phase1.parked.pending))}</code><br><code>pendingDocumentNotifications = ${esc(JSON.stringify(h.phase1.parked.docs))}</code> (Bob's card parked for pairing)<br><span class="dim">hung model turns: ${h.phase1.parked.hung}</span></td></tr>
    <tr><th>After restart</th><th>${BASE}</th><th>${HEAD}</th></tr>
    <tr><td class="obs">channel stderr</td><td>${list(b.logLines.map((l) => l.replace('[Channel:dws-probe] ', '')), 'bad')}</td><td>${list(h.logLines.map((l) => l.replace('[Channel:dws-probe] ', '')), 'good')}</td></tr>
    <tr><td class="obs">cursor as seen by the fake <code>dws</code> at the <b>first</b> history poll after restart (<code>${esc(h.phase2.firstHistoryPoll.command)}</code>)</td><td class="mono">${cur(b.phase2.firstHistoryPoll.cursor)}</td><td class="mono good">${cur(h.phase2.firstHistoryPoll.cursor)}</td></tr>
    <tr><td class="obs">history polls after restart</td><td>${list([...new Set(b.phase2.historyPollsAfterRestart)].map((c) => `${c} ×${b.phase2.historyPollsAfterRestart.filter((x) => x === c).length}`))}</td><td>${list([...new Set(h.phase2.historyPollsAfterRestart)].map((c) => `${c} ×${h.phase2.historyPollsAfterRestart.filter((x) => x === c).length}`))}</td></tr>
    <tr><td class="obs">model prompts after restart</td><td>${list(b.phase2.modelPromptsAfterRestart)}</td><td>${list(h.phase2.modelPromptsAfterRestart)}</td></tr>
    <tr><td class="obs">document task from replayed DM card</td><td><span class="bad">doc read ×${b.phase2.docReadsAfterRestart}, doc comment reply ×${b.phase2.docCommentRepliesAfterRestart}</span></td><td><span class="good">doc read ×${h.phase2.docReadsAfterRestart}, doc comment reply ×${h.phase2.docCommentRepliesAfterRestart}</span></td></tr>
    <tr><td class="obs">parked doc notifications left in cursor at exit</td><td>${list(parkedDocsAfter(b), 'warn')}</td><td>${list(parkedDocsAfter(h), 'good')}</td></tr>
  </table>
  <div class="note">PR head: both pending direct messages and the parked document notification are discarded and the cursor is already persisted (<code>directMessagesEnabled:false</code>, only the @-mention pending) before the first history poll; only the @-mention turn is replayed. Base: the pending DM card is replayed into a full document task (doc read → model → comment reply) despite <code>dmPolicy=disabled</code>; the plain DM is replayed and then rejected; Bob's parked notification stays in the cursor indefinitely.</div>`;
  await render(browser, '05-restart-discard-ab', html);
}

// ---- Figure: disable -> re-enable history floor ----
{
  const h = load('reenable', 'head');
  const b = load('reenable', 'base');
  const win = (s) => list(s.map((w) => `${w.t.slice(11, 19)}Z  window ${iso(w.windowStart)} → ${iso(w.windowEnd)}  served=${JSON.stringify(w.served)}`));
  const html = `
  <h1>Disable → re-enable direct messages: where does history recovery restart?</h1>
  <p class="sub">Phase 1: DMs open, watermark advances, graceful stop. Phase 2: <code>dmPolicy=disabled</code>; a DM (<code>dm-during-disabled</code>) arrives in history and on the live stream during the disabled interval; stop. Phase 3: <code>dmPolicy=open</code> again; then a fresh live DM (<code>dm-after-reenable</code>).</p>
  <table>
    <tr><th style="width:230px"></th><th>${BASE}</th><th>${HEAD}</th></tr>
    <tr><td class="obs">phase-1 <code>notificationWatermark</code></td><td class="mono">${iso(b.phase1.notificationWatermark)}</td><td class="mono">${iso(h.phase1.notificationWatermark)}</td></tr>
    <tr><td class="obs">disabled-interval DM <code>eventTime</code></td><td class="mono">${iso(b.duringDisabledAt)}</td><td class="mono">${iso(h.duringDisabledAt)}</td></tr>
    <tr><td class="obs">phase 2 (disabled): <code>list-all</code> calls</td><td>${win(b.phase2.listAll)}<span class="bad">fetched while disabled, then rejected + marked processed</span></td><td><span class="good">none (list-mentions ×${h.phase2.listMentions} only)</span></td></tr>
    <tr><td class="obs">phase 2: model prompts</td><td>${list(b.phase2.modelPrompts)}</td><td>${list(h.phase2.modelPrompts)}</td></tr>
    <tr><td class="obs">phase 3 (re-enabled): stderr</td><td>${list(b.phase3.reenableLog.filter((l) => !l.includes('[scheduler]')).map((l) => l.replace('[Channel:dws-probe] ', '')))}</td><td>${list(h.phase3.reenableLog.filter((l) => !l.includes('[scheduler]')).map((l) => l.replace('[Channel:dws-probe] ', '')), 'good')}</td></tr>
    <tr><td class="obs">phase 3: <code>list-all</code> windows</td><td>${win(b.phase3.listAll)}</td><td>${win(h.phase3.listAll)}</td></tr>
    <tr><td class="obs">phase 3: persisted floor</td><td class="mono dim">no such field</td><td class="mono">notificationHistoryFloor = ${iso(h.phase3.cursor.notificationHistoryFloor)}</td></tr>
    <tr><td class="obs">phase 3: model prompts</td><td>${list(b.phase3.modelPrompts)}</td><td>${list(h.phase3.modelPrompts)}</td></tr>
  </table>
  <div class="note">PR head never fetches direct history while disabled (watermark stays at ${iso(h.phase1.notificationWatermark)}, older than the disabled-interval DM), and on re-enable the poll window starts at the re-enable floor instead of the stale watermark − 5 s overlap, so the disabled-interval message is neither fetched nor replayed; the next live DM is processed normally. Base keeps polling while disabled and only rejects what it fetched.</div>`;
  await render(browser, '06-reenable-floor-ab', html);
}

await browser.close();
