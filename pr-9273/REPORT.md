## Maintainer verification — PR #9273 @ `5936b9f118` (real tmux + real freeze, built CLI)

**Verdict: not ready to merge as-is. One blocking defect, with a one-line fix that I verified.** The `png` evidence rung writes an **SVG** file whenever a real `freeze` is installed. Everything else I exercised end to end behaves as the header contract says: tmux isolation, the refusal contract, `--until`/`--ready`/`--keys`, signal reaping, and the orphan sweep in `review cleanup`. I also recommend one test-hygiene fix before merge: a fixture that creates the host's real tmux socket dir with unsafe permissions.

### Environment

- PR head `5936b9f1185319be5ac9213fffb4fccb1ecc09c2`, in a fresh worktree. `pnpm install --frozen-lockfile`, `npm run build` and `npm run bundle` all exit 0, and every run uses the built `dist/cli.js`.
- Debian 13 (Linux 6.12), Node 22.22.2, **tmux 3.5a**, and the **freeze v0.2.2** release binary (`freeze_0.2.2_Linux_x86_64.tar.gz`, the version named in the PR body).
- The PR merges cleanly into current `main` `eb0b79c5b8` (`git merge-tree`; no overlap with the 9 commits main has gained).
- CI on this head: every lane that ran is green. The macOS and Windows test lanes were **skipped**.

### Findings

| # | Severity | What | Fix verified? |
| --- | --- | --- | --- |
| 1 | **Blocking** | With a real `freeze`, the manifest says `evidence: "png"` but `<out>.png` contains **SVG XML**, and the repo's own publish gate rejects it | ✅ one line; `capture-tui` suite unchanged (178 ✔ / 4 skip) |
| 2 | Should-fix (test-only) | The base-alias fixture creates the host's **real** `/tmp/tmux-<uid>` as 0755. Real tmux, including the developer's own, then refuses that directory, and 67 later tests cascade-fail | ✅ `mkdir -p -m 700`; 329 pass / 1 skip |
| 3 | Suggestion | On this Linux host the default freeze font is proportional, so PNG columns don't line up. freeze also drops reverse video and background colour | ✅ `--font.family monospace` restores alignment |
| 4 | Nit | A SIGKILLed launcher leaves its zero-byte `qwen-capture-ready-<pid>-<nonce>` in `$TMPDIR`, and `review cleanup` doesn't sweep it | — |

I checked findings 1–4 against all 447 inline comments, 281 reviews and 34 issue comments on this PR and found no earlier report of any of them. Finding 2 sharpens the takeover comment's residual-risk row for the "base-alias test fixture". That row rates it fails-closed ("a regular file … is planted and unlinked"). The measured blast radius is larger, details below.

---

#### 1. Blocking: the `png` rung produces an SVG file with a real freeze

![finding 1](fig2-png-rung-is-svg.png)

- **Root cause.** freeze v0.2.2 chooses its output format **from the `--output` extension** (`freeze --help`: "Output location for .svg, .png, or .webp"). Anything else falls back to SVG. Since `d2a57afb82` (2026-08-18, the staged-render fix for the R5-2 symlink race), `capture-tui.ts:2208` renders to `` `${pngPath}.render-${renderNonce}` ``. That extension is `.render-<hex>`, so freeze writes SVG. The SVG is then `rename()`d onto `<out>.png` and credited as the `png` rung.
- **Impact.**
  - Every capture on a host with freeze has this problem; the format choice does not depend on the platform.
  - The manifest misstates its own evidence rung, which is the property this PR exists to guarantee.
  - The documented pipeline breaks at the next step. `review/lib/assets.ts` `validateAssetContent('cap.png', …)` returns `{"ok":false,"reason":"content is not a recognized image but the extension claims png — evidence is admitted by content, not by name"}`, so `publish-assets` refuses the very file `capture-tui` certified.
  - The macOS + freeze 0.2.2 result in the PR body's "Tested on" table was first written on 2026-08-16, two days before `d2a57afb82`.
- **Why the suite can't see it.** Every fake freeze writes `printf 'PNG-BYTES' > "$5"` whatever the extension. With the fix applied the suite is still `178 passed | 4 skipped`, the same as at head, so no test pins the output format.
- **Fix, verified.**

  ```diff
  -    const pngStage = `${pngPath}.render-${renderNonce}`;
  +    const pngStage = `${pngPath}.render-${renderNonce}.png`;
  ```

  After the rebuild, `file cap.png` reports `PNG image data, …`. Reverting to head reproduces `SVG XML document` (negative control), and the worktree is clean afterwards.
- **Suggested pin.** Two options; either makes a regression go red:
  - Make one fake freeze honour the extension (write PNG magic only when `$5` ends in `.png`).
  - Before crediting the rung, run the existing `sniffImageFormat` over the rendered file and degrade to `ans-only` when it doesn't sniff as `png`. This also guards against any future freeze behaviour change.

#### 2. Should-fix (test-only): the base-alias fixture creates the real `/tmp/tmux-<uid>` with 0755

![finding 2](fig3-socket-dir-0755.png)

