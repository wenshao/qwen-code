// Card 4: SIGKILL + same-UUID resume (S5), request/environment checks, source loss against a compatible bundle.
import fs from 'node:fs';
const E = '/Users/wenshao/pr13138-rig/out/e2e';
const s5 = JSON.parse(fs.readFileSync(`${E}/s5-interrupt.json`, 'utf8'));
const log = fs.readFileSync(`${E}/s5-interrupt.log`, 'utf8');
const where = { 'k1-tree': 'during the Workspace tree comparison', 'k2-sessions': 'after 3 of 8 Sessions completed', 'k3-indexes': 'after all Sessions (recheck/census/index)', 'k4-manifest': 'manifest.json published, SQL not committed' };
const t = [['SIGKILL java + node child', 'row after kill', 'resume (same UUID)', 'indexes == clean capture', 'dup keys', 'fresh verify']];
for (const r of s5.rows) t.push([where[r.id] ?? r.id, `${r.mid}${r.midError === '-' ? '' : ' ' + r.midError}, ${r.midAssets} assets`, r.resume === 0 ? `++ ${r.sealed} ${r.assets} assets` : `-- exit ${r.resume}`, r.same ? '++ identical' : '-- differ', String(r.dup), r.verify.startsWith('VERIFIED') ? `++ ${r.verify}` : r.verify]);
const checks = [...log.matchAll(/check (\S+)\s+exit=(\d+) row=(.+?) -> ([^\n]+)/g)].filter((m) => !['bundle-in-source', 'wrong-oss-key'].includes(m[1])).map((m) => [({ 'wrong-oss-key': 'wrong OSS secret (local double does not check signatures; see S7)', 'no-oss-env': 'O2 Session in the storage, no W1_OSS_* given', 'wrong-revision': 'mountRevision != fenced revision', 'wrong-fence': 'fenceOperationId != the fence', 'bundle-symlink': 'bundleRoot is a symlink', 'history-in-bundle': 'fileHistoryRoot inside bundleRoot', 'cli-entry-mismatch': 'cliEntry does not exist', 'late-escaped-writer': 'escaped write after its file was compared' })[m[1]] ?? m[1], m[2], m[3], m[4].replace(/^REFUSED /, '').replace(/^(\w+): \1$/, '$1').replace(/ sessions=.*/, '').slice(0, 70)]);
const grab = (re) => (log.match(re) ?? [])[1] ?? '?';
const card = {
  title: 'Interrupted captures resume to the same bytes; request and environment checks',
  subtitle: `S5 on a fenced 8-Session storage (3,416 entries); clean capture C0 indexes sessions=${s5.ref.sessions.slice(0, 12)} assets=${s5.ref.assets.slice(0, 12)} (${s5.ref.assetCount} assets)`,
  blocks: [
    { table: t },
    { label: 'Request / environment checks (each a new UUID)', table: [['case', 'exit', 'operation row', 'outcome'], ...checks] },
    { label: 'Child environment and source loss against a still-compatible bundle', pre: [
      `== ${grab(/child environment probe: ([^\n]+)/)}`,
      `++ C0 verify:               ${grab(/C0 verify: (state=\S+ [^\n]*?activation=\w+)/)}`,
      `++ C0 verify, source gone:  ${grab(/C0 verify with the source root gone: (state=\S+ [^\n]*?activation=\w+)/)}`,
    ].join('\n') },
  ],
};
fs.writeFileSync('/Users/wenshao/pr13138-rig/fig/cards/04-interrupt-resume.json', JSON.stringify(card, null, 1));
for (const r of [...t, ...card.blocks[1].table]) console.log(r.join(' | ')); console.log(card.blocks[2].pre);
