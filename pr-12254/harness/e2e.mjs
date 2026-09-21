// PR #12254 — real-daemon E2E. Usage: node e2e.mjs <out-dir>
import * as path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  Report,
  startDaemon,
  http,
  writeSession,
  freshDir,
  sid,
  workspaceIdOf,
  descendants,
  eq,
  sleep,
} from './lib.mjs';

const OUT = process.argv[2] ?? '/root/verify/pr12254-harness/out';
mkdirSync(OUT, { recursive: true });
const ROOT = freshDir('/root/verify/pr12254-harness/run-e2e');
const HOME = path.join(ROOT, 'home');
const WS = {
  A: path.join(ROOT, 'ws-alpha'),
  B: path.join(ROOT, 'ws-beta'),
  C: path.join(ROOT, 'ws-gamma'),
};
for (const d of [HOME, ...Object.values(WS)]) mkdirSync(d, { recursive: true });
writeFileSync(path.join(HOME, '.qwen-placeholder'), '');
mkdirSync(path.join(HOME, '.qwen'), { recursive: true });

// ---- deterministic fixture ------------------------------------------------
const CH1 = { sourceType: 'channel', sourceId: 'dingtalk:room-1' };
const CH2 = { sourceType: 'channel', sourceId: 'dingtalk:room-2' };
const plan = {
  A: { active: 7, archived: 2, sources: { 2: CH1, 4: CH1, 5: CH2 } },
  B: { active: 5, archived: 1, sources: { 1: CH1 } },
  C: { active: 3, archived: 0, sources: {} },
};
const expected = { A: { active: [], archived: [] }, B: { active: [], archived: [] }, C: { active: [], archived: [] } };
for (const [k, p] of Object.entries(plan)) {
  for (let i = 1; i <= p.active; i++) {
    const id = sid(k, i);
    writeSession(HOME, WS[k], id, { minute: i, title: `${k}-active-${i}`, source: p.sources[i] });
    expected[k].active.push(id);
  }
  for (let i = 1; i <= p.archived; i++) {
    const id = sid(k, 100 + i);
    writeSession(HOME, WS[k], id, { minute: 30 + i, title: `${k}-archived-${i}`, archived: true });
    expected[k].archived.push(id);
  }
}
const WSID = Object.fromEntries(Object.entries(WS).map(([k, v]) => [k, workspaceIdOf(v)]));
const enc = encodeURIComponent;

const R = new Report('PR #12254 real-daemon E2E — head 021f3228 vs base af4e3b29');
const evidence = {};

// ---- phase 0: seed groups through the real organization API ---------------
R.section('0. Seed workspace-local groups through the real REST API (head daemon, then stop)');
const groups = {};
{
  const d = await startDaemon(process.env.HEAD_ARM ?? 'head', HOME, Object.values(WS));
  for (const k of ['A', 'B']) {
    const r = await http(d, 'POST', `/workspaces/${WSID[k]}/session-groups`, { name: 'Backend', color: 'blue' });
    groups[k] = r.json?.group;
    R.check(`seed-${k}`, `create group "Backend" in ws-${k}`, r.status === 201 && groups[k]?.id, `HTTP ${r.status} id=${groups[k]?.id}`);
  }
  const r2 = await http(d, 'POST', `/workspaces/${WSID.A}/session-groups`, { name: 'Docs', color: 'green' });
  groups.A2 = r2.json?.group;
  for (const [k, n, g] of [['A', 1, groups.A], ['A', 3, groups.A], ['A', 6, groups.A2], ['B', 2, groups.B]]) {
    const r = await http(d, 'PATCH', `/workspaces/${WSID[k]}/session/${sid(k, n)}/organization`, { groupId: g.id });
    R.check(`assign-${k}${n}`, `assign ${k}-active-${n} → ${g.name}`, r.status === 200, `HTTP ${r.status}`);
  }
  const pin = await http(d, 'PATCH', `/workspaces/${WSID.A}/session/${sid('A', 7)}/organization`, { isPinned: true });
  R.check('pin-A7', 'pin A-active-7', pin.status === 200, `HTTP ${pin.status}`);
  await d.stop();
}

