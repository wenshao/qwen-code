// s0: one public Workspace Session, one Hosted Shell command, print what each layer recorded.
// usage: WS=<n> CMD='...' node s0-smoke.mjs
import * as L from './lib.mjs';

const n = process.env.WS ?? '01';
const ws = `ws-${n}`;
const cmd = process.env.CMD ?? 'echo hello-o3; echo warn-o3 >&2';
try {
  L.register(ws, `st-s${n}`);
} catch (e) {
  L.say('register', String(e.message).slice(0, 120));
}
const t0 = Date.now();
const session = await L.createShellSession(ws, L.shellPrompt('Run a command', cmd));
L.say('session', session);
const turn = await L.waitTurn(session);
L.say('turn', turn);
const proj = await L.waitProjection(session, { timeoutMs: Number(process.env.PROJ_TIMEOUT ?? 30000) });
L.say('projection', proj);
L.say('total ms', Date.now() - t0);
const get = await L.api('GET', `/v1/agents/sessions/${session}`);
L.say('capabilities', get.json.capabilities);
const ev = await L.events(session);
L.say('event types', ev.map((e) => `${e.sequence ?? e.seq}:${e.type}`).join(' '));
const tr = ev.filter((e) => e.type === 'item.tool_result.updated');
for (const e of tr) L.say('tool_result event', e);
L.say('publication', L.sql(`SELECT publication_id, state, producer_phase, receipt_sequence, receipt_revision FROM qwen_tool_publication WHERE session_id='${session}'`));
L.say('artifacts', L.sql(`SELECT a.artifact_id, a.stream_id, a.creation_sequence, JSON_EXTRACT(a.descriptor_json,'$.byte_length') FROM managed_agent_artifact a JOIN managed_agent_tool_result r ON r.result_id=a.result_id WHERE r.session_id='${session}'`));
const items = await L.api('GET', `/v1/agents/sessions/${session}/items`);
L.say('items', (items.json.data ?? []).map((i) => ({ id: i.id, type: i.type, status: i.status, name: i.name, hasResult: !!i.result })));
L.say('model', L.modelRequests().slice(-2).map((m) => ({ kind: m.kind, step: m.step, tools: m.tools, bytes: m.toolResultBytes, result: m.lastToolResult?.slice(0, 200) })));
L.say('tap', L.tapEntries().slice(-6).map((e) => `${e.method} ${e.path} ${e.status}${e.rewritten ? ' REWRITTEN' : ''}`));
