// S1-real (PR #13225): the public lifecycle against a REAL Aliyun OSS temp bucket (Linux durable stack).
// A: close + DELETE -> collected; B: sibling Session left open. Object presence is checked in the real bucket.
import * as L from './lib.mjs';
import { execFileSync } from 'node:child_process';
const RO = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/realoss/ro.sh';
const ro = (cmd, input) => execFileSync(RO, [cmd], { encoding: 'utf8', input }).trim();
const SO = Number(process.env.SO ?? 5 * 1024 * 1024 + 4099), SE = 1024 * 1024 + 77;
const TAG = process.env.TAG ?? `s1r-${Date.now().toString(36)}`;
L.openLog(TAG);
async function lifecycle(session, kind, method, url) {
  const t0 = Date.now();
  const r = await L.api(method, url, undefined, { key: `${kind}-${TAG}` });
  let op = r.json;
  for (let i = 0; i < 240 && r.status < 300; i++) { op = (await L.api('GET', `/v1/agents/sessions/${session}/operations/${r.json?.id}`)).json; if (/completed|failed/.test(String(op?.status))) break; await L.sleep(250); }
  return `${r.status} ${op?.status ?? r.json?.error?.code} ${Date.now() - t0}ms`;
}
const keys = (s) => L.sql(`SELECT o.object_key FROM qwen_tool_publication_object o JOIN qwen_tool_publication p USING (scope_key, publication_id) WHERE p.session_id='${s}' AND o.object_key IS NOT NULL`).map((r) => r[0]);
const pub = (s) => L.sql(`SELECT retention_state, IFNULL(gc_blocker,'-'), gc_generation, capture_held_bytes+producer_held_bytes+admission_held_bytes, IFNULL(released_held_bytes,'-') FROM qwen_tool_publication WHERE session_id='${s}'`)[0].join(' ');
const make = async (n, st) => { const ws = `ws-${TAG}-${n}`; L.register(ws, st); const s = await L.createShellSession(ws, L.shellPrompt(`s1r${n}`, L.genCmd(`${TAG}-${n}`, SO, SE, 0)), { key: `k-${TAG}-${n}` }); const t = await L.waitTurn(s, { timeoutMs: 900_000 }); const p = await L.waitProjection(s, { timeoutMs: 600_000 }); return { s, turn: t.status, ms: t.ms, results: p.rows.map((r) => r.state) }; };
const A = await make('a', process.env.ST_A ?? 'st-s26'), B = await make('b', process.env.ST_B ?? 'st-s27');
L.say('made', { A, B });
for (const [n, x] of [['A', A], ['B', B]]) {
  const a = (await L.artifacts(x.s)).list.find((y) => y.stream_role === 'stdout');
  L.say(`read-${n}`, await L.downloadCheck(x.s, a, L.genSha(`${TAG}-${n.toLowerCase()}`, 'stdout', SO)));
}
const kA = keys(A.s), kB = keys(B.s);
L.say('bucket-before', { A: ro('exists', kA.join('\n')), B: ro('exists', kB.join('\n')), info: ro('info') });
L.say('close-A', await lifecycle(A.s, 'close', 'POST', `/v1/agents/sessions/${A.s}/close`));
L.say('delete-A', await lifecycle(A.s, 'delete', 'DELETE', `/v1/agents/sessions/${A.s}`));
const retiredAt = Number(L.retirement(A.s)[2]);
let last = '';
for (let i = 0; i < 1200; i++) {
  const k = pub(A.s);
  if (k !== last) { L.say(`+${((Number(L.one('SELECT ROUND(UNIX_TIMESTAMP(NOW(3))*1000)')) - retiredAt) / 1000).toFixed(1)}s`, k); last = k; }
  if (k.startsWith('COLLECTED')) break;
  await L.sleep(150);
}
L.say('bucket-after', { A: ro('exists', kA.join('\n')), B: ro('exists', kB.join('\n')), info: ro('info'), Bpub: pub(B.s) });
const b = (await L.artifacts(B.s)).list.find((y) => y.stream_role === 'stdout');
L.say('read-B-after', await L.downloadCheck(B.s, b, L.genSha(`${TAG}-b`, 'stdout', SO)));
