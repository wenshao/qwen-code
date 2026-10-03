#!/bin/bash
# VERIFICATION RIG ONLY: clone (APFS copy-on-write) the install + build outputs of a built worktree into a sibling worktree of the same tree.
# usage: clone-built.sh <target-worktree> [source-worktree]
set -u
RIG=/Users/wenshao/pr13179-rig; T=$RIG/$1; cd $RIG/${2:-wt}
[ -d $T/node_modules ] || cp -Rc node_modules $T/node_modules
find packages integrations -maxdepth 3 -type d \( -name node_modules -o -name dist -o -name generated \) -not -path '*/node_modules/*' | while read d; do
  [ -e "$T/$d" ] || { mkdir -p "$T/$(dirname $d)"; cp -Rc "$d" "$T/$d"; }
done
echo "cloned into $1: $(find $T/packages -maxdepth 3 -type d -name dist -not -path '*/node_modules/*' | wc -l | tr -d ' ') dist dirs"
