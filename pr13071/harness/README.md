# PR #13071 (D6a Hosted tool approvals) — Linux real-stack verification harness

Linux port of the real-stack verification for PR #13071, assembled 2026-09-30 on
Linux 6.6.89-cix, Node v24.14.0. Reuses the PR #12894 rig's MySQL + Spring jar
(Session Store + embedded Runtime Broker); only the drivers and the wiring are new.

## Stack

- MySQL 8.4 in docker (`mysql84-rig`, port 13894), database `d6a`.
- Spring server jar `/root/jars/pr-server.jar` (built 2026-09-29): Session Store
  on `127.0.0.1:18897`, Runtime Broker on `127.0.0.1:19897`, workspace mount
  `st-a` at `/root/rig13071/roots/a`. Start with `up.sh` (wraps the #12894 rig's
  `spring.sh`).
- Hosted Harness: the PR worktree's packaged bundle
  (`/root/git/qwen-code-pr13071/dist/cli.js serve --profile hosted-harness`),
  one process per phase, started by the drivers (`Harness` in `lib.mjs`).
- Fake OpenAI model (`integration-tests/fake-openai-server.ts` from the PR
  worktree) scripted to call `write_file` / `read_file` / `edit`.
- The driver speaks the Harness private Session API directly, as the D6b Java
  slice will. Current Java cannot enable asking modes, so the Java side is used
  only to allocate the workspace session (broker binding), exactly like a
  `yolo` deployment today.

## What the drivers verify independently

Beyond the Harness HTTP responses, the drivers read the **committed** bytes in
MySQL directly: `qwen_managed_session_journal_tx.record_bytes` (NDJSON of
`managed_session_event_v1` records; `action.changed` events carry the Action
state) and `qwen_managed_session_resource.inline_bytes` (the `managed-definition`
and `managed-action-options` resources). This is what the D6b projection will
read through the Store.

## Phases

| Phase | Driver | Checks |
| --- | --- | --- |
| A | `a-validate.ts` | mode pinning, `approvalMode` echo on create/load, `plan`/`auto`/bad timeouts → 400, yolo definition bytes unchanged |
| B | `b-allow.ts` | ask before `write_file`, nothing dispatched while waiting, allow → runs, replay → 200, conflict → 409, deny → refusal, error codes 400/404/409 |
| C | `c-expiry.ts` | 5 s timeout: expiry, later calls refused without asking, late resolve → 409 `action_expired` |
| D | `d-cancel.ts` | cancel while waiting: Action cancelled, workspace released, turn cancelled; next turn works |
| E | `e-preapproved.ts` | `read_file` (default), `write_file`+`edit` (auto-edit), everything (yolo) never ask |
| F | `f-restart.ts` | SIGKILL the Harness while waiting; new Harness load → 409 `hosted_turn_recovery_required` (after the 60 s writer lease drains; retry 503s) |
| G | `g-journal-fail.ts` | journal 503 while waiting: resolve → 409, session blocked in <1 s, blocked session writes nothing |

Run: `up.sh`, then per phase `cd /root/rig13071 && /root/git/qwen-code-pr13071/node_modules/.bin/tsx <driver>`.

## Gotchas carried over from the #12894 rig

- `BROKER_TOKEN=rig-broker-token-12894` must match the Spring launch token.
- A crashed driver strands the broker workspace lease (`workspace_busy` on the
  next run): `DELETE FROM managed_workspace_execution_lease` in the rig DB, and
  kill leftover `…/dist/cli.js managed-runtime-worker` processes of this worktree.
- A SIGKILLed Harness holds the Store writer lease for `leaseDurationMs` (60 s);
  a new writer's load answers 503 `managed_session_open_failed` until it drains.
- `mysql-cli` from the #12894 rig wraps `docker exec` and strips `-h/-P`.
