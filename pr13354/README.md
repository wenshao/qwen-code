# PR #13354 real-stack verification evidence

- `0{1,2,3}-*.png` — figures used in the PR comment.
- `rig/` — verification rig: container launch scripts (`lx/`), probes (`probe/`), suite/batch drivers, figure builder. Tokens, keys and the DB password are redacted.
- `results/<db>/` — probe transcripts (`*.log`) and machine-readable results (`*.json`) per database / arm.
- `logs/` — Harness/Spring excerpts for R3-1, a Spring thread dump and JFR park events from the contention wedge.
- `candidate-r3-1.patch` — daemon-only candidate (lifecycle load re-addresses the live attachment) + 2 tests; on the real stack it removes the 409 but the SessionEnd dispatch still fails (same as `c65e46d04e`).
