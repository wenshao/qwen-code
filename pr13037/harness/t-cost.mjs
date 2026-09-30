// Cost of reads on the Java server, counted with MySQL status counters (no query logging):
// SELECT statements and object-store requests per 10-byte range read, per 64 KiB page, and per full download.
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog(process.env.COST_LOG ?? 't-cost');
const s1 = JSON.parse(fs.readFileSync(`${L.R}/out/s1a.json`, 'utf8'));
const s4 = JSON.parse(fs.readFileSync(`${L.R}/out/s4.json`, 'utf8'));
const gib = JSON.parse(fs.readFileSync(`${L.R}/out/s5-gib.json`, 'utf8'));
const targets = [
  ['9 B (1 segment)', s1.find((r) => r.case === 'ok').session],
  ['12 MiB', s4.find((r) => r.case === 'biglog').session],
  ['40 MiB', s1.find((r) => r.case === 'multi').session],
  ['99 MiB', s4.find((r) => r.case === 'log100').session],
  ['1 GiB', gib.session],
];
const selects = () => +L.sql("SHOW GLOBAL STATUS LIKE 'Com_select'", 'mysql')[0][1];
const ossCounters = async () => (await L.oss('/state')).counters;
// background SELECT rate (scheduler ticks, renewals) to subtract
const b0 = selects(); const bt = Date.now(); await L.sleep(10000); const idlePerMs = (selects() - b0 - 1) / (Date.now() - bt);
L.say('idle background', { selectsPerSecond: +(idlePerMs * 1000).toFixed(1) });
async function measure(fn) {
  const o0 = await ossCounters(); const q0 = selects(); const t0 = Date.now();
  const r = await fn();
  const ms = Date.now() - t0; const q1 = selects(); const o1 = await ossCounters();
  return { r, ms, selects: Math.max(0, Math.round(q1 - q0 - 1 - idlePerMs * ms)), objectGets: o1.get - o0.get, versioningChecks: o1.versioning - o0.versioning };
}
for (const [name, session] of process.env.ONLY_DL ? [] : targets) {
  const a = (await L.api('GET', `/v1/agents/sessions/${session}/artifacts`)).json.data.map((e) => e.artifact).find((x) => x.stream_role === 'stdout');
  const segments = +L.one(`SELECT COUNT(*) FROM qwen_tool_publication_object o JOIN qwen_tool_publication p ON p.publication_id=o.publication_id WHERE p.session_id='${session}' AND o.slot_key LIKE 'segment:stdout:%'`);
  const row = { name, bytes: a.byte_length, segments };
  const md = await measure(() => L.api('GET', `/v1/agents/sessions/${session}/artifacts/${a.id}`));
  row.metadata = { status: md.r.status, ms: md.ms, selects: md.selects, objectGets: md.objectGets };
  const end = a.byte_length - 1;
  const rg = await measure(() => L.content(session, a.id, { revision: a.revision, range: `bytes=${Math.max(0, end - 9)}-${end}` }));
  row.range10 = { status: rg.r.status, ms: rg.ms, selects: rg.selects, objectGets: rg.objectGets, versioningChecks: rg.versioningChecks };
  if (a.byte_length > 65536) {
    const pg = await measure(() => L.content(session, a.id, { revision: a.revision, range: `bytes=${65536 * 3}-${65536 * 4 - 1}`, ifMatch: `"${a.sha256}"` }));
    row.page64k = { status: pg.r.status, ms: pg.ms, selects: pg.selects, objectGets: pg.objectGets, objectBytes: null };
  }
  L.say('read', row);
}
// full download of the 99 MiB output
{
  const session = s4.find((r) => r.case === 'log100').session;
  const a = (await L.api('GET', `/v1/agents/sessions/${session}/artifacts`)).json.data.map((e) => e.artifact).find((x) => x.stream_role === 'stdout');
  const dl = await measure(async () => { const r = await L.content(session, a.id, { revision: a.revision }); return { status: r.status, exact: L.sha256(r.body) === a.sha256, bytes: r.body.length }; });
  const chunks = Math.ceil(a.byte_length / 65536);
  L.say('full download 99 MiB', { ...dl.r, ms: dl.ms, MBps: +(a.byte_length / 1e6 / (dl.ms / 1000)).toFixed(1), selects: dl.selects, chunks64k: chunks, selectsPerChunk: +(dl.selects / chunks).toFixed(1), selectsPerMiB: Math.round(dl.selects / (a.byte_length / 1048576)), objectGets: dl.objectGets, versioningChecks: dl.versioningChecks });
}
