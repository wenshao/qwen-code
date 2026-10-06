// HTTP-level A/B driver for PR #13468 against a REAL `qwen serve` daemon with
// real ACP children. usage: node api-matrix.mjs <daemonUrl> <token> <outJson>
//   env: PRIMARY, SECONDARY (abs cwds), FAKE (fake-model base, no /v1), LOG
import fs from 'node:fs';

const [base, token, out] = process.argv.slice(2);
const PRIMARY = process.env.PRIMARY;
const SECONDARY = process.env.SECONDARY;
const FAKE = process.env.FAKE;
const LOG = process.env.LOG;
const t0 = Date.now();
const results = { arm: process.env.ARM, steps: [] };
const step = (name, data) => {
  results.steps.push({ name, at: Date.now() - t0, ...data });
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`, JSON.stringify(data).slice(0, 400));
};
const H = (clientId, extra = {}) => ({
  authorization: `Bearer ${token}`,
  ...(clientId ? { 'x-qwen-client-id': clientId } : {}),
  ...extra,
});
async function call(method, path, { clientId, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: H(clientId, body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const modelLog = () =>
  fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

// SSE watcher: resolves turn_complete/turn_error by promptId.
function watch(sessionId, clientId) {
  const ac = new AbortController();
  const seen = new Map();
  const waiters = [];
  (async () => {
    try {
      const res = await fetch(`${base}/session/${encodeURIComponent(sessionId)}/events`, {
        headers: H(clientId, { accept: 'text/event-stream' }),
        signal: ac.signal,
      });
      const dec = new TextDecoder();
      let buf = '';
      for await (const c of res.body) {
        buf += dec.decode(c, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          if (!data) continue;
          let ev;
          try { ev = JSON.parse(data); } catch { continue; }
          if (ev.type === 'turn_complete' || ev.type === 'turn_error') {
            const pid = ev.promptId ?? ev.data?.promptId;
            seen.set(pid, ev);
            for (const w of waiters.splice(0)) w();
          }
        }
      }
    } catch {}
  })();
  return {
    async done(promptId, ms = 60000) {
      const end = Date.now() + ms;
      while (!seen.has(promptId)) {
        if (Date.now() > end) throw new Error(`timeout waiting for ${promptId}`);
        await new Promise((r) => { waiters.push(r); setTimeout(r, 500); });
      }
      return seen.get(promptId);
    },
    isDone: (promptId) => seen.has(promptId),
    close: () => ac.abort(),
  };
}
async function prompt(sessionId, clientId, text) {
  const r = await call('POST', `/session/${encodeURIComponent(sessionId)}/prompt`, {
    clientId,
    body: { prompt: [{ type: 'text', text }] },
  });
  if (r.status !== 202) throw new Error(`prompt ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.promptId;
}
const pick = (b) =>
  b && typeof b === 'object'
    ? Object.fromEntries(
        ['code', 'error', 'route', 'sessionId', 'workspaceCwd', 'parentSessionId', 'sourceType', 'sourceId', 'attached', 'displayName', 'title']
          .filter((k) => b[k] !== undefined)
          .map((k) => [k, b[k]]),
      )
    : b;

// --- readiness ---
for (let i = 0; i < 120; i++) {
  const r = await call('GET', '/capabilities');
  if (r.status === 200) {
    step('capabilities', {
      sideTaskFeature: r.body.features?.includes('session_side_task'),
      workspaces: r.body.workspaces?.map((w) => ({ cwd: w.cwd, primary: w.primary, trusted: w.trusted })),
    });
    break;
  }
  await sleep(500);
}

const sideTask = (sid, clientId, name = 'Side task') =>
  call('POST', `/session/${encodeURIComponent(sid)}/side-task`, { clientId, body: { name } });
const list = (cwd, q) =>
  call('GET', `/workspace/${encodeURIComponent(cwd)}/sessions?${new URLSearchParams({ size: '50', ...q })}`);

// --- S1: secondary parent + context ---
const p = await call('POST', '/session', { body: { cwd: SECONDARY, sessionScope: 'thread' } });
step('S1 create secondary parent', { status: p.status, sessionId: p.body.sessionId, workspaceCwd: p.body.workspaceCwd });
const parent = p.body.sessionId;
const parentClient = p.body.clientId;
const pw = watch(parent, parentClient);
await sleep(300);
let pid = await prompt(parent, parentClient, 'Please remember the codeword ORCHID-7 for later.');
await pw.done(pid);
step('S1 parent context turn complete', { promptId: pid });

// --- S2: idle secondary side-task ---
const s2 = await sideTask(parent, parentClient, 'Idle side task');
step('S2 side-task on idle secondary parent', { status: s2.status, body: pick(s2.body) });
let child1;
if (s2.status === 201) {
  child1 = s2.body;
  const cw = watch(child1.sessionId, child1.clientId);
  await sleep(300);
  const cp = await prompt(child1.sessionId, child1.clientId, 'What is the codeword? CHILD-ONLY-MARKER');
  await cw.done(cp);
  cw.close();
  const req = modelLog().filter((l) => l.kind === 'main' && l.lastUser?.includes('CHILD-ONLY-MARKER')).at(-1);
  step('S2 child turn: model request seen', { markers: req?.markers, model: req?.model, reply: req?.reply });
}

