// S1-real-v: real bucket with versioning Enabled after the output was written -> collection must fail closed.
import * as L from './lib.mjs';
import { execFileSync } from 'node:child_process';
const RO = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/04b34643-e8fb-486a-9fe8-2fb38ee689ef/scratchpad/realoss/ro.sh';
const ro = (args, input) => execFileSync(RO, args, { encoding: 'utf8', input }).trim();
const TAG = `s1rv-${Date.now().toString(36)}`, SO = 3 * 1024 * 1024 + 5;
L.openLog(TAG);
async function lifecycle(s, kind, method, url) { const r = await L.api(method, url, undefined, { key: `${kind}-${TAG}` }); let op; for (let i = 0; i < 240 && r.status < 300; i++) { op = (await L.api('GET', `/v1/agents/sessions/${s}/operations/${r.json?.id}`)).json; if (/completed|failed/.test(String(op?.status))) break; await L.sleep(250); } return `${r.status} ${op?.status ?? r.json?.error?.code}`; }
const ws = `ws-${TAG}`; L.register(ws, process.env.ST ?? 'st-s28');
const s = await L.createShellSession(ws, L.shellPrompt('s1rv', L.genCmd(TAG, SO, 0, 0)), { key: `k-${TAG}` });
await L.waitTurn(s, { timeoutMs: 600_000 }); await L.waitProjection(s, { timeoutMs: 300_000 });
const keys = L.sql(`SELECT o.object_key FROM qwen_tool_publication_object o JOIN qwen_tool_publication p USING (scope_key, publication_id) WHERE p.session_id='${s}' AND o.object_key IS NOT NULL`).map((r) => r[0]);
L.say('versioning', ro(['versioning', 'Enabled']));
L.say('close', await lifecycle(s, 'close', 'POST', `/v1/agents/sessions/${s}/close`));
L.say('delete', await lifecycle(s, 'delete', 'DELETE', `/v1/agents/sessions/${s}`));
const t0 = Date.now(); let last = '';
while (Date.now() - t0 < 85_000) {
  const k = L.sql(`SELECT retention_state, IFNULL(gc_blocker,'-'), gc_generation, capture_held_bytes+producer_held_bytes+admission_held_bytes FROM qwen_tool_publication WHERE session_id='${s}'`)[0].join(' ');
  if (k !== last) { L.say(`+${((Date.now() - t0) / 1000).toFixed(1)}s`, k); last = k; }
  await L.sleep(300);
}
L.say('bucket', { keys: ro(['exists'], keys.join('\n')), info: ro(['info']) });
const log = execFileSync('/Users/wenshao/pr13225-rig/lxx.sh', [`grep -h "Tool output collection will retry" /Users/wenshao/pr13225-rig/run/lx-real1/spring-*.log | tail -1 | cut -c1-260; grep -h -A1 "Tool output collection will retry" /Users/wenshao/pr13225-rig/run/lx-real1/spring-*.log | grep -m1 -o "IllegalStateException: [^\\"]*"`], { encoding: 'utf8' });
L.say('collector-log', log.trim().split('\n'));
