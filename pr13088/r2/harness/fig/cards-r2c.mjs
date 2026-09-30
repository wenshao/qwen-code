// Round 2 evidence cards, part 3: main moved during the round; local trial merge; whole-host restart. Values from out/r3, out/m3r.
import fs from 'node:fs';
const dir = new URL('./cards-r2/', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
const card = (name, c) => fs.writeFileSync(`${dir}${name}.json`, JSON.stringify(c, null, 1));

card('r2-06-main-moved-trial-merge', {
  title: 'The merge with main 78143fe335: what c21efbdf collided with, and how 2cbf89313a resolves it',
  subtitle: '#13101 (durable permission Actions) landed on main at 2026-09-30 15:38 UTC, during this round. Linux VM, MySQL 8.4.11, Java 21. Measured before the author pushed 2cbf89313a.',
  blocks: [
    { label: 'c21efbdfa1 against main 78143fe335', table: [
      ['where', 'what collided', 'measured on c21efbdfa1', '2cbf89313a'],
      ['QwenHostedHarnessConnector.createOrLoad', 'main: Action-store precondition\nPR: passive / new-work authorization', '-- git merge: CONFLICT (content);\n   GitHub: CONFLICTING', '++ both kept'],
      ['QwenHostedHarnessConnector.resolveAction\n(new on main)', 'calls attachment(tenantId, sessionId);\nthe PR made it attachment(…, boolean newWork)', '-- does not compile after the\n   conflict is resolved', '++ attachment(…, true) and a\n++ new-work admission check first'],
      ['db/migration', 'main V24__managed_actions.sql\nPR   V24__verified_workspace_mount.sql', '-- both on the class path:\n   "Found more than one migration\n   with version 24", no start', '++ V25__verified_workspace_mount.sql'],
      ['a database migrated by main', 'PR jar', '-- "Migration checksum mismatch\n   for migration version 24", no start', '++ V25 applied in place, starts'],
      ['QwenHostedHarnessConnectorTest', 'no Action store in the PR test', '-- 1 of 274 unit tests errors', '++ 277 tests, 0 failed'],
    ] },
    { label: 'an independent check', pre: [
      '== before 2cbf89313a was pushed I made the same three resolutions in a local trial merge (V25, both sides, attachment(…, true))',
      '++ on that build: 274 unit tests, both W1a ITs, the merged Harness test file 78/78, and every scenario in the next table passed',
      '== 2cbf89313a adds three things on top: the admission check in resolveAction, a regular-file check on the marker, inspect "unavailable"'].join('\n') },
    { label: 'on 2cbf89313a (base arm = main 78143fe335)', table: [
      ['check', 'result'],
      ['database migrated by main 78143fe335, then 2cbf89313a', '++ Migrating schema to version "25 - verified workspace mount"; fence, old binary, restore-original as before'],
      ['rollout, cold load without a profile, Spring SIGKILL, Harness SIGKILL', '++ as before; first Shell effect not repeated'],
      ['delete + restore from backup (inode number reused), MySQL and MariaDB', '++ refused: identity=mismatch, warm 409 workspace_unavailable'],
      ['13-case identity matrix, MySQL and MariaDB', '++ 13/13 and 13/13'],
      ['public G0 route through the real connector (with main\'s Actions)', '++ registered storage completes; unregistered / fenced / replaced: workspace_unavailable, 0 model calls'],
      ['approvals, cold-load strictness (17/17 vs main 1/17), birth-time probes, layout', '++ as before'],
      ['O2 damage matrix; original-receipt recovery after a Harness kill', '++ 11/11 refused (main loads 9); recovery continues once, damaged copy refused'],
      ['Hosted MCP: pins, cleanup with the mount unavailable, replaced holder', '++ as before'],
      ['reboot and power cut', '++ as before'],
    ] },
  ],
});

card('r2-09-what-2cbf89313a-changed', {
  title: 'What 2cbf89313a changed on its own, on the real stack',
  subtitle: 'Linux VM, MySQL 8.4.11, fat jar as a systemd service. Public routes go through the real Java connector (approval mode "default"). The c21efbdfa1 column uses that head\'s jar on its own database.',
  blocks: [
    { label: 'the marker path is a FIFO (the bot\'s R1-1)', table: [
      ['', 'c21efbdfa1', '2cbf89313a'],
      ['maintenance inspect', '-- no answer within 20 s (killed)', '++ marker=unavailable in 0.5 s'],
      ['next tool Turn', '-- runtimes:warm gets no reply for 40 s; thread\n   runtime-broker-http blocked in FileChannel.open\n   <- WorkspaceStorageGuard.readMarker:386;\n   released only when a writer opens the FIFO', '++ public create: turn FAILED / workspace_unavailable\n++ in 430 ms, no Broker call, server healthy'],
    ] },
    { label: 'inspect (R1-14)', table: [
      ['root directory', 'c21efbdfa1', '2cbf89313a'],
      ['path missing', 'identity=mismatch', '++ identity=unavailable'],
      ['another directory at the path', '', 'identity=mismatch'],
      ['original back', '', 'identity=match marker=match'],
    ] },
    { label: 'resolving a permission Action through the public route (main\'s D6b) while the mount is unavailable', table: [
      ['case', 'response', 'while the marker is away', 'after the marker is back'],
      ['control, mount intact', '202', '', '++ Turn COMPLETED, file written'],
      ['cached attachment, marker moved away', '202 (durable operation)', '++ operation retries (3 attempts), tool not run,\n++ Turn keeps waiting, model +1 (the original request)', '++ a new response completes the Turn;\n   the first operation then confirms as well'],
      ['cold: Spring restarted, marker moved away', '202 (durable operation)', '++ operation retries (4 attempts), tool not run', ''],
    ] },
    { note: 'All three behave as the author describes. The FIFO check has no committed test: removing only the regular-file check leaves all 277 unit tests green (the author\'s own probe for it is not in the PR).' },
  ],
});

card('r2-08-reboot-and-power-cut', {
  title: 'Whole-host restart with the option on: device, inode and birth time after a real reboot and a real power cut',
  subtitle: 'Ubuntu 24.04 VM, MySQL 8.4.11, trusted reboot recovery (W0e-3) on, durable workers. Four registered storages on four file systems, one completed tool Turn each. Values from c21efbdfa1; 2cbf89313a gave the same outcome for every storage.',
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
