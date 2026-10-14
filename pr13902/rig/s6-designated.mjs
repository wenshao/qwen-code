// S6 (triage stage-2/3 question): under `policy.permissionStrategy=designated`
// only the originating client may answer a permission. Compare a leader tool
// approval (originated by client A) with a teammate approval (session-scoped,
// no originator) when a SECOND client B votes.
// usage: node s6-designated.mjs <runDir> <port>
import fs from 'node:fs';
import path from 'node:path';
import { runCtx, Sess, sleep, check } from './lib.mjs';

const [runDir, port] = process.argv.slice(2);
const ctx = runCtx(runDir, Number(port));
const results = [];
const v = {};
const A = new Sess(ctx, 'clientA');
await A.create();
await A.mode('default');
// Second client attaches to the same live session.
const att = await ctx.j('POST', `/session/${A.id}/load`, { cwd: ctx.ws });
v.attachB = { status: att.status, attached: att.data?.attached, clientId: att.data?.clientId };
const B = new Sess(ctx, 'clientB');
B.attachAs(A.id, att.data?.clientId);
ctx.mark('client B attached', v.attachB);
await sleep(500);
v.policy = (await ctx.j('GET', '/health?deep=1')).data?.permissionPolicy ?? null;
const pickOnce = (p) => (p.options || []).find((o) => o.optionId === 'proceed_once')?.optionId ?? p.options?.[0]?.optionId;

// Leader's own approval: B votes first (should be refused), then A.
await A.prompt('[[LEAD:write:D1]] Write a file.');
const lp = await A.waitFor(() => A.perms.find((p) => p.toolCallId?.startsWith('call_lw_D1')), 20);
v.leaderPermOriginator = lp?.raw?.originatorClientId ?? A.frames.find((f) => f.type === 'permission_request' && f.data?.data?.toolCall?.toolCallId === lp?.toolCallId)?.data?.originatorClientId ?? null;
const bVoteLeader = await ctx.j('POST', `/session/${A.id}/permission/${lp.requestId}`, { outcome: { outcome: 'selected', optionId: pickOnce(lp) } }, B.clientId);
v.leader_B_vote = { status: bVoteLeader.status, body: bVoteLeader.data };
await sleep(800);
const leaderFileAfterB = fs.existsSync(path.join(ctx.ws, 'leader-D1.txt'));
const aVoteLeader = await A.vote(lp.requestId, pickOnce(lp));
v.leader_A_vote = { status: aVoteLeader.status };
await A.waitFor(() => fs.existsSync(path.join(ctx.ws, 'leader-D1.txt')), 15);
check(results, 'designated: B cannot answer the leader approval (originated by A)', bVoteLeader.status >= 400 && !leaderFileAfterB, v.leader_B_vote);
check(results, 'designated: A answers the leader approval', aVoteLeader.status < 300 && fs.existsSync(path.join(ctx.ws, 'leader-D1.txt')), v.leader_A_vote);
await A.waitTurns(1, 20);

// Teammate approval: the setup tools are the leader's (A answers them); the
// teammate card is voted by B only.
let auto = true; const seen = new Set();
const timer = setInterval(async () => { if (!auto) return; for (const p of A.perms) { if (String(p.toolCallId).startsWith('teammate-') || seen.has(p.requestId)) continue; seen.add(p.requestId); await A.vote(p.requestId, pickOnce(p)); } }, 150);
await A.prompt('[[LEAD:team:D2:write]] Create a team; the teammate writes a file.');
const tp = await A.waitFor(() => A.perms.find((p) => String(p.toolCallId).startsWith('teammate-')), 30);
auto = false; clearInterval(timer);
v.teammatePermOriginator = A.frames.find((f) => f.type === 'permission_request' && f.data?.data?.toolCall?.toolCallId === tp?.toolCallId)?.data?.originatorClientId ?? null;
const bVoteTm = await ctx.j('POST', `/session/${A.id}/permission/${tp.requestId}`, { outcome: { outcome: 'selected', optionId: pickOnce(tp) } }, B.clientId);
v.teammate_B_vote = { status: bVoteTm.status, body: bVoteTm.data };
const tmWritten = await A.waitFor(() => fs.existsSync(path.join(ctx.ws, 'tm-D2.txt')), 15);
v.teammateFileWrittenAfterBVote = !!tmWritten;
check(results, 'observation: teammate approval carries no originatorClientId', v.teammatePermOriginator === null || v.teammatePermOriginator === undefined, v.teammatePermOriginator);
check(results, 'observation: under designated, non-originating client B approves the teammate tool', bVoteTm.status < 300 && v.teammateFileWrittenAfterBVote, v.teammate_B_vote);
console.log('V', JSON.stringify(v, null, 1));
fs.writeFileSync(path.join(runDir, 's6-result.json'), JSON.stringify({ v, results, timeline: ctx.timeline }, null, 2));
console.log(`RESULT s6 pass=${results.filter((r) => r.ok).length} fail=${results.filter((r) => !r.ok).length}`);
A.close(); B.close();
process.exit(0);
