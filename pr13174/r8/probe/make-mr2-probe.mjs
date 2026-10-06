// VERIFICATION RIG ONLY (PR #13174 round 4): layer cancel-after-death + close/new-session onto probe-model-round.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [src, dst] = process.argv.slice(2);
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'snips-mr2');
const snip = (name) => readFileSync(path.join(dir, name), 'utf8');
let s = readFileSync(src, 'utf8');
function rep(anchor, replacement) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) throw new Error(`anchor found ${n}x: ${anchor.slice(0, 90)}`);
  s = s.split(anchor).join(replacement);
}
rep("const probeModelRoundMarker = 'PROBE_MODEL_ROUND_TURN';\n", snip('a-decl.ts'));
rep('      if (r.status !== 202) throw new Error(`probe Turn 2 submit returned ${r.status}: ${await r.text()}`);\n', snip('b-capture.ts'));
rep('      await crashChild(harness.child, `${hostedHarnessLabel} (original)`);\n', snip('c-cancel.ts'));
rep("      console.log(JSON.stringify({\n        probe: 'model-requests',\n", snip('d-close.ts'));
rep("        const createStarted = Date.now();\n", snip("e-escape.ts"));
writeFileSync(dst, s);
console.log('probe written', dst, s.length);
