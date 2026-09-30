// Round 2 evidence cards, part 3: main moved during the round; local trial merge; whole-host restart. Values from out/r3, out/m3r.
import fs from 'node:fs';
const dir = new URL('./cards-r2/', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
const card = (name, c) => fs.writeFileSync(`${dir}${name}.json`, JSON.stringify(c, null, 1));

card('r2-06-main-moved-trial-merge', {
  title: 'Main moved during this round: what c21efbdf collides with, and a local trial merge',
  subtitle: 'PR head c21efbdfa1 against main 78143fe335 (#13101, durable permission Actions, merged 2026-09-30 15:38 UTC). Linux VM, MySQL 8.4.11, Java 21.',
  blocks: [
    { label: 'the PR head as pushed, against current main', table: [
      ['where', 'what collides', 'measured'],
      ['QwenHostedHarnessConnector.createOrLoad', 'main: Action-store precondition\nPR: passive / new-work authorization', '-- git merge: CONFLICT (content); GitHub: CONFLICTING'],
      ['QwenHostedHarnessConnector.resolveAction\n(new on main)', 'calls attachment(tenantId, sessionId);\nthe PR made it attachment(…, boolean newWork)', '-- javac after resolving the conflict:\n   "method attachment … cannot be applied to given types"'],
      ['db/migration', 'main V24__managed_actions.sql\nPR   V24__verified_workspace_mount.sql', '-- PR jar + main\'s file on the class path:\n   "Found more than one migration with version 24", no start'],
      ['a database migrated by main 78143fe335', 'PR jar as it is', '-- "Migration checksum mismatch for migration version 24", no start'],
      ['QwenHostedHarnessConnectorTest (PR test)', 'builds the connector without main\'s Action store', '-- 1 of 274 unit tests errors until the test passes the store'],
    ] },
    { label: 'local trial merge (my rig only, nothing pushed)', pre: [
      '== createOrLoad keeps both sides; resolveAction calls attachment(tenantId, sessionId, true); migration renamed to V25__verified_workspace_mount.sql',
      '== the PR\'s connector test is given the Action store and an approval mode (3 lines)',
      '== CLI bundle unchanged: main touched no CLI / core source between 3a8fd11711 and 78143fe335 (one test file)'].join('\n') },
    { label: 'on the trial merge', table: [
      ['check', 'result'],
      ['database migrated by main 78143fe335, then the trial merge', '++ Migrating schema to version "25 - verified workspace mount", server starts\n++ history: … V24 managed actions | V25 verified workspace mount'],
      ['server unit tests', '++ 274, 0 failed'],
      ['HostedWorkspaceConcurrencyIT, HostedWorkspaceStorageGuardMySqlIT', '++ 1/1 and 1/1; W1_TWO_BROKER_A4_OK physical=true staleLost=true'],
      ['hosted-harness-session.test.ts (merged with main\'s test changes), idle host', '++ 78/78'],
      ['rollout, cold load without a profile, Spring SIGKILL, Harness SIGKILL', '++ as on the PR head; first Shell effect not repeated'],
      ['delete + restore from backup (inode number reused)', '++ refused: identity=mismatch, warm 409 workspace_unavailable'],
      ['13-case identity matrix', '++ 13/13'],
      ['upgrade from main, fence, old binary, restore-original', '++ as on the PR head'],
      ['public G0 route through the real connector (with main\'s Actions)', '++ registered storage completes; unregistered / fenced / replaced: workspace_unavailable, 0 model calls'],
      ['approvals: allow, deny, cold load, unanswered Action', '++ as on the PR head'],
      ['O2 damage matrix', '++ 11/11 refused, control loads'],
      ['Hosted MCP: pins, cleanup with the mount unavailable, replaced holder', '++ as on the PR head'],
    ] },
    { note: 'The resolution above is mine and only shows that these changes are sufficient. Whether resolving an Action counts as new work (mount verified when the attachment is rebuilt) or as a passive operation is the author\'s decision. The README and the design document say "V24" in several places.' },
  ],
});

card('r2-08-reboot-and-power-cut', {
  title: 'Whole-host restart with the option on: device, inode and birth time after a real reboot and a real power cut (c21efbdf)',
  subtitle: 'Ubuntu 24.04 VM, MySQL 8.4.11, trusted reboot recovery (W0e-3) on, durable workers. Four registered storages on four file systems, one completed tool Turn each.',
  blocks: [
    { label: 'systemctl reboot (boot id efc434b8 -> 19837d59, back in 12 s, no worker survives)', table: [
      ['storage root', 'registered', 'after the reboot', 'cold load / next tool Turn', 'inspect'],
      ['a  ext4 directory on /dev/vda1', 'dev=64769 ino=788592\nbirth 16:56:19.807282021', 'unchanged', '++ 200 / turn_complete (new worker)', 'identity=match marker=match'],
      ['l  ext4 image on a loop device,\n   attached as loop1 instead of loop0', 'dev=1792 ino=2\nbirth 16:56:19.000000000', 'dev=1793 ino=2, same birth time', '-- 200 / warm 409 workspace_unavailable', 'identity=mismatch marker=match'],
      ['v  virtiofs host share', 'dev=37 ino=20\nbirth 16:56:19.866997903', 'dev=37 ino=6, same birth time', '-- 200 / warm 409 workspace_unavailable', 'identity=mismatch marker=match'],
      ['t  tmpfs', 'dev=42 ino=1', 'dev=49 ino=1, empty, new birth time', '-- 200 / warm 409 workspace_unavailable', 'identity=mismatch marker=unavailable'],
    ] },
    { label: 'loop image detached and attached again as loop0', pre: '++ l: dev=1792 ino=2 and the same birth time -> identity=match -> next tool Turn completes' },
    { label: 'power cut (colima stop --force; boot id -> ecff1133, back in 17 s)', pre: [
      '++ a: unchanged -> cold load 200, next tool Turn completes',
      '++ l (loop0): unchanged -> cold load 200, next tool Turn completes',
      '-- v (virtiofs): dev=37 ino=6, still not the registered 20 -> warm 409 workspace_unavailable; files and marker are there'].join('\n') },
    { note: 'Same picture as in round 1, now with the birth time in the identity: the birth time survives a restart on ext4 and virtiofs. What still changes is a device number assigned at attach time and an inode number the file system does not persist (the author deferred this case).' },
  ],
});
console.log('cards-r2c written');