- **Where.** `capture-tui.test.ts:822` sets `TMUX_TMPDIR='/tmp/'` ("visits a base once even when two candidate strings name it"). Its fake tmux (`:800`) runs `mkdir -p "${TMUX_TMPDIR}/tmux-$(id -u)"` with the default umask.
- **Effect.** On a host where that directory doesn't exist yet (a fresh container, a CI box, or no tmux since boot), the test creates the **real** socket dir as `drwxr-xr-x`. From then on, every real tmux for that uid fails with `directory /tmp/tmux-1000 has unsafe permissions` (exit 1). That includes the developer's own `tmux` after a local test run, until they remove or chmod the directory.
- **Measured as non-root.** I used a user namespace (uid 0 → 1000, no capabilities); this also un-skips the three uid-0-gated tests.
  - Directory absent at the start: **67 failed | 262 passed | 1 skipped**, all from the unsafe-permissions refusal. 0 failures come before the alias test in file order and 67 after it.
  - Directory pre-created 0700 by real tmux: **329 passed | 1 skipped**.
  - CI is green presumably because the directory already exists by the time this test runs there. The absent-directory shape is never exercised.
- **Fix, verified.** Change it to `mkdir -p -m 700 …` at `:800`. The same pattern also appears at `:883`, `:1156`, `:1412` and `:1622`, which are harmless under their mkdtemp bases. With the directory absent at the start, the run then gives **329 passed | 1 skipped** and the directory comes out `drwx------`.

#### 3. Suggestion: the PNG rung is not column-faithful on this Linux host

![finding 3](fig5-freeze-fidelity.png)

- **Fonts.** freeze embeds JetBrains Mono in its SVG, but the PNG it rasterizes on this host uses a **proportional** font. Measured on qwen's own TUI captured at 80 columns: the header box's right border lands at a different x on every row. A verdict that "quotes pixels" off this image (the brief's "right border at column 83" pattern) would report a layout bug that the `.ans` does not contain.
  - Passing `--font.family monospace` (generic family, no font file needed) restores alignment; I checked this on the same `.ans`.
  - Adding it to `freezePlan` is cheap.
- **Colours.** In both renders, freeze drops reverse video (SGR 7) and background colour (SGR 44), although the `.ans` carries both. Ink uses inverse for cursor and selection, so claims about highlighting can't be settled from the PNG. That caveat probably belongs in `degradedBecause` or the brief.

#### 4. Nit: ready sentinel left behind after SIGKILL

After `kill -9` of the launcher, `review cleanup` reaps the orphan server, its socket and its pane process correctly. The zero-byte `qwen-capture-ready-<pid>-<nonce>` in `$TMPDIR` stays behind. The sweep could remove `qwen-capture-ready-<deadpid>-*` alongside the socket.

---

### What I verified works

![e2e](fig1-e2e.png)

38 checks, 37 ✔. The one ✘ is S2, which is finding 1.

| Scenario | Result |
| --- | --- |
| **S1** PR body's own example, freeze absent | exit 0 in ~340 ms (settles on `--until`, not on the `sleep 30`). `.ans` carries `ESC[31mRED`. Manifest is `ans-only` and `degradedBecause` names freeze. No server or socket left |
| **S3** isolation, launched **from inside the user's own tmux session** (`$TMUX` set) | The user's session is still alive at 100x30 (not resized to 40x6), its pane bytes are identical, and the capture holds only its own pane |
| **S4** refusal contract | `--out ''`, tmux not on PATH, `--until '('`, `--cols 0`, and a foreign `<out>.ans` all give exit 3, a stderr reason and `{"captured":false,"evidence":"none",…}`, with no manifest. The foreign file is byte-identical afterwards |
| **S5** re-used `--out` | The previous run's own artifacts are replaced, exit 0 |
| **S6** `--until` timeout; `--ready` + `--keys` | Timeout: captured anyway with `settledBy:"timeout"` and the reason recorded. Keys: typed only after `NAME?` rendered, and the `HI-alice` reply was captured. When `--ready` never matched, `keysSent:false` and the keys were withheld |
| **S7** signals and orphans | SIGTERM gives exit 143 and SIGINT exit 130; each reaps the server and writes no manifest. After SIGKILL a live orphan remains, and `review cleanup pr-…` prints "Reaped orphaned capture server: …"; the server pid, pane process and socket are gone. A concurrently **live** capture and the user's own server were untouched, and a second `cleanup` finds nothing |
| **S8** documented non-goal | A `setsid`'d grandchild survives the reap, exactly as the header documents |

Real-product capture: qwen's own TUI (`node dist/cli.js`, fake key, isolated HOME), captured at 80 and 120 columns with `--until "Type your message"`. Both captures settled by `until-match` and left no server behind. The `.ans` replays faithfully (xterm.js):

![qwen TUI](fig4-qwen-tui-capture.png)

**Unit suites (local, at head).**

- As root, the PR's six touched CLI suites give **775 passed | 4 skipped**. Three skips are uid-0-gated; one needs a padding tmux (3.1–3.2).
- As non-root with the socket directory present: `capture-tui` + `cleanup` + `tui-capture` give **329 passed | 1 skipped**. The three uid-0-gated refusal tests run and pass.
- CI's Linux Test lane runs the real-tmux tests (`capture-tui.test.ts 181 ✅ 1 ⚪`). That answers the stage-3 triage's open question.

### Not verified

- macOS and Windows: the CI test lanes were skipped and I tested Linux only.
- The tmux 3.1–3.2 padding branch: tmux 3.5a here.
- The same-uid active-adversary model, which is a stated non-goal.

### Reproduce

Harness scripts, transcripts and the candidate diff are in [`pr-9273/`](.) on the assets branch:

- `harness/run-e2e.sh` runs S1–S8.
- `harness/finding1.sh` and `harness/finding2.sh` reproduce the two findings.
- `harness/render.cjs` renders the figures.
