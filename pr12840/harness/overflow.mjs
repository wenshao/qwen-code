// PR 12840 real-stack driver, part 2: a stuck SSE client (real TCP
// backpressure) whose range the in-memory hub (512 events) drops, the replay
// floor rising past it, and a catch-up from 0 racing live writers.
// Events come from Session renames (2 events each) so that >512 events
// arrive within a few seconds; the MySQL general log proves which store reads
// each stream made.
//   node overflow.mjs <baseUrl> <db> <out.json> [dbPort] [tag]
import fs from 'node:fs';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const [base, db, out, dbPort = '33841', tag = 'pr'] = process.argv.slice(2);
const RIG = '/path/to/scratchpad/rig';
const OUTDIR = '/path/to/scratchpad/out';
const U = new URL(base);
const tenant = `rig840o-${tag}-${randomUUID().slice(0, 6)}`;
const results = { tenant, checks: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const record = (name, pass, detail) => {
  results.checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  ' + JSON.stringify(detail)}`);
};
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const sql = (q, d = db) =>
  execFileSync(MYSQL, ['--no-defaults', '-uroot', '-prig12840', '-h127.0.0.1', `-P${dbPort}`, '-N', '-B', ...(d ? [d] : []), '-e', q], { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();

async function api(method, path, { body, headers = {} } = {}) {
  const init = { method, headers: { 'X-Qwen-Tenant-Id': tenant, accept: 'application/json', ...headers } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}
const session = async (id) => (await api('GET', `/v1/agents/sessions/${id}`)).json;
async function until(what, predicate, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(150);
  }
  throw new Error(`timeout: ${what}`);
}
async function settled(id) {
  await until(`settled ${id}`, async () => {
    const s = await session(id);
    return !s.active_turn && s.snapshot_through_sequence === s.last_event_id;
  });
  return session(id);
}
const title = (i) => `rename ${i} `.padEnd(250, 'r');
async function renames(id, count, parallel = 1) {
  let next = 0;
  let failures = 0;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      const r = await api('PATCH', `/v1/agents/sessions/${id}`, { body: { title: title(i) }, headers: { 'Idempotency-Key': randomUUID() } });
      if (r.status !== 200) failures++;
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return failures;
}

// Incremental SSE reader over a raw socket (no fetch buffering).
function stream(path, headers = {}) {
  const socket = net.connect(Number(U.port), U.hostname);
  socket.setNoDelay(true);
  socket.write(
    [`GET ${path} HTTP/1.1`, `Host: ${U.host}`, 'Accept: text/event-stream', `X-Qwen-Tenant-Id: ${tenant}`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), 'Connection: close', '', ''].join('\r\n'),
  );
  const state = { frames: [], closed: false, bytes: 0, status: 0 };
  let buf = '';
  let headerDone = false;
  let chunkBuf = '';
  let body = '';
  const parseFrames = () => {
    let i;
    while ((i = body.indexOf('\n\n')) >= 0) {
      const f = body.slice(0, i);
      body = body.slice(i + 2);
      const frame = { id: undefined, event: undefined, data: [] };
      for (const line of f.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const c = line.indexOf(':');
        const k = c < 0 ? line : line.slice(0, c);
        const v = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '');
        if (k === 'id') frame.id = v;
        if (k === 'event') frame.event = v;
        if (k === 'data') frame.data.push(v);
      }
      if (frame.data.length) {
        frame.json = JSON.parse(frame.data.join('\n'));
        frame.at = Date.now();
        state.frames.push(frame);
      }
    }
  };
  // Minimal chunked decoder.
  const feedChunked = () => {
    for (;;) {
      const nl = chunkBuf.indexOf('\r\n');
      if (nl < 0) return;
      const size = parseInt(chunkBuf.slice(0, nl), 16);
      if (Number.isNaN(size)) return;
      if (size === 0) return;
      if (chunkBuf.length < nl + 2 + size + 2) return;
      body += chunkBuf.slice(nl + 2, nl + 2 + size);
      chunkBuf = chunkBuf.slice(nl + 2 + size + 2);
    }
  };
  socket.on('data', (d) => {
    state.bytes += d.length;
    if (!headerDone) {
      buf += d.toString('latin1');
      const h = buf.indexOf('\r\n\r\n');
      if (h < 0) return;
      state.head = buf.slice(0, h);
      state.status = Number(state.head.split(' ')[1]);
      headerDone = true;
      chunkBuf = Buffer.from(buf.slice(h + 4), 'latin1').toString('utf8');
    } else {
      chunkBuf += d.toString('utf8');
    }
    feedChunked();
    parseFrames();
  });
  socket.on('end', () => (state.closed = 'server'));
  socket.on('error', (e) => (state.closed = `error ${e.code}`));
  return {
    state,
    pause: () => socket.pause(),
    resume: () => socket.resume(),
    close: () => {
      if (!state.closed) state.closed = 'client';
      socket.destroy();
    },
    ids: () => state.frames.filter((f) => f.id !== undefined).map((f) => Number(f.id)),
  };
}

// Python client with SO_RCVBUF=4096: the server's write really blocks.
function stuckClient(path, name) {
  const resumeFile = `${OUTDIR}/${name}.resume`;
  const outFile = `${OUTDIR}/${name}.raw`;
  fs.rmSync(resumeFile, { force: true });
  const child = spawn('/usr/bin/python3', [`${RIG}/stuck_client.py`, U.hostname, U.port, path, tenant, resumeFile, outFile], { env: { ...process.env, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' } });
  let log = '';
  let onHead;
  const ready = new Promise((r) => (onHead = r));
  child.stdout.on('data', (d) => {
    log += d;
    if (log.includes('HEAD')) onHead();
  });
  child.stderr.on('data', (d) => (log += d));
  const done = new Promise((r) => child.on('exit', () => r()));
  return {
    ready,
    resume: () => fs.writeFileSync(resumeFile, ''),
    async result() {
      await done;
      const raw = fs.readFileSync(outFile);
      const text = raw.toString('utf8');
      const h = text.indexOf('\r\n\r\n');
      let body = text.slice(h + 4);
      if (/transfer-encoding: chunked/i.test(text.slice(0, h))) {
        let decoded = '';
        let i = 0;
        for (;;) {
          const nl = body.indexOf('\r\n', i);
          if (nl < 0) break;
          const size = parseInt(body.slice(i, nl), 16);
          if (!size) break;
          // Sizes count bytes; slice on a Buffer to stay exact.
          const start = Buffer.byteLength(body.slice(0, nl + 2));
          const all = Buffer.from(body);
          decoded += all.subarray(start, start + size).toString('utf8');
          body = all.subarray(start + size + 2).toString('utf8');
          i = 0;
        }
        body = decoded;
      }
      const frames = [];
      // Drop a trailing frame the client stopped reading halfway through.
      const complete = body.endsWith('\n\n') ? body : body.slice(0, body.lastIndexOf('\n\n') + 2);
      for (const f of complete.split('\n\n')) {
        const frame = { id: undefined, event: undefined, data: [] };
        for (const line of f.split('\n')) {
          if (!line || line.startsWith(':')) continue;
          const c = line.indexOf(':');
          const k = c < 0 ? line : line.slice(0, c);
          const v = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '');
          if (k === 'id') frame.id = v;
          if (k === 'event') frame.event = v;
          if (k === 'data') frame.data.push(v);
        }
        if (frame.data.length) {
          frame.json = JSON.parse(frame.data.join('\n'));
          frames.push(frame);
        }
      }
      const why = /DONE (\S+)/.exec(log)?.[1];
      return { frames, why, log: log.trim(), bytes: raw.length };
    },
  };
}
const exactlyOnce = (seqs, from, to) => seqs.length === to - from + 1 && seqs.every((s, i) => s === from + i);
const describe = (seqs) => {
  const dups = seqs.length - new Set(seqs).size;
  const sorted = [...new Set(seqs)].sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 1; i < sorted.length; i++) gaps += sorted[i] - sorted[i - 1] - 1;
  const inversions = seqs.filter((s, i) => i > 0 && s < seqs[i - 1]).length;
  return { n: seqs.length, first: seqs[0] ?? null, last: seqs.at(-1) ?? null, dups, gaps, inversions };
};
// Store reads by stream threads: the replay-window query only runs on
// JSON reads and stream catch-up pages (JSON reads are not made meanwhile).
function windowReads(sessionId, sinceIso) {
  return Number(
    sql(`SELECT COUNT(*) FROM mysql.general_log WHERE event_time >= '${sinceIso}' AND argument LIKE '%s.replay_floor_sequence, p.covered_sequence%' AND argument LIKE '%${sessionId}%'`, 'mysql'),
  );
}
function eventReads(sessionId, sinceIso) {
  return sql(
    `SELECT REGEXP_SUBSTR(argument, 'sequence_id > [0-9]+') FROM mysql.general_log WHERE event_time >= '${sinceIso}' AND argument LIKE '%FROM managed_agent_event%' AND argument LIKE '%sequence_id > %' AND argument LIKE '%LIMIT 100' AND argument LIKE '%${sessionId}%' ORDER BY event_time`,
    'mysql',
  )
    .split('\n')
    .filter(Boolean);
}
const nowIso = () => sql('SELECT NOW(6)', '');

sql("SET GLOBAL log_output = 'TABLE'", '');
sql("SET GLOBAL general_log = 'ON'", '');
try {
  // ---- S3: stuck stream, hub overflow, no floor ---------------------------
  const create = await api('POST', '/v1/agents/sessions', { body: { agent_id: 'qwen-code', input: [] }, headers: { 'Idempotency-Key': randomUUID() } });
  const sid = create.json.id;
  let s = await settled(sid);
  const start = s.last_event_id;
  const t0 = nowIso();
  const stuck = stuckClient(`/v1/agents/sessions/${sid}/events?after=${start}`, `s3-${tag}`);
  await stuck.ready;
  const renameStart = Date.now();
  const fails = await renames(sid, Number(process.env.RENAMES ?? 700));
  const renameMs = Date.now() - renameStart;
  s = await settled(sid);
  const end = s.last_event_id;
  stuck.resume();
  const r3 = await stuck.result();
  const ids = r3.frames.filter((f) => f.id !== undefined).map((f) => Number(f.id));
  const reads = eventReads(sid, t0);
  results.s3 = { session: sid, from: start + 1, to: end, renameFailures: fails, renameMs, client: r3.log, delivered: describe(ids), storeReads: reads, closed: r3.why };
  record(`S3 stuck client (SO_RCVBUF 4 KiB): ${end - start} events written while it did not read`, fails === 0, { renameMs, client: r3.log });
  record('S3 the stream reconciled from the store after the hub dropped its range (general log, LIMIT 100 reads)', reads.length >= 2, { eventReads: reads.slice(0, 8), total: reads.length });
  record('S3 every sequence once and in order across the overflow', exactlyOnce(ids, start + 1, end), results.s3.delivered);

  // ---- S3b: the floor rises past the stuck stream --------------------------
  s = await settled(sid);
  const start2 = s.last_event_id;
  const t1 = nowIso();
  const lag = stuckClient(`/v1/agents/sessions/${sid}/events?after=${start2}`, `s3b-${tag}`);
  await lag.ready;
  await renames(sid, Number(process.env.RENAMES ?? 700));
  s = await settled(sid);
  const end2 = s.last_event_id;
  const floor = s.snapshot_through_sequence - 100;
  sql(`UPDATE managed_agent_session SET replay_floor_sequence = ${floor} WHERE tenant_id = '${tenant}' AND session_id = '${sid}'`);
  lag.resume();
  const rb = await lag.result();
  const lagIds = rb.frames.filter((f) => f.id !== undefined).map((f) => Number(f.id));
  const resync = rb.frames.filter((f) => f.event === 'agent.session.resync_required');
  const lastFrame = rb.frames.at(-1);
  results.s3b = { from: start2 + 1, to: end2, floor, delivered: describe(lagIds), resync: resync.map((f) => ({ id: f.id ?? null, data: f.json })), closed: rb.why, client: rb.log, storeReads: eventReads(sid, t1) };
  record('S3b floor raised past the stuck stream: contiguous prefix below the floor, then one resync frame without id, then the server closes', resync.length === 1 && lastFrame?.event === 'agent.session.resync_required' && lastFrame.id === undefined && exactlyOnce(lagIds, start2 + 1, lagIds.at(-1) ?? start2) && (lagIds.at(-1) ?? 0) < floor && rb.why === 'server', { ...results.s3b, storeReads: results.s3b.storeReads.slice(-4) });
  sql(`UPDATE managed_agent_session SET replay_floor_sequence = 0 WHERE tenant_id = '${tenant}' AND session_id = '${sid}'`);

  // ---- S4: catch-up from 0 racing live writers -----------------------------
  s = await settled(sid);
  const t2 = nowIso();
  const writers = renames(sid, 300);
  await sleep(200);
  const race = stream(`/v1/agents/sessions/${sid}/events`, { 'Last-Event-ID': '0' });
  await writers;
  s = await settled(sid);
  const end3 = s.last_event_id;
  await until('race stream caught up', async () => race.ids().at(-1) >= end3, 60000).catch(() => {});
  await sleep(500);
  race.close();
  const raceIds = race.ids();
  const raceReads = eventReads(sid, t2);
  results.s4 = { to: end3, delivered: describe(raceIds), catchUpPages: raceReads.length, firstReads: raceReads.slice(0, 3), lastReads: raceReads.slice(-3) };
  record(`S4 catch-up from 0 over ${end3} events (${raceReads.length} store pages) while 300 renames write: every sequence once, in order`, exactlyOnce(raceIds, 1, end3), results.s4);
} finally {
  sql("SET GLOBAL general_log = 'OFF'", '');
}
const failed = results.checks.filter((c) => !c.pass).length;
results.summary = `${results.checks.length - failed}/${results.checks.length} checks passed`;
console.log(results.summary);
fs.writeFileSync(out, JSON.stringify(results, null, 2));
