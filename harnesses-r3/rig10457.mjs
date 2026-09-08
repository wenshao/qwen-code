/**
 * PR 10457 full-stack rig: the REAL packaged qwen CLI (`dist/cli.js`) running
 * `channel start`, with the unmodified dingtalk-stream SDK, talking to a local
 * stand-in for DingTalk reached through /etc/hosts + a private CA.
 *
 * Nothing in the channel path is mocked. The simulated parties are the ones
 * that are genuinely external: DingTalk's open API, DingTalk's stream gateway,
 * a DingTalk client (whose taps we push back as real CALLBACK frames), and the
 * model endpoint.
 */
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';

const SCENARIO = process.env.SCENARIO || 'allow';
const VARIANT = process.env.VARIANT || 'unknown';
const OUT = process.env.OUT_DIR || '/out';
const CLI = process.env.CLI_PATH || '/app/dist/cli.js';
const CERT = process.env.NODE_EXTRA_CA_CERTS || '/rig/certs/cert.pem';
const KEY = CERT.replace(/cert\.pem$/, 'key.pem');
const OWNER = 'staff-owner';
const STRANGER = 'staff-stranger';
const PERMIT = '/work/PERMIT_10457.txt';

const T0 = Date.now();
const now = () => Date.now() - T0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write(`[rig ${String(now()).padStart(6)}ms] ${m}\n`);

const requests = [];        // every DingTalk API request the daemon made
const cardCreates = [];     // createAndDeliver bodies
const cardUpdates = [];     // PUT /v1.0/card/instances bodies
const webhookTexts = [];    // plain-text messages (the fallback path)
const cardFeedback = [];    // owner-only feedback texts
const robotMessages = [];   // 1:1 robot API messages (owner-only feedback lives here)
const instances = new Map();
let permTrack = null;
let statusTrack = null;
let firstCardResolve;
const firstCard = new Promise((r) => { firstCardResolve = r; });
let statusCardResolve;
const statusCard = new Promise((r) => { statusCardResolve = r; });

const tls = { key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) };
const apiServer = https.createServer(tls, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { try { handleApi(req, res, Buffer.concat(chunks)); } catch (e) { log(`api error ${e}`); try { res.destroy(); } catch {} } });
});

function handleApi(req, res, body) {
  const p = new URL(req.url, 'https://x').pathname;
  const method = req.method || 'GET';
  const t = now();
  let payload = {};
  try { payload = JSON.parse(body.toString('utf8') || '{}'); } catch {}

  if (p === '/gettoken') {
    requests.push({ t, method, path: p });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errcode: 0, access_token: 'fake-access-token', expires_in: 7200 }));
    return;
  }
  if (p === '/v1.0/gateway/connections/open') {
    requests.push({ t, method, path: p });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ endpoint: 'ws://127.0.0.1:8899/connect', ticket: 'ticket-1' }));
    return;
  }

  const outTrackId = String(payload.outTrackId ?? '');
  if (p.startsWith('/v1.0/robot/') && method === 'POST') {
    // Owner-only feedback and other 1:1 robot messages travel here, not through
    // the sessionWebhook. Record the human-visible text.
    let txt = '';
    try {
      const mp = typeof payload.msgParam === 'string' ? JSON.parse(payload.msgParam) : payload.msgParam;
      txt = mp?.text ?? mp?.content ?? mp?.title ?? '';
      if (mp?.title && mp?.text) txt = `${mp.title} | ${mp.text}`;
    } catch { txt = String(payload.msgParam ?? ''); }
    if (txt) {
      robotMessages.push({ t, path: p, text: String(txt) });
      log(`ROBOT MSG -> ${JSON.stringify(String(txt).slice(0, 120))}`);
    }
  }
  if (p === '/v1.0/card/instances/createAndDeliver' && method === 'POST') {
    const params = (payload.cardData && payload.cardData.cardParamMap) || {};
    instances.set(outTrackId, { ...params });
    cardCreates.push({ t, outTrackId, templateId: payload.templateId, params });
    log(`CARD CREATE ${outTrackId} keys=${Object.keys(params).join(',')}`);
    if (outTrackId.startsWith('qwen-status-') && !statusTrack) {
      statusTrack = outTrackId;
      if (statusCardResolve) { statusCardResolve(outTrackId); statusCardResolve = null; }
    }
    if (outTrackId.startsWith('qwen-permission-')) {
      permTrack = outTrackId;
      if (firstCardResolve) { firstCardResolve(outTrackId); firstCardResolve = null; }
    }
  } else if (p === '/v1.0/card/instances' && method === 'PUT') {
    const params = (payload.cardData && payload.cardData.cardParamMap) || {};
    const inst = instances.get(outTrackId) || {};
    Object.assign(inst, params);
    instances.set(outTrackId, inst);
    cardUpdates.push({ t, outTrackId, params });
    if (outTrackId.startsWith('qwen-permission-')) {
      log(`CARD UPDATE ${outTrackId} card_status=${params.card_status ?? '(none)'}`);
    }
  }
  requests.push({ t, method, path: p, outTrackId: outTrackId || undefined });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ requestId: 'req', result: {} }));
}

