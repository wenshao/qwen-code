// VERIFICATION RIG ONLY (PR #13174): build the candidate D7 runner fix from the PR runner.
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
rep("import { createServer, type Server } from 'node:http';", "import { createServer, request as httpRequest, type Server } from 'node:http';");
rep('type HeldExecutionStartProxy = {\n', snip('a-forwarder.ts'));
rep('let heldStartProxy: HeldExecutionStartProxy | undefined;\n', 'let heldStartProxy: HeldExecutionStartProxy | undefined;\nlet storeForwarder: StoreForwarder | undefined;\n');
rep('  const brokerPort = await freePort();\n', '  const brokerPort = await freePort();\n  if (freeze) storeForwarder = await startStoreForwarder(springPort);\n');
rep("              QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: `http://127.0.0.1:${springPort}`,\n",
    "              QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL:\n                storeForwarder?.baseUrl ?? `http://127.0.0.1:${springPort}`,\n");
const start = s.indexOf('      if (freeze) {\n        // Wake the frozen Harness only after');
const keep = s.indexOf('        const awakeEvents = await fetchJson', start);
if (start < 0 || keep < 0) throw new Error('freeze block anchors');
s = s.slice(0, start) + snip('b-freeze.ts') + s.slice(keep);
const assertStart = s.indexOf('        if (\n          headAfterWake !== headBeforeWake ||');
const assertEnd = s.indexOf('    } else {\n      const secondResponse = await fetch(', assertStart);
if (assertStart < 0 || assertEnd < 0) throw new Error('assert anchors');
s = s.slice(0, assertStart) + snip('c-freeze-assert.ts') + s.slice(assertEnd);
rep('  await replacementBrokerProxy?.close();\n', '  await replacementBrokerProxy?.close();\n  await storeForwarder?.close();\n');
writeFileSync(dst, s);
console.log('candidate written', dst);
