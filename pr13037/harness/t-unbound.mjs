// capability on a Session without a Workspace, and what a late result leaves behind in the event stream
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog('t-unbound');
const created = await L.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'hello, no tools please' }] }, { key: `unbound-${Date.now()}` });
const id = created.json.id;
await L.waitTurn(id);
const get = await L.api('GET', `/v1/agents/sessions/${id}`);
const ws = await L.api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: id });
const list = await L.api('GET', `/v1/agents/sessions/${id}/artifacts`);
L.say('Session without a Workspace', { create: created.status, turn: L.turnRows(id)[0]?.[1], publicCapability: get.json.capabilities?.artifacts, webShellCapability: ws.json.capabilities?.artifacts ?? ws.json.session?.capabilities?.artifacts, artifactList: `${list.status} ${list.json.error?.code ?? ''}`.trim() });
const s1 = JSON.parse(fs.readFileSync(`${L.R}/out/s1a.json`, 'utf8'));
let late = 0, total = 0;
for (const row of s1.filter((r) => r.turn === 'COMPLETED')) {
  const ev = await L.events(row.session);
  const done = ev.findIndex((e) => e.type === 'turn.completed');
  const results = ev.map((e, i) => [e, i]).filter(([e]) => e.type === 'item.tool_result.updated');
  total += results.length;
  const lateOnes = results.filter(([, i]) => i > done);
  late += lateOnes.length;
  const turns = L.turnRows(row.session);
  const after = ev.slice(done + 1).map((e) => e.type);
  if (lateOnes.length) L.say(`late result in ${row.case}`, { turnsInSession: turns.length, turnStatus: turns[0][1], eventsAfterTurnCompleted: after, resultTurnIdEqualsTheTurn: lateOnes.every(([e]) => e.turn_id === turns[0][0]), terminalEvents: ev.filter((e) => e.terminal).length });
}
L.say('results published after turn.completed', `${late} of ${total}`);
