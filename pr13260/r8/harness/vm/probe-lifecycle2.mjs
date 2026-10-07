import * as L from './lib.mjs';
import * as P from './pop.mjs';
const model = await L.startModel();
const h = await new L.Harness({ name: 'probe-lc', modelUrl: model.baseUrl, brokerUrl: L.BROKER_ORIGIN, port: 17288 }).start();
for (const [sid, kind] of [['82a1af0f-4611-427c-b9de-4f687cede63c', 'close'], ['82a1af0f-4611-427c-b9de-4f687cede63c', 'delete']]) {
  console.log(sid.slice(0, 8), await P.lifecycle(sid, kind));
}
console.log(L.sql(`SELECT session_id, status FROM managed_agent_session ORDER BY session_id`).map((r) => r.join(':')).join(' '));
await h.stop(); await model.close();
