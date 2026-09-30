// VERIFICATION RIG ONLY: what can the owner see about the call they are asked to approve?
// The model writes content "batch-<name>" which never appears in the prompt. Needs `default` mode.
// usage: DB=<db> node s13-visibility.mjs <workspace> <storage>
import { api, ensureWorkspace, createSession, getAction, respond, waitPending, waitOp, waitTurn, readWs, Report, j } from './lib.mjs';
const [workspace = 'ws-f', storage = 'f'] = process.argv.slice(2);
const R = new Report('s13-visibility');
ensureWorkspace(workspace, `st-${storage}`);
const name = `vis-${Date.now().toString(36)}.txt`;
const c = await createSession('public', workspace, `D6_BATCH names=${name}`);
const S = c.session;
const p = await waitPending(S);
const A = p.action.id;
async function surfaces(label) {
  const views = {
    'public Action detail': (await getAction('public', S, A)).json,
    'WebShell Action detail': (await getAction('web', S, A)).json,
    'public Items': (await api('GET', `/v1/agents/sessions/${S}/items?limit=100`)).json,
    'public events': (await api('GET', `/v1/agents/sessions/${S}/events?limit=100`)).json,
    'WebShell transcript': (await api('POST', '/api/agent/web-shell/v1/transcript/query', { sessionId: S })).json,
    'public Turn detail': (await api('GET', `/v1/agents/sessions/${S}/turns/${p.action.turn_id}`)).json,
  };
  const rows = Object.entries(views).map(([k, v]) => {
    const s = JSON.stringify(v);
    return { surface: k, toolName: s.includes('write_file'), callId: s.includes(p.action.function_call_id), arguments: s.includes(`batch-${name}`) || s.includes('file_path') };
  });
  for (const r of rows) R.note(`${label}: ${r.surface}`, `tool name=${r.toolName} call id=${r.callId} arguments=${r.arguments}`);
  return rows;
}
const before = await surfaces('while pending');
R.check('the Action names the tool and the call (both surfaces)', before.slice(0, 2).every((r) => r.toolName && r.callId), j(before.slice(0, 2)));
R.check('EXPECTED (design 5.2/6.3, "arguments come from Items"): some client-visible surface shows the call\'s arguments before the answer', before.some((r) => r.arguments), `surfaces showing arguments: ${j(before.filter((r) => r.arguments).map((r) => r.surface))}`);
const r = await respond('public', S, p.action, 'allow', { key: 'vis-1' });
await waitOp(S, r.json.id);
const t = await waitTurn(S);
const after = await surfaces('after the Turn');
R.note('after the Turn completed', `turn=${t.status} file=${j(readWs(storage, `child/${name}`))}; surfaces showing arguments: ${j(after.filter((r) => r.arguments).map((r) => r.surface))}`);
R.done();
