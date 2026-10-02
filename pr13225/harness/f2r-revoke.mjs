// F2r (PR #13225): does a public download stop after access is revoked / the Session is retired mid-stream,
// and how many bytes does the server still send after that moment? (OSS GET throttled so timing is controllable)
// CASE=revoke | retire
import * as L from './lib.mjs';
import fs from 'node:fs';
const ARM = process.env.ARM, CASE = process.env.CASE ?? 'revoke';
const SO = Number(process.env.SO ?? 24 * 1024 * 1024 + 7);
const TAG = process.env.TAG ?? `f2r-${ARM}-${CASE}-${Date.now().toString(36)}`;
L.openLog(TAG);
const ws = `ws-${TAG}`; L.register(ws, process.env.ST ?? 'st-s39');
const S = await L.createShellSession(ws, L.shellPrompt('f2r', L.genCmd(TAG, SO, 0, 0)), { key: `k-${TAG}` });
await L.waitTurn(S, { timeoutMs: 900_000 }); await L.waitProjection(S, { timeoutMs: 600_000 });
const a = (await L.artifacts(S)).list.find((x) => x.stream_role === 'stdout');
if (CASE === 'retire') {
  const r = await L.api('POST', `/v1/agents/sessions/${S}/close`, undefined, { key: `close-${TAG}` });
  for (let i = 0; i < 80; i++) { const o = (await L.api('GET', `/v1/agents/sessions/${S}/operations/${r.json?.id}`)).json; if (/completed|failed/.test(String(o?.status))) break; await L.sleep(250); }
}
await L.throttle(Number(process.env.BPS ?? 4 * 1024 * 1024));
const progress = {};
const t0 = Date.now();
const dl = L.streamDownload(S, a, { progress });
let at = null;
while (!at) {
  if ((progress.bytes ?? 0) >= 8 * 1024 * 1024) {
    at = { clientBytes: progress.bytes, ms: Date.now() - t0 };
    if (CASE === 'revoke') L.sql(`UPDATE managed_workspace_access SET can_read=FALSE WHERE workspace_id='${ws}'`);
    else at.delete = (await L.api('DELETE', `/v1/agents/sessions/${S}`, undefined, { key: `del-${TAG}` })).status;
    at.doneMs = Date.now() - t0;
  }
  await L.sleep(20);
}
const r = await dl;
await L.throttle(0);
await L.sleep(1500);
const logDir = process.env.SPRING_LOGDIR;
const line = logDir ? fs.readdirSync(logDir).filter((f) => f.startsWith('spring-')).map((f) => fs.readFileSync(`${logDir}/${f}`, 'utf8')).join('\n').split('\n').filter((l) => l.includes('artifact_read') && l.includes(S)).pop() : '';
const sent = Number(line?.match(/bytes=(\d+)/)?.[1] ?? NaN);
L.say('result', { arm: ARM, case: CASE, status: r.status, ended: r.ended, clientAtAction: at.clientBytes, clientFinal: r.bytes, afterActionClient: r.bytes - at.clientBytes, serverSent: sent, outcome: line?.match(/outcome=(\S+)/)?.[1], of: a.byte_length, actionMs: at.ms, closeMs: r.closeMs });
