/**
 * Full-stack local rig for PR QwenLM/qwen-code#10457
 * ("feat(dingtalk): present tool permission requests with native interactive cards").
 *
 * Runs the real bundled `qwen channel start dt` DingTalk channel inside a Linux
 * container whose /etc/hosts points api.dingtalk.com / oapi.dingtalk.com at
 * 127.0.0.1. Every endpoint the channel talks to is served locally:
 *   HTTPS 443 : oapi gettoken, gateway/connections/open, Card OpenAPI
 *   WS   8899 : DingTalk Stream gateway (inbound messages AND card callbacks)
 *   HTTP 8080 : sessionWebhook (plain-text replies / permission text fallback)
 *   HTTP 8081 : OpenAI-compatible model endpoint (emits tool calls)
 *
 * The container runs with --network none so nothing can reach real DingTalk.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';

const SCENARIO = process.env.SCENARIO || 'zh-allow-once';
const VARIANT = process.env.VARIANT || 'unknown';
const OUT = process.env.OUT_DIR || '/out';
const CLI = process.env.CLI_PATH || '/app/dist/cli.js';
const CONV_TYPE = process.env.CONV_TYPE || '1'; // 1 = DM, 2 = group
const TOOL = process.env.TOOL || 'shell'; // shell | write
const CERT = process.env.NODE_EXTRA_CA_CERTS || '/rig/certs/cert.pem';
const KEY = CERT.replace(/cert\.pem$/, 'key.pem');

const OWNER_ID = 'staff-owner';
const OTHER_ID = 'staff-other';
const CONV_ID = CONV_TYPE === '2' ? 'cidGROUPPROBE==' : 'cidDMPROBE==';
const KNOWN_USER_IDS = new Set([OWNER_ID, OTHER_ID]);

const T0 = Date.now();
const now = () => Date.now() - T0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) =>
  process.stdout.write(`[rig ${String(now()).padStart(6)}ms] ${m}\n`);

// ------------------------------------------------------------------ recording
const requests = [];      // every HTTPS API request
const cardEvents = [];    // create / instance-update per outTrackId
const cards = new Map();  // outTrackId -> merged cardParamMap
const fallbacks = [];     // sessionWebhook text messages
const modelCalls = [];    // fake-model requests
const robotMessages = []; // proactive robot sends (card interaction feedback)
const toolRuns = [];      // tool executions observed via the sentinel file
let cardFault = null;     // { mode, status } applied to /v1.0/card/*

const permissionCards = () =>
  cardEvents.filter(
    (e) => e.type === 'create' && e.params?.['question_title'] !== undefined,
  );

let firstPermissionResolve;
const firstPermissionCard = new Promise((r) => {
  firstPermissionResolve = r;
});
const waiters = [];
function signal() {
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i].test()) {
      waiters[i].resolve();
      waiters.splice(i, 1);
    }
  }
}
function waitFor(test, timeoutMs, label) {
  if (test()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const entry = { test, resolve: () => resolve(true) };
    waiters.push(entry);
    setTimeout(() => {
      const i = waiters.indexOf(entry);
      if (i >= 0) waiters.splice(i, 1);
      log(`waitFor(${label}) TIMED OUT after ${timeoutMs}ms`);
      resolve(false);
    }, timeoutMs);
  });
}

const tls = { key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) };
const apiServer = https.createServer(tls, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      handleApi(req, res, Buffer.concat(chunks));
    } catch (e) {
      log(`api handler error ${e}`);
      try {
        res.destroy();
      } catch {}
    }
  });
});

function handleApi(req, res, body) {
  const p = new URL(req.url, 'https://x').pathname;
  const method = req.method || 'GET';
  const t = now();

  if (p === '/gettoken') {
    requests.push({ t, method, path: p, status: 200 });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        errcode: 0,
        access_token: 'fake-access-token',
        expires_in: 7200,
      }),
    );
    return;
  }
  if (p === '/v1.0/gateway/connections/open') {
    requests.push({ t, method, path: p, status: 200 });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        endpoint: 'ws://127.0.0.1:8899/connect',
        ticket: 'ticket-1',
      }),
    );
    return;
  }

  if (cardFault && p.startsWith('/v1.0/card')) {
    if (cardFault.mode === 'blackhole') {
      requests.push({ t, method, path: p, status: 'destroyed' });
      log(`FAULT destroy ${method} ${p}`);
      req.socket.destroy();
      return;
    }
    const status = cardFault.status ?? 503;
    requests.push({ t, method, path: p, status });
    log(`FAULT ${status} ${method} ${p}`);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'Injected', message: 'injected fault' }));
    return;
  }

  let payload = {};
  try {
    payload = JSON.parse(body.toString('utf8') || '{}');
  } catch {}
  const outTrackId = String(payload.outTrackId ?? '');

  if (p.startsWith('/v1.0/robot/') && p.includes('essages')) {
    let param = {};
    try {
      param = JSON.parse(String(payload.msgParam ?? '{}'));
    } catch {}
    robotMessages.push({ t, path: p, msgKey: payload.msgKey, param });
    log(`robot send ${p} ${JSON.stringify(param).slice(0, 200)}`);
    signal();
  }

  if (p === '/v1.0/card/instances/createAndDeliver' && method === 'POST') {
    // Real DingTalk addresses a 1:1 card space by the recipient's user id
    // (dtv1.card//IM_ROBOT.<userId>); a conversationId there is not a valid
    // space and the create fails. STRICT_SPACE models exactly that.
    const space = String(payload.openSpaceId ?? '');
    if (
      process.env.STRICT_SPACE === '1' &&
      space.startsWith('dtv1.card//IM_ROBOT.') &&
      !KNOWN_USER_IDS.has(space.slice('dtv1.card//IM_ROBOT.'.length))
    ) {
      log(`REJECT createAndDeliver: unknown IM_ROBOT space ${space}`);
      requests.push({ t, method, path: p, status: 400, note: 'bad space' });
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ code: 'InvalidOpenSpaceId', message: space }),
      );
      return;
    }
    const params = (payload.cardData && payload.cardData.cardParamMap) || {};
    cards.set(outTrackId, { ...params });
    const ev = {
      t,
      type: 'create',
      outTrackId,
      templateId: payload.cardTemplateId ?? payload.templateId,
      openSpaceId: payload.openSpaceId,
      params: { ...params },
      raw: payload,
    };
    cardEvents.push(ev);
    log(
      `card CREATE ${outTrackId} title=${JSON.stringify(params['question_title'] ?? params['statusLine'] ?? '')}`,
    );
    if (params['question_title'] !== undefined && firstPermissionResolve) {
      firstPermissionResolve(ev);
      firstPermissionResolve = null;
    }
    signal();
  } else if (p === '/v1.0/card/streaming' && method === 'PUT') {
    const key = String(payload.key ?? '');
    const inst = cards.get(outTrackId);
    if (inst && !payload.isFinalize) inst[key] = String(payload.content ?? '');
    cardEvents.push({
      t,
      type: 'stream',
      outTrackId,
      key,
      len: String(payload.content ?? '').length,
      finalize: Boolean(payload.isFinalize),
    });
    signal();
  } else if (p === '/v1.0/card/instances' && method === 'PUT') {
    const params = (payload.cardData && payload.cardData.cardParamMap) || {};
    const inst = cards.get(outTrackId) || {};
    Object.assign(inst, params);
    cards.set(outTrackId, inst);
    cardEvents.push({ t, type: 'instance', outTrackId, params: { ...params } });
    log(`card UPDATE ${outTrackId} ${JSON.stringify(params)}`);
    signal();
  }

  requests.push({ t, method, path: p, status: 200 });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ requestId: 'req', result: {}, success: true }));
}

// -------------------------------------------------------------- sessionWebhook
const sideServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    let parsed = {};
    try {
      parsed = JSON.parse(body || '{}');
    } catch {}
    const text =
      parsed?.markdown?.text ?? parsed?.text?.content ?? body;
    fallbacks.push({
      t: now(),
      msgtype: parsed.msgtype ?? 'unknown',
      title: parsed?.markdown?.title,
      text: String(text),
    });
    log(`webhook message (${String(text).length} chars): ${String(text).slice(0, 120).replace(/\n/g, ' | ')}`);
    signal();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
  });
});

// ------------------------------------------------------------------ fake model
// Emits a tool call the first time, a second identical tool call when the
// scenario needs to observe a persistent grant, then a short final answer.
const SENTINEL = '/work/tool-ran.txt';
const shellArgs = (n) => ({
  command: `sh -c 'echo permission-probe-${n} >> ${SENTINEL}'`,
  description: `append permission-probe-${n} to the probe sentinel`,
});
const writeArgs = (n) => ({
  file_path: `/work/probe-${n}.txt`,
  content: `permission probe ${n}\n`,
});
const askArgs = () => ({
  questions: [
    {
      question: 'Which probe branch should the run take?',
      header: 'Branch',
      options: [
        { label: 'Left branch', description: 'take the left probe branch' },
        { label: 'Right branch', description: 'take the right probe branch' },
      ],
    },
  ],
});
const TOOL_TABLE = {
  shell: ['run_shell_command', shellArgs],
  write: ['write_file', writeArgs],
  ask: ['ask_user_question', askArgs],
};
const [toolName, toolArgs] = TOOL_TABLE[TOOL] ?? TOOL_TABLE.shell;
const WANT_SECOND_CALL =
  SCENARIO === 'allow-always-shell' ||
  SCENARIO === 'allow-always-write' ||
  SCENARIO === 'text-allow-always';

const openaiServer = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    let payload = {};
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {}
    const msgs = Array.isArray(payload.messages) ? payload.messages : [];
    const toolResults = msgs.filter((m) => m.role === 'tool').length;
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const lastText =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : JSON.stringify(lastUser?.content ?? '');
    const isProbe = lastText.includes('PERM-PROBE');
    modelCalls.push({ t: now(), toolResults, isProbe, msgCount: msgs.length });
    log(`model request probe=${isProbe} toolResults=${toolResults}`);

    const wantsToolCall =
      isProbe && (toolResults === 0 || (WANT_SECOND_CALL && toolResults === 1));
    const callIndex = toolResults + 1;

    if (payload.stream === false) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'x',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'fake-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const frame = (delta, finish) => ({
      id: 'x',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'fake-model',
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    });

    if (wantsToolCall) {
      send(frame({ role: 'assistant', content: '' }));
      send(
        frame({
          tool_calls: [
            {
              index: 0,
              id: `call-${callIndex}`,
              type: 'function',
              function: {
                name: toolName,
                arguments: JSON.stringify(toolArgs(callIndex)),
              },
            },
          ],
        }),
      );
      send(frame({}, 'tool_calls'));
      res.write('data: [DONE]\n\n');
      res.end();
      log(`model emitted tool_call #${callIndex} ${toolName}`);
      return;
    }

    send(frame({ role: 'assistant', content: '' }));
    for (const piece of ['Probe run ', 'finished. ', 'No further tools.']) {
      await sleep(60);
      send(frame({ content: piece }));
    }
    send(frame({}, 'stop'));
    res.write('data: [DONE]\n\n');
    res.end();
    log('model stream finished (final answer)');
  });
});

// ------------------------------------------------------------------ WS gateway
const wss = new WebSocketServer({ port: 8899 });
let sock = null;
let sockResolve;
const sockReady = new Promise((r) => {
  sockResolve = r;
});
const acks = [];
wss.on('connection', (ws) => {
  log('stream WS connected');
  sock = ws;
  ws.send(
    JSON.stringify({
      type: 'SYSTEM',
      headers: {
        topic: 'CONNECTED',
        messageId: 'sys-1',
        contentType: 'application/json',
      },
      data: '{}',
    }),
  );
  ws.send(
    JSON.stringify({
      type: 'SYSTEM',
      headers: {
        topic: 'REGISTERED',
        messageId: 'sys-2',
        contentType: 'application/json',
      },
      data: '{}',
    }),
  );
  ws.on('message', (raw) => {
    try {
      const parsed = JSON.parse(String(raw));
      acks.push({ t: now(), messageId: parsed?.headers?.messageId });
    } catch {}
  });
  ws.on('close', () => log('stream WS closed'));
  if (sockResolve) {
    sockResolve(ws);
    sockResolve = null;
  }
});

let msgSeq = 0;
function pushUserMessage(text, senderId = OWNER_ID, nick = 'Owner') {
  const msgId = `msg-${++msgSeq}`;
  const data = {
    msgId,
    msgtype: 'text',
    conversationType: CONV_TYPE,
    conversationId: CONV_ID,
    conversationTitle: CONV_TYPE === '2' ? 'Probe Group' : undefined,
    sessionWebhook: 'http://127.0.0.1:8080/robot/send?access_token=probe',
    senderId,
    senderStaffId: senderId,
    senderNick: nick,
    chatbotUserId: 'bot-1',
    isInAtList: CONV_TYPE === '2',
    atUsers: CONV_TYPE === '2' ? [{ dingtalkId: 'bot-1' }] : undefined,
    text: { content: text },
  };
  sock.send(
    JSON.stringify({
      type: 'CALLBACK',
      headers: {
        topic: '/v1.0/im/bot/messages/get',
        messageId: msgId,
        contentType: 'application/json',
      },
      data: JSON.stringify(data),
    }),
  );
  log(`pushed user message ${msgId} from ${senderId}: ${text}`);
}

let cbSeq = 0;
/**
 * Push a DingTalk card action callback exactly as the Stream gateway delivers
 * it: topic /v1.0/card/instances/callback, `data` a JSON string whose `content`
 * carries the published form template's cardPrivateData envelope.
 */
