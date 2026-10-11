// VERIFICATION RIG ONLY (PR #13773): detach one Session from the Harness exactly as a Spring client would (its own client id).
import fs from 'node:fs';
import { HTOKEN, HARNESS_PORT, TAP_LOG, sql, closeDb, j } from './lib.mjs';
const s = process.argv[2];
const cap = await fetch(`http://127.0.0.1:${HARNESS_PORT}/capabilities`, { headers: { Authorization: `Bearer ${HTOKEN}` } });
const capJson = await cap.json().catch(() => ({}));
const boot = capJson.hostedHarness?.bootId;
const tapEntries = fs.readFileSync(TAP_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const clientId = tapEntries.filter((e) => e.path.includes(s) && e.clientId).at(-1)?.clientId;
const r = await fetch(`http://127.0.0.1:${HARNESS_PORT}/session/${s}/detach`, { method: 'POST', headers: { Authorization: `Bearer ${HTOKEN}`, 'Content-Type': 'application/json', 'X-Qwen-Harness-Protocol-Version': '1', ...(boot ? { 'X-Qwen-Harness-Boot-Id': boot } : {}), ...(clientId ? { 'X-Qwen-Client-Id': clientId } : {}) }, body: '{}' });
console.log(`detach ${s} boot=${boot} client=${clientId} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
console.log('leases', j((await sql('SELECT runtime_session_id, holder_key FROM managed_workspace_execution_lease')).map((x) => `${x.runtime_session_id}:${x.holder_key ? 'held' : 'free'}`)));
await closeDb();
