#!/bin/bash
set -u
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
W=/Users/wenshao/pr13129-rig/wt; F=packages/cli/src/serve/hosted-harness-session.ts
cd $W && git -C /Users/wenshao/git/qwen-code-x3 show d0b1bb3482 -- $F > /tmp/d0b1.patch 2>/dev/null || git show d0b1bb3482 -- $F > /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/db41f725-f4b4-43d3-ba2e-f66bdb66df6b/scratchpad/d0b1.patch
P=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/db41f725-f4b4-43d3-ba2e-f66bdb66df6b/scratchpad/d0b1.patch
git show d0b1bb3482 -- $F > $P
git apply -R --check $P && git apply -R $P && git status --short
cd packages/cli && npx vitest run src/serve/hosted-harness-session.test.ts -t "settles only a cancelled pre-model Hook|SessionDelete|deleted_session_id" --reporter=verbose 2>&1 | grep -E "^ +(✓|×)|Tests " | sed 's/^ *//' | cut -c1-200
cd $W && git checkout HEAD -- $F && git status --short && echo restored
