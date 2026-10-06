// VERIFICATION RIG ONLY (PR #13174 round 8): ownerless approval takeover (reviewer P1 #2), derived from the PR runner (--inflight-failover --harness-only).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [src, dst] = process.argv.slice(2);
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'snips-ap');
const snip = (name) => readFileSync(path.join(dir, name), 'utf8');
let s = readFileSync(src, 'utf8');
function rep(anchor, replacement, count = 1) {
  const n = s.split(anchor).length - 1;
  if (n !== count) throw new Error(`anchor found ${n}x (want ${count}): ${anchor.slice(0, 90)}`);
  s = s.split(anchor).join(replacement);
}
function replaceRange(startAnchor, endAnchor, replacement) {
  const a = s.indexOf(startAnchor);
  const b = s.indexOf(endAnchor, a + startAnchor.length);
  if (a < 0 || b < 0) throw new Error(`range not found: ${startAnchor.slice(0, 60)}`);
  s = s.slice(0, a) + replacement + s.slice(b + endAnchor.length);
}
rep("QWEN_MANAGED_AGENT_APPROVAL_MODE: 'yolo',", "QWEN_MANAGED_AGENT_APPROVAL_MODE: process.env['PROBE_APPROVAL_MODE'] ?? 'default', ...(process.env['PROBE_TURN_DEADLINE'] ? { QWEN_MANAGED_AGENT_HARNESS_TURN_DEADLINE: process.env['PROBE_TURN_DEADLINE'] } : {}), ...(process.env['PROBE_APPROVAL_TIMEOUT'] ? { QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT: process.env['PROBE_APPROVAL_TIMEOUT'] } : {}),", 2);
rep('let acceptReplacementContinuation = false;\n', 'let acceptReplacementContinuation = false;\nlet probeApprovalAction: Record<string, unknown> | undefined;\n');
replaceRange('    if (inflightFailover) {\n      if (heldStartProxy === undefined) {', '    } else if (continuationFailover) {\n', snip('c-precrash.ts'));
rep('    if (inflightFailover) {\n      const execution = runMysql(\n', "    if (inflightFailover && process.env['PROBE_AP_KEEP_AUDIT'] === '1') {\n      const execution = runMysql(\n");
replaceRange('    if (inflightFailover) {\n      const recoveredTurn = await waitForTerminal(', '    } else if (continuationFailover) {\n', snip('e-post.ts'));
writeFileSync(dst, s);
console.log('probe written', dst, s.length);
