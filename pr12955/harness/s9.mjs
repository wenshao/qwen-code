// S9: real model through public REST and the WebShell adapter (G0 initial Turn).
import fs from 'node:fs';
import { R, api, sql, one, register, waitTurn, out, tapEntries } from './lib.mjs';

const res = {};
register('ws-docs', 'st-c');
register('ws-app', 'st-d');
fs.rmSync(`${R}/roots/c/child/hello.md`, { force: true });
fs.rmSync(`${R}/roots/d/child/todo.txt`, { force: true });
const prompt1 =
  'In the current directory, create hello.md containing a two-line haiku about shared Workspaces. ' +
  "Then use the edit tool to replace the word 'shared' with 'durable'. Finally read hello.md and reply with its final content.";
const prompt2 =
  'Create todo.txt in the current directory with three short numbered tasks for reviewing a pull request, ' +
  'then read it back and summarize it in one sentence.';
const web = await api('POST', '/api/agent/web-shell/v1/sessions/create', {
  agentId: 'qwen-code', idempotencyKey: 'demo-web', title: 'G0 haiku (WebShell adapter)',
  input: [{ type: 'input_text', text: prompt1 }], workspace: { workspaceId: 'ws-docs', cwdRelative: 'child' },
}, { key: 'demo-web' });
const rest = await api('POST', '/v1/agents/sessions', {
  agent_id: 'qwen-code', title: 'G0 todo (public REST)',
  input: [{ type: 'input_text', text: prompt2 }], workspace: { workspace_id: 'ws-app', cwd_relative: 'child' },
}, { key: 'demo-rest' });
res.created = { web: [web.status, web.json.sessionId], rest: [rest.status, rest.json.id] };
for (const [name, id, dir, file] of [['web', web.json.sessionId, 'c', 'hello.md'], ['rest', rest.json.id, 'd', 'todo.txt']]) {
  const w = await waitTurn(id, { timeoutMs: 240_000 });
  const tools = { byStatus: sql(`SELECT execution_status, COUNT(*) FROM qwen_tool_execution WHERE harness_session_id='${id}' GROUP BY execution_status`), namesInJournal: ((m) => ['write_file', 'edit', 'read_file'].map((n) => `${n}:${m.split(`"name":"${n}"`).length - 1}`))(sql(`SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='${id}' AND kind='managed-message'`).flat().join("\n")) };
  const items = await api('GET', `/v1/agents/sessions/${id}/items`);
  res[name] = {
    session: id, turn: w.rows[0]?.slice(1, 3), ms: w.ms,
    file: fs.existsSync(`${R}/roots/${dir}/child/${file}`) ? fs.readFileSync(`${R}/roots/${dir}/child/${file}`, 'utf8') : null,
    decoy: fs.readdirSync(`${R}/decoy`).filter((n) => !n.startsWith('.')),
    toolExecutions: tools,
    journalWorkspace: one(`SELECT workspace_id FROM qwen_managed_session_journal_head WHERE session_id='${id}'`),
    publicItems: (items.json.data ?? []).map((i) => ({ role: i.role, type: i.type, text: (i.content ?? []).map((c) => c.text).join('').slice(0, 300) })),
  };
}
res.wire = tapEntries().filter((e) => e.method === 'POST' && e.path === '/session').map((e) => ({ sessionId: e.body?.sessionId, toolProfile: e.body?.toolProfile, storeWorkspaceId: e.body?.managedSessionStore?.workspaceId }));
console.log(JSON.stringify(res, null, 1));
out('s9-real.json', res);
