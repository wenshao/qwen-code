// Phase A: approval mode pinning & create/load validation (PR #13071).
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import { startFakeOpenAIServer } from '/root/git/qwen-code-pr13071/integration-tests/fake-openai-server.ts';

L.openLog('a-validate');
const model = await startFakeOpenAIServer(async () => ({ content: 'unused' }));
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${L.BPORT}`);
const h = await new L.Harness({ name: 'a', modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
L.say('harness', `${h.baseUrl} bootId=${h.bootId}`);

const mk = () => new L.HSession(h, randomUUID(), L.storeConnection(h, 'ws-a'));
const definitionOf = (sid) => {
  const rows = L.sql(L.DB, `SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='${sid}' AND kind='managed-definition'`);
  return rows.length ? JSON.parse(rows[0][0]) : null;
};

// A1: default mode pins and is reported.
{
  const s = mk();
  const r = await s.create({ toolProfile: L.FILE_PROFILE, approvalMode: 'default' });
  L.check('A1 create default -> 200', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
  L.check('A1 response approvalMode=default', r.json?.approvalMode === 'default', r.json?.approvalMode);
  const def = definitionOf(s.sessionId);
  L.check('A1 definition pins mode+timeout', def?.approvalMode === 'default' && def?.approvalTimeoutMs === 600_000, def);
  // A1b: load uses the pinned mode and reports it.
  await s.h.json(`/session/${s.sessionId}/detach`, {}, { clientId: s.clientId });
  const l = await s.load({ toolProfile: L.FILE_PROFILE });
  L.check('A1b load -> 200 approvalMode=default', l.status === 200 && l.json?.approvalMode === 'default', `${l.status} ${l.json?.approvalMode}`);
}

// A2: auto-edit with a custom timeout.
{
  const s = mk();
  const r = await s.create({ toolProfile: L.FILE_PROFILE, approvalMode: 'auto-edit', approvalTimeoutMs: 5_000 });
  L.check('A2 create auto-edit -> 200', r.status === 200 && r.json?.approvalMode === 'auto-edit', `${r.status} ${JSON.stringify(r.json)}`);
  const def = definitionOf(s.sessionId);
  L.check('A2 definition pins timeout 5000', def?.approvalTimeoutMs === 5_000, def);
}

// A3: yolo saves nothing; definition bytes unchanged.
{
  const s = mk();
  const r = await s.create({ toolProfile: L.FILE_PROFILE, approvalMode: 'yolo' });
  L.check('A3 create yolo -> 200', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
  L.check('A3 response approvalMode=yolo', r.json?.approvalMode === 'yolo', r.json?.approvalMode);
  const def = definitionOf(s.sessionId);
  L.check('A3 yolo definition has no approval fields', def && !('approvalMode' in def) && !('approvalTimeoutMs' in def), def);
}

// A4: refused modes and timeouts -> 400 invalid_hosted_approval.
for (const [name, extra] of [
  ['plan', { approvalMode: 'plan' }],
  ['auto', { approvalMode: 'auto' }],
  ['unknown-mode', { approvalMode: 'sometimes' }],
  ['timeout-999ms', { approvalMode: 'default', approvalTimeoutMs: 999 }],
  ['timeout-25h', { approvalMode: 'default', approvalTimeoutMs: 25 * 3_600_000 }],
  ['timeout-non-integer', { approvalMode: 'default', approvalTimeoutMs: 1.5 }],
  ['timeout-string', { approvalMode: 'default', approvalTimeoutMs: '60000' }],
]) {
  const s = mk();
  const r = await s.create({ toolProfile: L.FILE_PROFILE, ...extra });
  L.check(`A4 ${name} -> 400 invalid_hosted_approval`, r.status === 400 && r.json?.code === 'invalid_hosted_approval', `${r.status} ${JSON.stringify(r.json)}`);
}

// A5: no-tool sessions are untouched (no approvalMode field).
{
  const s = mk();
  const r = await s.create({});
  L.check('A5 no-tool create -> 200 without approvalMode', r.status === 200 && r.json && !('approvalMode' in r.json), `${r.status} ${JSON.stringify(r.json)}`);
}

await h.stop();
await model.close?.();
await proxy.close();
L.exitSummary();