// ---- phase 1: base arm ------------------------------------------------------
R.section('1. BEFORE — base daemon (merge-base af4e3b29)');
const baseline = {};
{
  const d = await startDaemon('base', HOME, Object.values(WS));
  const caps = await http(d, 'GET', '/capabilities');
  R.check('B1', 'capability session_catalog_batch is NOT advertised', !caps.json.features.includes('session_catalog_batch'));
  const post = await http(d, 'POST', '/sessions/catalog', { workspaces: 'all' });
  R.check('B2', 'POST /sessions/catalog → 404', post.status === 404, `HTTP ${post.status}`);
  // Record the legacy single-workspace responses for the no-regression diff.
  for (const k of Object.keys(WS)) {
    baseline[k] = {};
    for (const [name, q] of Object.entries(legacyQueries(k))) {
      const r = await http(d, 'GET', `/workspaces/${WSID[k]}/sessions${q}`);
      baseline[k][name] = { status: r.status, json: r.json };
    }
    const g = await http(d, 'GET', `/workspaces/${WSID[k]}/session-groups`);
    baseline[k].groups = { status: g.status, json: g.json };
  }
  evidence.baseCursorOrganized = baseline.A.organizedAllP1.json?.nextCursor;
  evidence.baseCursorSource = baseline.A.sourceP1.json?.nextCursor;
  R.info(`recorded ${Object.values(baseline).reduce((n, b) => n + Object.keys(b).length, 0)} legacy responses for the A/B diff`);
  await d.stop();
}

function legacyQueries(k) {
  return {
    default: '?size=100',
    page1: '?size=2',
    archived: '?size=100&archiveState=archived',
    organizedAll: '?size=100&view=organized&group=all',
    organizedAllP1: '?size=2&view=organized&group=all',
    ungrouped: '?size=100&view=organized&group=ungrouped',
    pinned: '?size=100&view=organized&group=pinned',
    source: '?size=100&sourceType=channel',
    sourceP1: '?size=1&sourceType=channel',
    sourceId: `?size=100&sourceType=channel&sourceId=${enc('dingtalk:room-1')}`,
    ...(groups[k] ? { group: `?size=100&view=organized&group=${enc(groups[k].id)}` } : {}),
  };
}

// ---- phase 2: head arm ------------------------------------------------------
R.section('2. AFTER — head daemon (021f3228): capability + one-request catalog');
const d = await startDaemon(process.env.HEAD_ARM ?? 'head', HOME, Object.values(WS));
await sleep(2500); // let the primary's boot-time ACP preheat settle
const procBefore = descendants(d.child.pid);
const statusOf = async (k) => (await http(d, 'GET', `/workspaces/${WSID[k]}/runtime/status`)).json;
const coldBefore = { B: await statusOf('B'), C: await statusOf('C') };
const ids = (m) => (m.sessions ?? []).map((s) => s.sessionId);
let batchCalls = 0;
const batch = (body, o) => (batchCalls++, http(d, 'POST', '/sessions/catalog', body, o));

