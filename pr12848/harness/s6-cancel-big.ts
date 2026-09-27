// Cancel a foreground Shell call while it is streaming heavy output.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848a';
const HTTP = Number(process.env.HTTP ?? 18848);
const ST = process.env.ST ?? 'y';
L.openLog(`s6-cancel-big-${ST}`);
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (!receipts.length && JSON.stringify(messages[lastUser]?.content).includes('[[BIG]]'))
    return { toolCalls: [fakeToolCall('run_shell_command', { command: 'echo started >> cancel-runs.txt; yes cancel-me-0123456789 | head -c 1073741824; echo finished >> cancel-runs.txt', timeout: 600000 }, 'big')] };
  return { content: 'text answer' };
});
const broker = await L.startBrokerProxy('http://127.0.0.1:19848');
const h = await new L.Harness({ name: `cancel-${ST}`, modelUrl: model.baseUrl, brokerUrl: broker.url }).start();
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await s.create({ toolProfile: 'hosted-workspace-shell/1' });
const dir = `${L.RIG}/roots1/${ST}/child`;
const yesProcs = () => execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n').filter((l) => l.includes('cancel-me-0123456789') && !l.includes('ps -axo')).length;
const sub = await s.submit('[[BIG]]');
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  const bytes = Number(L.sql(DB, `SELECT IFNULL(SUM(byte_length),0) FROM qwen_managed_session_resource WHERE workspace_id='${ws}' AND kind='managed-tool-result-content'`)[0][0]);
  if (bytes > 20 * 1024 * 1024) break;
  await L.sleep(250);
}
L.say('before cancel', `t=${Date.now() - t0}ms yes procs=${yesProcs()} stored=${L.sql(DB, `SELECT SUM(byte_length) FROM qwen_managed_session_resource WHERE workspace_id='${ws}'`)[0][0]}`);
const c = await s.cancel();
L.say('cancel', `${c.status}`);
const st = await s.waitIdle(240000);
const events = (await s.transcript()).filter((e) => e.promptId === sub.promptId);
L.say('turn', `terminal=${events.filter((e) => e.type.startsWith('turn_')).map((e) => `${e.type}(${e.data?.stopReason ?? ''})`).join(',')} recoveryBlocked=${st.recoveryBlocked} settle=${Date.now() - t0}ms`);
for (const e of events) for (const p of e.data?.record?.message?.parts ?? []) if (p.functionResponse) {
  const r = p.functionResponse.response;
  L.say('tool_result', `status=${r.executionStatus} capture=${r.capture?.captureStatus}/${r.capture?.deliveryStatus} reason=${r.capture?.captureReason} previewTruncated=${r.capture?.previewTruncated}`);
}
L.say('after', `yes procs=${yesProcs()} cancel-runs.txt=${JSON.stringify(fs.readFileSync(`${dir}/cancel-runs.txt`, 'utf8'))} stored=${L.sql(DB, `SELECT COUNT(*), SUM(byte_length) FROM qwen_managed_session_resource WHERE workspace_id='${ws}' AND kind LIKE 'managed-tool-result-%'`)[0].join(' rows / ')} bytes`);
const counts: Record<string, number> = {};
for (const l of L.ledgerSince(broker.ledger, t0)) counts[l.replace(/[0-9a-f-]{36}/g, '<id>')] = (counts[l.replace(/[0-9a-f-]{36}/g, '<id>')] ?? 0) + 1;
L.say('broker', Object.entries(counts).map(([k, v]) => `${v}x ${k}`));
const next = await s.prompt('[[TEXT]]');
L.say('next', L.summarizeTurn(next));
await h.stop();
await broker.close();
process.exit(0);