// --- S3: busy parent ---
const holdPid = await prompt(parent, parentClient, 'HOLD-PARENT: run the long parent task');
for (let i = 0; i < 60; i++) {
  const h = await fetch(`${FAKE}/control/held`).then((r) => r.json());
  if (h.held > 0) break;
  await sleep(250);
}
step('S3 parent busy (held by fake model)', { parentTurnDone: pw.isDone(holdPid) });
const s3 = await sideTask(parent, parentClient, 'Busy side task');
step('S3 side-task while parent busy', { status: s3.status, body: pick(s3.body), parentTurnDoneAtCreate: pw.isDone(holdPid) });
let child2;
if (s3.status === 201) {
  child2 = s3.body;
  const cw = watch(child2.sessionId, child2.clientId);
  await sleep(300);
  const cp = await prompt(child2.sessionId, child2.clientId, 'What is the codeword while the parent is busy?');
  const ev = await cw.done(cp);
  cw.close();
  const req = modelLog().filter((l) => l.kind === 'main' && l.lastUser?.includes('while the parent is busy')).at(-1);
  step('S3 child completed while parent still busy', {
    childTurn: ev.type,
    parentTurnDoneWhenChildFinished: pw.isDone(holdPid),
    markers: req?.markers,
    childLastUserText: req?.lastUser,
    reply: req?.reply,
  });
}
await fetch(`${FAKE}/control/release`);
await pw.done(holdPid);
step('S3 parent released and completed', {});

// --- S4: parent history independence ---
pid = await prompt(parent, parentClient, 'PARENT-AFTER-MARKER: continue the parent conversation');
await pw.done(pid);
const preq = modelLog().filter((l) => l.kind === 'main' && l.lastUser?.includes('PARENT-AFTER-MARKER')).at(-1);
step('S4 parent next request markers', { markers: preq?.markers, nMessages: preq?.nMessages });

// --- S5: catalog isolation ---
const ls = await list(SECONDARY, { sourceType: 'side_task', sourceId: parent });
const lp = await list(PRIMARY, { sourceType: 'side_task', sourceId: parent });
step('S5 catalog: secondary filtered by parent', {
  status: ls.status,
  ids: ls.body.sessions?.map((s) => s.sessionId),
  sources: ls.body.sessions?.map((s) => `${s.sourceType}:${s.sourceId === parent ? 'parent' : s.sourceId}`),
});
step('S5 catalog: primary filtered by same parent', { status: lp.status, ids: lp.body.sessions?.map((s) => s.sessionId) });

// --- S6: primary control ---
const pp = await call('POST', '/session', { body: { cwd: PRIMARY, sessionScope: 'thread' } });
const ppw = watch(pp.body.sessionId, pp.body.clientId);
await sleep(300);
const ppid = await prompt(pp.body.sessionId, pp.body.clientId, 'PRIMARY-CONTEXT hello');
await ppw.done(ppid);
ppw.close();
const s6 = await sideTask(pp.body.sessionId, pp.body.clientId, 'Primary side task');
step('S6 primary control side-task', { status: s6.status, body: pick(s6.body) });
const lsec2 = await list(SECONDARY, { sourceType: 'side_task', sourceId: pp.body.sessionId });
step('S6 primary child not listed in secondary', { ids: lsec2.body.sessions?.map((s) => s.sessionId) });

// --- S6b: primary busy-parent control (pre-existing behaviour on both arms) ---
{
  const ppw2 = watch(pp.body.sessionId, pp.body.clientId);
  await sleep(300);
  const hp = await prompt(pp.body.sessionId, pp.body.clientId, 'HOLD-PARENT: primary long task');
  for (let i = 0; i < 60; i++) {
    const h = await fetch(`${FAKE}/control/held`).then((r) => r.json());
    if (h.held > 0) break;
    await sleep(250);
  }
  const s6b = await sideTask(pp.body.sessionId, pp.body.clientId, 'Primary busy side task');
  let childReq;
  if (s6b.status === 201) {
    const cw = watch(s6b.body.sessionId, s6b.body.clientId);
    await sleep(300);
    const cp = await prompt(s6b.body.sessionId, s6b.body.clientId, 'What is the codeword in primary? PRIMARY-BUSY');
    await cw.done(cp);
    cw.close();
    childReq = modelLog().filter((l) => l.kind === 'main' && l.lastUser?.includes('PRIMARY-BUSY')).at(-1);
  }
  step('S6b primary busy-parent side-task (control)', {
    status: s6b.status,
    parentTurnDoneWhenChildFinished: ppw2.isDone(hp),
    childLastUserText: childReq?.lastUser,
    markers: childReq?.markers,
  });
  await fetch(`${FAKE}/control/release`);
  await ppw2.done(hp);
  ppw2.close();
}

// --- S7: unknown owner ---
const s7 = await sideTask('00000000-0000-4000-8000-000000000000', parentClient);
step('S7 unknown owner', { status: s7.status, body: pick(s7.body) });

// --- S8: branch/fork stay primary/internal only on a secondary parent ---
const s8b = await call('POST', `/session/${encodeURIComponent(parent)}/branch`, { clientId: parentClient, body: {} });
const s8f = await call('POST', `/session/${encodeURIComponent(parent)}/fork`, { clientId: parentClient, body: {} });
step('S8 secondary branch stays restricted', { status: s8b.status, code: s8b.body.code });
step('S8 secondary fork stays restricted', { status: s8f.status, code: s8f.body.code });

pw.close();
results.ids = { parent, parentClient, child1: child1?.sessionId, child2: child2?.sessionId, primaryParent: pp.body.sessionId };
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log('WROTE', out);
process.exit(0);
