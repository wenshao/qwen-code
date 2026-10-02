// VERIFICATION RIG ONLY (PR #13174): Harness restarted onto an older build (PROBE_REPLACEMENT_CLI) then rolled forward.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [src, dst] = process.argv.slice(2);
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'snips-rb');
const snip = (name) => readFileSync(path.join(dir, name), 'utf8');
let s = readFileSync(src, 'utf8');
function rep(anchor, replacement) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) throw new Error(`anchor found ${n}x: ${anchor.slice(0, 90)}`);
  s = s.split(anchor).join(replacement);
}
rep('      if (serialized.includes(failoverSecondMarker)) {\n', snip('a-fake.ts'));
rep("      [\n        cliBundle,\n        'serve',", "      [\n        process.env['PROBE_REPLACEMENT_CLI'] ?? cliBundle,\n        'serve',");
rep('    } else {\n      const secondResponse = await fetch(\n', snip('b-branch.ts'));
writeFileSync(dst, s);
console.log('probe written', dst, s.length);
