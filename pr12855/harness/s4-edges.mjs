// S4: pagination with createdAt ties, a lost commit response followed by a
// retry from a new writer, live SSE delivery of task.updated, the other read
// surfaces, and a deleted public Session.
import http from 'node:http';
import {
  FIXTURES, PORT, RefMapper, allEvents, api, commitMonitor, command,
  createPublicSession, javaRows, journalCounts, openLog, openSession, say, sleep,
} from './lib.mjs';

openLog('s4-edges');
const chainA = FIXTURES.monitorChainCases[0].revisions.map((r) => r.monitorRun);

// ---------- 1. pagination with ties ----------
if (!process.env.SKIP_PAGINATION) {
  const pub = await createPublicSession({ actor: 'alice' });
  const sessionId = pub.id;
  const { session, sessionKey } = await openSession({ sessionId, writerId: 'page-a', create: true });
  const refs = new RefMapper(session.resources);
  const bodies = await Promise.all(chainA.map((b) => refs.remap(b)));
  const realNow = session.authority.now;
  const T0 = Date.now();
  const ids = Array.from({ length: 50 }, (_, i) => `mon-${String(i).padStart(2, '0')}`);
  // shuffle commit order, groups of 7 share one createdAt millisecond
  const order = [...ids].sort(() => Math.random() - 0.5);
  for (let i = 0; i < order.length; i++) {
    session.authority.now = () => T0 + Math.floor(i / 7);
    await commitMonitor(session, sessionKey, `${order[i]}:1`, { ...bodies[0], monitorId: order[i] });
  }
  session.authority.now = realNow;
  // move a few forward so views differ, createdAt stays
  for (const id of ids.slice(0, 10)) {
    for (let r = 1; r < 3; r++) await commitMonitor(session, sessionKey, `${id}:${r + 1}`, { ...bodies[r], monitorId: id });
  }
  const tsOrder = session.authority.taskViews().map((v) => v.taskId);
  const ties = new Set(session.authority.taskViews().map((v) => v.createdAt)).size;
  const results = {};
  for (const limit of [1, 2, 3, 7, 8, 49, 50, 100]) {
    const got = [], gotWs = [];
    let cursor, pages = 0, wsCursor, wsPages = 0, badFlags = 0;
    do {
      const q = `/v1/agents/sessions/${sessionId}/tasks?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`;
      const r = await api('GET', q, { actor: 'alice' });
      got.push(...r.json.data.map((t) => t.id));
      if (r.json.has_more !== (r.json.next_cursor !== null)) badFlags++;
      cursor = r.json.next_cursor;
      pages++;
    } while (cursor && pages < 100);
    do {
      const r = await api('POST', '/api/agent/web-shell/v1/tasks/query', { actor: 'alice', body: { sessionId, limit, ...(wsCursor ? { cursor: wsCursor } : {}) } });
      gotWs.push(...r.json.data.map((t) => t.taskId));
      wsCursor = r.json.nextCursor;
      wsPages++;
    } while (wsCursor && wsPages < 100);
    results[limit] = {
      pages,
      publicEqual: JSON.stringify(got) === JSON.stringify(tsOrder),
      webShellEqual: JSON.stringify(gotWs) === JSON.stringify(tsOrder),
      badFlags,
    };
  }
  say('pagination', { tasks: tsOrder.length, distinctCreatedAt: ties, results });
  await session.close();
}

