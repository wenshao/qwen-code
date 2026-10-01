import http from 'node:http';
// s3: access/lifecycle changes against already published results.
// usage: FROM=s1a node s3-lifecycle.mjs   (uses the 40 MiB "multi" session; a fresh 8 MiB session for corruption)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import * as L from './lib.mjs';

const FROM = process.env.FROM ?? 's1a';
L.openLog(`s3-${FROM}`);
const s1 = JSON.parse(fs.readFileSync(`${L.R}/out/${FROM}.json`, 'utf8'));
const multi = s1.find((r) => r.case === 'multi').session;
const MiB = 1024 * 1024;
const ws = L.one(`SELECT workspace_id FROM managed_agent_session WHERE session_id='${multi}'`);
const list = await L.api('GET', `/v1/agents/sessions/${multi}/artifacts?limit=50`);
const A = list.json.data.map((e) => e.artifact).find((a) => a.stream_role === 'stdout');
const item = L.one(`SELECT item_id FROM managed_agent_tool_result WHERE session_id='${multi}'`);
const dir = fs.mkdtempSync(`${L.R}/run/exp-`);
execFileSync('/bin/bash', ['-c', `${L.NODE22} ${L.R}/gen.mjs multi ${40 * MiB} ${MiB} 7 > ${dir}/so 2> ${dir}/se; true`]);
const so = fs.readFileSync(`${dir}/so`);

async function probe(label) {
  const get = await L.api('GET', `/v1/agents/sessions/${multi}`);
  const res = await L.api('GET', `/v1/agents/sessions/${multi}/items/${item}/tool-result`);
  const md = await L.api('GET', `/v1/agents/sessions/${multi}/artifacts/${A.id}`);
  const wsr = await L.api('POST', '/api/agent/web-shell/v1/tool-results/get', { sessionId: multi, itemId: item });
  const range = await L.content(multi, A.id, { revision: A.revision, range: 'bytes=1048570-1048585', ifMatch: `"${A.sha256}"` });
  const bad = await L.content(multi, A.id, { revision: A.revision, range: 'bytes=zzz' });
  const out = {
    session: `${get.status}${get.json.capabilities ? ' artifacts=' + get.json.capabilities.artifacts : ''}`,
    result: `${res.status}${res.json.result ? ` exec=${res.json.result.execution_status} canRead=${res.json.access.can_read_content} arts=${res.json.result.artifacts.map((a) => a.availability).join(',')}` : ' ' + (res.json.error?.code ?? '')}`,
    webShellResult: wsr.status,
    artifact: `${md.status}${md.json.artifact ? ` ${md.json.artifact.availability} canRead=${md.json.access.can_read_content}` : ' ' + (md.json.error?.code ?? '')}`,
    range: `${range.status}${range.code ? ' ' + range.code : ''}${range.status === 206 ? ' exact=' + (Buffer.compare(range.body, so.subarray(1048570, 1048586)) === 0) : ''}`,
    malformedRange: `${bad.status} ${bad.code ?? ''}`.trim(),
  };
  L.say(label, out);
  return out;
}

// slow consumer over node:http (Node's fetch asserts inside undici when the server closes a paused body):
// read with `pauseMs` between chunks, run `action` once when `trigger` bytes have arrived
function slowDownload(session, artifact, { pauseMs = 5, trigger, action }) {
  return new Promise((resolve) => {
    const chunks = [];
    let received = 0, atTrigger = null, fired = false, settled = false;
    const req = http.get(`${L.BASE}/v1/agents/sessions/${session}/artifacts/${artifact.id}/content?revision=${artifact.revision}`, { headers: L.headers({}) }, (res) => {
      const finish = (error) => { if (settled) return; settled = true; resolve({ status: res.statusCode, declared: Number(res.headers['content-length']), received, atTrigger, error, body: Buffer.concat(chunks) }); };
      res.on('data', async (c) => {
        chunks.push(c); received += c.length;
        if (!fired && received >= trigger) { fired = true; atTrigger = received; res.pause(); await action(); res.resume(); }
        else if (pauseMs) { res.pause(); setTimeout(() => res.resume(), pauseMs); }
      });
      res.on('end', () => finish(res.complete ? null : 'ended early'));
      res.on('aborted', () => finish('aborted by server'));
      res.on('error', (e) => finish('error ' + e.code));
    });
    req.on('error', (e) => resolve({ status: 0, received, error: e.code, body: Buffer.concat(chunks) }));
  });
}

