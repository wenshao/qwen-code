# PR #13118 verification evidence

Head `7326290a04`, merge-base `d3c2edc606`, trial merge with main `6e34348281`. macOS 26.6.2 (arm64), Node 22.23.2, JDK 21.0.12 (Zulu), Maven 3.9.16, MySQL 8.4.7.

- `0*.png` — figures used in the PR comment; `harness/0*.html` are their sources (rendered by `harness/figures.mjs` with Playwright).
- `harness/mutants-13118.mjs` — the mutation set. The nine claimed mutants and L20/L34/L35/Q4/K36/K39/H3 are imported verbatim from the #12868 round-7 harness (`pr12868/r7/harness/mutants*.mjs` at `a8398b8ddb`, extracted to `../r7h/`); X1–X11 and X13 are new (there is no X12).
- `harness/mutate-13118.mjs` — applies one mutant at a time in a dedicated worktree and runs the owning suite (worker test file, the 24 `managed|broker|hosted` serve files, or the runtime-broker Maven module).
- `harness/artifact-parity.mjs` — normalized comparison of the two builds (bundle, cli/core dist, jars by entry CRC).
- `harness/rig/` — the real stack: `spring.sh` (Spring server jar with embedded Runtime Broker, MySQL), `proxy.mjs` (Broker → worker HTTP tap and answer substitution), `s13118.mjs` (sections A–H), `restart.sh` (swap worker bundle or jar).
- `harness/probe-r1-3.test-snippet.ts` — the temporary test inserted once into the PR head test file for the early/late release probe (not part of the PR).
- `results/` — raw matrix logs, parity output, probe logs, 20-round and shuffled runs.
