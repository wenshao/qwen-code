// S3: damage to a sealed bundle and loss of the original source, checked by fresh verification operations against the
// S1 capture. A pristine copy of the sealed bundle is restored before every case (cp -a; modes and bytes preserved).
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
L.openLog('s3-damage');
const { say } = L;
const s1 = JSON.parse(fs.readFileSync(`${L.OUT}/s1.json`, 'utf8'));
const cap = s1.cap; const B = cap.bundleRoot; const PRISTINE = `${B}.pristine`;
say(L.hostFacts()); say(`   capture ${cap.operationId} ${W.opStr(W.opRow(cap.operationId))}`);
if (!fs.existsSync(PRISTINE)) L.sh(`cp -a ${B} ${PRISTINE}`);
const assets = fs.readFileSync(`${PRISTINE}/.w1-recovery/assets.ndjson`, 'utf8').trim().split('\n').map((l) => JSON.parse(l).metadata);
const blobOf = (pred) => assets.find(pred)?.path;
const txBlob = blobOf((m) => m.type === 'transaction');
const ckBlob = blobOf((m) => m.type === 'resource' && m.ref?.kind === 'managed-checkpoint');
const segBlob = blobOf((m) => m.type === 'publicationObject' && String(m.object?.slotKey ?? m.object?.slot ?? '').startsWith('segment'));
const backups = L.sh(`cd ${PRISTINE} && find file-history -type f | sort`).split('\n').filter(Boolean);
const wsFile = 'workspace/project/notes.txt';
const flip = (rel) => { const p = path.join(B, rel); const fd = fs.openSync(p, 'r+'); const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, 0); b[0] ^= 1; fs.writeSync(fd, b, 0, 1, 0); fs.closeSync(fd); return `flipped byte 0 of ${rel}`; };
say(`   targets: transaction blob ${txBlob?.slice(-12)}, checkpoint blob ${ckBlob?.slice(-12)}, O2 segment blob ${segBlob?.slice(-12) ?? '<none>'}, ${backups.length} history backups`);
const other = fs.existsSync('/srv/w1b-bundles/s2-control/.w1-recovery/manifest.json') ? '/srv/w1b-bundles/s2-control/.w1-recovery/manifest.json' : null;
const CASES = [
  { id: 'control', what: 'no damage', damage: () => 'none' },
  { id: 'tx-blob-flip', what: 'one byte of a journal transaction blob', damage: () => flip(txBlob) },
  { id: 'checkpoint-missing', what: 'a checkpoint resource blob deleted', damage: () => { fs.rmSync(path.join(B, ckBlob)); return `deleted ${ckBlob}`; } },
  { id: 'segment-flip', what: 'one byte of an O2 output segment blob', damage: () => segBlob ? flip(segBlob) : 'SKIP' },
  { id: 'backup-missing', what: 'a retained file-history backup deleted from the copy', damage: () => { fs.rmSync(path.join(B, backups[0])); return `deleted ${backups[0]}`; } },
  { id: 'backup-flip', what: 'one byte of a retained file-history backup', damage: () => flip(backups[0]) },
  { id: 'ws-file-flip', what: 'one byte of a Workspace file copy (same size)', damage: () => flip(wsFile) },
  { id: 'ws-file-mode', what: 'mode of a Workspace file copy changed (0644 -> 0600)', damage: () => { fs.chmodSync(path.join(B, wsFile), 0o600); return 'chmod 600'; } },
  { id: 'ws-extra', what: 'an undeclared file added to the Workspace copy', damage: () => { fs.writeFileSync(path.join(B, 'workspace/project/extra.txt'), 'x'); return 'added workspace/project/extra.txt'; } },
  { id: 'root-extra', what: 'an undeclared file added at the bundle root', damage: () => { fs.writeFileSync(path.join(B, 'README.txt'), 'x'); return 'added README.txt'; } },
  { id: 'manifest-missing', what: 'manifest.json deleted', damage: () => { fs.rmSync(path.join(B, '.w1-recovery/manifest.json')); return 'deleted'; } },
  { id: 'manifest-other', what: 'manifest.json replaced by another sealed capture of the same storage', damage: () => other ? (fs.copyFileSync(other, path.join(B, '.w1-recovery/manifest.json')), 'replaced with s2-control manifest') : 'SKIP' },
  { id: 'sessions-index-flip', what: 'one byte of sessions.ndjson', damage: () => flip('.w1-recovery/sessions.ndjson') },
  { id: 'source-loss', what: 'original Workspace root renamed away (bundle intact)', damage: () => { fs.renameSync(L.root('a'), `${L.root('a')}.lost`); return 'renamed /srv/w1b/a'; }, undo: () => fs.renameSync(`${L.root('a')}.lost`, L.root('a')) },
  { id: 'history-loss', what: 'original worker file-history root renamed away (bundle intact)', damage: () => { fs.renameSync(W.historyRoot(), `${W.historyRoot()}.lost`); return 'renamed history root'; }, undo: () => fs.renameSync(`${W.historyRoot()}.lost`, W.historyRoot()) },
];
const rows = [];
for (const c of CASES) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(c.id)) continue;
  L.sh(`rm -rf ${B} && cp -a ${PRISTINE} ${B}`);
  const d = c.damage(); if (d === 'SKIP') { say(`== ${c.id}: skipped`); continue; }
  say(`== ${c.id}: ${c.what} — ${d}`);
  const req = W.verifyRequest(cap);
  const r = await W.w1b('verify', req, { label: `verify-${c.id}` });
  const row = W.opRow(req.operationId);
  say(`   ${W.opStr(row)}`);
  c.undo?.();
  rows.push({ id: c.id, what: c.what, exit: r.code, outcome: W.summary(r), state: row?.state ?? '<no row>', lastError: row?.error });
}
L.sh(`rm -rf ${B} && cp -a ${PRISTINE} ${B}`);
say('== summary');
for (const x of rows) say(`   ${x.id.padEnd(20)} exit=${x.exit} state=${String(x.state).padEnd(10)} ${x.outcome.slice(0, 150)}`);
fs.writeFileSync(`${L.OUT}/s3-damage.json`, JSON.stringify(rows, null, 1));
say('S3-DONE');
