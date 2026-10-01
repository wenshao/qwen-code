# PR #13138 — real-environment verification (W1b offline Workspace recovery bundles)

Evidence for the verification comment on https://github.com/QwenLM/qwen-code/pull/13138.
Verified head `989baf22`; the bundle rebuilt at `8bd11d5a` is statement-identical apart from `GIT_COMMIT_INFO`
(`results/bundle-8bd11d5a-vs-989baf22.txt`) and no Java file changed, so every result applies to `8bd11d5a`.

| Path | Content |
| --- | --- |
| `0*.png` | Evidence cards embedded in the comment, rendered from `harness/fig/cards-*.mjs`; every value comes from the logs under `results/`. |
| `cand-unsupported-entry.patch` | Candidate fix for F1 (+54/−8 and 4 tests), applies cleanly to `989baf22` and `8bd11d5a`. |
| `cand-single-connection.patch` | One-line candidate for F2 (`SingleConnectionDataSource` in `WorkspaceRecoveryMain`), applies cleanly to both heads. |
| `results/e2e/` | Scenario logs (`s1`–`s7`, `s6b`), JSON summaries, every maintenance command's request/stdout/stderr (`w1b-*.txt`), W1a maintenance output (`maint-*.txt`) and authority snapshots (`authority-*.json`). |
| `results/console/` | Console output of each scenario run. |
| `results/unit-*.log` | PR W1b/CLI unit tests on the head, the candidate, the candidate's new tests run against the head, and the `8bd11d5a` entry tests. |
| `harness/vm/` | Scenario scripts run inside the Linux VM (`s1`–`s7`, `pop.mjs`, `w1b.mjs`, `lib.mjs`), the systemd unit and launcher, the real-OSS admin helper. |
| `harness/` | Host-side build scripts (`build-ts.sh`, `build-jar.sh`), bundle comparison (`norm-bundle.mjs`), card sources. |

Scenarios:

- **S1** runbook on the deployed stack (populate → offline + W1a fence → capture/replay/conflict/inspect/verify → authority snapshot → lift fence → original Sessions continue → verify again).
- **S2** ordinary Workspace content (venv, links, hard link, FIFO, socket, git repo) on the head and on the candidate.
- **S3** damage to a sealed bundle; loss of the original source.
- **S4** interference during a capture (late create, model-only commit, escaped writer, live writer, fence lifted).
- **S5** SIGKILL at four points + same-UUID resume; request/environment checks; source loss against a compatible bundle.
- **S6** scale (20,000 files + 1 GiB file, 77 Sessions); **S6b** SQL statement digests per asset.
- **S7** O2 output in a real Aliyun OSS bucket (temporary, private, deleted after the run).
- **S8** the same 20,000-file storage captured/verified by the PR jar and the single-connection candidate; **S6b** digest samples `head8` / `cand2`.

Notes for anyone re-running it:

- Paths are as on the rig (`/Users/wenshao/pr13138-rig`, `/opt/w1b`, `/srv/w1b`). Tokens and keys in the scripts are rig-only dummy values. The real-OSS credentials were read from a root-only file outside the rig and are not included; the bucket name is redacted.
- The local OSS double for S1–S6 accepts any signature; that is why S7 exists.
- `mkdir -p /run/systemd/resolve` + a `stub-resolv.conf` was needed in the VM for outbound DNS (colima leaves the link dangling).
