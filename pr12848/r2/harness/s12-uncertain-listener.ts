// Uncertain Shell turn (every status reply lost until the observation window ends):
// is the Session blocked, did the command run once, and is the publisher listener closed?
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';
const DB = process.env.DB ?? 'p848c';
const HTTP = Number(process.env.HTTP ?? 18848);
const ST = process.env.ST ?? 'n2';
L.openLog(`s12-uncertain-${process.env.ARM ?? 'r3'}`);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (JSON.stringify(messages[lastUser]?.content).includes('[[UNK]]') && !receipts.length)
    return { toolCalls: [fakeToolCall('run_shell_command', { command: 'echo u >> unk.txt', timeout: 1000 }, 'unk-0')] };
  return { content: 'ok' };
});
const broker = await L.startBrokerProxy('http://127.0.0.1:19848');
broker.state.hook = (entry: { method: string; url: string }) =>
  entry.method === 'GET' && /\/executions\/[^/:]+$/.test(entry.url) ? 'drop-reply' : 'forward';
const h = await new L.Harness({ name: 'unk-r3', modelUrl: model.baseUrl, brokerUrl: broker.url }).start();
const hp = new URL(h.baseUrl).port;
const listening = () => { try { return execFileSync('/usr/sbin/lsof', ['-a', '-p', String(h.child.pid), '-iTCP', '-sTCP:LISTEN', '-nP', '-Fn'], { encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('n')).map((l) => l.slice(1).split(':').pop()).filter((p) => p !== hp); } catch { return []; } };
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
fs.mkdirSync(`${L.RIG}/roots3/${ST}/child`, { recursive: true });
const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await s.create({ toolProfile: 'hosted-workspace-shell/1' });
const t0 = Date.now();
const r = await s.prompt('[[UNK]]', 240000);
const counts: Record<string, number> = {};
for (const l of L.ledgerSince(broker.ledger, t0)) { const k = l.replace(/[0-9a-f-]{36}/g, '<id>'); counts[k] = (counts[k] ?? 0) + 1; }
L.say('uncertain turn', `${L.summarizeTurn(r)}; unk.txt=${JSON.stringify(fs.readFileSync(`${L.RIG}/roots3/${ST}/child/unk.txt`, 'utf8'))}; publisher listeners after turn: ${JSON.stringify(listening())}`);
L.say('broker', Object.entries(counts).map(([k, v]) => `${v}x ${k}`));
const again = await s.submit('[[TEXT]]');
L.say('next prompt', `${again.status} ${JSON.stringify(again.json).slice(0, 120)}`);
L.say('harness', h.log().split('\n').filter((l) => /failed:|blocked/i.test(l)).slice(-2).map((l) => l.slice(0, 200)));
await h.stop(); await broker.close();
process.exit(0);
