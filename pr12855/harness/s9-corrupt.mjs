// S9: a revision that does not chain reaches the journal through a server
// that does not check (main), written by a bypass writer. A cold reopen by
// the PR authority must refuse to open (design: "opening fails").
import { FIXTURES, RefMapper, commitMonitor, openLog, openSession, say } from './lib.mjs';
import { randomUUID } from 'node:crypto';
const PORT = Number(process.env.PORT);
openLog('s9-corrupt');
const sessionId = randomUUID();
const { session, sessionKey } = await openSession({ sessionId, writerId: 'bypass', create: true, port: PORT });
const refs = new RefMapper(session.resources);
const revs = await Promise.all(FIXTURES.monitorChainCases[0].revisions.map((r) => refs.remap(r.monitorRun)));
await commitMonitor(session, sessionKey, 'm:1', revs[0]);
await commitMonitor(session, sessionKey, 'm:2', revs[1]);
session.authority.assertExtensionRevision = () => {};
await commitMonitor(session, sessionKey, 'm:back', revs[0]); // steps back to admitted/intent
await session.close();
let reopen;
try {
  const b = await openSession({ sessionId, writerId: 'reader', port: PORT });
  reopen = `opened; views=${JSON.stringify(b.session.authority.taskViews().map((v) => v.state + '/' + v.runtimeState))}`;
  await b.session.close();
} catch (e) {
  reopen = `${e.name}: ${String(e.message).slice(0, 200)}`;
}
say('reopen-after-corrupt-chain', reopen);
