// S4: pagination with createdAt ties, a lost commit response followed by a
// retry from a new writer, live SSE delivery of task.updated, the other read
// surfaces, and a deleted public Session.
import http from 'node:http';
import {
  FIXTURES, PORT, RefMapper, allEvents, api, commitMonitor, command,
  createPublicSession, javaRows, journalCounts, openLog, openSession, say, sleep,
} from './lib.mjs';


const chainA = FIXTURES.monitorChainCases[0].revisions.map((r) => r.monitorRun);

openLog("s4d-surfaces");
{
  const pub = await createPublicSession({ actor: "alice" });
  const sessionId = pub.id;
  const b = await openSession({ sessionId, writerId: "surf-b", create: true });
  const refs = new RefMapper(b.session.resources);
  const bodiesB = await Promise.all(chainA.map((x) => refs.remap(x)));
  for (let r = 0; r < 4; r++) await commitMonitor(b.session, b.sessionKey, `monitor-1:${r + 1}`, bodiesB[r]);
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
}
