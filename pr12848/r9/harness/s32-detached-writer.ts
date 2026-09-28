// A fully detached descendant (new session, output redirected) after a normal Hosted Shell turn:
// the capture completes, the Workspace is released, a new Session takes the Workspace, and the
// descendant writes into it afterwards.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';
const DB = process.env.DB ?? 'p848n', HTTP = 18848, ROOTS = process.env.ROOTS ?? 'roots13', ST = process.env.ST ?? 't';
L.openLog(`s32-detached-writer-${process.env.ARM ?? ''}`);
const DETACH = "perl -MPOSIX -e 'POSIX::setsid(); sleep 6; open(my $f, \">>\", \"shared.txt\"); print $f \"from-detached-descendant\\n\"' > /dev/null 2>&1 & echo ok";
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const text = JSON.stringify(messages[lastUser]?.content ?? '');
  if (messages.slice(lastUser + 1).some((m) => m.role === 'tool')) return { content: 'ok' };
  if (text.includes('[[DETACH]]')) return { toolCalls: [fakeToolCall('run_shell_command', { command: DETACH }, `d-${Date.now()}`)] };
  if (text.includes('[[NEXT]]')) return { toolCalls: [fakeToolCall('run_shell_command', { command: 'echo from-next-session >> shared.txt; sleep 8; cat shared.txt' }, `n-${Date.now()}`)] };
  return { content: 'ok' };
});
const ws = `ws-${ST}`, dir = `${L.RIG}/${ROOTS}/${ST}/child`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
fs.mkdirSync(dir, { recursive: true });
fs.rmSync(`${dir}/shared.txt`, { force: true });
const h = await new L.Harness({ name: `detached-${process.env.ARM ?? ''}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
const a = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await a.create({ toolProfile: 'hosted-workspace-shell/1' });
const t0 = Date.now();
const r1 = await a.prompt('[[DETACH]]', 60000);
const man = L.sql(DB, `SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE kind='managed-tool-result-manifest' AND session_id='${a.sessionId}' ORDER BY created_at DESC LIMIT 1`)[0]?.[0];
L.say('session A', `${L.summarizeTurn(r1)}; capture ${man ? JSON.parse(man).captureStatus : 'none'}; at +${Date.now() - t0} ms`);
const b = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await b.create({ toolProfile: 'hosted-workspace-shell/1' });
const r2 = await b.prompt('[[NEXT]]', 60000);
const out = (r2.events ?? []).flatMap((e: any) => e.data?.record?.message?.parts ?? []).filter((p: any) => p.functionResponse).map((p: any) => JSON.stringify(p.functionResponse.response?.output ?? p.functionResponse.response).slice(0, 200))[0];
L.say('session B (same Workspace, started right after A released it)', `${L.summarizeTurn(r2)}; at +${Date.now() - t0} ms`);
L.say('shared.txt', JSON.stringify(fs.readFileSync(`${dir}/shared.txt`, 'utf8')));
L.say('B saw', out ?? 'no receipt');
await h.stop();
process.exit(0);
