// Usage: node scenario.mjs <scenario> <arm> <distDir>
// scenarios: group-only | dm-only | restart | todo-only | smoke
import {
  createRun, startFakeOpenAI, startChannel, killChannel, shutdown, waitFor, sleep,
  calls, modelRequests, channelLog, readCursor, appendEvent, historyMessage, liveEvent,
  documentMentionCard, setModelMode, writeSettings, seedHistory, writeSummary, note, promptMarkers,
} from './lib.mjs';

const [scenario, arm, distDir] = process.argv.slice(2);
if (!scenario || !arm || !distDir) {
  console.error('usage: node scenario.mjs <scenario> <arm> <distDir>');
  process.exit(2);
}

const AT = 'user_im_message_receive_at';
const O2O = 'user_im_message_receive_o2o_all';
const GROUP = 'user_im_message_receive_group';

const GROUPS_MENTION_ONLY = { '*': { requireMention: true } };
const GROUPS_WITH_AMBIENT = { '*': { requireMention: true }, 'grp-ambient': { requireMention: false } };

async function waitConnected(run) {
  return waitFor(run, 'auth status observed (connect reached authentication)', () => calls(run).some((c) => c.command === 'auth status'), 90_000);
}

async function waitPolls(run, command, n, timeoutMs = 60_000) {
  return waitFor(run, `${n}x ${command}`, () => calls(run).filter((c) => c.command === command).length >= n, timeoutMs);
}

async function waitAnyPolls(run, n, timeoutMs = 60_000) {
  return waitFor(run, `${n} history/todo polls of any kind`, () => calls(run).filter((c) => /list-all|list-mentions|todo task list/.test(c.command)).length >= n, timeoutMs);
}

async function groupOnly() {
  const now = Date.now();
  const run = createRun({
    name: 'group-only', arm,
    channelConfig: { groupPolicy: 'open', dmPolicy: 'disabled', groups: GROUPS_MENTION_ONLY, watchTodos: false },
    direct: [
      historyMessage({ id: 'dm-hist-1', conversationId: 'cid-alice', senderId: 'user-alice', senderName: 'Alice', content: 'DM-HISTORY-PROBE please answer', createTime: now - 2000 }),
      historyMessage({ id: 'dm-card-1', conversationId: 'cid-bob', senderId: 'user-bob', senderName: 'Bob', content: documentMentionCard('doc-card-1'), createTime: now - 1000 }),
    ],
    mentions: [
      historyMessage({ id: 'at-hist-1', conversationId: 'grp-1', senderId: 'user-carol', senderName: 'Carol', content: '@Probe Bot AT-HISTORY-PROBE please answer', createTime: now - 2000 }),
    ],
  });
  await startFakeOpenAI(run);
  startChannel(run, distDir);
  await waitConnected(run);
  await waitAnyPolls(run, 2, 60_000);
  appendEvent(run, AT, liveEvent({ type: AT, id: 'at-live-1', conversationId: 'grp-1', senderId: 'user-carol', senderName: 'Carol', content: '@Probe Bot AT-LIVE-PROBE please answer' }));
  appendEvent(run, O2O, liveEvent({ type: O2O, id: 'dm-live-1', conversationId: 'cid-alice', senderId: 'user-alice', senderName: 'Alice', content: 'DM-LIVE-PROBE please answer' }));
  await sleep(20_000);
  await shutdown(run);
  writeSummary(run);
}

async function dmOnly() {
  const now = Date.now();
  const run = createRun({
    name: 'dm-only', arm,
    channelConfig: { groupPolicy: 'disabled', dmPolicy: 'open', groups: GROUPS_WITH_AMBIENT, watchTodos: false },
    direct: [
      historyMessage({ id: 'dm-hist-1', conversationId: 'cid-alice', senderId: 'user-alice', senderName: 'Alice', content: 'DM-HISTORY-PROBE please answer', createTime: now - 2000 }),
    ],
    mentions: [
      historyMessage({ id: 'at-hist-1', conversationId: 'grp-1', senderId: 'user-carol', senderName: 'Carol', content: '@Probe Bot AT-HISTORY-PROBE please answer', createTime: now - 2000 }),
    ],
  });
  await startFakeOpenAI(run);
  startChannel(run, distDir);
  await waitConnected(run);
  await waitAnyPolls(run, 2, 60_000);
  appendEvent(run, O2O, liveEvent({ type: O2O, id: 'dm-live-1', conversationId: 'cid-alice', senderId: 'user-alice', senderName: 'Alice', content: 'DM-LIVE-PROBE please answer' }));
  appendEvent(run, AT, liveEvent({ type: AT, id: 'at-live-1', conversationId: 'grp-1', senderId: 'user-carol', senderName: 'Carol', content: '@Probe Bot AT-LIVE-PROBE please answer' }));
  appendEvent(run, GROUP, liveEvent({ type: GROUP, id: 'grp-live-1', conversationId: 'grp-ambient', senderId: 'user-dave', senderName: 'Dave', content: 'GROUP-AMBIENT-LIVE-PROBE please answer' }), 'grp-ambient');
  await sleep(20_000);
  await shutdown(run);
  writeSummary(run);
}