{
  const caps = await http(d, 'GET', '/capabilities');
  R.check('H1', 'capability session_catalog_batch IS advertised', caps.json.features.includes('session_catalog_batch'));

  const r = await batch({ workspaces: 'all', options: { size: 100 }, includeGroups: true });
  evidence.allResponse = r.json;
  const ms = r.json?.workspaces ?? [];
  R.check('H2', 'one request returns 3 members in registration order', r.status === 200 && eq(ms.map((m) => m.cwd), Object.values(WS)), `HTTP ${r.status} ${r.bytes}B ${r.ms.toFixed(0)}ms`);
  R.check('H3', 'every member carries canonical workspaceId + cwd', ms.every((m, i) => m.workspaceId === Object.values(WSID)[i] && m.workspace === m.cwd));
  for (const [i, k] of ['A', 'B', 'C'].entries()) {
    const want = [...expected[k].active].reverse();
    R.check(`H4-${k}`, `ws-${k}: exactly its ${want.length} active sessions, newest first`, eq(ids(ms[i]), want), ids(ms[i]).map((x) => x.slice(-2)).join(','));
  }
  R.check('H5', "every session row's workspaceCwd equals its member cwd (no cross-workspace leak)", ms.every((m) => m.sessions.every((s) => s.workspaceCwd === m.cwd)));
  R.check('H6', 'group catalogs are workspace-local (A: Backend+Docs, B: Backend with a different id, C: none)',
    eq(ms[0].groups.groups.map((g) => g.name).sort(), ['Backend', 'Docs']) &&
      eq(ms[1].groups.groups.map((g) => g.name), ['Backend']) &&
      ms[2].groups.groups.length === 0 &&
      ms[0].groups.groups.find((g) => g.name === 'Backend').id !== ms[1].groups.groups[0].id,
    `A=${ms[0].groups.groups.map((g) => g.id.slice(0, 8))} B=${ms[1].groups.groups.map((g) => g.id.slice(0, 8))}`);
}

// ---- parity oracle: batch member == qualified GET -------------------------
R.section('3. Parity — every batch view equals the existing qualified GET (same daemon)');
const strip = (s) => s; // rows compared verbatim
async function parity(id, desc, options, query, { includeGroups = false } = {}) {
  const b = await batch({ workspaces: Object.values(WS).map((w) => ({ workspace: w })), options: { size: 100, ...options }, includeGroups });
  let ok = b.status === 200;
  const detail = [];
  for (const [i, k] of ['A', 'B', 'C'].entries()) {
    const g = await http(d, 'GET', `/workspaces/${WSID[k]}/sessions?size=100${query}`);
    const m = b.json.workspaces[i];
    const same = eq((m.sessions ?? []).map(strip), (g.json.sessions ?? []).map(strip));
    ok &&= same && m.error === undefined;
    detail.push(`${k}:${(m.sessions ?? []).length}`);
  }
  R.check(id, desc, ok, detail.join(' '));
}
await parity('P1', 'default (unfiltered, active)', {}, '');
await parity('P2', 'archiveState=archived', { archiveState: 'archived' }, '&archiveState=archived');
await parity('P3', 'view=organized group=all', { view: 'organized', group: 'all' }, '&view=organized&group=all');
await parity('P4', 'view=organized group=ungrouped', { view: 'organized', group: 'ungrouped' }, '&view=organized&group=ungrouped');
await parity('P5', 'view=organized group=pinned', { view: 'organized', group: 'pinned' }, '&view=organized&group=pinned');
await parity('P6', 'sourceType=channel', { sourceType: 'channel' }, '&sourceType=channel');
await parity('P7', 'sourceType=channel sourceId=dingtalk:room-1', { sourceType: 'channel', sourceId: 'dingtalk:room-1' }, `&sourceType=channel&sourceId=${enc('dingtalk:room-1')}`);
{
  // A group id only exists in its own workspace: the owner pages, the others fail alone.
  const b = await batch({ workspaces: [{ workspace: WS.A }, { workspace: WS.B }], options: { view: 'organized', group: groups.A.id, size: 100 } });
  const [a, bb] = b.json.workspaces;
  R.check('P8', "ws-A's group id pages in A and is an isolated 404 group_not_found member in B", b.status === 200 && eq(ids(a), [sid('A', 3), sid('A', 1)]) && bb.error?.code === 'group_not_found' && bb.error?.status === 404, `A=${ids(a).length} rows, B=${bb.error?.code}/${bb.error?.status}`);
  const g = await http(d, 'GET', `/workspaces/${WSID.A}/session-groups`);
  const all = await batch({ workspaces: [{ workspace: WS.A }], includeGroups: true });
  R.check('P9', 'includeGroups catalog equals GET /workspaces/:ws/session-groups', eq(all.json.workspaces[0].groups, g.json));
}

