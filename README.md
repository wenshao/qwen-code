# PR #11457 — local verification assets

Screenshots and rendered harness output from a local end-to-end verification of
QwenLM/qwen-code#11457 (`feat(goal): stop a Goal at a turn or an active-time budget`)
at head `9e734b163da836b318182cdf2990cf71c9840987`.

Everything here was produced against the branch's own bundled build
(`node esbuild.config.js` → `dist/cli.js`) driven as a real `qwen serve` daemon
against a scripted OpenAI-compatible model. No mocks of the Goal runtime.
