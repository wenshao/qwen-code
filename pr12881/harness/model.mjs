// Fake OpenAI-compatible model for the #12881 rig.
// A prompt containing SLOW_<n> holds the reply for n seconds, so a Turn stays
// active; every other prompt answers REPLY_<count> at once.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2]);
const log = process.argv[3];
let count = 0;
http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      count += 1;
      const n = count;
      const text = body;
      const slow = /SLOW_(\d+)/.exec(text);
      fs.appendFileSync(log, `${new Date().toISOString()} request#${n} slow=${slow ? slow[1] : 0}\n`);
      if (slow) await new Promise((r) => setTimeout(r, Number(slow[1]) * 1000));
      const chunk = (delta, finish) =>
        `data: ${JSON.stringify({ id: 'rig', object: 'chat.completion.chunk', created: 0, model: 'rig-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(chunk({ role: 'assistant', content: `REPLY_${n}` }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n');
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`model listening ${port}`));
