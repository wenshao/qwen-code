#!/bin/bash
# Mutation sweep over 847e289e's reflog criterion; runs the PR's witness file per mutant.
cd /root/verify/pr12463-head
SH=packages/core/src/tools/shell.ts
T=src/tools/shell.session-commit-tracking.test.ts
run() {
  local out; out=$(cd packages/core && ../../node_modules/.bin/vitest run $T 2>&1)
  local line; line=$(echo "$out" | grep -E "^\s+Tests " | tail -1 | sed 's/^ *//')
  local failed; failed=$(echo "$out" | grep -E "^\s+×" | sed 's/^ *× *//; s/ [0-9]*ms$//; s/ShellTool session commit tracking (issue #12460) > //' | paste -sd'|' -)
  printf '%-4s | %-66s | %s | %s\n' "$1" "$2" "$line" "$failed"
  git checkout -q -- $SH
}
run BASE "no mutation (847e289e)"
perl -0pi -e 's/head !== null && head\.createdByCommit && head\.sha !== preHead/head !== null \&\& head.sha !== preHead/' $SH; run N1 "drop createdByCommit (back to 'HEAD moved')"
perl -0pi -e 's/head !== null && head\.createdByCommit && head\.sha !== preHead/head !== null \&\& head.createdByCommit/' $SH; run N2 "drop the preHead comparison"
perl -0pi -e 's/createdByCommit: \/\^commit\\b\/\.test\(subject\)/createdByCommit: \/^(?:commit|checkout|reset)\\b\/.test(subject)/' $SH; grep -q 'checkout|reset' $SH || echo "N3 not applied"; run N3 "also accept checkout/reset entries (trailing HEAD moves)"
perl -0pi -e 's/createdByCommit: \/\^commit\\b\/\.test\(subject\)/createdByCommit: !\/^pull\\b\/.test(subject)/' $SH; grep -q '!/^pull' $SH || echo "N4 not applied"; run N4 "reject only 'pull' entries"
perl -0pi -e "s/\['log', '-g', '-1', '--format=%H%n%gs', 'HEAD'\]/['log', '-g', '-1', '--show-signature', '--format=%H%n%gs', 'HEAD']/" $SH; grep -q "'--show-signature'" $SH || echo "N5 not applied"; run N5 "force --show-signature (as if log.showSignature=true)"
git status --porcelain
