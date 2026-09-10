# PR 11555 — local verification evidence

Screenshots from a local runtime verification of QwenLM/qwen-code#11555
(`test(core): cover bundled ConPTY fallback and terminal replies`).

| file | what it shows |
| --- | --- |
| `da-forwarder-e2e.png` | real `@lydell/node-pty` + real `@xterm/headless` on Linux: DA probe times out at ~2.0 s with the forwarder off, replies `ESC[?1;2c` in ~10 ms with it on |
| `double-execution-proof.png` | a real command executes twice under two pids once the post-spawn marker is removed |
| `mutation-matrix.png` | whole-suite mutation A/B, PR (153 tests) vs main (152 tests) |
| `claims-forensics.png` | what the installed xterm actually emits, and what the bundled ConPTY package ships |
