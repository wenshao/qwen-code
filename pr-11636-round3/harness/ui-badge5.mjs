// R4-11 with the tool group EXPANDED (the only place the agent row header, and
// therefore ToolGroup's completeMeta, is rendered).
import * as O from './obs.mjs';
import * as U from './ui.mjs';
const label = `${O.ARM}-badge5`;
const out = { arm: O.ARM, label, steps: [], shots: [] };
const step = (m, x) => { out.steps.push({ t: O.rel(), m, ...(x || {}) }); console.log(`[${label} +${O.rel()}s] ${m}`, x ? JSON.stringify(x).slice(0, 320) : ''); };
await O.mockRun(label);
const s = await O.createSession();
const sid = s.sessionId; out.sid = sid;
const { browser, page } = await U.open(sid);
await U.send(page, '[[S:pendtwo]] investigate alpha then wait quietly');
await page.waitForTimeout(7000);

const collapse = page.locator('[aria-label="Collapse steps"]').last();
if (await collapse.count()) { step('group already expanded (aria-label=Collapse steps)'); }
await page.waitForTimeout(1500);

const read = async () => page.evaluate(() => {
  const norm = (x) => (x || '').replace(/\s+/g, ' ').trim();
  const lines = [...document.querySelectorAll('[class*="lineName"]')].map((e) => norm((e.closest('[class*="lineMain"]') || e.parentElement)?.innerText));
  const allLines = [...document.querySelectorAll('[data-transcript-tool-call-id]')].map((e) => norm(e.innerText) + ' #' + e.getAttribute('data-transcript-tool-call-id'));
  return { awaiting: /Awaiting processing/.test(document.body.innerText), lines, allLines, body: norm(document.body.innerText).slice(0, 700) };
});
out.expanded = await read();
out.shots.push(await U.shot(page, `${O.ARM}-badge5-1-expanded`));
step('expanded view', out.expanded);

await page.waitForTimeout(26000);
out.after = await read();
out.shots.push(await U.shot(page, `${O.ARM}-badge5-2-after`));
step('after consumption', { awaiting: out.after.awaiting, lines: out.after.lines });

O.save(`/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/h/out/runs/${label}.json`, out);
console.log('\n=== VERDICT ===');
console.log(JSON.stringify({ arm: O.ARM, awaitingWhilePending: out.expanded.awaiting, agentLinesWhilePending: out.expanded.lines, toolRowsWhilePending: out.expanded.allLines, awaitingAfter: out.after.awaiting }, null, 1));
await browser.close(); process.exit(0);
