// PR 13530 real-stack scenarios. usage: node scen.mjs <db> <scenario> [...]
// Every check prints a RESULT line and appends it to runs/results.tsv.
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { client, sql, sleep, modelLog, hproxyLog, result, short, RIG } from './lib.mjs';

const [, , db, scen, ...args] = process.argv;
const c = client(db);
const st = c.st;
const run = Date.now().toString(36).slice(-5);
const files2 = { type: 'hosted_profile', profile: 'hosted-workspace-files/2' };
const files1 = { type: 'hosted_profile', profile: 'hosted-workspace-files/1' };
const rowOf = (sid) => sql(db, `SELECT CONCAT_WS(' | ', agent_id, agent_revision, IFNULL(agent_definition_digest,'NULL'), approval_mode, IFNULL(tool_profile,'NULL'), status) FROM managed_agent_session WHERE tenant_id='rig' AND session_id='${sid}'`);
const actionsOf = (sid) => sql(db, `SELECT COUNT(*) FROM managed_agent_action WHERE tenant_id='rig' AND session_id='${sid}'`);
const reqs = (id) => modelLog((r) => r.id === id);
const saveJson = (name, o) => writeFileSync(path.join(RIG, 'runs', db, `${name}.json`), JSON.stringify(o, null, 2));
const stash = (k, v) => {
  const f = path.join(RIG, 'runs', db, 'ids.json');
  const o = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  if (v === undefined) return o[k];
  o[k] = v;
  writeFileSync(f, JSON.stringify(o, null, 2));
  return v;
};
function mountFiles() {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : out.push(path.relative(st.mount, p)); } };
  walk(st.mount);
  return out;
}

async function approveAll(sid, label) {
  for (let i = 0; i < 6; i++) {
    const a = await c.actions(sid);
    const pend = (a.json?.data ?? []).filter((x) => x.state === 'requested');
    if (!pend.length) return i;
    for (const x of pend) {
      const r = await c.respond(sid, x);
      console.log(`  ${label} approve ${x.tool_name} ${x.id} -> ${r.status} ${short(r.json)}`);
    }
    await sleep(1500);
  }
}