// ---- pagination -----------------------------------------------------------
R.section('4. Independent continuation — no missing / repeated rows');
async function drain(options, label) {
  const seen = { A: [], B: [], C: [] };
  let members = Object.entries(WS).map(([k, w]) => ({ k, workspace: w }));
  let requests = 0;
  while (members.length) {
    const r = await batch({ workspaces: members.map(({ workspace, cursor }) => ({ workspace, ...(cursor ? { cursor } : {}) })), options });
    requests++;
    if (r.status !== 200) throw new Error(`${label}: HTTP ${r.status} ${r.text}`);
    const next = [];
    r.json.workspaces.forEach((m, i) => {
      const k = members[i].k;
      if (m.error) throw new Error(`${label}: ${k} ${JSON.stringify(m.error)}`);
      seen[k].push(...ids(m));
      if (m.nextCursor) next.push({ k, workspace: m.cwd, cursor: m.nextCursor });
    });
    members = next;
    if (requests > 50) throw new Error('runaway pagination');
  }
  return { seen, requests };
}
{
  const { seen, requests } = await drain({ size: 2 }, 'default');
  const ok = ['A', 'B', 'C'].every((k) => eq(seen[k], [...expected[k].active].reverse()));
  R.check('G1', `size=2 drained in ${requests} batch requests: each workspace returns every session exactly once, in order`, ok, `A=${seen.A.length} B=${seen.B.length} C=${seen.C.length}`);
  R.check('G2', 'short workspaces drop out while longer ones keep paging (cursors are independent)', requests === 4);
  const o = await drain({ size: 2, view: 'organized', group: 'all' }, 'organized');
  const full = await batch({ workspaces: 'all', options: { size: 100, view: 'organized', group: 'all' } });
  R.check('G3', 'organized view size=2 drains to the same ordered set as one size=100 page', ['A', 'B', 'C'].every((k, i) => eq(o.seen[k], ids(full.json.workspaces[i]))), `requests=${o.requests}`);
  const s = await drain({ size: 1, sourceType: 'channel' }, 'source');
  R.check('G4', 'sourceType=channel size=1 drains to A:{5,4,2} B:{1} C:{}', eq(s.seen.A, [sid('A', 5), sid('A', 4), sid('A', 2)]) && eq(s.seen.B, [sid('B', 1)]) && s.seen.C.length === 0);
}

// ---- selection ------------------------------------------------------------
R.section('5. Subset selection by workspace id and by cwd');
{
  const r = await batch({ workspaces: [{ workspace: WSID.C }, { workspace: WS.A }], options: { size: 100 } });
  const ms = r.json.workspaces;
  R.check('S1', 'selection order preserved (C by id, then A by cwd); B absent', ms.length === 2 && ms[0].cwd === WS.C && ms[1].cwd === WS.A);
  R.check('S2', 'member.workspace echoes the ORIGINAL selector; cwd/workspaceId are canonical', ms[0].workspace === WSID.C && ms[0].workspaceId === WSID.C && ms[1].workspace === WS.A && ms[1].workspaceId === WSID.A);
  const alias = await batch({ workspaces: [{ workspace: WS.B + '/' }, { workspace: WS.B + '/./' }] });
  R.check('S3', 'non-canonical cwd spellings ("/x/", "/x/./") resolve to the canonical owner', alias.json.workspaces.every((m) => m.cwd === WS.B && !m.error), alias.json.workspaces.map((m) => m.error?.code ?? 'ok').join(','));
}

