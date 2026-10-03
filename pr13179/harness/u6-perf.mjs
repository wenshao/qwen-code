// VERIFICATION RIG ONLY (PR #13179): end-to-end cost of streamed deltas in the real panel.
// Both arms watch one Session; ROUNDS turns of N deltas each are streamed through the real Harness and Java server.
// Per page and per turn: main-thread task/script time (CDP Performance metrics) and how long after the server
// finished the turn the page rendered its last chunk.
import fs from 'node:fs';
import { createSession, waitTurn, ensureWorkspace, WS, ST, Report, j, RIG, DB, submit, lastSeq } from './lib.mjs';
import { launch, open, sleep } from './ui.mjs';
const N = Number(process.env.N ?? 2000), ROUNDS = Number(process.env.ROUNDS ?? 3), DELAY = Number(process.env.DELAY ?? 2);
const r = new Report('u6-perf');
ensureWorkspace(WS, `st-${ST}`);
const c = await createSession('public', WS, 'UI_STREAM n=2 delay=0 tag=P0');
r.check('turn 0 completed', (await waitTurn(c.session)).status === 'COMPLETED');
const b = await launch();
const pages = [];
for (const arm of ['base', 'head']) {
  const p = await open(b, { arm, session: c.session, scale: 1 });
  p.cdp = await p.page.context().newCDPSession(p.page);
  await p.cdp.send('Performance.enable');
  pages.push(p);
}
for (const p of pages) await p.page.getByText('[P0-0002]').first().waitFor({ timeout: 30_000 });
const metrics = async (p) => Object.fromEntries((await p.cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const rows = [];
for (let k = 1; k <= ROUNDS; k++) {
  const tag = `R${k}`;
  const before = {};
  for (const p of pages) before[p.arm] = await metrics(p);
  const seq0 = lastSeq(c.session);
  const t0 = Date.now();
  const sub = await submit(c.session, `UI_STREAM n=${N} delay=${DELAY} tag=${tag}`);
  const done = await waitTurn(c.session, { timeoutMs: 600_000 });
  const tServer = Date.now();
  const seen = {};
  await Promise.all(pages.map(async (p) => {
    await p.page.getByText(`[${tag}-${String(N).padStart(4, '0')}]`).first().waitFor({ timeout: 600_000 });
    seen[p.arm] = Date.now();
  }));
  await sleep(1500);
  for (const p of pages) {
    const a = await metrics(p);
    const row = {
      round: k, arm: p.arm, events: lastSeq(c.session) - seq0, historyEvents: lastSeq(c.session),
      serverTurnS: +((tServer - t0) / 1000).toFixed(1),
      renderedAfterServerS: +((seen[p.arm] - tServer) / 1000).toFixed(2),
      taskS: +(a.TaskDuration - before[p.arm].TaskDuration).toFixed(2),
      scriptS: +(a.ScriptDuration - before[p.arm].ScriptDuration).toFixed(2),
      layoutS: +(a.LayoutDuration - before[p.arm].LayoutDuration).toFixed(2),
      styleS: +(a.RecalcStyleDuration - before[p.arm].RecalcStyleDuration).toFixed(2),
      heapMB: +(a.JSHeapUsedSize / 1048576).toFixed(0),
    };
    rows.push(row);
    r.say(`ROW ${JSON.stringify(row)}`);
  }
  r.check(`round ${k}: turn completed (${sub.status})`, done.status === 'COMPLETED', j(done));
}
for (const arm of ['base', 'head']) r.note(`${arm}: task seconds per round`, j(rows.filter((x) => x.arm === arm).map((x) => x.taskS)));
for (const arm of ['base', 'head']) r.note(`${arm}: script seconds per round`, j(rows.filter((x) => x.arm === arm).map((x) => x.scriptS)));
await b.close();
r.done({ session: c.session, rows });
