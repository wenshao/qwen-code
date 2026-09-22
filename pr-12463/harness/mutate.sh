#!/bin/bash
# Mutation sweep over the PR's production hunks; runs the PR's new witness file per mutant.
cd /root/verify/pr12463-head
MB=c822995d3ac8e024221a1be36297ed87b1c359f0
SH=packages/core/src/tools/shell.ts
CF=packages/core/src/config/config.ts
T=src/tools/shell.session-commit-tracking.test.ts
run() { # name, description
  local out; out=$(cd packages/core && ../../node_modules/.bin/vitest run $T 2>&1)
  local line; line=$(echo "$out" | grep -E "^\s+Tests " | tail -1 | sed 's/^ *//')
  local failed; failed=$(echo "$out" | grep -E "^\s+×" | sed 's/^ *× *//; s/ [0-9]*ms$//' | sed 's/ShellTool session commit tracking (issue #12460) > //' | paste -sd'|' -)
  printf '%-4s | %-70s | %s | %s\n' "$1" "$2" "$line" "$failed"
  git checkout -q -- $SH $CF
}
run BASE "no mutation (PR head)"
git show $MB:$SH > $SH; git show $MB:$CF > $CF
run RED "both production files reverted to merge-base (tests kept)"
sed -i 's|^      await this.trackSessionCommit(cwd, preHead);|      // await this.trackSessionCommit(cwd, preHead);|' $SH
run A "author A: drop the trackSessionCommit call"
sed -i 's|if (postHead !== null \&\& postHead !== preHead) {\n      registerSessionCommit|X|' $SH
perl -0pi -e 's/if \(postHead !== null && postHead !== preHead\) \{\n      registerSessionCommit/if (postHead !== null) {\n      registerSessionCommit/' $SH
run B "author B: drop the postHead !== preHead comparison"
sed -i 's|await this.trackSessionCommit(cwd, preHead);|await this.trackSessionCommit(cwd, null);|' $SH
run A2 "author A2: pass null instead of preHead"
sed -i 's|^      clearSessionCommits();|      // clearSessionCommits();|' $CF
run C "author C: drop clearSessionCommits() in setApprovalMode"
perl -0pi -e 's/\n      clearSessionCommits\(\);\n    \}\n    this.approvalMode = mode;/\n    }\n    clearSessionCommits();\n    this.approvalMode = mode;/' $CF
run D "author D: clear on every setApprovalMode call (outside the gate)"
perl -0pi -e 's/registerSessionCommit\(postHead\);/registerSessionCommit(preHead ?? postHead);/' $SH
run M1 "register preHead (the OLD head) instead of postHead"
perl -0pi -e 's/\n      clearSessionCommits\(\);\n    \}\n    this.approvalMode = mode;/\n      if (fromMode === ApprovalMode.AUTO) clearSessionCommits();\n    }\n    this.approvalMode = mode;/' $CF
run M2 "clear only when LEAVING auto"
perl -0pi -e 's/(      await this.trackSessionCommit\(cwd, preHead\);\n)//; s/(      attributionWarning = await this.attachCommitAttribution\(\n        cwd,\n        preHead,\n        isAmend,\n      \);\n)/$1      await this.trackSessionCommit(cwd, preHead);\n/' $SH
run M3 "move registration AFTER attachCommitAttribution"
perl -0pi -e 's/(      await this.trackSessionCommit\(cwd, preHead\);\n)//; s/(    const postHead = await this.getGitHead\(cwd\);\n    const commitCreated = postHead !== null && postHead !== preHead;\n    const attributionService = CommitAttributionService.getInstance\(\);\n)/$1    if (commitCreated) registerSessionCommit(postHead);\n/' $SH
grep -n "if (commitCreated) registerSessionCommit" $SH >/dev/null || echo "M4 edit did not apply"
run M4 "register INSIDE attachCommitAttribution (after its toggle early-return?)"
git status --porcelain
