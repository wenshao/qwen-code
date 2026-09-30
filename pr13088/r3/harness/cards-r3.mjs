// Round 3 evidence card (PR head f5ede8cea8 = 2cbf89313a + one IT line). Values from out/r5, out/e2e-r5.
import fs from 'node:fs';
const dir = new URL('./cards-r3/', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${dir}r3-01-f5ede8cea8.json`, JSON.stringify({
  title: 'f5ede8cea8: the one-line IT fix, checked on the host where the IT failed',
  subtitle: 'Linux VM (aarch64, kernel 6.8, CONFIG_HZ=1000, ext4), MySQL 8.4.11, Java 21.0.9. The only change since 2cbf89313a is one line in HostedWorkspaceStorageGuardMySqlIT.',
  blocks: [
    { label: 'what is the same', pre: [
      '== server jar built from f5ede8cea8: BOOT-INF/classes byte-identical to 2cbf89313a (275 files, same digest)',
      '== no CLI, core, migration or other test change; main moved to 51b80dadbc (#13095: tests and docs only), merges cleanly'].join('\n') },
    { label: 'the two W1a integration gates on this host', table: [
      ['tree', 'HostedWorkspaceStorageGuardMySqlIT', 'HostedWorkspaceConcurrencyIT (two Broker processes)'],
      ['2cbf89313a (round 2)', '-- failed at :93 in 4 of 4 runs', '++ passed, A4_OK physical=true staleLost=true'],
      ['f5ede8cea8 unmodified, 3 runs', '++ 3 of 3 pass', '++ 3 of 3, W1_TWO_BROKER_A4_OK physical=true staleLost=true'],
      ['f5ede8cea8, claim(): verifyLocked removed, 2 runs', '++ 2 of 2 pass', '++ fails twice at :122 (full-row assertion)'],
    ] },
    { label: 'GitHub job 110041689350 on f5ede8cea8 (MySQL 8.4.6, x86)', pre: '++ 278 unit tests, 16 Hosted IT tests, 44 Runtime Broker fault gates, A4_OK physical=true staleLost=true, W1_PHYSICAL_GUARD=true' },
    { label: 'real-stack scenarios re-run on f5ede8cea8', table: [
      ['scenario', 'result'],
      ['birth time: fresh roots, touch, 128-byte-inode ext4, marker v2 / HMAC host id', '++ as before (fresh mkdir -p root: 38 of 40 with birth == mtime)'],
      ['delete + restore from backup, inode 788592 reused', '++ refused: identity=mismatch, warm 409, nothing written'],
      ['rollout, cold load without a profile, Spring SIGKILL, Harness SIGKILL', '++ as before; first Shell effect not repeated'],
      ['13-case identity matrix', '++ 13/13'],
      ['O2 damage matrix', '++ 11/11 refused, control loads'],
      ['O2 original-receipt recovery after a Harness kill', '++ clean: continues once; damaged: 409, 0 model calls'],
      ['Hosted MCP: pins, saved-holder cleanup with the mount unavailable, replaced holder', '++ as before'],
      ['FIFO marker; inspect unavailable / mismatch; Action responses while the mount is away', '++ as before'],
    ] },
  ],
}, null, 1));
console.log('cards-r3 written');