// ---------- 2. lost response, retry from a new writer ----------
{
  const pub = await createPublicSession({ actor: 'alice' });
  const sessionId = pub.id;
  // proxy that forwards everything but drops the response of one commit
  let dropNext = false, dropped = 0;
  const proxy = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const up = http.request(
        { host: '127.0.0.1', port: PORT, path: req.url, method: req.method, headers: req.headers },
        (ur) => {
          const out = [];
          ur.on('data', (c) => out.push(c));
          ur.on('end', () => {
            if (dropNext && req.url.endsWith('/transactions:commit')) {
              dropNext = false;
              dropped++;
              say('proxy', `commit reached Java (status ${ur.statusCode}); dropping its response`);
              req.socket.destroy();
              return;
            }
            res.writeHead(ur.statusCode, ur.headers);
            res.end(Buffer.concat(out));
          });
        },
      );
      up.end(body);
    });
  });
  await new Promise((r) => proxy.listen(18955, '127.0.0.1', r));
  const a = await openSession({ sessionId, writerId: 'lost-a', create: true, port: 18955 });
  const refs = new RefMapper(a.session.resources);
  const bodies = await Promise.all(chainA.map((b) => refs.remap(b)));
  await commitMonitor(a.session, a.sessionKey, 'monitor-1:1', bodies[0]);
  await commitMonitor(a.session, a.sessionKey, 'monitor-1:2', bodies[1]);
  const before = { counts: journalCounts(sessionId), row: javaRows(sessionId)[0].slice(0, 3), taskEvents: (await allEvents(sessionId)).filter((e) => e.type === 'task.updated').length };
  dropNext = true;
  let errA;
  try {
    await commitMonitor(a.session, a.sessionKey, 'monitor-1:3', bodies[2]);
  } catch (e) {
    errA = `${e.name}: ${String(e.message).slice(0, 120)}`;
  }
  const afterDrop = { counts: journalCounts(sessionId), row: javaRows(sessionId)[0].slice(0, 3), taskEvents: (await allEvents(sessionId)).filter((e) => e.type === 'task.updated').length };
  let errA2;
  try {
    await commitMonitor(a.session, a.sessionKey, 'monitor-1:4', bodies[3]);
  } catch (e) {
    errA2 = `${e.name}: ${String(e.message).slice(0, 120)}`;
  }
  say('lost-response', { dropped, writerAError: errA, writerANextCommit: errA2, before, afterDrop });
  let closeErr;
  await a.session.close().catch((e) => (closeErr = String(e.message).slice(0, 120)));
  // writer B takes over (retry until A's lease is released or expires)
  let b, openErr, t0 = Date.now();
  for (let i = 0; i < 80 && !b; i++) {
    try {
      b = await openSession({ sessionId, writerId: 'lost-b' });
    } catch (e) {
      openErr = `${e.name}: ${String(e.message).slice(0, 140)}`;
      await sleep(1000);
    }
  }
  say('takeover', { closeErr, openedAfterMs: Date.now() - t0, lastOpenErr: openErr });
  const rec = b.session.authority.extensionRecord('monitor_run', 'monitor-1');
  // B holds none of A's staged bytes: keep the refs Java already holds, and
  // publish the rest again through B's store.
  const { sql: q } = await import('./lib.mjs');
  const held = new Set(q(`SELECT resource_id FROM qwen_managed_session_resource WHERE session_id='${sessionId}'`).map((r) => r[0]));
  const refsB = new RefMapper(b.session.resources);
  for (const [key, promise] of refs.map) {
    const ref = await promise;
    if (held.has(ref.resourceId)) refsB.map.set(key, Promise.resolve(ref));
  }
  const bodiesB = await Promise.all(chainA.map((x) => refsB.remap(x)));
  say('b-bodies', { sameAsA: bodiesB.map((x, i) => JSON.stringify(x) === JSON.stringify(bodies[i])) });
  // same command, same content -> replay; same command, other content -> conflict
  const replay = await commitMonitor(b.session, b.sessionKey, 'monitor-1:3', bodiesB[2]);
  let conflict;
  try {
    await commitMonitor(b.session, b.sessionKey, 'monitor-1:3', bodiesB[3]);
  } catch (e) {
    conflict = `${e.name}: ${String(e.message).slice(0, 120)}`;
  }
  const afterReplay = { counts: journalCounts(sessionId), row: javaRows(sessionId)[0].slice(0, 3), taskEvents: (await allEvents(sessionId)).filter((e) => e.type === 'task.updated').length };
  const next = await commitMonitor(b.session, b.sessionKey, 'monitor-1:4', bodiesB[3]);
  say('retry', {
    rebuiltRevision: rec.revision,
    replayed: replay.receipt.replayed,
    replayRevision: replay.revision,
    replaySameRef: replay.recordRef.resourceId === rec.recordRef.resourceId,
    conflictOnOtherContent: conflict,
    afterReplay,
    nextRevision: next.revision,
    javaAfterNext: javaRows(sessionId)[0].slice(0, 3),
  });

  // ---------- 3. live SSE while committing ----------
  const lastSeq = (await allEvents(sessionId)).at(-1).sequence;
  const ac = new AbortController();
  const sse = await fetch(`http://127.0.0.1:${PORT}/v1/agents/sessions/${sessionId}/events?stream=true&after=${lastSeq}`, {
    headers: { 'X-Qwen-Tenant-Id': 't-rig', 'X-Rig-Actor': 'alice', Accept: 'text/event-stream' },
    signal: ac.signal,
  });
  const received = [];
  const reader = (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of sse.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (data) {
            try {
              const e = JSON.parse(data);
              received.push({ at: Date.now(), type: e.type, seq: e.sequence, state: e.data?.state });
            } catch {}
          }
        }
      }
    } catch {}
  })();
  await sleep(500);
  const commitTimes = [];
  for (let r = 4; r < 8; r++) {
    await commitMonitor(b.session, b.sessionKey, `monitor-1:${r + 1}`, bodiesB[r]);
    commitTimes.push(Date.now());
    await sleep(300);
  }
  await sleep(1500);
  ac.abort();
  await reader;
  say('sse-live', {
    status: sse.status,
    received: received.map((e) => `${e.seq}:${e.type}:${e.state ?? ''}`),
    latencyMs: received.filter((e) => e.type === 'task.updated').map((e, i) => (commitTimes[i] ? e.at - commitTimes[i] : null)),
  });

  // ---------- 4. the other read surfaces with task.updated in the log ----------
  const items = await api('GET', `/v1/agents/sessions/${sessionId}/items`, { actor: 'alice' });
  const transcript = await api('POST', '/api/agent/web-shell/v1/transcript/query', { actor: 'alice', body: { sessionId } });
  const sess = await api('GET', `/v1/agents/sessions/${sessionId}`, { actor: 'alice' });
  say('other-surfaces', {
    items: [items.status, items.json.data?.length],
    transcript: [transcript.status, transcript.json.events?.map((e) => e.type), transcript.json.lastSequence],
    session: [sess.status, sess.json.last_event_id, sess.json.capabilities],
  });

  // ---------- 5. deleted public Session ----------
  const del = await api('DELETE', `/v1/agents/sessions/${sessionId}`, { actor: 'alice', idem: `del-${sessionId}` });
  const tasksAfterDelete = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice' });
  // a second record committed after the public Session is deleted
  let afterDelete;
  try {
    const r = await commitMonitor(b.session, b.sessionKey, 'monitor-9:1', { ...bodiesB[0], monitorId: 'monitor-9' });
    afterDelete = `committed revision ${r.revision}`;
  } catch (e) {
    afterDelete = `${e.name} ${e.status ?? ''} ${e.remoteCode ?? ''}: ${String(e.message).slice(0, 120)}`;
  }
  const evRows = (await import('./lib.mjs')).sql(`SELECT sequence_id, event_type, JSON_VALUE(data_json,'$.state') FROM managed_agent_event WHERE session_id='${sessionId}' ORDER BY sequence_id DESC LIMIT 2`);
  say('deleted-session', { deleteStatus: del.status, tasksAfterDelete: [tasksAfterDelete.status, tasksAfterDelete.json.error?.code], commitAfterDelete: afterDelete, latestEventRows: evRows, rows: javaRows(sessionId).length });
  await b.session.close().catch(() => {});
  proxy.close();
}
