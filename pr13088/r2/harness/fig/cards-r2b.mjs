// Round 2 evidence cards, part 2 (PR head c21efbdfa1): O2 publication, Hosted MCP, gates and mutation. Values from out/r3 and out/e2e-r3.
import fs from 'node:fs';
const dir = new URL('./cards-r2/', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
const ENV = 'Ubuntu 24.04 VM (kernel 6.8, ext4), MySQL 8.4.11, fat jar as a systemd service with durable local workers, packaged Hosted Harness and workers';
const card = (name, c) => fs.writeFileSync(`${dir}${name}.json`, JSON.stringify(c, null, 1));
const R = '++ REFUSED 409 hosted_turn_recovery_required'; const L = '-- LOADED, next Shell Turn completes';

card('r2-04-o2-publication-cold-load', {
  title: 'Cold load of Sessions that use O2 remote Shell publication: c21efbdf against main 3a8fd11711',
  subtitle: `${ENV}; tool publication on, object storage = a local OSS double behind the real aliyun-sdk-oss. Each row: one Shell Turn (3,000,001 bytes of stdout in 3 segments, empty stderr), detach, one stored artifact damaged, cold load without a profile.`,
  blocks: [
    { label: 'what was damaged between detach and load', table: [
      ['damage', 'c21efbdf (PR head)', 'main 3a8fd11711'],
      ['nothing (control)', '++ loaded in 1.6 s, next Shell Turn completes', 'loaded, next Shell Turn completes'],
      ['one bit in an OSS segment', R, L],
      ['an OSS segment object deleted', R, L],
      ['SQL page row: one byte changed', R, L],
      ['SQL page row deleted', R, L],
      ['SQL seal: segment_count 3 -> 2', R, L],
      ['SQL seal: digest changed', R, L],
      ['SQL seal of the empty stream deleted', R, L],
      ['SQL manifest row: one byte changed', R, L],
      ['original outcome object: one bit', R, '== 503 managed_session_open_failed'],
      ['publication row: REFERENCED -> FINISHED', R, L],
      ['valid but incomplete capture (1 MiB limit, 3 MB output)', '++ REFUSED 409 after one blocked acknowledge', '== REFUSED 409 after one blocked acknowledge'],
    ] },
    { label: 'at c21efbdf', pre: '++ every refusal: 0 model calls and no Broker prepare / start / execute; the first command ran exactly once in all 12 rows' },
    { label: 'original-receipt recovery: the Harness is killed (SIGKILL) when its acknowledge of a finished Shell call arrives; a new Harness loads after the 60 s writer lease', table: [
      ['', 'c21efbdf', 'main 3a8fd11711'],
      ['nothing damaged', '++ load 200; original Turn turn_complete; 1 model call;\n++ acknowledge 200; the command did not run again', 'same'],
      ['one bit flipped in a stored segment', '++ load 409; 0 model calls; no Broker call', '-- load 200; the original Turn continues with 1 model call'],
    ] },
    { label: 'cost: every cold load re-reads the retained output from object storage (local OSS double, so the times are a lower bound)', table: [
      ['stdout retained', 'c21efbdf: cold load', 'c21efbdf: object reads', 'main 3a8fd11711'],
      ['1 MiB', '433 ms', '6 GETs, 1.3 MiB', '243 ms, 1 GET, 0.1 MiB'],
      ['16 MiB', '466 ms', '21 GETs, 16.3 MiB', '164 ms, 1 GET'],
      ['64 MiB', '669 ms', '69 GETs, 64.3 MiB', '167 ms, 1 GET'],
      ['256 MiB', '1,732 ms', '261 GETs, 256.3 MiB', '122 ms, 1 GET'],
    ] },
  ],
});

card('r2-05-hosted-mcp-and-the-mount-guard', {
  title: 'Hosted MCP (H1) with the W1a mount guard on: cleanup by the saved holder, refusal of new work (c21efbdf)',
  subtitle: `${ENV}; verified-workspace-recovery-enabled=true. A real stdio MCP server is started by the runtime worker in the Session directory; every tool call appends a line to a file, so effects are countable.`,
  blocks: [
    { label: 'cold load keeps the profile and the server pins explicit', pre: [
      '++ load without a profile / with the file profile -> 409 hosted_tool_profile_conflict',
      '++ load with the MCP profile but no pins -> 400 invalid_hosted_mcp_servers',
      '++ load with another server revision / another definition digest -> 409 hosted_tool_profile_conflict',
      '++ load with the saved profile and pins -> 200, next MCP tool Turn completes'].join('\n') },
    { label: 'the mount becomes unavailable (marker moved away) while the Session holds the storage and an MCP operation is running', table: [
      ['request', 'Harness answer', 'Broker'],
      ['status of the original operation', '++ 200 running', 'control[mcp-status] 200'],
      ['cancel of the original operation', '++ 202', 'control[mcp-cancel] 200'],
      ['a NEW MCP operation', '++ 503 hosted_mcp_operation_failed', 'control[mcp-discover] 409 workspace_unavailable'],
      ['a NEW Turn that would call the MCP tool', '++ turn_error, 0 model calls, 0 tool effects', 'control[mcp-discover] 409 workspace_unavailable'],
      ['detach', '++ 204', 'control[mcp-release] 200, tool-sessions release 200'],
      ['storage holder afterwards', '++ none (inspect holder=false)', ''],
    ] },
    { label: 'the same from a NEW Harness process: the old one is killed (SIGKILL) while it holds the storage, the marker is still away', pre: [
      '++ load 200 (after the dead writer\'s lease lapsed, 38 s); status of the original operation 200 (control[mcp-status] 200)',
      '++ a NEW operation -> 503 (control[mcp-discover] 409 workspace_unavailable)',
      '++ detach 204 (mcp-release 200, release 200) -> storage holder none'].join('\n') },
    { label: 'a replaced holder (mount fine): the lease row is handed to another holder while an operation is running', pre: [
      '++ status -> outcome_unknown (control[mcp-status] 409 workspace_busy)',
      '++ cancel -> 503 (control[mcp-cancel] 409 workspace_busy); detach -> 503; the other holder\'s row is untouched'].join('\n') },
    { note: 'An MCP Session keeps the storage lease between Turns (main H1 design), so a storage with an attached MCP Session cannot be fenced until that Session detaches.' },
  ],
});

card('r2-07-gates-and-mutation', {
  title: 'Gates, negative controls and mutation at c21efbdf',
  subtitle: 'Mutants are applied to isolated copies; the PR branch is untouched. A mutant counts as killed only if the stage fails twice.',
  blocks: [
    { label: 'exact-head Linux/MySQL job on GitHub (job 109918078098, MySQL 8.4.6, Java 21)', pre: [
      '++ 262 unit tests, 7 Hosted*IT classes / 15 tests, 44 Runtime Broker fault gates, Checkstyle 0 violations',
      '++ W1_TWO_BROKER_A4_OK physical=true staleLost=true;  W1_PHYSICAL_GUARD=true on the Workspace tool Turn;  HOSTED_PROCESS_CRASH_OK x6'].join('\n') },
    { label: 'the two W1a integration gates replayed on my VM (MySQL 8.4.11, Java 21.0.9, Node 22.23.2)', table: [
      ['tree', 'HostedWorkspaceConcurrencyIT (two Broker processes)', 'HostedWorkspaceStorageGuardMySqlIT'],
      ['unmodified c21efbdf', '++ 1/1, W1_TWO_BROKER_A4_OK physical=true staleLost=true', '++ 1/1'],
      ['claim(): `storageGuard.verifyLocked(binding)` removed', '++ fails twice at :121, full-row assertion:\n   expected holder_key=null binding_id=null\n   but was  holder_key=5f2a8f18… binding_id=c847cceb-…', '== 1/1'],
      ['fence allowed while a holder is present', '++ fails twice (expected: false but was: true)', '== 1/1'],
      ['host id = raw machine-id instead of the HMAC', '== 1/1', '++ fails twice at :65'],
      ['marker written and expected as version 1', '!! 1/1', '!! 1/1'],
    ] },
    { label: 'mutation (the IT stage was run for the four mutants in the table above)', table: [
      ['', 'mutants', 'killed by unit tests', 'killed only by the two W1a ITs', 'survive'],
      ['Java: guard, store, connector, provisioner, transport, receipt verifier', '45', '21', '3', '21'],
      ['   of which new at this head (birth time, marker v2, HMAC, MCP recovery, receipts/verify)', '15', '9', '1', '5'],
      ['TypeScript: cold-load validation, O2 verification, projection cut', '37', '17', '-', '20'],
    ] },
    { label: 'new-code mutants that no test notices', pre: [
      '!! marker version 2 -> 1 (writer and reader agree, so nothing pins the version)',
      '!! receipts/verify: manifest reference, outcome envelope, outcome reference (length, digest) and REFERENCED phase not compared',
      '!! Harness: verifier reply not compared with the journal receipt; manifest without a verified receipt accepted; incomplete capture flag dropped',
      '== on the real stack the unmodified head refuses the matching damage (outcome bit flip, phase changed to FINISHED, partial capture)'].join('\n') },
    { label: 'where the TypeScript tests were run', pre: [
      '== idle Linux host (12 cores, Node 24): hosted-harness-session.test.ts 78/78 twice in 50 s; all 37 mutants gave the same result on the rerun',
      '!! loaded macOS host (load 40-70): the unmodified file failed 3, 6 and 9 of 78 tests in three runs, different tests each time'].join('\n') },
    { label: 'the one red GitHub check: Serve A/B', pre: [
      '== GitHub: `POST /session` 504 init_timeout after the ACP child exited with SIGKILL during initialize (plain daemon path, not the Hosted Harness)',
      '++ the same driver, head arm, on the idle Linux host: exit 0 and 12 captures in 3 of 3 runs'].join('\n') },
  ],
});
console.log('cards-r2b written');
