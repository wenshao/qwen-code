#!/usr/bin/env bash
# Two-arm measurement of PR 18091's onCancel ownership guard.
# Both arms run the identical probe; it prints counts and asserts only the
# positive control, so the base arm (no guard) completes and reports its own
# numbers.
set -u
H=/root/git/qwen-code-verify/.qwen/worktrees/pr18091-head/packages/web-shell
B=/root/git/qwen-code-verify/.qwen/worktrees/pr18091-base/packages/web-shell
echo "=== BASE arm 2e102659 (no onCancel ownership guard)"
( cd "$B" && npx vitest run client/chat-core/pr18091-edge.probe.test.tsx 2>&1 | grep -aE "E[1-4] (post-settlement-return|after-unmount|active-rejected|roundtrip-before-settle)|Tests " )
echo
echo "=== HEAD arm 8b86926a (guard applied)"
( cd "$H" && npx vitest run client/chat-core/pr18091-edge.probe.test.tsx 2>&1 | grep -aE "E[1-4] (post-settlement-return|after-unmount|active-rejected|roundtrip-before-settle)|Tests " )
echo
echo "E1 = durable A -> B, settle rejected, return to A (post-settlement return)"
echo "E2 = cancel, unmount the surface, settle rejected"
echo "E3 = positive control: active session settles rejected"
echo "E4 = durable A -> B -> A, settle rejected after the round trip"
