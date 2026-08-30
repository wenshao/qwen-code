# PR #10383 — local verification evidence

Real-environment verification of QwenLM/qwen-code#10383 (OpenTUI migration
batch 4 — dialogs, commands, session-rewind) at head `eb63b2b3c4`.

* `01-help-width.png` — HelpOverlay rendered through the real OpenTUI
  renderer at terminal widths 100 / 60 / 46.
* `02-gallery.png` — first real render of four modules that ship with zero
  tests in this batch.
* `03-skills.png` — OpenTuiSkillsDialog row layout under the real renderer.
* `raw/` — harness sources, captured frames, and machine-readable results.

Harnesses run under Bun 1.3.14 (the `@opentui/core` 0.5.8 native FFI backend
requires Bun or a Node build exposing `node:ffi`; Node 24.18.1 has neither).
