# PR #13265 round 3 (head 210847dd0e)

- **macOS:** the head's Spring jar on a native MySQL 8.4.7 (port 13266). The
  colima data disk that held the MariaDB container was full (another rig's
  volumes, not this PR). The head's built `packages/core` and
  `packages/cli` dist drive it over the HTTP session store.
- **Linux:** a privileged container (kernel 6.8, cgroup v2, cgroupns private,
  delegated root `/sys/fs/cgroup/h3`), node 22.23.2, running the head's
  core/cli dist directly.

Three Linux builds are compared:

| Folder | What it is |
| --- | --- |
| `head3` | Dist of `210847dd0e` as built. Every named unit is refused, see `l12-create-named-head3.log`. |
| `cand3` | `head3` with only the empty-string check replaced by `'\0'` at both sites. This exposes the next layer: the membership race (`l13-cand3.log`) and the terminate race (`l14-cand3.log`). |
| `cand4` | `candidate-r3.patch` compiled from source with esbuild (`l1-cand4.log`, `l13-cand4.log`, `l14-cand4.log`). |

`candidate-r3.patch` is against 210847dd0e; apply it with `git apply` from the
repo root. It touches two files with six edits. On macOS: hooks and
supervisor 1167 tests, background/context-worker/env-guard 779 tests, `tsc`
clean.

Notes
- `s6-hosted-child-runs.log` drives the PR's built `HostedChildRunSession`.
  `child_run` is enabled only inside the rig process, as before.
- The T62/J62 mutants are classified as real gaps by `targeted.jsonl`:
  the head refuses input 0 and the mutant accepts it. The 200k random walk
  did not reach that shape.
- The Hosted CLI suites on the trial merge with main had one failure. It was
  the PreToolUse `'ask'` `vi.waitFor` case, which passed 3/3 when rerun
  alone on both the merge and the head (host load ~30).
- head moved to 9b8d87536a (hosted-workspace-tool-turn.ts only) while this round was being written up; its CLI suites were rerun (ts-cli-head-9b8d87536a.txt; the 2 hosted-harness-session failures pass 3/3 alone on both heads).
