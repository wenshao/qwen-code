# Round 4 (head 7ae1fa05; merged mid-round as squash 728c13de, identical on the PR's 36 files)

Label prefixes: h8- = 7ae1fa05; h8st- = 7ae1fa05 with a second tool round; h8c-/h8cand- = 7ae1fa05 + candidate-r4.patch
(candidate C: the passive takeover acquires the Runtime Session before reading status); h7-*db-cancel* = b4e9d71b (round 3).

s2 env switches: RIG_FILE_HISTORY=1 (history + undo of the taken-over prompt), RIG_COLD_LOAD=1 (fresh-Harness load of the
finished Session), RIG_SECOND_TOOL=1 (scripted second write after the parked one).
Faults db-cancel / db-cancel-drop-reply: after owner A dies the rig applies the store's cancel transition
(managed_agent_turn.status = 'CANCELLING', as insertCancelCommand does; the public API refuses cancel for Workspace
Sessions), then owner B's coordinator runs the passive takeover + managed-runtime/cancel; -drop-reply drops the first
cancel reply. results/s2/logs: Harness B logs of the cancel runs (Broker 404/503 lines).

results/mut: mutants on 7ae1fa05 (changed CLI vitest files; failures re-run alone before counting; N02 is caught by core
managed-harness-factory.test.ts, run separately) and the candidate C control run.