async function restart() {
  const run = createRun({
    name: 'restart', arm,
    channelConfig: { groupPolicy: 'open', dmPolicy: 'open', groups: GROUPS_MENTION_ONLY, watchTodos: false, senderPolicy: 'pairing', allowedUsers: ['user-alice', 'user-carol', 'user-dave'] },
    direct: [], mentions: [],
  });
  await startFakeOpenAI(run);
  setModelMode(run, 'hang');
  startChannel(run, distDir);
  await waitConnected(run);
  await waitFor(run, 'all live subscriptions ready', () => calls(run).filter((c) => c.command === 'event consume').length >= 2, 60_000);
  await sleep(1500);
  appendEvent(run, O2O, liveEvent({ type: O2O, id: 'dm-pend-1', conversationId: 'cid-alice', senderId: 'user-alice', senderName: 'Alice', content: 'PENDING-DM-PROBE please answer' }));
  // Dave is an allowed sender: his document card starts a (hung) task and is persisted as a pending direct message.
  appendEvent(run, O2O, liveEvent({ type: O2O, id: 'dm-card-pend', conversationId: 'cid-dave', senderId: 'user-dave', senderName: 'Dave', content: documentMentionCard('doc-pend-1', '1786589783750e2a797d2c2c141c295519dbcb07f2299') }));
  // Bob is NOT paired: his document card is parked in pendingDocumentNotifications until pairing is approved.
  appendEvent(run, O2O, liveEvent({ type: O2O, id: 'dm-card-parked', conversationId: 'cid-bob', senderId: 'user-bob', senderName: 'Bob', content: documentMentionCard('doc-parked-1', '1786589783750e2a797d2c2c141c295519dbcb07f2288') }));
  appendEvent(run, AT, liveEvent({ type: AT, id: 'at-pend-1', conversationId: 'grp-1', senderId: 'user-carol', senderName: 'Carol', content: '@Probe Bot PENDING-AT-PROBE please answer' }));
  const parked = await waitFor(run, 'three in-flight turns + one parked doc notification persisted', () => {
    const cursor = readCursor(run);
    const pending = (cursor?.pendingMessages ?? []).map((p) => `${p.source.kind}:${p.message.messageId}`);
    const docs = (cursor?.pendingDocumentNotifications ?? []).map((p) => `${p.documentId}:${p.senderId}`);
    const hung = modelRequests(run).filter((r) => r.mode === 'hang' && r.tools > 0).length;
    return pending.includes('direct:dm-pend-1') && pending.includes('at:at-pend-1') && pending.includes('direct:dm-card-pend') && docs.includes('doc-parked-1:user-bob') && hung >= 3 ? { pending, docs, hung } : undefined;
  }, 90_000);
  const phase1 = { parked, cursorBeforeKill: readCursor(run), modelRequestsPhase1: modelRequests(run).length, callsPhase1: calls(run).length };
  note(run, `phase 1 parked: ${JSON.stringify(parked)}`);
  await killChannel(run, 'SIGKILL');
  await sleep(1000);
  // Phase 2: direct messages disabled, model healthy again.
  writeSettings(run, { groupPolicy: 'open', dmPolicy: 'disabled', groups: GROUPS_MENTION_ONLY, watchTodos: false, senderPolicy: 'pairing', allowedUsers: ['user-alice', 'user-carol', 'user-dave'] });
  setModelMode(run, 'ok');
  const phase2Start = Date.now();
  startChannel(run, distDir);
  await waitFor(run, 'phase-2 auth status observed', () => calls(run).some((c) => c.command === 'auth status' && c.ms >= phase2Start), 90_000);
  await waitFor(run, 'phase-2 2x list-mentions', () => calls(run).filter((c) => c.command === 'chat message list-mentions' && c.ms >= phase2Start).length >= 2, 60_000);
  await sleep(12_000);
  await shutdown(run);
  const c = calls(run).filter((e) => e.ms >= phase2Start);
  const firstHistoryPoll = c.find((e) => /list-all|list-mentions/.test(e.command));
  writeSummary(run, {
    phase1,
    phase2: {
      firstHistoryPoll: firstHistoryPoll ? { command: firstHistoryPoll.command, cursor: firstHistoryPoll.cursor } : undefined,
      historyPollsAfterRestart: c.filter((e) => /list-all|list-mentions/.test(e.command)).map((e) => e.command),
      modelPromptsAfterRestart: modelRequests(run).filter((r) => r.ms >= phase2Start && r.tools > 0).map((r) => promptMarkers(r.lastUser)),
      docReadsAfterRestart: c.filter((e) => e.command === 'doc read').length,
      docCommentRepliesAfterRestart: c.filter((e) => e.command === 'doc comment reply').length,
      cursorAfter: readCursor(run),
    },
  });
}

