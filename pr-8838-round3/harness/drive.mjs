// Drives a real `qwen serve` daemon over its REST + SSE surface.
//   node drive.mjs seed <baseUrl> <token> <cwd> <outDir> ok|fail|retry|uretry
//   node drive.mjs cold <baseUrl> <token> <cwd> <sessionId> <outDir>
//   node drive.mjs probe <baseUrl> <token> <cwd> <sessionId> <outDir>
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [mode, base, token, cwd, ...rest] = process.argv.slice(2);
const auth = { Authorization: `Bearer ${token}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/capabilities`, { headers: auth });
      if (r.status !== 503) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('daemon never became ready');
}

async function call(method, url, clientId, body) {
  const r = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...auth,
      'Content-Type': 'application/json',
      ...(clientId ? { 'X-Qwen-Client-Id': clientId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: r.status, json };
}

function openEvents(sessionId, clientId, file) {
  const events = [];
  const waiters = [];
  (async () => {
    const r = await fetch(
      `${base}/session/${encodeURIComponent(sessionId)}/events?maxQueued=2048`,
      { headers: { ...auth, 'X-Qwen-Client-Id': clientId, Accept: 'text/event-stream' } },
    );
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (!data) continue;
        let ev;
        try {
          ev = JSON.parse(data);
        } catch {
          ev = { raw: data };
        }
        const s = JSON.stringify(ev);
        events.push(s);
        appendFileSync(file, JSON.stringify({ t: Date.now(), ev }) + '\n');
        for (const w of [...waiters]) {
          if (w.pred(s)) {
            waiters.splice(waiters.indexOf(w), 1);
            w.resolve(s);
          }
        }
      }
    }
  })().catch(() => {});
  return {
    waitFor(pred, timeoutMs, label) {
      const hit = events.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => {
          const k = waiters.indexOf(w);
          if (k >= 0) {
            waiters.splice(k, 1);
            reject(new Error(`timeout waiting for ${label}`));
          }
        }, timeoutMs);
      });
    },
  };
}

async function prompt(sessionId, clientId, ev, text, extra = {}) {
  const p = await call('POST', `/session/${encodeURIComponent(sessionId)}/prompt`, clientId, {
    prompt: [{ type: 'text', text }],
    ...extra,
  });
  log('prompt', JSON.stringify(text), '->', p.status, JSON.stringify(p.json));
  const promptId = p.json.promptId;
  const done = await ev.waitFor(
    (s) => s.includes(promptId) && /turn_complete|turn_error/.test(s),
    60_000,
    `turn end of ${promptId}`,
  );
  log('turn end', done.slice(0, 200));
  return promptId;
}

