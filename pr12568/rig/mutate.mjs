import fs from 'node:fs';
const root = process.argv[2];
const SF = 'packages/cli/src/commands/review/lib/same-file.ts';
const J = 'packages/cli/src/serve/conversations/standalone-deletion-journal.ts';
export const M = {
  M1_samefile_no_bigint: [SF, 'return statSync(path, { bigint: true });', 'return statSync(path) as any;'],
  M2_samefile_no_zero_guard: [SF, 'if (leftStat.ino !== 0n && rightStat.ino !== 0n) {', 'if (true) {'],
  M3_journal_lstat_no_bigint: [J, 'stat = await fs.lstat(directory, { bigint: true });', 'stat = (await fs.lstat(directory)) as any;'],
  M4_journal_open_stat_no_bigint: [J, 'const opened = await handle.stat({ bigint: true });', 'const opened = (await handle.stat()) as any;'],
  M5_journal_sync_stat_no_bigint: [J, 'const opened = await directory.handle.stat({ bigint: true });', 'const opened = (await directory.handle.stat()) as any;'],
  M6_verifiable_always: [J, 'inodeVerifiable: stat.ino !== 0n,', 'inodeVerifiable: true,'],
  M7_verifiable_never: [J, 'inodeVerifiable: stat.ino !== 0n,', 'inodeVerifiable: false,'],
  M8_mode_check_off: [J, '(stat.mode & 0o777n) !== 0o700n', 'false'],
  M9_uid_check_off: [J, 'stat.uid !== BigInt(process.getuid())', 'false'],
};
const name = process.argv[3];
const [file, from, to] = M[name];
const p = `${root}/${file}`;
const src = fs.readFileSync(p, 'utf8');
const n = src.split(from).length - 1;
if (n !== 1) { console.error(`MUTATION ${name} matched ${n}x`); process.exit(1); }
fs.writeFileSync(p, src.replace(from, to));
console.log(`applied ${name}`);
