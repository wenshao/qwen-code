// S2 + S3 on one real daemon session in `default` approval mode.
//  C0 (control): leader's own write_file approval reaches the client promptly.
//  S2: a teammate's write_file approval reaches the client (head) / never does (base).
//  S3 (bot R1-1): with that teammate approval left unanswered, a NEW leader
//      prompt needs its own write_file approval -> does it reach the client?
//      Then answer the teammate card and measure when the leader's appears.
// Optional hold window for Web Shell screenshots: touches <runDir>/HOLD and
// waits until <runDir>/RELEASE exists (or HOLD_S seconds).
// usage: node s2-approval.mjs <runDir> <port> <arm> [holdSeconds]
import fs from 'node:fs';
import path from 'node:path';
import { runCtx, Sess, sleep, readLedger, check } from './lib.mjs';

const [runDir, port, arm, holdArg] = process.argv.slice(2);
const HOLD_S = Number(holdArg || 0);
const WEDGE_WAIT_S = 30;
const ctx = runCtx(runDir, Number(port));
const results = [];
const verdict = {};
const A = new Sess(ctx, 'leader');
await A.create();
await A.mode('default');
const isTeammate = (p) => String(p.toolCallId || '').startsWith('teammate-');
const health = async () => (await ctx.j('GET', '/health?deep=1')).data;
const pickOnce = (p) => (p.options || []).find((o) => o.optionId === 'proceed_once')?.optionId ?? p.options?.[0]?.optionId;
async function hold(label) {
  if (!HOLD_S) return;
  fs.writeFileSync(path.join(runDir, 'HOLD'), JSON.stringify({ label, sessionId: A.id, token: ctx.token, port: ctx.port }));
  ctx.mark(`HOLD (${label}) — screenshot window up to ${HOLD_S}s`);
  const s = Date.now();
  while (!fs.existsSync(path.join(runDir, 'RELEASE')) && Date.now() - s < HOLD_S * 1000) await sleep(250);
  try { fs.unlinkSync(path.join(runDir, 'RELEASE')); } catch {}
  try { fs.unlinkSync(path.join(runDir, 'HOLD')); } catch {}
  ctx.mark('hold released');
}
// Auto-approve the leader's own setup tools (team_create / tool_search / agent) while
// recording every request; never auto-answer a teammate approval.
let autoLeader = true;
const autoVoted = new Set();
const autoTimer = setInterval(async () => {
  if (!autoLeader) return;
  for (const p of A.perms) {
    if (isTeammate(p) || autoVoted.has(p.requestId)) continue;
    autoVoted.add(p.requestId);
    await A.vote(p.requestId, pickOnce(p));
  }
}, 150);

// ── C0: control, no teammate approval pending ──
const c0Sent = ctx.ts();
await A.prompt('[[LEAD:write:C0]] Write the control file.');
const c0 = await A.waitFor(() => A.perms.find((p) => p.toolCallId?.startsWith('call_lw_C0')), 20);
verdict.C0_leader_permission_latency_s = c0 ? +(c0.t - c0Sent).toFixed(3) : null;
await A.waitTurns(1, 30);
check(results, 'C0 control: leader write_file approval reached the client', !!c0, verdict.C0_leader_permission_latency_s);

// ── S2: teammate write approval ──
const s2Sent = ctx.ts();
await A.prompt('[[LEAD:team:S2:write]] Create a team; the teammate writes a file.');
const tp = await A.waitFor(() => A.perms.find(isTeammate), 30);
verdict.S2_teammate_permission_latency_s = tp ? +(tp.t - s2Sent).toFixed(3) : null;
verdict.S2_teammate_permission = tp ? { toolCallId: tp.toolCallId, title: tp.title, meta: tp.meta, options: (tp.options || []).map((o) => o.optionId), rawInput: tp.raw?.toolCall?.rawInput, promptId: tp.raw?.promptId ?? null } : null;
await A.waitTurns(2, 30);
const tmFile = path.join(ctx.ws, 'tm-S2.txt');
verdict.S2_file_before_vote = fs.existsSync(tmFile);
verdict.S2_health_while_pending = await health();
verdict.S2_status_while_pending = await A.status();

