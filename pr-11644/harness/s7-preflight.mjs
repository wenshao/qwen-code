// S7 — SDK capability preflight against the real daemon. Wraps fetch to count
// GET /capabilities vs source-filtered list requests for: 4 cold sequential
// lists, 4 concurrent lists, an explicit capabilities() refresh, a list after
// it, a non-cached capability check, and a list after the 60 s TTL expires.
const SDK = process.argv[2] || '/root/git/pr11644/packages/sdk-typescript/dist/daemon/index.js';
const { DaemonClient } = await import(SDK);
const BASE = 'http://127.0.0.1:4644';
const WS = '/root/git/h11644/ws/alpha-app';
const log = [];
const fetchCounting = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const u = new URL(url);
  log.push(`${init?.method || 'GET'} ${u.pathname}${u.search}`);
  return fetch(input, init);
};
const client = new DaemonClient({ baseUrl: BASE, token: 'T0KEN11644', fetch: fetchCounting });
const snap = () => ({
  capabilities: log.filter((l) => l.endsWith(' /capabilities')).length,
  lists: log.filter((l) => /\/sessions\?/.test(l) && /sourceType=/.test(l)).length,
});
const delta = (a, b) => ({ capabilities: b.capabilities - a.capabilities, lists: b.lists - a.lists });
const list = () => client.listWorkspaceSessionsPage(WS, { sourceType: 'default', pageSize: 5 });
const out = {};
let s = snap();
for (let i = 0; i < 4; i++) await list();
out.coldSequential4 = delta(s, (s = snap()));
await Promise.all([list(), list(), list(), list()]);
out.warmConcurrent4 = delta(s, (s = snap()));
await client.capabilities();
out.explicitCapabilities = delta(s, (s = snap()));
await list();
out.listAfterExplicit = delta(s, (s = snap()));
const fresh = new DaemonClient({ baseUrl: BASE, token: 'T0KEN11644', fetch: fetchCounting });
await Promise.all([1, 2, 3, 4].map(() => fresh.listWorkspaceSessionsPage(WS, { sourceType: 'default', pageSize: 5 })));
out.coldConcurrent4_newClient = delta(s, (s = snap()));
let missing;
try { await client.requireCapability('definitely_not_a_feature'); } catch (e) { missing = e.constructor.name; }
out.otherCapabilityCheck = { ...delta(s, (s = snap())), error: missing };
if (process.env.TTL_WAIT) {
  await new Promise((r) => setTimeout(r, 61_000));
  await list();
  out.listAfter61s = delta(s, (s = snap()));
}
console.log(JSON.stringify({ sdk: SDK, out, sampleListPath: log.find((l) => /sourceType=/.test(l)) }, null, 2));
client.dispose(); fresh.dispose();
