// Phase E: pre-approved tools never ask (PR #13071). read_file under
// `default`, write_file+edit under `auto-edit`, and everything under `yolo`
// run without any Action being requested.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/root/git/qwen-code-pr13071/integration-tests/fake-openai-server.ts';

L.openLog('e-preapproved');
const ROOT = '/root/rig13071/roots/a/child';
fs.writeFileSync(`${ROOT}/e-seed.txt`, 'seed-content\n');
// Script per session: read then write then edit, then settle.
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'];
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const userText = JSON.stringify(messages[lastUser]?.content ?? '');
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  const tag = userText.match(/\[\[(e\d)/)?.[1] ?? 'e?';
  if (!receipts.length) {
    if (tag === 'e1') return { toolCalls: [fakeToolCall('read_file', { file_path: 'e-seed.txt' }, 'call-e1r')] };
    if (tag === 'e2') return { toolCalls: [fakeToolCall('write_file', { file_path: 'e2-auto.txt', content: 'auto-edit\n' }, 'call-e2w')] };
    if (tag === 'e3') return { toolCalls: [fakeToolCall('write_file', { file_path: 'e3-yolo.txt', content: 'yolo\n' }, 'call-e3w')] };
    return { content: 'settled' };
  }
  if (tag === 'e1' && receipts.length === 1) return { toolCalls: [fakeToolCall('write_file', { file_path: 'e1-asked.txt', content: 'must ask\n' }, 'call-e1w')] };
  if (tag === 'e2' && receipts.length === 1) return { toolCalls: [fakeToolCall('edit', { file_path: 'e2-auto.txt', old_string: 'auto-edit', new_string: 'edited' }, 'call-e2e')] };
  return { content: `${tag} settled` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${L.BPORT}`);
const h = await new L.Harness({ name: 'e', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });

L.seedRegistry('ws-a', 'st-a');
const mk = async (extra) => {
  const sessionId = await L.createWorkspaceSession('ws-a');
  const s = new L.HSession(h, sessionId, L.storeConnection(h, 'ws-a'));
  const r = await s.create({ toolProfile: L.FILE_PROFILE, ...extra });
  if (r.status !== 200) throw new Error(`create: ${r.status} ${JSON.stringify(r.json)}`);
  return s;
};

// E1: default pre-approves read_file but asks about write_file.
{
  const s = await mk({ approvalMode: 'default' });
  fs.rmSync(`${ROOT}/e1-asked.txt`, { force: true });
  const p = await s.submit('[[e1]] read the seed, then write');
  // read_file runs with no Action; write_file then asks.
  const action = await L.waitForAction(s.sessionId);
  L.check('E1 only write_file asked', action.options.toolName === 'write_file' && action.options.functionCallId === 'call-e1w', action.options);
  L.check('E1 read_file ran without asking', fs.existsSync(`${ROOT}/e-seed.txt`) && proxy.ledger.some((e) => e.url.includes('executions:prepare')));
  const r = await s.resolve(action.requestId, { optionId: 'allow', inputRevision: 1, policyRevision: 'hosted-tool-approval/1' });
  L.check('E1 allow -> 200', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
  await s.waitIdle();
  L.check('E1 write ran after allow', fs.readFileSync(`${ROOT}/e1-asked.txt`, 'utf8') === 'must ask\n');
  L.check('E1 exactly one Action requested', L.requestedActions(s.sessionId).length === 1);
}

// E2: auto-edit runs write_file and edit without asking.
{
  const s = await mk({ approvalMode: 'auto-edit' });
  fs.rmSync(`${ROOT}/e2-auto.txt`, { force: true });
  const p = await s.submit('[[e2]] write and edit');
  await s.waitIdle();
  L.check('E2 no Action requested', L.requestedActions(s.sessionId).length === 0, L.actionEvents(s.sessionId).length);
  L.check('E2 write+edit both ran', fs.readFileSync(`${ROOT}/e2-auto.txt`, 'utf8') === 'edited\n');
  const t = await s.transcript();
  L.check('E2 turn completed', t.some((e) => e.type === 'turn_complete' && e.promptId === p.promptId));
}

// E3: yolo runs everything without asking.
{
  const s = await mk({ approvalMode: 'yolo' });
  fs.rmSync(`${ROOT}/e3-yolo.txt`, { force: true });
  const p = await s.submit('[[e3]] write under yolo');
  await s.waitIdle();
  L.check('E3 no Action requested under yolo', L.requestedActions(s.sessionId).length === 0);
  L.check('E3 write ran', fs.readFileSync(`${ROOT}/e3-yolo.txt`, 'utf8') === 'yolo\n');
}

await h.stop();
await model.close?.();
await proxy.close();
L.exitSummary();
