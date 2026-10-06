# PR #13265 round 13 (head c370c5582b)

Java is unchanged since b883b6631c, so the round-12 jar, Java build and J9 results (pr13265/r12/) apply.

## Files

| Directory | Contents |
| --- | --- |
| `linux-75/` | `run-75-r13.sh` and logs for head15 (the exact head) and rest15 (head15 + the two round-3 edits) |
| `macos/` | S13/S14 outputs, and S15c bounded re-drive runs (`s15c-r13-<case>.stdout`, driven by `s15c-redrive.mjs` with `FAIL_SET` / `FAIL_FOR_MS`) |
| `mutants/` | M11 (remove the selector's hasInstalledPublication getter) and M12 (MAX_REDRIVE_ATTEMPTS = 1), via `mutants-r13.mjs`; each applied to a local worktree and restored |
| `results/` | TS cli (24 files) and core suites |

The local rig database password is redacted as `<local-rig-password>`.
