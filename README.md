# PR #11413 verification assets

Figures for the independent local verification of QwenLM/qwen-code#11413
(`fix(web-shell): avoid duplicate cold session restoration`), head `54a64e4b75`,
merge base `3a262e0914`.

Rig: real Chromium + real web-shell dev builds (base and PR head, side by side)
against ONE real `qwen serve` daemon built from the merge base, reached through a
counting reverse proxy. Linux (Debian 13, Node 22.22.2).
