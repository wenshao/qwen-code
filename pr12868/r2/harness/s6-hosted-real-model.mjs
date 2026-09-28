// PR #12868: the separately gated Hosted Workspace tool loop (#12831, raw
// four-field path) with a REAL model on the PR build: packaged Harness ->
// Spring Broker (MySQL) -> boot-v2 worker. Three turns on one Session.
// usage: node s6-hosted-real-model.mjs <storage letter>
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
import * as H from './hosted.mjs';

const letter = process.argv[2] ?? 'n';
const MODEL = process.env.REAL_MODEL ?? 'qwen3.8-max';
L.openLog(`s6-hosted-real-model-${L.ARM}-${letter}`);
const h = await new H.Harness({ name: `real-${L.ARM}-${letter}`, brokerUrl: L.BROKER_URL, realModel: MODEL }).start();
L.say('setup', `arm=${L.ARM} model=${MODEL} harness=${h.baseUrl} broker=${L.BROKER_URL}`);
const dir = fs.realpathSync(path.join(L.ROOTS, letter, 'child'));
fs.writeFileSync(path.join(dir, 'notes.txt'), 'release codename: HERON\nowner: platform-team\nstatus: draft\n');
const ws = `ws-${letter}-${Date.now()}`;
L.seedRegistry(ws, `st-${letter}`);
const s = new H.HSession(h, await L.createSession(ws), H.storeConnection(h, ws, L.HTTP_PORT));
const created = await s.create();
if (created.status !== 200) throw new Error(`create ${created.status} ${JSON.stringify(created.json)}`);
const show = (tag, r) => {
  L.say(tag, H.summarizeTurn(r));
  for (const t of H.toolTrace(r.events ?? [])) L.say(`${tag} tool`, t.replace(dir, '<ws>'));
  L.say(`${tag} text`, H.assistantText(r.events ?? []).replace(/\s+/g, ' ').slice(0, 300));
};
const turnWire = (mark) => L.wire(L.ledger(mark)).join(', ');
try {
  let mark = L.ledgerMark();
  let r = await s.prompt('Read notes.txt in the workspace. Then create summary.txt containing exactly one line: the codename you read, in lower case. Then tell me the codename.');
  show('T1', r);
  L.say('T1 wire', turnWire(mark));
  L.say('T1 fs', `summary.txt=${JSON.stringify(fs.existsSync(path.join(dir, 'summary.txt')) ? fs.readFileSync(path.join(dir, 'summary.txt'), 'utf8') : null)}`);
  L.say('T1 holders', JSON.stringify(L.holders().filter(([, holder]) => holder !== '<none>' && L.runtimeSession(holder)?.harness === s.sessionId)));
  mark = L.ledgerMark();
  r = await s.prompt('In notes.txt change the status from draft to released using the edit tool, then read the file back and show me its final content.');
  show('T2', r);
  L.say('T2 wire', turnWire(mark));
  L.say('T2 fs', `notes.txt=${JSON.stringify(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'))}`);
  mark = L.ledgerMark();
  r = await s.prompt('Without using any tool: which two files did you touch in this conversation?');
  show('T3', r);
  L.say('T3 wire', turnWire(mark) || '<no Broker -> worker request>');
  const rows = L.sql(`SELECT session_state, turn_kind, COUNT(*) FROM qwen_runtime_session WHERE harness_session_id='${s.sessionId}' GROUP BY 1,2`);
  L.say('sessions', JSON.stringify(rows));
  const ex = L.sql(`SELECT execution_state, IFNULL(execution_status,'-'), COUNT(*) FROM qwen_tool_execution WHERE harness_session_id='${s.sessionId}' GROUP BY 1,2`);
  L.say('executions', JSON.stringify(ex));
  const keys = L.sql(`SELECT reference_json FROM qwen_tool_execution WHERE harness_session_id='${s.sessionId}'`).map(([j]) => Object.keys(JSON.parse(j)).sort().join(','));
  L.say('reference shapes', JSON.stringify([...new Set(keys)]));
  L.say('holders', JSON.stringify(L.holders().filter(([, holder]) => holder !== '<none>' && L.runtimeSession(holder)?.harness === s.sessionId)));
  L.say('status', JSON.stringify(await s.status()));
} catch (e) {
  L.say('ERROR', String(e?.stack ?? e));
} finally {
  L.say('harness log tail', h.log().split('\n').filter((l) => /error|Error|fail|blocked/i.test(l)).slice(-6));
  await h.stop();
}
