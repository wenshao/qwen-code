#!/bin/bash
# macOS host: APFS-clone node_modules (root + packages/*) from a worktree with an identical pnpm-lock.yaml.  usage: clone-nm.sh <src-worktree> <dst-worktree>
set -u
SRC=$1; DST=$2
cd $SRC
find . -name node_modules -type d -not -path '*/node_modules/*' | while read -r d; do
  [ ! -e "$DST/$d" ] && mkdir -p "$(dirname "$DST/$d")" && cp -Rc "$d" "$DST/$d"
done
echo "cloned: $(cd $DST && find . -name node_modules -type d -not -path '*/node_modules/*' | wc -l | tr -d ' ') node_modules dirs"