function pushCardCallback({ outTrackId, actionId, form, userCancel, actorId = OWNER_ID, omitForm = false }) {
  const messageId = `card-cb-${++cbSeq}`;
  const params = {};
  if (!omitForm && form !== undefined) params.form = form;
  if (userCancel !== undefined) params.user_cancel = String(userCancel);
  const content = JSON.stringify({
    cardPrivateData: {
      actionIds: [actionId],
      ...(Object.keys(params).length ? { params } : { params: { fromConfig: true } }),
    },
  });
  const data = {
    outTrackId,
    userId: actorId,
    corpId: 'corp-1',
    spaceType: 'IM_ROBOT',
    content,
  };
  sock.send(
    JSON.stringify({
      type: 'CALLBACK',
      headers: {
        topic: '/v1.0/card/instances/callback',
        messageId,
        contentType: 'application/json',
      },
      data: JSON.stringify(data),
    }),
  );
  log(
    `pushed card callback ${messageId} outTrackId=${outTrackId} actionId=${actionId} actor=${actorId} form=${JSON.stringify(form)} cancel=${userCancel}`,
  );
}

// ------------------------------------------------------------------- scenarios
const permCardCount = () => permissionCards().length;
const cardStatus = (outTrackId) => cards.get(outTrackId)?.['card_status'];

