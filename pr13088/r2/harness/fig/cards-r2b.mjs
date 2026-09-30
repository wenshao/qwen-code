// Round 2 evidence cards, part 2 (PR head c21efbdfa1): O2 publication, Hosted MCP, gates and mutation. Values from out/r3 and out/e2e-r3.
import fs from 'node:fs';
const dir = new URL('./cards-r2/', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
const ENV = 'Ubuntu 24.04 VM (kernel 6.8, ext4), MySQL 8.4.11, fat jar as a systemd service with durable local workers, packaged Hosted Harness and workers';
const card = (name, c) => fs.writeFileSync(`${dir}${name}.json`, JSON.stringify(c, null, 1));
const R = '++ REFUSED 409 hosted_turn_recovery_required'; const L = '-- LOADED, next Shell Turn completes';

card('r2-04-o2-publication-cold-load', {
  title: 'Cold load of Sessions that use O2 remote Shell publication: PR head against main',
  subtitle: `${ENV}; tool publication on, object storage = a local OSS double behind the real aliyun-sdk-oss. Each row: one Shell Turn (3,000,001 bytes of stdout in 3 segments, empty stderr), detach, one stored artifact damaged, cold load without a profile. Values from c21efbdfa1 against main 3a8fd11711; 2cbf89313a against main 78143fe335 gave the same outcome in every row.`,
  blocks: [
    { label: 'what was damaged between detach and load', table: [
      ['damage', 'PR head', 'main'],
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
    { label: 'PR head', pre: '++ every refusal: 0 model calls and no Broker prepare / start / execute; the first command ran exactly once in all 12 rows' },
    { label: 'original-receipt recovery: the Harness is killed (SIGKILL) when its acknowledge of a finished Shell call arrives; a new Harness loads after the 60 s writer lease', table: [
      ['', 'PR head', 'main'],
      ['nothing damaged', '++ load 200; original Turn turn_complete; 1 model call;\n++ acknowledge 200; the command did not run again', 'same'],
      ['one bit flipped in a stored segment', '++ load 409; 0 model calls; no Broker call', '-- load 200; the original Turn continues with 1 model call'],
    ] },
    { label: 'cost: every cold load re-reads the retained output from object storage (local OSS double, so the times are a lower bound)', table: [
      ['stdout retained', 'c21efbdfa1: cold load', 'c21efbdfa1: object reads', 'main 3a8fd11711'],
      ['1 MiB', '433 ms', '6 GETs, 1.3 MiB', '243 ms, 1 GET, 0.1 MiB'],
      ['16 MiB', '466 ms', '21 GETs, 16.3 MiB', '164 ms, 1 GET'],
      ['64 MiB', '669 ms', '69 GETs, 64.3 MiB', '167 ms, 1 GET'],
      ['256 MiB', '1,732 ms', '261 GETs, 256.3 MiB', '122 ms, 1 GET'],
    ] },
  ],
});

card('r2-05-hosted-mcp-and-the-mount-guard', {
  title: 'Hosted MCP (H1) with the W1a mount guard on: cleanup by the saved holder, refusal of new work',
  subtitle: `${ENV}; verified-workspace-recovery-enabled=true. A real stdio MCP server is started by the runtime worker in the Session directory; every tool call appends a line to a file, so effects are countable. Measured at c21efbdfa1; re-run at 2cbf89313a with the same outcome.`,
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
  title: 'Gates, negative controls and mutation',
  subtitle: 'Mutants and the candidate test fix are applied to isolated copies; the PR branch is untouched. A mutant counts as killed only if the stage fails twice.',
  blocks: [
    { label: 'exact-head Linux/MySQL job on GitHub for 2cbf89313a (job 110001199469, MySQL 8.4.6, x86)', pre: [
      '++ 277 unit tests, 7 Hosted*IT classes / 16 tests, 44 Runtime Broker fault gates',
      '++ W1_TWO_BROKER_A4_OK physical=true staleLost=true;  W1_PHYSICAL_GUARD=true on the Workspace tool Turn'].join('\n') },
    { label: 'the two W1a integration gates on my VM (aarch64, kernel 6.8, CONFIG_HZ=1000, MySQL 8.4.11, Java 21.0.9)', table: [
      ['tree', 'HostedWorkspaceConcurrencyIT (two Broker processes)', 'HostedWorkspaceStorageGuardMySqlIT'],
      ['2cbf89313a unmodified', '++ 1/1, W1_TWO_BROKER_A4_OK physical=true staleLost=true', '-- fails at :93 in 4 of 4 runs: inspect says\n   identity=unavailable, the test expects mismatch'],
      ['2cbf89313a + one test line\n(replacement root gets a distinct mtime)', '++ 1/1, A4_OK physical=true staleLost=true', '++ 1/1'],
      ['2cbf89313a, claim(): verifyLocked removed', '++ fails twice at :122 (full-row assertion:\n   holder_key / binding_id set, null expected)', '== (fails at :93 as above)'],
      ['c21efbdfa1 unmodified', '++ 1/1, A4_OK physical=true staleLost=true', '++ 1/1'],
      ['c21efbdfa1, fence allowed while held', '++ fails twice', '== 1/1'],
      ['c21efbdfa1, host id = raw machine-id', '== 1/1', '++ fails twice at :65'],
      ['c21efbdfa1, marker written and read as version 1', '!! 1/1', '!! 1/1'],
    ] },
    { label: 'mutation', table: [
      ['', 'mutants', 'killed by unit tests', 'killed only by the two W1a ITs', 'survive'],
      ['Java at c21efbdfa1: guard, store, connector, provisioner, transport, receipt verifier', '45', '21', '3 (IT stage run for 4)', '21'],
      ['Java at 2cbf89313a: its three new checks', '3', '2 (resolveAction admission, inspect)', '0', '1 (FIFO)'],
      ['TypeScript at 2cbf89313a: cold-load validation, O2 verification, projection cut', '37', '17', '-', '20 (same set as at c21efbdfa1)'],
    ] },
    { label: 'new-code mutants that no test notices', pre: [
      '!! marker version 2 -> 1 (writer and reader agree, so nothing pins the version)',
      '!! receipts/verify: manifest reference, outcome envelope, outcome reference (length, digest) and REFERENCED phase not compared',
      '!! Harness: verifier reply not compared with the journal receipt; manifest without a verified receipt accepted; incomplete capture flag dropped',
      '!! the FIFO regular-file check removed (all 277 unit tests stay green; no test in the PR creates a FIFO)',
      '== on the real stack the unmodified head refuses the matching damage (outcome bit flip, phase changed to FINISHED, partial capture, FIFO)'].join('\n') },
    { label: 'where the TypeScript tests were run', pre: [
      '== idle Linux host (12 cores, Node 24): hosted-harness-session.test.ts 78/78 twice on each head, about 50 s; every mutant gave the same result on the rerun',
      '!! loaded macOS host (load 40-70): the unmodified file failed 3, 6 and 9 of 78 tests in three runs, different tests each time'].join('\n') },
    { label: 'Serve A/B', pre: [
      '== c21efbdfa1 on GitHub: POST /session 504 init_timeout after the ACP child exited with SIGKILL during initialize (plain daemon path)',
      '++ the same driver, head arm, on the idle Linux host: exit 0 and 12 captures in 3 of 3 runs;  2cbf89313a on GitHub: pass'].join('\n') },
  ],
});
console.log('cards-r2b written');
