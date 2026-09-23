// Minimal OpenAI-compatible server: logs every request body (model + last user text) to a JSONL.
const http = require('http'); const fs = require('fs');
const LOG = process.env.FAKE_LOG || '/root/verify/pr12345-r3-harness/fake-openai.jsonl';
const port = Number(process.env.FAKE_PORT || 18346);
http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    let j = {}; try { j = JSON.parse(body || '{}'); } catch {}
    const msgs = j.messages || [];
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    const text = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
    fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), url: req.url, model: j.model, stream: !!j.stream, lastUser: text.slice(-400) }) + '\n');
    if (req.url.includes('/models')) { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({data:[{id:'fake-a'},{id:'fake-b'}]})); }
    const reply = `ACK from ${j.model}`;
    if (j.stream) {
      res.writeHead(200, {'content-type':'text/event-stream'});
      const base = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: j.model };
      res.write(`data: ${JSON.stringify({...base, choices:[{index:0, delta:{role:'assistant', content: reply}, finish_reason:null}]})}\n\n`);
      res.write(`data: ${JSON.stringify({...base, choices:[{index:0, delta:{}, finish_reason:'stop'}], usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}})}\n\n`);
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, {'content-type':'application/json'});
      res.end(JSON.stringify({ id:'c1', object:'chat.completion', created:1, model:j.model, choices:[{index:0, message:{role:'assistant', content: reply}, finish_reason:'stop'}], usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13} }));
    }
  });
}).listen(port, '127.0.0.1', () => console.log('fake-openai on', port));
