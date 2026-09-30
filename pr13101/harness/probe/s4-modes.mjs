// VERIFICATION RIG ONLY: a Workspace file Turn under a mode that asks nothing for the file profile.
// usage: DB=<db> node s4-modes.mjs <auto-edit|yolo> <workspace> <storage>
import { api, one, ensureWorkspace, createSession, listActions, waitTurn, sessionRow, readWs, executions, finalText, modelCalls, Report, j } from './lib.mjs';
const [mode = 'auto-edit', workspace = 'ws-a', storage = 'a'] = process.argv.slice(2);
const R = new Report(`s4-mode-${mode}`);
ensureWorkspace(workspace, `st-${storage}`);
for (const surface of ['public', 'web']) {
  const f = `mode-${mode}-${surface}-${Date.now().toString(36)}.txt`;
  const before = modelCalls();
  const c = await createSession(surface, workspace, `D6_FILES name=${f}`);
  const S = c.session;
  const t = await waitTurn(S, { timeoutMs: 60_000 });
  R.check(`[${surface}] write -> edit -> read complete without any approval`, c.status === 202 && t.status === 'COMPLETED' && readWs(storage, `child/${f}`) === 'after' && executions(S) === 3 && modelCalls() - before === 4, `turn=${t.status} ${t.error ?? ''} after ${t.ms} ms file=${j(readWs(storage, `child/${f}`))} executions=${executions(S)} modelCalls=${modelCalls() - before}`);
  R.check(`[${surface}] no Action was ever recorded; the Session is pinned to ${mode}`, one(`SELECT COUNT(*) FROM managed_agent_action WHERE session_id='${S}'`) === '0' && sessionRow(S)[1] === mode, `actions=${one(`SELECT COUNT(*) FROM managed_agent_action WHERE session_id='${S}'`)} approval_mode=${sessionRow(S)[1]}`);
  const l = await listActions(surface, S);
  R.check(`[${surface}] Action list answers 200 with no entries`, l.status === 200 && l.json.data?.length === 0, `HTTP ${l.status} ${j(l.json)}`);
  const pub = await api('GET', `/v1/agents/sessions/${S}`);
  const web = await api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: S });
  const want = mode !== 'yolo';
  R.check(`[${surface}] capabilities.actions is ${want} on both surfaces`, pub.json.capabilities?.actions === want && web.json.capabilities?.actions === want, `public=${pub.json.capabilities?.actions} web=${web.json.capabilities?.actions}`);
}
R.done();