async function todoOnly() {
  const run = createRun({
    name: 'todo-only', arm,
    channelConfig: { groupPolicy: 'disabled', dmPolicy: 'disabled', groups: GROUPS_MENTION_ONLY, watchTodos: true },
    direct: [], mentions: [],
    todos: [{ taskId: 'todo-1', subject: 'TODO-BASELINE-PROBE', creatorId: 'user-erin', creatorName: 'Erin', priority: 20, dueTime: 0, executorIds: ['self-user-id'] }],
  });
  await startFakeOpenAI(run);
  startChannel(run, distDir);
  const connected = await waitConnected(run);
  const baseline = await waitPolls(run, 'todo task list', 1, 60_000);
  await sleep(2000);
  // Change an actionable field so the next todo poll (30 s cadence) starts a task.
  seedHistory(run, { todos: [{ taskId: 'todo-1', subject: 'TODO-CHANGED-PROBE', creatorId: 'user-erin', creatorName: 'Erin', priority: 30, dueTime: 0, executorIds: ['self-user-id'] }] });
  note(run, 'todo-1 subject/priority changed on disk');
  await waitFor(run, 'model prompt carrying TODO-CHANGED-PROBE', () => modelRequests(run).some((r) => r.tools > 0 && r.lastUser.includes('TODO-CHANGED-PROBE')), 75_000);
  await sleep(3000);
  await shutdown(run);
  writeSummary(run, { connected: Boolean(connected), baselinePollSeen: Boolean(baseline), todoCommentAdds: calls(run).filter((e) => e.command === 'todo comment add').length });
}


