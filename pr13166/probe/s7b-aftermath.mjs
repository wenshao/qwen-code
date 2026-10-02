// VERIFICATION RIG ONLY: S7b aftermath of the mixed-version glob — another Session in the same
// Workspace, and a takeover reload of the blocked Session (id in BLOCKED).
import * as L from './lib.mjs';

const name = `s7b-aftermath-${L.ARM}`;
L.openLog(name);
const ws = `ws-${process.env.ST ?? 'a'}`;
const BLOCKED = process.env.BLOCKED;
const model = await L.startModel({
  read: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: 'src/a.ts' }]] } : { text: 'DONE read' }),
  plain: () => ({ text: 'PLAIN_OK' }),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s7b-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  L.say('holders before', JSON.stringify(L.holders().filter((x) => x[1] !== '<none>')));
  for (const profile of ['hosted-workspace-files/1', 'hosted-workspace-files/2']) {
    const B = new L.HSession(h, await L.createWorkspaceSession(ws, 'w'), L.storeConnection(h, ws));
    L.say('other Session', `${profile} create ${(await B.create({ toolProfile: profile })).status}`);
    const t0 = Date.now();
    const r = await B.prompt('[[S:read]] go');
    L.say('other Session turn', `${L.summarizeTurn(r)}; broker: ${L.ledgerSince(proxy.ledger, t0).join(' | ')}`);
    L.say('other Session text', L.assistantText(r.events).slice(0, 200) || JSON.stringify(r.terminal?.[0]?.data ?? {}).slice(0, 300));
    const r2 = await B.prompt('[[S:plain]] hi');
    L.say('other Session text-only turn', L.summarizeTurn(r2));
  }
  if (BLOCKED) {
    const S = new L.HSession(h, BLOCKED, L.storeConnection(h, ws));
    for (const body of [{}, { driveRuntimeRecovery: true }, { passiveManagedRuntimeRecovery: true }]) {
      const t0 = Date.now();
      const l = await S.load(body);
      L.say('reload blocked Session', `${JSON.stringify(body)} -> ${l.status} ${JSON.stringify(l.json).slice(0, 400)}; broker: ${L.ledgerSince(proxy.ledger, t0).join(' | ')}`);
      if (l.status === 200) {
        const r = await S.prompt('[[S:plain]] hi');
        L.say('blocked Session next turn', `${L.summarizeTurn(r)}`);
        await S.detach();
      }
    }
  }
  L.say('holders after', JSON.stringify(L.holders().filter((x) => x[1] !== '<none>')));
  L.say('harness log', h.log().split('\n').filter((l) => /blocked|failed|refus|unavailable|busy/i.test(l)).map((l) => l.replace(/^.*qwen serve: /, '')).join(' || ').slice(0, 900) || '<none>');
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
