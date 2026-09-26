import fs from 'node:fs';
import { makeCase, FIXED } from './gen-cases.mjs';
const N = Number(process.argv[3] ?? 600);
const cases = [...FIXED];
for (let i = 0; i < N; i++) cases.push(makeCase(i));
fs.writeFileSync(process.argv[4] ?? 'cases.json', JSON.stringify(cases));
console.log(cases.length, 'cases');
