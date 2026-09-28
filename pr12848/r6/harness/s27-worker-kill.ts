// A Shell command kills its own managed-runtime worker (walks its ancestry, kill -9).
// Then: same Session next prompt, a NEW Session in the SAME Workspace, a Session in ANOTHER Workspace; SQL states.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';
const DB = process.env.DB ?? 'p848h', HTTP = 18848, ROOTS = process.env.ROOTS ?? 'roots8';
const [ST, OTHER] = (process.env.LETTERS ?? 'n,o').split(',');
L.openLog(`s27-worker-kill-${process.env.ARM ?? ''}`);
const KILL = 'p=$PPID; while [ -n "$p" ] && [ "$p" != 1 ] && ! ps -o command= -p $p | grep -q managed-runtime-worker; do p=$(ps -o ppid= -p $p | tr -d " "); done; ps -o pid=,command= -p $p > killed-worker.txt; echo "killing $p"; kill -9 $p; sleep 2; echo after';
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const text = JSON.stringify(messages[lastUser]?.content ?? '');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (receipts.length) return { content: 'ok' };
  if (text.includes('[[KILL]]')) return { toolCalls: [fakeToolCall('run_shell_command', { command: KILL, timeout: 60000 }, `kill-${Date.now()}`)] };
  if (text.includes('[[ECHO]]')) return { toolCalls: [fakeToolCall('run_shell_command', { command: 'echo alive >> alive.txt; echo ok' }, `echo-${Date.now()}`)] };
  return { content: 'ok' };
});
const h = await new L.Harness({ name: `wkill-${process.env.ARM ?? ''}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
async function session(st: string) {
  const ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  fs.mkdirSync(`${L.RIG}/${ROOTS}/${st}/child`, { recursive: true });
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  const c = await s.create({ toolProfile: 'hosted-workspace-shell/1' });
  return { s, c };
}
function results(r: any) {
  return (r.events ?? []).flatMap((e: any) => e.data?.record?.message?.parts ?? []).filter((p: any) => p.functionResponse).map((p: any) => JSON.stringify(p.functionResponse.response).slice(0, 160));
}
const bindings = (st: string) => L.sql(DB, `SELECT binding_state, runtime_generation FROM qwen_runtime_binding WHERE storage_id='st-${st}' ORDER BY runtime_generation`).map((r: string[]) => r.join('/')).join(' ');
const A = await session(ST);
L.say('warmup', `${L.summarizeTurn(await A.s.prompt('[[ECHO]]', 60000))}; bindings ${bindings(ST)}`);
const k = await A.s.prompt('[[KILL]]', 120000);
L.say('kill turn', `${L.summarizeTurn(k)} ${results(k).join(' | ')}`);
L.say('killed', fs.existsSync(`${L.RIG}/${ROOTS}/${ST}/child/killed-worker.txt`) ? fs.readFileSync(`${L.RIG}/${ROOTS}/${ST}/child/killed-worker.txt`, 'utf8').trim().slice(0, 160) : 'no file');
L.say('harness', h.log().split('\n').filter((l) => /blocked|failed|lost/i.test(l)).slice(-2).map((l) => l.slice(0, 220)));
const next = await A.s.submit('[[ECHO]]');
L.say('same Session next prompt', `${next.status} ${JSON.stringify(next.json).slice(0, 120)}`);
const B = await session(ST);
L.say('new Session same Workspace create', `${B.c.status}`);
const b = B.c.status === 200 ? await B.s.prompt('[[ECHO]]', 120000) : null;
L.say('new Session same Workspace turn', b ? `${L.summarizeTurn(b)} ${results(b).join(' | ')}` : '-');
L.say('harness', h.log().split('\n').filter((l) => /blocked|failed|lost/i.test(l)).slice(-2).map((l) => l.slice(0, 220)));
const C = await session(OTHER);
const c = await C.s.prompt('[[ECHO]]', 120000);
L.say('other Workspace turn', `${L.summarizeTurn(c)}`);
L.say('sql bindings', `${ST}: ${bindings(ST)} | ${OTHER}: ${bindings(OTHER)}`);
L.say('sql executions', L.sql(DB, `SELECT e.execution_state, LEFT(CAST(e.result_json AS CHAR),60) FROM qwen_tool_execution e WHERE e.runtime_session_id = '${k.promptId}'`).map((r: string[]) => r.join(' ')).join(' ; ') || 'none matched');
await h.stop();
process.exit(0);
