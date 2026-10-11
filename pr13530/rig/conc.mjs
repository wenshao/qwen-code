// Replay + concurrency on real MySQL. usage: node conc.mjs <db> replay|race [nCreate] [nUpdate] [bound]
import { client, sql, result, short } from './lib.mjs';
import { randomUUID } from 'node:crypto';

const [, , db, what, nC = '40', nU = '10', boundArg = 'unbound'] = process.argv;
const c = client(db);
const run = Date.now().toString(36).slice(-5);
const f1 = { type: 'hosted_profile', profile: 'hosted-workspace-files/1' };
const def = (i, bound) => ({ model: {}, instructions: `INSTR-RACE-${run}-${i}`, tools: bound ? [f1] : [], permission_policy: { approval_mode: 'default' } });

if (what === 'replay') {
  for (const bound of [false, true]) {
    const label = bound ? 'bound' : 'unbound';
    const a = await c.createAgent(def(0, bound));
    const key = randomUUID();
    const first = await c.createSession({ agentId: a.json.id, bound, key });
    const u = await c.updateAgent(a.json.id, def(1, bound));
    const replay = await c.createSession({ agentId: a.json.id, bound, key });
    const fresh = await c.createSession({ agentId: a.json.id, bound });
    result('replay', `${label}: replay after revision 2 returns the original Session pinned to revision 1`,
      first.status === 202 && u.json.revision === '2' && replay.status === 202 && replay.json.id === first.json.id && replay.json.agent_revision === '1' && replay.json.agent_digest === first.json.agent_digest,
      `first=${first.json.id?.slice(0, 8)}@${first.json.agent_revision} update=${u.json.revision} replay=${replay.status} ${replay.json.id?.slice(0, 8)}@${replay.json.agent_revision} replayed=${replay.json.replayed ?? '-'}`);
    result('replay', `${label}: a fresh key resolves revision 2`, fresh.status === 202 && fresh.json.agent_revision === '2' && fresh.json.agent_digest === u.json.digest, `${fresh.status} ${fresh.json.agent_revision}`);
  }
} else if (what === 'race') {
  const bound = boundArg === 'bound';
  const a = await c.createAgent(def(0, bound));
  const agentId = a.json.id;
  const t0 = Date.now();
  const jobs = [];
  for (let i = 0; i < Number(nC); i++) jobs.push(c.createSession({ agentId, bound }).then((r) => ({ kind: 'create', ...r, ms: Date.now() - t0 })));
  for (let i = 1; i <= Number(nU); i++) jobs.push(c.updateAgent(agentId, def(i, bound)).then((r) => ({ kind: 'update', ...r, ms: Date.now() - t0 })));
  const out = await Promise.all(jobs);
  const tally = {};
  for (const r of out) { const k = `${r.kind} ${r.status} ${r.json?.error?.code ?? ''}`.trim(); tally[k] = (tally[k] ?? 0) + 1; }
  const revs = new Map(sql(db, `SELECT revision, digest FROM managed_agent_definition WHERE tenant_id='rig' AND agent_id='${agentId}'`).split('\n').filter(Boolean).map((l) => l.split('\t')));
  const rows = sql(db, `SELECT agent_revision, agent_definition_digest FROM managed_agent_session WHERE tenant_id='rig' AND agent_id='${agentId}'`).split('\n').filter(Boolean).map((l) => l.split('\t'));
  const mismatched = rows.filter(([r, d]) => revs.get(r) !== d);
  const spread = {};
  for (const [r] of rows) spread[r] = (spread[r] ?? 0) + 1;
  const five = out.filter((r) => r.status >= 500).length;
  const maxMs = Math.max(...out.map((r) => r.ms));
  result('race', `${bound ? 'bound' : 'unbound'} ${nC} creates (omitted revision) + ${nU} updates`, five === 0 && mismatched.length === 0 && rows.length === out.filter((r) => r.kind === 'create' && r.status === 202).length,
    `tally=${JSON.stringify(tally)} sessions=${rows.length} pinsMismatched=${mismatched.length} revisionsStored=${revs.size} pinnedSpread=${JSON.stringify(spread)} wall=${maxMs}ms ${five ? short(out.find((r) => r.status >= 500).json) : ''}`);
}
