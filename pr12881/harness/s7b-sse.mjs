// S7b: raw SSE capture for a subscriber across close, archive, unarchive and delete.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SP, OUT, TENANT, openLog, say, freshDb, startModel, startProxy, startHarness, startSpring, api, short, createSession, awaitTurn, awaitOperation, sleep, stopAll } from './lib.mjs';
const [TAG = 'pr', ENGINE = 'mysql'] = process.argv.slice(2);
const DB = `s7b_${TAG}_${ENGINE}`;
openLog(`s7b-sse-${TAG}-${ENGINE}`);
freshDb(ENGINE, DB);
await startModel(18800);
await startHarness('h', 18811, 18800);
await startProxy('jh', 18821, 18811, 18831);
await startProxy('store', 18841, 18801, 18851);
await startSpring('a', { jar: path.join(SP, 'jars', `${TAG}-server.jar`), engine: ENGINE, db: DB, port: 18801, harnessPort: 18821, storePort: 18841 });
const S = 18801;
const id = await createSession(S, { input: 'SSE' });
await awaitTurn(S, id);
const t0 = Date.now();
const log = [];
const mark = (m) => log.push(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${m}`);
const res = await fetch(`http://127.0.0.1:${S}/v1/agents/sessions/${id}/events?stream=true`, { headers: { 'X-Qwen-Tenant-Id': TENANT, accept: 'text/event-stream' } });
mark(`subscribed ${res.status} ${res.headers.get('content-type')}`);
let raw = '';
const reader = (async () => {
  const dec = new TextDecoder();
  try {
    for await (const c of res.body) {
      const s = dec.decode(c, { stream: true });
      raw += s;
      for (const t of s.matchAll(/"type"\s*:\s*"([a-z_.]+)"/g)) mark(`  <- ${t[1]}`);
    }
    mark('stream ended by server');
  } catch (e) { mark(`stream error ${e.name}`); }
})();
await sleep(1000);
let r = await api(S, 'POST', `/v1/agents/sessions/${id}/close`, { idem: randomUUID() });
mark(`POST close -> ${short(r)}`);
await awaitOperation(S, id, r.json.id);
mark('close operation completed');
await sleep(1500);
r = await api(S, 'POST', `/v1/agents/sessions/${id}/archive`, { idem: randomUUID() });
mark(`POST archive -> ${r.status}`);
r = await api(S, 'POST', `/v1/agents/sessions/${id}/unarchive`, { idem: randomUUID() });
mark(`POST unarchive -> ${r.status}`);
await sleep(1500);
r = await api(S, 'DELETE', `/v1/agents/sessions/${id}`, { idem: randomUUID() });
mark(`DELETE -> ${r.status}`);
await awaitOperation(S, id, r.json.id);
mark('delete operation completed');
await sleep(4000);
mark('end of observation');
fs.writeFileSync(path.join(OUT, `s7b-sse-raw-${TAG}-${ENGINE}.txt`), raw);
for (const l of log) say('sse', l);
stopAll();
process.exit(0);
