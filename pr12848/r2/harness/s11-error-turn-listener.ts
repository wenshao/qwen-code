// Publisher listener after a turn whose model call fails after a Shell round.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';
const DB = process.env.DB ?? 'p848c';
const HTTP = Number(process.env.HTTP ?? 18848);
const ST = process.env.ST ?? 'l2';
L.openLog(`s11-error-turn-${process.env.ARM ?? 'r3'}`);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (!JSON.stringify(messages[lastUser]?.content).includes('[[ERR]]')) return { content: 'ok' };
  if (!receipts.length) return { toolCalls: [fakeToolCall('run_shell_command', { command: 'echo e >> err.txt' }, 'err-0')] };
  throw new Error('injected provider failure after the Shell round');
});
const h = await new L.Harness({ name: `err-${process.env.ARM ?? 'r3'}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
const hp = new URL(h.baseUrl).port;
const listening = () => { try { return execFileSync('/usr/sbin/lsof', ['-a', '-p', String(h.child.pid), '-iTCP', '-sTCP:LISTEN', '-nP', '-Fn'], { encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('n')).map((l) => l.slice(1).split(':').pop()).filter((p) => p !== hp); } catch { return []; } };
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
fs.mkdirSync(`${L.RIG}/roots3/${ST}/child`, { recursive: true });
const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await s.create({ toolProfile: 'hosted-workspace-shell/1' });
const r = await s.prompt('[[ERR]]');
L.say('error turn', `${L.summarizeTurn(r)}; err.txt=${JSON.stringify(fs.readFileSync(`${L.RIG}/roots3/${ST}/child/err.txt`, 'utf8'))}; publisher listeners after turn: ${JSON.stringify(listening())}`);
await h.stop();
process.exit(0);
