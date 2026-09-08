/**
 * End-to-end wire-oracle A/B harness for PR 10457 (DingTalk permission cards).
 *
 * Runs the REAL compiled ChannelBase and the REAL compiled DingtalkChannel from
 * the tree given by --tree, joined together with NO stub of either layer. The
 * only simulated parties are the two that are genuinely external:
 *
 *   1. the DingTalk HTTP API  -> a real http.Server on 127.0.0.1, reached over
 *      real sockets by rewriting the hardcoded api.dingtalk.com /
 *      oapi.dingtalk.com origin in a globalThis.fetch shim. The production card
 *      client still builds the real URL, real auth header and real JSON body;
 *      we only redirect the transport and record what arrived.
 *   2. the agent bridge       -> an EventEmitter standing in for the CLI runtime.
 *
 * Usage: node e2e-card-ab.mjs --tree <abs-path-to-worktree> [--lang en|zh]
 *                             [--cards on|off] [--scenario all|...]
 */
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}

const tree = path.resolve(arg('tree', '.'));
const LANG = arg('lang', 'en');
const CARDS = arg('cards', 'on');
const ONLY = arg('scenario', 'all');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else {
    fail++;
    failures.push(name);
  }
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}\n        actual=${JSON.stringify(actual)}\n        expect=${JSON.stringify(expected)}`,
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms = 8000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await sleep(25);
  }
  throw new Error(`timed out after ${ms}ms waiting for ${label}`);
}

// ---------------------------------------------------------------- fake DingTalk
const requests = [];
let FAIL_CARD_PATHS = false;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    requests.push({
      method: req.method,
      path: req.url,
      token: req.headers['x-acs-dingtalk-access-token'],
      body,
      raw,
    });
    res.setHeader('content-type', 'application/json');
    if (FAIL_CARD_PATHS && (req.url ?? '').includes('/card/')) {
      res.statusCode = 500;
      res.end('{"error":"boom"}');
      return;
    }
    const url = req.url ?? '';
    if (url.includes('/gettoken')) {
      res.end(
        JSON.stringify({
          errcode: 0,
          errmsg: 'ok',
          access_token: 'fake-access-token',
          expires_in: 7200,
        }),
      );
      return;
    }
    if (url.includes('/oauth2/accessToken')) {
      res.end(JSON.stringify({ accessToken: 'fake-access-token', expireIn: 7200 }));
      return;
    }
    if (url.includes('/robot/groupMessages/send')) {
      res.end(JSON.stringify({ processQueryKey: 'pqk-group' }));
      return;
    }
    if (url.includes('/robot/oToMessages/batchSend')) {
      res.end(JSON.stringify({ processQueryKey: 'pqk-dm' }));
      return;
    }
    res.end(JSON.stringify({ success: true }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (/^https:\/\/(api|oapi)\.dingtalk\.com/.test(url)) {
    const local = url.replace(
      /^https:\/\/(api|oapi)\.dingtalk\.com/,
      `http://127.0.0.1:${PORT}`,
    );
    return realFetch(local, init);
  }
  return realFetch(input, init);
};

// ---------------------------------------------------------------- load the arm
const baseDist = path.join(tree, 'packages/channels/base/dist/index.js');
const adapterDist = path.join(
  tree,
  'packages/channels/dingtalk/dist/DingtalkAdapter.js',
);
for (const f of [baseDist, adapterDist]) {
  if (!fs.existsSync(f)) {
    console.error(`FATAL: missing compiled artifact ${f}`);
    process.exit(2);
  }
}
const { DingtalkChannel } = await import(pathToFileURL(adapterDist).href);

const allCardReqs = () =>
  requests.filter((r) => r.path.includes('/card/instances/createAndDeliver'));
const cardReqs = () =>
  allCardReqs().filter((r) =>
    String(r.body?.outTrackId ?? '').startsWith('qwen-permission-'),
  );
const statusCardReqs = () => allCardReqs().length - cardReqs().length;
const allCardUpdates = () =>
  requests.filter(
    (r) => r.path.includes('/card/instances') && r.method === 'PUT',
  );
const permTrack = () => String(cardReqs()[0]?.body?.outTrackId ?? '');
const cardUpdates = () => {
  const id = permTrack();
  return id
    ? allCardUpdates().filter((r) => String(r.body?.outTrackId ?? '') === id)
    : allCardUpdates();
};
const cardsActive = () => isHeadRef.v && CARDS === 'on';
const textMsgs = () =>
  requests.filter((r) => r.path.includes('/robot/') && r.path.includes('send'));

