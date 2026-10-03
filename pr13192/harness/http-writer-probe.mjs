// Raw HTTP writer probe: acquire, same-owner reacquire, renew, live-owner
// conflict, takeover after the database lease expires. Every JSON deadline is
// compared with the persisted SQL Unix epoch and with this process's clock.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [, , base, label, container, db, outFile] = process.argv;
if (!outFile) throw new Error('usage: base label container db outFile');
const tenant = 'tz-probe';
const session = `s-${label}-${Date.now()}`;
const workspace = 'ws-tz';
const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);

const client = (() => {
  try {
    execFileSync('docker', ['--context', 'colima', 'exec', container, 'sh', '-c', 'command -v mysql'], { stdio: 'ignore' });
    return 'mysql';
  } catch {
    return 'mariadb';
  }
})();

function sql(query) {
  return execFileSync('docker', ['--context', 'colima', 'exec', container, client,
    '-uroot', '-ppr13192pw', '-N', '-B', db, '-e', query], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

const where = `tenant_id = '${tenant}' AND session_id = '${session}'`;
function persisted() {
  const [epoch, remaining, gen] = sql(`SELECT FLOOR(UNIX_TIMESTAMP(writer_lease_until) * 1000),`
    + ` TIMESTAMPDIFF(MICROSECOND, CURRENT_TIMESTAMP(6), writer_lease_until),`
    + ` writer_generation, writer_lease_until FROM qwen_managed_session_journal_head WHERE ${where}`).split('\t');
  return { sqlEpochMs: Number(epoch), sqlRemainingMs: Math.round(Number(remaining) / 1000), generation: Number(gen) };
}

async function call(op, token, body) {
  const started = Date.now();
  const response = await fetch(`${base}/internal/managed-session-store/v1/sessions/${session}/writers:${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Qwen-Tenant-Id': tenant, 'X-Qwen-Managed-Writer-Token': token },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: response.status, json, clientNowMs: started };
}

const rows = [];
function record(step, result, expectStatus) {
  const row = { step, status: result.status, expectStatus };
  if (result.status === 200) {
    const p = persisted();
    Object.assign(row, {
      generation: result.json.writerGeneration,
      replayed: result.json.replayed,
      leaseUntil: result.json.leaseUntil,
      sqlEpochMs: p.sqlEpochMs,
      jsonMinusSqlMs: result.json.leaseUntil - p.sqlEpochMs,
      clientRemainingMs: result.json.leaseUntil - result.clientNowMs,
      sqlRemainingMs: p.sqlRemainingMs,
      subsecondMs: result.json.leaseUntil % 1000,
    });
  } else {
    row.code = result.json.code ?? result.json.error ?? result.json.raw;
  }
  rows.push(row);
}

record('acquire A (60s)', await call('acquire', TOKEN_A, { workspaceId: workspace, writerId: 'writer-a', leaseMillis: 60000 }), 200);
record('reacquire A (60s)', await call('acquire', TOKEN_A, { workspaceId: workspace, writerId: 'writer-a', leaseMillis: 60000 }), 200);
record('renew A (90s)', await call('renew', TOKEN_A, { workspaceId: workspace, writerId: 'writer-a', writerGeneration: 1, leaseMillis: 90000 }), 200);
record('acquire B while A live', await call('acquire', TOKEN_B, { workspaceId: workspace, writerId: 'writer-b', leaseMillis: 60000 }), 409);
sql(`UPDATE qwen_managed_session_journal_head SET writer_lease_until = TIMESTAMPADD(SECOND, -1, CURRENT_TIMESTAMP(6)) WHERE ${where}`);
record('takeover B after expiry (60s)', await call('acquire', TOKEN_B, { workspaceId: workspace, writerId: 'writer-b', leaseMillis: 60000 }), 200);

const dbZone = sql('SELECT CONCAT(@@system_time_zone, "/", @@session.time_zone)');
const out = { label, base, session, dbZone, rows };
writeFileSync(outFile, JSON.stringify(out, null, 2));
const ok = rows.every((r) => r.status === r.expectStatus && (r.status !== 200 || (r.jsonMinusSqlMs === 0 && r.sqlRemainingMs > 0)));
console.log(JSON.stringify(out));
console.log(`PROBE ${label} ${ok ? 'PASS' : 'FAIL'}`);
