// Minimal Qwen-ASR (chat/completions input_audio) stand-in. Logs every request, returns a
// transcript that describes the audio it actually received, so the text that lands in the
// Web Shell composer proves the whole WebView -> daemon -> ASR chain carried real PCM.
import http from 'node:http';
import fs from 'node:fs';
const port = Number(process.argv[2] || 18127);
const log = process.argv[3] || './fake-asr.log';
let n = 0;
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    n++;
    const entry = { n, t: new Date().toISOString(), method: req.method, url: req.url, auth: !!req.headers.authorization };
    let text = 'fake-asr: no audio';
    try {
      const j = JSON.parse(body || '{}');
      entry.model = j.model;
      const part = j.messages?.at(-1)?.content?.find((p) => p.type === 'input_audio');
      if (part) {
        const url = part.input_audio.data;
        entry.format = part.input_audio.format;
        entry.mime = url.slice(5, url.indexOf(';'));
        const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
        entry.bytes = buf.length;
        if (buf.toString('ascii', 0, 4) === 'RIFF') {
          const rate = buf.readUInt32LE(24), ch = buf.readUInt16LE(22), bits = buf.readUInt16LE(34);
          let off = 12, dataLen = 0, dataOff = 0;
          while (off + 8 <= buf.length) { const id = buf.toString('ascii', off, off + 4); const len = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; dataLen = Math.min(len, buf.length - dataOff); break; } off += 8 + len; }
          const samples = dataLen / (bits / 8) / ch;
          let peak = 0, sum = 0;
          for (let i = 0; i < samples; i++) { const s = buf.readInt16LE(dataOff + i * 2 * ch); peak = Math.max(peak, Math.abs(s)); sum += s * s; }
          Object.assign(entry, { rate, ch, bits, samples, seconds: +(samples / rate).toFixed(2), peak, rms: +Math.sqrt(sum / Math.max(1, samples)).toFixed(1) });
          text = `fake-asr heard ${entry.seconds}s of ${rate}Hz PCM (${samples} samples, peak ${peak})`;
        }
      }
    } catch (e) { entry.error = String(e); }
    fs.appendFileSync(log, JSON.stringify(entry) + '\n');
    let parsed = {}; try { parsed = JSON.parse(body || '{}'); } catch {}
    if (parsed.model && parsed.model !== 'qwen3-asr-flash') {
      const reply = 'fake-chat: ok';
      if (parsed.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: ' + JSON.stringify({ id: 'c' + n, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: reply }, finish_reason: null }] }) + '\n\n');
        res.write('data: ' + JSON.stringify({ id: 'c' + n, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }) + '\n\n');
        return res.end('data: [DONE]\n\n');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 'c' + n, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'fake-' + n, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }));
  });
}).listen(port, '127.0.0.1', () => console.log('fake-asr listening', port));
