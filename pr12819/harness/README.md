# PR #12819 verification harness

`${SCRATCH}` is the working directory: `${SCRATCH}/wt` is a worktree at PR head d467f82c merged onto main 81c260bb
(tree d9f8284e), installed with `corepack pnpm install --frozen-lockfile` (prepare builds and bundles);
`${SCRATCH}/wt-guard` is a second worktree at the same commit, with `node_modules` symlinked to `wt`.

- `probe-routes.mjs <dist/cli.js>`: default vs hosted-harness profile route probe -> `route-probe-output.txt`
- `bundle-mutants-run.py bundle-mutants.py`: bundle mutants; main's 7-case test file vs this PR's 8-case file -> `bundle-mutants-output.txt`
- `guard-mutants-run.py`: workflow / POM / sweeper guard mutants -> `guard-mutants-output.txt`
- `java-all.sh` (uses `java-run.sh`): CI step commands against docker mysql:8.4 and mariadb:10.11.18, plus routing probes -> `java-output.txt`
- `sdk-java-trigger-replay.mjs <since> <until> <ref>`: SDK Java path-trigger replay over main's first-parent commits
- `figures.py`: renders the PNGs
