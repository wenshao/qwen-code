// s8: one transient OSS 500, head vs base.
//   GET: a full download whose 3rd segment GET answers 500 once
//   PUT: an output whose first object PUT answers 500 once (object not stored)
import * as L from './lib.mjs';
const ARM = process.env.ARM;
L.openLog(`s8-${ARM}`);
await L.oss('/clear-faults', {});
const m = await L.makeOutput('transient-get', `ws-s8g-${ARM}-${Date.now().toString(36)}`, process.env.ST ?? 'st-s30', L.genCmd('s8g', 8 * 1024 * 1024, 0, 0));
const a = m.arts.find((x) => x.stream_role === 'stdout');
const segKeys = L.objectKeys(m.session);
const t0 = Date.now();
const victim = L.sql(`SELECT o.object_key FROM qwen_tool_publication_object o JOIN qwen_tool_publication p ON p.scope_key=o.scope_key AND p.publication_id=o.publication_id WHERE p.session_id='${m.session}' AND o.slot_key='segment:stdout:2'`)[0][0];
await L.oss('/fault', { op: 'get', mode: '500', count: 1, match: victim });
const r = await L.streamDownload(m.session, a);
const gets = (await L.ossLedger()).filter((e) => e.t >= t0 && e.method === 'GET' && e.key === victim).map((e) => e.status);
L.say('get-500-once', { status: r.status, received: r.bytes, declared: r.declared, ended: r.ended, shaOk: r.sha256 === a.sha256, victimGets: gets });
const again = await L.streamDownload(m.session, a);
L.say('get-retry-by-client', { status: again.status, received: again.bytes, shaOk: again.sha256 === a.sha256 });
await L.oss('/clear-faults', {});
const t1 = Date.now();
await L.oss('/fault', { op: 'put', mode: '500', count: 1 });
const p = await L.makeOutput('transient-put', `ws-s8p-${ARM}-${Date.now().toString(36)}`, process.env.ST2 ?? 'st-s31', L.genCmd('s8p', 2 * 1024 * 1024, 0, 0));
const puts = (await L.ossLedger()).filter((e) => e.t >= t1 && e.method === 'PUT').slice(0, 4).map((e) => `${e.key.split('/').slice(-1)[0].slice(0, 12)} ${e.status}`);
const pr = L.pubRows(p.session)[0];
let attempts = 'n/a'; try { attempts = L.putAttempts(pr.id); } catch {}
L.say('put-500-once', { turn: p.turn.status, results: p.results, phase: pr.phase, puts, attempts });
await L.oss('/clear-faults', {});
