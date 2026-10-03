// VERIFICATION RIG ONLY (PR #13179): a real server outage. K pages per arm watch one Session; the Java server
// (Spring + embedded Broker) is stopped for OUTAGE_S seconds and started again. Each arm reaches it through its
// own wire, which answers 502 while nothing listens (an ingress in front of a dead server). Every adapter request
// of every page is recorded in the browser with its outcome.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createSession, waitTurn, ensureWorkspace, WS, ST, Report, j, RIG, DB, api } from './lib.mjs';
import { launch, open, alertText, shot, counts, gaps, sleep } from './ui.mjs';
const K = Number(process.env.K ?? 4);
const OUTAGE_S = Number(process.env.OUTAGE_S ?? 180);
const AFTER_S = Number(process.env.AFTER_S ?? 75);
const r = new Report('u1-outage');
ensureWorkspace(WS, `st-${ST}`);
const c = await createSession('public', WS, 'UI_STREAM n=5 delay=20 tag=OUT');
const t = await waitTurn(c.session);
r.check('turn completed before the outage', t.status === 'COMPLETED', j(t));
const b = await launch();
const pages = [];
for (let i = 0; i < K; i++) for (const arm of ['base', 'head']) pages.push({ ...(await open(b, { arm, session: c.session, scale: 1 })), i });
for (const p of pages) await p.page.getByText('[OUT-0005]').first().waitFor({ timeout: 30_000 });
r.check('all pages render the transcript', true, `${pages.length} pages`);
await sleep(10_000);
const tKill = Date.now();
r.say(execFileSync(`${RIG}/stop.sh`, [DB, 'spring'], { encoding: 'utf8' }).trim());
const tDown = Date.now();
const shots = [Math.min(60, OUTAGE_S - 5)];
for (let s = 0; s < OUTAGE_S; s++) {
  await sleep(1000);
  if (shots.includes(s + 1)) for (const p of pages.filter((x) => x.i === 0)) await shot(p.page, `u1-${p.arm}-outage-${s + 1}s`);
}
const tStart = Date.now();
r.say(execFileSync(`${RIG}/spring.sh`, ['merge', DB, 'absent', 'absent'], { encoding: 'utf8' }).trim().split('\n').slice(-1)[0]);
// first moment the server answers again, observed from outside the browser
let tUp;
for (;;) { const x = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: c.session }).catch(() => ({ status: 0 })); if (x.status === 200) { tUp = Date.now(); break; } await sleep(200); }
r.note('server down', `${((tUp - tKill) / 1000).toFixed(1)} s (stopped at +${((tDown - tKill) / 1000).toFixed(1)} s, restart issued at +${((tStart - tKill) / 1000).toFixed(1)} s, answering at +${((tUp - tKill) / 1000).toFixed(1)} s)`);
await sleep(AFTER_S * 1000);
for (const p of pages.filter((x) => x.i === 0)) await shot(p.page, `u1-${p.arm}-recovered`);
const rows = [];
for (const p of pages) {
  const during = p.net.filter((e) => e.t >= tKill && e.t < tUp);
  const reco = (path) => p.net.find((e) => e.t >= tUp - 50 && e.path === path && e.status === 200);
  const firstAfter = (path) => p.net.find((e) => e.t >= tUp && e.path === path);
  const gget = gaps(during.filter((e) => e.path === '/sessions/get').map((e) => e.t));
  const gstr = gaps(during.filter((e) => e.path === '/events/stream').map((e) => e.t));
  const row = {
    arm: p.arm, i: p.i,
    outageRequests: during.length,
    outageByPath: counts(during),
    outageStatuses: [...new Set(during.map((e) => e.status ?? e.failed))],
    perMinute: +(during.length / ((tUp - tKill) / 60000)).toFixed(1),
    sessionsGetGapsS: gget.map((g) => +(g / 1000).toFixed(1)),
    streamGapsS: gstr.map((g) => +(g / 1000).toFixed(1)),
    streamBackS: reco('/events/stream') ? +((reco('/events/stream').t - tUp) / 1000).toFixed(1) : null,
    summaryBackS: reco('/sessions/get') ? +((reco('/sessions/get').t - tUp) / 1000).toFixed(1) : null,
    firstAttemptAfterUpS: firstAfter('/events/stream') ? +((firstAfter('/events/stream').t - tUp) / 1000).toFixed(1) : null,
    alertsAfter: await alertText(p.page),
    transcriptStill: await p.page.getByText('[OUT-0005]').count(),
  };
  rows.push(row);
  r.say(`ROW ${JSON.stringify(row)}`);
}
for (const arm of ['base', 'head']) {
  const a = rows.filter((x) => x.arm === arm);
  const sum = (f) => a.reduce((s, x) => s + f(x), 0);
  r.note(`${arm}: outage requests`, `${sum((x) => x.outageRequests)} over ${a.length} pages = ${(sum((x) => x.outageRequests) / a.length).toFixed(1)} per page (${(sum((x) => x.perMinute) / a.length).toFixed(1)}/min)`);
  r.note(`${arm}: stream back after server up (s)`, j(a.map((x) => x.streamBackS)));
  r.note(`${arm}: summary back after server up (s)`, j(a.map((x) => x.summaryBackS)));
  r.check(`${arm}: every page recovered its stream`, a.every((x) => x.streamBackS !== null), j(a.map((x) => x.streamBackS)));
  r.check(`${arm}: no alert left after recovery`, a.every((x) => x.alertsAfter.length === 0), j(a.map((x) => x.alertsAfter)));
}
fs.writeFileSync(`${RIG}/out/${DB}/u1-net.json`, JSON.stringify({ tKill, tDown, tStart, tUp, pages: pages.map((p) => ({ arm: p.arm, i: p.i, net: p.net })) }));
await b.close();
r.done({ session: c.session, rows });
