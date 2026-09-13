// ARM=head|pre node rest-two.mjs  -> drive the two-agent scenario over REST,
// wait until both results are consumed, print the session id.
import fs from 'node:fs';
import * as O from './obs.mjs';
const label = `${O.ARM}-restfirst`;
await O.mockRun(label);
const s = await O.createSession();
const sid = s.sessionId;
const rows = [];
const un = O.subscribe(sid, s.clientId, rows);
await O.prompt(sid, s.clientId, '[[S:two]] Investigate ownership and rendering in parallel');
const waitMock = async (pred, ms, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const hit = pred(await O.mockLog()); if (hit) return hit; await O.sleep(200); }
  console.log('TIMEOUT', what);
};
const done = (d) => (log) => { const r = log.find((x) => x.kind === 'parent' && x.notifs.includes(d)); return r && (r.ended || r.aborted) ? r : undefined; };
await waitMock(done('Ownership investigation'), 60000, 'alpha');
await waitMock(done('Rendering investigation'), 90000, 'beta');
await O.sleep(4000);
un();
fs.writeFileSync(`${new URL('.', import.meta.url).pathname}out/sid-${O.ARM}.txt`, sid);
console.log('SID', sid);
process.exit(0);
