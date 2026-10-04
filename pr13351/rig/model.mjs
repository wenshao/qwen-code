// VERIFICATION RIG ONLY (PR #13351): deterministic OpenAI-compatible model that cuts streams mid-answer.
// The script is chosen by a marker in the most recent user message that carries one:
//   MSR id=<unique> sc=<scenario> [cuts=<k>] [hold=<ms>|wait] [delay=<ms>]
// Attempts are counted per (id, round); round = number of tool results after the marker message.
//   cut      attempts 1..k: "MIDSTREAM_PARTIAL" (attempt>1: "_<n>" suffix), hold, destroy the socket;
//            later attempt: "MIDSTREAM_RECOVERED_AFTER_RETRY"
//   multi    cut attempts stream 4 chunks (one 4000-byte chunk, above the Harness 3 KiB delta cap) then cut
//   tool     round 0: "TOOL_PREFACE. " + write_file call; round 1 behaves like `cut` (ROUND1_PARTIAL / ROUND1_RECOVERED)
//   toolcut  round 0 attempt 1: text + a complete tool call, then cut before finish_reason; attempt 2 same + finish;
//            round 1: "TOOLCUT_DONE"
//   slow     like cut but streams 6 visible chunks with <delay> between them (live UI capture)
//   errframe attempts 1..k: "MIDSTREAM_PARTIAL" then an in-stream provider error frame instead of a socket cut
//   tool2    rounds 0/1: 2 text chunks + write_file each; round 2: ROUND2_PARTIAL cut / ROUND2_RECOVERED
//   plain    "SECOND_TURN_OK"
// Control: POST /__rig/release?id=<id>  releases a held cut for that id (hold=wait waits up to 20 s).
// Every request is logged with its attempt number, a body hash, and whether it is continuation-shaped.
import http from 'node:http';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const port = Number(process.argv[2]);
const log = process.argv[3];
const attempts = new Map();
const releases = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (c) => (typeof c === 'string' ? c : JSON.stringify(c ?? ''));
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
let n = 0;
const chunk = (d, f = null) =>
  JSON.stringify({ id: 'rig-' + n, object: 'chat.completion.chunk', created: 0, model: 'rig-model', choices: [{ index: 0, delta: d, finish_reason: f }] });
const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
const done = (res) => res.end(`data: ${JSON.stringify({ id: 'rig-' + n, object: 'chat.completion.chunk', created: 0, model: 'rig-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`);

function waitRelease(id, hold) {
  if (hold === '0') return Promise.resolve('immediate');
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve('timeout'), hold === 'wait' ? 20_000 : Number(hold));
    releases.set(id, () => {
      clearTimeout(timeout);
      resolve('released');
    });
  });
}

async function cutAfter(res, id, hold, entry) {
  const how = await waitRelease(id, hold);
  entry.cut = how;
  fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), id, event: 'cut', how }) + '\n');
  res.socket?.destroy();
}

