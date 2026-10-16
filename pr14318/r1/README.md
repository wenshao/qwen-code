# PR #14318 maintainer verification — round 1 (head `0b3431d5a9`)

Real-stack verification on the maintainer host: native macOS 10.15.7 x86_64 Spring
control plane + embedded Runtime Broker, Hosted Harness (bundled `cli.js`,
SHA256 `c2f729f954fdea1e66958e73bb77632ad8c0502fb64b73e6215ede94ca8e6a78`),
deterministic OpenAI-compatible model stub, real MySQL 8.0.23, and a real SSH
worker over loopback OpenSSH to the same host (Node.js v22.23.3). JDK 21,
Maven 3.9.9, frozen pnpm install.

## Evidence files

| File | Content |
| --- | --- |
| `r1-register-boundary.log` / `.json` | Registration boundary probe: 16/16 PASS |
| `r2-session-flow.log` / `.json` | Session lifecycle probe: 20/20 PASS |
| `flyway-before.tsv` / `flyway-after.tsv` | Flyway history around the V6→V7 upgrade |
| `data-hashes.txt` | SHA-256 of the full v6v7 data dump before/after upgrade (identical) |

## What was run

1. **Registration boundary** — node visibility by actor (alice sees `loopmac`,
   mallory sees none), check-directory allowed/refused/forbidden,
   `/workspaces/register` 202 → durable operation → completed, idempotent replay
   returns the original operation, overlapping physical ownership durably refused
   (`recovery_blocked` / `ssh_runtime_identity_mismatch`), remote-shaped payloads
   to `/workspaces/create` all 400, local create correctly reports
   `workspace_creation_unavailable` on macOS (verified-workspace-recovery is
   Linux-only).
2. **Session lifecycle** — session on the SSH-registered workspace; turn 1
   write_file→edit→read_file through the SSH worker with 2 real approvals
   (approval mode `default`); turn 2 reuse with the same original worker PID;
   foreground `run_shell_command` (`pwd`) with a real approval, executed in the
   workspace directory; background `run_shell_command` refused at the tool
   boundary ("Hosted Shell requires a foreground command…"); slow turn cancelled
   (CANCELLED, no late write); normal close → session CLOSED, original worker
   process retired with `stop.json`/`clean.json` proofs; post-close turn 409.
3. **V6→V7 migration** — merge-base (`52ae53b02a`) server jar booted a genuine
   V1–V6 catalog on MySQL; 2,461 real server-produced rows loaded (sessions,
   turns, operations, bindings; non-default `selected_approval_mode='auto-edit'`
   with `approval_revision=3` on one session and one turn); head jar boot applied
   V7; V1–V6 Flyway rows byte-identical (checksums preserved), V7 appended; full
   data dump hash identical before/after; a post-upgrade SSH registration was
   admitted and completed.

## Not covered here

- Browser UI screenshots: this host has no Chrome/Chromium and its Playwright
  1.61 requires macOS 12+, so no UI captures were possible. The web-shell
  registration UI is covered by the PR's own Chromium smoke cases.
- Local `/workspaces/create` positive path: correctly unavailable on macOS
  (Linux-only verified workspace recovery), matching the author's report.
- The brief stall of the post-upgrade registration while two control planes
  shared one SSH node (rig-only artifact; completed once the s1 control plane
  stopped) is a deployment topology the design excludes.
