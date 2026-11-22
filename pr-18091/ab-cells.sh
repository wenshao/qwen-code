#!/usr/bin/env bash
# A/B of the 10-file suite the PR's Reviewer Test Plan names.
# Base (2e102659) gets the PR's test files verbatim; the 4 new tests must be
# red there and green on the head (20eefd1). The base's own test files are
# restored afterwards.
set -u
ROOT=/root/git/qwen-code-verify/.qwen/worktrees
H=$ROOT/pr18091-head/packages/web-shell
B=$ROOT/pr18091-base/packages/web-shell
FILES="client/chat-core/ client/i18n.test.ts client/i18n-loading.test.tsx client/daemon/useDaemonChatController.test.tsx client/daemon/chat-controller.test.ts client/daemon/chat-intents.test.ts client/daemon/permission-signals.test.ts client/adapters/transcriptAdapter.test.ts"

cp "$H/client/chat-core/ChatSurface.test.tsx" "$B/client/chat-core/"
cp "$H/client/daemon/useDaemonChatController.test.tsx" "$B/client/daemon/"
cp "$H/client/daemon/chat-controller.test.ts" "$B/client/daemon/"

echo "=== BASE arm 2e102659, PR test files copied in"
( cd "$B" && npx vitest run $FILES 2>&1 | grep -aE "FAIL .*(ChatSurface|chat-controller|useDaemonChatController)|Tests |Test Files " )
git -C "$ROOT/pr18091-base" checkout -- \
  packages/web-shell/client/chat-core/ChatSurface.test.tsx \
  packages/web-shell/client/daemon/useDaemonChatController.test.tsx \
  packages/web-shell/client/daemon/chat-controller.test.ts

echo
echo "=== HEAD arm 8b86926a"
( cd "$H" && npx vitest run $FILES 2>&1 | grep -aE "Tests |Test Files " )
