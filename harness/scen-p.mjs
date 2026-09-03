// Group P — proactive delivery through the daemon's channel-webhook route (group + DM targets)
import * as L from './lib.mjs';
const ws = process.argv[2];
const say = (text, extra = '') => `SAYB64:${L.b64(text)} ${extra}`.trim();
const noPath = (s) => !s.includes(ws) && !s.includes('[FILE:');
async function run(label, targetRef, text, { quiet = 3000, extra = 'CHUNK:4' } = {}) {
  const t0 = Date.now();
  const resp = await L.webhookTask({ targetRef, directive: say(text, extra), title: label });
  const e = await L.settle({ after: t0, quiet, timeout: 90000 });
  const after = (xs) => xs.filter((x) => x.t > t0);
  const g = after(L.groupSends(e)), dm = after(L.dmSends(e));
  return { t0, resp, e, up: after(L.uploads(e)), g, dm, gf: L.proactiveOf(g, 'sampleFile'), gm: L.proactiveOf(g, 'sampleMarkdown'), df: L.proactiveOf(dm, 'sampleFile'), dmd: L.proactiveOf(dm, 'sampleMarkdown'), out: L.outText(e, t0) };
}
const param = (x) => JSON.parse(x.body.msgParam);
// ---------- P1 group target ----------
{
  const r = await run('P1', 'g1', `Proactive group report.\n[FILE: ${ws}/report.txt]\nend`);
  L.check('P1 webhook accepted by the daemon', r.resp.status === 202 || r.resp.status === 200, `${r.resp.status} ${r.resp.body.slice(0, 80)}`);
  L.check('P1 one upload (type=file) with fixture bytes', r.up.length === 1 && r.up[0].query.type === 'file' && r.up[0].body.multipart[0].sha256 === L.sha256File(`${ws}/report.txt`));
  L.check('P1 groupMessages/send msgKey=sampleFile with {mediaId,fileName,fileType}', r.gf.length === 1 && JSON.stringify(param(r.gf[0])) === JSON.stringify({ mediaId: r.up[0].reply.media_id, fileName: 'report.txt', fileType: 'txt' }), JSON.stringify(r.gf[0]?.body));
  L.check('P1 file sent to the configured openConversationId with robotCode', r.gf[0]?.body.openConversationId === 'cidGroup1' && r.gf[0]?.body.robotCode === 'harnessClientId');
  L.check('P1 sampleMarkdown text follows the file, marker-free', r.gm.length === 1 && r.gf[0].t <= r.gm[0].t && param(r.gm[0]).text.includes('Proactive group report.') && noPath(r.out), JSON.stringify(param(r.gm[0] ?? { body: { msgParam: '{}' } })));
  L.check('P1 no DM API used for a group target', r.dm.length === 0);
}
// ---------- P2 direct target ----------
{
  const r = await run('P2', 'd1', `Proactive DM report.\n[FILE: ${ws}/report.pdf]`);
  L.check('P2 oToMessages/batchSend msgKey=sampleFile {mediaId,fileName,fileType}', r.df.length === 1 && JSON.stringify(param(r.df[0])) === JSON.stringify({ mediaId: r.up[0]?.reply.media_id, fileName: 'report.pdf', fileType: 'pdf' }), JSON.stringify(r.df[0]?.body));
  L.check('P2 DM file addressed to userIds=[owner-1]', JSON.stringify(r.df[0]?.body.userIds) === '["owner-1"]', JSON.stringify(r.df[0]?.body.userIds));
  L.check('P2 markdown follows the file, marker-free', r.dmd.length === 1 && r.df[0].t <= r.dmd[0].t && noPath(r.out));
  L.check('P2 no group API used for a DM target', r.g.length === 0);
}
// ---------- P3 pure file proactive ----------
{
  const r = await run('P3', 'g1', `[FILE: ${ws}/blob.bin]`);
  L.check('P3 pure-file proactive: sampleFile only, no sampleMarkdown', r.gf.length === 1 && r.gm.length === 0, `gf=${r.gf.length} gm=${r.gm.length}`);
}
// ---------- P4 missing processQueryKey (group / dm) ----------
{
  await L.setMode('group-nokey');
  const r = await run('P4a', 'g1', `Text\n[FILE: ${ws}/report.txt]`);
  L.check('P4a group reply without processQueryKey -> failure notice, no success claim', r.gf.length >= 1 && r.gm.length === 1 && param(r.gm[0]).text === 'Text\n[File delivery failed: report.txt]', JSON.stringify(param(r.gm[0] ?? { body: { msgParam: '{}' } })));
  L.check('P4a exactly one sampleFile attempt (no retry loop)', r.gf.length === 1, `attempts=${r.gf.length}`);
  await L.setMode('dm-nokey');
  const r2 = await run('P4b', 'd1', `[FILE: ${ws}/report.txt]`);
  L.check('P4b DM reply without processQueryKey -> failure notice as the only message', r2.df.length === 1 && r2.dmd.length === 1 && param(r2.dmd[0]).text === '[File delivery failed: report.txt]', JSON.stringify(r2.dmd.map(param)));
  await L.setMode('group-400');
  const r3 = await run('P4c', 'g1', `[FILE: ${ws}/report.txt]`);
  L.check('P4c HTTP 400 on the group file send -> failure notice, markdown still attempted', r3.gf.length >= 1 && r3.gm.length >= 1 && r3.out.includes('[File delivery failed: report.txt]'), `gf=${r3.gf.length} gm=${r3.gm.length} ${JSON.stringify(r3.gm.map(param))}`);
  await L.setMode('');
}
// ---------- P5 invalid file on the proactive path ----------
{
  const r = await run('P5', 'g1', `Oops\n[FILE: ${ws}/escape-link]\n[FILE: ${ws}/empty.txt]`);
  L.check('P5 proactive invalid files: zero uploads, basename notices only', r.up.length === 0 && r.gf.length === 0 && param(r.gm[0]).text === 'Oops\n[File delivery failed: escape-link]\n[File delivery failed: empty.txt]' && noPath(r.out), JSON.stringify(r.gm.map(param)));
}
L.summary();
