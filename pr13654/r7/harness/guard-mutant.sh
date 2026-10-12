#!/bin/bash
# Round 7, after #13654 landed: which test catches "child-run admission stops consulting the kind gate"?
# Tree: current main 96076f3a (contains the landed PR). Mutant G deletes the one assertManagedSessionChildRunKindEnabled(child.kind)
# call in ManagedSessionAuthority's child_run admission. Test-file variants of hosted-never-started-reconcile.test.ts:
#   V2 = #13983 (main's file minus "enablement.childRun = false;" in the "admits" case)
#   V3 = #13959's file (main e9789d09, before the PR landed: the "refuses" case)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad
W=$HOME/git/qwen-code-pr13654-merge; OUT=$S/r7/results/guard-mutant; mkdir -p $OUT
MAIN=96076f3a06; T=packages/cli/src/serve/hosted-never-started-reconcile.test.ts; AUTH=packages/core/src/managed-runtime/managed-session-authority.ts
cd $W || exit 1; [ -z "$(git status --porcelain)" ] || { echo "worktree dirty"; exit 1; }
git checkout -q --detach $MAIN || exit 1; echo "at $(git rev-parse --short HEAD)"
v2() { git checkout -q $MAIN -- $T; n=$(grep -c '^    enablement.childRun = false;$' $T); [ "$n" = 1 ] || { echo "V2 anchor count $n"; exit 1; }; perl -ni -e 'print unless /^    enablement\.childRun = false;$/' $T; }
v3() { git checkout -q e9789d091133d9753decfc139df64c935a1866e6 -- $T; }
g()  { n=$(grep -c '^        assertManagedSessionChildRunKindEnabled(child.kind);$' $AUTH); [ "$n" = 1 ] || { echo "G anchor count $n"; exit 1; }; perl -ni -e 'print unless /^        assertManagedSessionChildRunKindEnabled\(child\.kind\);$/' $AUTH; }
vt() { # $1 label, $2 pkg dir, rest files
  local l=$1 d=$2; shift 2; (cd $d && npx vitest run "$@" --reporter=verbose > $OUT/$l.log 2>&1); local rc=$?
  echo "$l exit=$rc $(grep -E '^ *Tests ' $OUT/$l.log | tr -s ' ') $(grep -E '^ *× ' $OUT/$l.log | head -4 | sed -E 's/^ *× //; s/ [0-9]+ms.*$//' | tr '\n' ';')"; }
R=src/serve/hosted-never-started-reconcile.test.ts
v2; vt base-V2 packages/cli $R
v3; vt base-V3 packages/cli $R
g; echo "mutant G applied: $(git diff --stat -- $AUTH | tail -1)"
v2; vt G-V2 packages/cli $R
v3; vt G-V3 packages/cli $R
git checkout -q $MAIN -- $T
vt G-core packages/core src/managed-runtime/managed-session-authority.child-run.test.ts src/managed-runtime/managed-session-authority.child-agent.test.ts src/managed-runtime/managed-session-authority.extension.test.ts src/managed-runtime/managed-child-run-record.test.ts
vt G-cli packages/cli src/serve/hosted-child-run-session.test.ts src/serve/hosted-child-agent-session.test.ts src/serve/hosted-workspace-tool-turn.test.ts
git checkout -q $MAIN -- $AUTH $T
git checkout -q --detach 876b00efba7ea6313993ce1b3646750a2fe6a0da; echo "restored: $(git rev-parse --short HEAD) dirty=[$(git status --porcelain)]"
