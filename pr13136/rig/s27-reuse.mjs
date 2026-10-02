// PR #13136 diagnosis: load a Hook Session that an earlier Spring process served, run one write_file turn and one
// Notification operation, and print every Harness -> Broker request (through a recording proxy).
// usage: DB=<db> ARM=<dist> node s27-reuse.mjs <label U1..U5> <tag>
import fs from 'node:fs';
import { Report, Harness, HSession, startModel, startBrokerProxy, ledgerLines, storeConnection, setControl, script, call, turn, toolTrace, hookLedger, RUN } from './lib.mjs';
const [U, TAG] = process.argv.slice(2);
const ARM = process.env.ARM ?? 'head';
const R = new Report(`s27-reuse-${U}-${ARM}-${TAG}`);
const st = JSON.parse(fs.readFileSync(`${RUN}/s25-sessions.json`, 'utf8'));
const model = await startModel();
const proxy = await startBrokerProxy();
setControl({});
const h = await new Harness({ name: `s27-${U}-${TAG}`, modelUrl: model.url, arm: ARM, brokerUrl: proxy.url }).start();
const calls = (sid) => hookLedger((e) => e.session === sid && !e.kind).length;
try {
  const s = new HSession(h, st[U].sid, storeConnection(h, st[U].workspaceId));
  const l = await s.load();
  R.note('load', `${l.status} ${l.json?.code ?? ''}`);
  const c0 = calls(st[U].sid);
  const p = await s.prompt(script([[call('write_file', { file_path: `${U}-${TAG}.txt`, content: 'x' })]], `${U}-${TAG}`));
  const op = await s.hookOp('Notification', { message: `${U}-${TAG}`, notification_type: 'rig' });
  R.check(`${U} on ${ARM}: write_file turn and a Notification operation`, l.status === 200 && p.terminal?.[0]?.type === 'turn_complete' && op.status === 200,
    `${turn(p)}; op ${op.status} ${op.json?.code ?? ''}; physical Hook calls +${calls(st[U].sid) - c0}; ${toolTrace(p.events ?? []).filter((x) => x.startsWith('result')).join(' ').slice(0, 120)}`);
  for (const line of ledgerLines(proxy.ledger)) R.say(`  broker: ${line}`);
  await s.detach();
} finally {
  await h.close();
  await proxy.close();
  await model.close();
  R.done();
}
