// node show.mjs out/runs/<label>.json [--no-sse-chunks]
import fs from 'node:fs';

const file = process.argv[2];
const quietChunks = process.argv.includes('--no-sse-chunks');
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const T0 = d.T0;
const r = (t) => ((t - T0) / 1000).toFixed(2).padStart(6);
const short = (id) => (id ? String(id).replace(/^.*########notification/, 'notif:').replace(/^([0-9a-f]{8})-.*$/, '$1').slice(0, 16) : '');
const rows = [];
for (const a of d.actions) rows.push([a.t, 'ACT ', a.m + (a.body ? ' ' + JSON.stringify(a.body).slice(0, 160) : '')]);
for (const m of d.mock) {
  const what =
    m.kind === 'sub'
      ? `sub ${m.sub?.[0]}`
      : m.kind === 'parent'
        ? `parent[${m.scenario}] step=${m.step} fresh=${JSON.stringify(m.freshRoles)} notifs=${JSON.stringify(m.notifs)} steer=${m.steer.length}`
        : `other`;
  rows.push([m.at, 'MOCK', `#${m.seq} ${what} -> ${JSON.stringify(m.reply).slice(0, 70)}${m.aborted ? ` ABORTED@${r(m.abortedAt)}` : ''}${m.endedAt ? ` end@${r(m.endedAt)}` : ''}`]);
}
for (const e of d.sse) {
  if (quietChunks && e.su === 'agent_message_chunk' && !e.source) continue;
  if (e.su === 'tool_call_update' && quietChunks) continue;
  const bits = [e.type, e.su, e.source && `src=${e.source}`, e.promptId && `pid=${short(e.promptId)}`, e.bgTurn && `bg=${short(e.bgTurn)}`, e.stopReason && `stop=${e.stopReason}`, e.status && `st=${e.status}`, e.text && `"${e.text.slice(0, 60)}"`].filter(Boolean);
  rows.push([e.t, 'SSE ', bits.join(' ')]);
}
for (const p of d.polls) {
  const { t, ...rest } = p;
  rows.push([t, 'POLL', Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(' ')]);
}
rows.sort((a, b) => a[0] - b[0]);
console.log(`# ${d.label} sid=${d.sid}`);
for (const [t, k, s] of rows) console.log(`${r(t)} ${k} ${s}`);
console.log('turn-index:', JSON.stringify(d.turnIndex)?.slice(0, 400));
console.log('pending:', JSON.stringify(d.pendingPrompts)?.slice(0, 200));