if (scen === 'plan1') {
  // Reviewer plan 1: files/2 + default + model-a + instructions; glob in the bound Workspace, write asks.
  const def = {
    model: { id: 'model-a' },
    instructions: `INSTR-R1-ALPHA-${run.toUpperCase()}: you are the PR 13530 rig agent, revision one.`,
    tools: [files2],
    permission_policy: { approval_mode: 'default' },
    metadata: { rig: 'pr13530' },
  };
  const a = await c.createAgent(def);
  result('plan1', 'createAgent 202', a.status === 202, short(a.json));
  const agentId = a.json.id ?? a.json.agent_id;
  stash('agentId', agentId); stash('rev1Digest', a.json.digest);
  const id = `p1${run}`;
  const s = await c.createSession({ agentId, prompt: `D8::globwrite::${id} list the markdown files then write a note` });
  result('plan1', 'createSession 202 with omitted revision', s.status === 202, short(s.json));
  const sid = s.json.id; stash('s1', sid);
  result('plan1', 'public session pins revision 1 + digest', s.json.agent_revision === '1' && s.json.agent_digest === a.json.digest, `rev=${s.json.agent_revision} digest=${s.json.agent_digest}`);
  const w = await c.waitTurn(sid, { stopOnAction: true, timeout: 180 });
  result('plan1', 'write_file waits for approval (Action requested)', /^ACTION .* write_file/.test(w), w);
  const r = reqs(id);
  result('plan1', 'model requests use model-a with key-A', r.length > 0 && r.every((x) => x.model === 'model-a' && x.key === 'key-A'), r.map((x) => `${x.model}/${x.key}`).join(','));
  result('plan1', 'files/2 advertises glob', r.length > 0 && r[0].glob, r[0]?.tools.join(','));
  const globRes = r.find((x) => x.toolMsgs.some((t) => t.includes('_glob=')));
  result('plan1', 'glob executed in bound Workspace', !!globRes && /QWEN\.md|notes-/.test(globRes.toolMsgs.join(' ')), globRes?.toolMsgs.join(' ').slice(0, 300));
  result('plan1', 'agent instructions on the wire', r.every((x) => x.instr.some((m) => m.startsWith(`INSTR-R1-ALPHA-${run.toUpperCase()}`))), r.map((x) => `${x.agentIdx}:${x.instr.join('/')}:${x.proj.join('/')}`).join(' ; '));
  const withProj = r.filter((x) => x.proj.length);
  result('plan1', 'order core < agent < project', withProj.length > 0 && withProj.every((x) => x.agentIdx > 100 && x.proj.every((p) => Number(p.split('@')[1]) > x.agentIdx)), withProj.map((x) => `agent@${x.agentIdx} ${x.proj.join(',')} sysLen=${x.sysLen}`).join(' ; '));
  const before = mountFiles().filter((f) => f.includes(`w-${id}`));
  result('plan1', 'no file before approval', before.length === 0, before.join(','));
  await approveAll(sid, 'plan1');
  const done = await c.waitTurn(sid, { timeout: 120 });
  result('plan1', 'Turn completes after approval', / COMPLETED /.test(done + ' '), done);
  const after = mountFiles().filter((f) => f.includes(`w-${id}`));
  result('plan1', 'approved write landed in Workspace mount', after.length === 1, after.join(','));
  result('plan1', 'DB row pins definition', true, rowOf(sid));
  saveJson('plan1', { agentId, def, session: s.json, rows: rowOf(sid), requests: r });
} else if (scen === 'plan2') {
  // Reviewer plan 2: revision 2 (model-b, new instructions, yolo) changes only new Sessions.
  const agentId = stash('agentId'); const s1 = stash('s1');
  const def2 = {
    model: { id: 'model-b' },
    instructions: `INSTR-R2-BETA-${run.toUpperCase()}: revision two speaks differently.`,
    tools: [files2],
    permission_policy: { approval_mode: 'yolo' },
  };
  const u = await c.updateAgent(agentId, def2);
  result('plan2', 'updateAgent stores revision 2', u.status === 202 && String(u.json.revision ?? u.json.agent_revision) === '2', short(u.json));
  stash('rev2Digest', u.json.digest);
  const oldId = `p2old${run}`;
  const so = await c.send(s1, `D8::write::${oldId} write again`);
  result('plan2', 'old Session accepts a new Turn', so.status === 202, short(so.json));
  const wo = await c.waitTurn(s1, { stopOnAction: true, timeout: 120 });
  result('plan2', 'old Session (rev 1) still asks before writing', /^ACTION .* write_file/.test(wo), wo);
  const ro = reqs(oldId);
  result('plan2', 'old Session still model-a + rev-1 instructions', ro.length > 0 && ro.every((x) => x.model === 'model-a' && x.instr.some((m) => m.startsWith('INSTR-R1-')) && !x.instr.some((m) => m.startsWith('INSTR-R2-'))), ro.map((x) => `${x.model}:${x.instr.join('/')}`).join(' ; '));
  await approveAll(s1, 'plan2-old');
  result('plan2', 'old Session Turn completes', / COMPLETED /.test((await c.waitTurn(s1)) + ' '), rowOf(s1));
  const newId = `p2new${run}`;
  const sn = await c.createSession({ agentId, prompt: `D8::write::${newId} write once` });
  result('plan2', 'new Session pins revision 2', sn.status === 202 && sn.json.agent_revision === '2' && sn.json.agent_digest === u.json.digest, short(sn.json));
  const s2 = sn.json.id; stash('s2', s2);
  const wn = await c.waitTurn(s2, { stopOnAction: true, timeout: 120 });
  result('plan2', 'new yolo Session completes without asking', / COMPLETED /.test(wn + ' '), wn);
  result('plan2', 'new Session has zero Action records', actionsOf(s2) === '0', `actions=${actionsOf(s2)}`);
  const rn = reqs(newId);
  result('plan2', 'new Session uses model-b/key-B + rev-2 instructions only', rn.length > 0 && rn.every((x) => x.model === 'model-b' && x.key === 'key-B' && x.instr.some((m) => m.startsWith('INSTR-R2-')) && !x.instr.some((m) => m.startsWith('INSTR-R1-'))), rn.map((x) => `${x.model}/${x.key}:${x.instr.join('/')}`).join(' ; '));
  result('plan2', 'new Session file written', mountFiles().some((f) => f.includes(`w-${newId}`)), mountFiles().filter((f) => f.includes(newId)).join(','));
  const pinId = `p2pin${run}`;
  const sp = await c.createSession({ agentId, revision: '1', prompt: `D8::text::${pinId} hello` });
  await c.waitTurn(sp.json.id);
  const rp = reqs(pinId);
  result('plan2', 'explicit revision 1 still selectable (model-a, rev-1 text)', sp.json.agent_revision === '1' && rp.length > 0 && rp.every((x) => x.model === 'model-a' && x.instr.some((m) => m.startsWith('INSTR-R1-'))), `${sp.json.agent_revision} ${rp.map((x) => x.model).join(',')}`);
  console.log('rows:\n ' + [s1, s2, sp.json.id].map(rowOf).join('\n '));
} else if (scen === 'text') {
  // node scen.mjs <db> text <sid> <id>: one Turn on an existing Session, print outcome + model calls
  const [sid, id] = args;
  const s = await c.send(sid, `D8::text::${id} hello`);
  const w = await c.waitTurn(sid, { timeout: Number(process.env.WAIT ?? 90) });
  console.log(JSON.stringify({ send: s.status, outcome: w, requests: reqs(id).map((x) => `${x.model}/${x.key}`) }));
} else if (scen === 'newtext') {
  // node scen.mjs <db> newtext <agentId|qwen-code> <id> [revision]: new Session with a text prompt
  const [agentId, id, revision] = args;
  const s = await c.createSession({ agentId, revision, prompt: `D8::text::${id} hello` });
  if (s.status !== 202) { console.log(JSON.stringify({ create: s.status, body: s.json })); process.exit(0); }
  const w = await c.waitTurn(s.json.id, { timeout: Number(process.env.WAIT ?? 90) });
  const ev = await c.events(s.json.id);
  const failed = (ev.json?.data ?? []).filter((e) => /fail/.test(e.type)).map((e) => ({ type: e.type, code: e.data?.code ?? e.data?.error?.code, msg: e.data?.message ?? e.data?.error?.message }));
  console.log(JSON.stringify({ create: s.status, sid: s.json.id, rev: s.json.agent_revision, digest: s.json.agent_digest, outcome: w, failedEvents: failed, requests: reqs(id).map((x) => `${x.model}/${x.key}`) }));
} else {
  console.error('unknown scenario'); process.exit(2);
}
