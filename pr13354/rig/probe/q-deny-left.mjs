import * as L from './lib.mjs';
for (const s of await L.sql("SELECT session_id FROM managed_agent_session WHERE status='ACTIVE' AND approval_mode='default'")) {
  const r = await L.api('GET', `/v1/agents/sessions/${s.session_id}/actions`);
  for (const a of (r.json.data ?? []).filter((x) => x.state === 'requested')) {
    const x = await L.api('POST', `/v1/agents/sessions/${s.session_id}/actions/${a.id}/responses`, { kind: 'permission', option_id: 'deny', input_revision: a.input_revision, policy_revision: a.policy_revision }, { key: L.uid('deny') });
    console.log('denied', s.session_id, a.id, x.status);
  }
}
await L.closeDb();
