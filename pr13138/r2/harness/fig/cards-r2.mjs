// Round-2 cards: F1/F2 on the new heads, the bot's Critical findings on 52899c07 vs 0919b9d8, interruption + real OSS on 0919b9d8.
import fs from 'node:fs';
const O = '/Users/wenshao/pr13138-rig/out';
const j = (p) => JSON.parse(fs.readFileSync(`${O}/${p}`, 'utf8'));
const r2 = j('e2e-r2/r2-matrix.json'); const r3 = j('e2e-r3/r2-matrix-r3.json');
const s8 = j('e2e-r2/s8-ab-r2.json')[0]; const s8old = j('e2e/s8-ab.json');
const dOld = j('e2e-r2/r2-d-old.json');
const s5 = j('e2e-r3/s5-interrupt.json'); const s5log = fs.readFileSync(`${O}/e2e-r3/s5-interrupt.log`, 'utf8');
const s7 = j('e2e-r3/s7-real-oss.json'); const s7log = fs.readFileSync(`${O}/e2e-r3/s7-real-oss.log`, 'utf8');
const st = (s) => !s ? '-' : s.startsWith('state=') ? s.match(/state=\w+/)[0].replace('state=', '') : `refused ${s.replace(/^REFUSED /, '').split(':')[0]}`;
const sec = (ms) => `${(ms / 1000).toFixed(0)} s`;
fs.mkdirSync('/Users/wenshao/pr13138-rig/fig/cards-r2', { recursive: true });

// ---- card 1: F1 + F2 on the new head
const f1 = [['entry already in the stopped source (0919b9d8)', 'operation', 'stderr (operator-private)', 'same UUID']];
for (const b of r3.B) f1.push([b.what.slice(0, 64), `++ ${b.state} ${b.lastError}`, b.stderr.replace('unsupported_source_entry: unsupported_source_entry ', '').slice(0, 72), b.sameUuidRetry.startsWith('REFUSED') ? 'refused (source_drift text)' : b.sameUuidRetry]);
f1.push(['all entries removed, new UUID', `++ ${st(r3.Bafter)}`, '', '']);
const old = s8old.find((r) => r.arm === 'head'); const cand = s8old.find((r) => r.arm !== 'head');
const f2 = [['20,000-file storage (7 Sessions)', 'capture', 'verify', 'connections', 'measured'],
  ['989baf22 (round 1, DriverManagerDataSource)', `!! ${sec(old.captureMs)}`, `!! ${sec(old.verifyMs)}`, '2 per asset', 'round 1, same VM/generator'],
  ['round-1 candidate (SingleConnectionDataSource)', sec(cand.captureMs), sec(cand.verifyMs), '1 per run', 'round 1'],
  ['52899c07 (b1cf9df3 fix)', `++ ${sec(s8.captureMs)}`, `++ ${sec(s8.verifyMs)}`, `${s8.captureConnections} / ${s8.verifyConnections}`, 'this round']];
fs.writeFileSync('/Users/wenshao/pr13138-rig/fig/cards-r2/01-f1-f2-fixed.json', JSON.stringify({
  title: 'Round 2 — F1 and F2 are fixed on the deployed Linux stack',
  subtitle: 'Same VM rig as round 1 (Ubuntu 24.04 ext4, MySQL 8.4.11, systemd fat jar + durable workers, packaged Harness/worker, shipped *-workspace-bundle.jar)',
  blocks: [
    { label: 'F1 — the conservative option the author chose: INVALIDATED with a stable code and a JSON-escaped path', table: f1 },
    { label: 'F2 — one physical connection per maintenance run', table: f2 },
    { note: `Runbook smoke on 0919b9d8: capture ${r3.A.capture.match(/state=\w+/)[0]} in ${sec(r3.A.captureMs)} (3,422 entries; ~99 s on 989baf22), same-ID replay byte-identical, verify ${r3.A.verify.match(/state=\w+/)[0]} contentVerified=true authorityCompatible=true activation=false, ${r3.A.tables} authority tables unchanged. The odd-name row shows a quote, newline and ANSI escape arriving JSON-escaped. A same-UUID retry of an INVALIDATED unsupported-entry cut prints "source_drift" (the stored lastErrorCode stays unsupported_source_entry).` },
  ] }, null, 1));

