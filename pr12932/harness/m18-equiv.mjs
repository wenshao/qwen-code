// M18 equivalence: (1) every string the Turn cursor grammar accepts encodes to
// base64 with neither '-'/'_' nor '+'/'/'; (2) any input a standard decoder
// accepts but the URL decoder rejects ('+' or '/') decodes to a string the
// grammar rejects. Exhaustive over byte triples + random cursors.
const RE = /^(0|[1-9][0-9]{0,18}):([A-Za-z0-9_-]{1,64})$/;
const alpha = '0123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';
let bad1 = 0;
for (const a of alpha) for (const b of alpha) for (const c of alpha) {
  if (/[-_+/]/.test(Buffer.from(a + b + c).toString('base64url')) || /[+/]/.test(Buffer.from(a + b + c).toString('base64'))) bad1++;
}
let bad2 = 0;
let tried = 0;
const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
for (let i = 0; i < 2_000_000; i++) {
  let s = '';
  const n = 4 * (1 + Math.floor(Math.random() * 24));
  for (let j = 0; j < n; j++) s += b64[Math.floor(Math.random() * 64)];
  if (!/[+/]/.test(s)) continue;
  tried++;
  if (RE.test(Buffer.from(s, 'base64').toString('utf8'))) bad2++;
}
console.log(`triples over the grammar alphabet: ${alpha.length ** 3}, encodings containing -,_,+,/: ${bad1}`);
console.log(`random standard-base64 inputs containing + or /: ${tried}, decoding to a valid cursor: ${bad2}`);
