// S7 (doudouOUC inline Critical at 309106ee): a teammate approval is pending
// when the leader deletes the team (Config.setTeamManager(null) -> binding
// abort). Is the host-side request retired (permission_resolved, removed from
// /status pendingInteractions), or does a stale card stay pending?
// usage: node s7-team-delete.mjs <runDir> <port> <arm> [holdSeconds]
import fs from 'node:fs';
import path from 'node:path';
import { runCtx, Sess, sleep, readLedger, check } from './lib.mjs';

const [runDir, port, arm, holdArg] = process.argv.slice(2);
const HOLD_S = Number(holdArg || 0);
const ctx = runCtx(runDir, Number(port));
const results = [];
const v = {};
const A = new Sess(ctx, 'leader');
await A.create();
await A.mode('default');
const isTm = (p) => String(p.toolCallId || '').startsWith('teammate-');
const pickOnce = (p) => (p.options || []).find((o) => o.optionId === 'proceed_once')?.optionId ?? p.options?.[0]?.optionId;
let auto = true; const seen = new Set();
const timer = setInterval(async () => { if (!auto) return; for (const p of A.perms) { if (isTm(p) || seen.has(p.requestId)) continue; seen.add(p.requestId); await A.vote(p.requestId, pickOnce(p)); } }, 150);
const pendingIds = async () => ((await A.status()).pendingInteractions || []).map((x) => ({ requestId: x.requestId, title: x.action?.title }));

await A.prompt('[[LEAD:team:S7:write]] Create a team; the teammate writes a file.');
const tp = await A.waitFor(() => A.perms.find(isTm), 30);
await A.waitFor(() => A.turns.length >= 1, 20); await sleep(1500);
v.pendingBeforeDelete = await pendingIds();
check(results, 'setup: teammate approval pending before team_delete', !!tp && v.pendingBeforeDelete.some((x) => x.requestId === tp.requestId), v.pendingBeforeDelete);

const turnsBefore = A.turns.length;
await A.prompt('[[LEAD:del:S7]] Delete the team.');
await A.waitTurns(turnsBefore + 1, 30);
v.deleteResult = readLedger(runDir).filter((r) => r.who === 'leader' && r.scen === 'del').map((r) => r.reply).pop();
await sleep(5000);
v.pendingAfterDelete = await pendingIds();
v.resolvedForTeammate = A.resolved.filter((r) => r.requestId === tp.requestId).map((r) => ({ t: r.t, raw: r.raw }));
v.health = (await ctx.j('GET', '/health?deep=1')).data?.pendingPermissions;
v.teamDirExists = fs.existsSync(path.join(runDir, 'qwen-home/teams/t-s7'));
console.log('after delete', JSON.stringify({ deleteResult: v.deleteResult, pendingAfterDelete: v.pendingAfterDelete, resolvedForTeammate: v.resolvedForTeammate, health: v.health, teamDirExists: v.teamDirExists }));
check(results, 'team_delete ran', /LEADER-DELETED/.test(v.deleteResult || ''), v.deleteResult);
const stale = v.pendingAfterDelete.some((x) => x.requestId === tp.requestId) && v.resolvedForTeammate.length === 0;
v.stale = stale;
check(results, `observation: deleted team's approval still pending on the host (no permission_resolved) = ${stale}`, true, { stale });
if (HOLD_S) {
  fs.writeFileSync(path.join(runDir, 'HOLD'), JSON.stringify({ label: 'after-delete', sessionId: A.id, token: ctx.token, port: ctx.port }));
  const s0 = Date.now(); while (!fs.existsSync(path.join(runDir, 'RELEASE')) && Date.now() - s0 < HOLD_S * 1000) await sleep(250);
}
// Variant: leave the dead card alone and let the leader ask for its own
// approval; which card does a single-card client (Web Shell) show?
if (stale && process.env.S7_NOVOTE) {
  auto = false;
  await A.prompt('[[LEAD:write:S7c]] Write a file while the dead card is still pending.');
  const lp = await A.waitFor(() => A.perms.find((p) => p.toolCallId?.startsWith('call_lw_S7c')), 20);
  v.novote = { leaderPublished: !!lp, pending: await pendingIds() };
  check(results, 'NOVOTE: leader approval is published while the dead card is pending', !!lp, v.novote);
  fs.writeFileSync(path.join(runDir, 'HOLD2'), JSON.stringify({ sessionId: A.id }));
  const s1 = Date.now(); while (!fs.existsSync(path.join(runDir, 'RELEASE2')) && Date.now() - s1 < 120000) await sleep(250);
  if (lp) await A.vote(lp.requestId, pickOnce(lp));
  await sleep(1000);
}
// Vote on the stale card: does anything run?
if (stale) {
  const r = await ctx.j('POST', `/session/${A.id}/permission/${tp.requestId}`, { outcome: { outcome: 'selected', optionId: pickOnce(tp) } }, A.clientId);
  v.staleVote = { status: r.status, body: r.data };
  await sleep(3000);
  v.fileWrittenAfterStaleVote = fs.existsSync(path.join(ctx.ws, 'tm-S7.txt'));
  v.pendingAfterStaleVote = await pendingIds();
  check(results, 'stale vote does not run the deleted teammate tool', !v.fileWrittenAfterStaleVote, v.staleVote);
}
// A fresh leader approval still works with the default cap (64).
auto = false;
await A.prompt('[[LEAD:write:S7b]] Write a file after the delete.');
const lp = await A.waitFor(() => A.perms.find((p) => p.toolCallId?.startsWith('call_lw_S7b')), 20);
check(results, 'fresh leader approval after delete is published (default cap)', !!lp, lp?.toolCallId);
if (lp) await A.vote(lp.requestId, pickOnce(lp));
clearInterval(timer);
await sleep(1500);
fs.writeFileSync(path.join(runDir, 's7-result.json'), JSON.stringify({ arm, v, results, timeline: ctx.timeline }, null, 2));
console.log('V', JSON.stringify(v, null, 1));
console.log(`RESULT s7 ${arm} pass=${results.filter((r) => r.ok).length} fail=${results.filter((r) => !r.ok).length}`);
A.close();
process.exit(0);