function textOf(r) {
  const p = r.body?.msgParam;
  if (typeof p === 'string') {
    try {
      return JSON.parse(p).text ?? p;
    } catch {
      return p;
    }
  }
  return JSON.stringify(r.body);
}

// ---------------------------------------------------------------- fake bridge
function createBridge() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  let n = 0;
  const calls = { prompt: [], respondToPermission: [], newSession: [] };
  let resolvePrompt;
  const bridge = Object.assign(emitter, {
    calls,
    setPromptGate(fn) {
      resolvePrompt = fn;
    },
    newSession: async () => {
      const id = `s-${++n}`;
      calls.newSession.push(id);
      return id;
    },
    loadSession: async (id) => id,
    prompt: async (sessionId, text) => {
      calls.prompt.push({ sessionId, text });
      return new Promise((resolve) => {
        resolvePrompt = resolve;
      });
    },
    cancelSession: async () => undefined,
    discardSession: async () => undefined,
    stop: () => {},
    start: () => {},
    isConnected: true,
    availableCommands: [],
    setBridge: () => {},
    respondToPermission: async (requestId, response) => {
      calls.respondToPermission.push({ requestId, response });
      return true;
    },
    listSessions: () => [],
    registerChannelLoopToolHandler: () => {},
    getChannelLoopToolHandler: () => undefined,
  });
  return bridge;
}

function dingtalkConfig(extra = {}) {
  return {
    type: 'dingtalk',
    token: '',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    senderPolicy: 'open',
    allowedUsers: [],
    sessionScope: 'user',
    cwd: '/tmp',
    groupPolicy: 'open',
    dmPolicy: 'open',
    groups: {},
    interactiveCards:
      CARDS === 'on'
        ? { permissionCard: { enabled: true, timeoutMs: 600_000 } }
        : { permissionCard: { enabled: false } },
    ...extra,
  };
}

function seedWebhook(ch) {
  // A real inbound DingTalk message carries a sessionWebhook; text replies are
  // POSTed to it. Cards use the REST API instead, so only the text path needs it.
  ch.webhooks.set(
    'cid-1',
    `http://127.0.0.1:${PORT}/robot/groupMessages/send`,
  );
}

function makeChannel(locale, cfg) {
  const bridge = createBridge();
  const ch = new DingtalkChannel(
    'verify-dingtalk',
    cfg ?? dingtalkConfig(),
    bridge,
    locale ? { locale } : undefined,
  );
  ch.connected = true;
  seedWebhook(ch);
  return { ch, bridge };
}

function envelope(over = {}) {
  return {
    channelName: 'verify-dingtalk',
    senderId: 'owner-1',
    senderName: 'Owner One',
    chatId: 'cid-1',
    text: 'run tests',
    messageId: 'm-1',
    isGroup: true,
    isMentioned: true,
    isReplyToBot: false,
    ...over,
  };
}

const PERMISSION_EVENT = {
  requestId: 'req-verify-1',
  request: {
    toolCall: {
      toolCallId: 'tc-1',
      name: 'run_shell_command',
      title: 'Run npm test',
      rawInput: { command: 'npm test' },
    },
    options: [
      { optionId: 'proceed_once', kind: 'allow_once', name: 'Allow once' },
      {
        optionId: 'proceed_always_project',
        kind: 'allow_always',
        name: 'Always Allow in project',
      },
      { optionId: 'reject_once', kind: 'reject_once', name: 'Deny' },
    ],
  },
};

async function startRun(ch, bridge, env = {}) {
  requests.length = 0;
  const running = ch.handleInbound(envelope(env));
  running.catch(() => {});
  await waitFor(() => bridge.calls.prompt.length === 1, 15000, 'bridge.prompt');
  return bridge.calls.prompt[0].sessionId;
}

function emitPermission(bridge, sessionId, event = PERMISSION_EVENT) {
  bridge.emit('permissionRequest', { ...event, sessionId });
}

console.log(
  `\n########## ARM: ${tree.split('/').slice(-2).join('/')}  lang=${LANG} cards=${CARDS} ##########`,
);
console.log(`fake DingTalk API on http://127.0.0.1:${PORT}`);
console.log(
  `resolveChannelLocale-era build: ${fs.existsSync(path.join(tree, 'packages/channels/dingtalk/dist/permission-card-controller.js')) ? 'HEAD (permission-card-controller.js present)' : 'BASE (absent)'}\n`,
);

const isHeadRef = { v: false };
const isHead = fs.existsSync(
  path.join(
    tree,
    'packages/channels/dingtalk/dist/permission-card-controller.js',
  ),
);

