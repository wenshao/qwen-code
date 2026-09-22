# PR #12267 local verification assets

Screenshots from a local real-kernel verification of QwenLM/qwen-code#12267
at head `7987d74de9dd88e51589a7d7e14d1e4ddfe4d906`, against base
`fb022d9f80eee063384efd03e653df146cee7a04`.

Host: Linux 6.12.63+deb13-amd64 x86_64, bubblewrap 0.11.0, unprivileged user
namespaces enabled.

| file | what it shows |
| --- | --- |
| `imgs/04-real-kernel-verify.png` | `qwen sandbox --verify` passing on a real kernel as root and as uid 65534, plus an independent probe |
| `imgs/06-agent-shell-3arm.png` | three-arm A/B of a model-driven `run_shell_command` trying to write outside the workspace |
| `imgs/03-bang-policy-on.png` | terminal `!` shell mode confined inside the TUI, with the policy in the footer |
| `imgs/03-bang-policy-off.png` | the same binary and the same command with no policy configured |
| `imgs/02-about-policy-on.png` | `/about` reporting the effective tool boundary |
| `imgs/01-footer-policy-on.png` | the footer line added by this PR |
| `imgs/05-malformed-settings-ab.png` | base vs head on a malformed `~/.qwen/settings.json` with no sandbox policy configured |

## Round 7 (head `54c6407f69`) — verifying the R6-1 fix `fix(core): isolate redirected sandbox stdin`

Host: Orange Pi 5, Linux 5.10.110-rockchip-rk3588 aarch64, bubblewrap 0.6.1, Node v24.13.0.

| file | what it shows |
| --- | --- |
| `imgs/r7-01.png` | R6-1 A/B: parent (`0b4349`) escapes via the inherited stdin fd on all four rows; the fix (`54c6407`) blocks all four — fd 0 becomes a relay-owned pipe |
| `imgs/r7-02.png` | named FIFO edge (host inode protected) + the same escape as uid 65534 (not root-specific) |
| `imgs/r7-03.png` | no R5 regression: streaming shapes preserved, `--verify` 8/8, model tool path still confined (R6-1 never reached it) |
| `imgs/r7-04.png` | the added `bwrap-relay.test.ts` passes on the fix and goes red (2/3) when the relay is reverted to parent; broader suite 281/281 |

Harness and raw output: `harness-r7/`.
