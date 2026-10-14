// Summarize round-3 inflight results: node sum3.mjs <tag>
import fs from 'node:fs';
const tag = process.argv[2];
const R = '/Users/wenshao/pr13918-rig/results';
const dirs = fs.readdirSync(R).filter((d) => d.includes(`_${tag}_`)).sort((a, b) => a.split('_').slice(2).join('_').localeCompare(b.split('_').slice(2).join('_')) || a.localeCompare(b));
const t = (w) => w ? `${w.status}${w.error ? ':' + w.error : ''}${w.timeout ? '(timeout)' : ''}@${w.doneSinceHold ?? ''}` : '-';
const a = (x) => x ? `${x.admit.status}${x.admit.code ? ':' + x.admit.code : ''}/${x.turn?.status ?? '-'}` : '-';
for (const d of dirs) {
  const f = `${R}/${d}/inflight.json`;
  if (!fs.existsSync(f)) { console.log(d.padEnd(28), 'NO RESULT'); continue; }
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log(d.padEnd(26), 'text', t(r.during.textTurn.turn).padEnd(34), 'tool', t(r.during.toolTurn.turn).padEnd(34), 'after V', a(r.after.victim), 'VT', a(r.after.victimTool), 'idle', a(r.after.idle), 'holdEnd', r.holdEndedSinceHold, 'rows', JSON.stringify(r.guardRowsBefore));
}
