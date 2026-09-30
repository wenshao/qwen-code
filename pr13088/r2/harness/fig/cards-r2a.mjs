// Round 2 evidence cards (PR head c21efbdfa1). Values from out/r3 and out/e2e-r3.
import fs from 'node:fs';
const dir = new URL('./cards-r2/', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
const ENV = 'Ubuntu 24.04 VM (kernel 6.8, ext4), MySQL 8.4.11, PR-head fat jar as a systemd service with durable local workers, packaged Hosted Harness and workers';
const card = (name, c) => fs.writeFileSync(`${dir}${name}.json`, JSON.stringify(c, null, 1));

card('r2-01-restore-from-backup-refused', {
  title: 'F1: delete + restore from a backup at the same pathname — accepted at 7c54aa78, refused at c21efbdf',
  subtitle: `${ENV}. Same script in both rounds: register, three tool Turns, stop, rm -rf the root, tar -x a backup taken after Turn 1 (the marker is inside the backup), start.`,
  blocks: [
    { label: 'storage a: restored immediately, ext4 hands the freed inode number out again', table: [
      ['', '7c54aa78 (round 1)', 'c21efbdf (this round)'],
      ['root before -> after the restore', 'dev=64769 ino=788592 -> dev=64769 ino=788592', 'dev=64769 ino=788592 -> dev=64769 ino=788592'],
      ['birth time of the root', 'changed (not part of the identity)', 'changed; stored as mount_birth_time and in marker v2'],
      ['inspect', '-- identity=match marker=match', '++ identity=mismatch marker=match'],
      ['cold load', '200', '200'],
      ['next Turn: read data.txt', '-- turn_complete, returns "version-1"\n   (the model history still says version-2)', '++ turn_error, runtimes:warm 409 workspace_unavailable'],
      ['next Turn: write a file', '-- written into the restored copy', '++ warm 409 workspace_unavailable, nothing written'],
    ] },
    { label: 'storage b (control): an unrelated directory is created between the delete and the restore, so the inode number differs', pre: '++ refused in both rounds: identity=mismatch marker=match, warm 409 workspace_unavailable' },
    { label: 'unit-level negative control on an isolated copy of c21efbdf: only `!identity.birthTime().equals(row.birthTime())` removed', pre: [
      '++ 2 of 262 unit tests fail: WorkspaceStorageGuardTest.rejectsDeletedAndRestoredRootWhenInodeIsReusedButBirthTimeChanges',
      '++                           WorkspaceStorageGuardTest.refusesMissingPersistedBirthTime'].join('\n') },
  ],
});

card('r2-02-birth-time-identity', {
  title: 'The birth-time identity on real file systems (c21efbdf)',
  subtitle: `${ENV}. Maintenance entry run from the shipped fat jar; OpenJDK 21.0.9.`,
  blocks: [
    { label: 'an unchanged registered root across ordinary mtime changes (one tool Turn after each)', table: [
      ['change made to the root directory', 'birth time (UTC)', 'mtime', 'inspect', 'next tool Turn'],
      ['create a file in the root', '14:59:38.795469150', '14:59:49.157', '++ identity=match marker=match', '++ turn_complete'],
      ['delete it', 'same', '14:59:51.426', '++ identity=match marker=match', '++ turn_complete'],
      ['touch the root', 'same', '14:59:53.928', '++ identity=match marker=match', '++ turn_complete'],
      ['chmod the root (ctime only)', 'same', 'unchanged', '++ identity=match marker=match', '++ turn_complete'],
      ['mkdir + rmdir in the root', 'same', '15:00:00.625', '++ identity=match marker=match', '++ turn_complete'],
      ['mtime set one year back', 'same', '2025-09-30 …', '++ identity=match marker=match', '++ turn_complete'],
    ] },
    { label: 'file systems: statx birth time, what OpenJDK 21 reports, and registration', table: [
      ['root on', 'statx birth time (UTC)', 'JDK creationTime vs lastModifiedTime', 'register'],
      ['ext4 directory (root disk)', '2026-09-30 14:59:38.795469150', 'differs', '++ verified'],
      ['ext4 image on a loop device', '2026-09-30 14:58:52.000000000', 'differs', '++ verified'],
      ['ext4 with 128-byte inodes', '<none>', 'creationTime == lastModifiedTime (JDK fallback)', '++ REFUSED'],
      ['tmpfs', '2026-09-30 14:58:52.921469128', 'differs', '++ verified'],
      ['virtiofs host share', '2026-09-30 14:58:52.600913771', 'differs', '++ verified'],
    ] },
    { label: 'marker v2 and the SQL row', pre: [
      '++ marker keys: version=2, tenantId, storageId, root, hostId, device, inode, birthTime, registrationId (282 bytes)',
      '++ marker birthTime = SQL mount_birth_time = 2026-09-30T14:59:38.795469150Z (statx: …38.795469150, nanoseconds kept)',
      '++ hostId (64 hex) == HMAC-SHA256(key = machine-id, "Qwen-Code/verified-workspace/v2"); the raw machine-id is in neither the marker nor the row',
      '++ the same storage inspected with another machine-id (private mount namespace): identity=mismatch'].join('\n') },
    { label: 'a freshly prepared root: `mkdir -p <root>/project` (40 fresh roots per run, CONFIG_HZ=1000)', pre: [
      '!! birth time == mtime to the nanosecond in 35 of 40 and in 39 of 40 roots; 0 of 40 when 20 ms pass before the first child is created',
      '!! register on such a root: exit 1, "Workspace execution authority is unavailable." (the same text as every other refusal); no SQL row, no marker',
      '++ after `touch <root>` (what the README says to do) the same operation UUID registers',
      '== after registration: `touch -d "$(stat -c %w root)" root` -> identity=mismatch, warm 409; `touch root` -> match again'].join('\n') },
    { note: 'The refusal of a birth time equal to mtime is documented and fails closed. On this host it is what an operator meets first, because the usual way to prepare a root lands both timestamps in one timer tick, and the maintenance entry does not say which check refused.' },
  ],
});

card('r2-03-storage-layout-and-marker', {
  title: 'F2: the marker and the agent\'s own tools under the layout the README now requires (c21efbdf)',
  subtitle: `${ENV}; option on. Storage root /srv/w1a/c is not a Git repository; the Session cwd is the child project/ directory, which is one.`,
  blocks: [
    { label: 'Shell Session, cwd_relative "project"', table: [
      ['what the agent does', 'result', 'marker', 'inspect'],
      ['git stash -u (untracked build output and notes)', 'turn_complete', '++ present', '++ identity=match marker=match'],
      ['git clean -fdx', 'turn_complete, "Removing build/ Removing notes.tmp"', '++ present', '++ identity=match marker=match'],
      ['next Shell Turn', '++ turn_complete', '', ''],
      ['ls -a ..', 'turn_complete: ". .. .qwen-managed-storage.json project"', 'visible', ''],
      ['cat ../.qwen-managed-storage.json', 'turn_complete: the JSON is sent to the model', 'readable', ''],
      ['rm -f ../.qwen-managed-storage.json', 'turn_complete', '-- ABSENT', '-- marker=unavailable'],
      ['next Shell Turn / a new Session on the same storage', '-- turn_error, warm 409 workspace_unavailable', '', ''],
    ] },
    { label: 'file Session, cwd_relative "project"', pre: [
      '++ read_file ../.qwen-managed-storage.json   -> refused: "Absolute paths and \\"..\\" traversal are not allowed"',
      '++ write_file ../.qwen-managed-storage.json  -> refused, marker unchanged (282 bytes)',
      '++ write_file /srv/w1a/c/.qwen-managed-storage.json -> refused, marker unchanged'].join('\n') },
    { label: 'after the marker is gone (service stopped)', pre: [
      '== register with the original operation UUID -> REFUSED; register with a new UUID -> REFUSED (as documented: no repair command)',
      '== a marker written by hand from the SQL row (marker v2, nine fields) -> inspect marker=match -> cold load 200, next Shell Turn completes'].join('\n') },
    { label: 'the layout the README now forbids (root is the repository, cwd "."), same head', pre: '== unchanged from round 1: `git stash -u`, `git clean -fdx` and write_file on the marker each close the storage for every Session' },
    { note: 'The documented layout removes the accidental causes I reported (routine Git cleanup, file tools). A Shell command can still read or delete the marker, which the README states ("Tools are not confined by this layout"); repair remains manual.' },
  ],
});
console.log('cards-r2a written');