// ---- errors ---------------------------------------------------------------
R.section('6. Partial failure, bounds, auth');
{
  const r = await batch({ workspaces: [{ workspace: '/nonexistent/ws' }, { workspace: WS.B }, { workspace: 'deadbeefdeadbeef' }, { workspace: 'relative/path' }] });
  const [x, b, y, z] = r.json.workspaces;
  R.check('E1', 'unknown cwd / unknown id / relative selector → 404 member errors, valid member still paged, HTTP 200', r.status === 200 && [x, y, z].every((m) => m.error?.code === 'workspace_not_found' && m.error.status === 404 && m.sessions === undefined) && ids(b).length === 5);
  const bad = await batch({ workspaces: [{ workspace: WS.A, cursor: 'not-a-cursor' }, { workspace: WS.B }] });
  R.check('E2', 'a bad cursor fails only its own member (400 invalid_cursor)', bad.status === 200 && bad.json.workspaces[0].error?.code === 'invalid_cursor' && bad.json.workspaces[0].error.status === 400 && ids(bad.json.workspaces[1]).length === 5, bad.json.workspaces[0].error?.message);

  const malformed = [
    ['empty body', {}],
    ['workspaces: []', { workspaces: [] }],
    ['21 members', { workspaces: Array.from({ length: 21 }, () => ({ workspace: WS.A })) }],
    ['size 0', { workspaces: 'all', options: { size: 0 } }],
    ['size 101', { workspaces: 'all', options: { size: 101 } }],
    ['unknown envelope key', { workspaces: 'all', extra: 1 }],
    ['unknown option key', { workspaces: 'all', options: { timeoutMs: 5 } }],
    ['unknown member key', { workspaces: [{ workspace: WS.A, size: 5 }] }],
    ['group without organized view', { workspaces: 'all', options: { group: 'all' } }],
    ['parentSessionId with organized view', { workspaces: 'all', options: { view: 'organized', parentSessionId: 'x' } }],
    ['bad sourceType', { workspaces: 'all', options: { sourceType: 'Bad Type' } }],
    ['workspaces: "ALL"', { workspaces: 'ALL' }],
  ];
  const got = [];
  for (const [name, body] of malformed) {
    const r = await batch(body);
    got.push([name, r.status, r.json?.code]);
  }
  evidence.malformed = got;
  R.check('E3', `${malformed.length} malformed envelopes all → HTTP 400`, got.every(([, s]) => s === 400), got.filter(([, s]) => s !== 400).map(([n, s]) => `${n}=${s}`).join(' '));
  const noauth = await batch({ workspaces: 'all' }, { token: null });
  const wrong = await batch({ workspaces: 'all' }, { token: 'nope' });
  R.check('E4', 'missing / wrong bearer token → 401', noauth.status === 401 && wrong.status === 401, `${noauth.status}/${wrong.status}`);
  const get = await http(d, 'GET', '/sessions/catalog');
  R.check('E5', 'GET /sessions/catalog is not a route (POST only)', get.status === 404, `HTTP ${get.status}`);
}

