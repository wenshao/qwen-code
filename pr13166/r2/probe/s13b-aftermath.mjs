// VERIFICATION RIG ONLY: S13b aftermath of the cancelled brace14 glob — lease, worker, takeover reload.
import * as L from './lib.mjs';

const name = `s13b-aftermath-${L.ARM}`;
L.openLog(name);
const BLOCKED = process.env.BLOCKED;
const model = await L.startModel({
  read: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'src/a.ts' }]] } : { text: 'DONE read' }),
  plain: () => ({ text: 'PLAIN_OK' }),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s13b-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  L.say('ws-a lease', JSON.stringify(L.sql("SELECT LEFT(runtime_session_id,8) FROM managed_workspace_execution_lease WHERE storage_key='1feb5a8ebfbefe88750b440d905d8ab5a8abd81c930c2f4472977eb281baa258'")));
  L.say('brace14 execution', JSON.stringify(L.sql("SELECT execution_state, IFNULL(execution_status,'-'), cancel_requested FROM qwen_tool_execution WHERE harness_session_id='" + BLOCKED + "' ORDER BY record_version DESC LIMIT 3")));
  const S = new L.HSession(h, BLOCKED, L.storeConnection(h, 'ws-a'));
  for (const body of [{}, { driveRuntimeRecovery: true }]) {
    const t0 = Date.now();
    const l = await S.load(body);
    L.say('reload A', `${JSON.stringify(body)} -> ${l.status} ${JSON.stringify(l.json).slice(0, 260)}; broker: ${L.ledgerSince(proxy.ledger, t0).join(' | ')}`);
    if (l.status === 200) {
      const report = l.json?._meta?.['qwen.daemon.managedRuntimeRecovery'];
      if (report) {
        const c = await h.json(`/session/${BLOCKED}/managed-runtime/continue`, { promptId: report.executions?.[0]?.runtimeSessionId, checkpointId: report.checkpointId, activationId: report.activationId }, { clientId: S.clientId });
        L.say('continue A', `${c.status} ${JSON.stringify(c.json).slice(0, 200)}`);
        await S.waitIdle(120_000).catch(() => {});
      }
      const r = await S.prompt('[[S:read]] go');
      L.say('A next Turn', L.summarizeTurn(r));
      await S.detach();
      break;
    }
  }
  const B = new L.HSession(h, await L.createWorkspaceSession('ws-a', 'w'), L.storeConnection(h, 'ws-a'));
  await B.create({ toolProfile: 'hosted-workspace-files/2' });
  const rb = await B.prompt('[[S:read]] go');
  L.say('new Session in ws-a', L.summarizeTurn(rb));
  L.say('ws-a lease after', JSON.stringify(L.sql("SELECT LEFT(runtime_session_id,8) FROM managed_workspace_execution_lease WHERE storage_key='1feb5a8ebfbefe88750b440d905d8ab5a8abd81c930c2f4472977eb281baa258'")));
  L.say('harness log', h.log().split('\n').filter((l) => /blocked|failed|recovery/i.test(l)).map((l) => l.replace(/^.*qwen serve: /, '')).join(' || ').slice(0, 700) || '<none>');
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
