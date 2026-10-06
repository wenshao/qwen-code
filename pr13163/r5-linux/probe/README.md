# PR #13163 round 5 rig (verification only)

Real stack on Linux aarch64: `managed-agent-server` fat jar (embedded Runtime Broker, durable local process),
packaged Hosted Harness (`dist/cli.js serve --profile hosted-harness`), MySQL 8.0.45, `model.mjs` (scripted
OpenAI-compatible model), `tap.mjs` in front of the Harness (and a second instance in front of the Broker for the
race). Arms: `head` = eb3b9336, `base` = 43a6e1e5 (main side of its last merge), `h1` = head bundle with the
one `resident.mcpRecovering=true;` statement from b6eff8f4 removed.

- `batch5.sh` (head matrix), `batch5b.sh` (main A/B subset), `cold5.sh` (Spring restart with the Session Store on a
  second replica), `td.sh` + `td-race.mjs` (teardown vs passive adoption), `r62-rename-race.mjs` (R6-2),
  `ui5.sh` + `c13-ui-cancel.mjs` + `fixture/` (WebShell), `seq5*.sh` (ordering).
- `tsmut13.mjs` / `javamut13.mjs`: mutation drivers; ledgers in `../ledgers/`.
- `rig.env` (local throwaway tokens and ports) is not published.
