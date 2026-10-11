// Shell profiles from a definition: combination rules and child-Session inheritance.
import { client, sql, sleep, modelLog, result, short } from './lib.mjs';
const [, , db] = process.argv;
const c = client(db);
const run = Date.now().toString(36).slice(-5);
const sh = (p) => ({ type: 'hosted_profile', profile: p });
for (const [label, profile, mode, expect] of [
  ['shell/1 + yolo', 'hosted-workspace-shell/1', 'yolo', 409],
  ['shell/2 + yolo', 'hosted-workspace-shell/2', 'yolo', 409],
  ['shell/1 + {} (deployment default yolo)', 'hosted-workspace-shell/1', null, 409],
  ['shell/1 + default', 'hosted-workspace-shell/1', 'default', 202],
  ['shell/1 + auto-edit', 'hosted-workspace-shell/1', 'auto-edit', 202],
]) {
  const a = await c.createAgent({ model: {}, instructions: '', tools: [sh(profile)], permission_policy: mode ? { approval_mode: mode } : {} });
  const s = await c.createSession({ agentId: a.json.id });
  result('shell', label, s.status === expect, `${s.status} ${s.json?.error?.code ?? ''} ${s.json?.error?.field ?? ''}`);
}
// Child Session under a definition parent (doudouOUC P2): does the child inherit the pin and run?
const id = `ch${run}`;
const a = await c.createAgent({ model: { id: 'model-b' }, instructions: `INSTR-PARENT-${run.toUpperCase()}`, tools: [sh('hosted-workspace-shell/1')], permission_policy: { approval_mode: 'default' } });
const s = await c.createSession({ agentId: a.json.id, prompt: `D8::agent::${id} delegate` });
console.log('parent', s.status, s.json.id, s.json.agent_revision, s.json.agent_digest);
let w;
for (let i = 0; i < 60; i++) {
  w = await c.waitTurn(s.json.id, { stopOnAction: true, timeout: 60 });
  if (w.startsWith('ACTION')) {
    const acts = (await c.actions(s.json.id)).json.data.filter((x) => x.state === 'requested');
    for (const x of acts) { const r = await c.respond(s.json.id, x); console.log('  approve', x.tool_name, r.status); }
    await sleep(1500);
    continue;
  }
  break;
}
const first = modelLog((x) => x.id === id)[0];
console.log('parent tools:', first?.tools.join(','));
const kids = sql(db, `SELECT CONCAT_WS(' | ', session_id, agent_id, agent_revision, IFNULL(agent_definition_digest,'NULL'), approval_mode, IFNULL(tool_profile,'NULL'), status) FROM managed_agent_session WHERE parent_session_id='${s.json.id}'`);
const parentRow = sql(db, `SELECT CONCAT_WS(' | ', agent_id, agent_revision, IFNULL(agent_definition_digest,'NULL'), approval_mode, tool_profile) FROM managed_agent_session WHERE session_id='${s.json.id}'`);
const child = modelLog((x) => x.id === `${id}child`);
const kidTurns = kids ? sql(db, `SELECT GROUP_CONCAT(CONCAT(status,' ',IFNULL(error_code,'-'))) FROM managed_agent_turn WHERE session_id='${kids.split(' | ')[0]}'`) : '-';
result('child', 'definition parent spawns a child that inherits the pin', !!kids && kids.includes(a.json.digest ?? 'x'), `parent=${parentRow} || child=${kids || 'none'} turns=${kidTurns}`);
result('child', 'child model call uses the inherited model + instructions', child.length > 0 && child.every((x) => x.model === 'model-b' && x.instr.some((m) => m.startsWith('INSTR-PARENT-'))), child.map((x) => `${x.model}/${x.key}:${x.instr.join('/')}`).join(' ; ') || 'no child request');
result('child', 'parent Turn completes with the child result', / COMPLETED /.test(w + ' '), `${w} reply=${modelLog((x) => x.id === id).slice(-1)[0]?.reply}`);
