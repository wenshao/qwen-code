// VERIFICATION RIG ONLY (PR #13179): after a short real outage, when does the red "upstream unavailable" line go away?
import { execFileSync } from 'node:child_process';
import { createSession, waitTurn, ensureWorkspace, WS, ST, Report, j, RIG, DB, api, submit } from './lib.mjs';
import { launch, open, alertText, shot, sleep } from './ui.mjs';
const r = new Report('u1b-banner');
ensureWorkspace(WS, `st-${ST}`);
const c = await createSession('public', WS, 'UI_STREAM n=3 delay=20 tag=BAN');
r.check('turn 1 completed', (await waitTurn(c.session)).status === 'COMPLETED');
const b = await launch();
const pages = [];
for (const arm of ['base', 'head']) pages.push(await open(b, { arm, session: c.session }));
for (const p of pages) await p.page.getByText('[BAN-0003]').first().waitFor({ timeout: 30_000 });
await sleep(5000);
r.say(execFileSync(`${RIG}/stop.sh`, [DB, 'spring'], { encoding: 'utf8' }).trim());
await sleep(20_000);
r.say(execFileSync(`${RIG}/spring.sh`, ['merge', DB, 'absent', 'absent'], { encoding: 'utf8', env: { ...process.env, DIST: 'merge' } }).trim().split('\n').at(-1));
const tUp = Date.now();
for (let s = 0; s < 45; s++) await sleep(1000);
for (const p of pages) r.note(`${p.arm}: alerts 45 s after the server came back`, j(await alertText(p.page)));
for (const p of pages) r.note(`${p.arm}: stream 200 after recovery`, j(p.net.filter((e) => e.t >= tUp && e.path === '/events/stream' && e.status === 200).length));
for (const p of pages) await shot(p.page, `u1b-${p.arm}-45s-after-recovery`);
const sub = await submit(c.session, 'UI_STREAM n=3 delay=20 tag=NEW');
r.note('turn 2 submitted', `${sub.status}`);
const t2 = await waitTurn(c.session, { timeoutMs: 60_000 });
r.note('turn 2', j(t2));
await sleep(5000);
for (const p of pages) {
  const alerts = await alertText(p.page);
  r.note(`${p.arm}: alerts after turn 2 events arrived`, j(alerts));
  r.note(`${p.arm}: turn 2 rendered`, j(await p.page.getByText('[NEW-0003]').count()));
}
await b.close();
r.done({ session: c.session });