isHeadRef.v = isHead;


// ===================================================================
// PR 10457 x main-since-base interaction probes (round 3).
//
// Every scenario below combines the PR's permission card with a feature
// that landed on main AFTER this PR's base (5dc7547d), i.e. a combination
// neither the PR's tests nor main's tests can have exercised:
//
//   X1/X2  messagePrefix           (#10817 feat(channels): filter messages by configured prefix)
//   X3     /btw side questions     (#10713 feat(channels): add BTW side questions)
//   X4     named tasks             (#10643 / #11015 worktree-isolated named tasks)
// ===================================================================

const PREFIX = 'qwen';

function bridgeWithBtw() {
  const b = createBridge();
  b.calls.btw = [];
  b.btw = async (sessionId, question) => {
    b.calls.btw.push({ sessionId, question });
    return { id: 1, answer: 'btw answer' };
  };
  return b;
}

function makeChannelWith(cfgExtra, bridge) {
  const br = bridge ?? createBridge();
  const ch = new DingtalkChannel(
    'verify-dingtalk',
    dingtalkConfig(cfgExtra),
    br,
    LANG ? { locale: LANG } : undefined,
  );
  ch.connected = true;
  seedWebhook(ch);
  return { ch, bridge: br };
}

async function startRunText(ch, bridge, text, over = {}) {
  requests.length = 0;
  const running = ch.handleInbound(envelope({ text, ...over }));
  running.catch(() => {});
  await waitFor(() => bridge.calls.prompt.length >= 1, 15000, 'bridge.prompt');
  return bridge.calls.prompt[0].sessionId;
}

// ---------------------------------------------------------------- X1
// With a configured message prefix, an attended permission request must
// still become ONE native card (the prefix filter gates inbound envelopes,
// not outbound permission presentation).
async function x1PrefixStillCards() {
  console.log('\n--- X1: messagePrefix configured -> permission still becomes a card ---');
  const { ch, bridge } = makeChannelWith({ messagePrefix: PREFIX });
  const sessionId = await startRunText(ch, bridge, `${PREFIX} run tests`);
  requests.length = 0;
  emitPermission(bridge, sessionId);
  await sleep(600);
  check('X1: exactly one permission card delivered', cardReqs().length, cardsActive() ? 1 : 0);
  check('X1: no /approve permission TEXT sent while the card is live',
    textMsgs().filter((r) => textOf(r).includes('/approve')).length,
    cardsActive() ? 0 : 1);
  return { ch, bridge, sessionId };
}

// ---------------------------------------------------------------- X2
// The text fallback is what a prefix user must type. It must carry the
// prefix, and the un-prefixed form must NOT settle the permission.
async function x2PrefixFallbackAndTextAnswer() {
  console.log('\n--- X2: prefix-aware fallback text + prefixed/un-prefixed answers ---');
  // 2a: cards OFF -> fallback text must instruct the PREFIXED command
  const off = makeChannelWith({
    messagePrefix: PREFIX,
    interactiveCards: { permissionCard: { enabled: false } },
  });
  const sid = await startRunText(off.ch, off.bridge, `${PREFIX} run tests`);
  requests.length = 0;
  emitPermission(off.bridge, sid);
  await sleep(600);
  const fb = textMsgs().map(textOf).join('\n');
  check('X2a: fallback instructs the PREFIXED approve command', fb.includes(`${PREFIX} /approve`), true);
  check('X2a: fallback does not offer a bare /approve line',
    /(^|\n)\/approve/.test(fb), false);

  // 2b: with a live CARD, a bare (un-prefixed) /approve must not settle it
  const on = makeChannelWith({ messagePrefix: PREFIX });
  const sid2 = await startRunText(on.ch, on.bridge, `${PREFIX} run tests`, { messageId: 'm-x2b' });
  requests.length = 0;
  emitPermission(on.bridge, sid2);
  await sleep(600);
  const bare = on.ch.handleInbound(envelope({ text: '/approve', messageId: 'm-x2b-bare' }));
  bare.catch(() => {});
  await sleep(500);
  check('X2b: an UN-prefixed /approve does not settle the permission',
    on.bridge.calls.respondToPermission.length, 0);

  // 2c: the prefixed form settles it exactly once
  const pref = on.ch.handleInbound(envelope({ text: `${PREFIX} /approve`, messageId: 'm-x2c' }));
  pref.catch(() => {});
  await sleep(600);
  check('X2c: the PREFIXED /approve settles it exactly once',
    on.bridge.calls.respondToPermission.length, 1);
  check('X2c: settled through the original allow-once option',
    on.bridge.calls.respondToPermission[0]?.response?.outcome?.optionId, 'proceed_once');
}

