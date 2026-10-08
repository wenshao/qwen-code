// Concise wire listing for the PR 13572 rig.
//   node wire.mjs tap|proxy <since ISO or HH:MM:SS (UTC)> [until] [--full]
// tap   = Spring -> Harness (harnesstap.jsonl), proxy = adapter -> control plane (cpproxy.jsonl)
import { readFileSync } from 'node:fs';

const [, , which, since, until, ...flags] = process.argv;
const full = flags.includes('--full') || until === '--full';
const file = `/Users/wenshao/git/pr13572-rig/mail/${which === 'tap' ? 'harnesstap' : 'cpproxy'}.jsonl`;
const day = new Date().toISOString().slice(0, 10);
const iso = (v) => (v && v !== '--full' ? (v.includes('T') ? v : `${day}T${v}`) : undefined);
const from = iso(since);
const to = iso(until);
for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
  const j = JSON.parse(line);
  if (from && j.t < from) continue;
  if (to && j.t > to) continue;
  const t = j.t.slice(11, 23);
  if (which === 'tap') {
    const s = j.sent ?? {};
    const a = j.answer ?? {};
    const what = s.kind ? `${s.kind}${s.deliveryId ? ' ' + s.deliveryId.slice(-24) : ''}${s.platformEventId ? ' ev=' + s.platformEventId : ''}` : '';
    const extra = full ? ` sent=${JSON.stringify(s).slice(0, 400)}` : s.scope ? ` scope=${JSON.stringify(s.scope).slice(0, 120)}` : s.passiveManagedRuntimeRecovery !== undefined ? ` passive=${s.passiveManagedRuntimeRecovery}` : '';
    console.log(`${t} ${j.method} ${j.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, (m) => m.slice(0, 8))} ${j.status} ${what}${a.code ? ' code=' + a.code : ''}${a.state ? ' state=' + a.state : ''}${extra}`);
  } else {
    const a = j.answer && typeof j.answer === 'object' ? j.answer : {};
    const code = a.code ?? a.error?.code;
    console.log(`${t} ${j.method} ${j.path.replace(/^rigmail/, '')} ${j.status ?? ''} ${j.fate}${j.event ? ' ev=' + j.event : ''}${j.receipt ? ' ' + JSON.stringify(j.receipt).slice(0, 110) : ''}${code ? ' code=' + code : ''}${a.state ? ' state=' + a.state : ''}${full ? ' ' + JSON.stringify(j.answer).slice(0, 300) : ''}`);
  }
}
