// S12: gate 2 probe. The fake model first calls read_file with an absolute path
// (as real models do after `pwd`), then retries with the relative path if the
// tool result asks for it. env: DB, ST, TAG, LOCAL=1 for the #12848 local path
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o2m';
const HTTP = 18894, BPORT = 19894, PROXY = 18895;
const ST = process.env.ST ?? 's23';
const TAG = process.env.TAG ?? `s12-${Date.now()}`;
L.openLog(`s12-${TAG}`);
const ws = `ws-${ST}`;
const dir = `${process.env.ROOTS ?? L.RIG + '/roots'}/${ST}/child`;
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${dir}/notes.txt`, `note for ${TAG}\n`);
const seen: string[] = [];
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const tools = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  const text = (m: any) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
  if (tools.length === 0) return { toolCalls: [fakeToolCall('read_file', { file_path: `${dir}/notes.txt` }, `call-${TAG}-abs`)] };
  seen.push(text(tools.at(-1)));
  if (tools.length === 1) return { toolCalls: [fakeToolCall('read_file', { file_path: 'notes.txt' }, `call-${TAG}-rel`)] };
  return { content: `done ${TAG}` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
const h = await new L.Harness({ name: `s12-${TAG}`, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const sessionId = await L.createWorkspaceSession(HTTP, ws);
const s = new L.HSession(h, sessionId, { ...L.storeConnection(h, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
L.say('create', `${(await s.create()).status} path=${process.env.LOCAL === '1' ? 'local capture' : 'O2 publication'}`);
const r = await s.prompt(`[[${TAG}]] read the notes`, 120_000).catch((e: any) => ({ terminal: [], err: String(e) }));
L.say('turn', L.summarizeTurn(r));
L.say('absolute read_file result', (seen[0] ?? '(none)').slice(0, 260));
L.say('relative read_file result', (seen[1] ?? '(none)').slice(0, 160));
L.say('status', JSON.stringify(await s.status()));
L.say('harness', h.log().split('\n').filter((l: string) => /fail|block|error|retr/i.test(l)).map((l: string) => l.slice(0, 200)));
await h.stop();
process.exit(0);
