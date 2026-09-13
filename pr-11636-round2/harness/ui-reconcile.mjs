// ARM=head|pre node ui-reconcile.mjs [tag]
// R2-1: after both background agents are consumed, RELOAD the page so the
// completion markers come from the transcript producer (no task record).
// Does the page still reconcile the launching tool rows and fold the round?
import * as O from './obs.mjs';
import * as U from './ui.mjs';

const tag = process.argv[2] || 'r1';
const label = `${O.ARM}-reconcile-${tag}`;
const NEEDLES = [
  'Ownership is understood; rendering is still being investigated.',
  'Ownership and rendering findings are complete. This is the final main-agent answer.',
  'Both investigations are running.',
];
const out = { label, arm: O.ARM, facts: {}, shots: [], steps: [] };
const step = (m, x) => { out.steps.push({ t: Date.now(), m, ...(x || {}) }); console.log(`[${label} +${O.rel()}s] ${m}`, x ? JSON.stringify(x).slice(0, 700) : ''); };
const waitMock = async (pred, ms, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const hit = pred(await O.mockLog()); if (hit) return hit; await O.sleep(150); }
  step(`TIMEOUT ${what}`);
};
const notifDone = (d) => (log) => { const r = log.find((x) => x.kind === 'parent' && x.notifs.includes(d)); return r && (r.ended || r.aborted) ? r : undefined; };

async function deep(page) {
  return page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
    const attrs = new Set();
    for (const el of q('*')) for (const a of el.attributes) if (a.name.startsWith('data-')) attrs.add(a.name);
    const btn = q('button').map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean);
    const counts = {};
    for (const n of btn) counts[n] = (counts[n] || 0) + 1;
    return {
      dataAttrs: [...attrs].sort(),
      buttons: counts,
      markers: q('[data-background-turn-start]').map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
      userRows: q('[data-web-shell-user-row]').length,
      spinners: q('[aria-busy="true"], [data-status="running"], [data-status="executing"]').filter(vis).length,
      bodyText: document.body.innerText.replace(/\n{3,}/g, '\n\n'),
    };
  });
}

await O.mockRun(label);
const s = await O.createSession();
const sid = s.sessionId;
out.sid = sid;
const sse = []; const polls = [];
const unsub = O.subscribe(sid, s.clientId, sse);
const unpoll = O.poll(sid, polls);
const { browser, page, errors } = await U.open(sid);
step('web shell open', { sid });

const capture = async (key, name, full = true) => {
  await page.waitForTimeout(400);
  out.facts[key] = { t: Date.now(), ...(await U.facts(page, sid, NEEDLES)), deep: await deep(page) };
  out.shots.push(await U.shot(page, `${O.ARM}-reconcile-${name}`, { fullPage: full }));
  step(key, { markers: out.facts[key].markers, userRows: out.facts[key].userRows, expandSteps: out.facts[key].expandSteps, collapseSteps: out.facts[key].collapseSteps });
};

await U.send(page, '[[S:two]] Investigate ownership and rendering in parallel');
await waitMock(notifDone('Ownership investigation'), 60000, 'alpha consumed');
await waitMock(notifDone('Rendering investigation'), 90000, 'beta consumed');
await page.waitForTimeout(4000);
await capture('live', '1-live');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cm-content', { timeout: 30000 });
await page.waitForTimeout(5000);
await capture('afterReload', '2-after-reload');

unsub(); unpoll();
out.errors = errors; out.sse = sse; out.polls = polls; out.mock = await O.mockLog();
O.save(`${U.SHOTS}/../runs/${label}.json`, { ...out, T0: O.T0 });
step('saved');
await browser.close();
process.exit(0);
