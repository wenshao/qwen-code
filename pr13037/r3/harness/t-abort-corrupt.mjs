// F2 re-check: a later segment is corrupt → how long after the last byte does the client see the end?
// Also records the Connection header of full (200) and ranged (206) responses.
import fs from 'node:fs';
import http from 'node:http';
import * as L from './lib.mjs';
L.openLog('t-abort-corrupt');
const MiB = 1048576;
L.register('ws-abort-corrupt', 'st-s19');
const session = await L.createShellSession('ws-abort-corrupt', L.shellPrompt('Corruption timing', `${L.NODE22} ${L.R}/gen.mjs abortc ${8 * MiB} 0 0`));
await L.waitTurn(session);
await L.waitProjection(session);
const a = (await L.api('GET', `/v1/agents/sessions/${session}/artifacts`)).json.data.map((e) => e.artifact).find((x) => x.stream_role === 'stdout');
const get = (headers) => new Promise((resolve) => {
  const t0 = Date.now(); let received = 0, last = null;
  const req = http.get(`${L.BASE}/v1/agents/sessions/${session}/artifacts/${a.id}/content?revision=${a.revision}`, { headers: { ...L.headers({}), ...headers } }, (res) => {
    const done = (how) => resolve({ status: res.statusCode, connection: res.headers.connection ?? null, received, lastByteMs: last, endMs: Date.now() - t0, silentGapMs: last === null ? null : Date.now() - t0 - last, ended: how });
    res.on('data', (c) => { received += c.length; last = Date.now() - t0; });
    res.on('end', () => done(res.complete ? 'complete' : 'ended early'));
    res.on('aborted', () => done('aborted by server'));
    res.on('error', (e) => done('error ' + e.code));
  });
  req.on('error', (e) => resolve({ error: e.code }));
});
L.say('intact full download', await get({}));
L.say('intact 64 KiB range', await get({ Range: 'bytes=0-65535' }));
const key = L.one(`SELECT o.object_key FROM qwen_tool_publication_object o JOIN qwen_tool_publication p ON p.publication_id=o.publication_id WHERE p.session_id='${session}' AND o.slot_key='segment:stdout:5'`);
L.say('flip one bit in segment 5 of 8', await L.oss('/corrupt', { key }));
L.say('full download after the flip', await get({}));