http
  .createServer((req, res) => {
    if (req.url?.startsWith('/__rig/release')) {
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      const f = releases.get(id);
      releases.delete(id);
      f?.();
      res.end(JSON.stringify({ released: Boolean(f) }));
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      n += 1;
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const messages = body.messages ?? [];
      let markerIndex = -1;
      let marker;
      messages.forEach((m, i) => {
        if (m.role !== 'user') return;
        const found = [...text(m.content).matchAll(/MSR([^\n"\\]*)/g)].at(-1);
        if (found) {
          markerIndex = i;
          marker = found;
        }
      });
      const opts = Object.fromEntries([...(marker?.[1] ?? '').matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
      const id = opts.id ?? 'none';
      const sc = opts.sc ?? 'plain';
      const round = messages.slice(markerIndex + 1).filter((m) => m.role === 'tool').length;
      const key = `${id}:${round}`;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      const serialized = JSON.stringify(messages);
      const entry = {
        t: new Date().toISOString(),
        n,
        id,
        sc,
        round,
        attempt,
        bodySha: sha(raw),
        messagesSha: sha(serialized),
        messageCount: messages.length,
        roles: messages.map((m) => m.role).join(','),
        continuationShaped: /MIDSTREAM_PARTIAL|ROUND1_PARTIAL|MP-1/.test(serialized),
        historyHasPartial: serialized.includes('MIDSTREAM_PARTIAL'),
        historyHasRecovered: serialized.includes('MIDSTREAM_RECOVERED_AFTER_RETRY'),
        lastMessage: text(messages.at(-1)?.content).slice(0, 300),
      };
      fs.appendFileSync(log, JSON.stringify(entry) + '\n');
      fs.writeFileSync(`${log}.body-${id}-r${round}-a${attempt}.json`, raw);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (d, f) => res.write(`data: ${chunk(d, f)}\n\n`);
      send({ role: 'assistant', content: '' });
      const cuts = Number(opts.cuts ?? 1);
      const hold = opts.hold ?? '1500';
      const delay = Number(opts.delay ?? 400);

      if (sc === 'cut' || sc === 'errframe' || (sc === 'tool' && round >= 1) || sc === 'slow' || sc === 'multi') {
        const prefix = sc === 'tool' ? 'ROUND1' : 'MIDSTREAM';
        if (attempt <= cuts) {
          if (sc === 'multi') {
            for (const piece of ['MP-1 ', 'MP-2 ', 'X'.repeat(4000) + ' ', 'MP-4 ']) send({ content: piece });
          } else if (sc === 'slow') {
            for (let i = 1; i <= 6; i++) {
              send({ content: `${i === 1 ? 'MIDSTREAM_PARTIAL' : ''} partial-${attempt}.${i}` });
              await sleep(delay);
            }
          } else {
            send({ content: `${prefix}_PARTIAL${attempt > 1 ? '_' + attempt : ''}` });
          }
          if (sc === 'errframe') {
            await waitRelease(id, hold);
            res.write(`data: ${JSON.stringify({ error: { message: 'upstream connect error or disconnect/reset before headers', type: 'server_error', code: 503 } })}\n\n`);
            res.end();
            return;
          }
          await cutAfter(res, id, hold, entry);
          return;
        }
        if (sc === 'slow') {
          for (let i = 1; i <= 4; i++) {
            send({ content: `${i === 1 ? 'MIDSTREAM_RECOVERED_AFTER_RETRY' : ''} final.${i}` });
            await sleep(delay);
          }
        } else {
          send({ content: sc === 'multi' ? 'MULTI_RECOVERED' : `${prefix}_RECOVERED${prefix === 'MIDSTREAM' ? '_AFTER_RETRY' : ''}` });
        }
        done(res);
        return;
      }
      if (sc === 'duration') {
        // A gateway that cuts every stream <limit> ms after it starts; a well-behaved provider that honors a
        // continuation (resumes after the last D-chunk it is shown). 12 chunks, <delay> ms apart.
        const limit = Number(opts.limit ?? 2500);
        const total = Number(opts.total ?? 12);
        let start = 1;
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
        const resumed = serialized.includes('The connection dropped mid-response') && lastAssistant;
        if (resumed) {
          const seen = [...text(lastAssistant.content).matchAll(/D(\d\d)/g)].map((m) => Number(m[1]));
          if (seen.length) start = Math.max(...seen) + 1;
        }
        entry.durationStart = start;
        const began = Date.now();
        for (let i = start; i <= total; i++) {
          if (Date.now() - began + delay > limit) {
            fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), id, event: 'cut', how: 'duration-limit', at: i }) + '\n');
            res.socket?.destroy();
            return;
          }
          await sleep(delay);
          send({ content: `D${String(i).padStart(2, '0')} ` });
        }
        done(res);
        return;
      }
      if (sc === 'tool2') {
        // rounds 0 and 1: two text chunks + a write_file call each; round 2: cut like `cut` (ROUND2_*).
        if (round <= 1) {
          send({ content: `R${round}A ` });
          send({ content: `R${round}B ` });
          const call = { name: 'write_file', arguments: JSON.stringify({ file_path: `msr-${id}-${round}.txt`, content: `MSR_TOOL2_${round}\n` }) };
          send({ tool_calls: [{ index: 0, id: `call_${id}_${round}`, type: 'function', function: { name: call.name, arguments: '' } }] });
          send({ tool_calls: [{ index: 0, function: { arguments: call.arguments } }] });
          res.end(`data: ${chunk({}, 'tool_calls')}\n\ndata: [DONE]\n\n`);
          return;
        }
        if (attempt <= cuts) {
          send({ content: 'ROUND2_PARTIAL' });
          await cutAfter(res, id, hold, entry);
          return;
        }
        send({ content: 'ROUND2_RECOVERED' });
        done(res);
        return;
      }
      if (sc === 'tool' || sc === 'toolcut') {
        if (round === 0) {
          send({ content: sc === 'tool' ? 'TOOL_PREFACE. ' : 'PREFACE_BEFORE_TOOL. ' });
          const call = { name: 'write_file', arguments: JSON.stringify({ file_path: `msr-${id}.txt`, content: `MSR_TOOL_${id}\n` }) };
          send({ tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: call.name, arguments: '' } }] });
          send({ tool_calls: [{ index: 0, function: { arguments: call.arguments } }] });
          if (sc === 'toolcut' && attempt <= cuts) {
            await cutAfter(res, id, hold, entry);
            return;
          }
          res.end(`data: ${chunk({}, 'tool_calls')}\n\ndata: [DONE]\n\n`);
          return;
        }
        send({ content: 'TOOLCUT_DONE' });
        done(res);
        return;
      }
      send({ content: 'SECOND_TURN_OK' });
      done(res);
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`model listening ${port}`));