L.say('step', '1. baseline');
await probe('baseline');

L.say('step', '2. Workspace read grant revoked, then removed, then restored');
L.sql(`UPDATE managed_workspace_access SET can_read=FALSE WHERE workspace_id='${ws}' AND actor_id='alice'`);
await probe('can_read=false');
L.sql(`DELETE FROM managed_workspace_access WHERE workspace_id='${ws}' AND actor_id='alice'`);
await probe('grant row deleted');
L.grant(ws, 'alice');
await probe('grant restored');

L.say('step', '3. publication quarantined (SQL flag), then cleared');
L.sql(`UPDATE qwen_tool_publication SET quarantined=TRUE WHERE session_id='${multi}'`);
await probe('quarantined');
L.sql(`UPDATE qwen_tool_publication SET quarantined=FALSE WHERE session_id='${multi}'`);
await probe('quarantine cleared');

L.say('step', '4. Session status (set in SQL: lifecycle operations are gated for Workspace Sessions on main)');
const closeTry = await L.api('POST', `/v1/agents/sessions/${multi}/close`, {}, { key: `close-${Date.now()}` });
L.say('public close attempt', `${closeTry.status} ${closeTry.json.error?.code ?? ''}`);
for (const status of ['CLOSED', 'ARCHIVED', 'DELETING', 'DELETED', 'ACTIVE']) {
  L.sql(`UPDATE managed_agent_session SET status='${status}' WHERE session_id='${multi}'`);
  await probe(`status=${status}`);
}

L.say('step', '5. grant revoked in the middle of a full download (slow reader)');
{
  const t0 = Date.now();
  const r = await slowDownload(multi, A, {
    pauseMs: 4,
    trigger: 4 * MiB,
    action: async () => L.sql(`UPDATE managed_workspace_access SET can_read=FALSE WHERE workspace_id='${ws}' AND actor_id='alice'`),
  });
  L.grant(ws, 'alice');
  const prefixOk = Buffer.compare(r.body, so.subarray(0, r.received)) === 0;
  const tail = r.body.subarray(Math.max(0, r.received - 64)).toString('latin1');
  L.say('mid-stream revoke', { status: r.status, declared: r.declared, revokedAt: r.atTrigger, received: r.received, afterRevoke: r.received - r.atTrigger, clientError: r.error, receivedIsExactPrefix: prefixOk, jsonAppended: /"error"|artifact_|session_not_found/.test(tail), ms: Date.now() - t0 });
}
await probe('after restore');

L.say('step', '6. concurrency limit: 5 slow full downloads + one range read');
{
  const controllers = [];
  const starts = [];
  for (let i = 0; i < 5; i++) {
    const ac = new AbortController();
    controllers.push(ac);
    starts.push(
      fetch(`${L.BASE}/v1/agents/sessions/${multi}/artifacts/${A.id}/content?revision=${A.revision}`, { headers: L.headers({}), signal: ac.signal }).then((res) => ({ status: res.status, retryAfter: res.headers.get('retry-after'), res })),
    );
    await L.sleep(150);
  }
  const opened = await Promise.all(starts);
  // hold the four admitted bodies unread (server blocks in write), then try a UI-sized page read
  const page = await L.content(multi, A.id, { revision: A.revision, range: 'bytes=0-65535', ifMatch: `"${A.sha256}"` });
  const otherSession = s1.find((r) => r.case === 'ok').session;
  const ol = await L.api('GET', `/v1/agents/sessions/${otherSession}/artifacts`);
  const oa = ol.json.data[0].artifact;
  const otherPage = await L.content(otherSession, oa.id, { revision: oa.revision, range: 'bytes=0-3' });
  L.say('5 parallel downloads', opened.map((o) => `${o.status}${o.retryAfter ? ' Retry-After=' + o.retryAfter : ''}`).join(' | '));
  L.say('64 KiB page read while 4 downloads are in flight', `${page.status} ${page.code ?? ''} Retry-After=${page.headers['retry-after'] ?? '-'}`);
  L.say('page read of ANOTHER Session while 4 downloads are in flight', `${otherPage.status} ${otherPage.code ?? ''}`);
  for (const ac of controllers) ac.abort();
  await L.sleep(1500);
  const after = await L.content(multi, A.id, { revision: A.revision, range: 'bytes=0-65535' });
  L.say('page read after the clients disconnected', `${after.status}`);
}

