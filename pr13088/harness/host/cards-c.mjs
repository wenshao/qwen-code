// Evidence cards: whole-host restart, the /verify request, mutation, upgrade and maintenance. Values from out/new and out/e2e-new.
import fs from 'node:fs';
const dir = new URL('./cards/', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
const ENV = 'Ubuntu 24.04 VM (kernel 6.8), MySQL 8.4, PR-head fat jar as a systemd service with durable local workers, packaged Hosted Harness and workers';
const card = (name, c) => fs.writeFileSync(`${dir}${name}.json`, JSON.stringify(c, null, 1));

card('09-reboot-and-power-cut', {
  title: 'Whole-host restart with the option on: which storage keeps its registered identity (head 7c54aa78)',
  subtitle: `${ENV}; trusted reboot recovery (W0e-3) on. Four registered storages on four file systems, one completed tool Turn each, then a real reboot and a real power cut.`,
  blocks: [
    { label: 'systemctl reboot (boot id 2acfa6ec -> ad4e9c02, back in 17 s, no worker survives)', table: [
      ['storage root', 'registered', 'after the reboot', 'cold load / next tool Turn', 'inspect'],
      ['a  ext4 directory on /dev/vda1', 'dev=64769 ino=788592', 'dev=64769 ino=788592', '++ 200 / turn_complete (new worker)', 'identity=match marker=match'],
      ['l  ext4 image on a loop device,\n   attached as loop1 instead of loop0', 'dev=1792 ino=2', 'dev=1793 ino=2', '-- 200 / warm 409 workspace_unavailable', 'identity=mismatch marker=match'],
      ['v  virtiofs host share', 'dev=37 ino=79378', 'dev=37 ino=6', '-- 200 / warm 409 workspace_unavailable', 'identity=mismatch marker=match'],
      ['t  tmpfs', 'dev=42 ino=1', 'dev=49 ino=1, empty', '-- 200 / warm 409 workspace_unavailable', 'identity=mismatch marker=unavailable'],
    ] },
    { label: 'loop image detached and attached again as loop0', pre: '++ l: dev=1792 ino=2 again -> inspect identity=match -> next tool Turn completes; files from before the reboot present' },
    { label: 'power cut (colima stop --force; boot id -> 8430654b, back in 17 s)', pre: [
      '++ a: unchanged -> cold load 200, next tool Turn completes',
      '++ l (loop0): unchanged -> cold load 200, next tool Turn completes',
      '-- v (virtiofs): dev=37 ino=6, still not the registered 79378 -> warm 409 workspace_unavailable; all files and the marker are there'].join('\n') },
    { note: 'The README says a whole-host restart succeeds only while the registered identity still matches. On this host that holds for a directory on a fixed ext4 disk. A device number assigned at attach time, or an inode number that the file system does not persist, changes across a restart, and W1a has no command that re-enrols such a storage.' },
  ],
});

card('10-verify-request-and-mutation', {
  title: 'The /verify request: two-Broker gate, its negative control, and the exact-head test selection (7c54aa78)',
  subtitle: 'Linux VM, MySQL 8.4.11, Java 21.0.9, Node 22.23.2. Mutants are applied to isolated copies; the PR branch is untouched.',
  blocks: [
    { label: 'unmodified head, my VM', pre: [
      '++ HostedWorkspaceConcurrencyIT 1/1   W1_BROKER_PID first=386 second=412, W1_WORKER_PID 469 / 445',
      '++                                    W1_TWO_BROKER_A4_OK physical=true staleLost=true',
      '++ HostedWorkspaceStorageGuardMySqlIT 1/1'].join('\n') },
    { label: 'negative control: only `storageGuard.verifyLocked(binding)` removed from claim()', pre: [
      '-- HostedWorkspaceConcurrencyIT fails twice in a row at HostedWorkspaceConcurrencyIT.java:118 (full-row assertion)',
      '   expected: mount_state=FENCED mount_revision=1 holder_key=null binding_id=null runtime_generation=null runtime_session_id=null',
      '   but was : mount_state=FENCED mount_revision=1 holder_key=dc21a865... binding_id=6ed8efab-... runtime_generation=1 runtime_session_id=6c089d9e-...',
      '== HostedWorkspaceStorageGuardMySqlIT still 1/1; the 209 unit tests do not notice this mutant'].join('\n') },
    { label: 'exact-head Linux/MySQL selection', table: [
      ['', 'GitHub job 109833002481 (MySQL 8.4.6)', 'replay on my VM (MySQL 8.4.11)'],
      ['server unit tests', '209, 0 failed', '209, 0 failed'],
      ['Hosted*IT classes / tests', '7 / 15, 0 failed', '7 / 15, 0 failed *'],
      ['happy-path tool Turn', 'W1_PHYSICAL_GUARD=true', 'W1_PHYSICAL_GUARD=true'],
      ['two-Broker gate', 'A4_OK physical=true staleLost=true', 'A4_OK physical=true staleLost=true'],
      ['Runtime Broker fault gates', '44, 0 failed', '44, 0 failed'],
      ['Checkstyle', '0 violations', '0 violations'],
    ] },
    { label: 'footnote', pre: '== * 14 of the 15 passed in the first replay; the latency test failed there because my container had no git metadata for its\n==   `git rev-parse HEAD`, and passed when re-run with the metadata mounted (HOSTED_LATENCY_OK)' },
    { label: 'mutation (double-fail rule: a mutant counts as killed only if the stage fails twice)', table: [
      ['', 'mutants', 'killed by unit tests', 'killed only by the two W1a ITs', 'survive'],
      ['Java (guard, store, connector, provisioner)', '30', '12', '2 (claim check; fence while held)', '16'],
      ['TypeScript (cold-load validation, projection cut)', '25', '14', '-', '11'],
    ] },
    { note: 'Survivors that matter were exercised on the real stack at this head and behave correctly there: execute-time refusal, device / host id / root path comparison, restore-original on a replaced root, register while held, register over a foreign marker, non-UUID operation id. They are untested, not broken.' },
  ],
});

card('11-upgrade-maintenance-flyway', {
  title: 'Upgrade from main, the maintenance entry, and Flyway numbering (head 7c54aa78)',
  subtitle: 'Linux VM, MySQL 8.4.11. Base = main e263741eb.',
  blocks: [
    { label: 'populated database upgraded from main to the PR head', pre: [
      '== main:      flyway ... V18 <- V19; two Sessions with tool Turns; two durable workers running',
      '++ PR head:   "Migrating schema to version 21 - verified workspace mount", 51 ms; existing lease rows become UNVERIFIED rev 0',
      '++ option off: cold load 200 / 200 without a profile, next file Turn and next Shell Turn complete on the adopted workers',
      '++ register (rows that pre-date V21): READY rev 1, tenant_id / storage_id filled in; option on: next Turns complete',
      '!! old binary on the V21 schema, storage fenced: it starts, and write_file on the FENCED storage succeeds (as the README warns)',
      '++ PR head again: fenced storage refused; restore-original -> READY rev 2 -> next Turn completes'].join('\n') },
    { label: 'maintenance entry', pre: [
      '++ README command verbatim (mvn -q -DskipTests compile exec:java ...), Java 21 + Maven 3.9.11 on the Linux host: inspect, register,',
      '   retry, conflicting uuid (refused), fence, restore-original all behave as documented; about 17 s per command; exec-maven-plugin 3.6.4 resolved at run time',
      '++ same entry from the shipped jar, no Maven, no source: java -cp app.jar -Dloader.main=...WorkspaceStorageRegistrationMain',
      '   org.springframework.boot.loader.launch.PropertiesLauncher <args>      about 0.6 s per command',
      '!! Dockerfile runtime image (eclipse-temurin:21-jre): /etc/machine-id is an empty file -> inspect identity=mismatch, register refused;',
      '   with -v /etc/machine-id:/etc/machine-id:ro -> identity=match (a bind-mounted root has the same dev and inode as on the host)',
      '++ registration interrupted after the SQL prepare (marker not writable): inspect shows operation=<uuid>; a new uuid is refused, the original uuid completes it'].join('\n') },
    { label: 'Flyway: this PR adds V21 and leaves V20 unused; #12894 carries V20-V22 and #13037 carries V21', pre: [
      '== database migrated by this PR:            ... V19 V21',
      '-- a later build that also carries a V20:    does not start: "Detected resolved migration not applied to database: 20"',
      '-- a later build that carries another V21:   does not start: "Found more than one migration with version 21"'].join('\n') },
  ],
});
console.log('cards-c written');
