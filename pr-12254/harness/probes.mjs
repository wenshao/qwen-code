// PR #12254 — extended real-daemon probes (head arm only).
// Usage: node probes.mjs <out-dir> [probe,probe,...]
import * as path from 'node:path';
import * as net from 'node:net';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Report, startDaemon, http, writeSession, freshDir, sid, workspaceIdOf, descendants, eq, sleep, TOKEN, ARMS } from './lib.mjs';

const OUT = process.argv[2] ?? '/root/verify/pr12254-harness/out';
const only = process.argv[3]?.split(',');
mkdirSync(OUT, { recursive: true });
const R = new Report('PR #12254 extended probes — head 021f3228, real daemon');
const evidence = {};
const want = (n) => !only || only.includes(n);
const ids = (m) => (m.sessions ?? []).map((s) => s.sessionId);

function mk(name, wsNames) {
  const ROOT = freshDir(`/root/verify/pr12254-harness/run-${name}`);
  const HOME = path.join(ROOT, 'home');
  mkdirSync(path.join(HOME, '.qwen'), { recursive: true });
  const WS = Object.fromEntries(wsNames.map((n) => [n, path.join(ROOT, `ws-${n}`)]));
  for (const w of Object.values(WS)) mkdirSync(w, { recursive: true });
  return { ROOT, HOME, WS };
}

