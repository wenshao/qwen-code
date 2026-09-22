# PR #12267 — Round 8 (delta only), head `54c6407f69`

Independent maintainer verification on **x86_64** of `fix(core): isolate redirected sandbox stdin` (the R6-1 fix), plus three findings not covered by rounds 1–7 or the tracking issue #12417.

## Rig & arms

- Linux 6.12.63 **x86_64**, Node v22.22.2, bubblewrap 0.12.0 (host `/usr/bin/bwrap` was missing this session, so all runs use a private-mount overlay that adds bwrap 0.12.0 — the host is untouched).
- Single-variable A/B. `head` = `54c6407f69`; `pre` = its parent `0b4349f088` (the rebased round-6 head). The two differ **only** in `bwrap-relay.ts` + its new test. `cli.js` is byte-identical; the `pre` arm is `head`'s bundle with `dist/sandboxBwrapRelay.js` swapped for the parent build, and re-bundling the head relay from a copy reproduces the genuine build byte-for-byte.

## Verdict

**R6-1 is fixed and holds on x86_64 too; the security fix is solid and this delta is mergeable.** The two new items below (N1, N2) are minor correctness **regressions introduced by this exact commit** that affect only the human `qwen sandbox -- <cmd>` subcommand — the model tool path uses `stdin=/dev/null`, so it is not affected. Non-blocking, but worth folding into #12417 or a one-line follow-up. N3 is a by-design boundary note.

## Figures

1. `imgs/r8-01-r61-escape-ab.png` — R6-1 escape A/B (file / dir `..` walk / chmod): `pre` escapes all three, `head` blocks all three.
2. `imgs/r8-02-stdin-overread.png` — N1: `head` over-reads a redirected regular file (262144 bytes of the caller's stdin silently consumed).
3. `imgs/r8-03-fifo-hang.png` — N2: `head` blocks until the FIFO writer closes; return time tracks the writer's hold (3 s→3.0 s, 6 s→6.0 s), `pre` is flat at ~0.6 s.
4. `imgs/r8-04-gates-and-notes.png` — gates (281/281, relay 3/3, revert→2/3), R5 no-regression, `--verify`, and the N3 note.

## N1 — `qwen sandbox -- <cmd>` over-reads a redirected regular file (new regression)

The fix copies a host-backed fd 0 via `createReadStream(fd:0)`. For a **regular file**, that stream reads ahead bytes the confined command never consumes, and because bash shares one file offset across the redirect, a later reader of the same descriptor loses them.

- `{ qwen sandbox -- true; wc -c; } < big.txt` (14,888,896 B): `pre` leaves all 14,888,896 for `wc`; `head` leaves 14,626,752 — **262,144 B silently consumed**, deterministic across runs.
- `while read -r x; do qwen sandbox -- echo "$x"; done < list.txt`: `pre` sees all 5 lines; `head` sees only the first (the relay drained to EOF on iteration 1).

Pre-fix inherited the fd, so the offset advanced only by what the command actually read.

## N2 — a redirected named FIFO hangs the CLI until the writer closes (new regression)

For a copied descriptor whose peer stays open (a **named FIFO**), the relay's blocking read sits in the libuv threadpool. When the command exits, `child.on('close')` fires `source.destroy()`, but that cannot cancel an in-flight kernel read on the FIFO, so the CLI stays alive until the writer closes.

- `qwen sandbox -- head -n1 < f.fifo` with a background writer that sends one line then holds the FIFO open: `head` returns in 3033 ms / 6041 ms for 3 s / 6 s holds (tracks the writer exactly); `pre` returns in ~0.6 s as soon as `head` exits. Process tree confirms a `libuv-worker` stuck in `pipe_read`.

## N3 — an inherited INET socket keeps the host netns (boundary note, by-design)

A live socket redirected to stdin (`< /dev/tcp/host/port`) is inherited by design (`isSocket()` ⇒ shared). It keeps the **host** network namespace, so under `network: closed` the command can still send to that already-connected host peer through fd 0, even though **new** connections are refused (`127.0.0.1:47002` → `Connection refused`, but writing to the fd-0 peer reaches the host listener). Same class as the intentionally-shared char-device/TTY case already tracked in #12417 — noted for completeness, not a blocker.

## Suggested fix direction (N1/N2)

Both stem from copying host-backed descriptors with an eager, uncancellable `createReadStream`. Options: (a) only copy when the command actually reads (or bound the read to what it consumes), and (b) when the command exits, stop waiting on a copied descriptor whose read cannot be cancelled — e.g. open the copy source `O_NONBLOCK`, or force process exit once the child has closed and stdout/stderr are flushed. A candidate relay patch and a differential harness are under `harness/`.

## Gates at `54c6407f69` (x86_64)

- core `src/sandbox/**` + `shellExecutionService.test.ts`: 281/281.
- new `bwrap-relay.test.ts`: 3/3; reverting `bwrap-relay.ts` to the parent (keeping the test) → 2/3 fail (host-file + host-dir), anon-pipe stays green ⇒ the test discriminates the fix.
- R5 streaming unchanged on head: 1 MiB pipe→sha256 5/5, segmented pipe, 3 GiB sparse `< file`; `--verify` 4 checks each for read-only/workspace-write × closed/open.
- Tested head == PR head `54c6407f69`.
