// Rewrites the candidate's attach() name check to the NUL escape and prints
// the resulting source text and the character it denotes.
import fs from 'node:fs';
const f = process.argv[2];
const BS = String.fromCharCode(92);
let s = fs.readFileSync(f, 'utf8');
const wrong = `unitName.includes('${BS}${BS}0')`;
const right = `unitName.includes('${BS}0')`;
if (s.split(wrong).length - 1 !== 1) throw new Error('expected exactly one wrong form');
s = s.replace(wrong, () => right);
fs.writeFileSync(f, s);
const line = s.split('\n').find((l) => l.includes('unitName.includes('));
console.log(line.trim());
const literal = line.match(/unitName\.includes\('([^']*)'\)\)/)[1];
const value = eval(`'${literal}'`);
console.log('literal source:', JSON.stringify(literal), 'evaluates to char codes:', [...value].map((c) => c.charCodeAt(0)));
