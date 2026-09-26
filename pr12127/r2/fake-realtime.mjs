// Stand-in for the DashScope Qwen-Omni realtime WebSocket. Speaks just enough of the protocol
// (session.created -> session.update -> session.updated) for the daemon to report the Live call
// as ready, then accounts every input_audio_buffer.append frame the daemon forwards.
import https from 'node:https';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/wenshao/git/qwen-12127/packages/cli/package.json');
const { WebSocketServer } = require('ws');
const port = Number(process.argv[2] || 18443);
const log = process.argv[3] || './fake-realtime.log';
const dir = new URL('.', import.meta.url).pathname;
const w = (o) => fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
const server = https.createServer({ key: fs.readFileSync(dir + 'key.pem'), cert: fs.readFileSync(dir + 'cert.pem') });
const wss = new WebSocketServer({ server });
let conn = 0, ev = 0;
wss.on('connection', (ws, req) => {
  const id = ++conn;
  const st = { frames: 0, bytes: 0, peak: 0, first: null, last: null };
  w({ id, event: 'open', url: req.url, host: req.headers.host, auth: !!req.headers.authorization });
  const send = (o) => ws.send(JSON.stringify({ event_id: 'evt_' + ++ev, ...o }));
  send({ type: 'session.created', session: { id: 'sess_fake_' + id } });
  const tick = setInterval(() => { if (st.frames) w({ id, event: 'audio', ...st }); }, 2000);
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(String(data)); } catch { return; }
    if (m.type === 'session.update') {
      w({ id, event: 'session.update', modalities: m.session?.modalities, input: m.session?.input_audio_format });
      send({ type: 'session.updated', session: { id: 'sess_fake_' + id } });
    } else if (m.type === 'input_audio_buffer.append') {
      const buf = Buffer.from(m.audio || '', 'base64');
      st.frames++; st.bytes += buf.length; st.last = Date.now(); st.first ??= st.last;
      for (let i = 0; i + 1 < buf.length; i += 2) st.peak = Math.max(st.peak, Math.abs(buf.readInt16LE(i)));
    } else w({ id, event: 'msg', type: m.type });
  });
  ws.on('close', (code) => { clearInterval(tick); w({ id, event: 'close', code, ...st, seconds16k: +(st.bytes / 2 / 16000).toFixed(2) }); });
});
server.listen(port, '127.0.0.1', () => console.log('fake-realtime listening', port));
