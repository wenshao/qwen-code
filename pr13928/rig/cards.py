import json
cards = []
cards.append({
 "file": "01-matrix.png",
 "title": "PR #13928 @ 75f31157 — real-stack verification matrix",
 "subtitle": "Real Spring server + bundled Hosted Harness (dist/cli.js) + embedded Runtime Broker + MySQL 8.4.7 (M) / MariaDB 10.11.18 (Ma); only the model is scripted. macOS arm64, JDK 21, Node 22.23.",
 "sections": [{
  "heading": "Arms: head = 75f31157 | merge = head + main 008c0de746 (+2-line type fix, see F3) | candidate = head + 5-line continue-gate fix (F1)",
  "table": {"head": ["check", "head", "merge", "candidate"], "rows": [
   ["npm run build (tsc --build)", "++ pass", "-- TS2339 x4\n++ pass with +2 lines", "++ pass"],
   ["HostedTeamMemberCommandMySqlIT (PR's IT)", "++ 2/2 M, 2/2 Ma", "++ 2/2 M", "++ 2/2 Ma"],
   ["HostedTeamLeadMySqlIT", "++ 2/2 (+1 skip) M", "++ 2/2 (+1 skip) M", "== not run"],
   ["P1 board rules across members + lock text as data", "++ pass M, Ma", "++ pass M", "++ pass Ma"],
   ["P2 execute held -> member 120 s bound + Turn lock", "++ pass M, Ma", "++ pass M", "++ pass Ma"],
   ["P4 board call batched beside read_file", "++ pass M, Ma*", "++ pass M", "++ pass Ma"],
   ["P3 Harness killed while handed over (accepting)", "-- wedged M, Ma", "-- wedged M", "++ pass M, Ma"],
   ["P5 Harness killed while planned (PR's restart story)", "-- wedged M, Ma", "-- wedged M", "++ pass M, Ma"],
   ["P6 = P5 observed for 10 min", "", "-- still RUNNING; 9/9 continue 409", ""],
   ["P7 = P5 + lead message already delivered", "", "", "-- wedged (#13873 shape)"],
   ["TS unit (PR files; merge adds #13777 files)", "++ core 248/248, cli 77/77", "!! cli 553/554, core 3343/3344\n!! (timeouts at load 40+)\n++ reruns alone 17/17, 6/6", ""],
   ["Java: qwencode 66, server 164, checkstyle", "++ pass", "", ""],
  ]}}],
 "note": "Wedged = the member's Turn stays RUNNING and its report never reaches the lead, although the lead's write already landed. The PR's own restart case passes on every arm because its kill fires only after the member has finished (F2). *MariaDB P4: behaviour passed; JUnit then failed to delete its temp dir (node-compile-cache still being written)."
})
cards.append({
 "file": "02-restart-wedge.png",
 "title": "F1 — a Harness restart during a command wait never resumes the member",
 "subtitle": "P3 on head 75f31157 + MySQL 8.4.7: erin's task_create handed over (accepting), lead execute held by the probe proxy, Harness SIGKILLed with its process tree and restarted.",
 "sections": [
  {"heading": "head: Harness log + journal (erin = member, lead = b6f93222)", "lines": [
   "14:06:14.444  handover -> 202 (accepting); execute held x4 (409 session_command_blocked)",
   "~14:06:32    Harness killed; new Harness listening 14:06:33.9",
   "14:06:38..14:07:10  POST /session/:id/load -> 409 managed_session_writer_conflict (dead writer's lease)",
   "14:07:37.78  erin installActivation gen 2",
   "-- 14:07:38.09  POST /session/erin/managed-runtime/continue -> 409 hosted_turn_recovery_required",
   "--              reason=continuation_not_ready  \"continue: continuation not ready: phase=await_command\"",
   "14:07:43.45  lead execute -> 202 reply \"Task #1 created\"; erin answered -> record accepted",
   "-- 14:08:38.98  continue -> 409 continuation_not_ready again (coordinator retry=8, backoff 60 s)",
   "-- erin journal after gen 2: only renewActivation; Turn RUNNING; child run running; acceptChildResult 0",
   "!! P6 (merge arm, planned at kill): 9 continue calls 14:41:54..14:49:57, all 409; still RUNNING after 10 min",
  ]},
  {"heading": "why: hosted-harness-session.ts continue gate (head :6638-6660)", "lines": [
   "if (phase !== 'results_ready' && !harnessCheckpointIsAgentWait(checkpoint)) -> 409 continuation_not_ready",
   "== harnessCheckpointIsCommandWait() exists (\"Recovery and the route's phase gate share this predicate\")",
   "== and recovery reports await_command as all-known, so qwencode isContinuationReady() == true -> continue",
   "== but the gate never admits it, so resumeCommandWaitRuns() below (:6885) is unreachable",
  ]},
  {"heading": "candidate (+5 lines: also admit harnessCheckpointIsCommandWait) — same scenario", "lines": [
   "++ erin installActivation gen 2 14:25:13.99 -> settleTurn gen 2 14:25:18.05",
   "++ erin's tool answer is the lead's real reply: Task #1 created: \"Accepting audit\"",
   "++ command consumed; exactly 1 execute reached the lead; board 1 task; acceptChildResult accept+consume",
   "++ P3 + P5 pass on MySQL and MariaDB",
  ]}],
})
cards.append({
 "file": "03-restart-it-vacuous.png",
 "title": "F2 — the PR's restart case kills the Harness after the member has finished",
 "subtitle": "HostedTeamMemberCommandMySqlIT#memberHarnessRestartDuringCommandWait, journal of the restart tenant after a passing run (head arm; merge arm identical in shape).",
 "sections": [
  {"heading": "kill condition: openTurns(lead).isEmpty() && parkedOnCommand(carol)", "lines": [
   "== parkedOnCommand = any managed-checkpoint resource LIKE '%await_command%' (stays true after the park ends)",
   "== the lead's first Turn stays open ~20 s after its last (empty) scripted reply, so the kill waits for it",
  ]},
  {"heading": "head run (MySQL 8.4.7)", "lines": [
   "13:59:53.66  carol commitCheckpoint (await_command park)        gen 1",
   "13:59:55.00  carol commitSessionCommand (handover)              gen 1",
   "14:00:01.35  carol commitSessionCommand (answered)              gen 1",
   "14:00:01.86  carol settleTurn          -> member Turn COMPLETED 14:00:02.08",
   "14:00:11.74  lead settleTurn           -> lead Turn completed   14:00:11.99   (kill can fire only now)",
   "!! every Session in the tenant: 1 installActivation, max writer_generation 1 -> no takeover ever happened",
  ]},
  {"heading": "merge run", "lines": [
   "!! member COMPLETED 14:19:22.73, lead completed 14:19:37.06; again 1 activation, gen 1 for both",
  ]}],
 "note": "So the IT's restart assertions (consumed, acceptChildResult, no FAILED) hold without any restart in the middle of the wait, which is why F1 passes CI. P5 is the deterministic version: the member's handover is refused by a proxy so the entry stays planned while the Harness dies."
})
cards.append({
 "file": "04-merge-ts2339.png",
 "title": "F3 — no text conflict, but the merge with main does not compile",
 "subtitle": "Trial merge of 75f31157 with origin/main 008c0de746 (one text conflict in managed-harness-factory.ts, resolved by keeping both methods).",
 "sections": [
  {"heading": "npm run build on the merge", "lines": [
   "-- src/serve/hosted-workspace-tool-turn.ts(2923,19): error TS2339: Property 'command' does not exist on type 'HostedPreparedRequest'.",
   "-- src/serve/hosted-workspace-tool-turn.ts(3233,73): error TS2339: ... (3615,19) ... (3651,21)",
   "== main #13777 (f70344345d) turned the inline request type into interface HostedPreparedRequest",
   "== and added a saved-native-plan builder; neither knows the PR's command flag",
  ]},
  {"heading": "+2 lines that make it build (and pass the PR IT, P1/P2/P4, 553+ cli tests)", "lines": [
   "   team: boolean;",
   "   message: boolean;",
   "++ command: boolean;",
   "   ...",
   "   team: false,",
   "   message: false,",
   "++ command: false,      // saved native batches are Runtime calls; commands never ride them",
  ]}],
})
cards.append({
 "file": "05-timeout-lock.png",
 "title": "Decision 4 on the real stack: held execute, 120 s bound, Turn lock (P2)",
 "subtitle": "Proxy answers the relay's execute with the lead's own 409 session_command_blocked; head 75f31157, MySQL 8.4.7 (MariaDB identical).",
 "sections": [
  {"heading": "dave (member) journal + proxy", "lines": [
   "14:03:58.65  sendSessionCommand (outbound planned)",
   "14:04:00.14  handover -> accepting",
   "14:04:00..14:05:54  execute held 20x; relay row attempts stays 0 (blocked never spends attempts)",
   "14:05:58.76  commitCheckpoint = timedOut stamp (120.1 s after the outbound), then accepting -> unknown",
   "++ dave-0 answer: \"The command reached the leader, but its reply did not arrive in time; a write may have taken effect...\"",
   "++ dave-1 (next task_create, same Turn): \"The leader is not answering; end your turn.\"  no new outbound",
   "++ hold released: relay classifies \"command is already unknown\", 0 executes reach the lead",
   "++ lead board read: \"No tasks found.\"; 0 inbound receipts; both Turns COMPLETED",
  ]}],
})
cards.append({
 "file": "06-board-rules.png",
 "title": "Member board rules end to end (P1, P4)",
 "subtitle": "alice creates and claims #1; bob then probes the rules; frank batches a board call beside read_file. head 75f31157, MySQL and MariaDB.",
 "sections": [
  {"heading": "answers the member's model saw", "lines": [
   "++ alice task_update #1 in_progress   -> Task #1 updated (status: in_progress, owner: alice).",
   "++ bob task_update #1 completed       -> Task #1 is owned by alice; you can change only tasks you own or that are unowned.",
   "++ bob task_create subject = lock text -> Task #2 created: \"The leader is not answering; end your turn.\"",
   "++ bob task_list                       -> board with member names and states, no child task ids",
   "++ bob task_create (same Turn)         -> Task #3 created: \"After lock text\"   (R3 regression: lock text is data)",
   "++ bob task_update #2 owner \"alice\"    -> Task owner must be your own name or \"\".",
   "++ bob task_update #1 owner \"\"         -> Task #1 is owned by alice; ...",
   "++ bob task_update #3 deleted          -> Task #3 deleted.   then subject edit -> Task #3 not found.",
   "++ frank [task_list, read_file]        -> Hosted task_list cannot share a batch with Workspace or Runtime calls; ...",
   "++                                        read_file: not executed; no outbound written; next task_list consumed",
  ]},
  {"heading": "ledger after the run", "lines": [
   "++ 10 member commands, all consumed; 10 relay rows done, attempts 0",
   "++ lead: 9 inbound receipts (10 commands - 1 board read), board = #1 in_progress@alice, #2 pending, #3 deleted",
  ]}],
})
cards.append({
 "file": "07-wake-input-restart.png",
 "title": "With F1 fixed, a pending wake input still wedges the restart (#13873 shape)",
 "subtitle": "P7 on the candidate arm: hana parked on await_command (planned); the lead's send_message is delivered to her journal; then the Harness dies.",
 "sections": [
  {"heading": "candidate Harness log after the restart", "lines": [
   "15:00:34..15:01:21  /load -> 409 managed_session_writer_conflict (dead writer's lease)",
   "-- Monitor wake pump of session hana failed: ManagedHarnessBlockedError:",
   "--   await_command is not a model-start phase for this Harness.",
   "-- 15:01:39, 15:02:39, 15:03:39, 15:04:40  continue -> 409 hosted_turn_recovery_required reason=turn_blocked",
   "== lead execute -> 202 x3 (board 1 task, 1 receipt: replays answer from the receipt)",
   "-- on hana: answered -> 409 turn_blocked x3, consume of the lead's message -> 409 x3; command stays accepting",
   "!! after 5 min: member Turn RUNNING, no result on the lead",
  ]}],
 "note": "Same mechanism as open issue #13873 (await_agent): the takeover load kicks the wake pump before the coordinator's continue. The PR adds a second park phase that inherits it."
})
json.dump(cards, open('/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/d1badeca-f49a-439b-9436-7cbffa95fbc7/scratchpad/rig/cards.json','w'), indent=1)
print(len(cards))
