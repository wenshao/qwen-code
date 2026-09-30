// bytes delivered after a grant is revoked in the middle of a full download (40 MiB artifact, paced reader, node:http)
import fs from 'node:fs';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
const s1 = JSON.parse(fs.readFileSync(`${L.R}/out/s1a.json`, 'utf8'));
const session = s1.find((r) => r.case === 'multi').session;
const ws = L.one(`SELECT workspace_id FROM managed_agent_session WHERE session_id='${session}'`);
const a = (await L.api('GET', `/v1/agents/sessions/${session}/artifacts`)).json.data.map((e) => e.artifact).find((x) => x.stream_role === 'stdout');
const MiB = 1048576;
const dir = fs.mkdtempSync(`${L.R}/run/exp-`);
execFileSync('/bin/bash', ['-c', `${L.NODE22} ${L.R}/gen.mjs multi ${40 * MiB} ${MiB} 7 > ${dir}/so 2>/dev/null; true`]);
const so = fs.readFileSync(`${dir}/so`);
const out = await new Promise((resolve) => {
  const t0 = Date.now(); const chunks = []; let received = 0, at = null, atMs = null;
  const req = http.get(`${L.BASE}/v1/agents/sessions/${session}/artifacts/${a.id}/content?revision=${a.revision}`, { headers: L.headers({}) }, (res) => {
    const finish = (how) => resolve({ status: res.statusCode, connectionHeader: res.headers.connection ?? null, revokedAtBytes: at, received, deliveredAfterRevoke: received - at, exactPrefix: Buffer.compare(Buffer.concat(chunks), so.subarray(0, received)) === 0, ended: how, msAfterRevoke: Date.now() - atMs });
    res.on('data', (c) => {
      chunks.push(c); received += c.length;
      if (at === null && received >= 4 * MiB) { res.pause(); L.sql(`UPDATE managed_workspace_access SET can_read=FALSE WHERE workspace_id='${ws}' AND actor_id='alice'`); at = received; atMs = Date.now(); res.resume(); }
    });
    res.on('end', () => finish(res.complete ? 'complete' : 'ended early'));
    res.on('aborted', () => finish('aborted by server'));
    res.on('error', (e) => finish('error ' + e.code));
  });
  req.on('error', (e) => resolve({ error: e.code }));
});
L.grant(ws, 'alice');
console.log('mid-stream revoke: ' + JSON.stringify(out));