if (mode === 'seed') {
  const [outDir, scenario] = rest;
  mkdirSync(outDir, { recursive: true });
  await waitReady();
  const s = await call('POST', '/session', undefined, { cwd, sessionScope: 'thread' });
  log('POST /session ->', s.status, JSON.stringify(s.json).slice(0, 300));
  const sessionId = s.json.sessionId ?? s.json.id;
  const clientId = s.json.clientId;
  writeFileSync(path.join(outDir, 'session.json'), JSON.stringify({ sessionId, clientId }, null, 2));
  const ev = openEvents(sessionId, clientId, path.join(outDir, 'events-live.jsonl'));
  await sleep(500);
  if (scenario === 'uretry') {
    // No cron at all: two ordinary user prompts fail during an outage, then
    // the user retries the second one (what the Web Shell's "Try again" sends).
    await prompt(sessionId, clientId, ev, 'OUTAGE-PROMPT: check the release notes.');
    await prompt(sessionId, clientId, ev, 'OUTAGE-PROMPT: check the build status.');
    writeFileSync(path.join(outDir, 'heal'), '');
    await prompt(sessionId, clientId, ev, 'OUTAGE-PROMPT: check the build status.', { retry: true });
    await prompt(sessionId, clientId, ev, 'FOLLOWUP-LIVE: what did the scheduled run report?');
    const cx = await call('GET', `/session/${encodeURIComponent(sessionId)}/context`, clientId);
    writeFileSync(path.join(outDir, 'context-live.json'), JSON.stringify(cx, null, 2));
    log('context-live recovery', JSON.stringify(cx.json?.recovery));
    log('SEED_DONE', sessionId);
    process.exit(0);
  }
  await prompt(sessionId, clientId, ev, scenario === 'ok' ? 'SCHEDULE-IT: post the nightly report every minute' : 'SCHEDULE-FAIL: rebuild the search index every minute');
  const OUTAGE = 'OUTAGE-PROMPT: check the build status.';
  if (scenario === 'retry') await prompt(sessionId, clientId, ev, OUTAGE);
  log('waiting for the scheduler to fire (up to 130s)…');
  const echo = await ev.waitFor(
    (s) => s.includes('user_message_chunk') && s.includes('"source":"cron"'),
    130_000,
    'cron echo',
  );
  log('cron echo', echo.slice(0, 300));
  if (scenario === 'fail' || scenario === 'retry') {
    const err = await ev
      .waitFor((s) => /rejected FAILING-TASK|fake_reject/.test(s) && !s.includes('user_message_chunk'), 45_000, 'cron failure')
      .catch((e) => `NOT SEEN: ${e.message}`);
    log('cron failure surfaced', err.slice(0, 400));
    await sleep(3000);
    if (scenario === 'retry') {
      writeFileSync(path.join(outDir, 'heal'), '');
      // What the Web Shell's "Try again" sends: the same text with retry:true.
      await prompt(sessionId, clientId, ev, OUTAGE, { retry: true });
      await prompt(sessionId, clientId, ev, 'FOLLOWUP-LIVE: what did the scheduled run report?');
    }
  } else {
    const res = await ev.waitFor((s) => s.includes('NIGHTLY-REPORT-RESULT'), 60_000, 'cron result');
    log('cron result', res.slice(0, 200));
    await sleep(3000);
    await prompt(sessionId, clientId, ev, 'FOLLOWUP-LIVE: what did the scheduled run report?');
  }
  const st = await call('GET', `/session/${encodeURIComponent(sessionId)}/status`, clientId);
  writeFileSync(path.join(outDir, 'status-live.json'), JSON.stringify(st, null, 2));
  const cx = await call('GET', `/session/${encodeURIComponent(sessionId)}/context`, clientId);
  writeFileSync(path.join(outDir, 'context-live.json'), JSON.stringify(cx, null, 2));
  log('context-live recovery', JSON.stringify(cx.json?.recovery));
  log('SEED_DONE', sessionId);
  process.exit(0);
}

if (mode === 'probe') {
  // Cold daemon, before any UI touches the session: load it and record the
  // recovery state the Web Shell banner will be driven by.
  const [sessionId, outDir] = rest;
  await waitReady();
  const l = await call('POST', `/session/${encodeURIComponent(sessionId)}/load`, undefined, { cwd });
  const cx = await call('GET', `/session/${encodeURIComponent(sessionId)}/context`, l.json.clientId);
  writeFileSync(path.join(outDir, 'context-cold-before-continue.json'), JSON.stringify(cx, null, 2));
  log('context-cold-before-continue recovery', JSON.stringify(cx.json?.recovery));
  process.exit(0);
}

if (mode === 'cold') {
  const [sessionId, outDir, followup] = rest;
  mkdirSync(outDir, { recursive: true });
  await waitReady();
  const l = await call('POST', `/session/${encodeURIComponent(sessionId)}/load`, undefined, { cwd });
  log('POST /load ->', l.status, JSON.stringify(l.json).slice(0, 300));
  const clientId = l.json.clientId;
  const st = await call('GET', `/session/${encodeURIComponent(sessionId)}/status`, clientId);
  writeFileSync(path.join(outDir, 'status-cold.json'), JSON.stringify(st, null, 2));
  log('status', JSON.stringify(st.json).slice(0, 600));
  const cx = await call('GET', `/session/${encodeURIComponent(sessionId)}/context`, clientId);
  writeFileSync(path.join(outDir, 'context-cold.json'), JSON.stringify(cx, null, 2));
  log('context-cold recovery', JSON.stringify(cx.json?.recovery));
  if (followup !== 'none') {
    const ev = openEvents(sessionId, clientId, path.join(outDir, 'events-cold.jsonl'));
    await sleep(500);
    await prompt(sessionId, clientId, ev, 'FOLLOWUP-COLD: recap the scheduled runs so far.');
  }
  log('COLD_DONE');
  process.exit(0);
}