async function awaitPermissionCard(timeoutMs = 40000) {
  const ok = await Promise.race([
    firstPermissionCard.then(() => true),
    sleep(timeoutMs).then(() => false),
  ]);
  if (!ok) throw new Error('no permission card was delivered');
  return permissionCards()[0];
}

async function scenarioBody() {
  switch (SCENARIO) {
    // 1. Owner taps "allow once" (zh locale).
    case 'zh-allow-once':
    case 'en-allow-once': {
      const card = await awaitPermissionCard();
      await sleep(400);
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['allow_once'] },
      });
      await waitFor(
        () => cardStatus(card.outTrackId) === 'approved',
        15000,
        'approved',
      );
      break;
    }

    // 2. Owner taps "deny".
    case 'zh-deny':
    case 'en-deny': {
      const card = await awaitPermissionCard();
      await sleep(400);
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['deny'] },
      });
      await waitFor(
        () => cardStatus(card.outTrackId) === 'denied',
        15000,
        'denied',
      );
      break;
    }

    // 3. Owner taps the persistent grant; a second identical tool call must not
    //    raise a second permission card.
    case 'allow-always-shell':
    case 'allow-always-write': {
      const card = await awaitPermissionCard();
      await sleep(400);
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['allow_always'] },
      });
      await waitFor(
        () => cardStatus(card.outTrackId) === 'approved',
        15000,
        'approved',
      );
      // Give the second tool call time to either run silently or raise a card.
      await waitFor(() => modelCalls.length >= 3, 25000, 'second tool result');
      await sleep(3000);
      break;
    }

    // 4. Owner taps the card's cancel action.
    case 'cancel': {
      const card = await awaitPermissionCard();
      await sleep(400);
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        userCancel: true,
      });
      await waitFor(
        () => cardStatus(card.outTrackId) === 'cancelled',
        15000,
        'cancelled',
      );
      break;
    }

    // 5. Nobody answers; the controller timeout must deny and expire.
    case 'timeout': {
      const card = await awaitPermissionCard();
      await waitFor(
        () => cardStatus(card.outTrackId) === 'expired',
        30000,
        'expired',
      );
      break;
    }

    // 6. A different group member taps the card, then submits malformed and
    //    duplicate payloads; finally the owner answers.
    case 'foreign-actor': {
      const card = await awaitPermissionCard();
      await sleep(400);
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['allow_once'] },
        actorId: OTHER_ID,
      });
      await sleep(2500);
      // second attempt by the same foreign actor: must be silently ignored
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['allow_once'] },
        actorId: OTHER_ID,
      });
      await sleep(2500);
      // malformed submissions from the owner
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['allow_once'], extra: 'x' },
      });
      await sleep(1200);
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['allow_once', 'deny'] },
      });
      await sleep(1200);
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['proceed_once'] },
      });
      await sleep(1200);
      pushCardCallback({
        outTrackId: 'qwen-permission-does-not-exist',
        actionId: card.params['question_id'],
        form: { permission_decision: ['allow_once'] },
      });
      await sleep(1200);
      // finally, the owner answers for real
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['allow_once'] },
      });
      await waitFor(
        () => cardStatus(card.outTrackId) === 'approved',
        15000,
        'approved',
      );
      // stale replay of the now-terminal card
      await sleep(1500);
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['deny'] },
      });
      await sleep(2500);
      break;
    }

    // 7. A non-owner tries to settle the pending card with the text command.
    case 'foreign-text-approve': {
      const card = await awaitPermissionCard();
      await sleep(400);
      pushUserMessage('/approve', OTHER_ID, 'Bystander');
      await sleep(6000);
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['deny'] },
      });
      await waitFor(
        () => cardStatus(card.outTrackId) === 'denied',
        15000,
        'denied',
      );
      break;
    }

    // 8. The owner answers by text while the card is still pending.
    case 'owner-text-approve': {
      const card = await awaitPermissionCard();
      await sleep(400);
      pushUserMessage('/approve', OWNER_ID, 'Owner');
      await waitFor(
        () => ['expired', 'approved'].includes(cardStatus(card.outTrackId)),
        20000,
        'terminal after text approve',
      );
      await sleep(3000);
      break;
    }

    // 9. Permission cards disabled -> the existing text commands must appear.
    case 'card-disabled': {
      const ok = await waitFor(
        () => fallbacks.some((f) => /\/approve|\/deny/.test(f.text)),
        40000,
        'text fallback',
      );
      if (!ok) log('no text fallback observed');
      await sleep(2000);
      break;
    }

    // 10. Card delivery fails -> text fallback must still be delivered.
    case 'delivery-failure': {
      // Let the status card be created first, then break the Card API so the
      // permission card's createAndDeliver is the call that fails.
      await waitFor(() => cardEvents.length > 0, 30000, 'status card');
      cardFault = { mode: 'status', status: 503 };
      log('card API fault armed (503)');
      const ok = await waitFor(
        () => fallbacks.some((f) => /\/approve|\/deny/.test(f.text)),
        40000,
        'text fallback after delivery failure',
      );
      if (!ok) log('no text fallback observed');
      cardFault = null;
      await sleep(2000);
      break;
    }

    // 11. Run cancellation while a permission card is pending.
    case 'run-cancel': {
      const card = await awaitPermissionCard();
      await sleep(500);
      pushUserMessage('/stop', OWNER_ID, 'Owner');
      await waitFor(
        () => ['cancelled', 'expired'].includes(cardStatus(card.outTrackId)),
        20000,
        'cancelled after /stop',
      );
      await sleep(2000);
      break;
    }

    // 12. No permission card at all (base tree, or cards disabled): a
    //     non-owner sends the /approve text command in a shared session.
    case 'text-foreign-approve': {
      const ok = await waitFor(
        () => fallbacks.some((f) => /\/approve/.test(f.text)),
        45000,
        'text fallback',
      );
      if (!ok) break;
      await sleep(500);
      pushUserMessage('/approve', OTHER_ID, 'Bystander');
      await sleep(8000);
      break;
    }

    // 12b. Cards disabled: the owner uses /approve-always and the second
    //      identical tool call is observed (does the persistent grant hold?).
    case 'text-allow-always': {
      const ok = await waitFor(
        () => fallbacks.some((f) => /\/approve-always/.test(f.text)),
        45000,
        'text fallback with /approve-always',
      );
      if (!ok) break;
      await sleep(500);
      pushUserMessage('/approve-always', OWNER_ID, 'Owner');
      await sleep(20000);
      break;
    }

    // 13. ask_user_question must still render as a QUESTION card, never as a
    //     permission card, and its Submit callback must still be routed to the
    //     question controller.
    case 'question-card': {
      const ok = await waitFor(
        () =>
          cardEvents.some(
            (e) => e.type === 'create' && e.params?.['question_title'] !== undefined,
          ),
        45000,
        'question card',
      );
      if (!ok) break;
      const card = cardEvents.filter(
        (e) => e.type === 'create' && e.params?.['question_title'] !== undefined,
      )[0];
      await sleep(600);
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { '0': 'Left branch' },
      });
      await sleep(8000);
      break;
    }

    // 14. The Card API refuses the terminal update after a valid decision.
    case 'terminal-update-failure': {
      const card = await awaitPermissionCard();
      await sleep(400);
      cardFault = { mode: 'status', status: 503 };
      log('card API fault armed (503) before the decision');
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['allow_once'] },
      });
      await sleep(9000);
      cardFault = null;
      await sleep(4000);
      break;
    }

    // 15. Two independent attended runs each hold a pending permission card;
    //     cancelling one run must not terminalise the other run's card.
    case 'two-runs-cancel': {
      const first = await awaitPermissionCard();
      pushUserMessage('PERM-PROBE second sender', OTHER_ID, 'Second');
      const ok = await waitFor(() => permissionCards().length >= 2, 45000, 'second card');
      if (!ok) break;
      const second = permissionCards().find((c) => c.outTrackId !== first.outTrackId);
      await sleep(1000);
      pushUserMessage('/stop', OWNER_ID, 'Owner');
      await sleep(9000);
      log(`first=${cardStatus(first.outTrackId)} second=${cardStatus(second.outTrackId)}`);
      break;
    }

    // 16. The owner's text command and their card tap race for the same
    //     pending permission. RACE_OFFSET_MS delays the card tap so the text
    //     response is already in flight when claim() runs.
    case 'race-text-and-card': {
      const card = await awaitPermissionCard();
      await sleep(400);
      pushUserMessage('/approve', OWNER_ID, 'Owner');
      await sleep(Number(process.env.RACE_OFFSET_MS || 0));
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['deny'] },
      });
      await sleep(12000);
      break;
    }

    // 17. The Card API is already refusing updates when the permission
    //     timeout fires, so the terminal projection runs on the unguarded
    //     `void this.expire(...)` timer path.
    case 'timeout-update-failure': {
      const card = await awaitPermissionCard();
      await sleep(300);
      cardFault = { mode: 'status', status: 503 };
      log('card API fault armed (503) before the timeout fires');
      await sleep(14000);
      cardFault = null;
      await sleep(4000);
      break;
    }

    // 18. The owner's tap lands exactly as the permission timeout fires.
    case 'expire-race': {
      const card = await awaitPermissionCard();
      const fireAt = card.t + Number(process.env.PERM_TIMEOUT_MS || 8000);
      const wait = fireAt - now() + Number(process.env.RACE_OFFSET_MS || 0);
      log(`expire-race: sleeping ${wait}ms before the tap`);
      if (wait > 0) await sleep(wait);
      pushCardCallback({
        outTrackId: card.outTrackId,
        actionId: card.params['question_id'],
        form: { permission_decision: ['allow_once'] },
      });
      await sleep(10000);
      break;
    }

    default:
      throw new Error(`unknown scenario ${SCENARIO}`);
  }
}

