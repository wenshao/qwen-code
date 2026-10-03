// Applies exactly one mutant to a worktree (or restores it). Every anchor must
// match exactly once, otherwise the script fails without writing.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [, , worktree, id] = process.argv;
const store = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/';
const MSS = store + 'ManagedSessionStore.java';
const TPS = store + 'ToolPublicationStore.java';

export const MUTANTS = {
  M1: { file: MSS, what: 'first acquire returns JDBC epoch',
    from: 'return new WriterGrant(1, databaseEpochMillis(initialLeaseUntil), 0, 0,',
    to: 'return new WriterGrant(1, initialLeaseUntil.getTime(), 0, 0,' },
  M2: { file: MSS, what: 'takeover returns JDBC epoch',
    from: 'return new WriterGrant(generation, databaseEpochMillis(leaseUntil),',
    to: 'return new WriterGrant(generation, leaseUntil.getTime(),' },
  M3: { file: MSS, what: 'reacquire/renew grant() returns JDBC epoch',
    from: 'return new WriterGrant(head.writerGeneration(), databaseEpochMillis(leaseUntil),',
    to: 'return new WriterGrant(head.writerGeneration(), leaseUntil.getTime(),' },
  M4: { file: MSS, what: 'PublicationWriter.now uses JDBC epoch',
    from: 'return new PublicationWriter(databaseEpochMillis(now), databaseEpochMillis(head.writerLeaseUntil()),',
    to: 'return new PublicationWriter(now.getTime(), databaseEpochMillis(head.writerLeaseUntil()),' },
  M5: { file: MSS, what: 'PublicationWriter.leaseUntil uses JDBC epoch',
    from: 'return new PublicationWriter(databaseEpochMillis(now), databaseEpochMillis(head.writerLeaseUntil()),',
    to: 'return new PublicationWriter(databaseEpochMillis(now), head.writerLeaseUntil().getTime(),' },
  M6: { file: MSS, what: 'databaseEpochMillis drops the subsecond fraction',
    from: '                Long.class, wholeSeconds(timestamp)) * 1_000\n                + timestamp.getNanos() / 1_000_000;',
    to: '                Long.class, wholeSeconds(timestamp)) * 1_000;' },
  M7: { file: TPS, what: 'dispatch clock back to JDBC CURRENT_TIMESTAMP epoch',
    from: 'long nowEpoch = ToolPublicationRetentionStore.now(jdbc);',
    to: 'long nowEpoch = jdbc.queryForObject("SELECT CURRENT_TIMESTAMP(6)", java.sql.Timestamp.class).getTime();' },
  M8: { file: TPS, what: 'writer_live always 1',
    from: 'THEN 1 ELSE 0 END AS writer_live,',
    to: 'THEN 1 ELSE 1 END AS writer_live,' },
  M9: { file: TPS, what: 'dispatch ignores activation expiry',
    from: '                        && activation.path("expiresAt").asLong() > nowEpoch,\n                        "Original activation is fenced");',
    to: '                        && true,\n                        "Original activation is fenced");' },
};

if (id === 'restore') {
  execFileSync('git', ['-C', worktree, 'checkout', '--', MSS, TPS]);
  console.log('restored');
} else if (id) {
  const m = MUTANTS[id];
  if (!m) throw new Error(`unknown mutant ${id}`);
  const path = `${worktree}/${m.file}`;
  const text = readFileSync(path, 'utf8');
  const count = text.split(m.from).length - 1;
  if (count !== 1) throw new Error(`${id}: anchor matched ${count} times`);
  writeFileSync(path, text.replace(m.from, m.to));
  const diff = execFileSync('git', ['-C', worktree, 'diff', '--stat'], { encoding: 'utf8' });
  console.log(`${id} applied: ${m.what}\n${diff}`);
}
