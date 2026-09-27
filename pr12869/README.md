# PR #12869 (W0e-3) real-host verification bundle

Verified heads: `66bde476` (first pass) and `f8bf5d74` (current head; the W0e-3 commit is patch-identical).

- `01-…05-*.png`: evidence figures used in the PR comment.
- `harness/vm/`: what ran on the dedicated Linux VM. `run-server.sh` + `etc/` are the systemd unit and its
  environment, `drive.mjs` talks to the public API and to the embedded Broker, `s2-*` build the arms before a
  reboot, `s3-observe.mjs` watches SQL after it, `s4-after.mjs` checks receipts and authorization,
  `s6-acquire-cycles.mjs` / `s7-hosted-turns.mjs` measure healthy traffic, `s2h-tamper.mjs` damages registrations.
  `adapter-src/` is a rig-only authentication filter (the reference server ships none).
- `harness/*.sh`: Linux container jobs for the Maven suites. `harness/mut/`: the mutation matrix.
- `harness/candidate/`: candidate patch for F1 and its unit test, plus `RebootRecoveryGapTest` for the two mutation
  survivors that guard safety properties (all relative to `f8bf5d74`).
- `harness/cards/`, `harness/render.mjs`: sources of the figures.
- `results/`: raw output of every run quoted in the comment (`rN-*` = reboot runs, `s6-*` = healthy turns,
  `s7-*` = Hosted Harness chain, `mutation-*` = mutation verdicts).
  In the raw pass-2 consoles the `mysqlBroker` column is invalid: that step ran no test because of a rig mistake.
  `mutation-pass2.tsv` has the corrected verdicts and `mutation-pass3-broker-mysql.txt` the broker MySQL IT that was run afterwards.

The rig directory was mounted at `/rig` in containers; on the VM the same directory was reached through the host mount.
Tokens, passwords and keys in these files were generated for the rig and guard nothing.
