// FG6c harness-start on the rig, Shell vs edit: SIGKILL the Harness while the tool blocks reading a FIFO,
// then let the tool finish. Track the Broker execution, the file, cold load and the Workspace.
import fs from 'node:fs';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';
const DB = process.env.DB ?? 'p848m', HTTP = 18848, ROOTS = process.env.ROOTS ?? 'roots12';
const KIND = process.env.KIND ?? 'shell';
const ST = process.env.ST ?? (KIND === 'shell' ? 'p' : 'q');
L.openLog(`s30-harness-crash-midtool-${KIND}-${process.env.ARM ?? ''}`);
const PROFILE = KIND === 'shell' ? 'hosted-workspace-shell/1' : 'hosted-workspace-files/1';
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  const text = JSON.stringify(messages[lastUser]?.content ?? '');
  if (receipts.length || !text.includes('[[GO]]')) {
    if (text.includes('[[ECHO]]') && !receipts.length) return { toolCalls: [fakeToolCall(KIND === 'shell' ? 'run_shell_command' : 'write_file', KIND === 'shell' ? { command: 'echo alive >> alive.txt' } : { file_path: 'alive.txt', content: 'alive\n' }, `echo-${Date.now()}`)] };
    return { content: 'ok' };
  }
  return { toolCalls: [KIND === 'shell'
    ? fakeToolCall('run_shell_command', { command: 'c=$(cat proof.txt) && rm -f proof.txt && printf %s%s "$c" "$c" > proof.txt' }, `go-${Date.now()}`)
    : fakeToolCall('edit', { file_path: 'proof.txt', old_string: 'x', new_string: 'xx', replace_all: true }, `go-${Date.now()}`)] };
});
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const dir = `${L.RIG}/${ROOTS}/${ST}/child`;
fs.mkdirSync(dir, { recursive: true });
const proof = `${dir}/proof.txt`;
fs.rmSync(proof, { force: true });
execFileSync('mkfifo', [proof]);
let h = await new L.Harness({ name: `crash-${KIND}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
const sessionId = await L.createWorkspaceSession(HTTP, ws);
let s = new L.HSession(h, sessionId, L.storeConnection(h, ws, HTTP));
await s.create({ toolProfile: PROFILE });
const sub = await s.submit('[[GO]]');
let writer;
for (let i = 0; i < 300 && !writer; i++) {
  try { writer = await open(proof, constants.O_WRONLY | constants.O_NONBLOCK); } catch (e: any) { if (e.code !== 'ENXIO') throw e; await L.sleep(100); }
}
if (!writer) throw new Error('tool never opened the FIFO');
const execState = () => L.sql(DB, `SELECT execution_state, IFNULL(LEFT(CAST(result_json AS CHAR),70),'-') FROM qwen_tool_execution WHERE runtime_session_id='${sub.promptId}'`).map((r: string[]) => r.join(' ')).join(' ; ');
L.say('in flight', `execution ${execState()}`);
const pid = h.child.pid;
h.child.kill('SIGKILL');
await new Promise((r) => h.child.once('exit', r));
L.say('harness', `SIGKILL ${pid}`);
await writer.write('x');
await writer.close();
const t0 = Date.now();
for (const at of [2, 5, 10, 30, 60, 120]) {
  await L.sleep(at * 1000 - (Date.now() - t0));
  const st = fs.lstatSync(proof, { throwIfNoEntry: false });
  L.say(`t+${at}s`, `execution ${execState()}; proof ${st ? (st.isFIFO() ? 'FIFO' : JSON.stringify(fs.readFileSync(proof, 'utf8'))) : 'missing'}`);
}
L.say('capture rows', L.sql(DB, `SELECT kind, state, byte_length FROM qwen_managed_session_resource WHERE session_id='${sessionId}' AND kind LIKE 'managed-tool-result%'`).map((r: string[]) => r.join(':')).join(' ') || 'none');
h = await new L.Harness({ name: `crash-${KIND}-2`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
s = new L.HSession(h, sessionId, L.storeConnection(h, ws, HTTP));
const cold = await s.load({ toolProfile: PROFILE });
L.say('cold load', `${cold.status} ${JSON.stringify(cold.json ?? '').slice(0, 110)}`);
const n = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await n.create({ toolProfile: PROFILE });
const r = await n.prompt('[[ECHO]]', 60000);
L.say('new Session same Workspace', `${L.summarizeTurn(r)} ${h.log().split('\n').filter((l) => /failed|blocked/.test(l)).slice(-1)[0]?.replace(/^.*(failed|blocked): /, '').slice(0, 100) ?? ''}`);
L.say('execution finally', execState());
await h.stop();
process.exit(0);
