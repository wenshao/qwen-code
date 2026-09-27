// Builds out/cards.json from the final-head runs; rendered by cards.py.
const fs = require('fs');
const SP = '/path/to/scratchpad';
const J = (p) => JSON.parse(fs.readFileSync(`${SP}/${p}`, 'utf8'));
const pr = J('out/ui4/pr.json');
const base = J('out/ui4/base.json');
const ov = J('out/overflow-pr4-mysql.json');
const um = J('out/upgrade-mysql-r3.json');
const ua = J('out/upgrade-mariadb-r3.json');
const n = (x) => x.toLocaleString('en-US');
const reqs = (a) => a.streamRequests.map((r) => r.afterSequence + (r.held ? ' (held)' : '')).join(', ');
const firstMid = ov.s3.storeReads.find((r) => !r.endsWith('> 1')).replace('sequence_id > ', '');
const spec = [
  {
    name: '01-webshell-resync-ab',
    title: 'Web Shell: resync frame -> reload -> resume, PR client vs main client',
    subtitle: 'Same server (jar of cf72a892b4, MySQL 8.4.7, packaged hosted harness, scripted model); Chromium via Playwright',
    lines: [
      `== page loads at cursor ${pr.pageCursor}; its events/stream request is held; a 2nd Turn runs; floor raised to ${pr.floor}; request released`,
      `++ PR client  : resync frame -> stream_gap -> ${pr.transcriptReloads} transcript reload -> resumes after ${pr.lastSequence}; reply shown ${pr.secondReplyShownMs} ms after release`,
      `==              stream requests in 15 s (afterSequence): ${reqs(pr)}`,
      `-- main client: ignores the frame, reconnects every 3 s with the same cursor; ${base.transcriptReloads} transcript reloads; reply never shown`,
      `==              stream requests in 15 s (afterSequence): ${reqs(base)}`,
    ],
    images: [
      ['++ PR client (this PR), 15 s after release', `${SP}/out/ui4/pr-1-after.png`, [270, 100, 1280, 520]],
      ['-- main client, 15 s after release (the Session header already says Completed)', `${SP}/out/ui4/base-1-after.png`, [270, 100, 1280, 520]],
    ],
  },
  {
    name: '02-streams-real-stack',
    title: 'Event pages, replay floor and streams on the real stack',
    subtitle: 'jar of cf72a892b4, MySQL 8.4.7, packaged hosted harness + scripted model, raw HTTP/SSE clients; bodies and frames Ajv-checked against the 1.17.0 spec',
    lines: [
      '## Paging and identity (replay.mjs, 30/30 checks)',
      '++ limit=7 via next_cursor: 13/13 sequences once, in order; last page has_more=false, next_cursor=null',
      '-- main jar, same driver: the first page says has_more=false, so only 7 of 13 are reachable; limit=1000 -> 400',
      '++ limit 1000 -> 200; 1001 and 0 -> 400 invalid_limit (event query and WebShell transcript)',
      '++ every event: schema_version 1, projection_version 1; item_id / content_part_id name Snapshot Items / Parts',
      '++ the deltas of each content_part_id rebuild that text Part exactly',
      '## Replay floor (raised with SQL; nothing in production calls advanceReplayFloor yet)',
      '++ floor 8, Snapshot 13: after=7 -> 409 cursor_expired {replay_floor_sequence 8, snapshot_through_sequence 13, request_id}',
      '++ after=8 -> 200 from 9; Last-Event-ID wins over after in both directions',
      '++ public and WebShell SSE below the floor: exactly 1 agent.session.resync_required frame, no id, server closes',
      '++ transcript reload -> lastSequence 13 >= floor; WebShell stream from there: no resync, stays open',
      '## Stuck client, hub overflow, catch-up race (overflow.mjs, 5/5 checks)',
      `++ a client with SO_RCVBUF 4 KiB stops reading while ${n(ov.s3.to - ov.s3.from + 1)} events are written; the hub drops its range and`,
      `++   the stream re-reads the store from ${firstMid} in pages of 100 (MySQL general log); ${n(ov.s3.delivered.n)}/${n(ov.s3.to - ov.s3.from + 1)} delivered once, in order, 0 dups, 0 gaps`,
      `++ floor raised to ${n(ov.s3b.floor)} while stuck: ${ov.s3b.delivered.n} contiguous events (${n(ov.s3b.delivered.first)}..${n(ov.s3b.delivered.last)}), 1 resync frame, no id, server closes`,
      `++ catch-up from Last-Event-ID 0 over ${n(ov.s4.to)} events (${ov.s4.catchUpPages} pages of 100) racing 300 renames: ${n(ov.s4.delivered.n)}/${n(ov.s4.to)} once, in order`,
    ],
  },
  {
    name: '03-upgrade-and-v15-memory',
    title: 'V13 -> V15 upgrade: identity backfill and V15 memory',
    subtitle: "main's jar writes and materializes, the PR jar migrates; identities checked against main's Snapshot",
    lines: [
      "## Differential: randomized legacy events (60 Sessions) + real Turns, materialized by main's code; jar of 349fb3ba28 migrates",
      `++ MySQL 8.4.7     : ${n(um.differential.events)} events, ${um.differential.items} Items, ${um.differential.textParts} text Parts -> 0 disagreements (10 categories)`,
      `++ MariaDB 10.11.18: ${n(ua.differential.events)} events, ${ua.differential.items} Items, ${ua.differential.textParts} text Parts -> 0 disagreements`,
      '++ flyway_schema_history: 15 JDBC db.migration.V15__managed_event_identity (found inside the packaged jar)',
      "!! rollback: rows that main's jar writes on the V15 schema keep item_id / content_part_id NULL after roll-forward",
      '## V15 on one Session of 1,200,000 events, 256 MB heap, MySQL 8.4.7',
      "-- 42bdee4104, d760dd572e: OutOfMemoryError: Java heap space in the single SELECT per Session;",
      '--   without -XX:+ExitOnOutOfMemoryError: not up after 248 s, main thread parked in Flyway rollback(),',
      '--   old gen 99.8 %, SIGTERM ignored (SIGKILL needed); V15 not recorded, so every restart repeats it',
      '++ 349fb3ba28 (pages of 5,000): the same 1,200,000 events in 86 s at 256 MB, same identity counts',
      '++ one 10,637-event dump (a 9,509-event Session): V15 of 42bdee4104, d760dd572e, 349fb3ba28 write MD5-identical identities',
    ],
  },
  {
    name: '04-retraction-mutants-merge',
    title: 'Retraction identities, independent mutants, merge with main',
    subtitle: 'Store-level probe and mutants against the PR test suite (H2); main Java code is identical at 349fb3ba28 and cf72a892b4',
    lines: [
      '## Randomized retraction probe (not for merge): 2-19 deltas from 3 harness generations, 1 retracted, Snapshot rebuilt',
      '++ d760dd572e and 349fb3ba28: 3,400 cases (4 seeds) each, 0 failures - identities name the rebuilt Snapshot, deltas rebuild Parts',
      '-- 42bdee4104: 356 of 400 cases fail ("#5 empty delta names part_..._reasoning_5") - the first audit commit fixed a real gap',
      "## Mutants outside the author's list, run against the full unit suite",
      '++ 349fb3ba28: 17 / 17 applicable killed, incl. 2 on V15 paging (forget previous at a page edge; read one page only)',
      '== 42bdee4104: 13 / 16 (has_more >= and the single-append read survived until d760dd572e); V15 hole mutant: equivalent',
      '## Merge with main (#12830 H0a had taken contract 1.16.0)',
      "++ author's merge 6bba5132bc resolves the spec as 1.17.0; 0 JSON nodes differ from my independent trial merge",
      '++ cf72a892b4: 135 unit + 10 MariaDB IT, Checkstyle clean; jar = 349fb3ba28 jar except the OpenAPI file (374/375 CRCs)',
      '++ Web Shell: regenerated types unchanged, 73 managed tests, typecheck clean',
    ],
  },
];
fs.writeFileSync(`${SP}/out/cards.json`, JSON.stringify(spec, null, 1));