L.say('step', '7. a later segment is corrupted in object storage, then a full download starts');
{
  const n = process.env.CORRUPT_WS ?? '20';
  L.register(`ws-${FROM}-corrupt`, `st-s${n}`);
  const cmd = `${L.NODE22} ${L.R}/gen.mjs corrupt ${8 * MiB} 0 0`;
  const session = await L.createShellSession(`ws-${FROM}-corrupt`, L.shellPrompt('Corruption case', cmd));
  await L.waitTurn(session);
  await L.waitProjection(session);
  execFileSync('/bin/bash', ['-c', `${cmd} > ${dir}/c-so 2>/dev/null; true`]);
  const expected = fs.readFileSync(`${dir}/c-so`);
  const ca = (await L.api('GET', `/v1/agents/sessions/${session}/artifacts`)).json.data.map((e) => e.artifact).find((a) => a.stream_role === 'stdout');
  const cItem = L.one(`SELECT item_id FROM managed_agent_tool_result WHERE session_id='${session}'`);
  const ok = await L.content(session, ca.id, { revision: ca.revision });
  L.say('before corruption', { status: ok.status, exact: Buffer.compare(ok.body, expected) === 0 });
  const key = L.one(`SELECT o.object_key FROM qwen_tool_publication_object o JOIN qwen_tool_publication p ON p.publication_id=o.publication_id WHERE p.session_id='${session}' AND o.slot_key='segment:stdout:5'`);
  const flip = await L.oss('/corrupt', { key });
  L.say('flipped one bit in segment 5 of 8', { at: flip.at });
  const r = await slowDownload(session, ca, { pauseMs: 0, trigger: Infinity, action: async () => {} });
  L.say('full download', { status: r.status, declared: r.declared, received: r.received, receivedMiB: r.received / MiB, clientError: r.error, receivedIsExactPrefix: Buffer.compare(r.body, expected.subarray(0, r.received)) === 0, corruptByteDelivered: r.received > 5 * MiB });
  const rng = await L.content(session, ca.id, { revision: ca.revision, range: `bytes=${5 * MiB + 10}-${5 * MiB + 19}` });
  L.say('range inside the corrupt segment', `${rng.status} ${rng.code ?? ''} bytes=${rng.status === 206 ? rng.body.length : 0}`);
  const rng2 = await L.content(session, ca.id, { revision: ca.revision, range: 'bytes=0-9' });
  L.say('range inside an intact segment afterwards', `${rng2.status} ${rng2.code ?? ''}`);
  const md = await L.api('GET', `/v1/agents/sessions/${session}/artifacts/${ca.id}`);
  const res = await L.api('GET', `/v1/agents/sessions/${session}/items/${cItem}/tool-result`);
  L.say('metadata afterwards', { artifact: `${md.status} ${md.json.artifact?.availability} canRead=${md.json.access?.can_read_content}`, result: `${res.status} exec=${res.json.result?.execution_status} capture=${res.json.result?.capture_status} delivery=${res.json.result?.delivery_status}`, quarantinedFlag: L.one(`SELECT quarantined FROM qwen_tool_publication WHERE session_id='${session}'`) });
}
L.say('done', 'ok');
