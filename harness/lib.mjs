import * as d from './drive.mjs';
export * from './drive.mjs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

export const results = [];
export function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
  return !!cond;
}
export function summary() {
  const bad = results.filter((r) => !r.pass);
  console.log(`\n== ${results.length - bad.length}/${results.length} checks passed ==`);
  if (bad.length) { console.log(JSON.stringify(bad, null, 2)); process.exitCode = 1; }
}
export const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
export const sha256File = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export const setMode = (m) => fetch('http://127.0.0.1:9099/mode?m=' + encodeURIComponent(m)).then((r) => r.json());

/** outbound classification over gateway log entries */
export const uploads = (e) => e.filter((x) => x.kind === 'http' && x.path === '/media/upload');
export const webhookSends = (e) => e.filter((x) => x.kind === 'http' && x.path === '/robot/send');
export const fileSends = (e) => webhookSends(e).filter((x) => x.body?.msgtype === 'file');
export const mdSends = (e) => webhookSends(e).filter((x) => x.body?.msgtype === 'markdown');
export const groupSends = (e) => e.filter((x) => x.kind === 'http' && x.path === '/v1.0/robot/groupMessages/send');
export const dmSends = (e) => e.filter((x) => x.kind === 'http' && x.path === '/v1.0/robot/oToMessages/batchSend');
export const proactiveOf = (sends, key) => sends.filter((x) => x.body?.msgKey === key);
export const cardStreams = (e) => e.filter((x) => x.kind === 'http' && x.path === '/v1.0/card/streaming');
export const cardUpdates = (e) => e.filter((x) => x.kind === 'http' && x.path === '/v1.0/card/instances' && x.method === 'PUT');
export const cardCreates = (e) => e.filter((x) => x.kind === 'http' && x.path === '/v1.0/card/instances/createAndDeliver');
export const tokens = (e) => e.filter((x) => x.kind === 'http' && x.path === '/gettoken');
/** all outbound bodies (session + proactive + cards) as strings, after t */
export const allOut = (e, after = 0) =>
  e.filter((x) => x.kind === 'http' && x.t > after && (x.path.startsWith('/robot') || x.path.startsWith('/v1.0/robot') || x.path.startsWith('/v1.0/card') || x.path === '/media/upload'))
   .map((x) => ({ path: x.path, t: x.t, s: JSON.stringify(x.body ?? '') }));
export const outText = (e, after = 0) => allOut(e, after).map((o) => o.s).join('\n');

/** Ask the daemon to run a chat turn through the stream gateway and wait for its final markdown/file sends. */
export async function turn({ conversationId, directive, isGroup = false, senderId = 'owner-1', mention = true }) {
  const t0 = Date.now();
  await d.sendMessage({ text: directive, conversationId, isGroup, senderId, isMentioned: mention });
  return t0;
}
/** wait until the model has answered and the channel went quiet for `quiet` ms */
export async function settle({ after, quiet = 2500, timeout = 60000, pred }) {
  const t0 = Date.now();
  let lastCount = -1, lastChange = Date.now();
  for (;;) {
    const e = await d.log();
    const outs = allOut(e, after);
    if (pred ? pred(e) : outs.length > 0) {
      if (outs.length !== lastCount) { lastCount = outs.length; lastChange = Date.now(); }
      else if (Date.now() - lastChange > quiet) return e;
    }
    if (Date.now() - t0 > timeout) throw new Error('settle timeout');
    await d.sleep(300);
  }
}
/** POST a webhook task to the daemon (proactive path) */
export async function webhookTask({ targetRef, directive, port = 4477, title = 'harness event' }) {
  const r = await fetch(`http://127.0.0.1:${port}/channels/dingtalk/webhooks/harness`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-qwen-webhook-secret': 'harness-webhook-secret' },
    body: JSON.stringify({ eventType: 'harness.event', targetRef, title, summary: directive, payload: { note: 'harness' } }),
  });
  return { status: r.status, body: await r.text() };
}
