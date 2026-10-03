#!/bin/bash
# VERIFICATION RIG ONLY (PR #13168 R2): APFS-clone node_modules (root + nested) from a same-lockfile tree. Source is read only.
# usage: clone-nm.sh <target-worktree> <source-worktree>
set -u
T=$1; cd $2
[ -d $T/node_modules ] || cp -Rc node_modules $T/node_modules
find packages integrations -maxdepth 3 -type d -name node_modules -not -path '*/node_modules/*' | while read d; do
  [ -e "$T/$d" ] || { mkdir -p "$T/$(dirname $d)"; cp -Rc "$d" "$T/$d"; }
done
echo "cloned into $T: $(find $T/packages $T/integrations -maxdepth 3 -type d -name node_modules -not -path '*/node_modules/*/*' | wc -l | tr -d ' ') nested node_modules"
