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
