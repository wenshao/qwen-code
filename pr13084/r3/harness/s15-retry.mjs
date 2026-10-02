// s15: F1 regression on the OSS double, before (38bc3865) and after (8b0e0175) the guarded read retries.
import * as L from './lib.mjs';
const ARM = process.env.ARM;
L.openLog(`s15-${ARM}`);
await L.oss('/clear-faults', {}); await L.throttle(0);
const X = await L.makeOutput('retry', `ws-s15x-${ARM}-${Date.now().toString(36)}`, process.env.ST ?? 'st-s30', L.genCmd(`s15x${ARM}`, 8 * 1024 * 1024, 0, 0));
const a = X.arts.find((x) => x.stream_role === 'stdout');
const victim = L.sql(`SELECT o.object_key FROM qwen_tool_publication_object o JOIN qwen_tool_publication p ON p.publication_id=o.publication_id WHERE p.session_id='${X.session}' AND o.slot_key='segment:stdout:2'`)[0][0];
const out = { arm: ARM };
async function once(name, fault) {
  await L.oss('/clear-faults', {});
  const t0 = Date.now();
  if (fault) await L.oss('/fault', { op: 'get', match: victim, ...fault });
  const r = await L.streamDownload(X.session, a);
  const gets = (await L.ossLedger()).filter((e) => e.t >= t0 && e.method === 'GET' && e.key === victim).map((e) => String(e.status));
  out[name] = { status: r.status, received: r.bytes, ended: r.ended, shaOk: r.sha256 === a.sha256, ms: r.closeMs, victimGets: gets };
  L.say(name, out[name]);
}
await once('get-500-once', { mode: '500', count: 1 });
await once('get-drop-once', { mode: 'drop-request', count: 1 });
await once('get-500-persistent', { mode: '500', count: 10 });
await once('get-403-once', { mode: '403', count: 1 });
await L.oss('/clear-faults', {});
// paused JVM: stale pooled connection
await L.throttle(262144);
const progress = { bytes: 0 };
const dl = L.streamDownload(X.session, a, { progress });
await L.sleep(5000);
const pid = L.springPid();
process.kill(pid, 'SIGSTOP'); await L.sleep(125_000); process.kill(pid, 'SIGCONT');
await dl; await L.throttle(0);
const after = [];
for (let i = 0; i < 3; i++) { const r = await L.content(X.session, a.id, { revision: a.revision, range: 'bytes=0-1048575' }); after.push(`${r.status}${r.code ? '/' + r.code : ''}`); }
out.pauseThenRange = after; L.say('pause-then-range', after);
// PUT 500 once: still one physical send per attempt
const tp = Date.now();
await L.oss('/fault', { op: 'put', mode: '500', count: 1 });
const P = await L.makeOutput('retry-put', `ws-s15p-${ARM}-${Date.now().toString(36)}`, process.env.ST2 ?? 'st-s31', L.genCmd(`s15p${ARM}`, 2 * 1024 * 1024, 0, 0));
const puts = (await L.ossLedger()).filter((e) => e.t >= tp && e.method === 'PUT').slice(0, 3).map((e) => `${e.key.split('/').at(-1).slice(0, 10)} ${e.status}`);
out.put500 = { turn: P.turn.status, puts, attempts: L.putAttempts(L.sql(`SELECT publication_id FROM qwen_tool_publication WHERE session_id='${P.session}'`)[0][0]) };
L.say('put-500-once', out.put500);
await L.oss('/clear-faults', {});
// lease expiry while every GET answers 500: no GET may start after the lease expires
const Y = await L.makeOutput('retry-expiry', `ws-s15y-${ARM}-${Date.now().toString(36)}`, process.env.ST3 ?? 'st-s34', L.genCmd(`s15y${ARM}`, 64 * 1024 * 1024, 0, 0));
const ya = Y.arts.find((x) => x.stream_role === 'stdout');
await L.throttle(262144);
const ty = Date.now();
const dly = L.streamDownload(Y.session, ya);
await L.sleep(1500);
const expiresAt = +L.one('SELECT MAX(expires_at) FROM qwen_output_read_lease');
await L.sleep(Math.max(0, expiresAt - 4000 - Date.now()));
await L.oss('/fault', { op: 'get', mode: '500', count: 500 });
const ry = await dly;
await L.throttle(0); await L.oss('/clear-faults', {});
const ygets = (await L.ossLedger()).filter((e) => e.t >= ty && e.method === 'GET');
out.expiry = { endedAtMs: ry.closeMs, received: ry.bytes, ended: ry.ended, getsWith500: ygets.filter((e) => /500/.test(String(e.status))).length, getsAfterExpiry: ygets.filter((e) => e.t > expiresAt).length, lastGetVsExpiryMs: Math.max(...ygets.map((e) => e.t)) - expiresAt };
L.say('expiry-with-500s', out.expiry);
L.out(`s15-${ARM}.json`, out);
