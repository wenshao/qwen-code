// S7: what a cold load costs. The PR validates every retained resource through one committed sequence at load;
// the base Harness reads lazily. Same Session, same MySQL store, two packaged Harness builds (PR head / base).
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog('s7-loadcost');
const { say } = L;
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' '));
L.seedWs('ws-a', 'a'); L.seedWs('ws-b', 'b');
const rig = await L.startRig('s7-head');
const base = await new L.Harness({ name: 's7-base', modelUrl: rig.model.baseUrl, brokerUrl: rig.proxy.url, dist: 'dist-base' }).start();
const stats = (sid) => { const r = L.sql(`SELECT COUNT(*), IFNULL(SUM(byte_length),0) FROM qwen_managed_session_resource WHERE session_id='${sid}'`)[0]; return { n: Number(r[0]), bytes: Number(r[1]) }; };
const mib = (b) => (b / 1048576).toFixed(b < 10485760 ? 2 : 0);
const rows = [];
async function measure(s, label, profile) {
  await s.detach();
  const out = { label, ...stats(s.sessionId) };
  for (const [arm, h, prof] of [['head', rig.h, undefined], ['base', base, profile], ['head', rig.h, undefined]]) {
    s.bind(h); const l = await s.load(prof, { timeoutMs: 300000 });
    out[arm] = Math.min(out[arm] ?? Infinity, l.status === 200 ? l.ms : Infinity); out[`${arm}Status`] = l.status;
    if (l.status === 200) await s.detach(); else say(`   !! ${arm} load ${l.status} ${JSON.stringify(l.json)} after ${l.ms} ms`);
  }
  s.bind(rig.h); const l = await s.load(undefined, { timeoutMs: 300000 }); if (l.status !== 200) throw new Error(`reload ${l.status}`);
  rows.push(out);
  say(`${label.padEnd(44)} resources=${String(out.n).padStart(5)} retained=${mib(out.bytes).padStart(7)} MiB | cold load: PR ${String(out.head).padStart(6)} ms, base ${String(out.base).padStart(5)} ms`);
}
say('== file-profile Session: text-only Turns (no tool output)');
const T = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a'); await T.create(L.FILES);
let done = 0;
for (const target of (process.env.S7_TURNS ?? '1 10 50 150 400').split(' ').map(Number)) {
  while (done < target) { const r = await T.prompt(`PLAIN turn ${done}`); if (r.terminal?.[0]?.type !== 'turn_complete') throw new Error(L.turnStr(r)); done += 1; }
  await measure(T, `${target} text Turns`, L.FILES);
}
await T.detach();
say('== Shell-profile Session: complete Shell output is retained and re-read at load');
const S = new L.HSession(rig.h, await L.createSession('ws-b'), 'ws-b'); await S.create(L.SHELL);
let total = 0;
for (const size of (process.env.S7_SHELL ?? '1 9 40 100 100 100').split(' ').map(Number)) {
  const t0 = Date.now();
  const r = await S.prompt(L.shell64(`head -c ${size * 1048576} /dev/zero | tr '\\0' x`), 600000);
  if (r.terminal?.[0]?.type !== 'turn_complete') { say(`   Shell Turn with ${size} MiB: ${L.turnStr(r).slice(0, 300)}`); break; }
  total += size;
  say(`   Shell Turn producing ${size} MiB completed in ${Date.now() - t0} ms`);
  await measure(S, `Shell output ${total} MiB in total`, L.SHELL);
}
await S.detach();
fs.writeFileSync(`${L.OUT}/s7-loadcost.json`, JSON.stringify(rows, null, 1));
say('The Java connector calls the Harness with qwen.managed-agent.harness.request-timeout = 30 s (application.yml); the PR\'s IT probe uses 90 s.');
await base.stop(); await rig.stop(); say('S7-DONE');
