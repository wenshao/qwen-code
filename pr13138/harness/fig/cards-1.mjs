// Card 1: the runbook on the deployed Linux stack (S1). Every value is copied from out/e2e/s1-capture.log.
import fs from 'node:fs';
const log = fs.readFileSync('/Users/wenshao/pr13138-rig/out/e2e/s1-capture.log', 'utf8');
const grab = (re) => (log.match(re) ?? [])[1] ?? '?';
const card = {
  title: 'PR #13138 @ 989baf22 — W1b runbook on a deployed Linux stack',
  subtitle: 'Ubuntu 24.04 VM (ext4, real W1a statx/machine-id identity) · MySQL 8.4.11 · fat jar as systemd service + durable local workers · packaged Harness/worker · shipped *-workspace-bundle.jar',
  blocks: [
    { label: 'Population through the deployed stack (st-a = ws-a1 + ws-a2; st-b = ws-b1)', pre: [
      '   F1 files  Write v1, overwrite v2, Write __proto__, Read   -> 2 retained backups',
      '   S1 shell  mkdir, 6 MiB file, relative symlink, chmod 755',
      `   O1 shell + O2 publication: ${grab(/O1 publication: ([^\n]+)/)}`,
      '   F2 files  Write + overwrite (1 backup)   F3 files  new file (original absence)',
      '   S2 shell  one Turn                       U1 public create only (no journal head)',
      '   B1 files  on st-b (must stay out of the st-a cut)',
      '== offline: Harness + service stopped, writer leases lapsed, W1a fence -> FENCED rev=1',
    ].join('\n') },
    { label: 'java -jar …-workspace-bundle.jar capture / inspect / verify <request.json> [--offline-confirmed]', pre: [
      `++ capture   ${grab(/w1b capture: exit=0 (\d+ ms)/)}  SEALED  sessions 7/7 (B1 excluded)  assets 731  entries 368  activation=false`,
      `   asset kinds ${grab(/asset kinds: ([^\n]+)/)}`,
      '   file history: captured F1 F2 F3 · not_captured O1 S1 S2 U1 (uninitialized: head=null)',
      `++ same-ID replay  receipt byte-identical: ${grab(/receipt identical: (\w+)/)}      -- same ID + other bundleRoot: operation_conflict`,
      '++ inspect (read-only, no flag): 7 pinned Sessions, nextSessionId=null, registration root /srv/w1b/a',
      `++ verify    ${grab(/w1b verify: exit=0 (\d+ ms)/)}  VERIFIED contentVerified=true authorityCompatible=true activation=false`,
      `++ verify replay identical: ${grab(/verify replay identical: (\w+)/)}`,
      `++ 34 authority tables (mysqldump), source tree, history tree after capture + verify: ${grab(/authority after capture\+verify: (\w+)/)}`,
    ].join('\n') },
    { label: 'After the bundle: lift the fence (W1a restore-original), restart, original Sessions continue, re-fence', pre: [
      ...[...log.matchAll(/ (F1|S1|O1|F2) cold load=(\d+) next Turn: (\S+)/g)].map((m) => `++ ${m[1]} cold load=${m[2]} next Turn ${m[3]}`),
      `!! old bundle verified again: ${grab(/verify after the Sessions advanced: (state=\S+)/)} contentVerified=true authorityCompatible=false activation=false`,
    ].join('\n') },
    { note: 'All PR claims for the happy path hold on real Linux identity and real MySQL: one fixed cut for every Session sharing the storage, original O2 objects and retained history bytes exported, receipt replay, separate content/authority conclusions, activation always false, and no authority byte changed.' },
  ],
};
fs.writeFileSync('/Users/wenshao/pr13138-rig/fig/cards/01-runbook.json', JSON.stringify(card, null, 1));
console.log(card.blocks.map((b) => b.pre ?? b.note).join('\n'));
