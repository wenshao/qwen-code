// Evidence cards comparing the rebased head 7c54aa78 with its base (main e263741eb). Values copied from out/e2e-new/*.log.
import fs from 'node:fs';
const dir = new URL('./cards/', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
const ENV = 'Ubuntu 24.04 VM (kernel 6.8, ext4), MySQL 8.4, fat jars as a systemd service with durable local workers, packaged Hosted Harness and workers, deterministic local model';
const card = (name, c) => fs.writeFileSync(`${dir}${name}.json`, JSON.stringify(c, null, 1));

card('03-same-pathname-replacement-ab', {
  title: 'Why it is needed: a directory swapped in at the same pathname while the service is stopped',
  subtitle: `${ENV}. mv a a.prev; mkdir -p a/project; start. Base = main e263741eb, head = 7c54aa78.`,
  blocks: [
    { table: [
      ['', 'base (main)', 'head, option off', 'head, option on (registered)'],
      ['existing Session A,\nnext write_file', '-- warm 200, acquire 503\n   runtime_session_acquire_failed\n   (after the storage claim)', '-- same as base', '++ warm 409 workspace_unavailable\n   (nothing claimed)'],
      ['Session A afterwards', '-- recoveryBlocked=true\n   storage holder stays set', '-- same as base', '++ recoveryBlocked=false\n   holder none'],
      ['new Session N,\nsame Workspace', '-- acquire 409 workspace_busy', '-- same as base', '++ warm 409 workspace_unavailable'],
      ['original moved back,\nservice restarted', '-- A: load 409\n   hosted_turn_recovery_required\n   holder still set', '-- same as base', '++ A: load 200, next Turn completes'],
    ] },
    { label: 'same experiment, a NEW Session asks first (no worker of the old directory involved)', table: [
      ['', 'base (main)', 'head, option on'],
      ['Session N: write_file new.txt', '!! turn_complete: written into the REPLACEMENT directory', '++ warm 409 workspace_unavailable, nothing written'],
      ['Session N: read_file seed.txt', '!! "no file was found": the original content is not there', '++ warm 409 workspace_unavailable'],
    ] },
    { note: 'This reproduces the PR\'s motivation on the base: the replacement "appears valid". It also shows a second base behaviour: when a surviving durable worker of the old directory is adopted, the Session and the whole storage end up wedged. With the option on both turn into a refusal before any claim, and everything works again once the original is back.' },
  ],
});

card('04-delete-and-restore-from-backup', {
  title: 'Finding 1: a root deleted and restored from a backup at the same pathname is accepted as the verified original',
  subtitle: `${ENV}. Head 7c54aa78, option on, registered storage. The backup contains the marker because the marker lives in the tree.`,
  blocks: [
    { label: 'storage a: tar backup after Turn 1; Turns 2 and 3 change the tree; then rm -rf a; tar -x (service stopped)', pre: [
      '== before   dev=64769 ino=788592 birth=1790763228      data.txt = "version-2", only-after-backup.txt present',
      '!! after    dev=64769 ino=788592 birth=1790763252      data.txt = "version-1", only-after-backup.txt ABSENT',
      '==          ext4 hands the freed inode number out again; only the birth time differs',
      '!! inspect: state=ready revision=1 ... identity=match marker=match registration=valid',
      '!! cold load 200; read_file data.txt -> "version-1" (the Session wrote "version-2"); write_file -> turn_complete',
      '==          Broker: warm 200, acquire 200, prepare 200, start 200, release 200'].join('\n') },
    { label: 'storage b, control: one unrelated mkdir between the rm and the restore', pre: [
      '== before   dev=64769 ino=788594      after   dev=64769 ino=796109',
      '++ inspect: identity=mismatch marker=match      next tool Turn: warm 409 workspace_unavailable'].join('\n') },
    { label: 'inode numbers after delete + restore on this ext4 volume (6 rounds, even rounds with an unrelated mkdir in between)', pre: [
      'round 1  796046 -> 796046  SAME        round 2  796046 -> 796055  different',
      'round 3  796055 -> 796055  SAME        round 4  796055 -> 796088  different',
      'round 5  796088 -> 796088  SAME        round 6  796088 -> 796090  different'].join('\n') },
    { label: 'candidate (+4 lines in linuxIdentity: the directory birth time is part of the identity), same scenario', pre: [
      '== registered identity: inode "788592:munywjwp"; Turns 1-3 and a service restart work as before',
      '++ storage a (same inode number after the restore): inspect identity=mismatch -> warm 409 workspace_unavailable, nothing read or written',
      '++ storage b: refused as before'].join('\n') },
    { note: 'Whether the replacement is refused depends on whether the file system reuses the inode number. The PR\'s own tests replace the root with rename + mkdir, which keeps the original inode allocated, so the replacement always gets another number.' },
  ],
});

const kinds = ['root', 'activation-install', 'input', 'admission', 'checkpoint', 'message', 'tool-definition', 'tool-args', 'tool-input', 'tool-result-content', 'tool-result-page', 'tool-result-manifest', 'tool-outcome', 'turn-result', 'session_metadata', 'activation-boundary'];
card('05-cold-load-strictness', {
  title: 'Cold load with a retained resource missing: base loads and carries on, the PR refuses before any model or tool work',
  subtitle: `${ENV}. A renamed 2-Turn Shell Session per resource kind; the oldest resource of that kind is made unavailable in the MySQL Session Store.`,
  blocks: [
    { table: [
      ['resource kind made unavailable', 'base (main e263741eb)', 'head 7c54aa78'],
      ['definition', '-- load 503 managed_session_open_failed', '-- load 503 managed_session_open_failed'],
      ...kinds.map((k) => [k, k === 'message' ? '!! load 200; next input: turn_error' : '!! load 200; next input: turn_complete, model +1', '++ load 409 hosted_turn_recovery_required; model +0, Broker +0']),
      ['total', '!! 16 of 17 kinds load; 15 then complete the next input', '++ 17 of 17 refused at load; after repair: load 200, next Shell Turn completes'],
    ] },
    { label: 'head: every retained resource of one Session (51), one at a time, three kinds of damage', pre: [
      '++ missing 51/51 refused    emptied 51/51 refused    one bit flipped 51/51 refused    = 153/153',
      '== model calls +0, Broker calls +0, Shell runs +0 during the sweep; after the last repair: load 200, next Shell Turn completes',
      '== each load attempt appends 2 lease records: 51 -> 359 resources after 154 attempts; load time 825 ms -> 2054 ms'].join('\n') },
  ],
});

card('08-cold-load-cost', {
  title: 'What the always-on cold-load validation costs: one sequential read per retained record',
  subtitle: `${ENV}. Same Session and store, loaded by the head Harness and by the base Harness (best of 2 for the head).`,
  blocks: [
    { label: 'file-profile Session, text-only Turns', table: [
      ['Turns', 'retained resources', 'head 7c54aa78', 'base (main)', 'first round (04048333)'],
      ['1', '11', '300 ms', '176 ms', '240 ms'],
      ['10', '73', '847 ms', '119 ms', '707 ms'],
      ['50', '321', '1959 ms', '175 ms', '2563 ms'],
      ['150', '929', '6649 ms', '451 ms', '6726 ms'],
      ['400', '2437', '(not repeated)', '', '!! 23136 ms  (base 1003 ms)'],
    ] },
    { label: 'Shell-profile Session, complete Shell output retained', table: [
      ['retained output', 'resources', 'head 7c54aa78', 'base (main)'],
      ['1 MiB', '26', '237 ms', '51 ms'],
      ['10 MiB', '63', '533 ms', '54 ms'],
      ['50 MiB', '131', '1623 ms', '74 ms'],
      ['150 MiB', '259', '3638 ms', '69 ms'],
      ['350 MiB (first round)', '515', '6904 ms', '91 ms'],
    ] },
    { note: 'About 7-9 ms per retained record on this rig, bytes matter little. The Java connector calls the Harness with harness.request-timeout = 30 s (application.yml); the PR\'s IT probe uses 90 s. Public Workspace Sessions have one Turn today, so nothing reaches this yet.' },
  ],
});
console.log('cards-b written');
