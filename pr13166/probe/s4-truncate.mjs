// VERIFICATION RIG ONLY: S4 a glob result over the 64 KiB inline Session limit (files/2, head).
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s4-truncate-${L.ARM}`;
L.openLog(name);
const st = process.env.ST ?? 'f';
const ws = `ws-${st}`;
const root = `${L.ROOTS}/${st}`;
const COUNT = Number(process.env.COUNT ?? 100);
const deep = ['a'.repeat(200), 'b'.repeat(200), 'c'.repeat(200), 'd'.repeat(150)].join('/');
fs.mkdirSync(`${root}/w/${deep}`, { recursive: true });
for (let i = 0; i < COUNT; i++) fs.writeFileSync(`${root}/w/${deep}/file-${String(i).padStart(3, '0')}-${'x'.repeat(60)}.txt`, `${i}\n`);
const relLen = `${deep}/file-000-${'x'.repeat(60)}.txt`.length;
L.seedRegistry(ws, `st-${st}`);
const model = await L.startModel({
  big: ({ round }) => (round === 0 ? { calls: [['glob', { pattern: '**/*.txt' }]] } : { text: 'DONE big' }),
  plain: () => ({ text: 'PLAIN_OK' }),
  read: ({ round }) => (round === 0 ? { calls: [['read_file', { file_path: `${deep}/file-000-${'x'.repeat(60)}.txt` }]] } : { text: 'DONE read' }),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s4-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
try {
  L.say('setup', `${COUNT} files, relative path ${relLen} bytes each -> raw list ~${COUNT * (relLen + 1)} bytes`);
  const A = new L.HSession(h, await L.createWorkspaceSession(ws, 'w'), L.storeConnection(h, ws));
  L.say('create', (await A.create({ toolProfile: 'hosted-workspace-files/2' })).status);
  const t0 = Date.now();
  const n = model.requests.length;
  const r = await A.prompt('[[S:big]] list everything');
  L.say('turn', L.summarizeTurn(r));
  L.say('broker', L.ledgerSince(proxy.ledger, t0).join(' | '));
  const exec = proxy.ledger.filter((e) => e.t >= t0 && /GET .*executions\//.test(`${e.method} ${e.url}`)).at(-1);
  L.say('runtime result size', `${exec?.resBody?.length ?? '?'} bytes returned by the Broker to the Harness`);
  const resp = L.toolResponses(r.events)[0];
  const output = resp?.response?.output ?? '';
  const lines = output.split('\n');
  const kept = lines.filter((l) => l.startsWith('a'.repeat(20))).length;
  const record = Buffer.byteLength(JSON.stringify(resp));
  L.say('durable functionResponse', `${record} bytes, outputTruncated=${resp?.response?.outputTruncated}, kept ${kept}/${COUNT} paths`);
  L.say('tail', JSON.stringify(output.slice(-160)));
  const seen = model.requests.slice(n).flatMap((q) => q.results).join('\n');
  L.check('turn completed', r.terminal?.[0]?.type === 'turn_complete', L.summarizeTurn(r));
  L.check('result kept as a whole-line prefix + narrowing hint', output.endsWith('[Result truncated to fit the durable Session limit. Narrow the pattern or path.]') && kept > 0 && kept < COUNT, `kept=${kept}`);
  L.check('every kept line is a whole path', lines.filter((l) => l.startsWith('a'.repeat(20))).every((l) => l.length === relLen), '');
  L.check('record fits 64 KiB', record <= 65536, `${record}`);
  L.check('model saw the truncated list', seen.includes('Narrow the pattern or path.') && seen.includes('file-000') !== undefined, `${seen.length} chars`);
  const s = await A.status();
  L.check('Session not blocked', s.recoveryBlocked === false, JSON.stringify(s));
  L.check('Workspace lease released', L.holders().every((x) => x[1] === '<none>'), JSON.stringify(L.holders()));
  const r2 = await A.prompt('[[S:read]] read one');
  L.check('next Turn (read_file of a listed path) completes', r2.terminal?.[0]?.type === 'turn_complete' && JSON.stringify(L.toolResponses(r2.events)).includes('"0\\n"'), L.summarizeTurn(r2));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
