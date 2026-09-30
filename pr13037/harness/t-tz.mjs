// JVM in Asia/Shanghai, MySQL in UTC: does projection still work and what timestamps come out?
import * as L from './lib.mjs';
L.register('ws-tz', 'st-s58');
const session = await L.createShellSession('ws-tz', L.shellPrompt('Timezone case', 'echo tz'));
await L.waitTurn(session);
const p = await L.waitProjection(session, { timeoutMs: 30000 });
const ev = (await L.events(session)).find((e) => e.type === 'item.tool_result.updated');
const art = ev?.data.result.artifacts[0];
console.log(JSON.stringify({ source: p.rows.map((r) => `${r.state}#${r.attempts}`), projectionMs: p.ms, eventCreatedAt: ev && new Date(ev.created_at * 1000).toISOString(), artifactCreatedAt: art && new Date(art.created_at).toISOString(), artifactMinusEventHours: art && +((art.created_at - ev.created_at * 1000) / 3600000).toFixed(2), wallClock: new Date().toISOString() }));
