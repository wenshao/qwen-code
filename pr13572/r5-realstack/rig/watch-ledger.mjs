// Ledger transition recorder for the PR 13572 rig: polls the V47 delivery
// ledger, the V47 ingress rows and the route Sessions every second and
// appends each change, timestamped, to runs/<db>/ledger.jsonl.
//   node watch-ledger.mjs <db>
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13572-rig';
const db = process.argv[2];
const OUT = `${RIG}/runs/${db}/ledger.jsonl`;
const sql = (q) =>
  execFileSync(`${RIG}/mysql.sh`, ['sql', '-N', '-B', '-e', q, db], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'));
const seen = new Map();
const note = (key, value) => {
  if (seen.get(key) === value) return;
  seen.set(key, value);
  appendFileSync(OUT, JSON.stringify({ t: new Date().toISOString(), key, value }) + '\n');
};
for (;;) {
  try {
    for (const [id, state, receipt] of sql('select delivery_id, state, coalesce(provider_receipt,"") from qwen_managed_channel_delivery'))
      note(`delivery ${id}`, `${state}${receipt ? ' ' + receipt : ''}`);
    for (const [ev, state, sess] of sql('select platform_event_id, state, left(session_id,8) from qwen_managed_channel_route'))
      note(`ingress ${ev}`, `${state} ${sess}`);
    for (const [sess, status] of sql('select session_id, status from managed_agent_session'))
      note(`session ${sess}`, status);
  } catch (error) {
    note('error', String(error).slice(0, 200));
  }
  await new Promise((r) => setTimeout(r, 1000));
}
