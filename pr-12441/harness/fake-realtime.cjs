// Minimal DashScope-shaped realtime WebSocket server (wss) for a scripted Live Voice turn.
// After ~1.2 s of appended input audio it scripts one user utterance + one assistant reply.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require(process.env.WS_MODULE || 'ws');
const PORT = Number(process.env.PORT || 18443);
const LOG = process.env.LOG || path.join(__dirname, 'fake-realtime.log');
const TURNS = [
  ['What does this project do? Give me a one-line summary.', 'It is a small demo repository with a README and a single script — nothing else yet.'],
  ['Thanks. Remind me later to add tests.', 'Noted — I will remind you to add tests next time we talk.'],
];
const log = (...a) => fs.appendFileSync(LOG, new Date().toISOString() + ' ' + a.join(' ') + '\n');
const server = https.createServer({
  key: fs.readFileSync(path.join(__dirname, 'tls/server.key')),
  cert: fs.readFileSync(path.join(__dirname, 'tls/server.pem')),
});
const wss = new WebSocketServer({ server });
let conn = 0;
wss.on('connection', (ws, req) => {
  const id = ++conn;
  log(`conn#${id} ${req.url} auth=${req.headers.authorization ? 'Bearer ***' : 'none'}`);
  let seq = 0; const ev = () => `evt_${id}_${++seq}`;
  const send = (o) => { o.event_id = ev(); ws.send(JSON.stringify(o)); log(`conn#${id} >> ${o.type}`); };
  let appendBytes = 0; let turn = 0; let busy = false; const counts = {};
  send({ type: 'session.created', session: { id: `sess_fake_${id}` } });
  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(String(data)); } catch { log(`conn#${id} << (non-json ${data.length}b)`); return; }
    counts[msg.type] = (counts[msg.type] || 0) + 1;
    if (msg.type !== 'input_audio_buffer.append' || counts[msg.type] === 1 || counts[msg.type] % 50 === 0) log(`conn#${id} << ${msg.type} (#${counts[msg.type]})`);
    if (msg.type === 'session.update') {
      send({ type: 'session.updated', session: { id: `sess_fake_${id}`, ...(msg.session || {}) } });
    } else if (msg.type === 'input_audio_buffer.append') {
      appendBytes += Buffer.from(msg.audio || '', 'base64').length;
      // 16 kHz s16le mono => 32000 B/s; script a turn every ~1.2 s of audio.
      if (!busy && turn < TURNS.length && appendBytes >= 38400 * (turn + 1)) { busy = true; scriptTurn(turn++).then(() => { busy = false; }); }
    } else if (msg.type === 'response.create') {
      log(`conn#${id} << response.create ${JSON.stringify(msg).slice(0, 300)}`);
    }
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function scriptTurn(n) {
    const [user, reply] = TURNS[n];
    const item = `item_${id}_${n}`; const resp = `resp_${id}_${n}`;
    send({ type: 'input_audio_buffer.speech_started', item_id: item, audio_start_ms: 0 });
    await sleep(150);
    send({ type: 'input_audio_buffer.speech_stopped', item_id: item, audio_end_ms: 1100 });
    send({ type: 'input_audio_buffer.committed', item_id: item });
    send({ type: 'conversation.item.input_audio_transcription.completed', item_id: item, transcript: user });
    send({ type: 'response.created', response: { id: resp, status: 'in_progress' } });
    const pcm = Buffer.alloc(4800); // 100 ms of silence @ 24 kHz s16le
    send({ type: 'response.audio.delta', response_id: resp, item_id: `out_${n}`, delta: pcm.toString('base64') });
    for (const w of reply.split(/(?<= )/)) { send({ type: 'response.audio_transcript.delta', response_id: resp, item_id: `out_${n}`, delta: w }); await sleep(20); }
    send({ type: 'response.audio_transcript.done', response_id: resp, item_id: `out_${n}`, transcript: reply });
    send({ type: 'response.audio.done', response_id: resp, item_id: `out_${n}` });
    send({ type: 'response.done', response: { id: resp, status: 'completed' } });
  }
  ws.on('close', (c) => log(`conn#${id} closed ${c} counts=${JSON.stringify(counts)}`));
});
server.listen(PORT, '127.0.0.1', () => { log(`listening ${PORT}`); console.log(`FAKE_REALTIME_READY ${PORT}`); });
