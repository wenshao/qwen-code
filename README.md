# Evidence for PR QwenLM/qwen-code#12316

Local verification of `test(web-shell): guard Live strings on the built
transcript bundle, not the source tree` on macOS 15 (Darwin 25.6.0),
Node v24.18.1, pnpm 12.4.1.

| file | what it shows |
| --- | --- |
| `pr-12316/ab-arms.png` | Both test-file arms run against one and the same `dist/transcript.js` (3,637,133 bytes, byte-identical between `main@be9ed41afd` and the PR head): the main arm reproduces the CI failure, the PR arm is green. |
| `pr-12316/mutation-matrix.png` | Seven rows, transcript bundle rebuilt for each: two controls, three killed mutants, two survivors (one equivalent, one documented escape, one residual). |
| `pr-12316/export-renderer.png` | End-to-end check on `export-transcript-document.js`, the 1.9 MB asset every reader of an `/export html` file downloads, with a positive control. |
