# PR 12732 verification rig

Real `node dist/cli.js managed-runtime-worker` processes, boot document on stdin, every request over HTTP.
`lib.mjs` defaults: `PR_REPO=~/git/qwen-code-pr12732` (head 42d6f28a51), `MAIN_REPO=~/git/qwen-code-pr12732-main` (85c16ae878), both after `pnpm install`.

- `s1-boot-ab.mjs` boot/route matrix, main vs PR
- `s2-acceptance.mjs` two Workspaces x Sessions in different directories
- `s3-directory.mjs`, `s3b-root.mjs` directory checks and root replacement on APFS
- `s4b-remount-arms.mjs` hdiutil remount matrix (PR / `dist-mut-dev` / `dist-cand-birth`)
- `s5-linux-loop.mjs`, `s6-btime.sh` the same on ext4 loop mounts (`docker run --privileged node:24-bookworm`)
- `s7-env-concurrency.mjs` QWEN_CODE_PROJECT_DIR and 16-way concurrency
- `s8b-heap.mjs` + `probe-mem.mjs` heapUsed after full GC (preloaded probe, SIGUSR2); `snapdiff.mjs` heap snapshot diff
- `candidate-ajv-compile-once.patch` candidate for F2 (core schemaValidator.ts + a test)

Mutant/candidate dists are copies of `dist/` with one minified line changed in `chunks/managed-runtime-attestation-worker-*.js`
(`pinned.dev!==rootStats.dev||` removed, or `birth:rootStats.birthtimeNs` added) or in the chunk holding `validator.compile(anySchema)`.
