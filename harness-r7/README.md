# PR #12267 round 7 harness (head 54c6407f69)

Verifies `fix(core): isolate redirected sandbox stdin` — the author's fix for R6-1
(round 6 reported: `qwen sandbox -- <cmd> < file|dir` handed the confined command the
caller's own host descriptor as fd 0, letting it write through the read-only policy).

Single-variable A/B. The fix commit `54c6407` differs from its parent `0b4349f`
(the rebased round-6 head, which HAD the escape) **only** in `bwrap-relay.ts`
(+ its new test) — `git diff --stat` confirms. `cli.js` loads `dist/sandboxBwrapRelay.js`
as a runtime sibling asset, so one genuine `pnpm run bundle` (arm A = fix) plus a swap of
that single file (arm B = parent relay, bundled the same way) is a faithful single variable;
`cli.js` is byte-identical across arms. `setup-arms.sh` builds the arms; re-bundling the fix
relay from a copy reproduces the genuine build byte-for-byte modulo the source-path comment.

Host: Orange Pi 5, Linux 5.10.110-rockchip-rk3588 aarch64, bubblewrap 0.6.1, Node v24.13.0,
unprivileged user namespaces enabled.

- `setup-arms.sh` — build arm A (fix) and arm B (parent relay swap); `mkhomes.sh` — operator homes
- `escape.sh` — R6-1 escape matrix (host file / dir / ws file / chmod), both arms, ro+ww
- `fifo.sh` — named FIFO edge (host inode: data intact but host mode must not change on the fix)
- `nobody2.sh` — same escape as uid 65534 (non-root), from a world-readable staging dir
- `stream.sh` + `spawn-socket.cjs` — R5-1 streaming shapes preserved on the fix arm
- `verify-checks.sh` — `qwen sandbox --verify`, both arms x 4 policies
- `toolpath2.sh` + `fake-model.js` — scripted-model `run_shell_command`; prompt piped on CLI stdin
- `mutation.sh` — run the new `bwrap-relay.test.ts`, then revert the relay to parent and re-run (RED)
- `card.py` + `c*.json` — figure renderer (pure PIL); `out/` — raw captured output
