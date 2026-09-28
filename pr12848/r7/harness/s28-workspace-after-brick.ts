// A fresh Session in a Workspace whose earlier Session is recovery-blocked: can it still run a Shell turn?
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';
const DB = process.env.DB ?? 'p848h', HTTP = 18848, ROOTS = process.env.ROOTS ?? 'roots8';
const LETTERS = (process.env.LETTERS ?? 'm,e,f,d').split(',');
L.openLog(`s28-workspace-after-brick-${process.env.ARM ?? ''}`);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (receipts.length) return { content: 'ok' };
  if (/\[\[ECHO\]\]/.test(JSON.stringify(messages[lastUser]?.content ?? ''))) return { toolCalls: [fakeToolCall('run_shell_command', { command: 'echo alive >> alive.txt; echo ok' }, `echo-${Date.now()}`)] };
  if (/\[\[READ\]\]/.test(JSON.stringify(messages[lastUser]?.content ?? ''))) return { toolCalls: [fakeToolCall('write_file', { file_path: 'w.txt', content: 'w\n' }, `w-${Date.now()}`)] };
  return { content: 'ok' };
});
const h = await new L.Harness({ name: `after-brick-${process.env.ARM ?? ''}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
for (const st of LETTERS) {
  const ws = `ws-${st}`;
  fs.mkdirSync(`${L.RIG}/${ROOTS}/${st}/child`, { recursive: true });
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  const c = await s.create({ toolProfile: 'hosted-workspace-shell/1' });
  const r = c.status === 200 ? await s.prompt('[[ECHO]]', 60000) : null;
  const s2 = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  const c2 = await s2.create({ toolProfile: 'hosted-workspace-files/1' });
  const r2 = c2.status === 200 ? await s2.prompt('[[READ]]', 60000) : null;
  const last = h.log().split('\n').filter((l) => /failed|blocked/.test(l)).slice(-1)[0] ?? '';
  L.say(ws, `shell: create ${c.status} ${r ? L.summarizeTurn(r) : '-'} | files: create ${c2.status} ${r2 ? L.summarizeTurn(r2) : '-'} | ${last.includes(ws) || /workspace_busy/.test(last) ? last.slice(-80) : ''}`);
}
await h.stop();
process.exit(0);
