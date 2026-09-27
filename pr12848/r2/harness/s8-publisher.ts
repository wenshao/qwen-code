// Live checks on the Harness-owned Shell publisher: bearer check while a
// command runs, and whether the listener is gone after each turn.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848a';
const HTTP = Number(process.env.HTTP ?? 18848);
const ARM = process.env.ARM ?? 'pr';
const ST = process.env.ST ?? 'c3';
L.openLog(`s8-publisher-${ARM}`);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (!receipts.length && JSON.stringify(messages[lastUser]?.content).includes('[[SLOW]]'))
    return { toolCalls: [fakeToolCall('run_shell_command', { command: 'sh wait8.sh', timeout: 60000 }, `slow-${Date.now()}`)] };
  return { content: 'done' };
});
const h = await new L.Harness({ name: `pub-${ARM}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
const harnessPort = new URL(h.baseUrl).port;
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
fs.mkdirSync(`${L.RIG}/${process.env.ROOTS ?? "roots1"}/${ST}/child`, { recursive: true });
fs.writeFileSync(`${L.RIG}/${process.env.ROOTS ?? "roots1"}/${ST}/child/wait8.sh`, 'sleep 8\necho waited\n');
const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await s.create({ toolProfile: 'hosted-workspace-shell/1' });
const listening = () => {
  try {
    return execFileSync('/usr/sbin/lsof', ['-a', '-p', String(h.child.pid), '-iTCP', '-sTCP:LISTEN', '-nP', '-Fn'], { encoding: 'utf8' })
      .split('\n').filter((l) => l.startsWith('n')).map((l) => l.slice(1).split(':').pop()!).filter((p) => p !== harnessPort);
  } catch {
    return [];
  }
};
const post = async (port: string, auth?: string) => {
  const r = await fetch(`http://127.0.0.1:${port}/internal/hosted-shell-publisher/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify({ operation: 'finalize', executionCallId: 'not-a-real-call', started: false, failed: true, process: null, executionStatus: 'error', responseParts: [], previewTruncated: false, error: null }),
  }).catch((e) => ({ status: `connect error ${e.cause?.code ?? e.message}`, text: async () => '' }) as any);
  return `${r.status} ${(await r.text()).slice(0, 80)}`;
};
for (let turn = 1; turn <= 3; turn++) {
  const sub = await s.submit('[[SLOW]]');
  let port: string | undefined;
  for (let i = 0; i < 100 && !port; i++) {
    await L.sleep(100);
    port = listening()[0];
  }
  if (turn === 1 && port) {
    L.say('auth', `during turn 1, publisher port ${port}: no Authorization -> ${await post(port)}`);
    L.say('auth', `wrong token -> ${await post(port, `Bearer ${'A'.repeat(43)}`)}`);
  }
  await s.waitIdle(120000);
  const ev = (await s.transcript()).filter((e) => e.promptId === sub.promptId && e.type.startsWith('turn_'));
  L.say('turn', `${turn}: ${ev.map((e) => `${e.type}(${e.data?.stopReason ?? ''})`).join(',')}; publisher listeners after turn: ${JSON.stringify(listening())}${port ? `; POST to turn ${turn}'s port ${port} after the turn -> ${await post(port)}` : ''}`);
}
await h.stop();
process.exit(0);
