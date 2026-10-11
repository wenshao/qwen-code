// "Before" evidence on main: a stored definition cannot drive a Session.
import { client, short, result, sql } from './lib.mjs';
const [, , db, arm] = process.argv;
const c = client(db);
const f2 = { type: 'hosted_profile', profile: 'hosted-workspace-files/2' };
const shapes = [
  ['empty model/instructions, files/1', { model: {}, instructions: '', tools: [{ type: 'hosted_profile', profile: 'hosted-workspace-files/1' }], permission_policy: {} }],
  ['model + instructions + files/2 + default', { model: { id: 'model-a' }, instructions: 'INSTR-BEFORE', tools: [f2], permission_policy: { approval_mode: 'default' } }],
];
for (const [label, def] of shapes) {
  const a = await c.createAgent(def);
  const bound = await c.createSession({ agentId: a.json.id, prompt: 'D8::text::before hi' });
  const unbound = await c.createSession({ agentId: a.json.id, bound: false });
  const pinned = await c.createSession({ agentId: a.json.id, revision: '1', bound: false });
  console.log(JSON.stringify({ arm, label, createAgent: a.status, rev: a.json.revision, bound: [bound.status, bound.json?.error?.code ?? bound.json?.agent_revision], unbound: [unbound.status, unbound.json?.error?.code ?? unbound.json?.agent_revision], explicitRev1: [pinned.status, pinned.json?.error?.code ?? pinned.json?.agent_revision] }));
  result(`before-${arm}`, label, true, `bound ${bound.status} ${short(bound.json?.error ?? bound.json?.agent_revision)} | unbound ${unbound.status} ${short(unbound.json?.error ?? unbound.json?.agent_revision)} | rev1 ${pinned.status} ${short(pinned.json?.error ?? pinned.json?.agent_revision)}`);
}