// ------------------------------------------------------------------------ main
async function main() {
  await new Promise((r) => apiServer.listen(443, '127.0.0.1', r));
  await new Promise((r) => sideServer.listen(8080, '127.0.0.1', r));
  await new Promise((r) => openaiServer.listen(8081, '127.0.0.1', r));
  log(`servers up (scenario=${SCENARIO} variant=${VARIANT} convType=${CONV_TYPE} tool=${TOOL})`);

  const env = {
    ...process.env,
    HOME: '/root',
    QWEN_HOME: '/root/.qwen',
    QWEN_SANDBOX: 'false',
    QWEN_CODE_NO_RELAUNCH: 'true',
    OPENAI_API_KEY: 'fake-key',
    OPENAI_BASE_URL: 'http://127.0.0.1:8081/v1',
    OPENAI_MODEL: 'fake-model',
    QWEN_MODEL: 'fake-model',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  };
  const cliLog = fs.createWriteStream(`${OUT}/${VARIANT}-${SCENARIO}.cli.log`);
  const child = spawn(process.execPath, [CLI, 'channel', 'start', 'dt'], {
    cwd: '/work',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(cliLog);
  child.stderr.pipe(cliLog);
  child.on('exit', (code, sig) => log(`cli exited code=${code} sig=${sig}`));

  const connected = await Promise.race([
    sockReady,
    sleep(60000).then(() => null),
  ]);
  if (!connected) {
    log('FATAL: stream WS never connected');
    child.kill('SIGKILL');
    process.exit(3);
  }
  await sleep(800);
  pushUserMessage('PERM-PROBE please run the probe tool');

  let scenarioError;
  try {
    await Promise.race([
      scenarioBody(),
      sleep(120000).then(() => {
        throw new Error('scenario budget exhausted');
      }),
    ]);
  } catch (e) {
    scenarioError = String(e?.stack || e);
    log(`scenario error: ${scenarioError}`);
  }
  await sleep(1500);

  let sentinel = '';
  try {
    sentinel = fs.readFileSync(SENTINEL, 'utf8');
  } catch {}
  const writtenProbes = [];
  for (const n of [1, 2]) {
    try {
      writtenProbes.push({
        file: `/work/probe-${n}.txt`,
        content: fs.readFileSync(`/work/probe-${n}.txt`, 'utf8'),
      });
    } catch {}
  }

  const result = {
    scenario: SCENARIO,
    variant: VARIANT,
    convType: CONV_TYPE,
    tool: TOOL,
    language: process.env.LANGUAGE ?? null,
    permissionCardEnabled: process.env.PERM_CARD ?? 'true',
    permissionTimeoutMs: process.env.PERM_TIMEOUT_MS ?? '60000',
    sessionScope: process.env.SESSION_SCOPE ?? 'user',
    wallMs: now(),
    scenarioError: scenarioError ?? null,
    permissionCardCount: permCardCount(),
    permissionCards: permissionCards().map((c) => ({
      outTrackId: c.outTrackId,
      t: c.t,
      params: c.params,
      finalStatus: cards.get(c.outTrackId)?.['card_status'],
      finalParams: cards.get(c.outTrackId),
    })),
    cardEvents,
    cards: [...cards.entries()].map(([k, v]) => ({ outTrackId: k, params: v })),
    fallbacks,
    robotMessages,
    modelCalls,
    toolRuns,
    sentinel,
    writtenProbes,
    requestPaths: requests.map((r) => `${r.method} ${r.path} ${r.status}`),
  };
  fs.writeFileSync(
    `${OUT}/${VARIANT}-${SCENARIO}.json`,
    JSON.stringify(result, null, 2),
  );
  log(`wrote ${OUT}/${VARIANT}-${SCENARIO}.json`);

  child.kill('SIGINT');
  await sleep(1500);
  try {
    child.kill('SIGKILL');
  } catch {}
  process.exit(0);
}

main().catch((e) => {
  log(`FATAL ${e?.stack || e}`);
  process.exit(1);
});
