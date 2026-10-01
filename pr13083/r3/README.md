# Round 3 (head b4e9d71b, rebased onto #13110)

Label prefixes: h7- = b4e9d71b; h6st- = 912c3b57 (second tool round); h7cand*/h7c2*- = b4e9d71b + candidate-r3.patch
(h7candcl/h7candst/h7cand- = candidate A only; h7c2/h7c2r/h7c2no/h7cand2- = candidate A+B).

s2 env switches: RIG_FILE_HISTORY=1 reads /files/history and undoes the taken-over prompt; RIG_COLD_LOAD=1 loads the
finished Session on a fresh Harness (h7cl, h7candcl); RIG_SECOND_TOOL=1 makes the scripted model ask for a second
write after the parked one (h7st, h7st5 = 5 min wait, h6st, h7candst, h7c2). RIG_NEXT_OWNER (h7c2no) is not used in the
report: Workspace Sessions accept one Turn through the public API (submitTurn -> 409 workspace_unavailable, also on main).

results/unit: core src/managed-runtime and cli src/serve/hosted* on candidate A+B. results/mut: round-2 mutants on h7
and the A+B control run. results/s2/logs: Harness B logs of the stuck runs ("recovery blocked").
