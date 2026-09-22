Real-stack verification evidence for QwenLM/qwen-code PR #12279 (head e928e1459f, base e928e14^ = 62e899409a).

Host: Linux arm64 (Orange Pi 5), Node 24.13. Daemon: `node dist/cli.js serve` from `npm run bundle`
of the PR head; the three arms share the daemon build and differ only in `dist/web-shell`
(base = the PR's useQueuedPrompts.ts reverted, head = PR, fix = PR + rig/candidate-fix-with-test.diff).
Browser: Chromium 145 via playwright-core 1.58.2. Model: rig/fake-openai.mjs (a `[slow:N]` marker in the
last user message streams for N seconds; every request is written to a JSONL ledger).

Reproduce: start fake-openai.mjs on :18279, `launch.sh <arm> <port>` per arm, then
`run-one.sh <arm> <port> <scenario>` with scenario in queued|file|delete|immediate|settle|control.
Only network-level injection is used (page.route): the mid-turn POST is held until turn A settles
(daemon answers session_idle), the resubmission POST is held while a second client's prompt C starts
(queued/file/delete/settle), and the first GET /pending-prompts after the resubmission's 202 is aborted
(settle: every GET until B settles).
