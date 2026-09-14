import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RIG = path.dirname(fileURLToPath(import.meta.url));
export const RUNS = path.join(RIG, 'runs');
export const CHANNEL = 'dws-probe';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function nowIso() {
  return new Date().toISOString();
}

export function createRun({ name, arm, channelConfig, direct = [], mentions = [], todos = [] }) {
  const dir = path.join(RUNS, `${name}-${arm}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const home = path.join(dir, 'qwen-home');
  const runtime = path.join(dir, 'runtime');
  const ws = path.join(dir, 'ws');
  const dws = path.join(dir, 'dws');
  for (const d of [home, runtime, ws, path.join(dws, 'history'), path.join(dws, 'events')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  const run = { name, arm, dir, home, runtime, ws, dws, channelLog: path.join(dir, 'channel.log'), modelLog: path.join(dir, 'model-requests.jsonl'), modeFile: path.join(dir, 'model-mode'), summary: {} };
  writeSettings(run, channelConfig);
  seedHistory(run, { direct, mentions, todos });
  fs.writeFileSync(run.modeFile, 'ok\n');
  return run;
}

export function writeSettings(run, channelConfig) {
  const settings = {
    security: { auth: { selectedType: 'openai' } },
    channels: {
      [CHANNEL]: {
        type: 'dws',
        profile: 'probe-profile',
        senderPolicy: 'open',
        approvalMode: 'yolo',
        cwd: run.ws,
        ...channelConfig,
      },
    },
  };
  fs.writeFileSync(path.join(run.home, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  run.channelConfig = settings.channels[CHANNEL];
}

export function seedHistory(run, { direct, mentions, todos }) {
  const h = path.join(run.dws, 'history');
  if (direct) fs.writeFileSync(path.join(h, 'direct.json'), JSON.stringify(direct, null, 2));
  if (mentions) fs.writeFileSync(path.join(h, 'mentions.json'), JSON.stringify(mentions, null, 2));
  if (todos) fs.writeFileSync(path.join(h, 'todos.json'), JSON.stringify(todos, null, 2));
}

export function historyMessage({ id, conversationId, senderId, senderName, content, createTime = Date.now() }) {
  return {
    openMessageId: id,
    openConversationId: conversationId,
    senderOpenDingTalkId: senderId,
    sender: senderName,
    content,
    createTime,
  };
}

export function liveEvent({ type, id, conversationId, senderId, senderName, content, eventTime = Date.now() }) {
  return {
    type,
    event_id: `evt-${id}`,
    message_id: id,
    conversation_id: conversationId,
    sender_open_dingtalk_id: senderId,
    sender: senderName,
    content,
    event_time: eventTime,
  };
}

export function appendEvent(run, topic, event, group) {
  const file = path.join(run.dws, 'events', group ? `${topic}--${group}.jsonl` : `${topic}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(event) + '\n');
  note(run, `injected ${topic}${group ? ` --group ${group}` : ''} ${event.message_id}`);
}

export function documentMentionCard(documentId = 'doc-1', commentKey = '1786589783750e2a797d2c2c141c295519dbcb07f2274') {
  const query = new URLSearchParams({
    corpId: 'corp-1',
    utm_medium: 'im_card',
    iframeQuery: new URLSearchParams({
      mention_source: '2',
      comment_stid: 'global',
      comment_key: commentKey,
      comment_id: commentKey.slice(13),
      sender_id: '5724713341',
    }).toString(),
    utm_source: 'im',
  });
  const url = `https://alidocs.dingtalk.com/i/nodes/${documentId}?${query}`;
  return ['Project plan', ' @Probe Bot reply with the document code', 'Alice', 'View now', 'DingTalk Docs', `[${url}](${url})`].join('\n');
}

export function setModelMode(run, mode) {
  fs.writeFileSync(run.modeFile, mode + '\n');
  note(run, `model mode -> ${mode}`);
}

export function note(run, text) {
  const line = `[rig ${nowIso()}] ${text}`;
  fs.appendFileSync(path.join(run.dir, 'rig.log'), line + '\n');
  process.stdout.write(line + '\n');
}

function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/_proxy$/i.test(key) || key === 'NODE_OPTIONS') delete env[key];
  }
  return env;
}

export async function startFakeOpenAI(run) {
  const proc = spawn(process.execPath, [path.join(RIG, 'fake-openai.mjs')], {
    env: { ...cleanEnv(), FAKE_OPENAI_PORT: '0', FAKE_OPENAI_LOG: run.modelLog, FAKE_OPENAI_MODE: run.modeFile },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d;
      const m = buf.match(/FAKE_OPENAI_LISTENING (\d+)/);
      if (m) resolve(Number(m[1]));
    });
    proc.on('exit', (code) => reject(new Error(`fake openai exited ${code}`)));
  });
  run.openai = { proc, port };
  note(run, `fake openai listening on ${port}`);
  return run.openai;
}

