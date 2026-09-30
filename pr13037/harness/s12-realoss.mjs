// s12: the same path against a real, private Aliyun OSS bucket (temporary, deleted afterwards).
// usage: DB=o3r node s12-realoss.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
L.openLog('s12-realoss');
const bucket = fs.readFileSync(`${L.S}/realoss/bucket.txt`, 'utf8').trim();
const realOss = (...args) => execFileSync(`${process.env.HOME}/Install/jdk21/bin/java`, ['-Dhttps.proxyHost=', '-Dhttp.proxyHost=', '-DsocksProxyHost=', '-cp', 'out:lib/*', 'RealOss', ...args], { cwd: `${L.S}/realoss`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).split('\n').filter((l) => l && !/commons-logging|SLF4J/.test(l)).join(' | ').replaceAll(bucket, 'qwen-pr13037-verify-<redacted>');
const lg = (n, e = 0, c = 0) => `${L.NODE22} ${L.R}/loggen.mjs ${n} ${e} ${c}`;
const timed = async (fn) => { const t0 = Date.now(); const r = await fn(); return [r, Date.now() - t0]; };
const receiptToEvent = (session) => {
  const r = L.sql(`SELECT UNIX_TIMESTAMP(created_at)*1000 FROM qwen_managed_session_journal_tx WHERE session_id='${session}' AND operation='recordToolResult'`)[0]?.[0];
  const e = L.sql(`SELECT created_at FROM managed_agent_event WHERE session_id='${session}' AND event_type='item.tool_result.updated'`)[0]?.[0];
  return r && e ? Math.round(+e - +r) : null;
};
L.say('bucket', realOss('info', bucket));
const cases = [
  { name: 'echo', ws: '01', cmd: 'echo real-oss-out; echo real-oss-err >&2' },
  { name: 'log8', ws: '17', cmd: lg(106186, 2, 1) },     // 8.4 MB
  { name: 'log100', ws: '18', cmd: lg(1310720, 0, 0) },  // 103.5 MB
];
const made = {};
for (const c of cases) {
  L.register(`ws-real-${c.name}`, `st-s${c.ws}`);
  const t0 = Date.now();
  const session = await L.createShellSession(`ws-real-${c.name}`, L.shellPrompt(`Real OSS ${c.name}`, c.cmd));
  const turn = await L.waitTurn(session, { timeoutMs: 600000 });
  const proj = await L.waitProjection(session, { timeoutMs: 300000 });
  const arts = (await L.api('GET', `/v1/agents/sessions/${session}/artifacts`)).json.data?.map((e) => e.artifact) ?? [];
  const so = arts.find((a) => a.stream_role === 'stdout');
  const local = execFileSync('/bin/bash', ['-c', `(${c.cmd}) 2>/dev/null | shasum -a 256 | cut -d' ' -f1; true`], { encoding: 'utf8' }).trim();
  made[c.name] = { session, so };
  L.say(c.name, { turn: turn.status, turnMs: turn.ms, source: proj.rows.map((r) => `${r.state}${r.failure ? '/' + r.failure : ''}#${r.attempts}`), receiptToPublicEventMs: receiptToEvent(session), stdoutBytes: so?.byte_length, metadataShaEqualsLocalRun: so?.sha256 === local });
}
L.say('bucket after publication', realOss('info', bucket));
// objects are private
const key = L.one(`SELECT o.object_key FROM qwen_tool_publication_object o JOIN qwen_tool_publication p ON p.publication_id=o.publication_id WHERE p.session_id='${made.log8.session}' AND o.slot_key='segment:stdout:0'`);
L.say('anonymous GET of a stored segment', realOss('anon', bucket, key));
// reads through Java
for (const name of ['echo', 'log8', 'log100']) {
  const { session, so } = made[name];
  const [md, mdMs] = await timed(() => L.api('GET', `/v1/agents/sessions/${session}/artifacts/${so.id}`));
  const pages = [];
  for (const off of name === 'echo' ? [0] : [0, 65536 * 40, Math.floor(so.byte_length / 65536) * 65536 - 65536]) {
    const end = Math.min(off + 65535, so.byte_length - 1);
    const [r, ms] = await timed(() => L.content(session, so.id, { revision: so.revision, range: `bytes=${off}-${end}`, ifMatch: `"${so.sha256}"` }));
    pages.push(`${r.status} ${r.body.length}B ${ms}ms`);
  }
  const [full, fullMs] = await timed(() => L.content(session, so.id, { revision: so.revision }));
  L.say(`read ${name}`, { metadata: `${md.status} ${md.json.artifact?.availability} ${mdMs}ms`, pages64k: pages, fullDownload: { status: full.status, bytes: full.body.length, ms: fullMs, MBps: +(full.body.length / 1e6 / (fullMs / 1000)).toFixed(1), exact: L.sha256(full.body) === so.sha256 } });
}
// corruption in the real bucket
{
  const { session, so } = made.log8;
  const k = L.one(`SELECT o.object_key FROM qwen_tool_publication_object o JOIN qwen_tool_publication p ON p.publication_id=o.publication_id WHERE p.session_id='${session}' AND o.slot_key='segment:stdout:4'`);
  L.say('corrupt', realOss('corrupt', bucket, k).replace(/managed-tool-results\/\S+/, '<segment 4 object key>'));
  const res = await fetch(`${L.BASE}/v1/agents/sessions/${session}/artifacts/${so.id}/content?revision=${so.revision}`, { headers: L.headers({}) });
  let received = 0, err = null;
  try { for await (const chunk of res.body) received += chunk.length; } catch (e) { err = e.cause?.code ?? e.message; }
  const md = await L.api('GET', `/v1/agents/sessions/${session}/artifacts/${so.id}`);
  L.say('full download after the bit flip', { status: res.status, declared: so.byte_length, received, receivedMiB: +(received / 1048576).toFixed(2), clientError: err, corruptSegmentDelivered: received > 4 * 1048576, availabilityAfter: md.json.artifact?.availability, quarantined: L.one(`SELECT quarantined FROM qwen_tool_publication WHERE session_id='${session}'`) });
}
fs.writeFileSync(`${L.R}/out/s12-realoss.json`, JSON.stringify(Object.fromEntries(Object.entries(made).map(([k, v]) => [k, { session: v.session, stdout: { id: v.so.id, bytes: v.so.byte_length, sha256: v.so.sha256 } }])), null, 2));
