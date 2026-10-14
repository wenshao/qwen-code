// S4 (bot R1-4): subagent identity on the live wire vs. what the same run
// reads as after reload (GET /session/:id/transcript, the replay machine).
// Variants of the model-supplied `subagent_type`: omitted, lowercase alias of
// a built-in, mis-cased built-in, and the canonical name (control).
// usage: node s4-subagent-identity.mjs <runDir> <port> <arm>
import fs from 'node:fs';
import path from 'node:path';
import { runCtx, Sess, sleep, frameMeta, frameUpdate, check } from './lib.mjs';

const [runDir, port, arm] = process.argv.slice(2);
const ctx = runCtx(runDir, Number(port));
const results = [];
const variants = (process.env.S4_VARIANTS || 'omit,general-purpose,GENERAL-PURPOSE,explore').split(',');
const A = new Sess(ctx, 'leader');
await A.create();
await A.mode('yolo');
for (const [i, v] of variants.entries()) {
  await A.prompt(`[[LEAD:sub:${v}]] Delegate to a subagent.`);
  await A.waitTurns(i + 1, 60);
  await sleep(500);
}
await sleep(1500);

// Live: frames whose _meta.agent.kind === 'subagent', grouped by the parent
// AgentTool call id (call_sub_<variant>_<n>).
const live = {};
for (const f of A.frames) {
  const m = frameMeta(f); const u = frameUpdate(f);
  const a = m?.agent;
  if (!a || a.kind !== 'subagent') continue;
  const parent = m.parentToolCallId || u?.toolCallId || '?';
  const v = (/call_sub_(.+)_\d+$/.exec(parent) || [])[1] || parent;
  (live[v] ||= new Set()).add(a.agentName);
}
// Persisted: what core recorded as the resolved subagent (task_execution.subagentName)
// and what replay rebuilds.
const tr = await ctx.j('GET', `/session/${A.id}/transcript`, undefined, A.clientId);
fs.writeFileSync(path.join(runDir, 'transcript.json'), JSON.stringify(tr.data, null, 1));
const replay = {};
const persistedName = {};
const walk = (node, ctxCall) => {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, ctxCall)); return; }
  if (!node || typeof node !== 'object') return;
  const call = typeof node.toolCallId === 'string' ? node.toolCallId : ctxCall;
  const v = call ? (/call_sub_(.+)_\d+$/.exec(call) || [])[1] : undefined;
  if (v && node.agent && typeof node.agent === 'object' && node.agent.kind === 'subagent') (replay[v] ||= new Set()).add(node.agent.agentName);
  if (v && typeof node.subagentName === 'string') (persistedName[v] ||= new Set()).add(node.subagentName);
  for (const val of Object.values(node)) walk(val, call);
};
walk(tr.data, undefined);
const rows = variants.map((v) => ({
  subagent_type: v === 'omit' ? '(omitted)' : v,
  live: [...(live[v] || [])],
  persistedSubagentName: [...(persistedName[v] || [])],
  replay: [...(replay[v] || [])],
}));
for (const r of rows) r.agree = r.live.length > 0 && r.replay.length > 0 && JSON.stringify(r.live) === JSON.stringify(r.replay);
console.table(rows.map((r) => ({ ...r, live: r.live.join(','), persistedSubagentName: r.persistedSubagentName.join(','), replay: r.replay.join(',') })));
if (arm === 'head2') {
  check(results, 'control (canonical general-purpose): live == replay', rows.find((r) => r.subagent_type === 'general-purpose')?.agree, rows.find((r) => r.subagent_type === 'general-purpose'));
  check(results, 'R1-4 fix: omitted subagent_type -> live == replay (/root/general-purpose)', rows.find((r) => r.subagent_type === '(omitted)')?.agree, rows.find((r) => r.subagent_type === '(omitted)'));
  for (const r of rows.filter((x) => x.subagent_type === 'GENERAL-PURPOSE' || x.subagent_type === 'explore')) {
    check(results, `residual (documented): ${r.subagent_type} live still differs from replay`, r.live.length > 0 && r.replay.length > 0 && !r.agree, r);
  }
} else if (arm === 'head') {
  check(results, 'control (canonical general-purpose): live == replay', rows.find((r) => r.subagent_type === 'general-purpose')?.agree, rows.find((r) => r.subagent_type === 'general-purpose'));
  for (const r of rows.filter((x) => x.subagent_type !== 'general-purpose')) {
    check(results, `R1-4 witness (${r.subagent_type}): live identity differs from replay`, r.live.length > 0 && r.replay.length > 0 && !r.agree, r);
  }
} else {
  check(results, 'control: base frames carry no _meta.agent', Object.keys(live).length === 0 && Object.keys(replay).length === 0, { live: Object.keys(live), replay: Object.keys(replay) });
}
fs.writeFileSync(path.join(runDir, 's4-result.json'), JSON.stringify({ arm, rows, results, timeline: ctx.timeline, transcriptStatus: tr.status }, null, 2));
console.log(`RESULT s4 ${arm} pass=${results.filter((r) => r.ok).length} fail=${results.filter((r) => !r.ok).length}`);
A.close();
process.exit(0);
