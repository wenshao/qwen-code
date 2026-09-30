// VERIFICATION RIG ONLY: the approval round trip with a real model (no scripted tool calls). Needs `default` mode and a
// Harness started with a real OpenAI-compatible provider. usage: DB=<db> node s14-real-model.mjs <workspace> <storage>
import { api, one, sql, ensureWorkspace, createSession, listActions, getAction, respond, waitPending, waitOp, waitTurn, readWs, executions, Report, sleep, j } from './lib.mjs';
const [workspace = 'ws-a', storage = 'a'] = process.argv.slice(2);
const R = new Report('s14-real-model');
ensureWorkspace(workspace, `st-${storage}`);
const tag = Date.now().toString(36);
async function text(S) {
  const ev = await api('GET', `/v1/agents/sessions/${S}/events?limit=200`);
  return (ev.json.data ?? []).filter((e) => e.type === 'item.output_text.delta').map((e) => e.data?.delta ?? e.data?.text ?? '').join('').replace(/\s+/g, ' ').trim();
}
async function run(label, decision, surface) {
  R.say(`## ${label}: the owner answers ${decision} through ${surface}`);
  const f = `real-${decision}-${tag}.txt`;
  const prompt = `Use the write_file tool to create a file named ${f} in the current directory whose content is exactly: approved by the owner. Do not use any other tool first. When you are done, or if you cannot do it, reply with one short sentence.`;
  const t0 = Date.now();
  const c = await createSession(surface, workspace, prompt);
  const S = c.session;
  const seen = [];
  let answered = 0;
  let last = Date.now();
  for (;;) {
    const l = await listActions(surface, S);
    const fresh = (l.json.data ?? []).filter((x) => !seen.includes(x.actionId ?? x.id));
    if (fresh.length) {
      const action = fresh[0];
      const id = action.actionId ?? action.id;
      seen.push(id);
      const tool = action.toolName ?? action.tool_name;
      const asked = Date.now() - last;
      const r = await respond(surface, S, action, decision, { key: `real-${id.slice(-8)}` });
      const d = await waitOp(S, r.json.operationId ?? r.json.id);
      answered++;
      last = Date.now();
      R.check(`the real model's ${tool} call #${answered} waits for the owner; ${decision} -> completed/decided`, r.status === 202 && d.json.status === 'completed' && d.json.action_resolution?.outcome === 'decided', `asked ${(asked / 1000).toFixed(1)} s after ${answered === 1 ? 'creation' : 'the previous answer'}; operation ${d.json.status} in ${d.ms} ms`);
      if (answered >= 6) break;
      continue;
    }
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(one(`SELECT status FROM managed_agent_turn WHERE session_id='${S}'`))) break;
    if (Date.now() - last > 120_000) break;
    await sleep(250);
  }
  const t = await waitTurn(S, { timeoutMs: 120_000 });
  const content = readWs(storage, `child/${f}`);
  if (decision === 'allow') R.check('Turn completes and the file holds the requested content', t.status === 'COMPLETED' && (content ?? '').trim() === 'approved by the owner' && executions(S) >= 1, `turn=${t.status} after ${((Date.now() - t0) / 1000).toFixed(1)} s, file=${j(content)}, tool executions=${executions(S)}, approvals asked=${answered}`);
  else R.check('Turn completes, nothing was written', t.status === 'COMPLETED' && content === null && executions(S) === 0, `turn=${t.status} after ${((Date.now() - t0) / 1000).toFixed(1)} s, file=${content}, tool executions=${executions(S)}, approvals asked (all denied)=${answered}`);
  R.note('model\'s final text', (await text(S)).slice(0, 300));
}
await run('a', 'allow', 'public');
await run('b', 'deny', 'web');
R.done();
