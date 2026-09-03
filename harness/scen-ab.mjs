// Reduced A/B: same inputs on any arm/config; prints what happened, asserts arm-specific expectations
import * as L from './lib.mjs';
import fs from 'node:fs';
const ws = process.argv[2];
const expect = process.argv[3]; // 'deliver' | 'redact'
const modelLog = process.argv[4];
const say = (text, extra = 'CHUNK:4') => `SAYB64:${L.b64(text)} ${extra}`.trim();
const noPath = (s) => !s.includes(ws) && !s.includes('[FILE:');
let n = 0;
async function run(label, text, { isGroup = false } = {}) {
  const t0 = await L.turn({ conversationId: `conv-ab${++n}-${label}`, directive: say(text), isGroup });
  const e = await L.settle({ after: t0, quiet: 2500 });
  const after = (xs) => xs.filter((x) => x.t > t0);
  return { t0, up: after(L.uploads(e)), files: after(L.fileSends(e)), md: after(L.mdSends(e)), out: L.outText(e, t0) };
}
const r1 = await run('s1', `Here is the report.\n[FILE: ${ws}/report.txt]\nDone.`);
const r2 = await run('s2', `[FILE: ${ws}/blob.bin]`);
const r5 = await run('s5', `Bad:\n[FILE: ${ws}/escape-link]\n[FILE: ${ws}/missing.txt]`);
const last = JSON.parse(fs.readFileSync(modelLog, 'utf8').trim().split('\n').pop());
if (expect === 'deliver') {
  L.check('AB text+file: upload + file message + marker-free markdown', r1.up.length === 1 && r1.files.length === 1 && r1.md[0]?.body.markdown.text === 'Here is the report.\n\nDone.', JSON.stringify(r1.md.map((m) => m.body.markdown.text)));
  L.check('AB pure file: file message only', r2.up.length === 1 && r2.files.length === 1 && r2.md.length === 0);
  L.check('AB invalid: no upload, basename notices', r5.up.length === 0 && r5.md[0]?.body.markdown.text === 'Bad:\n[File delivery failed: escape-link]\n[File delivery failed: missing.txt]', JSON.stringify(r5.md.map((m) => m.body.markdown.text)));
  L.check('AB prompt advertises [FILE: ...] delivery (channel instructions, static context of the session)', last.promptHasFileInstr === true, JSON.stringify({ file: last.promptHasFileInstr, image: last.promptHasImageInstr, in: last.fileInstrIn }));
} else {
  L.check('AB text+file: NO upload, NO file message, marker redacted + "[File delivery unavailable]"', r1.up.length === 0 && r1.files.length === 0 && r1.md[0]?.body.markdown.text === 'Here is the report.\n\nDone.\n[File delivery unavailable]', JSON.stringify(r1.md.map((m) => m.body.markdown.text)));
  L.check('AB pure file: only the unavailable notice is sent', r2.up.length === 0 && r2.files.length === 0 && r2.md[0]?.body.markdown.text === '[File delivery unavailable]', JSON.stringify(r2.md.map((m) => m.body.markdown.text)));
  L.check('AB invalid: no upload, generic notice (no per-file notices)', r5.up.length === 0 && r5.md[0]?.body.markdown.text === 'Bad:\n[File delivery unavailable]', JSON.stringify(r5.md.map((m) => m.body.markdown.text)));
  L.check('AB prompt does NOT advertise [FILE: ...] (image instruction presence shown for reference)', last.promptHasFileInstr === false, JSON.stringify({ file: last.promptHasFileInstr, image: last.promptHasImageInstr, in: last.fileInstrIn }));
}
L.check('AB no path leaked on any arm', noPath(r1.out + r2.out + r5.out));
L.summary();
