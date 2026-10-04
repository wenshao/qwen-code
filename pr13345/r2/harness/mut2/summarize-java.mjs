// usage: node summarize-java.mjs <surefire-reports dir> <mvn log> <arm> <id> <lane>
import fs from 'node:fs';
const [dir, log, arm, id, lane] = process.argv.slice(2);
let files = [];
try {
  files = fs.readdirSync(dir).filter((f) => f.startsWith('TEST-') && f.endsWith('.xml'));
} catch {
  // no reports: a compile failure or a crashed fork
}
const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
if (files.length === 0) {
  const err = (text.match(/\[ERROR\][^\n]*/g) || []).slice(0, 3).join(' / ');
  console.log(`RESULT\t${arm}\t${id}\t${lane}\tNO_REPORT\ttotal=0\tfailed=0\t${err.slice(0, 300)}`);
  process.exit(0);
}
let total = 0;
const failed = [];
for (const f of files) {
  const xml = fs.readFileSync(`${dir}/${f}`, 'utf8');
  const cls = f.replace(/^TEST-/, '').replace(/\.xml$/, '').split('.').pop();
  const cases = xml.split('<testcase ').slice(1);
  for (const c of cases) {
    total += 1;
    const name = (c.match(/^name="([^"]*)"/) || [])[1];
    const tagEnd = c.indexOf('>');
    if (c[tagEnd - 1] === '/') continue;
    const body = c.slice(tagEnd + 1, c.indexOf('</testcase>'));
    const bad = body.match(/<(failure|error)\b([^>]*)>/);
    if (bad) {
      const message = (bad[2].match(/message="([^"]*)"/) || [])[1] || '';
      failed.push(`${cls}.${name} [${bad[1]}: ${message.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, ' ').replace(/&amp;/g, '&').slice(0, 140)}]`);
    }
  }
}
console.log(
  ['RESULT', arm, id, lane, `classes=${files.length}`, `total=${total}`, `failed=${failed.length}`, failed.join(' | ')].join('\t'),
);
