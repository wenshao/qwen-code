// Group C — status cards ON (PR arm): delivery must finish before the terminal card, streamed frames stay path-free
import * as L from './lib.mjs';
const ws = process.argv[2];
const say = (text, extra = '') => `SAYB64:${L.b64(text)} ${extra}`.trim();
const noPath = (s) => !s.includes(ws) && !s.includes('[FILE:');
let n = 0;
async function run(label, text, { isGroup = false, extra = 'CHUNK:3 DELAY:120', quiet = 4000 } = {}) {
  const id = `conv-c${++n}-${label}`;
  const t0 = await L.turn({ conversationId: id, directive: say(text, extra), isGroup });
  const e = await L.settle({ after: t0, quiet });
  const after = (xs) => xs.filter((x) => x.t > t0);
  const puts = after(L.cardUpdates(e));
  const streams = after(L.cardStreams(e));
  const finalPut = puts.find((p) => p.body?.cardData?.cardParamMap?.flowStatus === '3') ?? puts[puts.length - 1];
  return { t0, e, up: after(L.uploads(e)), files: after(L.fileSends(e)), md: after(L.mdSends(e)), puts, streams, finalPut, out: L.outText(e, t0) };
}
const cardText = (p) => p?.body?.cardData?.cardParamMap?.content;
// ---------- C1 text + file, streamed slowly ----------
{
  const r = await run('c1', `Here is the report.\n[FILE: ${ws}/report.txt]\nDone, see attachment.`);
  L.check('C1 file uploaded + sent exactly once', r.up.length === 1 && r.files.length === 1 && r.files[0].body.file.mediaId === r.up[0].reply.media_id);
  L.check('C1 upload and file message both precede the terminal card update (flowStatus=3)', r.finalPut && r.up[0].t <= r.finalPut.t && r.files[0].t <= r.finalPut.t, `file@${r.files[0]?.t - r.t0}ms final@${r.finalPut?.t - r.t0}ms`);
  L.check('C1 terminal card content = text without the marker line', cardText(r.finalPut) === 'Here is the report.\n\nDone, see attachment.', JSON.stringify(cardText(r.finalPut)));
  L.check('C1 several partial streaming frames were sent (slow model)', r.streams.filter((s) => !s.body.isFinalize).length >= 3, `frames=${r.streams.length}`);
  L.check('C1 NO streaming frame ever carried the marker or the path', r.streams.every((s) => noPath(JSON.stringify(s.body))), r.streams.map((s) => JSON.stringify(s.body.content)).join(' | ').slice(0, 300));
  L.check('C1 the last partial frame before finalize already shows text after the marker line', r.streams.some((s) => !s.body.isFinalize && String(s.body.content).includes('Done')), r.streams.map((s) => JSON.stringify(s.body.content)).join(' | ').slice(0, 300));
  L.check('C1 no fallback markdown message (card carries the text)', r.md.length === 0);
  L.check('C1 nothing on the wire leaks the path', noPath(r.out));
}
// ---------- C2 pure file with cards ----------
{
  const r = await run('c2', `[FILE: ${ws}/blob.bin]`);
  L.check('C2 pure file: delivered before the terminal card', r.files.length === 1 && r.finalPut && r.files[0].t <= r.finalPut.t);
  L.check('C2 (observation) terminal card content for a pure-file reply', typeof cardText(r.finalPut) === 'string', JSON.stringify(cardText(r.finalPut)));
  L.check('C2 no markdown fallback', r.md.length === 0);
}
// ---------- C3 upload failure with cards ----------
{
  await L.setMode('upload-auth-fail');
  const r = await run('c3', `Report:\n[FILE: ${ws}/report.txt]`);
  L.check('C3 auth failure: two upload attempts, no file message, notice lands in the terminal card', r.up.length === 2 && r.files.length === 0 && cardText(r.finalPut) === 'Report:\n[File delivery failed: report.txt]', JSON.stringify(cardText(r.finalPut)));
  L.check('C3 failed uploads all precede the terminal card', r.up.every((u) => u.t <= r.finalPut.t));
  await L.setMode('');
}
// ---------- C4 group session with cards, two files ----------
{
  const r = await run('c4', `Two files\n[FILE: ${ws}/m1.txt]\n[FILE: ${ws}/sub/nested.md]\nend`, { isGroup: true });
  L.check('C4 group + cards: two files delivered in order before the terminal card', r.files.map((f) => f.body.file.fileName).join() === 'm1.txt,nested.md' && r.files.every((f) => f.t <= r.finalPut.t), r.files.map((f) => f.body.file.fileName).join());
  L.check('C4 terminal card text path-free', cardText(r.finalPut) === 'Two files\n\n\nend' && noPath(r.out), JSON.stringify(cardText(r.finalPut)));
}
// ---------- C5 tool boundary with cards (marker only before the tool call) ----------
{
  const r = await run('c5', `All done.`, { extra: `TOOL PREB64:${L.b64(`Sending\n[FILE: ${ws}/report.txt]\n`)} CHUNK:3 DELAY:60` });
  L.check('C5 marker only before the tool boundary: no upload, unavailable notice in the terminal card', r.up.length === 0 && String(cardText(r.finalPut)).includes('[File delivery unavailable]'), JSON.stringify(cardText(r.finalPut)));
  L.check('C5 streamed frames never showed the marker/path', r.streams.every((s) => noPath(JSON.stringify(s.body))));
}
L.summary();