// ---------------------------------------------------------------------------
if (want('live')) {
  R.section('L. Live-only sessions page through the merged catalog (trusted runtimes)');
  const { HOME, WS } = mk('live', ['A', 'B']);
  for (let i = 1; i <= 3; i++) writeSession(HOME, WS.A, sid('A', i), { minute: i, title: `A-persisted-${i}` });
  for (let i = 1; i <= 2; i++) writeSession(HOME, WS.B, sid('B', i), { minute: i, title: `B-persisted-${i}` });
  const d = await startDaemon('head', HOME, Object.values(WS), { args: ['--initialize-timeout-ms', '60000'] });
  try {
    const live = [];
    for (let i = 0; i < 3; i++) {
      const id = randomUUID();
      const r = await http(d, 'POST', '/session', { cwd: WS.A, sessionId: id });
      if (r.status === 200 || r.status === 201) live.push(id);
      else R.info(`POST /session → ${r.status} ${r.text.slice(0, 200)}`);
    }
    R.check('L0', 'created 3 live, never-prompted sessions on the primary via POST /session', live.length === 3);
    const onDisk = readdirSync(path.join(HOME, '.qwen', 'projects')).flatMap((p) => {
      const c = path.join(HOME, '.qwen', 'projects', p, 'chats');
      return existsSync(c) ? readdirSync(c) : [];
    });
    R.check('L1', 'those sessions are live-only (no transcript on disk)', live.every((id) => !onDisk.includes(`${id}.jsonl`)), `${onDisk.length} transcripts on disk`);

    const wsid = workspaceIdOf(WS.A);
    const drainBatch = async (options) => {
      const seen = [];
      let cursor;
      let n = 0;
      do {
        const r = await http(d, 'POST', '/sessions/catalog', { workspaces: [{ workspace: WS.A, ...(cursor ? { cursor } : {}) }], options });
        const m = r.json.workspaces[0];
        if (m.error) throw new Error(JSON.stringify(m.error));
        seen.push(...ids(m));
        cursor = m.nextCursor;
      } while (cursor && ++n < 30);
      return seen;
    };
    const drainGet = async (q) => {
      const seen = [];
      let cursor;
      let n = 0;
      do {
        const r = await http(d, 'GET', `/workspaces/${wsid}/sessions?${q}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        seen.push(...r.json.sessions.map((s) => s.sessionId));
        cursor = r.json.nextCursor;
      } while (cursor && ++n < 30);
      return seen;
    };
    const all = new Set([...live, sid('A', 1), sid('A', 2), sid('A', 3)]);
    const b1 = await drainBatch({ size: 1 });
    R.check('L2', 'batch default, size=1: all 6 rows (3 live-only + 3 persisted) exactly once', b1.length === 6 && new Set(b1).size === 6 && b1.every((x) => all.has(x)), `${b1.length} rows, ${new Set(b1).size} unique`);
    const b2 = await drainBatch({ size: 2, view: 'organized', group: 'all' });
    R.check('L3', 'batch organized, size=2: all 6 rows exactly once', b2.length === 6 && new Set(b2).size === 6, `${b2.length} rows, ${new Set(b2).size} unique`);
    const pageSizes = [];
    {
      let cursor;
      do {
        const r = await http(d, 'POST', '/sessions/catalog', { workspaces: [{ workspace: WS.A, ...(cursor ? { cursor } : {}) }], options: { size: 2 } });
        pageSizes.push(r.json.workspaces[0].sessions.length);
        cursor = r.json.workspaces[0].nextCursor;
      } while (cursor);
    }
    R.check('L4', 'live-only rows respect the page size in the batch (no page exceeds size=2)', pageSizes.every((n) => n <= 2), `pages=${pageSizes.join('/')}`);
    const g1 = await drainGet('size=2&view=organized&group=all');
    const legacyFirst = (await http(d, 'GET', `/workspaces/${wsid}/sessions?size=2&view=organized&group=all`)).json.sessions.length;
    evidence.live = { batchDefault: b1.length, batchOrganized: b2.length, legacyOrganizedDrain: g1.length, legacyFirstPageRows: legacyFirst, pageSizes };
    R.info(`legacy GET organized size=2: first page carries ${legacyFirst} rows, drain returns ${g1.length}/${all.size} (unchanged legacy behaviour — the batch opts into merged paging)`);

    // A live session on the secondary: B warms (expected — a session was created), its live row merges.
    const st0 = (await http(d, 'GET', `/workspaces/${workspaceIdOf(WS.B)}/runtime/status`)).json;
    const bl = await http(d, 'POST', '/session', { cwd: WS.B, sessionId: randomUUID() });
    const r = await http(d, 'POST', '/sessions/catalog', { workspaces: [{ workspace: WS.B }] });
    R.check('L5', 'secondary with its own live session: batch merges that live row (3 = 2 persisted + 1 live)', bl.status < 300 && r.json.workspaces[0].sessions.length === 3, `POST /session=${bl.status}, rows=${r.json.workspaces[0].sessions?.length}, B before=${st0.state}`);
  } finally {
    await d.stop();
  }
}

// ---------------------------------------------------------------------------
if (want('many')) {
  R.section('M. Selection bounds with really-registered workspaces (21 > cap 20)');
  const names = Array.from({ length: 21 }, (_, i) => `w${String(i + 1).padStart(2, '0')}`);
  const { HOME, WS } = mk('many', names);
  for (const [i, w] of Object.values(WS).entries()) writeSession(HOME, w, sid('A', i + 1), { minute: i + 1, title: `s-${i + 1}` });
  const d = await startDaemon('head', HOME, Object.values(WS));
  try {
    await sleep(2500);
    const before = descendants(d.child.pid).length;
    const all = await http(d, 'POST', '/sessions/catalog', { workspaces: 'all' });
    evidence.many = { all: { status: all.status, body: all.json } };
    R.check('M1', '"all" with 21 registered workspaces → explicit HTTP 400 too_many_workspaces (never silently truncated)', all.status === 400 && all.json.code === 'too_many_workspaces', `HTTP ${all.status} ${all.json?.code}`);
    const first20 = await http(d, 'POST', '/sessions/catalog', { workspaces: Object.values(WS).slice(0, 20).map((w) => ({ workspace: w })) });
    const last1 = await http(d, 'POST', '/sessions/catalog', { workspaces: [{ workspace: Object.values(WS)[20] }] });
    const rows = [...first20.json.workspaces, ...last1.json.workspaces];
    R.check('M2', 'caller-side split 20 + 1 covers all 21, each member owning exactly its one session', first20.status === 200 && rows.length === 21 && rows.every((m, i) => eq(ids(m), [sid('A', i + 1)])), `${first20.ms.toFixed(0)}ms for 20 members`);
    const dup = await http(d, 'POST', '/sessions/catalog', { workspaces: [{ workspace: WS.w01 }, { workspace: workspaceIdOf(WS.w01) }, { workspace: WS.w01 + '/' }] });
    R.check('M3', 'the same workspace selected 3× (cwd, id, alias) → 3 independent identical members (not deduplicated)', dup.json.workspaces.length === 3 && dup.json.workspaces.every((m) => eq(ids(m), [sid('A', 1)])));
    const after = descendants(d.child.pid).length;
    const st = await Promise.all(Object.values(WS).slice(1).map(async (w) => (await http(d, 'GET', `/workspaces/${workspaceIdOf(w)}/runtime/status`)).json));
    R.check('M4', 'all 20 secondaries still cold after the batch reads; process tree unchanged', st.every((s) => s.state === 'cold' && s.runtimeLive === false && s.runtimeEpoch === 0) && before === after, `children ${before}→${after}`);
  } finally {
    await d.stop();
  }
}

// ---------------------------------------------------------------------------
if (want('trust')) {
  R.section('T. Trust boundary with folder trust really enabled');
  const { HOME, WS } = mk('trust', ['A', 'B', 'C']);
  for (const k of ['A', 'B', 'C']) for (let i = 1; i <= 2; i++) writeSession(HOME, WS[k], sid(k, i), { minute: i, title: `${k}-${i}` });
  writeFileSync(path.join(HOME, '.qwen', 'settings.json'), JSON.stringify({ security: { folderTrust: { enabled: true } } }));
  // T1: trusted primary, untrusted secondary B, trusted secondary C
  writeFileSync(path.join(HOME, '.qwen', 'trustedFolders.json'), JSON.stringify({ [WS.A]: 'TRUST_FOLDER', [WS.B]: 'DO_NOT_TRUST', [WS.C]: 'TRUST_FOLDER' }));
  let d = await startDaemon('head', HOME, Object.values(WS));
  try {
    const debugDir = path.join(HOME, '.qwen', 'debug');
    const snap = () => (existsSync(debugDir) ? readdirSync(debugDir, { recursive: true }).map(String).sort() : []);
    const before = snap();
    const r = await http(d, 'POST', '/sessions/catalog', { workspaces: 'all', includeGroups: true });
    const [a, b, c] = r.json.workspaces;
    const gb = await http(d, 'GET', `/workspaces/${workspaceIdOf(WS.B)}/sessions`);
    evidence.trust = { untrustedSecondary: b, legacyUntrustedSecondary: { status: gb.status, n: gb.json?.sessions?.length } };
    R.check('T1', 'untrusted SECONDARY: persisted rows are still readable, identical to the existing GET for that workspace', r.status === 200 && !b.error && eq(b.sessions, gb.json.sessions), `batch=${ids(b).length} rows, GET=${gb.status}/${gb.json?.sessions?.length}`);
    R.check('T2', 'trusted members unaffected', ids(a).length === 2 && ids(c).length === 2);
    const mut = await http(d, 'POST', `/workspaces/${workspaceIdOf(WS.B)}/session-groups`, { name: 'x', color: 'blue' });
    R.check('T3', '(control) the untrusted secondary really is untrusted: a mutation on it is refused', mut.status === 403, `HTTP ${mut.status} ${mut.json?.code}`);
    const after = snap();
    const added = after.filter((f) => !before.includes(f));
    R.check('T4', 'reading the untrusted member creates no new debug-log session file', added.length === 0, added.join(',') || 'no new files');
  } finally {
    await d.stop();
  }
  // T5: untrusted PRIMARY
  writeFileSync(path.join(HOME, '.qwen', 'trustedFolders.json'), JSON.stringify({ [WS.A]: 'DO_NOT_TRUST', [WS.B]: 'TRUST_FOLDER', [WS.C]: 'TRUST_FOLDER' }));
  d = await startDaemon('head', HOME, Object.values(WS));
  try {
    const r = await http(d, 'POST', '/sessions/catalog', { workspaces: 'all' });
    const [a, b] = r.json.workspaces;
    const ga = await http(d, 'GET', `/workspaces/${workspaceIdOf(WS.A)}/sessions`);
    evidence.trust.untrustedPrimary = { member: a, legacy: { status: ga.status, code: ga.json?.code } };
    R.check('T5', 'untrusted PRIMARY → 403 untrusted_workspace member (same decision as the existing GET), siblings still paged', r.status === 200 && a.error?.code === 'untrusted_workspace' && a.error.status === 403 && ga.status === 403 && ids(b).length === 2, `batch=${a.error?.code}/${a.error?.status} GET=${ga.status}/${ga.json?.code}`);
  } finally {
    await d.stop();
  }
}

// ---------------------------------------------------------------------------
if (want('rate')) {
  R.section('Q. Rate-limit tier — the POST is charged to the READ quota');
  const { HOME, WS } = mk('rate', ['A']);
  writeSession(HOME, WS.A, sid('A', 1), { minute: 1, title: 'one' });
  const run = async (args) => {
    const d = await startDaemon('head', HOME, [WS.A], { args: ['--rate-limit', ...args] });
    try {
      const codes = [];
      for (let i = 0; i < 8; i++) codes.push((await http(d, 'POST', '/sessions/catalog', { workspaces: 'all' })).status);
      const slash = (await http(d, 'POST', '/sessions/catalog/', { workspaces: 'all' })).status;
      return { codes, slash };
    } finally {
      await d.stop();
    }
  };
  const tightMutation = await run(['--rate-limit-mutation', '2', '--rate-limit-read', '1000']);
  R.check('Q1', 'mutation quota = 2, read quota = 1000 → 8 consecutive batch POSTs all 200 (incl. trailing-slash spelling)', tightMutation.codes.every((c) => c === 200) && tightMutation.slash === 200, tightMutation.codes.join(',') + ` | "/": ${tightMutation.slash}`);
  const tightRead = await run(['--rate-limit-mutation', '1000', '--rate-limit-read', '3']);
  R.check('Q2', 'read quota = 3 → the batch is throttled with 429 once the read bucket is empty', tightRead.codes.includes(429) && tightRead.codes.slice(0, 2).every((c) => c === 200), tightRead.codes.join(','));
  evidence.rate = { tightMutation, tightRead };
}

// ---------------------------------------------------------------------------
if (want('cap')) {
  R.section('Z. 512 KiB per-member cap — is it reachable with real data?');
  const { HOME, WS } = mk('cap', ['A', 'B']);
  for (let i = 1; i <= 100; i++) writeSession(HOME, WS.A, sid('A', i), { minute: i % 50, title: `big-${i}-`, padBytes: 20_000 });
  writeSession(HOME, WS.B, sid('B', 1), { minute: 1, title: 'small' });
  const d = await startDaemon('head', HOME, Object.values(WS));
  try {
    const r = await http(d, 'POST', '/sessions/catalog', { workspaces: 'all', options: { size: 100 } });
    const a = r.json.workspaces[0];
    const bytes = Buffer.byteLength(JSON.stringify(a));
    R.info(`100 sessions whose first prompt is 20 KB each → member is ${bytes} bytes (displayName is truncated server-side)`);
    // Groups are the other unbounded-ish contributor: create many long-named groups.
    let made = 0;
    let lastStatus = 0;
    for (let i = 0; i < 400; i++) {
      const g = await http(d, 'POST', `/workspaces/${workspaceIdOf(WS.A)}/session-groups`, { name: (`g${i}-` + 'n'.repeat(64)).slice(0, 64), color: 'blue' });
      lastStatus = g.status;
      if (g.status !== 201) break;
      made++;
    }
    const r2 = await http(d, 'POST', '/sessions/catalog', { workspaces: 'all', options: { size: 100 }, includeGroups: true });
    const a2 = r2.json.workspaces[0];
    const bytes2 = Buffer.byteLength(JSON.stringify(a2));
    evidence.cap = { bytesSessionsOnly: bytes, groupsCreated: made, lastGroupStatus: lastStatus, bytesWithGroups: bytes2, member: a2.error ?? 'page' };
    R.info(`created ${made} groups (next create → HTTP ${lastStatus}); member with groups = ${bytes2} bytes → ${a2.error ? a2.error.code : 'page'}`);
    R.check('Z1', 'an oversized member fails alone with 413 catalog_response_too_large OR the cap is unreachable with store-enforced limits; the sibling always pages', !r2.json.workspaces[1].error && (a2.error ? a2.error.code === 'catalog_response_too_large' && a2.error.status === 413 : bytes2 < 512 * 1024), a2.error ? `${a2.error.code}/${a2.error.status}` : `${bytes2}B < 524288B`);
  } finally {
    await d.stop();
  }
}

// ---------------------------------------------------------------------------
if (want('sdk')) {
  R.section('K. Built SDK (packages/sdk-typescript/dist) against the real daemon, through a recording TCP proxy');
  const { HOME, WS } = mk('sdk', ['A', 'B']);
  for (let i = 1; i <= 3; i++) writeSession(HOME, WS.A, sid('A', i), { minute: i, title: `A-${i}` });
  writeSession(HOME, WS.B, sid('B', 1), { minute: 1, title: 'B-1' });
  const d = await startDaemon('head', HOME, Object.values(WS));
  const sdk = await import(path.join(ARMS.head, 'packages/sdk-typescript/dist/index.mjs')).catch(async () => import(path.join(ARMS.head, 'packages/sdk-typescript/dist/index.js')));
  // Recording proxy: forwards bytes, records each request head+body, can hold the response.
  const recorded = [];
  let holdMs = 0;
  let upstreamClosedEarly = 0;
  const proxy = net.createServer((c) => {
    const u = net.connect(d.port, '127.0.0.1');
    let buf = '';
    c.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      const i = buf.indexOf('\r\n\r\n');
      if (i >= 0) {
        const head = buf.slice(0, i);
        const len = Number(/content-length: (\d+)/i.exec(head)?.[1] ?? 0);
        if (buf.length >= i + 4 + len) {
          recorded.push({ line: head.split('\r\n')[0], body: buf.slice(i + 4, i + 4 + len) });
          buf = '';
        }
      }
      // The daemon rejects foreign Host headers (DNS-rebinding guard): rewrite to the upstream port.
      u.write(Buffer.from(chunk.toString('latin1').replace(/^(host: 127\.0\.0\.1:)\d+/im, `$1${d.port}`), 'latin1'));
    });
    u.on('data', (chunk) => setTimeout(() => c.writable && c.write(chunk), holdMs));
    c.on('close', () => {
      upstreamClosedEarly++;
      u.destroy();
    });
    u.on('close', () => c.destroy());
    c.on('error', () => {});
    u.on('error', () => {});
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const client = new sdk.DaemonClient({ baseUrl: `http://127.0.0.1:${proxy.address().port}`, token: TOKEN });
  try {
    const caps = await client.capabilities();
    R.check('K1', 'capability pre-flight through the SDK sees session_catalog_batch', caps.features.includes('session_catalog_batch'));
    recorded.length = 0;
    const res = await client.listSessionsCatalog({ workspaces: 'all', options: { pageSize: 2, archiveState: 'active' }, includeGroups: true }, { timeoutMs: 5000 });
    const posts = recorded.filter((r) => r.line.startsWith('POST /sessions/catalog'));
    const body = JSON.parse(posts[0]?.body ?? '{}');
    evidence.sdk = { wireBody: body, requests: recorded.map((r) => r.line) };
    R.check('K2', 'listSessionsCatalog = exactly ONE HTTP request for both workspaces + groups', recorded.length === 1 && posts.length === 1, recorded.map((r) => r.line).join(' | '));
    R.check('K3', 'wire body maps pageSize→size and carries NO transport fields (signal/timeoutMs/pageSize)', eq(body, { workspaces: 'all', options: { archiveState: 'active', size: 2 }, includeGroups: true }), JSON.stringify(body));
    R.check('K4', 'typed result: 2 members, A has 2 rows + nextCursor + groups, B has 1 row', res.workspaces.length === 2 && res.workspaces[0].sessions.length === 2 && typeof res.workspaces[0].nextCursor === 'string' && res.workspaces[0].groups && res.workspaces[1].sessions.length === 1);
    const next = await client.listSessionsCatalog({ workspaces: [{ workspace: res.workspaces[0].cwd, cursor: res.workspaces[0].nextCursor }], options: { pageSize: 2, archiveState: 'active' } });
    R.check('K5', 'continuing with the returned cwd + nextCursor yields the remaining row', eq(next.workspaces[0].sessions.map((s) => s.sessionId), [sid('A', 1)]) && next.workspaces[0].nextCursor === undefined);
    const mixed = await client.listSessionsCatalog({ workspaces: [{ workspace: '/nope' }, { workspace: WS.B }] });
    R.check('K6', 'member error is preserved as data (no throw): { error: { code, message, status } }', mixed.workspaces[0].error?.code === 'workspace_not_found' && mixed.workspaces[1].sessions.length === 1);
    let httpErr;
    try {
      await client.listSessionsCatalog({ workspaces: [] });
    } catch (e) {
      httpErr = e;
    }
    R.check('K7', 'a malformed envelope throws DaemonHttpError 400', httpErr instanceof sdk.DaemonHttpError && httpErr.status === 400, `${httpErr?.constructor?.name} ${httpErr?.status}`);

    // cancellation + timeout: hold the response in the proxy so the call is in flight.
    holdMs = 1500;
    const ac = new AbortController();
    const t0 = performance.now();
    setTimeout(() => ac.abort(), 100);
    let abortErr;
    try {
      await client.listSessionsCatalog({ workspaces: 'all' }, { signal: ac.signal });
    } catch (e) {
      abortErr = e;
    }
    const abortMs = performance.now() - t0;
    R.check('K8', 'AbortSignal rejects the in-flight batch promptly (response held 1500 ms by the proxy)', abortErr !== undefined && abortMs < 800, `${abortErr?.name}: rejected after ${abortMs.toFixed(0)}ms`);
    const t1 = performance.now();
    let toErr;
    try {
      await client.listSessionsCatalog({ workspaces: 'all' }, { timeoutMs: 200 });
    } catch (e) {
      toErr = e;
    }
    const toMs = performance.now() - t1;
    R.check('K9', 'per-call timeoutMs=200 rejects the held batch', toErr !== undefined && toMs < 1000, `${toErr?.name}: rejected after ${toMs.toFixed(0)}ms`);
    holdMs = 0;
    const ok = await client.listSessionsCatalog({ workspaces: 'all' });
    R.check('K10', 'daemon healthy after aborted/timed-out calls', ok.workspaces.length === 2 && !ok.workspaces.some((m) => m.error));
  } finally {
    proxy.close();
    await d.stop();
  }
}

// ---------------------------------------------------------------------------
if (want('abort')) {
  R.section('A. Client disconnect on the real daemon — queued member reads never start');
  const N = 20;
  const PER = 2500;
  const names = Array.from({ length: N }, (_, i) => `w${String(i + 1).padStart(2, '0')}`);
  const { HOME, WS } = mk('abort', names);
  for (const [wi, w] of Object.values(WS).entries()) for (let i = 1; i <= PER; i++) writeSession(HOME, w, sid('A', wi * 10000 + i), { minute: i % 59, title: `s${i}` });
  const cpu = (pid) => {
    const f = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const p = f.slice(f.lastIndexOf(')') + 2).split(' ');
    return (Number(p[11]) + Number(p[12])) / 100; // utime+stime, seconds (CLK_TCK=100)
  };
  const members = Object.values(WS).map((w) => ({ workspace: w }));
  const measure = async (abortAfterMs) => {
    const d = await startDaemon('head', HOME, Object.values(WS));
    try {
      await sleep(3000);
      const c0 = cpu(d.child.pid);
      const t0 = performance.now();
      let outcome;
      if (abortAfterMs === undefined) {
        const r = await http(d, 'POST', '/sessions/catalog', { workspaces: members, options: { size: 1 } });
        outcome = `HTTP ${r.status}, ${r.json.workspaces.filter((m) => !m.error).length}/${N} pages`;
      } else {
        const ac = new AbortController();
        setTimeout(() => ac.abort(), abortAfterMs);
        try {
          await http(d, 'POST', '/sessions/catalog', { workspaces: members, options: { size: 1 } }, { signal: ac.signal });
          outcome = 'completed (abort too late)';
        } catch (e) {
          outcome = `client ${e.name}`;
        }
      }
      const wall = performance.now() - t0;
      await sleep(4000); // let any orphaned work finish before sampling CPU
      const c1 = cpu(d.child.pid);
      const health = await http(d, 'POST', '/sessions/catalog', { workspaces: [{ workspace: Object.values(WS)[N - 1] }], options: { size: 1 } });
      return { outcome, wallMs: wall, cpuSec: c1 - c0, healthy: health.status === 200 && !health.json.workspaces[0].error, err: d.logs().err };
    } finally {
      await d.stop();
    }
  };
  const full = await measure(undefined);
  const cut = await measure(150);
  evidence.abort = { full: { ...full, err: undefined }, cut: { ...cut, err: undefined }, N, PER };
  R.info(`full batch : ${full.outcome}, wall ${full.wallMs.toFixed(0)} ms, daemon CPU ${full.cpuSec.toFixed(2)} s`);
  R.info(`aborted@150: ${cut.outcome}, wall ${cut.wallMs.toFixed(0)} ms, daemon CPU ${cut.cpuSec.toFixed(2)} s`);
  R.check('A1', `disconnecting 150 ms into a cold ${N}×${PER}-session batch stops the daemon from scanning the queued members (CPU well below the full run)`, cut.outcome.startsWith('client') && cut.cpuSec < full.cpuSec * 0.6, `CPU ${cut.cpuSec.toFixed(2)}s vs ${full.cpuSec.toFixed(2)}s (${((cut.cpuSec / full.cpuSec) * 100).toFixed(0)}%)`);
  R.check('A2', 'daemon stays healthy and logs no unhandled error after the disconnect', cut.healthy && !/unhandled|uncaught/i.test(cut.err));
}

// ---------------------------------------------------------------------------
if (want('fuzz')) {
  R.section('F. Hostile / exotic selectors and bodies never 500 or hang');
  const { ROOT, HOME, WS } = mk('fuzz', ['A', 'B']);
  writeSession(HOME, WS.A, sid('A', 1), { minute: 1, title: 'A-1' });
  writeSession(HOME, WS.B, sid('B', 1), { minute: 1, title: 'B-1' });
  const link = path.join(ROOT, 'link-to-B');
  symlinkSync(WS.B, link);
  const d = await startDaemon('head', HOME, Object.values(WS));
  try {
    const sym = await http(d, 'POST', '/sessions/catalog', { workspaces: [{ workspace: link }] });
    const m = sym.json.workspaces[0];
    R.check('F1', 'a symlink alias of a registered workspace resolves to the canonical owner (workspace echoes the alias, cwd is canonical)', !m.error && m.cwd === WS.B && m.workspace === link && eq(ids(m), [sid('B', 1)]));
    const selectors = ['/\u0000evil', WS.A + '\u0000', '/' + 'a'.repeat(4095), 'C:\\Users\\x', '\\\\server\\share\\x', '/proc/self/root' + WS.A, '/../../etc', '../' + path.basename(WS.A), ' ', '%2Froot', WS.A.toUpperCase(), '/dev/null', 'file://' + WS.A, '__proto__', 'constructor', 'toString'];
    const r = await http(d, 'POST', '/sessions/catalog', { workspaces: selectors.map((w) => ({ workspace: w })) });
    const table = (r.json?.workspaces ?? []).map((x, i) => [JSON.stringify(selectors[i]).slice(0, 40), x.error ? `${x.error.status} ${x.error.code}` : `page cwd=${path.basename(x.cwd)}`]);
    evidence.fuzz = { status: r.status, table };
    const bad = table.filter(([, v]) => !/^404 workspace_not_found$|^page /.test(v));
    R.check('F2', `${selectors.length} exotic selectors in one batch → HTTP 200, each member is either a 404 member error or a correctly-owned page (no 500, no hang)`, r.status === 200 && bad.length === 0, bad.map((b) => b.join('=')).join(' ') || `${table.filter(([, v]) => v.startsWith('page')).length} resolved, ${table.filter(([, v]) => v.startsWith('404')).length} rejected`);
    const resolved = (r.json?.workspaces ?? []).filter((x) => !x.error);
    R.check('F3', 'every selector that DID resolve points at a registered workspace and returns only that workspace\'s rows', resolved.every((x) => Object.values(WS).includes(x.cwd) && x.sessions.every((s) => s.workspaceCwd === x.cwd)), resolved.map((x) => `${JSON.stringify(x.workspace).slice(0, 30)}→${path.basename(x.cwd)}`).join(' '));
    const bodies = [['not JSON', '{oops', 400], ['JSON array', '[]', 400], ['JSON null', 'null', 400], ['workspaces: null', '{"workspaces":null}', 400], ['cursor: 16385 chars', JSON.stringify({ workspaces: [{ workspace: WS.A, cursor: 'x'.repeat(16385) }] }), 400], ['__proto__ key', '{"workspaces":"all","__proto__":{"x":1}}', 400], ['size: "20"', '{"workspaces":"all","options":{"size":"20"}}', 400], ['size: 1.5', '{"workspaces":"all","options":{"size":1.5}}', 400]];
    const got = [];
    for (const [name, body, wantStatus] of bodies) {
      const x = await http(d, 'POST', '/sessions/catalog', body);
      got.push([name, x.status, wantStatus]);
    }
    evidence.fuzz.bodies = got;
    R.check('F4', `${bodies.length} hostile bodies → 400, never 500`, got.every(([, s, w]) => s === w), got.map(([n, s]) => `${n}=${s}`).join(' | '));
    const health = await http(d, 'POST', '/sessions/catalog', { workspaces: 'all' });
    R.check('F5', 'daemon still healthy afterwards; no unhandled error logged', health.status === 200 && !/unhandled|uncaught/i.test(d.logs().err));
  } finally {
    await d.stop();
  }
}

const s = R.summary();
R.save(path.join(OUT, `probes${only ? '-' + only.join('-') : ''}`));
writeFileSync(path.join(OUT, `probes-evidence${only ? '-' + only.join('-') : ''}.json`), JSON.stringify(evidence, null, 2));
process.exit(s.fail ? 1 : 0);