// ---------------------------------------------------------- sessionWebhook (text)
const sideServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let parsed = {};
    try { parsed = JSON.parse(raw || '{}'); } catch {}
    const text = parsed?.markdown?.text ?? parsed?.text?.content ?? raw;
    const entry = { t: now(), msgtype: parsed.msgtype ?? 'unknown', text: String(text) };
    webhookTexts.push(entry);
    if (/card|卡片/i.test(entry.text)) cardFeedback.push(entry);
    log(`TEXT -> ${JSON.stringify(String(text).slice(0, 90))}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
  });
});

// ------------------------------------------------------------------ fake model
let modelCalls = 0;
const openaiServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    let payload = {};
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}
    const msgs = Array.isArray(payload.messages) ? payload.messages : [];
    const sawToolResult = msgs.some(
      (m) => m.role === 'tool' || (Array.isArray(m.content) && m.content.some((c) => c?.type === 'tool_result')),
    );
    const stream = payload.stream !== false;
    modelCalls++;
    log(`model call #${modelCalls} stream=${stream} sawToolResult=${sawToolResult}`);
    if (!stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'x', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'fake-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const frame = (delta, finish) => ({
      id: 'x', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
      model: 'fake-model', choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    });
    if (!sawToolResult) {
      // Turn 1: ask for a shell command that requires approval.
      send(frame({ role: 'assistant', content: '' }));
      send(frame({
        tool_calls: [{
          index: 0, id: 'call_permit_1', type: 'function',
          function: { name: 'run_shell_command', arguments: JSON.stringify({ command: `touch ${PERMIT}`, description: 'create the permit marker' }) },
        }],
      }));
      send(frame({}, 'tool_calls'));
    } else {
      send(frame({ role: 'assistant', content: 'Done. The permit marker step finished.' }));
      send(frame({}, 'stop'));
    }
    res.write('data: [DONE]\n\n');
    res.end();
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

function pushUserMessage(text, msgId, sender = OWNER) {
  const data = {
    msgId, msgtype: 'text', conversationType: '1', conversationId: 'cidPROBE==',
    sessionWebhook: 'http://127.0.0.1:8080/robot/send?access_token=probe',
    senderId: sender, senderStaffId: sender, senderNick: sender === OWNER ? 'Owner' : 'Stranger',
    chatbotUserId: 'bot-1', isInAtList: false, text: { content: text },
  };
  sock.send(JSON.stringify({
    type: 'CALLBACK',
    headers: { topic: '/v1.0/im/bot/messages/get', messageId: msgId, contentType: 'application/json' },
    data: JSON.stringify(data),
  }));
  log(`pushed user message ${msgId} from ${sender}: ${text}`);
}

// A real DingTalk card tap: the gateway delivers it on the card topic with the
// form payload nested exactly the way the built-in form template sends it.
function pushCardTap(outTrackId, decision, actor = OWNER, msgId = `card-${Date.now()}`) {
  const data = {
    userId: actor,
    outTrackId,
    content: JSON.stringify({
      cardPrivateData: { actionIds: ['submit'], params: { form: { permission_decision: decision } } },
    }),
  };
  sock.send(JSON.stringify({
    type: 'CALLBACK',
    headers: { topic: '/v1.0/card/instances/callback', messageId: msgId, contentType: 'application/json' },
    data: JSON.stringify(data),
  }));
  log(`pushed CARD TAP ${decision} by ${actor} on ${outTrackId}`);
}

function pushActionTap(outTrackId, actionId, actor, msgId = `act-${Date.now()}`) {
  const data = {
    userId: actor,
    outTrackId,
    content: JSON.stringify({ cardPrivateData: { actionIds: [actionId] } }),
  };
  sock.send(JSON.stringify({
    type: 'CALLBACK',
    headers: { topic: '/v1.0/card/instances/callback', messageId: msgId, contentType: 'application/json' },
    data: JSON.stringify(data),
  }));
  log(`pushed ACTION TAP ${actionId} by ${actor} on ${outTrackId}`);
}

const permitExists = () => fs.existsSync(PERMIT);
const permCreates = () => cardCreates.filter((c) => c.outTrackId.startsWith('qwen-permission-'));
const permUpdates = () => cardUpdates.filter((c) => c.outTrackId.startsWith('qwen-permission-'));
const approveTexts = () => webhookTexts.filter((w) => /\/approve|\/deny/.test(w.text));

