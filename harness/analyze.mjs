/** Replay the fake-server ledger into a human-readable transcript. */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
const reqs = lines.map((l) => JSON.parse(l).body);

const MARKERS = ['QWEN-VERIFY-DRIVER-10083', 'QWEN-VERIFY-NOTEAM-10083', 'QWEN-VERIFY-TUI-10083'];
const isLeader = (b) => {
  const t = JSON.stringify(b.messages ?? []);
  return MARKERS.some((m) => t.includes(m));
};

const leaderReqs = reqs.filter((b) => b.stream === true && isLeader(b));
const last = leaderReqs[leaderReqs.length - 1];
if (!last) {
  console.log('NO LEADER REQUESTS');
  process.exit(1);
}

console.log(`total requests: ${reqs.length}  leader streaming turns: ${leaderReqs.length}`);
console.log('='.repeat(72));

const byId = new Map();
for (const m of last.messages) {
  if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
    for (const tc of m.tool_calls) byId.set(tc.id, tc);
  }
}
let n = 0;
for (const m of last.messages) {
  if (m.role !== 'tool') continue;
  const tc = byId.get(m.tool_call_id);
  const name = tc?.function?.name ?? '?';
  const args = tc?.function?.arguments ?? '';
  const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
  console.log(`\n[#${++n}] CALL ${name} ${args}`);
  console.log(`     RESULT: ${content.replace(/\n/g, '\n             ')}`);
}

console.log('\n' + '='.repeat(72));
console.log('DELIVERY PROBE — sentinel occurrences outside the leader session:');
const SENTINELS = [
  'SENTINEL-AMBIGUOUS-DESTINATION',
  'SENTINEL-HINT-CASE',
  'SENTINEL-GENERIC-CASE',
  'SENTINEL-MIRROR-CASE',
  'SENTINEL-LEADER-CASE',
];
for (const s of SENTINELS) {
  const hits = reqs.filter((b) => !isLeader(b) && JSON.stringify(b.messages ?? []).includes(s));
  console.log(`  ${s}: ${hits.length} non-leader request(s) carried it`);
}
