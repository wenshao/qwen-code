// Adds N prepared (reserved, never started) executions to arm A.
import * as d from './drive.mjs';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
const [label, count = '130'] = process.argv.slice(2);
const arms = JSON.parse(fs.readFileSync(`/rig/out/${label}-arms.json`, 'utf8')).arms;
const A = arms.A; let ok = 0; const bad = {};
for (let i = 0; i < Number(count); i++) {
  const callId = `prep-${i}`;
  const digest = `sha256:${createHash('sha256').update(callId).digest('hex')}`;
  const r = await d.http('POST', `${d.BROKER}/executions:prepare`, { headers: { Authorization: `Bearer ${d.TOKEN}` },
    body: { protocolVersion: 1, requestId: `rq-${randomUUID()}`, idempotencyKey: `idem-${A.sid}-${callId}`, harnessSessionId: A.sid,
      runtimeSessionId: A.rsid, turnId: 'prompt-1', toolCallId: callId, requestDigest: digest,
      reference: { sessionId: A.rsid, promptId: 'prompt-1', callId, argsDigest: digest } } });
  if (r.status === 200) ok++; else bad[`${r.status} ${r.json?.code}`] = (bad[`${r.status} ${r.json?.code}`] ?? 0) + 1;
}
console.log(d.now(), `prepared ok=${ok}`, JSON.stringify(bad));
console.log(d.sql('SELECT LEFT(binding_id,8) bid, execution_state, COUNT(*) n FROM qwen_tool_execution GROUP BY binding_id, execution_state ORDER BY 1,2', { header: true }));
