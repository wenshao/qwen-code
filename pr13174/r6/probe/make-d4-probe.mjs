// VERIFICATION RIG ONLY (PR #13174 round 3): D4 lost-reply probe derived from the PR runner.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [src, dst] = process.argv.slice(2);
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'snips-d4');
const snip = (name) => readFileSync(path.join(dir, name), 'utf8');
let s = readFileSync(src, 'utf8');
function rep(anchor, replacement) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) throw new Error(`anchor found ${n}x: ${anchor.slice(0, 90)}`);
  s = s.split(anchor).join(replacement);
}
rep('type HeldExecutionStartProxy = {\n', snip('a-proxy.ts'));
rep('  const brokerPort = await freePort();\n', snip('b-ports.ts'));
rep('        QWEN_MANAGED_AGENT_HARNESS_BASE_URL: `http://127.0.0.1:${harnessPort}`,\n', snip('c-env.ts'));
rep('      if (serialized.includes(failoverSecondMarker)) {\n', snip('d-fake.ts'));
rep('    if (freeze) {\n      // Freeze the writer side only', snip('e-precrash.ts').replace(/\n$/, ''));
rep('      60_000,\n      replacementHarness,\n    );\n', snip('f-release.ts'));
rep('    } else {\n      const secondResponse = await fetch(\n', snip('g-branch.ts'));
rep("\nif (failure) throw failure;\n", "\nif (failure) throw failure;\nprocess.exit(0); // probe: after the runner teardown; the drop proxy keeps the loop alive\n");
writeFileSync(dst, s);
console.log('probe written', dst, s.length);
