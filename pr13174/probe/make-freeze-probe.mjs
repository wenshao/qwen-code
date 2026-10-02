// VERIFICATION RIG ONLY (PR #13174): derive scripts/probe-freeze.ts from the PR runner using snippet files.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [src, dst] = process.argv.slice(2);
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'snips');
const snip = (name) => readFileSync(path.join(dir, name), 'utf8');
let s = readFileSync(src, 'utf8');
function rep(anchor, replacement) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) throw new Error(`anchor found ${n}x: ${anchor.slice(0, 90)}`);
  s = s.split(anchor).join(replacement);
}
rep('type HeldExecutionStartProxy = {\n', snip('a-proxy.ts'));
rep('  const brokerPort = await freePort();\n', snip('b-ports.ts'));
rep("              QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: `http://127.0.0.1:${springPort}`,\n", snip('c-env.ts'));
rep("        60_000,\n        replacementSpring,\n      );\n", snip('d-repoint.ts'));
rep("        signalProcessTree(harness.child, 'SIGCONT');\n", snip('e-wake.ts'));
rep("        await new Promise((resolve) => setTimeout(resolve, 5_000));\n        const headAfterWake", snip('f-afterwake.ts').replace(/\n$/, ''));
rep("          headAfterWake !== headBeforeWake ||\n", "          (process.env['PROBE_FIXED_ASSERT'] === '1' ? formerWriterTxAfterWake !== 0 || formerLeaseRenewedAfterWake !== 0 : headAfterWake !== headBeforeWake) ||\n");
rep("\nif (failure) throw failure;\n", "\nif (failure) throw failure;\nprocess.exit(0); // probe: the store proxy keeps the loop alive\n");
writeFileSync(dst, s);
console.log('probe written', dst, s.length);
