# PR #10403 verification evidence

Screenshots produced while verifying
[QwenLM/qwen-code#10403](https://github.com/QwenLM/qwen-code/pull/10403)
(`feat(serve): Enable full API access on trusted loopback`) on Linux.

- PR build: `8cacce2d56`
- Baseline: `413b6d15d3` (merge base of the PR branch and `main`)
- Host: Linux x86_64, Node v22.22.2, npm 10.9.7

Every image is a capture of a real `qwen serve` daemon (real HTTP/WebSocket,
real spawned ACP children) or of the real Web Shell in Chromium.
