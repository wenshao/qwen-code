# PR #12784 maintainer verification evidence

- base = origin/main 34ad20a; head = 34ad20a + PR head f4244f9 (merge tree d24939a). Both built from source on macOS (pnpm install, build, bundle), Node 24.18.1.
- `f1.png`: main-session system prompt captured on the wire from the real `dist/cli.js` (logging proxy), with provider-billed prompt_tokens.
- `f2.png`: 384-render matrix per arm, declared-tool gating check, reproduction of the PR token table, and the numbers in `docs/verification/resident-tool-prompt-assembly/README.md`.
- `f3.png`: 9-mutation matrix on `prompts.ts`, before and after the suggested 3-line test addition (`data/suggested-test.patch`).
- `f4.png`: 120 real-model headless runs (qwen3.8-max, deepseek-v4.1-flash): todo_write usage, added comments, independent outcome checks.
- `harness/`: renderer, proxy (reads the key from ~/.qwen/settings.json at startup, never writes it), run driver, scorer, mutation driver, figure builder.
- `data/`: raw results; `suggested-doc.patch` updates the three stale numbers in the verification doc.
