// S4c: unknown outcome followed by a crash of writer A; writer B takes over
// after the lease expires and retries the same command.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { FIXTURES, RIG, RefMapper, allEvents, commitMonitor, createPublicSession, javaRows, journalCounts, openLog, openSession, say, sleep } from './lib.mjs';
openLog(process.env.WT ? "new-s4c-crash" : "s4c-crash");
const pub = await createPublicSession({ actor: 'alice' });
const sessionId = pub.id;
const out = `${RIG}/out/s4c-child.json`;
execFileSync(process.execPath, [`${RIG}/s4c-child.mjs`, sessionId, out], { stdio: 'inherit' });
const child = JSON.parse(fs.readFileSync(out, 'utf8'));
const taskEvents = async () => (await allEvents(sessionId)).filter((e) => e.type === 'task.updated').length;
const afterCrash = { counts: journalCounts(sessionId), row: javaRows(sessionId)[0].slice(0, 3), taskEvents: await taskEvents() };
let b, tries = 0;
while (!b) {
  tries++;
  try { b = await openSession({ sessionId, writerId: 'crash-b' }); } catch { await sleep(2000); }
}
const takeoverSeconds = ((Date.now() - child.diedAt) / 1000).toFixed(1);
// reuse A's refs that Java holds; publish the rest through B
const held = new Set((await import('./lib.mjs')).sql(`SELECT resource_id FROM qwen_managed_session_resource WHERE session_id='${sessionId}'`).map((r) => r[0]));
const refs = new RefMapper(b.session.resources);
for (const [k, ref] of Object.entries(child.refMap)) if (held.has(ref.resourceId)) refs.map.set(k, Promise.resolve(ref));
const bodies = await Promise.all(FIXTURES.monitorChainCases[0].revisions.map((r) => refs.remap(r.monitorRun)));
const rebuilt = b.session.authority.extensionRecord('monitor_run', 'monitor-1');
const replay = await commitMonitor(b.session, b.sessionKey, 'monitor-1:3', bodies[2]);
let conflict;
try { await commitMonitor(b.session, b.sessionKey, 'monitor-1:3', bodies[3]); } catch (e) { conflict = `${e.name}: ${String(e.message).slice(0, 90)}`; }
const afterReplay = { counts: journalCounts(sessionId), row: javaRows(sessionId)[0].slice(0, 3), taskEvents: await taskEvents() };
const next = await commitMonitor(b.session, b.sessionKey, 'monitor-1:4', bodies[3]);
await b.session.close();
say('crash-after-unknown-outcome', {
  writerAError: child.err, afterCrash, takeoverSeconds, bTries: tries,
  rebuiltRevision: rebuilt.revision, replayed: replay.receipt.replayed, replayRevision: replay.revision,
  replaySameResource: replay.recordRef.resourceId === rebuilt.recordRef.resourceId,
  conflictOnOtherContent: conflict, afterReplay, nextRevision: next.revision, javaAfterNext: javaRows(sessionId)[0].slice(0, 3),
});
