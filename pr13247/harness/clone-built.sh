#!/bin/bash
# Clone (APFS copy-on-write) install + build outputs from a built worktree at origin/main into a rig worktree.
# usage: clone-built.sh <target-worktree> <source-worktree>
set -u
T=$1; cd $2
[ -d $T/node_modules ] || cp -Rc node_modules $T/node_modules
find packages integrations -maxdepth 3 -type d \( -name node_modules -o -name dist \) -not -path '*/node_modules/*' | while read d; do
  [ -e "$T/$d" ] || { mkdir -p "$T/$(dirname $d)"; cp -Rc "$d" "$T/$d"; }
done
[ -d dist ] && [ ! -e $T/dist ] && cp -Rc dist $T/dist
echo "cloned into $T: $(find $T/packages -maxdepth 3 -type d -name dist -not -path '*/node_modules/*' | wc -l | tr -d ' ') dist dirs, root dist=$(ls $T/dist 2>/dev/null | wc -l | tr -d ' ') files"
