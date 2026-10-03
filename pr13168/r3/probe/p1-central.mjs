// VERIFICATION RIG ONLY (PR #13168 R2) P1: central claim on the real stack.
// One Workspace, Session cwd services/api with QWEN.md + AGENTS.md; the Workspace ROOT also has a
// QWEN.md that must NOT be loaded (no ancestor traversal). Three turns: tool, plain, tool. Then the
// Session is detached and loaded on a second Harness (cold attachment): one more tool turn.
// Evidence: system instruction of every model request, the Harness->Broker ledger (control kinds),
// qwen_tool_execution rows, Harness stderr.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { startGateProxy, ledgerFrom, ctxOps, markersIn, sysText } from './lib2.mjs';

const PROFILE = process.env.PROFILE ?? 'hosted-workspace-files/1';
const st = process.env.ST ?? 'a';
const ws = `ws-${st}`;
const name = `p1-central-${L.ARM}-${PROFILE.replace(/.*\//, 'v')}-${st}`;
L.openLog(name);
const root = `${L.ROOTS}/${st}`;
const dir = `${root}/services/api`;
fs.mkdirSync(`${dir}/src`, { recursive: true });
fs.writeFileSync(`${root}/QWEN.md`, 'ROOT-LEVEL-QWEN-MARKER (ancestor file, must not load)\n');
fs.writeFileSync(`${dir}/QWEN.md`, '  \nR2-QWEN-MARKER: project rule from services/api/QWEN.md\n\n');
fs.writeFileSync(`${dir}/AGENTS.md`, 'R2-AGENTS-MARKER: agent note from services/api/AGENTS.md\n');
fs.writeFileSync(`${dir}/proof.txt`, 'proof-content-r2\n');
fs.writeFileSync(`${dir}/src/a.md`, 'alpha\n');
L.seedRegistry(ws, `st-${st}`);
const MARKERS = ['R2-QWEN-MARKER', 'R2-AGENTS-MARKER', 'ROOT-LEVEL-QWEN-MARKER'];
const tool = PROFILE.endsWith('/2') ? ['glob', { pattern: '**/*.md' }] : ['read_file', { file_path: 'proof.txt' }];
const model = await L.startModel({
  t: ({ round }) => (round === 0 ? { calls: [tool] } : { text: 'TOOL_TURN_DONE' }),
});
const proxy = await startGateProxy();
const realRoot = fs.realpathSync(root);
const out = { arm: L.ARM, profile: PROFILE, requests: [], turns: [] };
const execRows = () => Number(L.one(`SELECT COUNT(*) FROM qwen_tool_execution`) ?? 'NaN');
let A, B;
try {
  A = await new L.Harness({ name: `p1a-${L.ARM}-${st}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
  const id = await L.createWorkspaceSession(ws, 'services/api');
  const sa = new L.HSession(A, id, L.storeConnection(A, ws));
  const c = await sa.create({ toolProfile: PROFILE });
  L.say('create', `${PROFILE} -> ${c.status} ${c.status !== 200 ? JSON.stringify(c.json).slice(0, 200) : ''}`);
  const rows0 = execRows();
  const turns = [
    ['T1 tool', '[[S:t]] use the tool'],
    ['T2 plain', '[[S:plain]] just answer'],
    ['T3 tool', '[[S:t]] use the tool again'],
  ];
  for (const [label, text] of turns) {
    const n = model.requests.length;
    const t0 = Date.now();
    const r = await sa.prompt(text);
    const reqs = model.requests.slice(n);
    const per = reqs.map((q, i) => ({ i, round: q.round, tools: q.tools, markers: markersIn(q, MARKERS), hostPath: sysText(q).includes(realRoot) }));
    out.turns.push({ label, summary: L.summarizeTurn(r), requests: per, broker: ledgerFrom(proxy.ledger, t0), ctxOps: ctxOps(proxy.ledger, t0).length });
    L.say(label, L.summarizeTurn(r));
    for (const p of per) L.say(`${label} req#${p.i}`, `round=${p.round} tools=${JSON.stringify(p.tools)} markers=${JSON.stringify(p.markers)} hostPathInSystem=${p.hostPath}`);
    L.say(`${label} broker`, ledgerFrom(proxy.ledger, t0).join(' | '));
  }
  const rows1 = execRows();
  L.say('qwen_tool_execution rows', `before=${rows0} after=${rows1} (model tool calls in A: 2)`);
  const ctxSection = sysText(model.requests.at(-1));
  const at = ctxSection.indexOf('--- Context from: QWEN.md ---');
  L.say('assembled section (A, last request)', at >= 0 ? JSON.stringify(ctxSection.slice(at, at + 260)) : '<absent>');
  out.assembled = at >= 0 ? ctxSection.slice(at, at + 400) : null;
  const errA = A.log().split('\n').filter((l) => /Workspace context read failed/.test(l));
  L.say('harness A stderr context failures', errA.length ? errA.join(' || ') : '<none>');

  // Cold attachment on a second Harness.
  const det = await sa.detach();
  L.say('detach A', det.status);
  B = await new L.Harness({ name: `p1b-${L.ARM}-${st}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
  const sb = new L.HSession(B, id, L.storeConnection(B, ws));
  const ld = await sb.load();
  L.say('load on B', `${ld.status} ${ld.status !== 200 ? JSON.stringify(ld.json).slice(0, 300) : ''}`);
  {
    const n = model.requests.length;
    const t0 = Date.now();
    const r = await sb.prompt('[[S:t]] cold attachment tool turn');
    const reqs = model.requests.slice(n);
    const per = reqs.map((q, i) => ({ i, round: q.round, markers: markersIn(q, MARKERS) }));
    out.turns.push({ label: 'B1 tool (cold)', summary: L.summarizeTurn(r), requests: per, broker: ledgerFrom(proxy.ledger, t0), ctxOps: ctxOps(proxy.ledger, t0).length });
    L.say('B1 tool (cold)', L.summarizeTurn(r));
    for (const p of per) L.say(`B1 req#${p.i}`, `round=${p.round} markers=${JSON.stringify(p.markers)}`);
    L.say('B1 broker', ledgerFrom(proxy.ledger, t0).join(' | '));
  }
  out.rows = { before: rows0, afterA: rows1, afterB: execRows() };
  L.say('qwen_tool_execution rows after B', out.rows.afterB);
  out.ctxOpsTotal = ctxOps(proxy.ledger).length;
  out.holders = L.holders();
  L.say('lease holders', JSON.stringify(out.holders));

  const T = out.turns;
  const has = (t, i, m) => T[t].requests[i]?.markers.includes(m);
  if (L.ARM === 'base') {
    L.check('base: no request carries Session context', T.every((t) => t.requests.every((q) => !q.markers.includes('R2-QWEN-MARKER'))));
    L.check('base: no workspace-context control', out.ctxOpsTotal === 0, String(out.ctxOpsTotal));
  } else {
    L.check('T1 request #1 has no context (first request never waits)', T[0].requests[0] && !has(0, 0, 'R2-QWEN-MARKER'));
    L.check('T1 request #2 carries QWEN.md + AGENTS.md', has(0, 1, 'R2-QWEN-MARKER') && has(0, 1, 'R2-AGENTS-MARKER'));
    L.check('T2 first request carries context (latched)', has(1, 0, 'R2-QWEN-MARKER') && has(1, 0, 'R2-AGENTS-MARKER'));
    L.check('T3 requests carry context', T[2].requests.every((q) => q.markers.includes('R2-QWEN-MARKER')));
    L.check('Workspace-root QWEN.md never loaded (no ancestor traversal)', T.every((t) => t.requests.every((q) => !q.markers.includes('ROOT-LEVEL-QWEN-MARKER'))));
    L.check('exactly one workspace-context control on attachment A', T[0].ctxOps === 1 && T[1].ctxOps === 0 && T[2].ctxOps === 0, JSON.stringify(T.map((t) => t.ctxOps)));
    const b1 = T[0].broker;
    const iCtx = b1.findIndex((x) => x.includes('{workspace-context}'));
    const iPrep = b1.findIndex((x) => /executions:prepare|\/executions\b|prepare/.test(x) && !x.includes('{'));
    L.say('T1 order', `workspace-context@${iCtx} first-prepare@${iPrep}`);
    L.check('context read happens before the first tool dispatch', iCtx >= 0 && (iPrep < 0 || iCtx < iPrep), `${iCtx} vs ${iPrep}`);
    L.check('context read is not a tool execution (rows == model tool calls)', out.rows.afterA - out.rows.before === 2, `${out.rows.before}->${out.rows.afterA}`);
    L.check('cold attachment B: first request without, second with context', T[3].requests[0] && !T[3].requests[0].markers.includes('R2-QWEN-MARKER') && T[3].requests[1]?.markers.includes('R2-QWEN-MARKER'));
    L.check('cold attachment B refetches once', T[3].ctxOps === 1, String(T[3].ctxOps));
    L.check('no host path in system instruction', T.every((t) => t.requests.every((q) => !q.hostPath)));
    L.check('Harness stderr has no context failure', errA.length === 0);
  }
  fs.writeFileSync(`${L.RIG}/out/${L.DB}/${name}.json`, JSON.stringify(out, null, 1));
} finally {
  await A?.stop();
  await B?.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
