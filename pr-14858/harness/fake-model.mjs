// Scripted OpenAI-compatible model for the PR #14858 loop-stop scenarios.
// usage: node fake-model.mjs <port> <logfile>
// The scenario is picked by a `SCEN=<name>` marker in the latest user message
// that carries one; the round is the number of assistant tool-call messages
// after that user message, so side queries never advance a scenario.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] || 0);
const logFile = process.argv[3] || '/dev/null';
const WS = process.env.FAKE_WS || '/root/verify/pr14858/ws';
const FILE = `${WS}/big.txt`;

const log = (o) => fs.appendFileSync(logFile, JSON.stringify(o) + '\n');

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((p) => (typeof p === 'string' ? p : p.text || '')).join('');
  return '';
}

const rf = (offset, limit = 1) => ({
  name: 'read_file',
  args: { file_path: FILE, offset, limit },
});
const glob = (pattern) => ({ name: 'glob', args: { pattern } });

// Each scenario: (round, ord) => array of calls, or null to finish the turn.
const SCENARIOS = {
  // one distinct call per round
  explicit: (r) => (r <= 20 ? [rf(r * 3)] : null),
  // 10 calls per round, one identical glob among 9 distinct reads
  stuck: (r) => {
    if (r > 30) return null;
    const calls = [];
    for (let i = 0; i < 9; i++) calls.push(rf(r * 10 + i));
    calls.splice(4, 0, glob('**/*.never-matches-stuck'));
    return calls;
  },
  // 25 distinct calls per round, never a repeat: only the backstop can stop it
  backstop: (r) => {
    if (r > 60) return null;
    const calls = [];
    for (let i = 0; i < 25; i++) calls.push(glob(`nomatch-${r}-${i}/*.zzz`));
    return calls;
  },
  // heuristic global duplicate: identical glob interleaved with distinct calls
  repeated: (r) => {
    if (r > 20) return null;
    return [rf(r * 5), glob('**/*.never-matches-repeated'), { name: 'grep_search', args: { pattern: `nomatch_${r}_zz` } }];
  },
  // the same call every round
  consecutive: (r) => (r <= 12 ? [rf(7)] : null),
  // provider replays an executed call id with the same arguments
  // read_file without its required file_path: schema validation error
  invalid: (r) => (r <= 10 ? [{ name: 'read_file', args: { offset: r } }] : null),
  // the same execution failure (missing file) in every batch, distinct args
  failing: (r) => {
    if (r > 30) return null;
    const calls = [];
    for (let i = 0; i < 4; i++) calls.push({ name: 'read_file', args: { file_path: `${WS}/does-not-exist.txt`, offset: r * 10 + i, limit: 1 } });
    return calls;
  },
  replay: (r) => (r <= 5 ? [{ ...rf(r <= 3 ? 3 : r * 3), fixedId: r <= 3 ? 'replayed' : undefined }] : null),
};

function callsFor(body) {
  const msgs = body.messages || [];
  let lastUser = -1;
  let scen = null;
  let ord = 0;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'user') continue;
    const m = /SCEN=([a-z]+)/.exec(textOf(msgs[i].content));
    if (m) {
      lastUser = i;
      scen = m[1];
      ord++;
    }
  }
  if (!scen) return { scen: null };
  let round = 1;
  for (let i = lastUser + 1; i < msgs.length; i++) {
    if (msgs[i].role === 'assistant' && msgs[i].tool_calls?.length) round++;
  }
  const fn = SCENARIOS[scen];
  const calls = fn ? fn(round, ord) : null;
  return { scen, round, ord, calls };
}

function sse(res, chunks) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

const base = (delta, finish = null) => ({
  id: 'chatcmpl-fake',
  object: 'chat.completion.chunk',
  created: Math.floor(Date.now() / 1000),
  model: 'fake',
  choices: [{ index: 0, delta, finish_reason: finish }],
});

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    if (!req.url.includes('chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake', object: 'model' }] }));
      return;
    }
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {}
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const info = hasTools ? callsFor(body) : { scen: null };
    const entry = {
      t: Date.now(),
      hasTools,
      scen: info.scen,
      round: info.round,
      ord: info.ord,
      nCalls: info.calls ? info.calls.length : 0,
      nMsgs: (body.messages || []).length,
    };
    log(entry);
    const stream = body.stream !== false;
    if (!info.scen || !info.calls) {
      const text = info.scen ? `DONE ${info.scen} after ${info.round - 1} rounds` : 'ok';
      if (!stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'x', object: 'chat.completion', created: 0, model: 'fake',
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }));
        return;
      }
      sse(res, [base({ role: 'assistant', content: text }), base({}, 'stop'),
        { ...base({}), choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }]);
      return;
    }
    const chunks = [base({ role: 'assistant', content: '' })];
    info.calls.forEach((c, i) => {
      const id = c.fixedId ? `call_${c.fixedId}_${info.ord}` : `call_${info.scen}_${info.ord}_${info.round}_${i}`;
      chunks.push(base({ tool_calls: [{ index: i, id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }] }));
    });
    chunks.push(base({}, 'tool_calls'));
    chunks.push({ ...base({}), choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
    sse(res, chunks);
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`FAKE_SERVER_READY http://127.0.0.1:${server.address().port}/v1`);
});