export function channelEnv(run) {
  return {
    ...cleanEnv(),
    QWEN_HOME: run.home,
    QWEN_RUNTIME_DIR: run.runtime,
    QWEN_CODE_NO_RELAUNCH: 'true',
    OPENAI_API_KEY: 'dummy',
    OPENAI_BASE_URL: `http://127.0.0.1:${run.openai.port}/v1`,
    OPENAI_MODEL: 'dummy',
    PATH: `${path.join(RIG, 'bin')}:${process.env.PATH}`,
    DWS_RIG_DIR: run.dws,
    DWS_CURSOR_DIR: path.join(run.home, 'channels'),
    NO_COLOR: '1',
  };
}

export function startChannel(run, distDir) {
  const log = fs.openSync(run.channelLog, 'a');
  fs.writeSync(log, `\n===== channel start ${nowIso()} arm=${run.arm} dist=${distDir} =====\n`);
  const proc = spawn(process.execPath, [path.join(distDir, 'cli.js'), 'channel', 'start', CHANNEL], {
    cwd: run.ws,
    env: channelEnv(run),
    stdio: ['ignore', log, log],
    detached: true,
  });
  run.channel = proc;
  note(run, `channel process pid ${proc.pid}`);
  proc.on('exit', (code, signal) => note(run, `channel process exited code=${code} signal=${signal}`));
  return proc;
}

export function killChannel(run, signal = 'SIGTERM') {
  const proc = run.channel;
  if (!proc || proc.exitCode !== null) return Promise.resolve();
  note(run, `sending ${signal} to channel process group ${proc.pid}`);
  return new Promise((resolve) => {
    proc.once('exit', () => resolve());
    try {
      process.kill(-proc.pid, signal);
    } catch {
      try { proc.kill(signal); } catch { /* gone */ }
    }
    setTimeout(() => {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ }
      resolve();
    }, 8000).unref();
  });
}

export function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export const calls = (run) => readJsonl(path.join(run.dws, 'calls.jsonl'));
export const modelRequests = (run) => readJsonl(run.modelLog);
export const channelLog = (run) => { try { return fs.readFileSync(run.channelLog, 'utf8'); } catch { return ''; } };

export function readCursor(run) {
  const dir = path.join(run.home, 'channels');
  try {
    const file = fs.readdirSync(dir).find((n) => n.endsWith('-poll-cursor.json'));
    if (!file) return undefined;
    return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  } catch {
    return undefined;
  }
}

export async function waitFor(run, label, pred, timeoutMs = 60_000, intervalMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = pred();
    if (value) {
      note(run, `waitFor ok: ${label} (+${Date.now() - started}ms)`);
      return value;
    }
    await sleep(intervalMs);
  }
  note(run, `waitFor TIMEOUT: ${label}`);
  return undefined;
}

export function promptMarkers(text) {
  const markers = [...new Set((text.match(/[A-Z]+(?:-[A-Z]+)*-PROBE/g) ?? []))];
  const doc = /DOC-CODE-7731|Probe document/.test(text) ? ['<document-content>'] : [];
  return [...markers, ...doc].join('+') || `(no marker) ${text.replace(/\s+/g, ' ').slice(-100)}`;
}

export function summarize(run) {
  const c = calls(run);
  const subscriptions = c.filter((e) => e.command === 'event consume').map((e) => `${e.argv.filter((a) => a !== '--format' && a !== 'compact' && a !== '--profile' && a !== 'probe-profile').join(' ')}`);
  const count = (cmd) => c.filter((e) => e.command === cmd).length;
  const m = modelRequests(run);
  const log = channelLog(run);
  const interesting = log.split('\n').filter((l) => /discarded|history restarts|stale|pending DWS|failed to poll|Error|requires|DWS channel|Channel:/.test(l) && !/\[AcpBridge\]|\[scheduler\]/.test(l));
  return {
    arm: run.arm,
    subscriptions: [...new Set(subscriptions)],
    subscriptionStarts: subscriptions.length,
    polls: {
      'chat message list-all': count('chat message list-all'),
      'chat message list-mentions': count('chat message list-mentions'),
      'todo task list': count('todo task list'),
    },
    docReads: count('doc read'),
    docCommentReplies: count('doc comment reply'),
    imReplies: count('chat message reply') + count('chat message send'),
    reactions: count('chat message add-emoji'),
    modelPrompts: m.filter((r) => r.tools > 0).map((r) => promptMarkers(r.lastUser)),
    modelRequestsTotal: m.length,
    logLines: interesting,
    cursor: readCursor(run),
  };
}

export function writeSummary(run, extra = {}) {
  const summary = { ...summarize(run), ...extra, channelConfig: run.channelConfig };
  fs.writeFileSync(path.join(run.dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

export async function shutdown(run) {
  await killChannel(run, 'SIGTERM');
  if (run.openai?.proc) run.openai.proc.kill('SIGKILL');
  // Reap stray fake-dws event consumers started under this run.
  try {
    const out = execFileSync('pgrep', ['-f', `${RIG}/bin/dws`], { encoding: 'utf8' });
    for (const pid of out.split('\n').filter(Boolean)) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* gone */ } }
  } catch { /* none */ }
}