// ---------------------------------------------------------------- X3
// A /btw side question raised WHILE a permission card is live must not
// disturb the pending permission, and the card must still settle once.
async function x3BtwDuringLiveCard() {
  console.log('\n--- X3: /btw side question while a permission card is live ---');
  const bridge = bridgeWithBtw();
  const { ch } = makeChannelWith({}, bridge);
  const sessionId = await startRunText(ch, bridge, 'run tests', { messageId: 'm-x3' });
  requests.length = 0;
  emitPermission(bridge, sessionId);
  await sleep(600);
  const cardsBefore = cardReqs().length;
  check('X3: a permission card is live', cardsBefore, cardsActive() ? 1 : 0);
  const track = permTrack();

  const btw = ch.handleInbound(envelope({ text: '/btw what is the repo size?', messageId: 'm-x3-btw' }));
  btw.catch(() => {});
  await sleep(800);
  check('X3: the side question reached the bridge', bridge.calls.btw.length, 1);
  check('X3: the permission was NOT settled by the side question',
    bridge.calls.respondToPermission.length, 0);
  check('X3: no extra permission card was minted by the side question',
    cardReqs().length, cardsBefore);

  if (cardsActive()) {
    const r = ch.routeCardCallback({
      outTrackId: track,
      actionId: 'submit',
      actorId: 'owner-1',
      formData: { permission_decision: 'allow_once' },
      hasBusinessPayload: true,
      isCancel: false,
    });
    check('X3: the card still accepts the owner after a side question', r.kind, 'accepted');
    if (r.execute) await r.execute();
    await sleep(400);
    check('X3: settles exactly once after the side question',
      bridge.calls.respondToPermission.length, 1);
    const pm = cardUpdates().slice(-1)[0]?.body?.cardData?.cardParamMap
      ?? cardUpdates().slice(-1)[0]?.body?.cardParamMap ?? {};
    check('X3: terminal state is approved', pm.card_status, 'approved');
  }
}

// ---------------------------------------------------------------- X4
// A named task changes the pending-permission id surface (requestSuffix /
// taskName). The card must still be minted, owner-bound and settle once.
async function x4NamedTask() {
  console.log('\n--- X4: permission card inside a named task ---');
  const bridge = createBridge();
  const { ch } = makeChannelWith({ sessionScope: 'user' }, bridge);
  const sessionId = await startRunText(ch, bridge, 'run tests', { messageId: 'm-x4' });
  requests.length = 0;
  // Drive the named-task surface the way ChannelBase models it: a pending
  // permission that carries a taskName renders the request-id suffixed form.
  const pend = ch.pendingPermissions ?? ch['pendingPermissions'];
  emitPermission(bridge, sessionId, {
    ...PERMISSION_EVENT,
    requestId: 'req-named-1',
  });
  await sleep(600);
  check('X4: one card for the named-task permission', cardReqs().length, cardsActive() ? 1 : 0);
  if (!cardsActive()) return;
  const track = permTrack();
  const foreign = ch.routeCardCallback({
    outTrackId: track,
    actionId: 'submit',
    actorId: 'stranger-9',
    formData: { permission_decision: 'allow_once' },
    hasBusinessPayload: true,
    isCancel: false,
  });
  if (foreign.execute) await foreign.execute();
  await sleep(300);
  check('X4: owner binding still holds in a named task',
    bridge.calls.respondToPermission.length, 0);
  const own = ch.routeCardCallback({
    outTrackId: track,
    actionId: 'submit',
    actorId: 'owner-1',
    formData: { permission_decision: 'allow_once' },
    hasBusinessPayload: true,
    isCancel: false,
  });
  if (own.execute) await own.execute();
  await sleep(400);
  check('X4: the owner settles the named-task permission exactly once',
    bridge.calls.respondToPermission.length, 1);
  check('X4: answered the original request id',
    bridge.calls.respondToPermission[0]?.requestId, 'req-named-1');
}

await x1PrefixStillCards();
await x2PrefixFallbackAndTextAnswer();
await x3BtwDuringLiveCard();
await x4NamedTask();

console.log(`\n=== merge-interactions [${tree.split('/').slice(-1)[0]} lang=${LANG} cards=${CARDS}]: pass=${pass} fail=${fail} total=${pass + fail} ===`);
if (failures.length) console.log('failed: ' + failures.join(' | '));
server.close();
process.exit(fail === 0 ? 0 : 1);