// ---- card 2: the bot's Critical findings, 52899c07 vs 0919b9d8
const cell = (o, extraKey) => `${o.state === 'INVALIDATED' ? '-- ' : o.state === 'CAPTURING' && /bundle_io_failed/.test(o.lastError) ? '!! ' : '++ '}${o.state}/${o.lastError}`;
const t2 = [['finding / real-stack case', '52899c07', '0919b9d8']];
t2.push(['R1-29 stray .DS_Store only in the operator copy', `${cell(r2.R129)}\n-- same UUID after removing it: ${st(r2.R129.retry)}`, `${cell(r3.R129)}\n++ same UUID after removing it: ${st(r3.R129.retry)}`]);
t2.push(['R1-31 a file missing from the operator copy', `${cell(r2.R131a)}, absolute bundle path on stderr\n   same UUID after restoring the copy: ${st(r2.R131a.retry)}`, `${cell(r3.R131a)}, no path on stderr\n++ same UUID after restoring the copy: ${st(r3.R131a.retry)}`]);
t2.push(['R1-31 a new source file appears after the copy', `${cell(r2.R131b)}\n   same UUID once the file is gone: ${st(r2.R131b.retry)}`, `${cell(r3.R131b)}\n++ same UUID once the file is gone: ${st(r3.R131b.retry)}`]);
t2.push(['R1-30 SIGKILL while assets.ndjson is published', `-- resume 1 and 2: ${st(r2.R130.resume1)}\n   seals only after deleting the .partial by hand`, `++ resume 1: ${st(r3.R130.resume1)}, resume 2: ${st(r3.R130.resume2)}`]);
const comp = (s) => s.match(/authorityCompatible=\w+/)?.[0] ?? st(s);
t2.push(['R1-32 verify a UTC-sealed capture, JVM in Asia/Shanghai\n      (and with the VM default zone, CST)', `-- ${comp(r2.R132verify.shanghai)}\n-- ${comp(r2.R132verify.systemDefault)}`, `++ ${comp(r3.R132verify.shanghai)}\n++ ${comp(r3.R132verify.systemDefault)}`]);
t2.push(['R1-32 capture killed under UTC, resumed under Asia/Shanghai', `-- ${r2['R132other-tz'].state}/${r2['R132other-tz'].lastError}`, `++ ${r3['R132other-tz'].state}`]);
t2.push(['control: resumed under the same zone (UTC)', `++ ${r2['R132same-tz'].state}`, `++ ${r3['R132same-tz'].state}`]);
const d = [['MySQL wait_timeout=2 s, 2 GiB file hashed with no RPC in between', 'result', 'same UUID with the default timeout'],
  ['989baf22 jar (new connection per call) + r2 CLI child', `++ ${st(dOld.summary)}`, '-'],
  ['52899c07', `!! exit ${r2.D.exit}: Connection was closed in SingleConnectionDataSource`, `++ ${st(r2.D.retry)}`],
  ['0919b9d8', `!! exit ${r3.D.exit}: same`, `++ ${st(r3.D.retry)}`]];
fs.writeFileSync('/Users/wenshao/pr13138-rig/fig/cards-r2/02-bot-criticals.json', JSON.stringify({
  title: "The bot's four Critical findings (review on b1cf9df3) on the real stack",
  subtitle: 'Same storage, fence and generator for both heads; every case is a new recovery UUID; the copy is a fresh cp -a',
  blocks: [
    { table: t2 },
    { label: 'New with the single connection: an idle connection reaped mid-capture', table: d },
    { note: 'All four Criticals reproduce on 52899c07 and are fixed on 0919b9d8 (R1-31 the way the author chose: a repairable snapshot_source_mismatch, not an invalidation; the copy-side retry works on both heads, so the bot\'s "retries forever" did not reproduce). The wait_timeout case only bites when an idle-connection reaper (server wait_timeout, a proxy) is shorter than the longest single-file hash; the run stays CAPTURING and resumes.' },
  ] }, null, 1));

// ---- card 3: interruption + real OSS on 0919b9d8
const where = { 'k1-tree': 'during the Workspace tree comparison', 'k2-sessions': 'after 3 Sessions completed', 'k3-indexes': 'after all Sessions (recheck/census/index)', 'k4-manifest': 'manifest.json published, SQL not committed' };
const t3 = [['SIGKILL java + node child (0919b9d8)', 'resume (same UUID)', 'indexes == clean capture', 'dup keys', 'fresh verify']];
for (const r of s5.rows) t3.push([where[r.id], `++ ${r.sealed} ${r.assets} assets`, r.same ? '++ identical' : '-- differ', String(r.dup), `++ ${r.verify}`]);
t3.push(['R1-30 window: while assets.ndjson is published', `++ ${st(r3.R130.resume1)}`, '-', '-', '-']);
const what7 = { 'real-bucket': 'capture from the real bucket, then fresh verify', 'wrong-secret': 'wrong OSS secret', 'segment-corrupted': 'one bit of segment:stdout:1 flipped in OSS', 'segment-deleted': 'segment:stdout:1 deleted in OSS', restored: 'original bytes put back, new capture', 'first-bundle-reverified': 'first bundle verified again' };
const t7 = [['real Aliyun OSS (temporary private bucket, deleted afterwards)', 'result']];
for (const r of s7) t7.push([what7[r.id] ?? r.id, [r.capture ? `++ ${st(r.capture).replace(/^refused The request signature.*/, 'refused at start (SignatureDoesNotMatch)')}` : '', r.verify ? `++ verify ${st(r.verify)}` : ''].filter(Boolean).join('\n')]);
const grab = (re, s) => (s.match(re) ?? [])[1] ?? '?';
fs.writeFileSync('/Users/wenshao/pr13138-rig/fig/cards-r2/03-interrupt-real-oss.json', JSON.stringify({
  title: '0919b9d8: interruption, request checks and real OSS re-run',
  subtitle: `Clean capture C0 indexes ${s5.ref.sessions.slice(0, 12)} / ${s5.ref.assets.slice(0, 12)} (${s5.ref.assetCount} assets); O2 Turn wrote ${grab(/bucket after the Turn: ([^\n]+)/, s7log)} to the real bucket`,
  blocks: [
    { table: t3 },
    { table: t7 },
    { label: 'Unchanged from round 1', pre: [
      `   ${grab(/(child environment probe: [^\n]+)/, s5log)}`,
      `   C0 verify ${grab(/C0 verify: state=\w+ .*?(authorityCompatible=\w+)/, s5log)}; source root renamed away -> ${grab(/C0 verify with the source root gone: .*?(contentVerified=\w+ authorityCompatible=\w+)/, s5log)}`,
      '   request checks: no W1_OSS_* -> publication_objects_unavailable; wrong revision/fence -> refused before any row;',
      '   bundleRoot symlink -> invalid_bundle_root; history inside bundle -> overlapping_roots; escaped write after compare -> INVALIDATED',
    ].join('\n') },
  ] }, null, 1));
console.log('cards written');