async function reenable() {
  const cfg = (dmPolicy) => ({ groupPolicy: 'open', dmPolicy, groups: GROUPS_MENTION_ONLY, watchTodos: false });
  const run = createRun({ name: 'reenable', arm, channelConfig: cfg('open'), direct: [], mentions: [] });
  await startFakeOpenAI(run);
  // Phase 1: direct messages open; let the watermark advance past connect.
  startChannel(run, distDir);
  await waitConnected(run);
  await waitFor(run, 'phase-1 2x list-all', () => calls(run).filter((c) => c.command === 'chat message list-all').length >= 2, 60_000);
  await killChannel(run, 'SIGTERM');
  const phase1Cursor = readCursor(run);
  // Phase 2: direct messages disabled; a DM arrives (history + live) during the disabled interval.
  writeSettings(run, cfg('disabled'));
  const phase2Start = Date.now();
  const duringDisabledAt = Date.now() + 1500;
  seedHistory(run, { direct: [historyMessage({ id: 'dm-during-disabled', conversationId: 'cid-alice', senderId: 'user-alice', senderName: 'Alice', content: 'DM-DURING-DISABLED-PROBE please answer', createTime: duringDisabledAt })] });
  startChannel(run, distDir);
  await waitFor(run, 'phase-2 auth status', () => calls(run).some((c) => c.command === 'auth status' && c.ms >= phase2Start), 90_000);
  await sleep(2000);
  appendEvent(run, O2O, liveEvent({ type: O2O, id: 'dm-during-disabled', conversationId: 'cid-alice', senderId: 'user-alice', senderName: 'Alice', content: 'DM-DURING-DISABLED-PROBE please answer', eventTime: duringDisabledAt }));
  await waitFor(run, 'phase-2 2x list-mentions', () => calls(run).filter((c) => c.command === 'chat message list-mentions' && c.ms >= phase2Start).length >= 2, 60_000);
  await sleep(6000);
  await killChannel(run, 'SIGTERM');
  const phase2Cursor = readCursor(run);
  const phase2Calls = calls(run).filter((c) => c.ms >= phase2Start);
  // Phase 3: direct messages re-enabled.
  writeSettings(run, cfg('open'));
  const phase3Start = Date.now();
  startChannel(run, distDir);
  await waitFor(run, 'phase-3 auth status', () => calls(run).some((c) => c.command === 'auth status' && c.ms >= phase3Start), 90_000);
  await waitFor(run, 'phase-3 2x list-all', () => calls(run).filter((c) => c.command === 'chat message list-all' && c.ms >= phase3Start).length >= 2, 60_000);
  appendEvent(run, O2O, liveEvent({ type: O2O, id: 'dm-after-reenable', conversationId: 'cid-alice', senderId: 'user-alice', senderName: 'Alice', content: 'DM-AFTER-REENABLE-PROBE please answer' }));
  await waitFor(run, 'phase-3 model prompt DM-AFTER-REENABLE-PROBE', () => modelRequests(run).some((r) => r.tools > 0 && r.ms >= phase3Start && r.lastUser.includes('DM-AFTER-REENABLE-PROBE')), 60_000);
  await sleep(6000);
  await shutdown(run);
  const phase3Calls = calls(run).filter((c) => c.ms >= phase3Start);
  const listAll = (list) => list.filter((c) => c.command === 'chat message list-all').map((c) => ({ t: c.t, windowStart: c.window?.start, windowEnd: c.window?.end, served: c.served }));
  const reenableLog = channelLog(run).split('\n').filter((l) => /history restarts|discarded|stale/.test(l));
  writeSummary(run, {
    duringDisabledAt,
    phase1: { notificationWatermark: phase1Cursor?.notificationWatermark, mentionWatermark: phase1Cursor?.mentionWatermark },
    phase2: {
      listAll: listAll(phase2Calls),
      listMentions: phase2Calls.filter((c) => c.command === 'chat message list-mentions').length,
      cursor: { notificationWatermark: phase2Cursor?.notificationWatermark, directMessagesEnabled: phase2Cursor?.directMessagesEnabled, processed: phase2Cursor?.processedMessages },
      modelPrompts: modelRequests(run).filter((r) => r.tools > 0 && r.ms >= phase2Start && r.ms < phase3Start).map((r) => promptMarkers(r.lastUser)),
    },
    phase3: {
      start: phase3Start,
      listAll: listAll(phase3Calls),
      modelPrompts: modelRequests(run).filter((r) => r.tools > 0 && r.ms >= phase3Start).map((r) => promptMarkers(r.lastUser)),
      reenableLog,
      cursor: { notificationWatermark: readCursor(run)?.notificationWatermark, notificationHistoryFloor: readCursor(run)?.notificationHistoryFloor, processed: readCursor(run)?.processedMessages },
    },
  });
}

async function smoke() {
  const run = createRun({
    name: 'smoke', arm,
    channelConfig: { groupPolicy: 'open', dmPolicy: 'open', groups: GROUPS_MENTION_ONLY, watchTodos: false },
    direct: [], mentions: [],
  });
  await startFakeOpenAI(run);
  startChannel(run, distDir);
  await waitConnected(run);
  await waitAnyPolls(run, 1, 60_000);
  appendEvent(run, O2O, liveEvent({ type: O2O, id: 'dm-live-1', conversationId: 'cid-alice', senderId: 'user-alice', senderName: 'Alice', content: 'SMOKE-DM-PROBE please answer' }));
  await waitFor(run, 'im reply sent', () => calls(run).some((c) => c.command === 'chat message reply' || c.command === 'chat message send'), 60_000);
  await shutdown(run);
  writeSummary(run);
}

const table = { 'group-only': groupOnly, 'dm-only': dmOnly, restart, 'todo-only': todoOnly, reenable, smoke };
const fn = table[scenario];
if (!fn) {
  console.error(`unknown scenario ${scenario}`);
  process.exit(2);
}
fn().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
