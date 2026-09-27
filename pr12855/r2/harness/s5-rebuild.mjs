// S5: rebuild cost (design open question 1). One Monitor commits N
// observation revisions over HTTP; then a cold reopen by another writer is
// timed, counting the requests it makes. A control Session with the same
// number of plain transactions (no Stage H body) separates the new cost.
import { randomUUID } from 'node:crypto';
import {
  FIXTURES, RefMapper, commitMonitor, createPublicSession, openLog, openSession, say,
} from './lib.mjs';

openLog(`s5-rebuild-${process.env.N ?? 1000}`);
const N = Number(process.env.N ?? 1000);

function countingFetch() {
  const stats = { byKind: {}, ms: {} };
  const fn = async (url, init) => {
    const u = new URL(url);
    const kind = u.pathname.includes('/resources/') ? 'GET resource' : `${init?.method ?? 'GET'} ${u.pathname.split('/').pop()}`;
    const t0 = performance.now();
    const r = await fetch(url, init);
    stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
    stats.ms[kind] = (stats.ms[kind] ?? 0) + (performance.now() - t0);
    return r;
  };
  return { fn, stats };
}

async function stageH() {
  const pub = await createPublicSession({ actor: 'alice' });
  const sessionId = pub.id;
  const { session, sessionKey } = await openSession({ sessionId, writerId: 'rb-a', create: true });
  const refs = new RefMapper(session.resources);
  const chain = FIXTURES.monitorChainCases[0].revisions.map((r) => ({ ...r.monitorRun, maxEvents: 10000 }));
  const bodies = await Promise.all(chain.slice(0, 3).map((b) => refs.remap(b)));
  for (let i = 0; i < 3; i++) await commitMonitor(session, sessionKey, `m:${i + 1}`, bodies[i]);
  let body = bodies[2];
  const lat = [];
  const t0 = performance.now();
  for (let i = 1; i <= N; i++) {
    const obs = await session.resources.publish('managed-monitor-observation', Buffer.from(JSON.stringify({ i, line: `build.log line ${i}` })));
    body = { ...body, observationSequence: i, lastObservationRef: obs };
    const s = performance.now();
    await commitMonitor(session, sessionKey, `m:obs:${i}`, body);
    lat.push(performance.now() - s);
  }
  const commitSecs = (performance.now() - t0) / 1000;
  const q = (p) => lat.slice().sort((a, b) => a - b)[Math.floor(p * (lat.length - 1))].toFixed(1);
  const firstK = lat.slice(0, 100).reduce((a, b) => a + b, 0) / 100;
  const lastK = lat.slice(-100).reduce((a, b) => a + b, 0) / 100;
  await session.close();
  const { fn, stats } = countingFetch();
  const o0 = performance.now();
  const b = await openSession({ sessionId, writerId: 'rb-b', fetchFn: fn });
  const openMs = performance.now() - o0;
  const rec = b.session.authority.extensionRecord('monitor_run', 'monitor-1');
  const heap = process.memoryUsage().heapUsed;
  await b.session.close();
  return { sessionId, commitSecs, p50: q(0.5), p95: q(0.95), meanFirst100: firstK.toFixed(1), meanLast100: lastK.toFixed(1), openMs: Math.round(openMs), stats, revision: rec.revision, heapMB: Math.round(heap / 1e6) };
}

async function control() {
  // Same number of transactions, none of them a Stage H record.
  const sessionId = randomUUID();
  const { session, sessionKey } = await openSession({ sessionId, writerId: 'ctl-a', create: true });
  for (let i = 1; i <= N + 3; i++) {
    await session.authority.commitDomainRecord(
      { operation: 'setMetadata', commandId: `meta:${i}`, sessionKey, contentDigest: String(i).padStart(64, '0') },
      { domain: 'session_metadata', content: { title: `t${i}` } },
      { class: 'trusted_entry' },
    );
  }
  await session.close();
  const { fn, stats } = countingFetch();
  const o0 = performance.now();
  const b = await openSession({ sessionId, writerId: 'ctl-b', fetchFn: fn });
  const openMs = performance.now() - o0;
  await b.session.close();
  return { openMs: Math.round(openMs), stats };
}

const h = await stageH();
say('stage-h', h);
let c;
try {
  c = await control();
} catch (e) {
  c = { error: String(e.message).slice(0, 200) };
}
say('control', c);
