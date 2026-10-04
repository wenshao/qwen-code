// usage: node summarize-ts.mjs <vitest json> <arm> <id>  -> one TSV RESULT line
import fs from 'node:fs';
const [file, arm, id] = process.argv.slice(2);
let r;
try {
  r = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.log(`RESULT\t${arm}\t${id}\tts\tNO_REPORT\ttotal=0\tfailed=0\t${String(error.message).slice(0, 80)}`);
  process.exit(0);
}
const failed = [];
for (const f of r.testResults) {
  const rel = f.name.split('/managed-runtime/')[1];
  const fails = f.assertionResults.filter((a) => a.status === 'failed');
  for (const a of fails) failed.push(`${rel} :: ${a.fullName}`);
  if (f.status === 'failed' && fails.length === 0) {
    failed.push(`${rel} :: FILE_ERROR ${(f.message || '').split('\n')[0].slice(0, 160)}`);
  }
}
console.log(
  [
    'RESULT',
    arm,
    id,
    'ts',
    `files=${r.numTotalTestSuites}`,
    `total=${r.numTotalTests}`,
    `failed=${failed.length}`,
    failed.join(' | '),
  ].join('\t'),
);