if (arm === 'cand' || arm === 'head2') {
  // Candidate fix (teammate approvals off the foreground queue): the leader's
  // own approval must surface while the teammate card is still pending.
  check(results, 'S2: teammate approval reached the client as permission_request', !!tp, verdict.S2_teammate_permission);
  await sleep(1500);
  autoLeader = false;
  const s3Sent = ctx.ts();
  await A.prompt('[[LEAD:write:S3]] Write another file while the teammate waits.');
  const lp = await A.waitFor(() => A.perms.find((p) => p.toolCallId?.startsWith('call_lw_S3')), WEDGE_WAIT_S);
  verdict.S3_leader_permission_latency_s = lp ? +(lp.t - s3Sent).toFixed(3) : null;
  verdict.S3_status_both_pending = await A.status();
  check(results, 'CAND S3: leader approval published while teammate card still pending', !!lp, verdict.S3_leader_permission_latency_s);
  check(results, 'CAND S3: daemon lists both approvals pending at once', (verdict.S3_status_both_pending.pendingInteractionCount ?? 0) >= 2, verdict.S3_status_both_pending.pendingInteractionCount);
  await hold('cand-both-pending');
  if (lp) await A.vote(lp.requestId, pickOnce(lp));
  const lw = await A.waitFor(() => fs.existsSync(path.join(ctx.ws, 'leader-S3.txt')), 20);
  check(results, 'CAND S3: leader file written before the teammate card is answered', !!lw && !fs.existsSync(tmFile));
  await A.vote(tp.requestId, pickOnce(tp));
  const tmWritten = await A.waitFor(() => fs.existsSync(tmFile), 20);
  check(results, 'CAND S2: teammate file written after its vote', !!tmWritten);
} else if (arm === 'head') {
  check(results, 'S2: teammate approval reached the client as permission_request', !!tp, verdict.S2_teammate_permission);
  check(results, 'S2: request names the teammate (_meta.teammateName=correctness)', tp?.meta?.teammateName === 'correctness', tp?.meta?.teammateName);
  check(results, 'S2: file not written before the vote', !verdict.S2_file_before_vote);

  // ── S3 (R1-1): leave the teammate card unanswered, prompt the leader again ──
  await sleep(1500);
  autoLeader = false; // observe the leader's own request without answering it
  const s3Sent = ctx.ts();
  await A.prompt('[[LEAD:write:S3]] Write another file while the teammate waits.');
  const lp = await A.waitFor(() => A.perms.find((p) => p.toolCallId?.startsWith('call_lw_S3')), WEDGE_WAIT_S);
  verdict.S3_leader_permission_within_wait = !!lp;
  verdict.S3_wait_s = WEDGE_WAIT_S;
  verdict.S3_status_during_wedge = await A.status();
  verdict.S3_health_during_wedge = await health();
  verdict.S3_ledger_leader_write_requests = readLedger(runDir).filter((r) => r.who === 'leader' && r.scen === 'write' && r.tag === 'S3').map((r) => ({ i: r.requestIndex, stage: r.stage, reply: r.reply.slice(0, 60) }));
  check(results, `S3 (R1-1): leader's own approval NOT published within ${WEDGE_WAIT_S}s while teammate card pending`, !lp, { lp: !!lp, status: verdict.S3_status_during_wedge });
  await hold('wedge');
  // Answer the teammate card; when does the leader's own approval surface?
  const tVote = ctx.ts();
  await A.vote(tp.requestId, pickOnce(tp));
  const lp2 = await A.waitFor(() => A.perms.find((p) => p.toolCallId?.startsWith('call_lw_S3')), 20);
  verdict.S3_leader_permission_after_teammate_vote_s = lp2 ? +(lp2.t - tVote).toFixed(3) : null;
  verdict.S3_leader_wait_total_s = lp2 ? +(lp2.t - s3Sent).toFixed(3) : null;
  check(results, 'S3: leader approval surfaces only after the teammate card is answered', !!lp2, verdict.S3_leader_permission_after_teammate_vote_s);
  if (lp2) await A.vote(lp2.requestId, pickOnce(lp2));
  await A.waitFor(() => fs.existsSync(path.join(ctx.ws, 'leader-S3.txt')), 20);
  const tmWritten = await A.waitFor(() => fs.existsSync(tmFile), 20);
  verdict.S2_file_after_vote = tmWritten ? fs.readFileSync(tmFile, 'utf8') : null;
  check(results, 'S2: teammate file written after the vote', verdict.S2_file_after_vote === 'TEAM-OK S2\n', verdict.S2_file_after_vote);
  check(results, 'S3: leader file written after its own vote', fs.existsSync(path.join(ctx.ws, 'leader-S3.txt')));
  await A.waitFor(() => readLedger(runDir).some((r) => r.who === 'leader' && r.scen === 'notified' && r.tag === 'S2'), 30);
  check(results, 'S2: teammate report after approval reached the leader model', readLedger(runDir).some((r) => r.who === 'leader' && r.scen === 'notified' && r.tag === 'S2'));
} else {
  check(results, 'control: base never publishes the teammate approval', !tp);
  check(results, 'control: teammate file never written on base', !verdict.S2_file_before_vote);
  // Same S3 prompt on base: the leader's own approval is not queued behind anything.
  await sleep(1500);
  autoLeader = false;
  const s3Sent = ctx.ts();
  await A.prompt('[[LEAD:write:S3]] Write another file while the teammate waits.');
  const lp = await A.waitFor(() => A.perms.find((p) => p.toolCallId?.startsWith('call_lw_S3')), WEDGE_WAIT_S);
  verdict.S3_leader_permission_latency_s = lp ? +(lp.t - s3Sent).toFixed(3) : null;
  check(results, 'control: on base the leader approval is published promptly (no queue holder)', !!lp, verdict.S3_leader_permission_latency_s);
  await hold('base-pending');
  if (lp) await A.vote(lp.requestId, pickOnce(lp));
  await sleep(2000);
  verdict.base_teammate_state = { file: fs.existsSync(tmFile), status: await A.status(), health: await health() };
}
clearInterval(autoTimer);
await sleep(1500);
verdict.perms = A.perms.map((p) => ({ t: p.t, requestId: p.requestId, toolCallId: p.toolCallId, title: p.title }));
verdict.turns = A.turns.map((t) => ({ t: t.t, type: t.type, stopReason: t.stopReason }));
fs.writeFileSync(path.join(runDir, 's2-result.json'), JSON.stringify({ arm, verdict, results, timeline: ctx.timeline }, null, 2));
console.log('VERDICT', JSON.stringify(verdict, null, 1));
console.log(`RESULT s2 ${arm} pass=${results.filter((r) => r.ok).length} fail=${results.filter((r) => !r.ok).length}`);
A.close();
process.exit(0);