// ---- cursor family / mode binding -------------------------------------------
R.section('7. Cursor family + pagination-mode binding (round-2 fix R2-3)');
{
  const bDefault = (await batch({ workspaces: [{ workspace: WS.A }], options: { size: 2 } })).json.workspaces[0].nextCursor;
  const bOrg = (await batch({ workspaces: [{ workspace: WS.A }], options: { size: 2, view: 'organized', group: 'all' } })).json.workspaces[0].nextCursor;
  const gOrg = (await http(d, 'GET', `/workspaces/${WSID.A}/sessions?size=2&view=organized&group=all`)).json.nextCursor;
  const gSrc = (await http(d, 'GET', `/workspaces/${WSID.A}/sessions?size=1&sourceType=channel`)).json.nextCursor;
  const gNum = (await http(d, 'GET', `/workspaces/${WSID.A}/sessions?size=2`)).json.nextCursor;
  evidence.cursors = { bDefault: decode(bDefault), bOrg: decode(bOrg), gOrg: decode(gOrg), gSrc: decode(gSrc), gNum };
  const viaBatch = async (cursor, options) => (await batch({ workspaces: [{ workspace: WS.A, cursor }], options })).json.workspaces[0];
  const viaGet = async (cursor, q) => http(d, 'GET', `/workspaces/${WSID.A}/sessions?cursor=${enc(cursor)}${q}`);
  const c1 = await viaBatch(gOrg, { size: 2, view: 'organized', group: 'all' });
  R.check('K1', 'legacy-GET organized cursor replayed in the batch → invalid_cursor', c1.error?.code === 'invalid_cursor');
  const c2 = await viaGet(bOrg, '&size=2&view=organized&group=all');
  R.check('K2', 'batch organized cursor replayed on the legacy GET → 400', c2.status === 400, `HTTP ${c2.status} ${c2.json?.code}`);
  const c3 = await viaBatch(bOrg, { size: 2 });
  R.check('K3', 'organized cursor replayed on the default (metadata) family → invalid_cursor', c3.error?.code === 'invalid_cursor');
  const c4 = await viaBatch(bDefault, { size: 2, view: 'organized', group: 'all' });
  R.check('K4', 'default cursor replayed on the organized family → invalid_cursor', c4.error?.code === 'invalid_cursor');
  const c5 = await viaBatch(String(gNum), { size: 2 });
  R.check('K5', 'legacy numeric cursor in a batch member → invalid_cursor (documented: not interchangeable)', c5.error?.code === 'invalid_cursor', `numeric=${gNum}`);
  const c6 = await viaBatch(gSrc, { size: 1, sourceType: 'channel' });
  R.check('K6', 'legacy-GET source cursor (paginateMerged:false) replayed in the batch → invalid_cursor', c6.error?.code === 'invalid_cursor');
  // Pre-upgrade cursors (issued by the BASE daemon, no markers) must still work on the head GET.
  const old1 = await viaGet(evidence.baseCursorOrganized, '&size=2&view=organized&group=all');
  const old2 = await viaGet(evidence.baseCursorSource, '&size=1&sourceType=channel');
  R.check('K7', 'cursors minted by the BASE daemon still continue on the head legacy GET (rolling upgrade)', old1.status === 200 && eq(old1.json.sessions.map((s) => s.sessionId), baseline.A.organizedAll.json.sessions.slice(2, 4).map((s) => s.sessionId)) && old2.status === 200 && eq(old2.json.sessions.map((s) => s.sessionId), [sid('A', 4)]), `organized=${old1.status} source=${old2.status}`);
  evidence.baseCursorDecoded = { organized: decode(evidence.baseCursorOrganized), source: decode(evidence.baseCursorSource) };
}
function decode(c) {
  try {
    return JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
  } catch {
    try {
      return JSON.parse(Buffer.from(c, 'base64').toString('utf8'));
    } catch {
      return c;
    }
  }
}

// ---- no-regression A/B on the existing endpoints ---------------------------
R.section('8. No regression — existing single-workspace endpoints, base vs head');
{
  let same = 0;
  let total = 0;
  const diffs = [];
  const scrub = (j) => JSON.parse(JSON.stringify(j ?? null, (key, v) => (key === 'nextCursor' ? '<cursor>' : v)));
  for (const k of Object.keys(WS)) {
    for (const [name, q] of Object.entries(legacyQueries(k))) {
      const r = await http(d, 'GET', `/workspaces/${WSID[k]}/sessions${q}`);
      total++;
      if (r.status === baseline[k][name].status && eq(scrub(r.json), scrub(baseline[k][name].json))) same++;
      else diffs.push(`${k}.${name}`);
    }
    const g = await http(d, 'GET', `/workspaces/${WSID[k]}/session-groups`);
    total++;
    if (eq(g.json, baseline[k].groups.json)) same++;
    else diffs.push(`${k}.groups`);
  }
  R.check('N1', `${total} legacy responses identical between base and head (cursor bytes scrubbed — new cursors carry family markers)`, same === total, diffs.join(' '));
  const numericSame = eq(baseline.A.page1.json.nextCursor, (await http(d, 'GET', `/workspaces/${WSID.A}/sessions?size=2`)).json.nextCursor);
  R.check('N2', 'legacy unfiltered numeric cursor is byte-identical across arms', numericSame);
}

