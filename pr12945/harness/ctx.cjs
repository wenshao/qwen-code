// usage: node ctx.cjs <file> <anchor> [before] [after]
const fs = require('fs');
const [file, anchor, b = 200, a = 300] = process.argv.slice(2);
const s = fs.readFileSync(file, 'utf8');
let i = -1, n = 0;
while ((i = s.indexOf(anchor, i + 1)) >= 0) {
  n++;
  console.log(`--- #${n} @${i}\n${s.slice(Math.max(0, i - b), i)}⟦${anchor}⟧${s.slice(i + anchor.length, i + anchor.length + +a)}\n`);
}
if (!n) console.log('NOT FOUND');
