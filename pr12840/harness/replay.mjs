// PR 12840 real-stack driver: Spring jar + MySQL + packaged hosted harness +
// scripted model. Every check reads real HTTP responses; the replay floor is
// raised with SQL because nothing in production calls advanceReplayFloor yet.
//   node replay.mjs <baseUrl> <db> <out.json> [jdbcPort]
import fs from 'node:fs';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const SP = '/path/to/scratchpad';
const require = createRequire(`${SP}/wt-pr/package.json`);
const Ajv2020 = require('ajv/dist/2020.js').default;
const addFormats = require('ajv-formats').default;

const [base, db, out, dbPort = '33841'] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(`${SP}/${process.env.SPEC_WT ?? "wt-pr"}/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json`, 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
addFormats(ajv);
ajv.addSchema(spec, 'spec');
const schema = (name) => ajv.getSchema(`spec#/components/schemas/${name}`);
const check = (name, value) => {
  const v = schema(name);
  const ok = v(value);
  return ok ? [] : v.errors.map((e) => `${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`);
};

const tenant = `rig840-${randomUUID().slice(0, 8)}`;
const U = new URL(base);
const results = { tenant, checks: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const record = (name, pass, detail) => {
  results.checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`);
};
const MYSQL = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const sql = (q) => {
  try {
    return execFileSync(MYSQL, ['--no-defaults', '-uroot', '-prig12840', '-h127.0.0.1', `-P${dbPort}`, '-N', '-B', db, '-e', q], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch (e) {
    console.log(`   (SQL failed: ${q.slice(0, 60)}...)`);
    return '';
  }
};

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
  return { status: res.status, json, text };
}
const session = async (id) => (await api('GET', `/v1/agents/sessions/${id}`)).json;
async function until(what, predicate, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(150);
  }
  throw new Error(`timeout: ${what}`);
}
// Idle and fully materialized: the Snapshot covers the last sequence.
async function settled(id) {
  await until(`settled ${id}`, async () => {
    const s = await session(id);
    return !s.active_turn && s.snapshot_through_sequence === s.last_event_id && s.last_event_id > 0;
  });
  return session(id);
}
async function createSession(text) {
  const r = await api('POST', '/v1/agents/sessions', {
    body: { agent_id: 'qwen-code', input: [{ type: 'input_text', text }] },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  if (r.status !== 202) throw new Error(`create ${r.status} ${r.text}`);
  return r.json.id;
}
async function submit(id, text) {
  const r = await api('POST', `/v1/agents/sessions/${id}/events`, {
    body: { type: 'agent.session.input.message', input: [{ type: 'text', text }] },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  if (r.status !== 202) throw new Error(`submit ${r.status} ${r.text}`);
  return r.json;
}
async function allEvents(id) {
  const r = await api('GET', `/v1/agents/sessions/${id}/events?limit=1000`);
  return r.json.data;
}
async function allItems(id) {
  const items = [];
  let cursor = '';
  for (;;) {
    const r = await api('GET', `/v1/agents/sessions/${id}/items?limit=100${cursor ? `&after=${cursor}` : ''}`);
    items.push(...r.json.data);
    if (!r.json.has_more) return { items, covered: r.json.snapshot_through_sequence ?? r.json.covered_sequence };
    cursor = r.json.next_cursor;
  }
}

// Raw SSE reader over a plain socket. SO_RCVBUF cannot be set from Node, so
// backpressure is made by not reading: pauseMs after the first frame.
function sse({ method = 'GET', path, headers = {}, body, pauseAfterFirstMs = 0, idleCloseMs = 4000, maxMs = 60000 }) {
  return new Promise((resolve) => {
    const socket = net.connect(Number(U.port), U.hostname);
    const payload = body === undefined ? '' : JSON.stringify(body);
    const lines = [
      `${method} ${path} HTTP/1.1`,
      `Host: ${U.host}`,
      'Accept: text/event-stream',
      `X-Qwen-Tenant-Id: ${tenant}`,
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      ...(body === undefined ? [] : ['Content-Type: application/json', `Content-Length: ${Buffer.byteLength(payload)}`]),
      'Connection: close',
      '',
      payload,
    ];
    socket.write(lines.join('\r\n'));
    let raw = '';
    let paused = false;
    let idle;
    const started = Date.now();
    const finish = (why) => {
      clearTimeout(idle);
      clearTimeout(hard);
      socket.destroy();
      const headerEnd = raw.indexOf('\r\n\r\n');
      const head = raw.slice(0, headerEnd);
      let bodyText = raw.slice(headerEnd + 4);
      if (/transfer-encoding: chunked/i.test(head)) bodyText = dechunk(bodyText);
      const frames = bodyText
        .split(/\n\n/)
        .filter((f) => f.trim())
        .map((f) => {
          const frame = { id: undefined, event: undefined, data: [] };
          for (const line of f.split('\n')) {
            if (line.startsWith(':')) continue;
            const i = line.indexOf(':');
            const k = i < 0 ? line : line.slice(0, i);
            const v = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
            if (k === 'id') frame.id = v;
            if (k === 'event') frame.event = v;
            if (k === 'data') frame.data.push(v);
          }
          frame.json = frame.data.length ? JSON.parse(frame.data.join('\n')) : undefined;
          return frame;
        })
        .filter((f) => f.json !== undefined);
      resolve({ status: Number(head.split(' ')[1]), head, frames, why, ms: Date.now() - started });
    };
    const hard = setTimeout(() => finish('max'), maxMs);
    socket.on('data', (d) => {
      raw += d.toString('utf8');
      clearTimeout(idle);
      idle = setTimeout(() => finish('idle'), idleCloseMs);
      if (pauseAfterFirstMs && !paused && raw.includes('\n\n', raw.indexOf('\r\n\r\n') + 4)) {
        paused = true;
        socket.pause();
        clearTimeout(idle);
        results.pausedAt = Date.now();
        setTimeout(() => {
          socket.resume();
          idle = setTimeout(() => finish('idle'), idleCloseMs);
        }, pauseAfterFirstMs);
      }
    });
    socket.on('end', () => finish('server-closed'));
    socket.on('error', () => finish('error'));
  });
}
function dechunk(s) {
  let outText = '';
  let i = 0;
  for (;;) {
    const nl = s.indexOf('\r\n', i);
    if (nl < 0) break;
    const size = parseInt(s.slice(i, nl), 16);
    if (!size) break;
    outText += s.slice(nl + 2, nl + 2 + size);
    i = nl + 2 + size + 2;
  }
  return outText;
}
const exactlyOnce = (seqs, from, to) => {
  const expected = [];
  for (let s = from; s <= to; s++) expected.push(s);
  return JSON.stringify(seqs) === JSON.stringify(expected);
};
const describeSeqs = (seqs) => {
  const dups = seqs.filter((s, i) => seqs.indexOf(s) !== i).length;
  const sorted = [...new Set(seqs)].sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 1; i < sorted.length; i++) gaps += sorted[i] - sorted[i - 1] - 1;
  const inversions = seqs.filter((s, i) => i > 0 && s < seqs[i - 1]).length;
  return { n: seqs.length, first: seqs[0], last: seqs.at(-1), dups, gaps, inversions };
};

// ---------------------------------------------------------------------------
console.log(`tenant ${tenant}`);
// S1: three Turns, one interleaving reasoning and text.
const s1 = await createSession('first turn');
await settled(s1);
await submit(s1, 'second turn INTERLEAVE');
await settled(s1);
await submit(s1, 'third turn');
const s1state = await settled(s1);
const last1 = s1state.last_event_id;
results.s1 = { id: s1, last: last1 };
console.log(`S1 session ${s1} last_event_id=${last1} capabilities=${JSON.stringify(s1state.capabilities)}`);
record('S1 Session advertises snapshots and resync', s1state.capabilities?.snapshots === true && s1state.capabilities?.resync === true, s1state.capabilities);
record('S1 Session validates against PublicSession', check('PublicSession', s1state).length === 0, check('PublicSession', s1state));

// Paging with limit=7 following next_cursor.
const pages = [];
let after = 0;
for (let guard = 0; guard < 100; guard++) {
  const r = await api('GET', `/v1/agents/sessions/${s1}/events?limit=7&after=${after}`);
  pages.push({ status: r.status, n: r.json.data.length, first: r.json.data[0]?.sequence, last: r.json.data.at(-1)?.sequence, has_more: r.json.has_more, next_cursor: r.json.next_cursor, data: r.json.data });
  if (!r.json.has_more) break;
  after = r.json.next_cursor;
}
const pagedSeqs = pages.flatMap((p) => p.data.map((e) => e.sequence));
results.paging = pages.map(({ data, ...p }) => p);
record('S1 paging limit=7 via next_cursor: every sequence once, in order', exactlyOnce(pagedSeqs, 1, last1), describeSeqs(pagedSeqs));
record('S1 non-final pages: has_more true, next_cursor = last sequence', pages.slice(0, -1).every((p) => p.has_more === true && p.next_cursor === String(p.last)), pages.slice(0, -1).length + ' pages');
record('S1 final page: has_more false, next_cursor null', pages.at(-1).has_more === false && pages.at(-1).next_cursor === null, { n: pages.at(-1).n, has_more: pages.at(-1).has_more, next_cursor: pages.at(-1).next_cursor });
const exact = await api('GET', `/v1/agents/sessions/${s1}/events?limit=${last1}`);
record(`S1 limit=last_event_id (${last1}) returns has_more false`, exact.json.has_more === false && exact.json.next_cursor === null && exact.json.data.length === last1);
const pageErrs = pages.flatMap((p) => check('PublicEventList', { object: 'list', data: p.data, has_more: p.has_more, next_cursor: p.next_cursor }));
for (const [label, q, want] of [
  ['limit=1000', 'limit=1000', 200],
  ['limit=1001', 'limit=1001', 400],
  ['limit=0', 'limit=0', 400],
  ['after=-1', 'after=-1', 400],
]) {
  const r = await api('GET', `/v1/agents/sessions/${s1}/events?${q}`);
  record(`S1 ${label} -> ${want}`, r.status === want, `${r.status} ${r.json?.error?.code ?? ''}`);
}
const t1000 = await api('POST', '/api/agent/web-shell/v1/transcript/query', { body: { sessionId: s1, limit: 1000 } });
const t1001 = await api('POST', '/api/agent/web-shell/v1/transcript/query', { body: { sessionId: s1, limit: 1001 } });
record('S1 WebShell transcript limit=1000 -> 200, 1001 -> 400', t1000.status === 200 && t1001.status === 400, `${t1000.status} / ${t1001.status} ${t1001.json?.error?.code ?? ''}`);

// Identity parity against the Items snapshot.
const events1 = await allEvents(s1);
const { items } = await allItems(s1);
const itemById = new Map(items.map((i) => [i.id ?? i.item_id, i]));
const partById = new Map();
for (const item of items) for (const p of item.content ?? item.parts ?? []) partById.set(`${item.id ?? item.item_id}/${p.part_id}`, p);
const evErrs = events1.flatMap((e) => check('PublicEvent', e).map((m) => `#${e.sequence} ${m}`));
record('S1 every event validates against PublicEvent', evErrs.length === 0 && pageErrs.length === 0, evErrs.slice(0, 3).concat(pageErrs.slice(0, 3)));
record('S1 every event has schema_version 1 and projection_version 1', events1.every((e) => e.schema_version === 1 && e.projection_version === 1));
const named = events1.filter((e) => e.item_id);
const missingItem = named.filter((e) => !itemById.has(e.item_id));
const withPart = events1.filter((e) => e.content_part_id);
const missingPart = withPart.filter((e) => !partById.has(`${e.item_id}/${e.content_part_id}`));
record('S1 every event item_id names an Item of the snapshot', missingItem.length === 0, `${named.length} events name an Item; missing ${missingItem.length}`);
record('S1 every content_part_id names a Part of that Item', missingPart.length === 0, `${withPart.length} events name a Part; missing ${missingPart.length}`);
// Stronger than the PR's parity test: the deltas of each Part rebuild its text.
const rebuilt = new Map();
for (const e of withPart) rebuilt.set(`${e.item_id}/${e.content_part_id}`, (rebuilt.get(`${e.item_id}/${e.content_part_id}`) ?? '') + e.data.text);
const textParts = [...partById.entries()].filter(([, p]) => p.type === 'output_text' || p.type === 'reasoning');
const mismatch = textParts.filter(([k, p]) => rebuilt.get(k) !== p.text);
record('S1 deltas grouped by content_part_id rebuild every text Part exactly', mismatch.length === 0, `${textParts.length} text Parts; mismatched ${mismatch.length}`);
const legacy = withPart.filter((e) => e.data?.contentPartId && e.data.contentPartId !== e.content_part_id);
results.identitySample = events1.filter((e) => e.turn_id === events1.find((x) => x.data?.text?.includes?.('part one'))?.turn_id).map((e) => ({ seq: e.sequence, type: e.type, item_id: e.item_id ?? null, content_part_id: e.content_part_id ?? null, legacy: e.data?.contentPartId ?? null, text: e.data?.text ?? null }));
results.parts = textParts.map(([k, p]) => ({ key: k, type: p.type, first: p.first_sequence, last: p.last_sequence, text: p.text }));
console.log(`   data.contentPartId differs from content_part_id on ${legacy.length}/${withPart.length} delta events (documented, left as is)`);

// S2: replay floor.
const covered = s1state.snapshot_through_sequence;
const F = covered - 5;
sql(`UPDATE managed_agent_session SET replay_floor_sequence = ${F} WHERE tenant_id = '${tenant}' AND session_id = '${s1}'`);
const s1f = await session(s1);
record(`S2 Session reports replay_floor_sequence=${F}`, s1f.replay_floor_sequence === F && s1f.snapshot_through_sequence === covered, { replay_floor_sequence: s1f.replay_floor_sequence, snapshot_through_sequence: s1f.snapshot_through_sequence });
const below = await api('GET', `/v1/agents/sessions/${s1}/events?after=${F - 1}`);
results.expired = below.json;
record('S2 JSON after=floor-1 -> 409 cursor_expired with both watermarks', below.status === 409 && below.json?.error?.code === 'cursor_expired' && below.json.error.replay_floor_sequence === F && below.json.error.snapshot_through_sequence === covered && !!below.json.error.request_id, below.json?.error);
record('S2 409 envelope validates against ErrorEnvelope', check('ErrorEnvelope', below.json).length === 0, check('ErrorEnvelope', below.json));
const at = await api('GET', `/v1/agents/sessions/${s1}/events?after=${F}`);
record('S2 JSON after=floor -> 200', at.status === 200 && at.json.data[0]?.sequence === F + 1, `${at.status} first=${at.json?.data?.[0]?.sequence}`);
const lei = await api('GET', `/v1/agents/sessions/${s1}/events?after=${F}`, { headers: { 'Last-Event-ID': String(F - 1) } });
record('S2 Last-Event-ID below the floor wins over after=floor -> 409', lei.status === 409, lei.status);
const lei2 = await api('GET', `/v1/agents/sessions/${s1}/events?after=0`, { headers: { 'Last-Event-ID': String(F) } });
record('S2 Last-Event-ID=floor wins over after=0 -> 200', lei2.status === 200 && lei2.json.data[0]?.sequence === F + 1, lei2.status);

const pubExpired = await sse({ path: `/v1/agents/sessions/${s1}/events?after=${F - 1}` });
const f0 = pubExpired.frames[0];
results.publicResync = { status: pubExpired.status, why: pubExpired.why, ms: pubExpired.ms, frames: pubExpired.frames.map((f) => ({ id: f.id ?? null, event: f.event, data: f.json })) };
record('S2 public SSE below floor: exactly one resync frame, no id, stream closed by server', pubExpired.status === 200 && pubExpired.frames.length === 1 && f0.event === 'agent.session.resync_required' && f0.id === undefined && pubExpired.why === 'server-closed', { frames: pubExpired.frames.length, event: f0?.event, id: f0?.id ?? null, closedBy: pubExpired.why, ms: pubExpired.ms });
record('S2 public resync frame validates against SessionResyncRequired', check('SessionResyncRequired', f0.json).length === 0 && f0.json.replay_floor_sequence === F && f0.json.snapshot_through_sequence === covered, f0.json);
const pubLei = await sse({ path: `/v1/agents/sessions/${s1}/events?after=${last1}`, headers: { 'Last-Event-ID': String(F - 1) } });
record('S2 public SSE: Last-Event-ID below floor wins over after -> resync', pubLei.frames.length === 1 && pubLei.frames[0].event === 'agent.session.resync_required', pubLei.frames.map((f) => f.event));
const pubAt = await sse({ path: `/v1/agents/sessions/${s1}/events?after=${F}`, idleCloseMs: 2500 });
record('S2 public SSE at floor: events floor+1..last, stream stays open', exactlyOnce(pubAt.frames.map((f) => Number(f.id)), F + 1, last1) && pubAt.why === 'idle', { ...describeSeqs(pubAt.frames.map((f) => Number(f.id))), closedBy: pubAt.why });
const wsExpired = await sse({ method: 'POST', path: '/api/agent/web-shell/v1/events/stream', body: { sessionId: s1, afterSequence: F - 1 } });
const w0 = wsExpired.frames[0];
results.webShellResync = { status: wsExpired.status, why: wsExpired.why, frames: wsExpired.frames.map((f) => ({ id: f.id ?? null, event: f.event, data: f.json })) };
record('S2 WebShell SSE below floor: one resync frame, no id, closed', wsExpired.status === 200 && wsExpired.frames.length === 1 && w0.event === 'agent.session.resync_required' && w0.id === undefined && wsExpired.why === 'server-closed', { frames: wsExpired.frames.length, id: w0?.id ?? null, closedBy: wsExpired.why });
record('S2 WebShell resync frame validates against WebShellResyncRequired', check('WebShellResyncRequired', w0.json).length === 0, w0.json);
const tr = await api('POST', '/api/agent/web-shell/v1/transcript/query', { body: { sessionId: s1, limit: 100 } });
record('S2 transcript reload resumes at or above the floor', tr.status === 200 && tr.json.lastSequence >= F, { lastSequence: tr.json.lastSequence, coveredSequence: tr.json.coveredSequence });
const wsResume = await sse({ method: 'POST', path: '/api/agent/web-shell/v1/events/stream', body: { sessionId: s1, afterSequence: tr.json.lastSequence }, idleCloseMs: 2500 });
record('S2 WebShell stream after transcript.lastSequence: no resync, stays open', !wsResume.frames.some((f) => f.event === 'agent.session.resync_required') && wsResume.why === 'idle', { frames: wsResume.frames.length, closedBy: wsResume.why });
sql(`UPDATE managed_agent_session SET replay_floor_sequence = 0 WHERE tenant_id = '${tenant}' AND session_id = '${s1}'`);

// S3/S4 (hub overflow, floor past a stuck stream, catch-up race) live in overflow.mjs.

const failed = results.checks.filter((c) => !c.pass).length;
results.summary = `${results.checks.length - failed}/${results.checks.length} checks passed`;
console.log(results.summary);
fs.writeFileSync(out, JSON.stringify(results, null, 2));
