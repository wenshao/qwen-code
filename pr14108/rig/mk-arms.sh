#!/bin/bash
# Hard-link copies of the built base tree; every patched file is re-created (hard link broken) before patching.
set -euo pipefail
R=/root/pr14108-rig; cd $R
arm() { # arm <name> <patch>...
  local n=$1; shift
  [ -d src-$n ] && { echo "src-$n exists"; return; }
  cp -al src-base src-$n
  for p in "$@"; do
    for f in $(grep -E "^\+\+\+ b/" up/$p | sed -e "s#^+++ b/##" -e "s#\t.*##"); do
      cp --preserve=all src-$n/$f src-$n/$f.unlink && mv src-$n/$f.unlink src-$n/$f
    done
    (cd src-$n && patch -p1 --no-backup-if-mismatch < $R/up/$p) | sed "s#^#[$n] #"
  done
}
arm head pr.patch
arm cand pr.patch candidate.patch
arm mkeep pr.patch m-keepid.patch
arm mkeepc pr.patch candidate.patch m-keepid.patch
arm msealed pr.patch m-sealed.patch
arm m14039 pr.patch m-14039.patch
for n in head cand mkeep mkeepc msealed m14039; do
  f=src-$n/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/HostedShellLifecycleRecoveryIT.java
  echo "$n IT-links=$(stat -c %h $f) sha=$(sha256sum $f | cut -c1-12) base=$(sha256sum src-base/${f#src-$n/} | cut -c1-12)"
done
echo ARMS-DONE
