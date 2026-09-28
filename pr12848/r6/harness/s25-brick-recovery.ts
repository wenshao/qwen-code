// After a backgrounded compound command blocks a Hosted Shell Session: next prompt, detach + load, cold load in a new Harness.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';
const DB = process.env.DB ?? 'p848h', HTTP = 18848, ROOTS = process.env.ROOTS ?? 'roots8', ST = process.env.ST ?? 'm';
L.openLog(`s25-brick-recovery-${process.env.ARM ?? ''}`);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (/\[\[BG\]\]/.test(JSON.stringify(messages[lastUser]?.content ?? '')) && !receipts.length)
    return { toolCalls: [fakeToolCall('run_shell_command', { command: 'cd . && sleep 20 > /dev/null 2>&1 & echo ok' }, `bg-${Date.now()}`)] };
  return { content: 'ok' };
});
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
fs.mkdirSync(`${L.RIG}/${ROOTS}/${ST}/child`, { recursive: true });
let h = await new L.Harness({ name: `brick-${ST}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
const sid = await L.createWorkspaceSession(HTTP, ws);
let s = new L.HSession(h, sid, L.storeConnection(h, ws, HTTP));
await s.create({ toolProfile: 'hosted-workspace-shell/1' });
L.say('bg turn', L.summarizeTurn(await s.prompt('[[BG]]', 120000)));
const next = await s.submit('hello again');
L.say('next prompt', `${next.status} ${JSON.stringify(next.json).slice(0, 120)}`);
await s.detach();
const re = await s.load({ toolProfile: 'hosted-workspace-shell/1' });
L.say('detach + load', `${re.status} ${JSON.stringify(re.json ?? '').slice(0, 120)}`);
await h.stop();
await L.sleep(Number(process.env.LEASE_WAIT ?? 16000));
h = await new L.Harness({ name: `brick-${ST}-2`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
s = new L.HSession(h, sid, L.storeConnection(h, ws, HTTP));
const cold = await s.load({ toolProfile: 'hosted-workspace-shell/1' });
L.say('cold load (new Harness)', `${cold.status} ${JSON.stringify(cold.json ?? '').slice(0, 120)}`);
await h.stop();
process.exit(0);
