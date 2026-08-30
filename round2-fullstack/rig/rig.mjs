/**
 * Full-stack local rig for PR QwenLM/qwen-code#10357.
 *
 * Runs the real, bundled `qwen channel start <name>` DingTalk channel inside a
 * Linux container whose /etc/hosts points api.dingtalk.com and oapi.dingtalk.com
 * at 127.0.0.1. Everything the channel talks to is served here:
 *   - HTTPS 443  : oapi gettoken, gateway/connections/open, Card OpenAPI
 *   - WS   8899  : the DingTalk Stream gateway (pushes the inbound user message)
 *   - HTTP 8080  : sessionWebhook (plain-text fallback replies)
 *   - HTTP 8081  : OpenAI-compatible model endpoint (streams the answer)
 *
 * Faults are injected at the socket / HTTP-status level, so the channel's own
 * error classification runs unmodified.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';

const SCENARIO = process.env.SCENARIO || 'happy';
const VARIANT = process.env.VARIANT || 'unknown';
const OUT = process.env.OUT_DIR || '/out';
const CLI = process.env.CLI_PATH || '/app/dist/cli.js';
const CLIENT_MODEL = process.env.CLIENT_MODEL || 'm2';
const CERT = process.env.NODE_EXTRA_CA_CERTS || '/rig/certs/cert.pem';
const KEY = CERT.replace(/cert\.pem$/, 'key.pem');

const T0 = Date.now();
const now = () => Date.now() - T0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write(`[rig ${String(now()).padStart(6)}ms] ${m}\n`);

class SimClient {
  constructor(name) {
    this.name = name;
    this.online = true;
    this.card = {};
    this.delivered = false;
    this.streamClosed = false;
    this.missedEvents = 0;
    this.missedStreamFramesAfterReconnect = 0;
    this.streamSubscriptionLost = false;
    this.history = [];
  }
  snap(via) {
    this.history.push({
      t: now(), via,
      content: this.card.content ?? '',
      statusLine: this.card.statusLine ?? '',
      flowStatus: this.card.flowStatus ?? '',
      stopAction: this.card.stop_action ?? '',
    });
  }
  setOnline(online) {
    if (!online && CLIENT_MODEL === 'm2') this.streamSubscriptionLost = true;
    this.online = online;
    this.snap(online ? 'reconnect' : 'disconnect');
  }
  apply(event) {
    if (!this.online) { this.missedEvents++; return; }
    if (event.type === 'stream' && this.streamSubscriptionLost) {
      this.missedStreamFramesAfterReconnect++; return;
    }
    if (event.type === 'create') {
      this.delivered = true;
      this.card = { ...(event.params ?? {}) };
    } else if (event.type === 'stream') {
      if (!this.delivered) return;
      if (event.key === 'content' && !event.finalize) this.card.content = event.content ?? '';
      if (event.finalize) this.streamClosed = true;
    } else {
      if (!this.delivered) return;
      for (const [k, v] of Object.entries(event.params ?? {})) this.card[k] = v;
    }
    this.snap(event.type);
  }
}

const clientA = new SimClient('A');
const clientB = new SimClient('B');
const clients = [clientA, clientB];

const requests = [];
const events = [];
const instances = new Map();
const fallbacks = [];
const tokenRequests = [];
let seq = 0;
let fault = null;
let tokenFault = null;
let firstCreateResolve;
const firstCreate = new Promise((r) => { firstCreateResolve = r; });
let terminalResolve;
const terminalSeen = new Promise((r) => { terminalResolve = r; });

function emit(event) {
  events.push(event);
  for (const c of clients) c.apply(event);
}
function faultMatches(f, p) {
  if (!f) return false;
  if (f.paths === 'card') return p.startsWith('/v1.0/card');
  return f.paths.some((x) => p.startsWith(x));
}
function setFault(f) { fault = f; log(`fault -> ${f ? JSON.stringify(f) : 'none'}`); }

const tls = { key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) };
const apiServer = https.createServer(tls, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { try { handleApi(req, res, Buffer.concat(chunks)); } catch (e) { log(`api handler error ${e}`); try { res.destroy(); } catch {} } });
});

function handleApi(req, res, body) {
  const p = new URL(req.url, 'https://x').pathname;
  const method = req.method || 'GET';
  const t = now();

  if (p === '/gettoken') {
    tokenRequests.push({ t, errcode: tokenFault ? tokenFault.errcode : 0 });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (tokenFault) {
      requests.push({ t, method, path: p, bytes: 0, status: 200, note: `errcode=${tokenFault.errcode}` });
      res.end(JSON.stringify({ errcode: tokenFault.errcode, errmsg: tokenFault.errmsg }));
    } else {
      requests.push({ t, method, path: p, bytes: 0, status: 200 });
      res.end(JSON.stringify({ errcode: 0, access_token: 'fake-access-token', expires_in: 7200 }));
    }
    return;
  }

  if (p === '/v1.0/gateway/connections/open') {
    requests.push({ t, method, path: p, bytes: body.length, status: 200 });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ endpoint: 'ws://127.0.0.1:8899/connect', ticket: 'ticket-1' }));
    return;
  }

  const f = faultMatches(fault, p) ? fault : null;
  if (f) {
    if (f.remaining !== undefined) {
      f.remaining -= 1;
      if (f.remaining <= 0) setFault(null);
    }
    if (f.mode === 'blackhole') {
      requests.push({ t, method, path: p, bytes: body.length, status: 'destroyed' });
      req.socket.destroy();
      return;
    }
    const status = f.status ?? 503;
    requests.push({ t, method, path: p, bytes: body.length, status });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'Injected', message: 'injected fault' }));
    return;
  }

  let payload = {};
  try { payload = JSON.parse(body.toString('utf8') || '{}'); } catch { payload = {}; }
  const outTrackId = String(payload.outTrackId ?? '');
  let logged = {};

  if (p === '/v1.0/card/instances/createAndDeliver' && method === 'POST') {
    const params = (payload.cardData && payload.cardData.cardParamMap) || {};
    instances.set(outTrackId, { ...params });
    emit({ seq: ++seq, t, type: 'create', outTrackId, params: { ...params } });
    logged = { contentLen: (params.content ?? '').length, params: Object.keys(params) };
    if (firstCreateResolve) { firstCreateResolve(); firstCreateResolve = null; }
  } else if (p === '/v1.0/card/streaming' && method === 'PUT') {
    const key = String(payload.key ?? '');
    const content = String(payload.content ?? '');
    const finalize = Boolean(payload.isFinalize);
    const inst = instances.get(outTrackId);
    if (inst && !finalize) inst[key] = content;
    emit({ seq: ++seq, t, type: 'stream', outTrackId, key, content, finalize });
    logged = { contentLen: content.length, params: [key], finalize };
  } else if (p === '/v1.0/card/instances' && method === 'PUT') {
    const params = (payload.cardData && payload.cardData.cardParamMap) || {};
    const inst = instances.get(outTrackId) || {};
    Object.assign(inst, params);
    instances.set(outTrackId, inst);
    emit({ seq: ++seq, t, type: 'instance', outTrackId, params: { ...params } });
    logged = { contentLen: (params.content ?? '').length, params: Object.keys(params) };
    if (String(params.flowStatus ?? '') === '3' && terminalResolve) { terminalResolve(); terminalResolve = null; }
  }

  requests.push({ t, method, path: p, bytes: body.length, status: 200, ...logged });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ requestId: 'req', result: {} }));
}

// -------------------------------------------------------------- sessionWebhook
const sideServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch {}
    const text = parsed?.markdown?.text ?? parsed?.text?.content ?? body;
    fallbacks.push({ t: now(), msgtype: parsed.msgtype ?? 'unknown', text: String(text) });
    log(`webhook fallback (${String(text).length} chars)`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
  });
});

// ------------------------------------------------------------------- fake model
const ANSWER_CHUNKS = [];
{
  const lines = [
    'Here is how the DingTalk status card behaves while a run is in flight.',
    '',
  ];
  for (let i = 1; i <= 12; i++) {
    lines.push(
      `${i}. step ${String(i).padStart(2, '0')} - the controller writes the growing answer body ` +
        'through card/streaming and refreshes the status line through card/instances, ' +
        'so an online client sees the text grow once per flush window.',
    );
  }
  lines.push('', 'When the run ends the stream is finalized and one last instance update flips',
    'flowStatus to 3, drops the Stop action and pins the final body on the card.');
  const words = lines.join('\n').split(/(\s+)/);
  let buf = '';
  for (const w of words) {
    buf += w;
    if (buf.length >= 45) { ANSWER_CHUNKS.push(buf); buf = ''; }
  }
  if (buf) ANSWER_CHUNKS.push(buf);
}
const CHUNK_DELAY_MS = Number(process.env.CHUNK_DELAY_MS || 320);
let modelChunkHooks = [];
const onModelChunk = (fn) => { modelChunkHooks.push(fn); };

const openaiServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    let payload = {};
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}
    const msgs = Array.isArray(payload.messages) ? payload.messages : [];
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const lastText = typeof lastUser?.content === 'string'
      ? lastUser.content
      : JSON.stringify(lastUser?.content ?? '');
    const isProbe = lastText.includes('CARD-PROBE');
    const stream = payload.stream !== false;
    log(`model request stream=${stream} probe=${isProbe} chars=${lastText.length}`);
    if (!stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'x', object: 'chat.completion', created: Math.floor(Date.now() / 1000),
        model: 'fake-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const frame = (delta, finish) => ({
      id: 'x', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
      model: 'fake-model', choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    });
    if (!isProbe) {
      send(frame({ role: 'assistant', content: 'ok' }));
      send(frame({}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    send(frame({ role: 'assistant', content: '' }));
    for (let i = 0; i < ANSWER_CHUNKS.length; i++) {
      await sleep(CHUNK_DELAY_MS);
      send(frame({ content: ANSWER_CHUNKS[i] }));
      for (const h of modelChunkHooks) h(i, ANSWER_CHUNKS.length);
    }
    send(frame({}, 'stop'));
    res.write('data: [DONE]\n\n');
    res.end();
    log('model stream finished');
  });
});

// ------------------------------------------------------------------ WS gateway
const wss = new WebSocketServer({ port: 8899 });
let sock = null;
let sockResolve;
const sockReady = new Promise((r) => { sockResolve = r; });
wss.on('connection', (ws) => {
  log('stream WS connected');
  sock = ws;
  ws.send(JSON.stringify({ type: 'SYSTEM', headers: { topic: 'CONNECTED', messageId: 'sys-1', contentType: 'application/json' }, data: '{}' }));
  ws.send(JSON.stringify({ type: 'SYSTEM', headers: { topic: 'REGISTERED', messageId: 'sys-2', contentType: 'application/json' }, data: '{}' }));
  ws.on('message', () => {});
  ws.on('close', () => log('stream WS closed'));
  if (sockResolve) { sockResolve(ws); sockResolve = null; }
});

function pushUserMessage(text, msgId) {
  const data = {
    msgId,
    msgtype: 'text',
    conversationType: '1',
    conversationId: 'cidPROBE==',
    sessionWebhook: 'http://127.0.0.1:8080/robot/send?access_token=probe',
    senderId: 'sender-1',
    senderStaffId: 'staff-1',
    senderNick: 'Reviewer',
    chatbotUserId: 'bot-1',
    isInAtList: false,
    text: { content: text },
  };
  sock.send(JSON.stringify({
    type: 'CALLBACK',
    headers: { topic: '/v1.0/im/bot/messages/get', messageId: msgId, contentType: 'application/json' },
    data: JSON.stringify(data),
  }));
  log(`pushed user message ${msgId}`);
}

// ------------------------------------------------------------------- scenarios
async function scenarioBody() {
  switch (SCENARIO) {
    case 'happy':
      await firstCreate;
      break;
    case 'content-outage': {
      await firstCreate;
      await sleep(2000);
      setFault({ paths: 'card', mode: 'blackhole' });
      await sleep(3000);
      setFault(null);
      break;
    }
    case 'terminal-outage': {
      await firstCreate;
      await new Promise((resolve) => {
        onModelChunk((i, total) => { if (i === total - 3) resolve(); });
      });
      setFault({ paths: 'card', mode: 'blackhole' });
      await sleep(5000);
      setFault(null);
      break;
    }
    case 'create-outage': {
      // Armed before the first flush, so `createAndDeliver` itself is refused.
      setFault({ paths: 'card', mode: 'blackhole' });
      await sleep(4000);
      setFault(null);
      break;
    }
    case 'terminal-outage-permanent': {
      await firstCreate;
      await new Promise((resolve) => {
        onModelChunk((i, total) => { if (i === total - 3) resolve(); });
      });
      setFault({ paths: 'card', mode: 'blackhole' });
      await sleep(60000);
      break;
    }
    case 'client-reconnect': {
      await firstCreate;
      await sleep(2000);
      clientA.setOnline(false);
      log('client A offline');
      await sleep(3300);
      clientA.setOnline(true);
      log('client A back online');
      break;
    }
    case 'token-permanent': {
      tokenFault = { errcode: 40001, errmsg: 'invalid appkey or not exist' };
      break;
    }
    case 'token-transient': {
      tokenFault = { errcode: -1, errmsg: 'system busy' };
      break;
    }
    default:
      throw new Error(`unknown scenario ${SCENARIO}`);
  }
}

// ------------------------------------------------------------------------ main
function contentRegressions(history) {
  const bad = [];
  let prev = '';
  for (const h of history) {
    if (h.via === 'disconnect' || h.via === 'reconnect') continue;
    if (prev && h.content && !h.content.startsWith(prev)) {
      bad.push({ t: h.t, from: prev.length, to: h.content.length });
    }
    if (h.content) prev = h.content;
  }
  return bad;
}

async function main() {
  await new Promise((r) => apiServer.listen(443, '127.0.0.1', r));
  await new Promise((r) => sideServer.listen(8080, '127.0.0.1', r));
  await new Promise((r) => openaiServer.listen(8081, '127.0.0.1', r));
  log('servers up');

  const tokenScenario = SCENARIO.startsWith('token-');

  const env = {
    ...process.env,
    HOME: '/root',
    QWEN_HOME: '/root/.qwen',
    QWEN_SANDBOX: 'false',
    QWEN_CODE_NO_RELAUNCH: 'true',
    QWEN_CODE_SUPPRESS_YOLO_WARNING: '1',
    OPENAI_API_KEY: 'fake-key',
    OPENAI_BASE_URL: 'http://127.0.0.1:8081/v1',
    OPENAI_MODEL: 'fake-model',
    QWEN_MODEL: 'fake-model',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  };
  const cliLog = fs.createWriteStream(`${OUT}/${VARIANT}-${SCENARIO}.cli.log`);
  const child = spawn(process.execPath, [CLI, 'channel', 'start', 'dt'], {
    cwd: '/work', env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(cliLog);
  child.stderr.pipe(cliLog);
  child.on('exit', (code, sig) => log(`cli exited code=${code} sig=${sig}`));

  const connected = await Promise.race([sockReady, sleep(45000).then(() => null)]);
  if (!connected) {
    log('FATAL: stream WS never connected');
    child.kill('SIGKILL');
    process.exit(3);
  }
  await sleep(500);
  // The Stream SDK fetches its own gettoken before connecting, so a token
  // fault can only be armed once the channel is already online.
  if (tokenScenario) await scenarioBody();
  pushUserMessage('CARD-PROBE please explain the status card lifecycle', 'msg-probe-1');

  const scenarioTask = tokenScenario ? Promise.resolve() : scenarioBody();
  const budget = tokenScenario ? 20000 : SCENARIO === 'terminal-outage-permanent' ? 90000 : 45000;
  await Promise.race([
    Promise.all([scenarioTask, terminalSeen]).then(() => sleep(2500)),
    sleep(budget),
  ]);
  await sleep(500);

  const finalInstance = [...instances.values()][0] ?? {};
  const cardRequests = requests.filter((r) => String(r.path).startsWith('/v1.0/card'));
  const result = {
    scenario: SCENARIO,
    variant: VARIANT,
    clientModel: CLIENT_MODEL,
    wallMs: now(),
    tokenRequests,
    requestCount: cardRequests.length,
    uploadedBytes: cardRequests.reduce((a, r) => a + (r.bytes || 0), 0),
    requests,
    events: events.map((e) => ({ ...e, content: e.content === undefined ? undefined : e.content.length })),
    finalInstance: {
      contentLen: (finalInstance.content ?? '').length,
      contentTail: (finalInstance.content ?? '').slice(-160),
      statusLine: finalInstance.statusLine ?? '',
      flowStatus: finalInstance.flowStatus ?? '',
      stopAction: finalInstance.stop_action ?? '',
      hasAction: finalInstance.hasAction ?? '',
    },
    clients: clients.map((c) => ({
      name: c.name,
      online: c.online,
      delivered: c.delivered,
      streamClosed: c.streamClosed,
      missedEvents: c.missedEvents,
      missedStreamFramesAfterReconnect: c.missedStreamFramesAfterReconnect,
      finalContentLen: (c.card.content ?? '').length,
      finalStatusLine: c.card.statusLine ?? '',
      finalFlowStatus: c.card.flowStatus ?? '',
      finalStopAction: c.card.stop_action ?? '',
      contentRegressions: contentRegressions(c.history),
      history: c.history.map((h) => ({ t: h.t, via: h.via, len: h.content.length, statusLine: h.statusLine, flowStatus: h.flowStatus, stopAction: h.stopAction })),
      finalContent: c.card.content ?? '',
    })),
    fallbacks,
  };
  fs.writeFileSync(`${OUT}/${VARIANT}-${SCENARIO}.json`, JSON.stringify(result, null, 2));
  log(`wrote ${OUT}/${VARIANT}-${SCENARIO}.json`);

  child.kill('SIGINT');
  await sleep(1500);
  try { child.kill('SIGKILL'); } catch {}
  process.exit(0);
}

main().catch((e) => { log(`FATAL ${e?.stack || e}`); process.exit(1); });
