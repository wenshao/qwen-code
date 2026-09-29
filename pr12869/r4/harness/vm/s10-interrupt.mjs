// R10: crash the server between the committed holder clear and the final retirement.
// A MySQL trigger pauses the one UPDATE that only the final step issues (slot.active_binding_id = NULL); the product is unchanged.
import * as d from './drive.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [cmd, label] = process.argv.slice(2);
const say = (...a) => console.log(d.now(), ...a);
const root = (q) => execFileSync('docker', ['exec', 'w0e3-db', 'mysql', '-uroot', '-prootpw', d.DB, '-e', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const view = () => {
  const b = d.sql(`SELECT b.storage_id, b.binding_state, IF(b.stop_evidence_json IS NULL,'no stop proof','stop proof'), IF(l.binding_id IS NULL,'holder cleared','holder kept'),
      (SELECT COUNT(*) FROM qwen_runtime_session s WHERE s.binding_id=b.binding_id AND s.session_state <> 'RELEASED'),
      (SELECT COUNT(*) FROM qwen_runtime_binding_slot t WHERE t.active_binding_id=b.binding_id)
    FROM qwen_runtime_binding b LEFT JOIN managed_workspace_execution_lease l ON l.binding_id=b.binding_id AND l.holder_key IS NOT NULL
    ORDER BY b.storage_id, b.runtime_generation`);
  const e = d.sql(`SELECT execution_state, COUNT(*) FROM qwen_tool_execution GROUP BY execution_state ORDER BY 1`).map((r) => r.join('=')).join(' ');
  return { rows: b, text: `${b.map((r) => `${r[0]}=${r[1]}[${r[2]}, ${r[3]}, sessions ${r[4]}, slot ${r[5]}]`).join(' ')} | executions: ${e}` };
};
const paused = () => Number(d.sql(`SELECT COUNT(*) FROM information_schema.processlist WHERE state='User sleep' AND info LIKE 'UPDATE qwen_runtime_binding_slot%'`)[0][0]);
if (cmd === 'arm') {
  root('DROP TRIGGER IF EXISTS rig_pause_retirement');
  root('CREATE TRIGGER rig_pause_retirement BEFORE UPDATE ON qwen_runtime_binding_slot FOR EACH ROW SET @rig_paused = IF(NEW.active_binding_id IS NULL AND OLD.active_binding_id IS NOT NULL, SLEEP(25), 0)');
  say('triggers now:', JSON.stringify(d.sql("SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = DATABASE()")));
  say('trigger installed: the UPDATE that frees the placement slot (issued only by the final retirement) sleeps 25 s');
  const ids = d.sql(`SELECT execution_call_id, tool_call_id, execution_state FROM qwen_tool_execution ORDER BY execution_call_id`);
  fs.writeFileSync(`/rig/out/${label}-receipts-before.json`, JSON.stringify(ids));
  say(`receipt identities saved: ${ids.length}`);
} else if (cmd === 'watch') {
  const kills = Number(process.env.KILLS ?? 2);
  let last = ''; const t0 = Date.now(); let killed = 0; let dropped = false; let since = 0;
  while (Date.now() - t0 < 240000) {
    let v; try { v = view(); } catch { v = { rows: [], text: 'database not reachable yet' }; }
    if (v.text !== last) { say(v.text); last = v.text; }
    // Crash only while a retirement is really held inside MySQL by the trigger and its holder clear is already committed.
    const half = v.rows.filter((r) => r[1] === 'LOST' && r[3] === 'holder cleared');
    if (killed < kills && half.length) {
      const held = d.sql("SELECT CONCAT(STATE, ' ', TIME, ' s: ', LEFT(IFNULL(INFO,'-'), 60)) FROM performance_schema.processlist WHERE DB = DATABASE() AND COMMAND <> 'Sleep' AND ID <> CONNECTION_ID()").map((r) => r[0]);
      // the held statement must belong to the server that is running now: it has to be younger than that server
      const pidNow = execFileSync('systemctl', ['show', 'qwen-w0e3.service', '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim();
      const upNow = pidNow && pidNow !== '0' ? Number(execFileSync('sh', ['-c', `ps -o etimes= -p ${pidNow} || echo 0`], { encoding: 'utf8' }).trim() || 0) : -1;
      const own = held.filter((h) => h.includes('rig_paused')).map((h) => Number(h.match(/User sleep (\d+) s/)?.[1] ?? 1e9));
      if (own.some((t) => t < upNow)) {
        const pid = execFileSync('systemctl', ['show', 'qwen-w0e3.service', '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim();
        if (pid === '0' || !pid) { await d.sleep(300); continue; }
        const up = execFileSync('sh', ['-c', `ps -o etimes= -p ${pid} || echo 0`], { encoding: 'utf8' }).trim();
        say(`crash ${killed + 1}: server pid ${pid} (up ${up} s). ${half.map((r) => r[0]).join(',')}: holder clear committed, not retired. Held in MySQL: ${JSON.stringify(held)} -> SIGKILL`);
        process.kill(Number(pid), 'SIGKILL'); killed++;
        await d.sleep(1500);
        say('   right after the crash:', view().text);
      }
    }
    if (killed >= kills && !dropped) { root('DROP TRIGGER IF EXISTS rig_pause_retirement'); dropped = true; say('trigger dropped; the restarted server is on its own now'); }
    if (v.rows.length && v.rows.every((r) => r[1] === 'RELEASED')) break;
    await d.sleep(250);
  }
  if (!dropped) root('DROP TRIGGER IF EXISTS rig_pause_retirement');
  say('final:', view().text);
  const before = JSON.parse(fs.readFileSync(`/rig/out/${label}-receipts-before.json`, 'utf8'));
  const after = d.sql(`SELECT execution_call_id, tool_call_id, execution_state, IF(result_json IS NULL,'no result','result kept') FROM qwen_tool_execution ORDER BY execution_call_id`);
  const same = before.length === after.length && before.every((r, i) => r[0] === after[i][0] && r[1] === after[i][1]);
  const tally = {}; for (const r of after) tally[`${r[2]}/${r[3]}`] = (tally[`${r[2]}/${r[3]}`] ?? 0) + 1;
  say(`receipts: ${before.length} before, ${after.length} after, identities unchanged=${same}; ${JSON.stringify(tally)}`);
  say('server starts in this boot:', execFileSync('sh', ['-c', `grep -a "^=== " /var/log/qwen-w0e3/server.log | grep -c "$(cat /proc/sys/kernel/random/boot_id)"`], { encoding: 'utf8' }).trim(),
    '| worker processes now:', d.workers().split('\n').filter((l) => l.includes('managed-runtime-worker')).length);
}
