#!/bin/bash
# VERIFICATION RIG ONLY: regression runner (DB and ARM from the environment).
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
cd /Users/wenshao/pr13166-rig/probe
export DB=${DB:-g10} ARM=${ARM:-head3}
ST=c $N s1-profiles.mjs
ST=b $N s2-glob.mjs
ST=e PROFILE=hosted-workspace-files/2 $N s3-symlink.mjs
ST=g $N s4-truncate.mjs
ST=h $N s5-approval.mjs
ST=i $N s6-shell2.mjs
ST=j PROFILE=hosted-workspace-files/2 $N s9-continue.mjs
ST=k PROFILE=hosted-workspace-shell/2 $N s9-continue.mjs
echo ALL-DONE
