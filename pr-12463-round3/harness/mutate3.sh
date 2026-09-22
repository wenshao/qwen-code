#!/bin/bash
# Mutation sweep at b6dd220d; runs the PR's witness file per mutant.
cd /root/verify/pr12463-head
SH=packages/core/src/tools/shell.ts
AM=packages/core/src/permissions/autoMode.ts
T=src/tools/shell.session-commit-tracking.test.ts
run() {
  local out; out=$(cd packages/core && ../../node_modules/.bin/vitest run $T 2>&1)
  local line; line=$(echo "$out" | grep -E "^\s+Tests " | tail -1 | sed 's/^ *//')
  local failed; failed=$(echo "$out" | grep -E "^\s+×" | sed 's/^ *× *//; s/ [0-9]*ms$//; s/ShellTool session commit tracking (issue #12460) > //' | paste -sd'|' -)
  printf '%-5s | %-58s | %s | %s\n' "$1" "$2" "$line" "$failed"
  git checkout -q -- $SH $AM
}
run BASE "no mutation (b6dd220d)"
perl -0pi -e 's/head !== null && head\.createdByCommit && head\.sha !== preHead/head !== null \&\& head.sha !== preHead/' $SH; run N1 "drop createdByCommit (back to 'HEAD moved')"
perl -0pi -e 's/head !== null && head\.createdByCommit && head\.sha !== preHead/head !== null \&\& head.createdByCommit/' $SH; run N2 "drop the preHead comparison"
perl -0pi -e 's/createdByCommit: \/\^commit\\b\/\.test\(subject\)/createdByCommit: \/^(?:commit|checkout|reset)\\b\/.test(subject)/' $SH; grep -q 'checkout|reset' $SH || echo "N3 not applied"; run N3 "also accept checkout/reset entries"
perl -0pi -e 's/createdByCommit: \/\^commit\\b\/\.test\(subject\)/createdByCommit: !\/^pull\\b\/.test(subject)/' $SH; grep -q '!/^pull' $SH || echo "N4 not applied"; run N4 "reject only 'pull' entries"
perl -0pi -e 's/input\.ctx\.cwd \?\? input\.config\.getTargetDir\?\.\(\)/input.ctx.cwd/' $AM; grep -q 'getTargetDir?.()' $AM && echo "CWD not applied"; run CWD "revert the autoMode cwd fallback"
perl -0pi -e "s/'--no-show-signature', //" $SH; grep -q "no-show-signature'" $SH && echo "SIG not applied"; run SIG "drop --no-show-signature"
git status --porcelain
