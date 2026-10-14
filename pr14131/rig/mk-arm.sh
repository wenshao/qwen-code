#!/bin/bash
# usage: mk-arm.sh <name> <patch>...  -- hard-link copy of the built base tree; every patched file is
# re-created (hard link broken) before patching so the base stays byte-identical.
set -euo pipefail
R=/root/pr14131-rig; cd $R; n=$1; shift
[ -d src-$n ] && { echo "src-$n exists"; exit 0; }
cp -al src-base src-$n
rm -rf src-$n/packages/sdk-java/*/target  # unlink only; never rewrite base build output in place
for p in "$@"; do
  for f in $(grep -E "^\+\+\+ b/" up/$p | sed -e "s#^+++ b/##" -e "s#\t.*##"); do
    [ -e src-$n/$f ] || continue   # new file: nothing to unlink
    cp --preserve=all src-$n/$f src-$n/$f.unlink && mv src-$n/$f.unlink src-$n/$f
  done
  (cd src-$n && patch -p1 --no-backup-if-mismatch < $R/up/$p) | sed "s#^#[$n] #"
done
for f in $(grep -hE "^\+\+\+ b/" "${@/#/up/}" | sed -e "s#^+++ b/##" -e "s#\t.*##" | sort -u); do
  echo "$n $(stat -c %h src-$n/$f) $(sha256sum src-$n/$f | cut -c1-12) base=$(sha256sum src-base/$f | cut -c1-12) $f"
done
