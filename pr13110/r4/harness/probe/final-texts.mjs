// Print the model's last assistant text (non-thought parts) for Sessions whose messages were written in a time window.
// usage: DB=.. node final-texts.mjs <from> <to> <cwd-filter>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('/rig/rig.env', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const q = (s) => execFileSync(env.MYSQL, ['-uroot', `-p${env.DBPASS}`, '-h127.0.0.1', `-P${env.DBPORT}`, '-N', '-B', '-r', process.env.DB, '-e', s], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
const [from, to, filter] = process.argv.slice(2);
const ids = q(`SELECT DISTINCT session_id FROM qwen_managed_session_resource WHERE kind='managed-message' AND created_at BETWEEN '${from}' AND '${to}'`).trim().split('\n').filter(Boolean);
for (const id of ids) {
  const raw = q(`SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE session_id='${id}' AND kind='managed-message' AND CAST(inline_bytes AS CHAR) LIKE '%"type":"assistant"%' ORDER BY created_at DESC LIMIT 1`).trim();
  if (!raw) continue;
  const o = JSON.parse(raw);
  if (!String(o.cwd).includes(filter)) continue;
  const text = (o.message?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join(' ');
  console.log(`${id.slice(0, 8)} ${o.timestamp}: ${text.replace(/\s+/g, ' ').slice(0, 900)}`);
}
