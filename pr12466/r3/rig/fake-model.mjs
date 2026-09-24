// Scripted OpenAI-compatible model. Scenario chosen by a "SCN:<name>" tag in the
// last real user prompt; each scenario is a list of steps, and the step index is
// the number of tool results after that prompt.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] || 4591);
const logFile = process.argv[3];
const log = (o) => logFile && fs.appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...o }) + '\n');

const sh = (command, description) => ({ name: 'run_shell_command', args: { command, description, is_background: false } });
const SCENARIOS = {
  // two sequential shells, slow enough to open the panel while running
  slow: [[sh("node -e \"setTimeout(()=>console.log('alpha'),4000)\"", 'first slow step')], [sh("node -e \"setTimeout(()=>console.log('beta'),3000)\"", 'second slow step')], 'slow done'],
  quick: [[sh('echo quick-one', 'quick shell'), { name: 'glob', args: { pattern: '*.txt' } }], 'quick done'],
  // needs approval in default mode (writes a file)
  approve: [[sh('echo approved > approved.txt && cat approved.txt', 'write a file')], 'approve done'],
  fail: [[sh('echo boom 1>&2; exit 3', 'failing shell')], 'fail done'],
  parallel: [[sh("node -e \"setTimeout(()=>console.log('p1'),1000)\"", 'p1'), sh("node -e \"setTimeout(()=>console.log('p2'),2000)\"", 'p2'), sh('echo p3', 'p3')], 'parallel done'],
  text: ['plain answer'],
};

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const text = typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join('');
    const match = text.match(/SCN:([a-z]+)/);
    if (match) return { scn: match[1], index: i };
  }
  return undefined;
}

let seq = 0;
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    if (!req.url.includes('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] }));
      return;
    }
    const json = JSON.parse(body || '{}');
    const tools = (json.tools || []).map((t) => t.function?.name);
    const main = tools.includes('run_shell_command');
    const found = main ? lastUserText(json.messages || []) : undefined;
    let step = 'aux';
    if (found) {
      const after = json.messages.slice(found.index + 1);
      const toolResults = after.filter((m) => m.role === 'tool').length;
      const assistantTurns = after.filter((m) => m.role === 'assistant').length;
      const script = SCENARIOS[found.scn] || ['unknown scenario'];
      step = script[Math.min(assistantTurns, script.length - 1)];
      log({ scn: found.scn, assistantTurns, toolResults, stream: !!json.stream });
    }
    const id = `chatcmpl-${++seq}`;
    const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fake-model' };
    const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
    if (!json.stream) {
      const content = step === 'aux' ? '{}' : typeof step === 'string' ? step : 'ok';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id, object: 'chat.completion', model: 'fake-model', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (o) => res.write(`data: ${JSON.stringify({ ...base, ...o })}\n\n`);
    if (Array.isArray(step)) {
      send({ choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] });
      step.forEach((call, i) => {
        send({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: `call_${seq}_${i}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } }] });
      });
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage });
    } else {
      const text = step === 'aux' ? 'ok' : step;
      send({ choices: [{ index: 0, delta: { role: 'assistant', content: text } }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
}).listen(port, '127.0.0.1', () => console.log('fake model on', port));
