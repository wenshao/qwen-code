import * as L from './lib.mjs';
import fs from 'node:fs';
const DB = 'rig1';
L.openLog('s0-smoke');
const exists = L.sql(DB, "SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='ws-a'")[0][0];
if (exists === '0') {
  L.seedRegistry(DB, 'ws-a', 'st-a');
  L.seedRegistry(DB, 'ws-b', 'st-b');
}
const sid = await L.createWorkspaceSession(18831, 'ws-a');
L.say('spring', `created Workspace Session ${sid} (ws-a/child)`);
L.say('row', L.sql(DB, `SELECT session_id, workspace_id, workspace_storage_id, cwd_relative FROM managed_agent_session WHERE session_id='${sid}'`));
const h = await new L.Harness({ name: 'smoke', brokerUrl: 'http://127.0.0.1:19831', realModel: process.argv[2] ?? 'qwen3.8-max' }).start();
fs.writeFileSync(`${h.root}/notes.txt`, 'DECOY');
const s = new L.HSession(h, sid, L.storeConnection(h, 'ws-a', 18831));
L.say('create', (await s.create()).status);
const r = await s.prompt(
  'Use your file tools: create notes.txt containing exactly "hello from A", then read it back, then use edit to change "hello" to "goodbye". Finally reply with the final file content.',
);
L.say('turn', L.summarizeTurn(r));
for (const t of L.toolTrace(r.events)) L.say('tool', t);
L.say('text', L.assistantText(r.events).slice(0, 300));
L.say('fs', `roots/a/child/notes.txt=${JSON.stringify(fs.readFileSync(`${L.RIG}/roots/a/child/notes.txt`, 'utf8'))} decoy=${fs.readFileSync(`${h.root}/notes.txt`, 'utf8')}`);
L.say('holders', L.holders(DB));
L.say('launches', L.launches(DB).length);
await h.stop();
