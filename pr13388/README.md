# PR #13388 verification evidence (head 07849a18f0, merge-base 6136786c0c = main)

Host: macOS 26 arm64, 10 cores. Zulu JDK 21.0.12 (JDK 25.0.4 for controls). Native MySQL 8.4.7, binlog off, innodb_lock_wait_timeout 50 s.

- `01-…png`, `02-…png`, `03-…png`: the figures in the PR comment.
- `candidate/`: `BrokerRenewalPinningTest.java` (witness for BindingRenewal), `witness-carrier-sizing.patch`, `createOrLoad-single-flight.patch`, `session-event-hub-condition.patch`.
- `rig/`: `burst.mjs` (packaged stack: Spring fat jar + embedded Runtime Broker + `dist/cli.js serve --profile hosted-harness` + fake OpenAI model), `configs/*.json` (one file per cell), `mutate.mjs` (single-site mutants), the shell runners, and `build.mjs` (figures).
- `results/`: `stack.json` and `stack.txt` (every packaged-stack round), `mutants.tsv`, `witnesses.txt`, `suites.txt`.
- `dumps/`: jcmd virtual-thread dumps of the base wedge (10 Turns) and the head wedge (64 Turns), the 20 s mid-run InnoDB and thread snapshots of a cold 32-Turn burst on head, and `-Djdk.tracePinnedThreads=full` stacks for base, head and the candidate.

Arms: `pr` = head; `base` = head with both main files reverted to the merge-base; `mstream` / `mbroker` = only one file reverted; `mbr` = only the BindingRenewal class reverted; `cand` = head + createOrLoad single-flight; `cand2` = `cand` + Condition-based SessionEventHub. Each arm has its own Maven repository, and every fat jar was checked with javap before use.
