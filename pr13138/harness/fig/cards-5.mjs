// Card 5: cost per entry (S4/S6/S6b/S8). Card 6: O2 output in a real Aliyun OSS bucket (S7).
import fs from 'node:fs';
const E = '/Users/wenshao/pr13138-rig/out/e2e';
const read = (f) => (fs.existsSync(`${E}/${f}`) ? JSON.parse(fs.readFileSync(`${E}/${f}`, 'utf8')) : null);
const s6 = read('s6-scale.json'); const s6b = read('s6b-digests.json'); const s8 = read('s8-ab.json'); const s7 = read('s7-real-oss.json') ?? [];
const s4 = fs.readFileSync(`${E}/s4-drift.log`, 'utf8').match(/w1b capture-control: exit=0 (\d+) ms java≤(\d+) MiB node≤(\d+) MiB -> state=SEALED sessions=(\d+)\/\d+ assets=(\d+) .* entries=(\d+)/);
const sec = (ms) => `${(ms / 1000).toFixed(0)} s`;
const t = [['storage (st-a)', 'Sessions', 'entries', 'capture', 'ms / asset', 'SQL / asset', 'verify', 'peak RSS java / node']];
t.push(['3,000 generated files (S4)', s4[4], Number(s4[6]).toLocaleString('en'), sec(s4[1]), (s4[1] / s4[5]).toFixed(1), '-', '-', `${s4[2]} / ${s4[3]} MiB`]);
t.push(['20,000 files + 1 GiB file (S6)', String(s6.members), s6.entries.toLocaleString('en'), `!! ${sec(s6.captureMs)}`, (s6.captureMs / s6.assets).toFixed(1), (s6.sqlCapture.statements / s6.assets).toFixed(1), `!! ${sec(s6.verifyMs)}`, `${s6.capMem.javaMiB} / ${s6.capMem.nodeMiB} MiB`]);
const blocks = [{ label: 'Capture / verify through the shipped jar (VM: 4 vCPU, MySQL 8.4.11 in Docker on the same VM)', table: t }];
if (s6b) blocks.push({ label: `Statement digests during the tree comparison (S6b: ${s6b.assets.toLocaleString('en')} assets, ${s6b.total.toLocaleString('en')} statements = ${(s6b.total / s6b.assets).toFixed(1)} per asset)`, pre: s6b.top.slice(0, 8).map((x) => `${(x.sql.startsWith('SELECT @@SESSION') || x.sql.startsWith('SET character_set_results') ? '!! ' : '   ')}${x.perAsset.padStart(5)}/asset  ${x.sql.slice(0, 110)}`).join('\n') });
const h8 = read('s6b-digests-head8.json'); const c8 = read('s6b-digests-cand2.json');
const setup = (d) => d.top.filter((x) => x.sql.startsWith('SELECT @@SESSION')).reduce((a, x) => a + Number(x.perAsset), 0).toFixed(1);
if (s8) {
  const a = [['S8: same 20,500-entry storage, 7 Sessions', 'capture', 'verify', 'SQL statements (capture)', 'connection set-ups / asset*', 'sessions / assets index']];
  for (const r of s8) { const d = r.arm === 'head' ? h8 : c8; a.push([r.arm === 'head' ? 'PR jar (DriverManagerDataSource)' : 'candidate: SingleConnectionDataSource (1 line)', `${r.arm === 'head' ? '!! ' : '++ '}${sec(r.captureMs)}`, `${r.arm === 'head' ? '!! ' : '++ '}${sec(r.verifyMs)}`, r.captureStatements.toLocaleString('en'), d ? `${setup(d)} (${(d.total / d.assets).toFixed(1)} statements / asset)` : '-', `${r.sessionsIndex?.slice(0, 12)} / ${r.assetsIndex?.slice(0, 12)}`]); }
  blocks.push({ label: 'One connection instead of a new one per call  (* 90 s digest sample during the tree comparison, same storage)', table: a });
}
blocks.push({ note: 'Memory stays bounded (streamed) and pagination works (77 Sessions: inspect pages of 32). The cost is per entry: DriverManagerDataSource opens a fresh MySQL connection for every lookup and every record (the @@SESSION / character_set statements are Connector/J connection set-up), and each record is its own transaction that re-checks the W1a registration. A one-line SingleConnectionDataSource in WorkspaceRecoveryMain cuts capture 806 -> 221 s and verify 378 -> 136 s on the same storage with byte-identical indexes. Even then, a populated node_modules (1e5-1e6 entries) needs a long offline window per capture and again per verify.' });
fs.writeFileSync('/Users/wenshao/pr13138-rig/fig/cards/05-f2-cost-per-entry.json', JSON.stringify({ title: 'F2 — capture and verify cost grows with every filesystem entry', subtitle: 'S4 / S6: deployed stack, shipped *-workspace-bundle.jar; SQL counted with performance_schema digests; RSS sampled from /proc every 100 ms', blocks }, null, 1));
const s7log = fs.readFileSync(`${E}/s7-real-oss.log`, 'utf8');
const grab = (re) => (s7log.match(re) ?? [])[1] ?? '?';
const short = (s) => !s ? '' : s.startsWith('REFUSED') ? `refused ${s.replace(/^REFUSED /, '').split(':')[0].replace(/^The request signature.*/, 'at start: OSS SignatureDoesNotMatch (no operation row)')}` : `${s.match(/state=\S+/)?.[0]} ${s.match(/contentVerified=\w+ authorityCompatible=\w+ activation=\w+/)?.[0] ?? ''}`;
const what = { 'real-bucket': 'capture reading the real bucket, then fresh verify (no OSS needed)', 'wrong-secret': 'capture with a wrong OSS secret', 'segment-corrupted': 'segment:stdout:1 has one bit flipped in OSS', 'segment-deleted': 'segment:stdout:1 deleted from OSS', restored: 'original bytes put back, new capture', 'first-bundle-reverified': 'the first bundle verified again' };
const r7 = [['case', 'result']];
for (const r of s7) r7.push([what[r.id] ?? r.id, [r.capture ? `++ ${short(r.capture)}` : '', r.verify ? `++ verify ${short(r.verify)}` : ''].filter(Boolean).join('\n')]);
fs.writeFileSync('/Users/wenshao/pr13138-rig/fig/cards/06-real-oss.json', JSON.stringify({
  title: 'O2 output in a real Aliyun OSS bucket',
  subtitle: 'S7: temporary private bucket in cn-hangzhou (deleted afterwards) · server and maintenance jar use the real endpoint, no hosts file or private trust store',
  blocks: [
    { label: 'The O2 Shell Turn through the deployed stack', pre: [`   O1 publication ${grab(/(O1 publication [A-Z]+: [^\n]+)/).replace('O1 publication ', '')}`, `   bucket after the Turn: ${grab(/bucket after the Turn: ([^\n]+)/)}`, `   in the bundle: ${grab(/publication objects in the bundle: ([^\n]+)/)}`].join('\n') },
    { table: r7 },
    { note: 'The local OSS double used in S1-S6 accepts any signature (a wrong secret sealed there); against real OSS a wrong secret is refused before any operation row is written. A deleted object surfaces as the generic recovery_read_failed rather than a missing-object code.' },
  ] }, null, 1));
for (const r of t) console.log(r.join(' | ')); if (s6b) console.log(blocks[1].pre); for (const r of r7) console.log(r.join(' | '));
