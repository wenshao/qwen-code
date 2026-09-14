#!/usr/bin/env node
// Fake `dws` CLI for PR #11355 verification.
// Every invocation is appended to $DWS_RIG_DIR/calls.jsonl together with a
// snapshot of the channel's persisted poll cursor (DWS_CURSOR_DIR), so the
// order "cursor persisted -> history polled" is observable from outside.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const rigDir = process.env.DWS_RIG_DIR;
if (!rigDir) {
  process.stderr.write('fake dws: DWS_RIG_DIR is not set\n');
  process.exit(2);
}
fs.mkdirSync(rigDir, { recursive: true });

const rawArgs = process.argv.slice(2);
let profile;
const args = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--profile') {
    profile = rawArgs[++i];
    continue;
  }
  args.push(rawArgs[i]);
}
const words = [];
const flags = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[a.slice(2)] = next;
      i++;
    } else {
      flags[a.slice(2)] = true;
    }
  } else {
    words.push(a);
  }
}
const isEventConsume = words[0] === 'event' && words[1] === 'consume';
const command = isEventConsume ? 'event consume' : words.join(' ');
const topic = isEventConsume ? words[2] : undefined;

function cursorSnapshot() {
  const dir = process.env.DWS_CURSOR_DIR;
  if (!dir) return undefined;
  try {
    const file = fs
      .readdirSync(dir)
      .find((name) => name.endsWith('-poll-cursor.json'));
    if (!file) return { missing: true };
    const cursor = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    return {
      pendingMessages: (cursor.pendingMessages ?? []).map(
        (p) => `${p.source.kind}:${p.message.messageId}`,
      ),
      pendingDocumentNotifications: (
        cursor.pendingDocumentNotifications ?? []
      ).map((p) => `${p.documentId}:${p.messageId}`),
      processedMessages: (cursor.processedMessages ?? []).length,
      groupMessagesEnabled: cursor.groupMessagesEnabled,
      directMessagesEnabled: cursor.directMessagesEnabled,
      notificationWatermark: cursor.notificationWatermark,
      mentionWatermark: cursor.mentionWatermark,
      notificationHistoryFloor: cursor.notificationHistoryFloor,
      mentionHistoryFloor: cursor.mentionHistoryFloor,
      inboundFailures: (cursor.inboundFailures ?? []).length,
    };
  } catch (error) {
    return { error: String(error && error.message) };
  }
}

function log(extra) {
  const entry = {
    t: new Date().toISOString(),
    ms: Date.now(),
    pid: process.pid,
    profile,
    command,
    topic,
    flags,
    argv: rawArgs,
    cursor: cursorSnapshot(),
    ...extra,
  };
  fs.appendFileSync(
    path.join(rigDir, 'calls.jsonl'),
    JSON.stringify(entry) + '\n',
  );
}

function out(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

function parseLocal(text) {
  // "YYYY-MM-DD HH:MM:SS" in local time, as produced by formatDwsDateTime.
  const m = String(text).match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function historyPage(kind, singleChat) {
  const start = parseLocal(flags.start);
  const end = parseLocal(flags.end);
  const all = readJson(path.join(rigDir, 'history', `${kind}.json`), []);
  const selected = all.filter(
    (m) => m.createTime >= start && m.createTime <= end + 999,
  );
  const byConversation = new Map();
  for (const m of selected) {
    const list = byConversation.get(m.openConversationId) ?? [];
    list.push(m);
    byConversation.set(m.openConversationId, list);
  }
  log({
    window: { start, end },
    served: selected.map((m) => m.openMessageId),
  });
  out({
    success: true,
    result: {
      conversationMessagesList: [...byConversation.entries()].map(
        ([openConversationId, messages]) => ({
          openConversationId,
          singleChat,
          messages,
        }),
      ),
      hasMore: false,
      nextCursor: '',
    },
  });
}

function tailEvents(topic) {
  const group = flags.group;
  const file = path.join(
    rigDir,
    'events',
    group ? `${topic}--${group}.jsonl` : `${topic}.jsonl`,
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '');
  // Start at EOF: a restarted consumer must never replay old events.
  let offset = fs.statSync(file).size;
  log({ subscribed: file, startOffset: offset });
  process.stderr.write('[event] ready\n');
  const timer = setInterval(() => {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size <= offset) return;
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(size - offset);
    fs.readSync(fd, buffer, 0, buffer.length, offset);
    fs.closeSync(fd);
    offset = size;
    const text = buffer.toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      fs.appendFileSync(
        path.join(rigDir, 'calls.jsonl'),
        JSON.stringify({
          t: new Date().toISOString(),
          ms: Date.now(),
          pid: process.pid,
          command: `event delivered ${topic}${group ? ` --group ${group}` : ''}`,
          line,
        }) + '\n',
      );
      process.stdout.write(line + '\n');
    }
  }, 100);
  const stop = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.stdin.on('end', stop);
  process.stdin.resume();
}

switch (command) {
  case 'version':
    log();
    out({ version: '1.0.60' });
    break;
  case 'profile list':
    log();
    out({
      success: true,
      result: [{ profile: 'probe-profile', corpId: 'corp-probe', isCurrent: true }],
    });
    break;
  case 'auth status':
    log();
    out({
      success: true,
      result: {
        authenticated: true,
        profile: profile ?? 'probe-profile',
        openDingTalkId: 'self-bot-open-id',
        userId: 'self-user-id',
        userName: 'Probe Bot',
      },
    });
    break;
  case 'event consume':
    tailEvents(topic);
    break;
  case 'chat message list-all':
    historyPage('direct', true);
    break;
  case 'chat message list-mentions':
    historyPage('mentions', false);
    break;
  case 'chat message send':
  case 'chat message reply':
  case 'chat message add-emoji':
  case 'chat message remove-emoji':
    log();
    out({ success: true, result: { ok: true } });
    break;
  case 'doc read':
    log();
    out({
      success: true,
      result: {
        markdown: `# Probe document ${flags.node}\n\nThe document code is DOC-CODE-7731.\n`,
      },
    });
    break;
  case 'doc comment reply':
    log();
    out({ success: true, result: { ok: true } });
    break;
  case 'todo task list': {
    const todos = readJson(path.join(rigDir, 'history', 'todos.json'), []);
    log({ served: todos.map((t) => t.taskId) });
    out({ success: true, result: { todoCards: todos, hasMore: false } });
    break;
  }
  case 'todo task get': {
    const todos = readJson(path.join(rigDir, 'history', 'todos.json'), []);
    const task = todos.find((t) => t.taskId === flags['task-id']);
    log();
    out({ success: true, result: { todoDetailModel: task ?? { taskId: flags['task-id'], subject: 'missing' } } });
    break;
  }
  case 'todo comment add':
    log();
    out({ success: true, result: { ok: true } });
    break;
  case 'contact user search':
    log();
    out({ success: true, result: [] });
    break;
  default:
    log({ unhandled: true });
    out({ success: true });
}
