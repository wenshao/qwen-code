// VERIFICATION RIG ONLY: S20 R4-7 — a >64 KiB glob result that only a recovery can commit. Harness A
// dispatches the glob; the Harness->Broker proxy forwards :start, then SIGKILLs A before A sees the reply.
// Harness B takes the Session over (driveRuntimeRecovery), which settles the execution from the Broker and
// commits the tool result, then /managed-runtime/continue finishes the Turn.
import fs from 'node:fs';
import { createServer } from 'node:http';
import * as L from './lib.mjs';

const name = `s20-recover-trunc-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'b';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}`;
const deep = ['a'.repeat(200), 'b'.repeat(200), 'c'.repeat(200), 'd'.repeat(150)].join('/');
fs.mkdirSync(`${root}/w/${deep}`, { recursive: true });
for (let i = 0; i < 100; i++) fs.writeFileSync(`${root}/w/${deep}/file-${String(i).padStart(3, '0')}-${'x'.repeat(60)}.txt`, `${i}\n`);
L.seedRegistry(ws, `st-${st}`);
let phase = 'A';
const model = await L.startModel({
  big: ({ round }) => (round === 0 ? { calls: [['glob', { pattern: '**/*.txt' }]] } : { text: `DONE big phase=${phase}` }),
});
let harnessA;
const ledger = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const body = Buffer.concat(chunks);
  const url = req.url.replace(/\?.*$/, '');
  const r = await fetch(new URL(req.url, L.BROKER), { method: req.method, headers: { Authorization: `Bearer ${L.E.BTOKEN}`, 'Content-Type': 'application/json' }, ...(body.length ? { body } : {}) });
  const t = await r.text();
  ledger.push(`${phase} ${req.method} ${url.replace('/internal/runtime-broker/v1', '').replace(/[0-9a-f-]{36}/g, ':id')} -> ${r.status}`);
  if (phase === 'A' && /:start$/.test(url) && harnessA) {
    harnessA.child.kill('SIGKILL');
    ledger.push('A SIGKILLed after the Broker accepted :start');
    res.destroy();
    return;
  }
  res.writeHead(r.status, { 'Content-Type': 'application/json' });
  res.end(t);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const proxyUrl = `http://127.0.0.1:${server.address().port}`;
const LEASE = 10_000;
harnessA = await new L.Harness({ name: `s20a-${L.ARM}`, modelUrl: model.url, brokerUrl: proxyUrl }).start();
let B;
try {
  const id = await L.createWorkspaceSession(ws, 'w');
  const sa = new L.HSession(harnessA, id, { ...L.storeConnection(harnessA, ws), leaseDurationMs: LEASE });
  L.say('create on A', `${(await sa.create({ toolProfile: 'hosted-workspace-files/2' })).status}`);
  const sub = await sa.submit('[[S:big]] list everything');
  L.say('submit on A', `${sub.status}`);
  for (let i = 0; i < 100 && harnessA.child.exitCode === null && harnessA.child.signalCode === null; i++) await L.sleep(200);
  L.say('A', `exit=${harnessA.child.exitCode} signal=${harnessA.child.signalCode}`);
  await L.sleep(LEASE + 3000);
  phase = 'B';
  B = await new L.Harness({ name: `s20b-${L.ARM}`, modelUrl: model.url, brokerUrl: proxyUrl }).start();
  const sb = new L.HSession(B, id, { ...L.storeConnection(B, ws), leaseDurationMs: LEASE });
  let load;
  for (let i = 0; i < 12; i++) {
    load = await sb.load({ driveRuntimeRecovery: true });
    if (load.status !== 503) break;
    await L.sleep(5000);
  }
  const report = load.json?._meta?.['qwen.daemon.managedRuntimeRecovery'];
  L.say('takeover load on B', `${load.status} report=${JSON.stringify(report)?.slice(0, 260)}`);
  const events = async () => (await sb.transcript()).filter((e) => e.promptId === sub.promptId);
  const recovered = L.toolResponses(await events())[0];
  const out = String(recovered?.response?.output ?? '');
  L.say('recovered tool result', `${Buffer.byteLength(JSON.stringify(recovered ?? {}))} B, status=${recovered?.response?.executionStatus}, outputTruncated=${recovered?.response?.outputTruncated}, paths=${out.split('\n').filter((l) => l.startsWith('a'.repeat(20))).length}, tail=${JSON.stringify(out.slice(-110))}`);
  if (load.status === 200 && report) {
    const c = await B.json(`/session/${id}/managed-runtime/continue`, { promptId: sub.promptId, checkpointId: report.checkpointId, activationId: report.activationId }, { clientId: sb.clientId });
    L.say('continue', `${c.status}`);
    const st2 = await sb.waitIdle(120_000);
    const ev = await events();
    L.say('terminal', JSON.stringify(ev.filter((e) => e.type.startsWith('turn_')).map((e) => e.type)));
    L.say('status', JSON.stringify(st2));
    const seen = model.requests.filter((q) => q.round === 1).at(-1)?.results?.join('\n') ?? '';
    L.say('model saw after recovery', `${seen.length} chars; hint=${seen.includes('Narrow the pattern or path')}`);
  }
  L.say('broker ledger', ledger.join(' | '));
  L.say('lease', JSON.stringify(L.holders().filter((x) => x[1] !== '<none>').map((x) => x[1].slice(0, 8))));
} finally {
  await harnessA.stop();
  await B?.stop();
  server.closeAllConnections();
  server.close();
  await model.close();
}
process.exitCode = L.done(name);
