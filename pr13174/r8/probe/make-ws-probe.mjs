// VERIFICATION RIG ONLY (PR #13174 round 8): workspace-session variant of B, derived from the PR runner (--inflight-failover --harness-only).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [src, dst] = process.argv.slice(2);
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'snips-ws');
const snip = (name) => readFileSync(path.join(dir, name), 'utf8');
let s = readFileSync(src, 'utf8');
function rep(anchor, replacement) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) throw new Error(`anchor found ${n}x: ${anchor.slice(0, 90)}`);
  s = s.split(anchor).join(replacement);
}
function replaceRange(startAnchor, endAnchor, replacement, from = 0) {
  const a = s.indexOf(startAnchor, from);
  const b = s.indexOf(endAnchor, a + startAnchor.length);
  if (a < 0 || b < 0) throw new Error(`range not found: ${startAnchor.slice(0, 60)}`);
  s = s.slice(0, a) + replacement + s.slice(b + endAnchor.length);
}
rep('let acceptReplacementContinuation = false;\n', snip('a-decl.ts'));
s = s.split("QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo',").join("QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo', ...(process.env['PROBE_TURN_DEADLINE'] ? { QWEN_MANAGED_AGENT_HARNESS_TURN_DEADLINE: process.env['PROBE_TURN_DEADLINE'] } : {}), ...(process.env['PROBE_APPROVAL_TIMEOUT'] ? { QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT: process.env['PROBE_APPROVAL_TIMEOUT'] } : {}),");
rep("      if (inflightFailover && serialized.includes(inflightMarker)) {\n        if (!serialized.includes('\"role\":\"tool\"')) {\n", snip('b-fake.ts') + "        if (!serialized.includes('\"role\":\"tool\"')) {\n");
// pre-crash: the first `if (inflightFailover) {` block that waits for the Runtime execution start boundary
replaceRange('    if (inflightFailover) {\n      if (heldStartProxy === undefined) {', '    } else if (continuationFailover) {\n', snip('c-precrash.ts'));
// skip the post-firstHead in-flight durability audit
rep('    if (inflightFailover) {\n      const execution = runMysql(\n', '    if (inflightFailover && process.env[\'PROBE_WS_KEEP_AUDIT\'] === \'1\') {\n      const execution = runMysql(\n');
rep('    acceptReplacementContinuation = true;\n    releaseContinuationHold();\n', snip('d-release.ts'));
// post-restart: replace the in-flight recovered-turn audit with the probe report
replaceRange('    if (inflightFailover) {\n      const recoveredTurn = await waitForTerminal(', '    } else if (continuationFailover) {\n', snip('e-post.ts'));
writeFileSync(dst, s);
console.log('probe written', dst, s.length);
