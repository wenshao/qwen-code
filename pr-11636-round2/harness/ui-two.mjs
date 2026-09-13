// ARM=pr|base node ui-two.mjs [tag]
// Two background agents return one after another while the parent is idle.
// Real daemon + real Web Shell; screenshots and DOM facts at each state.
import * as O from './obs.mjs';
import * as U from './ui.mjs';

const tag = process.argv[2] || 'r1';
const label = `${O.ARM}-two-${tag}`;
const OWN = 'Ownership is understood; rendering is still being investigated.';
const FINAL = 'Ownership and rendering findings are complete. This is the final main-agent answer.';
const NEEDLES = [OWN, FINAL, 'Both investigations are running.', 'SUBRESULT-alpha', 'Processing Ownership investigation results'];
const out = { label, arm: O.ARM, facts: {}, shots: [], steps: [] };
const step = (m, x) => {
  out.steps.push({ t: Date.now(), m, ...(x || {}) });
  console.log(`[${label} +${O.rel()}s] ${m}`, x ? JSON.stringify(x).slice(0, 400) : '');
};
const waitMock = async (pred, ms, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = pred(await O.mockLog());
    if (hit) return hit;
    await O.sleep(150);
  }
  step(`TIMEOUT ${what}`);
};
const notif = (d) => (log) => log.find((r) => r.kind === 'parent' && r.notifs.includes(d));

await O.mockRun(label);
const s = await O.createSession();
const sid = s.sessionId;
out.sid = sid;
const sse = [];
const polls = [];
const unsub = O.subscribe(sid, s.clientId, sse);
const unpoll = O.poll(sid, polls);
const { browser, page, net, errors } = await U.open(sid);
step('web shell open', { sid });

const capture = async (key, name, full = false) => {
  await page.waitForTimeout(300);
  out.facts[key] = { t: Date.now(), ...(await U.facts(page, sid, NEEDLES)) };
  out.shots.push(await U.shot(page, `${O.ARM}-two-${name}`, { fullPage: full }));
  step(key, out.facts[key]);
};

await U.send(page, '[[S:two]] Investigate ownership and rendering in parallel');
await waitMock((l) => l.find((r) => r.kind === 'parent' && r.scenario === 'two' && r.step === 1 && r.ended), 30000, 'parent final');
await page.waitForTimeout(1500);
await capture('bgOnly', '1-bg-only');

await waitMock(notif('Ownership investigation'), 30000, 'ownership continuation');
await page.waitForTimeout(1200);
await capture('autoRunning', '2-auto-running');

await waitMock((l) => {
  const r = notif('Rendering investigation')(l);
  return r && (r.ended || r.aborted) ? r : undefined;
}, 60000, 'rendering continuation end');
await page.waitForTimeout(3000);
await capture('done', '3-done', true);

const collapse = page.getByRole('button', { name: 'Collapse steps', exact: true });
if (await collapse.count()) {
  await collapse.last().click();
  await page.waitForTimeout(800);
}
await capture('collapsed', '4-collapsed', true);

const markers = page.locator('[data-background-turn-start]');
if (await markers.count()) {
  await markers.nth(0).getByRole('button', { name: 'View details', exact: true }).click();
  await page.waitForTimeout(3000);
  const panel = page.locator('aside[aria-label="Right panel"]');
  out.facts.details = {
    panelVisible: (await panel.count()) > 0,
    selectedTab: await page.locator('[role="tablist"][aria-label="Right panel"] [role="tab"][aria-selected="true"]').allInnerTexts().catch(() => []),
    panelHasSubResult: (await panel.innerText().catch(() => '')).includes('SUBRESULT-alpha'),
    panelText: (await panel.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300),
  };
  step('details', out.facts.details);
  out.shots.push(await U.shot(page, `${O.ARM}-two-5-details`));
  await markers.nth(0).getByRole('button', { name: 'Source', exact: true }).click();
  await page.waitForTimeout(1500);
  await capture('source', '6-source');
}

const live = (await O.api(`/workspaces/${encodeURIComponent(O.cfg.ws)}/sessions/live-state`)).json;
out.liveFinal = (live?.sessions ?? []).find((x) => x.sessionId === sid);
unsub();
unpoll();
out.net = net;
out.errors = errors;
out.sse = sse;
out.polls = polls;
out.mock = await O.mockLog();
O.save(`/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/63de0ea4-4d44-4577-a263-66b150608516/scratchpad/h/out/runs/${label}.json`, { ...out, T0: O.T0, actions: out.steps.map((x) => ({ t: x.t, m: x.m })) });
step('saved');
await browser.close();
process.exit(0);
