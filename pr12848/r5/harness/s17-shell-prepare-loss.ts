// 6846d1e2 merged main's prepare retry into the Shell prepare path.
// Lose the Shell `executions:prepare` exchange and check the retry, the
// reserved execution, and that the command runs at most once.
// CASE=reply-once | request-once | timeout-once | reply-twice
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848f';
const HTTP = Number(process.env.HTTP ?? 18848);
const ROOTS = process.env.ROOTS ?? 'roots6';
const CASE = process.env.CASE ?? 'reply-once';
const ST = process.env.ST ?? 'g';
L.openLog(`s17-shell-prepare-loss-${CASE}-${process.env.ARM ?? ''}`);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (JSON.stringify(messages[lastUser]?.content).includes('[[RUN]]') && !receipts.length)
    return { toolCalls: [fakeToolCall('run_shell_command', { command: 'echo ran >> effect.txt' }, `run-${Date.now()}`)] };
  return { content: 'ok' };
});
const broker = await L.startBrokerProxy('http://127.0.0.1:19848');
let prepares = 0;
broker.state.hook = async (entry: { method: string; url: string }) => {
  if (entry.method !== 'POST' || !entry.url.endsWith('/executions:prepare')) return 'forward';
  prepares += 1;
  if (CASE === 'reply-once' && prepares === 1) return 'drop-reply';
  if (CASE === 'request-once' && prepares === 1) return 'drop-request';
  if (CASE === 'reply-twice' && prepares <= 2) return 'drop-reply';
  if (CASE === 'timeout-once' && prepares === 1) {
    await L.sleep(31_000); // past the client's 30 s AbortSignal.timeout
    return 'forward';
  }
  return 'forward';
};
const h = await new L.Harness({ name: `prep-${CASE}`, modelUrl: model.baseUrl, brokerUrl: broker.url }).start();
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const dir = `${L.RIG}/${ROOTS}/${ST}/child`;
fs.mkdirSync(dir, { recursive: true });
const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await s.create({ toolProfile: 'hosted-workspace-shell/1' });
const t0 = Date.now();
const r = await s.prompt('[[RUN]]', 180_000);
L.say(CASE, `${L.summarizeTurn(r)}; prepare requests=${prepares}`);
for (const l of L.ledgerSince(broker.ledger, t0)) L.say(`${CASE} broker`, l.replace(/[0-9a-f-]{36}/g, (x) => x.slice(0, 8)));
const rows = L.sql(DB, `SELECT execution_state, IFNULL(execution_status,'-'), COUNT(*) FROM qwen_tool_execution WHERE harness_session_id='${s.sessionId}' GROUP BY 1,2`);
L.say(`${CASE} executions`, JSON.stringify(rows));
L.say(`${CASE} effect`, `effect.txt=${JSON.stringify(fs.existsSync(`${dir}/effect.txt`) ? fs.readFileSync(`${dir}/effect.txt`, 'utf8') : null)}`);
L.say(`${CASE} harness`, h.log().split('\n').filter((l) => /failed|blocked/i.test(l)).map((l) => l.slice(0, 220)));
if (r.status2 && !r.status2.recoveryBlocked) {
  const next = await s.prompt('[[TEXT]]');
  L.say(`${CASE} next`, L.summarizeTurn(next));
} else {
  const next = await s.submit('[[TEXT]]');
  L.say(`${CASE} next`, `submit -> ${next.status} ${JSON.stringify(next.json).slice(0, 90)}`);
}
await h.stop();
await broker.close();
process.exit(0);