async function main() {
  await new Promise((r) => apiServer.listen(443, '127.0.0.1', r));
  await new Promise((r) => sideServer.listen(8080, '127.0.0.1', r));
  await new Promise((r) => openaiServer.listen(8081, '127.0.0.1', r));
  log('servers up');

  const env = {
    ...process.env,
    HOME: '/root', QWEN_HOME: '/root/.qwen',
    QWEN_SANDBOX: 'false', QWEN_CODE_NO_RELAUNCH: 'true',
    OPENAI_API_KEY: 'fake-key', OPENAI_BASE_URL: 'http://127.0.0.1:8081/v1',
    OPENAI_MODEL: 'fake-model', QWEN_MODEL: 'fake-model',
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
  };
  const cliLog = fs.createWriteStream(`${OUT}/${VARIANT}-${SCENARIO}.cli.log`);
  const child = spawn(process.execPath, [CLI, 'channel', 'start', 'dt'], {
    cwd: '/work', env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(cliLog);
  child.stderr.pipe(cliLog);
  child.on('exit', (code, sig) => log(`cli exited code=${code} sig=${sig}`));

  const connected = await Promise.race([sockReady, sleep(60000).then(() => null)]);
  if (!connected) { log('FATAL: stream WS never connected'); child.kill('SIGKILL'); process.exit(3); }
  await sleep(800);

  pushUserMessage('please create the permit marker', 'msg-1');

  // Wait for either a permission CARD (head) or the /approve TEXT (base).
  await Promise.race([
    firstCard,
    (async () => { while (approveTexts().length === 0) await sleep(200); })(),
    sleep(60000),
  ]);
  await sleep(1500);

  const track = permTrack;
  let note = '';
  if (SCENARIO === 'allow' || SCENARIO === 'zh') {
    if (track) pushCardTap(track, 'allow_once');
    else { pushUserMessage('/approve', 'msg-approve'); note = 'no card; used text /approve'; }
  } else if (SCENARIO === 'deny') {
    if (track) pushCardTap(track, 'deny');
    else { pushUserMessage('/deny', 'msg-deny'); note = 'no card; used text /deny'; }
  } else if (SCENARIO === 'foreign') {
    if (track) {
      pushCardTap(track, 'allow_once', STRANGER, 'card-stranger');
      await sleep(2500);
      note = `after stranger tap: permit=${permitExists()}`;
      pushCardTap(track, 'allow_once', OWNER, 'card-owner');
    } else { note = 'no card on this arm'; }
  } else if (SCENARIO === 'status-foreign') {
    // Both arms have a status card. A stranger tapping its Stop action reaches
    // sendCardInteractionFeedback on either arm -> shows the locale behaviour.
    const st = await Promise.race([statusCard, sleep(20000).then(() => null)]);
    if (st) { pushActionTap(st, 'btn_stop', STRANGER, 'status-stranger'); note = `status card ${st}`; }
    else note = 'no status card seen';
    await sleep(3000);
    if (track) pushCardTap(track, 'allow_once');
    else pushUserMessage('/approve', 'msg-approve');
  } else if (SCENARIO === 'text-approve') {
    // Owner answers with the TEXT command while the card is still live.
    pushUserMessage('/approve', 'msg-text-approve');
  } else if (SCENARIO === 'cards-off') {
    note = 'text fallback expected';
    pushUserMessage('/approve', 'msg-approve');
  }

  await sleep(SCENARIO === 'foreign' ? 9000 : 7000);

  const finalPerm = track ? instances.get(track) ?? {} : {};
  const result = {
    scenario: SCENARIO, variant: VARIANT, wallMs: now(), note,
    statusCardParams: cardCreates.find((c) => c.outTrackId.startsWith('qwen-status-'))?.params ?? null,
    statusCardFinal: statusTrack ? instances.get(statusTrack) ?? null : null,
    permissionCardsCreated: permCreates().length,
    permissionCardTemplateId: permCreates()[0]?.templateId ?? null,
    permissionCardParams: permCreates()[0]?.params ?? null,
    permissionCardUpdates: permUpdates().map((u) => ({ t: u.t, card_status: u.params.card_status ?? null })),
    finalPermissionCardStatus: finalPerm.card_status ?? null,
    approveTextMessages: approveTexts().map((w) => w.text),
    approveTextCount: approveTexts().length,
    ownerOnlyFeedback: cardFeedback.map((w) => w.text),
    robotMessages: robotMessages.map((r) => ({ t: r.t, path: r.path, text: r.text })),
    allWebhookTexts: webhookTexts.map((w) => ({ t: w.t, text: w.text })),
    toolActuallyRan: permitExists(),
    modelCalls,
    apiPaths: requests.map((r) => `${r.method} ${r.path}`),
  };
  fs.writeFileSync(`${OUT}/${VARIANT}-${SCENARIO}.json`, JSON.stringify(result, null, 2));
  log(`wrote ${OUT}/${VARIANT}-${SCENARIO}.json  cards=${result.permissionCardsCreated} status=${result.finalPermissionCardStatus} toolRan=${result.toolActuallyRan} approveTexts=${result.approveTextCount}`);

  child.kill('SIGINT');
  await sleep(1500);
  try { child.kill('SIGKILL'); } catch {}
  process.exit(0);
}

main().catch((e) => { log(`FATAL ${e?.stack || e}`); process.exit(1); });
