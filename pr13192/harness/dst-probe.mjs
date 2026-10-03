// The database clock is frozen at FROZEN (Unix seconds) for every pooled
// connection. Acquire a 60 s writer lease and compare the JSON deadline and
// the persisted DATETIME against that frozen database time.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [, , base, label, container, db, frozenText, outFile] = process.argv;
const frozen = Number(frozenText);
const session = `dst-${label}-${Date.now()}`;
const response = await fetch(`${base}/internal/managed-session-store/v1/sessions/${session}/writers:acquire`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Qwen-Tenant-Id': 'dst-probe',
    'X-Qwen-Managed-Writer-Token': 'd'.repeat(32) },
  body: JSON.stringify({ workspaceId: 'ws-dst', writerId: 'writer-dst', leaseMillis: 60000 }),
});
const bodyText = await response.text();
if (!response.ok) { const out = { label, frozenUtc: new Date(frozen * 1000).toISOString(), status: response.status, body: JSON.parse(bodyText) }; writeFileSync(outFile, JSON.stringify(out, null, 2)); console.log(JSON.stringify(out)); process.exit(0); }
const json = JSON.parse(bodyText);
const [stored, storedEpoch] = execFileSync('docker', ['--context', 'colima', 'exec', container, 'mysql',
  '-uroot', '-ppr13192pw', '-N', '-B', db, '-e',
  `SELECT writer_lease_until, UNIX_TIMESTAMP(writer_lease_until) FROM qwen_managed_session_journal_head`
  + ` WHERE tenant_id = 'dst-probe' AND session_id = '${session}'`],
{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\t');
const out = {
  label, frozenUtc: new Date(frozen * 1000).toISOString(), status: response.status,
  storedDatetime: stored,
  persistedLeaseSeconds: Number(storedEpoch) - frozen,
  jsonLeaseUntilUtc: new Date(json.leaseUntil).toISOString(),
  jsonMinusFrozenSeconds: (json.leaseUntil - frozen * 1000) / 1000,
  jsonMinusPersistedMs: json.leaseUntil - Math.floor(Number(storedEpoch) * 1000),
};
writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