// ---- cold secondaries -------------------------------------------------------
R.section('9. Secondaries stay cold — runtime status + /proc process tree');
{
  const coldAfter = { B: await statusOf('B'), C: await statusOf('C') };
  const procAfter = descendants(d.child.pid);
  evidence.cold = { before: coldBefore, after: coldAfter, procBefore, procAfter };
  for (const k of ['B', 'C']) {
    const a = coldAfter[k];
    R.check(`C-${k}`, `ws-${k} after ${batchCalls} batch requests: runtimeLive=false runtimeEpoch=0, status byte-identical to before`, a.runtimeLive === false && a.runtimeEpoch === 0 && eq(a, coldBefore[k]), `state=${a.state} live=${a.runtimeLive} epoch=${a.runtimeEpoch}`);
  }
  const owned = (list, w) => list.filter((x) => x.cwd === w).length;
  R.check('C-proc', 'process tree: the only ACP child belongs to the primary (boot preheat); none has cwd ws-B / ws-C, and no new pid appeared while browsing',
    owned(procAfter, WS.B) === 0 && owned(procAfter, WS.C) === 0 && eq(procAfter.map((x) => x.pid), procBefore.map((x) => x.pid)),
    `children: before=${procBefore.length} after=${procAfter.length} (A=${owned(procAfter, WS.A)} B=${owned(procAfter, WS.B)} C=${owned(procAfter, WS.C)})`);
}

// ---- dynamic registration + removal ------------------------------------------
R.section('10. Runtime-registered workspace: appears in "all", then removed');
{
  const WD = path.join(ROOT, 'ws-delta');
  mkdirSync(WD, { recursive: true });
  for (let i = 1; i <= 2; i++) writeSession(HOME, WD, sid('D', i), { minute: i, title: `D-active-${i}` });
  const reg = await http(d, 'POST', '/workspaces', { cwd: WD });
  const wdid = workspaceIdOf(WD);
  const all1 = await batch({ workspaces: 'all' });
  const md = all1.json.workspaces.find((m) => m.cwd === WD);
  R.check('X0', `POST /workspaces {cwd: ws-delta} → ${reg.status}; "all" now has 4 members and ws-delta pages its own 2 sessions`, reg.status < 300 && all1.json.workspaces.length === 4 && md && eq(ids(md), [sid('D', 2), sid('D', 1)]) && md.workspaceId === wdid);
  const stD = await statusOf2(wdid);
  R.check('X0c', 'the runtime-registered workspace is still cold after being browsed', stD.runtimeLive === false && stD.runtimeEpoch === 0, `state=${stD.state}`);
  const del = await http(d, 'DELETE', `/workspaces/${wdid}`);
  const r = await batch({ workspaces: [{ workspace: WD }, { workspace: wdid }, { workspace: WS.B }] });
  const all = await batch({ workspaces: 'all' });
  evidence.removed = { del: { status: del.status, body: del.json }, members: r.json.workspaces.slice(0, 2) };
  R.check('X1', `DELETE /workspaces/:delta → ${del.status}; selecting it by cwd or by id → 404 workspace_not_found member (no empty success page), ws-B still paged`, del.status < 300 && r.json.workspaces[0].error?.code === 'workspace_not_found' && r.json.workspaces[1].error?.code === 'workspace_not_found' && r.json.workspaces[0].sessions === undefined && ids(r.json.workspaces[2]).length === 5);
  R.check('X2', '"all" no longer enumerates the removed workspace', eq(all.json.workspaces.map((m) => m.cwd), [WS.A, WS.B, WS.C]));
}
async function statusOf2(id) {
  return (await http(d, 'GET', `/workspaces/${id}/runtime/status`)).json;
}

const logs = d.logs();
R.check('Z1', 'daemon stderr has no unhandled rejection / crash', !/unhandled|uncaught|TypeError|ReferenceError/i.test(logs.err), `${logs.err.split('\n').length} stderr lines`);
await d.stop();
const s = R.summary();
R.save(path.join(OUT, 'e2e'));
writeFileSync(path.join(OUT, 'e2e-evidence.json'), JSON.stringify(evidence, null, 2));
await sleep(50);
process.exit(s.fail ? 1 : 0);
