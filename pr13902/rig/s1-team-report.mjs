// S1 (central claim): an ACP-hosted daemon session creates a team, a teammate
// reports, and the report must reach (a) the client as a `peer` notification
// carrying structured teammate identity and (b) the leader MODEL (provider-side
// ledger), i.e. counted at the destination, not at the sink.
// usage: node s1-team-report.mjs <runDir> <port> <arm>
import fs from 'node:fs';
import path from 'node:path';
import { runCtx, Sess, sleep, frameMeta, frameUpdate, readLedger, check, walkFiles } from './lib.mjs';

const [runDir, port, arm] = process.argv.slice(2);
const ctx = runCtx(runDir, Number(port));
const results = [];
const tag = 'S1';
const A = new Sess(ctx, 'leader');
await A.create();
await A.mode('yolo');
if (process.env.PRE_HOLD) {
  // Let a live Web Shell page attach before the scenario starts, so ephemeral
  // (unpersisted) activity frames are rendered as they arrive.
  fs.writeFileSync(path.join(runDir, 'HOLD'), JSON.stringify({ label: 'pre', sessionId: A.id, token: ctx.token, port: ctx.port }));
  const s0 = Date.now();
  while (!fs.existsSync(path.join(runDir, 'RELEASE')) && Date.now() - s0 < 60000) await sleep(200);
  ctx.mark('pre-hold released');
}
await A.prompt(`[[LEAD:team:${tag}:report]] Create a team and spawn one teammate.`);
const t1 = await A.waitTurns(1, 60);
ctx.mark('first turn settled', { t1: t1?.stopReason });
// Give the teammate time to report and the leader time to be woken.
const woke = await A.waitFor(() => A.frames.some((f) => JSON.stringify(f.data).includes('LEADER-GOT-REPORT')), 40);
ctx.mark('wait for leader reply to report', { woke: !!woke });
await sleep(3000);

const all = A.frames;
const teammateFrames = all.filter((f) => frameMeta(f)?.agent?.kind === 'teammate');
const peerFrames = all.filter((f) => frameMeta(f)?.backgroundTask?.kind === 'peer' || frameMeta(f)?.backgroundTask?.kind === 'peer');
const reportFrames = all.filter((f) => JSON.stringify(f.data).includes(`TEAMMATE-REPORT ${tag}`));
const ledger = readLedger(runDir);
const leaderGotReport = ledger.filter((r) => r.who === 'leader' && r.scen === 'notified' && r.tag === tag);
const teammateCalls = ledger.filter((r) => r.who === 'teammate');
// Leader inbox on disk: find any team mailbox file holding the report.
const homeFiles = walkFiles(path.join(runDir, 'home')).concat(walkFiles(path.join(runDir, 'qwen-home')), walkFiles(path.join(runDir, 'runtime')), walkFiles(path.join(runDir, 'ws')));
const inboxes = homeFiles.filter((p) => /inbox/i.test(p) && p.endsWith('.json'));
const inboxState = inboxes.map((p) => {
  let rows = []; try { rows = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  const arr = Array.isArray(rows) ? rows : rows.messages || [];
  return { file: path.relative(runDir, p), rows: arr.map((m) => ({ from: m.from, read: m.read, text: String(m.text ?? m.message ?? m.content ?? '').slice(0, 60) })) };
});

const summary = {
  arm,
  teammateModelCalls: teammateCalls.length,
  sseFramesTotal: all.length,
  teammateIdentityFrames: teammateFrames.length,
  peerFrames: peerFrames.length,
  reportFramesOnWire: reportFrames.length,
  leaderModelRequestsCarryingReport: leaderGotReport.length,
  identities: [...new Set(teammateFrames.map((f) => JSON.stringify(frameMeta(f).agent)))],
  peerTaskIds: peerFrames.map((f) => frameMeta(f)?.backgroundTask?.taskId),
  sources: [...new Set(teammateFrames.map((f) => frameMeta(f)?.source))],
  turns: A.turns.map((t) => ({ t: t.t, type: t.type, stopReason: t.stopReason })),
  inboxState,
};
console.log('SUMMARY', JSON.stringify(summary, null, 1));
if (arm === 'head') {
  check(results, 'teammate actually ran (provider saw teammate requests)', teammateCalls.length >= 1, teammateCalls.length);
  check(results, 'peer notification frames on the wire', peerFrames.length >= 1, peerFrames.length);
  check(results, 'frames carry _meta.agent {agentName:/root/correctness, depth:1, kind:teammate}', teammateFrames.some((f) => { const a = frameMeta(f).agent; return a.agentName === '/root/correctness' && a.depth === 1 && a.kind === 'teammate'; }), summary.identities);
  check(results, 'teammate report reached the leader MODEL (provider ledger)', leaderGotReport.length >= 1, leaderGotReport.length);
  check(results, 'leader inbox rows consumed (read:true)', inboxState.some((i) => i.rows.some((r) => r.read === true)), inboxState);
} else {
  check(results, 'control: teammate actually ran on base too', teammateCalls.length >= 1, teammateCalls.length);
  check(results, 'control: base delivers 0 peer frames', peerFrames.length === 0, peerFrames.length);
  check(results, 'control: base frames carry no teammate identity', teammateFrames.length === 0, teammateFrames.length);
  check(results, 'control: report never reaches the leader model on base', leaderGotReport.length === 0, leaderGotReport.length);
  check(results, 'control: report retained unread in leader inbox on base', inboxState.some((i) => i.rows.some((r) => r.read === false)), inboxState);
}
fs.writeFileSync(path.join(runDir, 's1-result.json'), JSON.stringify({ summary, results, timeline: ctx.timeline }, null, 2));
console.log(`RESULT s1 ${arm} pass=${results.filter((r) => r.ok).length} fail=${results.filter((r) => !r.ok).length}`);
A.close();
process.exit(0);
